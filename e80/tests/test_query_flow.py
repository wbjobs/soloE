import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.llm.mock_llm import parse_natural_language
from app.agent.query_agent import process_question


def test_llm_parsing():
    print("=" * 60)
    print("Testing Mock LLM Parsing")
    print("=" * 60)

    test_cases = [
        "上海地区上个月销售额最高的产品是什么？",
        "北京地区本月销量最多的商品是哪个？",
        "今年销售额总和是多少？",
        "去年广州地区的销售情况",
    ]

    for question in test_cases:
        print(f"\nQuestion: {question}")
        plan = parse_natural_language(question)
        print(f"  Intent: {plan.intent}")
        print(f"  Sub-queries: {len(plan.sub_queries)}")
        for sq in plan.sub_queries:
            print(f"    - {sq.query_id} ({sq.data_source}): {sq.select_columns}")
            if sq.filters:
                print(f"      Filters: {[(f.field, f.operator, f.value) for f in sq.filters]}")
        print(f"  Output columns: {plan.output_columns}")


def test_full_query_flow():
    print("\n" + "=" * 60)
    print("Testing Full Query Flow")
    print("=" * 60)

    questions = [
        "上海地区上个月销售额最高的产品是什么？",
        "北京地区本月销量最多的产品是什么？",
    ]

    for question in questions:
        print(f"\nQuestion: {question}")
        try:
            response = process_question(question)
            print(f"  Execution time: {response.execution_time_ms}ms")
            print(f"  Sub-query results:")
            for qid, results in response.sub_query_results.items():
                print(f"    {qid}: {len(results)} rows")
            print(f"  Final result ({len(response.final_result)} rows):")
            for row in response.final_result[:5]:
                print(f"    {row}")
        except Exception as e:
            print(f"  Error: {e}")


if __name__ == "__main__":
    test_llm_parsing()
    test_full_query_flow()
    print("\n" + "=" * 60)
    print("All tests completed!")
    print("=" * 60)
