"""SQL column-level lineage analysis using DuckDB and SQLGlot."""

import json
import re
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple, Any

import sqlglot
import sqlglot.expressions as exp
import duckdb


@dataclass
class ColumnLineage:
    output_column: str
    source_columns: List[str]
    transformation: str
    is_direct: bool


@dataclass
class TableInfo:
    name: str
    alias: str
    columns: List[str]
    is_partitioned: bool = False


@dataclass
class ImpactNode:
    """A node in the impact analysis graph."""
    column: str
    level: int
    transformation: str
    is_direct: bool
    downstream_columns: List[str] = field(default_factory=list)


@dataclass
class ImpactResult:
    """Result of impact analysis."""
    source_column: str
    total_affected: int
    affected_columns: List[str]
    impact_path: List[ImpactNode]
    affected_queries: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent, default=str)


@dataclass
class LineageResult:
    query: str
    tables: List[TableInfo]
    output_columns: List[str]
    column_lineage: List[ColumnLineage]
    query_type: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent, default=str)


class ImpactAnalyzer:
    """Analyzes the downstream impact of a given column."""

    def __init__(self, lineage_results: List[LineageResult]):
        self.lineage_results = lineage_results
        self.graph = self._build_graph()

    def _build_graph(self) -> Dict[str, List[Dict[str, Any]]]:
        """Build a directed graph of column dependencies."""
        graph: Dict[str, List[Dict[str, Any]]] = {}

        for lineage_result in self.lineage_results:
            for lineage_entry in lineage_result.column_lineage:
                output_col = lineage_entry.output_column
                for source_col in lineage_entry.source_columns:
                    if source_col not in graph:
                        graph[source_col] = []
                    graph[source_col].append({
                        "target": output_col,
                        "transformation": lineage_entry.transformation,
                        "is_direct": lineage_entry.is_direct,
                        "query": lineage_result.query
                    })

        return graph

    def analyze(self, source_column: str, max_depth: int = 10) -> ImpactResult:
        """Analyze downstream impact of a source column."""
        visited = set()
        impact_path: List[ImpactNode] = []
        affected_columns: List[str] = []
        affected_queries: Set[str] = set()

        def traverse(col: str, level: int, path: List[str]):
            if level > max_depth or col in visited:
                return

            visited.add(col)
            if col != source_column:
                affected_columns.append(col)

            if col in self.graph:
                for edge in self.graph[col]:
                    target = edge["target"]
                    if target not in path:
                        affected_queries.add(edge["query"])
                        node = ImpactNode(
                            column=target,
                            level=level,
                            transformation=edge["transformation"],
                            is_direct=edge["is_direct"],
                            downstream_columns=[e["target"] for e in self.graph.get(target, [])]
                        )
                        impact_path.append(node)
                        new_path = path + [target]
                        traverse(target, level + 1, new_path)

        traverse(source_column, 0, [source_column])

        return ImpactResult(
            source_column=source_column,
            total_affected=len(affected_columns),
            affected_columns=sorted(affected_columns),
            impact_path=impact_path,
            affected_queries=list(affected_queries)
        )

    def find_all_impacts(self, columns: List[str]) -> Dict[str, ImpactResult]:
        """Analyze impact for multiple columns."""
        results = {}
        for col in columns:
            results[col] = self.analyze(col)
        return results


class SQLLineageAnalyzer:
    """Analyzes SQL queries to extract column-level lineage."""

    def __init__(self, sql_query: str):
        self.sql_query = sql_query.strip()
        self.parsed = None
        self._parse_sql()

    def _parse_sql(self) -> None:
        """Parse the SQL query using SQLGlot."""
        try:
            self.parsed = sqlglot.parse_one(self.sql_query, read="duckdb")
        except Exception as e:
            raise ValueError(f"Failed to parse SQL: {e}")

    def extract_tables(self) -> List[TableInfo]:
        """Extract all tables referenced in the query."""
        tables = []
        seen = set()

        for table in self.parsed.find_all(exp.Table):
            name = table.name
            alias = table.alias or name
            key = (name, alias)
            if key not in seen:
                seen.add(key)
                tables.append(TableInfo(
                    name=name,
                    alias=alias,
                    columns=[]
                ))

        return tables

    def extract_output_columns(self) -> List[str]:
        """Extract output columns from the SELECT clause."""
        output_cols = []
        select = self.parsed.find(exp.Select)

        if not select:
            return output_cols

        for i, expr in enumerate(select.expressions):
            if isinstance(expr, exp.Star):
                output_cols.append("*")
            elif isinstance(expr, exp.Alias):
                output_cols.append(expr.alias)
            else:
                col_name = self._get_expression_name(expr)
                output_cols.append(col_name or f"col_{i}")

        return output_cols

    def _get_expression_name(self, expr: exp.Expression) -> Optional[str]:
        """Get the column name from an expression."""
        if isinstance(expr, exp.Column):
            return expr.name
        elif isinstance(expr, exp.Alias):
            return expr.alias
        return None

    def _extract_column_references(self, expr: exp.Expression) -> Set[str]:
        """Extract all column references from an expression, supporting nested columns."""
        columns = set()

        for node in expr.walk():
            if isinstance(node, exp.Column):
                table_alias = node.table
                col_name = node.name
                if table_alias:
                    columns.add(f"{table_alias}.{col_name}")
                else:
                    columns.add(col_name)
            elif isinstance(node, exp.Dot):
                full_path = self._build_dot_path(node)
                if full_path:
                    columns.add(full_path)

        return columns

    def _build_dot_path(self, node: exp.Dot) -> Optional[str]:
        """Build a dotted path from a Dot expression (e.g., a.b.c)."""
        parts = []
        current = node
        while isinstance(current, exp.Dot):
            parts.insert(0, current.this.name)
            current = current.expression
        if isinstance(current, exp.Column):
            parts.insert(0, current.name)
            if current.table:
                parts.insert(0, current.table)
            return ".".join(parts)
        elif isinstance(current, exp.Identifier):
            parts.insert(0, current.name)
            return ".".join(parts)
        return None

    def _get_transformation_type(self, expr: exp.Expression) -> str:
        """Determine the transformation type for an expression."""
        if isinstance(expr, exp.Column):
            return "direct"

        func_names = []
        for node in expr.walk():
            if isinstance(node, exp.Func):
                func_names.append(node.sql_name())

        if func_names:
            return f"function({', '.join(func_names)})"

        if isinstance(expr, (exp.Add, exp.Sub, exp.Mul, exp.Div)):
            return "arithmetic"

        if isinstance(expr, (exp.EQ, exp.NEQ, exp.GT, exp.GTE, exp.LT, exp.LTE)):
            return "comparison"

        if isinstance(expr, exp.Case):
            return "case_when"

        if isinstance(expr, exp.Cast):
            return "cast"

        return "complex"

    def analyze_column_lineage(self, table_schemas: Optional[Dict[str, List[str]]] = None) -> List[ColumnLineage]:
        """Analyze column-level lineage for the query, supporting nested columns."""
        lineage = []
        select = self.parsed.find(exp.Select)

        if not select:
            return lineage

        tables = self.extract_tables()
        table_aliases = {t.alias: t.name for t in tables}

        for expr in select.expressions:
            output_col = None
            source_expr = expr

            if isinstance(expr, exp.Alias):
                output_col = expr.alias
                source_expr = expr.this
            elif isinstance(expr, exp.Column):
                output_col = expr.name
            elif isinstance(expr, exp.Dot):
                output_col = self._build_dot_path(expr) or f"expr_{len(lineage)}"
            else:
                output_col = self._get_expression_name(expr) or f"expr_{len(lineage)}"

            if isinstance(expr, exp.Star):
                if table_schemas:
                    for table in tables:
                        cols = table_schemas.get(table.name, [])
                        for col in cols:
                            lineage.append(ColumnLineage(
                                output_column=f"{table.alias}.{col}" if table.alias != table.name else col,
                                source_columns=[f"{table.alias}.{col}" if table.alias != table.name else col],
                                transformation="direct",
                                is_direct=True
                            ))
                continue

            source_cols = self._extract_column_references(source_expr)

            resolved_cols = []
            for col in source_cols:
                if "." in col:
                    parts = col.split(".")
                    alias_or_col = parts[0]
                    if alias_or_col in table_aliases:
                        table_name = table_aliases[alias_or_col]
                        nested_path = ".".join(parts[1:])
                        resolved_col = f"{table_name}.{nested_path}"
                        if table_schemas:
                            if resolved_col in table_schemas.get(table_name, []):
                                resolved_cols.append(resolved_col)
                            else:
                                for schema_col in table_schemas.get(table_name, []):
                                    if schema_col.startswith(f"{nested_path}.") or schema_col == nested_path:
                                        resolved_cols.append(f"{table_name}.{schema_col}")
                        else:
                            resolved_cols.append(resolved_col)
                    else:
                        if table_schemas:
                            found = False
                            for table in tables:
                                table_cols = table_schemas.get(table.name, [])
                                if col in table_cols:
                                    resolved_cols.append(f"{table.name}.{col}")
                                    found = True
                                    break
                                for tc in table_cols:
                                    if tc.startswith(f"{col}."):
                                        resolved_cols.append(f"{table.name}.{tc}")
                                        found = True
                            if not found:
                                resolved_cols.append(col)
                        else:
                            resolved_cols.append(col)
                else:
                    if table_schemas:
                        found = False
                        for table in tables:
                            if col in table_schemas.get(table.name, []):
                                resolved_cols.append(f"{table.name}.{col}")
                                found = True
                                break
                        if not found:
                            resolved_cols.append(col)
                    else:
                        resolved_cols.append(col)

            transformation = self._get_transformation_type(source_expr)
            is_direct = transformation == "direct" and len(resolved_cols) == 1

            lineage.append(ColumnLineage(
                output_column=output_col,
                source_columns=sorted(list(set(resolved_cols))),
                transformation=transformation,
                is_direct=is_direct
            ))

        return lineage

    def get_query_type(self) -> str:
        """Determine the type of SQL query."""
        if self.parsed.find(exp.Select):
            if self.parsed.find(exp.Group):
                return "SELECT with GROUP BY"
            if self.parsed.find(exp.Join):
                return "SELECT with JOIN"
            if self.parsed.find(exp.Where):
                return "SELECT with WHERE"
            return "SELECT"
        if self.parsed.find(exp.Insert):
            return "INSERT"
        if self.parsed.find(exp.Update):
            return "UPDATE"
        if self.parsed.find(exp.Delete):
            return "DELETE"
        if self.parsed.find(exp.Create):
            return "CREATE TABLE AS SELECT" if self.parsed.find(exp.Select) else "CREATE"
        return "UNKNOWN"

    def analyze(self, table_schemas: Optional[Dict[str, List[str]]] = None) -> LineageResult:
        """Perform full lineage analysis."""
        tables = self.extract_tables()
        output_columns = self.extract_output_columns()
        column_lineage = self.analyze_column_lineage(table_schemas)
        query_type = self.get_query_type()

        return LineageResult(
            query=self.sql_query,
            tables=tables,
            output_columns=output_columns,
            column_lineage=column_lineage,
            query_type=query_type
        )


class DuckDBLineageRunner:
    """Runs SQL queries against DuckDB and validates lineage."""

    def __init__(self, flatten_nested: bool = False):
        self.conn = duckdb.connect()
        self.flatten_nested = flatten_nested

    def _get_flattened_columns(self, table_name: str) -> List[str]:
        """Get all columns including nested ones flattened."""
        try:
            result = self.conn.execute(f"""
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_name = '{table_name}'
                ORDER BY ordinal_position
            """).fetchall()
            
            columns = []
            for col_name, data_type in result:
                if data_type.startswith("STRUCT") or data_type.startswith("MAP") or "LIST" in data_type:
                    nested_cols = self._extract_nested_columns(table_name, col_name, data_type)
                    columns.extend(nested_cols)
                else:
                    columns.append(col_name)
            return columns
        except Exception:
            result = self.conn.execute(f"PRAGMA table_info('{table_name}')").fetchall()
            return [row[1] for row in result]

    def _extract_nested_columns(self, table_name: str, parent_col: str, data_type: str) -> List[str]:
        """Recursively extract nested columns from STRUCT/LIST types."""
        columns = []
        try:
            sample = self.conn.execute(f"SELECT {parent_col} FROM {table_name} LIMIT 1").fetchone()
            if sample and sample[0] is not None:
                value = sample[0]
                if isinstance(value, dict):
                    for key in value.keys():
                        nested_path = f"{parent_col}.{key}"
                        columns.append(nested_path)
                elif isinstance(value, list) and len(value) > 0:
                    if isinstance(value[0], dict):
                        for key in value[0].keys():
                            nested_path = f"{parent_col}.{key}"
                            columns.append(nested_path)
        except Exception:
            pass
        return columns

    def register_parquet(self, table_name: str, parquet_path: str) -> List[str]:
        """Register a Parquet file or dataset as a DuckDB table."""
        path = Path(parquet_path)
        if path.is_dir():
            self.conn.execute(f"""
                CREATE TABLE {table_name} AS
                SELECT * FROM read_parquet('{parquet_path}/**/*.parquet', hive_partitioning=true)
            """)
        else:
            self.conn.execute(f"""
                CREATE TABLE {table_name} AS
                SELECT * FROM read_parquet('{parquet_path}')
            """)

        if self.flatten_nested:
            return self._get_flattened_columns(table_name)
        else:
            result = self.conn.execute(f"PRAGMA table_info('{table_name}')").fetchall()
            return [row[1] for row in result]

    def execute_query(self, query: str) -> List[Tuple]:
        """Execute a SQL query and return results."""
        return self.conn.execute(query).fetchall()

    def get_query_result_schema(self, query: str) -> List[str]:
        """Get the column names of the query result."""
        result = self.conn.execute(query)
        return [desc[0] for desc in result.description]

    def close(self):
        """Close the DuckDB connection."""
        self.conn.close()


def analyze_sql_lineage(sql_query: str, table_schemas: Optional[Dict[str, List[str]]] = None) -> LineageResult:
    """Convenience function to analyze SQL lineage."""
    analyzer = SQLLineageAnalyzer(sql_query)
    return analyzer.analyze(table_schemas)
