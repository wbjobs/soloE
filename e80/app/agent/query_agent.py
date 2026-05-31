import time
from typing import Dict, Any, Optional, Tuple

from langchain_core.runnables import RunnableLambda, RunnableSequence
from langchain_core.output_parsers import BaseOutputParser

from ..llm.mock_llm import MockLLM
from ..executor.query_executor import FederatedQueryExecutor
from ..models.schemas import LogicalPlan, QueryResponse
from ..cache.query_cache import get_cache, QueryCache


class LogicalPlanOutputParser(BaseOutputParser[LogicalPlan]):
    @property
    def _type(self) -> str:
        return "logical_plan_output_parser"

    def parse(self, text: str) -> LogicalPlan:
        return text


class QueryAgent:
    def __init__(self, timeout_ms: Optional[int] = None, use_cache: bool = True):
        self.llm = MockLLM()
        self.executor = FederatedQueryExecutor(default_timeout_ms=timeout_ms or 5000)
        self.cache: Optional[QueryCache] = get_cache() if use_cache else None
        self.chain = self._build_chain()

    def _build_chain(self) -> RunnableSequence:
        parse_step = RunnableLambda(self._parse_question)
        execute_step = RunnableLambda(self._execute_plan)
        return parse_step | execute_step

    def _parse_question(self, context: Dict[str, Any]) -> Dict[str, Any]:
        question = context["question"]
        logical_plan = self.llm.generate_plan(question)
        return {
            "question": question,
            "logical_plan": logical_plan,
            "timeout_ms": context.get("timeout_ms"),
            "bypass_cache": context.get("bypass_cache", False),
        }

    def _execute_plan(self, context: Dict[str, Any]) -> QueryResponse:
        start_time = time.time()
        logical_plan: LogicalPlan = context["logical_plan"]
        question = context["question"]
        timeout_ms = context.get("timeout_ms", 5000)

        sub_results, final_result, warnings = self.executor.execute(logical_plan)

        execution_time_ms = (time.time() - start_time) * 1000

        return QueryResponse(
            question=question,
            logical_plan=logical_plan,
            sub_query_results=sub_results,
            final_result=final_result,
            execution_time_ms=round(execution_time_ms, 2),
            warnings=warnings,
        )

    def process(self, question: str, timeout_ms: Optional[int] = None, bypass_cache: bool = False) -> Tuple[QueryResponse, bool]:
        if self.cache and not bypass_cache:
            cached = self.cache.get(question)
            if cached is not None:
                return cached, True

        context = {"question": question, "timeout_ms": timeout_ms, "bypass_cache": bypass_cache}
        response = self.chain.invoke(context)

        if self.cache and not bypass_cache:
            self.cache.set(question, response)

        return response, False

    def explain(self, question: str, timeout_ms: Optional[int] = None) -> Dict[str, Any]:
        start_time = time.time()
        logical_plan = self.llm.generate_plan(question)

        parse_time_ms = (time.time() - start_time) * 1000

        exec_start = time.time()
        sub_results, final_result, warnings = self.executor.execute(logical_plan)
        exec_time_ms = (time.time() - exec_start) * 1000

        total_time_ms = (time.time() - start_time) * 1000

        sub_queries_detail = []
        for sq in logical_plan.sub_queries:
            sq_result = sub_results.get(sq.query_id, [])
            sub_queries_detail.append({
                "query_id": sq.query_id,
                "data_source": sq.data_source,
                "table_name": sq.table_name,
                "select_columns": sq.select_columns,
                "filters": [f.model_dump() for f in sq.filters],
                "group_by": sq.group_by,
                "order_by": sq.order_by,
                "limit": sq.limit,
                "timeout_ms": sq.timeout_ms,
                "row_count": len(sq_result),
            })

        return {
            "question": question,
            "intent": logical_plan.intent,
            "involved_tables": logical_plan.involved_tables,
            "field_table_mapping": logical_plan.field_table_mapping,
            "parse_time_ms": round(parse_time_ms, 2),
            "execution_time_ms": round(exec_time_ms, 2),
            "total_time_ms": round(total_time_ms, 2),
            "sub_queries": sub_queries_detail,
            "merge_spec": {
                "join_key": logical_plan.merge_spec.join_key,
                "merge_type": logical_plan.merge_spec.merge_type,
                "hash_join": logical_plan.merge_spec.hash_join,
            },
            "output_columns": logical_plan.output_columns,
            "result_row_count": len(final_result),
            "sample_results": final_result[:3],
            "warnings": warnings,
        }

    def shutdown(self):
        self.executor.shutdown()


def process_question(question: str, timeout_ms: Optional[int] = None, bypass_cache: bool = False) -> Tuple[QueryResponse, bool]:
    agent = QueryAgent(timeout_ms=timeout_ms, use_cache=True)
    try:
        return agent.process(question, timeout_ms=timeout_ms, bypass_cache=bypass_cache)
    finally:
        agent.shutdown()


def explain_question(question: str, timeout_ms: Optional[int] = None) -> Dict[str, Any]:
    agent = QueryAgent(timeout_ms=timeout_ms, use_cache=False)
    try:
        return agent.explain(question, timeout_ms=timeout_ms)
    finally:
        agent.shutdown()
