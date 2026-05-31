import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.cache.query_cache import mock_embedding_similarity, get_cache, QueryCache
from app.agent.query_agent import process_question, explain_question


def test_similarity_calculation():
    print("=" * 60)
    print("Testing Semantic Similarity Calculation")
    print("=" * 60)

    test_pairs = [
        ("上海地区上个月销售额最高的产品是什么？", "上海上月销售额最高的产品是啥？"),
        ("上海地区上个月销售额最高的产品是什么？", "北京地区上个月销售额最高的产品是什么？"),
        ("上海地区上个月销售额最高的产品是什么？", "上海地区上个月销售额最高的产品是什么？"),
        ("今年销售额总和是多少？", "今年的总销售额是多少？"),
        ("苹果品牌的产品在上海的销售情况", "上海地区苹果产品的销售数据"),
    ]

    for q1, q2 in test_pairs:
        sim = mock_embedding_similarity(q1, q2)
        status = "✓ 相似 (>0.95)" if sim >= 0.95 else "✗ 不相似"
        print(f"\nQ1: {q1}")
        print(f"Q2: {q2}")
        print(f"  相似度: {sim:.2%} {status}")


def test_cache_basic():
    print("\n" + "=" * 60)
    print("Testing Cache Basic Operations")
    print("=" * 60)

    cache = get_cache()
    cache.clear()

    question = "上海地区上个月销售额最高的产品是什么？"

    print("\n第一次查询（应该缓存未命中）:")
    response1, from_cache1 = process_question(question)
    print(f"  来自缓存: {from_cache1}")
    print(f"  结果行数: {len(response1.final_result)}")
    print(f"  警告: {response1.warnings}")

    stats = cache.stats()
    print(f"  缓存统计: {stats}")

    print("\n第二次查询（应该缓存命中）:")
    response2, from_cache2 = process_question(question)
    print(f"  来自缓存: {from_cache2}")
    print(f"  结果行数: {len(response2.final_result)}")
    print(f"  警告: {response2.warnings}")

    stats = cache.stats()
    print(f"  缓存统计: {stats}")

    print("\n语义相似查询:")
    similar_question = "上海上月销售额最高的产品是啥？"
    sim = mock_embedding_similarity(question, similar_question)
    print(f"  问题: {similar_question}")
    print(f"  与原问题相似度: {sim:.2%}")
    response3, from_cache3 = process_question(similar_question)
    print(f"  来自缓存: {from_cache3}")
    print(f"  结果行数: {len(response3.final_result)}")
    print(f"  警告: {response3.warnings}")

    stats = cache.stats()
    print(f"  缓存统计: {stats}")

    cache.clear()


def test_explain_interface():
    print("\n" + "=" * 60)
    print("Testing Explain Interface")
    print("=" * 60)

    test_cases = [
        "上海地区上个月销售额最高的产品是什么？",
        "今年销售额总和是多少？",
    ]

    for question in test_cases:
        print(f"\nQuestion: {question}")
        try:
            explanation = explain_question(question)
            print(f"  Intent: {explanation['intent']}")
            print(f"  涉及表: {explanation['involved_tables']}")
            print(f"  解析耗时: {explanation['parse_time_ms']}ms")
            print(f"  执行耗时: {explanation['execution_time_ms']}ms")
            print(f"  总耗时: {explanation['total_time_ms']}ms")
            print(f"  子查询 ({len(explanation['sub_queries'])}):")
            for sq in explanation['sub_queries']:
                print(f"    - {sq['query_id']} ({sq['table_name']}@{sq['data_source']})")
                print(f"      选择列: {sq['select_columns']}")
                print(f"      结果行数: {sq['row_count']}")
                if sq['filters']:
                    print(f"      过滤条件: {sq['filters']}")
            print(f"  结果行数: {explanation['result_row_count']}")
            if explanation['sample_results']:
                print(f"  示例结果:")
                for row in explanation['sample_results']:
                    print(f"    {row}")
        except Exception as e:
            print(f"  Error: {e}")


def test_bypass_cache():
    print("\n" + "=" * 60)
    print("Testing Bypass Cache")
    print("=" * 60)

    cache = get_cache()
    cache.clear()

    question = "上海地区上个月销售额最高的产品是什么？"

    print("\n第一次查询（写入缓存）:")
    response1, from_cache1 = process_question(question)
    print(f"  来自缓存: {from_cache1}")

    print("\n第二次查询（绕过缓存）:")
    response2, from_cache2 = process_question(question, bypass_cache=True)
    print(f"  来自缓存: {from_cache2}")

    print("\n第三次查询（使用缓存）:")
    response3, from_cache3 = process_question(question)
    print(f"  来自缓存: {from_cache3}")

    stats = cache.stats()
    print(f"  缓存统计: {stats}")

    cache.clear()


if __name__ == "__main__":
    test_similarity_calculation()
    test_cache_basic()
    test_explain_interface()
    test_bypass_cache()
    print("\n" + "=" * 60)
    print("All cache and explain tests completed!")
    print("=" * 60)
