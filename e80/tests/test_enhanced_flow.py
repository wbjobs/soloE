import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.llm.mock_llm import parse_natural_language
from app.agent.query_agent import process_question
from app.executor.query_executor import validate_identifier, validate_operator, validate_value, SQLInjectionError


def test_field_table_mapping():
    print("=" * 60)
    print("Testing Field-Table Mapping")
    print("=" * 60)

    test_cases = [
        "上海地区上个月销售额最高的产品是什么？",
        "北京地区本月销量最多的商品是哪个？",
        "今年销售额总和是多少？",
        "苹果品牌的产品在上海的销售情况",
        "查询所有电脑类别的销售数据",
    ]

    for question in test_cases:
        print(f"\nQuestion: {question}")
        plan = parse_natural_language(question)
        print(f"  Intent: {plan.intent}")
        print(f"  Involved tables: {plan.involved_tables}")
        print(f"  Field-table mapping:")
        for field, table in sorted(plan.field_table_mapping.items()):
            print(f"    {field} -> {table}")
        print(f"  Sub-queries: {len(plan.sub_queries)}")
        for sq in plan.sub_queries:
            print(f"    - {sq.query_id} ({sq.table_name}@{sq.data_source})")
            print(f"      Select: {sq.select_columns}")
            if sq.filters:
                print(f"      Filters: {[(f.field, f.operator, f.value) for f in sq.filters]}")


def test_sql_injection_protection():
    print("\n" + "=" * 60)
    print("Testing SQL Injection Protection")
    print("=" * 60)

    valid_identifiers = ["product_id", "region", "amount", "sale_date", "total_sales"]
    invalid_identifiers = [
        "product_id; DROP TABLE sales",
        "user' OR '1'='1",
        "SELECT * FROM",
        "",
        "123invalid",
    ]

    print("\nValid identifiers:")
    for ident in valid_identifiers:
        try:
            result = validate_identifier(ident)
            print(f"  ✓ '{ident}' -> '{result}'")
        except SQLInjectionError as e:
            print(f"  ✗ '{ident}' should be valid but failed: {e}")

    print("\nInvalid identifiers:")
    for ident in invalid_identifiers:
        try:
            validate_identifier(ident)
            print(f"  ✗ '{ident}' should be rejected but passed")
        except SQLInjectionError as e:
            print(f"  ✓ '{ident}' rejected: {e}")

    print("\nValid operators:")
    for op in ["eq", "gte", "lte", "between", "in"]:
        try:
            result = validate_operator(op)
            print(f"  ✓ '{op}' -> '{result}'")
        except SQLInjectionError as e:
            print(f"  ✗ '{op}' should be valid but failed: {e}")

    print("\nInvalid operators:")
    for op in ["drop", "delete", "exec", ""]:
        try:
            validate_operator(op)
            print(f"  ✗ '{op}' should be rejected but passed")
        except SQLInjectionError as e:
            print(f"  ✓ '{op}' rejected: {e}")

    print("\nValue validation:")
    valid_values = ["上海", "2024-01-01", 100, ["P001", "P002"]]
    invalid_values = ["上海'; DROP TABLE sales--", "test' OR '1'='1"]

    for val in valid_values:
        try:
            result = validate_value(val)
            print(f"  ✓ {repr(val)} -> OK")
        except SQLInjectionError as e:
            print(f"  ✗ {repr(val)} should be valid but failed: {e}")

    for val in invalid_values:
        try:
            validate_value(val)
            print(f"  ✗ {repr(val)} should be rejected but passed")
        except SQLInjectionError as e:
            print(f"  ✓ {repr(val)} rejected: {e}")


def test_hash_join_and_warnings():
    print("\n" + "=" * 60)
    print("Testing Hash Join and Warnings")
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
            print(f"  Merge type: {response.logical_plan.merge_spec.merge_type}")
            print(f"  Hash join: {response.logical_plan.merge_spec.hash_join}")
            print(f"  Warnings ({len(response.warnings)}):")
            for w in response.warnings:
                print(f"    ⚠ {w}")
            print(f"  Sub-query results:")
            for qid, results in response.sub_query_results.items():
                print(f"    {qid}: {len(results)} rows")
            print(f"  Final result ({len(response.final_result)} rows):")
            for row in response.final_result[:3]:
                print(f"    {row}")
        except Exception as e:
            print(f"  Error: {e}")


def test_timeout_config():
    print("\n" + "=" * 60)
    print("Testing Timeout Configuration")
    print("=" * 60)

    question = "上海地区上个月销售额最高的产品是什么？"

    for timeout in [1000, 3000, 5000]:
        print(f"\nTesting with {timeout}ms timeout:")
        try:
            response = process_question(question, timeout_ms=timeout)
            print(f"  ✓ Success in {response.execution_time_ms}ms")
            if response.warnings:
                print(f"    Warnings: {response.warnings}")
        except Exception as e:
            print(f"  ✗ Error: {e}")


if __name__ == "__main__":
    test_field_table_mapping()
    test_sql_injection_protection()
    test_hash_join_and_warnings()
    test_timeout_config()
    print("\n" + "=" * 60)
    print("All enhanced tests completed!")
    print("=" * 60)
