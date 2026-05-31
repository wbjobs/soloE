from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field


class FilterCondition(BaseModel):
    field: str
    operator: str
    value: Any


class SubQuery(BaseModel):
    query_id: str
    data_source: str
    table_name: str
    select_columns: List[str]
    filters: List[FilterCondition] = Field(default_factory=list)
    group_by: Optional[List[str]] = None
    order_by: Optional[List[str]] = None
    order_desc: bool = True
    limit: Optional[int] = None
    aggregations: Optional[List[str]] = None
    timeout_ms: Optional[int] = None


class MergeSpec(BaseModel):
    join_key: str
    merge_type: str = "inner"
    post_filters: List[FilterCondition] = Field(default_factory=list)
    hash_join: bool = True


class LogicalPlan(BaseModel):
    question: str
    intent: str
    sub_queries: List[SubQuery]
    merge_spec: MergeSpec
    output_columns: List[str]
    involved_tables: List[str] = Field(default_factory=list)
    field_table_mapping: Dict[str, str] = Field(default_factory=dict)


class QueryRequest(BaseModel):
    question: str
    timeout_ms: Optional[int] = 5000
    bypass_cache: bool = False


class QueryResponse(BaseModel):
    question: str
    logical_plan: LogicalPlan
    sub_query_results: Dict[str, List[Dict[str, Any]]]
    final_result: List[Dict[str, Any]]
    execution_time_ms: float
    warnings: List[str] = Field(default_factory=list)
