"""Combines Parquet metadata with SQL lineage analysis."""

import json
from dataclasses import dataclass, field, asdict
from typing import Dict, List, Optional, Any

from .parquet_parser import ParquetMetadata
from .sql_lineage import LineageResult, ColumnLineage, ImpactResult, ImpactAnalyzer


@dataclass
class NodeInfo:
    id: str
    label: str
    type: str
    metadata: Dict[str, Any] = field(default_factory=dict)
    parent_id: Optional[str] = None
    children: List[str] = field(default_factory=list)
    is_collapsible: bool = False
    is_collapsed: bool = False


@dataclass
class EdgeInfo:
    id: str
    source: str
    target: str
    transformation: str
    is_direct: bool
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class LineageGraph:
    nodes: List[NodeInfo]
    edges: List[EdgeInfo]
    parquet_metadata: Dict[str, ParquetMetadata]
    lineage_result: LineageResult
    has_nested_columns: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "nodes": [asdict(n) for n in self.nodes],
            "edges": [asdict(e) for e in self.edges],
            "parquet_metadata": {
                k: v.to_dict() for k, v in self.parquet_metadata.items()
            },
            "lineage_result": self.lineage_result.to_dict(),
            "has_nested_columns": self.has_nested_columns
        }

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent, default=str)


class LineageGraphBuilder:
    """Builds a lineage DAG graph from Parquet metadata and SQL lineage."""

    def __init__(
        self,
        parquet_metadatas: Dict[str, ParquetMetadata],
        lineage_result: LineageResult
    ):
        self.parquet_metadatas = parquet_metadatas
        self.lineage_result = lineage_result
        self.nodes: List[NodeInfo] = []
        self.edges: List[EdgeInfo] = []
        self.node_ids: set = set()

    def _add_node(self, node_id: str, label: str, node_type: str, 
                   metadata: Optional[Dict] = None, parent_id: Optional[str] = None,
                   is_collapsible: bool = False) -> None:
        """Add a node if it doesn't already exist."""
        if node_id in self.node_ids:
            return
        self.node_ids.add(node_id)
        self.nodes.append(NodeInfo(
            id=node_id,
            label=label,
            type=node_type,
            metadata=metadata or {},
            parent_id=parent_id,
            is_collapsible=is_collapsible
        ))
        if parent_id:
            self._add_child_to_parent(parent_id, node_id)

    def _add_child_to_parent(self, parent_id: str, child_id: str) -> None:
        """Add a child ID to a parent node."""
        for node in self.nodes:
            if node.id == parent_id:
                node.children.append(child_id)
                node.is_collapsible = True
                break

    def _add_edge(
        self,
        source: str,
        target: str,
        transformation: str,
        is_direct: bool,
        metadata: Optional[Dict] = None
    ) -> None:
        """Add an edge between nodes."""
        edge_id = f"{source}->{target}"
        self.edges.append(EdgeInfo(
            id=edge_id,
            source=source,
            target=target,
            transformation=transformation,
            is_direct=is_direct,
            metadata=metadata or {}
        ))

    def _get_table_column_metadata(self, table_name: str, column_name: str) -> Dict[str, Any]:
        """Get metadata for a specific column in a table."""
        metadata = self.parquet_metadatas.get(table_name)
        if not metadata:
            return {}

        for col in metadata.columns:
            if col.name == column_name:
                return {
                    "type": col.type,
                    "nullable": col.nullable,
                    "stats": {
                        "null_count": col.stats.null_count,
                        "distinct_count": col.stats.distinct_count,
                        "min_value": col.stats.min_value,
                        "max_value": col.stats.max_value,
                        "avg_value": col.stats.avg_value,
                        "total_count": col.stats.total_count
                    } if col.stats else {}
                }
        return {}

    def _build_nested_hierarchy(self, table_name: str, metadata: ParquetMetadata, table_node_id: str) -> None:
        """Build nested column hierarchy for collapsible nodes."""
        nested_columns = [col for col in metadata.columns if col.is_nested]
        
        if not nested_columns:
            for col in metadata.columns:
                col_node_id = f"column:{table_name}.{col.name}"
                col_metadata = {
                    "type": col.type,
                    "nullable": col.nullable,
                    "stats": asdict(col.stats) if col.stats else {},
                    "is_nested": col.is_nested,
                    "is_leaf": col.is_leaf_column
                }
                self._add_node(
                    node_id=col_node_id,
                    label=col.name,
                    node_type="source_column",
                    metadata=col_metadata,
                    parent_id=table_node_id
                )
                self._add_edge(
                    source=table_node_id,
                    target=col_node_id,
                    transformation="contains",
                    is_direct=True,
                    metadata={"relationship": "table_column"}
                )
            return

        parent_map = {}
        for col in metadata.columns:
            col_node_id = f"column:{table_name}.{col.name}"
            col_metadata = {
                "type": col.type,
                "nullable": col.nullable,
                "stats": asdict(col.stats) if col.stats else {},
                "is_nested": col.is_nested,
                "is_leaf": col.is_leaf_column
            }

            if col.parent_path:
                parent_node_id = f"column:{table_name}.{col.parent_path}"
                parent_map[col_node_id] = parent_node_id
            else:
                parent_map[col_node_id] = table_node_id

            label = col.name.split(".")[-1] if "." in col.name else col.name
            self._add_node(
                node_id=col_node_id,
                label=label,
                node_type="source_column",
                metadata=col_metadata,
                parent_id=parent_map[col_node_id]
            )
            self._add_edge(
                source=parent_map[col_node_id],
                target=col_node_id,
                transformation="contains",
                is_direct=True,
                metadata={"relationship": "nested_column"}
            )

    def build(self) -> LineageGraph:
        """Build the complete lineage graph."""
        has_nested = False

        for table_info in self.lineage_result.tables:
            table_name = table_info.name
            table_node_id = f"table:{table_name}"

            metadata = self.parquet_metadatas.get(table_name)
            table_metadata = {
                "row_count": metadata.row_count if metadata else None,
                "file_count": metadata.file_count if metadata else None,
                "is_partitioned": metadata.is_partitioned if metadata else False,
                "partition_columns": metadata.partition_columns if metadata else []
            }

            self._add_node(
                node_id=table_node_id,
                label=table_name,
                node_type="table",
                metadata=table_metadata
            )

            if metadata:
                table_has_nested = any(col.is_nested for col in metadata.columns)
                if table_has_nested:
                    has_nested = True
                self._build_nested_hierarchy(table_name, metadata, table_node_id)

        for lineage_entry in self.lineage_result.column_lineage:
            output_col = lineage_entry.output_column
            output_node_id = f"output:{output_col}"

            output_metadata = {
                "transformation": lineage_entry.transformation,
                "is_direct": lineage_entry.is_direct,
                "source_count": len(lineage_entry.source_columns)
            }

            self._add_node(
                node_id=output_node_id,
                label=output_col,
                node_type="output_column",
                metadata=output_metadata
            )

            for source_col in lineage_entry.source_columns:
                if "." in source_col:
                    parts = source_col.split(".")
                    table_name = parts[0]
                    col_path = ".".join(parts[1:])
                    source_node_id = f"column:{source_col}"
                    
                    if source_node_id not in self.node_ids:
                        self._ensure_nested_chain_exists(table_name, col_path)
                else:
                    source_node_id = f"column:unknown.{source_col}"
                    if source_node_id not in self.node_ids:
                        self._add_node(
                            node_id=source_node_id,
                            label=source_col,
                            node_type="source_column",
                            metadata={}
                        )

                self._add_edge(
                    source=source_node_id,
                    target=output_node_id,
                    transformation=lineage_entry.transformation,
                    is_direct=lineage_entry.is_direct,
                    metadata={}
                )

        return LineageGraph(
            nodes=self.nodes,
            edges=self.edges,
            parquet_metadata=self.parquet_metadatas,
            lineage_result=self.lineage_result,
            has_nested_columns=has_nested
        )

    def _ensure_nested_chain_exists(self, table_name: str, col_path: str) -> None:
        """Ensure all parent nodes in a nested path exist."""
        parts = col_path.split(".")
        current_path = ""
        parent_id = f"table:{table_name}"

        for i, part in enumerate(parts):
            current_path = f"{current_path}.{part}" if current_path else part
            node_id = f"column:{table_name}.{current_path}"

            if node_id not in self.node_ids:
                self._add_node(
                    node_id=node_id,
                    label=part,
                    node_type="source_column",
                    metadata={"is_nested": i < len(parts) - 1, "is_leaf": i == len(parts) - 1},
                    parent_id=parent_id
                )
                self._add_edge(
                    source=parent_id,
                    target=node_id,
                    transformation="contains",
                    is_direct=True,
                    metadata={"relationship": "nested_column"}
                )

            parent_id = node_id


def build_lineage_graph(
    parquet_metadatas: Dict[str, ParquetMetadata],
    lineage_result: LineageResult
) -> LineageGraph:
    """Convenience function to build a lineage graph."""
    builder = LineageGraphBuilder(parquet_metadatas, lineage_result)
    return builder.build()


@dataclass
class MultiQueryLineageGraph:
    """Combined lineage graph for multiple SQL queries."""
    nodes: List[NodeInfo]
    edges: List[EdgeInfo]
    parquet_metadata: Dict[str, ParquetMetadata]
    lineage_results: List[LineageResult]
    has_nested_columns: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "nodes": [asdict(n) for n in self.nodes],
            "edges": [asdict(e) for e in self.edges],
            "parquet_metadata": {
                k: v.to_dict() for k, v in self.parquet_metadata.items()
            },
            "lineage_results": [r.to_dict() for r in self.lineage_results],
            "has_nested_columns": self.has_nested_columns
        }

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent, default=str)

    def analyze_impact(self, source_column: str) -> ImpactResult:
        """Analyze downstream impact of a source column across all queries."""
        analyzer = ImpactAnalyzer(self.lineage_results)
        return analyzer.analyze(source_column)


class MultiQueryLineageBuilder:
    """Builds a combined lineage graph from multiple SQL queries."""

    def __init__(
        self,
        parquet_metadatas: Dict[str, ParquetMetadata],
        lineage_results: List[LineageResult]
    ):
        self.parquet_metadatas = parquet_metadatas
        self.lineage_results = lineage_results
        self.nodes: List[NodeInfo] = []
        self.edges: List[EdgeInfo] = []
        self.node_ids: set = set()
        self.edge_ids: set = set()

    def _add_node(self, node_id: str, label: str, node_type: str, 
                   metadata: Optional[Dict] = None, parent_id: Optional[str] = None,
                   is_collapsible: bool = False) -> None:
        if node_id in self.node_ids:
            return
        self.node_ids.add(node_id)
        self.nodes.append(NodeInfo(
            id=node_id,
            label=label,
            type=node_type,
            metadata=metadata or {},
            parent_id=parent_id,
            is_collapsible=is_collapsible
        ))
        if parent_id:
            self._add_child_to_parent(parent_id, node_id)

    def _add_child_to_parent(self, parent_id: str, child_id: str) -> None:
        for node in self.nodes:
            if node.id == parent_id:
                if child_id not in node.children:
                    node.children.append(child_id)
                node.is_collapsible = True
                break

    def _add_edge(self, source: str, target: str, transformation: str,
                   is_direct: bool, metadata: Optional[Dict] = None) -> None:
        edge_id = f"{source}->{target}"
        if edge_id in self.edge_ids:
            return
        self.edge_ids.add(edge_id)
        self.edges.append(EdgeInfo(
            id=edge_id,
            source=source,
            target=target,
            transformation=transformation,
            is_direct=is_direct,
            metadata=metadata or {}
        ))

    def _get_table_column_metadata(self, table_name: str, column_name: str) -> Dict[str, Any]:
        metadata = self.parquet_metadatas.get(table_name)
        if not metadata:
            return {}
        for col in metadata.columns:
            if col.name == column_name:
                return {
                    "type": col.type,
                    "nullable": col.nullable,
                    "stats": asdict(col.stats) if col.stats else {}
                }
        return {}

    def _build_nested_hierarchy(self, table_name: str, metadata: ParquetMetadata, table_node_id: str) -> None:
        nested_columns = [col for col in metadata.columns if col.is_nested]
        if not nested_columns:
            for col in metadata.columns:
                col_node_id = f"column:{table_name}.{col.name}"
                col_metadata = {
                    "type": col.type,
                    "nullable": col.nullable,
                    "stats": asdict(col.stats) if col.stats else {},
                    "is_nested": col.is_nested,
                    "is_leaf": col.is_leaf_column
                }
                self._add_node(col_node_id, col.name, "source_column", col_metadata, table_node_id)
                self._add_edge(table_node_id, col_node_id, "contains", True, {"relationship": "table_column"})
            return

        for col in metadata.columns:
            col_node_id = f"column:{table_name}.{col.name}"
            col_metadata = {
                "type": col.type,
                "nullable": col.nullable,
                "stats": asdict(col.stats) if col.stats else {},
                "is_nested": col.is_nested,
                "is_leaf": col.is_leaf_column
            }
            if col.parent_path:
                parent_node_id = f"column:{table_name}.{col.parent_path}"
            else:
                parent_node_id = table_node_id
            label = col.name.split(".")[-1] if "." in col.name else col.name
            self._add_node(col_node_id, label, "source_column", col_metadata, parent_node_id)
            self._add_edge(parent_node_id, col_node_id, "contains", True, {"relationship": "nested_column"})

    def _ensure_nested_chain_exists(self, table_name: str, col_path: str) -> None:
        parts = col_path.split(".")
        current_path = ""
        parent_id = f"table:{table_name}"
        for i, part in enumerate(parts):
            current_path = f"{current_path}.{part}" if current_path else part
            node_id = f"column:{table_name}.{current_path}"
            if node_id not in self.node_ids:
                self._add_node(node_id, part, "source_column",
                              {"is_nested": i < len(parts) - 1, "is_leaf": i == len(parts) - 1}, parent_id)
                self._add_edge(parent_id, node_id, "contains", True, {"relationship": "nested_column"})
            parent_id = node_id

    def build(self) -> MultiQueryLineageGraph:
        has_nested = False
        all_tables = set()

        for lineage_result in self.lineage_results:
            for table_info in lineage_result.tables:
                all_tables.add((table_info.name, table_info.alias))

        for table_name, _ in all_tables:
            table_node_id = f"table:{table_name}"
            metadata = self.parquet_metadatas.get(table_name)
            table_metadata = {
                "row_count": metadata.row_count if metadata else None,
                "file_count": metadata.file_count if metadata else None,
                "is_partitioned": metadata.is_partitioned if metadata else False,
                "partition_columns": metadata.partition_columns if metadata else []
            }
            self._add_node(table_node_id, table_name, "table", table_metadata)
            if metadata:
                if any(col.is_nested for col in metadata.columns):
                    has_nested = True
                self._build_nested_hierarchy(table_name, metadata, table_node_id)

        for query_idx, lineage_result in enumerate(self.lineage_results):
            query_prefix = f"q{query_idx}_" if len(self.lineage_results) > 1 else ""
            for lineage_entry in lineage_result.column_lineage:
                output_col = lineage_entry.output_column
                output_node_id = f"output:{query_prefix}{output_col}"
                output_metadata = {
                    "transformation": lineage_entry.transformation,
                    "is_direct": lineage_entry.is_direct,
                    "source_count": len(lineage_entry.source_columns),
                    "query_index": query_idx
                }
                self._add_node(output_node_id, output_col, "output_column", output_metadata)

                for source_col in lineage_entry.source_columns:
                    if "." in source_col:
                        parts = source_col.split(".")
                        table_name = parts[0]
                        col_path = ".".join(parts[1:])
                        source_node_id = f"column:{source_col}"
                        if source_node_id not in self.node_ids:
                            self._ensure_nested_chain_exists(table_name, col_path)
                    else:
                        source_node_id = f"column:unknown.{source_col}"
                        if source_node_id not in self.node_ids:
                            self._add_node(source_node_id, source_col, "source_column", {})

                    self._add_edge(source_node_id, output_node_id, lineage_entry.transformation,
                                  lineage_entry.is_direct, {"query_index": query_idx})

        return MultiQueryLineageGraph(
            nodes=self.nodes,
            edges=self.edges,
            parquet_metadata=self.parquet_metadatas,
            lineage_results=self.lineage_results,
            has_nested_columns=has_nested
        )


def build_multi_query_lineage_graph(
    parquet_metadatas: Dict[str, ParquetMetadata],
    lineage_results: List[LineageResult]
) -> MultiQueryLineageGraph:
    """Build a combined lineage graph from multiple SQL queries."""
    builder = MultiQueryLineageBuilder(parquet_metadatas, lineage_results)
    return builder.build()
