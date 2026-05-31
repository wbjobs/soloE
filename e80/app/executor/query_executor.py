import re
import threading
from typing import List, Dict, Any, Tuple, Optional
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError

from sqlalchemy import text as sql_text
from sqlalchemy.exc import SQLAlchemyError

from ..models.schemas import LogicalPlan, SubQuery, FilterCondition
from ..database.sqlite import get_sqlite_session
from ..database.postgresql import get_pg_session, query_products_mock
from ..config import settings


SQL_KEYWORDS = {
    "SELECT", "INSERT", "UPDATE", "DELETE", "DROP", "CREATE", "ALTER", "TRUNCATE",
    "UNION", "JOIN", "FROM", "WHERE", "GROUP", "ORDER", "HAVING", "LIMIT", "EXEC",
    "EXECUTE", "SP_", "XP_", "--", "/*", "*/", ";", "UNION ALL", "CROSS JOIN",
}

ALLOWED_OPERATORS = {"eq", "gte", "lte", "gt", "lt", "between", "in", "like"}


class SQLInjectionError(Exception):
    pass


class QueryTimeoutError(Exception):
    pass


def validate_identifier(name: str) -> str:
    if not name:
        raise SQLInjectionError("Empty identifier")

    if not re.match(r"^[a-zA-Z_\u4e00-\u9fa5][a-zA-Z0-9_\u4e00-\u9fa5]*$", name):
        raise SQLInjectionError(f"Invalid identifier: {name}")

    if name.upper() in SQL_KEYWORDS:
        raise SQLInjectionError(f"Identifier cannot be SQL keyword: {name}")

    return name


def validate_operator(operator: str) -> str:
    if operator not in ALLOWED_OPERATORS:
        raise SQLInjectionError(f"Invalid operator: {operator}")
    return operator


def validate_value(value: Any) -> Any:
    if isinstance(value, str):
        for keyword in SQL_KEYWORDS:
            if keyword in value.upper():
                raise SQLInjectionError(f"Potential SQL injection detected in value: {value}")
        if ";" in value or "--" in value or "/*" in value or "*/" in value:
            raise SQLInjectionError(f"Potential SQL injection detected in value: {value}")
        if value.count("'") > 1 or value.count('"') > 1:
            if "OR" in value.upper() or "AND" in value.upper():
                raise SQLInjectionError(f"Potential SQL injection detected in value: {value}")
    elif isinstance(value, list):
        for item in value:
            validate_value(item)
    return value


class FederatedQueryExecutor:
    def __init__(self, default_timeout_ms: int = 5000):
        self.sqlite_session_factory = get_sqlite_session
        self.pg_session_factory = get_pg_session
        self.default_timeout_ms = default_timeout_ms
        self._thread_pool = ThreadPoolExecutor(max_workers=4)

    def execute(self, plan: LogicalPlan) -> Tuple[Dict[str, List[Dict[str, Any]]], List[Dict[str, Any]], List[str]]:
        sub_results: Dict[str, List[Dict[str, Any]]] = {}
        warnings: List[str] = []

        futures = {}
        for sub_query in plan.sub_queries:
            future = self._thread_pool.submit(self._execute_subquery_safe, sub_query)
            futures[sub_query.query_id] = (future, sub_query)

        for query_id, (future, sub_query) in futures.items():
            timeout_ms = sub_query.timeout_ms or self.default_timeout_ms
            timeout_s = timeout_ms / 1000.0

            try:
                result = future.result(timeout=timeout_s)
                sub_results[query_id] = result
            except FutureTimeoutError:
                if sub_query.data_source == "postgresql":
                    warnings.append(
                        f"远程数据库查询超时 ({timeout_ms}ms)，已降级返回本地结果。"
                        f"查询: {sub_query.query_id}"
                    )
                    sub_results[query_id] = self._get_pg_fallback_result(sub_query)
                else:
                    warnings.append(f"本地查询超时: {sub_query.query_id}")
                    sub_results[query_id] = []
            except Exception as e:
                if sub_query.data_source == "postgresql":
                    warnings.append(
                        f"远程数据库查询失败: {str(e)}，已降级返回本地结果。"
                        f"查询: {sub_query.query_id}"
                    )
                    sub_results[query_id] = self._get_pg_fallback_result(sub_query)
                else:
                    warnings.append(f"查询执行失败: {sub_query.query_id}, 错误: {str(e)}")
                    sub_results[query_id] = []

        if plan.merge_spec.hash_join:
            final_result = self._hash_join_merge(plan, sub_results, warnings)
        else:
            final_result = self._nested_loop_merge(plan, sub_results, warnings)

        return sub_results, final_result, warnings

    def _execute_subquery_safe(self, sub_query: SubQuery) -> List[Dict[str, Any]]:
        try:
            if sub_query.data_source == "sqlite":
                return self._execute_sqlite(sub_query)
            elif sub_query.data_source == "postgresql":
                return self._execute_postgresql(sub_query)
            else:
                raise ValueError(f"Unknown data source: {sub_query.data_source}")
        except SQLInjectionError:
            raise
        except Exception as e:
            raise

    def _build_safe_sql(self, sub_query: SubQuery) -> Tuple[str, Dict[str, Any]]:
        validated_select = []
        for col in sub_query.select_columns:
            col_stripped = col.strip()
            match = re.match(
                r"^([A-Z]+)\(([a-zA-Z_][a-zA-Z0-9_]*)\)\s+(?:AS\s+)?([a-zA-Z_\u4e00-\u9fa5][a-zA-Z0-9_\u4e00-\u9fa5]*)$",
                col_stripped,
                re.IGNORECASE,
            )
            if match:
                agg_func = validate_identifier(match.group(1))
                inner_col = validate_identifier(match.group(2))
                alias = match.group(3)
                validated_select.append(f"{agg_func}({inner_col}) AS {alias}")
            else:
                simple_match = re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", col_stripped)
                if simple_match:
                    validated_select.append(validate_identifier(col_stripped))
                else:
                    raise SQLInjectionError(f"Invalid column expression: {col}")

        select_clause = ", ".join(validated_select)
        from_clause = validate_identifier(sub_query.table_name)

        where_conditions = []
        params: Dict[str, Any] = {}

        for i, f in enumerate(sub_query.filters):
            field = validate_identifier(f.field)
            operator = validate_operator(f.operator)
            value = validate_value(f.value)

            param_name = f"p_{i}"

            if operator == "between" and isinstance(value, list) and len(value) == 2:
                where_conditions.append(f"{field} BETWEEN :{param_name}_start AND :{param_name}_end")
                params[f"{param_name}_start"] = value[0]
                params[f"{param_name}_end"] = value[1]
            elif operator == "in" and isinstance(value, list):
                placeholders = []
                for j, v in enumerate(value):
                    placeholder = f"{param_name}_{j}"
                    placeholders.append(f":{placeholder}")
                    params[placeholder] = v
                where_conditions.append(f"{field} IN ({', '.join(placeholders)})")
            elif operator == "like":
                where_conditions.append(f"{field} LIKE :{param_name}")
                params[param_name] = value
            else:
                op_map = {
                    "eq": "=",
                    "gte": ">=",
                    "lte": "<=",
                    "gt": ">",
                    "lt": "<",
                }
                sql_op = op_map.get(operator, "=")
                where_conditions.append(f"{field} {sql_op} :{param_name}")
                params[param_name] = value

        sql = f"SELECT {select_clause} FROM {from_clause}"

        if where_conditions:
            sql += " WHERE " + " AND ".join(where_conditions)

        if sub_query.group_by:
            validated_group = [validate_identifier(g) for g in sub_query.group_by]
            sql += " GROUP BY " + ", ".join(validated_group)

        if sub_query.order_by:
            validated_order = [validate_identifier(o) for o in sub_query.order_by]
            order_dir = "DESC" if sub_query.order_desc else "ASC"
            sql += " ORDER BY " + ", ".join([f"{o} {order_dir}" for o in validated_order])

        if sub_query.limit:
            if not isinstance(sub_query.limit, int) or sub_query.limit < 0:
                raise SQLInjectionError(f"Invalid limit value: {sub_query.limit}")
            sql += f" LIMIT {sub_query.limit}"

        return sql, params

    def _execute_sqlite(self, sub_query: SubQuery) -> List[Dict[str, Any]]:
        sql, params = self._build_safe_sql(sub_query)
        session = self.sqlite_session_factory()

        try:
            result = session.execute(sql_text(sql), params)
            rows = result.fetchall()
            columns = result.keys()
            return [dict(zip(columns, row)) for row in rows]
        except SQLAlchemyError as e:
            raise RuntimeError(f"SQLite query failed: {str(e)}")
        finally:
            session.close()

    def _execute_postgresql(self, sub_query: SubQuery) -> List[Dict[str, Any]]:
        if settings.use_mock_pg:
            return self._execute_pg_mock(sub_query)

        sql, params = self._build_safe_sql(sub_query)
        session = self.pg_session_factory()
        if session is None:
            return self._get_pg_fallback_result(sub_query)

        try:
            result = session.execute(sql_text(sql), params)
            rows = result.fetchall()
            columns = result.keys()
            return [dict(zip(columns, row)) for row in rows]
        except SQLAlchemyError as e:
            raise RuntimeError(f"PostgreSQL query failed: {str(e)}")
        finally:
            session.close()

    def _execute_pg_mock(self, sub_query: SubQuery) -> List[Dict[str, Any]]:
        product_ids = None
        category = None
        columns = None

        for f in sub_query.filters:
            if f.field == "product_id":
                if f.operator == "eq":
                    product_ids = [f.value]
                elif f.operator == "in":
                    product_ids = f.value
            elif f.field == "category" and f.operator == "eq":
                category = f.value

        if sub_query.select_columns and "*" not in ", ".join(sub_query.select_columns):
            columns = []
            for c in sub_query.select_columns:
                match = re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", c)
                if match:
                    columns.append(c)

        results = query_products_mock(product_ids=product_ids, category=category, columns=columns)

        if sub_query.limit:
            results = results[: sub_query.limit]

        return results

    def _get_pg_fallback_result(self, sub_query: SubQuery) -> List[Dict[str, Any]]:
        return self._execute_pg_mock(sub_query)

    def _hash_join_merge(
        self,
        plan: LogicalPlan,
        sub_results: Dict[str, List[Dict[str, Any]]],
        warnings: List[str],
    ) -> List[Dict[str, Any]]:
        if len(sub_results) == 1:
            return self._project_columns(list(sub_results.values())[0], plan.output_columns)

        result_lists = list(sub_results.values())
        join_key = plan.merge_spec.join_key
        merge_type = plan.merge_spec.merge_type

        if len(result_lists) != 2:
            warnings.append(f"Expected 2 sub-query results for join, got {len(result_lists)}")
            return []

        build_input, probe_input = result_lists[0], result_lists[1]

        if len(build_input) > len(probe_input):
            build_input, probe_input = probe_input, build_input

        hash_table: Dict[Any, List[Dict[str, Any]]] = {}
        for row in build_input:
            key = row.get(join_key)
            if key is not None:
                if key not in hash_table:
                    hash_table[key] = []
                hash_table[key].append(row)

        merged: List[Dict[str, Any]] = []
        matched_build_keys = set()

        for probe_row in probe_input:
            probe_key = probe_row.get(join_key)

            if probe_key in hash_table:
                matched_build_keys.add(probe_key)
                for build_row in hash_table[probe_key]:
                    merged_row = {**build_row, **probe_row}
                    merged.append(merged_row)
            elif merge_type in ["left", "right"]:
                if merge_type == "right":
                    merged.append({**probe_row})

        if merge_type == "left":
            for build_row in build_input:
                build_key = build_row.get(join_key)
                if build_key not in matched_build_keys:
                    merged.append({**build_row})

        if plan.merge_spec.post_filters:
            merged = self._apply_filters(merged, plan.merge_spec.post_filters)

        if plan.output_columns:
            merged = self._project_columns(merged, plan.output_columns)

        return merged

    def _nested_loop_merge(
        self,
        plan: LogicalPlan,
        sub_results: Dict[str, List[Dict[str, Any]]],
        warnings: List[str],
    ) -> List[Dict[str, Any]]:
        if len(sub_results) == 1:
            return list(sub_results.values())[0]

        result_lists = list(sub_results.values())
        join_key = plan.merge_spec.join_key
        merge_type = plan.merge_spec.merge_type

        if len(result_lists) != 2:
            warnings.append(f"Expected 2 sub-query results for join, got {len(result_lists)}")
            return []

        left_data, right_data = result_lists[0], result_lists[1]

        right_index: Dict[Any, Dict[str, Any]] = {}
        for row in right_data:
            if join_key in row:
                right_index[row[join_key]] = row

        merged: List[Dict[str, Any]] = []

        for left_row in left_data:
            left_key = left_row.get(join_key)
            if left_key in right_index:
                merged_row = {**left_row, **right_index[left_key]}
                merged.append(merged_row)
            elif merge_type == "left":
                merged.append({**left_row})

        if merge_type == "right":
            for right_row in right_data:
                right_key = right_row.get(join_key)
                found = any(m.get(join_key) == right_key for m in merged)
                if not found:
                    merged.append({**right_row})

        if plan.merge_spec.post_filters:
            merged = self._apply_filters(merged, plan.merge_spec.post_filters)

        if plan.output_columns:
            merged = self._project_columns(merged, plan.output_columns)

        return merged

    def _apply_filters(self, data: List[Dict[str, Any]], filters: List[FilterCondition]) -> List[Dict[str, Any]]:
        result = []
        for row in data:
            match = True
            for f in filters:
                val = row.get(f.field)
                if f.operator == "eq" and val != f.value:
                    match = False
                elif f.operator == "gte" and (val is None or val < f.value):
                    match = False
                elif f.operator == "lte" and (val is None or val > f.value):
                    match = False
                if not match:
                    break
            if match:
                result.append(row)
        return result

    def _project_columns(self, data: List[Dict[str, Any]], columns: List[str]) -> List[Dict[str, Any]]:
        result = []
        for row in data:
            projected = {}
            for col in columns:
                if col in row:
                    projected[col] = row[col]
                else:
                    for key in row:
                        if re.match(rf".*{col}$", key, re.IGNORECASE):
                            projected[col] = row[key]
                            break
            result.append(projected)
        return result

    def shutdown(self):
        self._thread_pool.shutdown(wait=True)


def execute_plan(plan: LogicalPlan, timeout_ms: Optional[int] = None) -> Tuple[Dict[str, List[Dict[str, Any]]], List[Dict[str, Any]], List[str]]:
    executor = FederatedQueryExecutor(default_timeout_ms=timeout_ms or 5000)
    try:
        return executor.execute(plan)
    finally:
        executor.shutdown()
