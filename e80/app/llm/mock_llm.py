import re
from typing import Optional, Tuple, List, Dict, Any, Set
from datetime import date
from dateutil.relativedelta import relativedelta

from ..models.schemas import LogicalPlan, SubQuery, FilterCondition, MergeSpec


TABLE_FIELDS = {
    "sales": {
        "product_id",
        "region",
        "amount",
        "quantity",
        "sale_date",
        "customer_id",
        "销售额",
        "销量",
        "销售金额",
        "销售数量",
    },
    "products": {
        "product_id",
        "product_name",
        "product_name_zh",
        "category",
        "price",
        "brand",
        "产品名称",
        "名称",
        "商品名",
        "品牌",
        "类别",
        "价格",
        "created_at",
    },
}

FIELD_ALIAS_MAP = {
    "销售额": "amount",
    "销售金额": "amount",
    "总金额": "amount",
    "销量": "quantity",
    "销售量": "quantity",
    "销售数量": "quantity",
    "产品名称": "product_name",
    "名称": "product_name",
    "商品名": "product_name",
    "品牌": "brand",
    "类别": "category",
    "价格": "price",
    "地区": "region",
    "区域": "region",
    "销售日期": "sale_date",
}

REGION_PATTERNS = {
    "上海": ["上海", "上海市", "shanghai"],
    "北京": ["北京", "北京市", "beijing"],
    "广州": ["广州", "广州市", "guangzhou"],
    "深圳": ["深圳", "深圳市", "shenzhen"],
    "杭州": ["杭州", "杭州市", "hangzhou"],
}

TIME_PATTERNS = {
    "上个月": ["上个月", "上月", "last month"],
    "这个月": ["这个月", "本月", "this month"],
    "去年": ["去年", "last year"],
    "今年": ["今年", "this year"],
}

METRIC_PATTERNS = {
    "销售额": ["销售额", "销售金额", "总金额", "amount"],
    "销量": ["销量", "销售量", "销售数量", "quantity"],
}

AGGREGATION_PATTERNS = {
    "max": ["最高", "最大", "最多", "top", "highest"],
    "min": ["最低", "最小", "最少", "lowest"],
    "sum": ["总和", "总计", "总", "total", "sum"],
    "avg": ["平均", "平均值", "average", "avg"],
}

INTENT_PATTERNS = {
    "top_product": ["什么产品", "哪个产品", "产品.*什么", "最高的产品", "最多的产品"],
    "sales_stats": ["销售额", "销售情况", "销量", "统计"],
    "product_detail": ["产品信息", "产品详情", "product detail"],
}

PRODUCT_FIELD_KEYWORDS = [
    "产品", "商品", "名称", "名字", "品牌", "category", "类别", "价格", "product", "品牌",
]


def _get_table_for_field(field_name: str) -> Optional[str]:
    field_lower = field_name.lower()
    for table, fields in TABLE_FIELDS.items():
        for f in fields:
            if field_lower == f.lower():
                return table
    return None


def _identify_involved_fields(question: str) -> Tuple[Set[str], Dict[str, str]]:
    involved_fields: Set[str] = set()
    field_table_map: Dict[str, str] = {}

    q_lower = question.lower()

    for table, fields in TABLE_FIELDS.items():
        for field in fields:
            if field.lower() in q_lower:
                involved_fields.add(field)
                field_table_map[field] = table

    for alias, actual_field in FIELD_ALIAS_MAP.items():
        if alias.lower() in q_lower:
            table = _get_table_for_field(actual_field)
            if table:
                involved_fields.add(actual_field)
                field_table_map[actual_field] = table

    if any(k in q_lower for k in PRODUCT_FIELD_KEYWORDS):
        for f in ["product_name", "category", "brand", "price"]:
            involved_fields.add(f)
            field_table_map[f] = "products"

    return involved_fields, field_table_map


def _extract_region(question: str) -> Optional[str]:
    q_lower = question.lower()
    for pattern, aliases in REGION_PATTERNS.items():
        for alias in aliases:
            if alias.lower() in q_lower:
                return pattern
    return None


def _extract_time_range(question: str) -> Optional[Tuple[date, date]]:
    q_lower = question.lower()
    today = date.today()

    if any(p in q_lower for p in TIME_PATTERNS["上个月"]):
        first_day = (today - relativedelta(months=1)).replace(day=1)
        last_day = today.replace(day=1) - relativedelta(days=1)
        return first_day, last_day

    if any(p in q_lower for p in TIME_PATTERNS["这个月"]):
        first_day = today.replace(day=1)
        last_day = today
        return first_day, last_day

    if any(p in q_lower for p in TIME_PATTERNS["去年"]):
        first_day = date(today.year - 1, 1, 1)
        last_day = date(today.year - 1, 12, 31)
        return first_day, last_day

    if any(p in q_lower for p in TIME_PATTERNS["今年"]):
        first_day = date(today.year, 1, 1)
        last_day = today
        return first_day, last_day

    return None


def _extract_metric(question: str) -> str:
    q_lower = question.lower()
    for pattern, aliases in METRIC_PATTERNS.items():
        for alias in aliases:
            if alias.lower() in q_lower:
                return pattern
    return "销售额"


def _extract_aggregation(question: str) -> str:
    q_lower = question.lower()
    for agg_type, patterns in AGGREGATION_PATTERNS.items():
        for p in patterns:
            if p.lower() in q_lower:
                return agg_type
    return "max"


def _extract_intent(question: str) -> str:
    q_lower = question.lower()
    for intent, patterns in INTENT_PATTERNS.items():
        for p in patterns:
            if re.search(p, q_lower):
                return intent
    return "sales_stats"


def _need_product_info(question: str) -> bool:
    return any(k in question.lower() for k in PRODUCT_FIELD_KEYWORDS)


def parse_natural_language(question: str) -> LogicalPlan:
    region = _extract_region(question)
    time_range = _extract_time_range(question)
    metric = _extract_metric(question)
    aggregation = _extract_aggregation(question)
    intent = _extract_intent(question)
    need_product = _need_product_info(question)

    involved_fields, field_table_map = _identify_involved_fields(question)

    involved_tables: Set[str] = set(field_table_map.values())
    if "amount" in field_table_map or "quantity" in field_table_map or "sale_date" in field_table_map or "region" in field_table_map:
        involved_tables.add("sales")
    if need_product or any(f in field_table_map for f in ["product_name", "category", "brand", "price"]):
        involved_tables.add("products")

    sales_filters: List[FilterCondition] = []
    sales_select = ["product_id"]

    if region:
        sales_filters.append(FilterCondition(field="region", operator="eq", value=region))
        field_table_map["region"] = "sales"

    if time_range:
        sales_filters.append(
            FilterCondition(
                field="sale_date",
                operator="between",
                value=[time_range[0].isoformat(), time_range[1].isoformat()],
            )
        )
        field_table_map["sale_date"] = "sales"

    amount_column = "amount" if metric == "销售额" else "quantity"
    agg_func = "SUM" if aggregation in ["sum", "avg"] else aggregation.upper()
    if aggregation == "avg":
        agg_func = "AVG"

    total_alias = f"total_{metric}"
    sales_select.append(f"{agg_func}({amount_column}) as {total_alias}")
    field_table_map[total_alias] = "sales"

    sales_subquery = SubQuery(
        query_id="sales_query",
        data_source="sqlite",
        table_name="sales",
        select_columns=sales_select,
        filters=sales_filters,
        group_by=["product_id"],
        order_by=[total_alias],
        order_desc=True,
        limit=1 if aggregation in ["max", "min"] else None,
        aggregations=[f"{agg_func}({amount_column})"],
        timeout_ms=3000,
    )

    sub_queries = [sales_subquery]
    output_columns = ["product_id", total_alias]

    if need_product or "products" in involved_tables:
        product_select = ["product_id"]
        if "product_name" in involved_fields or need_product:
            product_select.append("product_name")
        if "category" in involved_fields or need_product:
            product_select.append("category")
        if "brand" in involved_fields or need_product:
            product_select.append("brand")
        if "price" in involved_fields:
            product_select.append("price")

        if len(product_select) == 1:
            product_select = ["product_id", "product_name", "category", "brand", "price"]

        product_subquery = SubQuery(
            query_id="product_query",
            data_source="postgresql",
            table_name="products",
            select_columns=product_select,
            filters=[],
            timeout_ms=5000,
        )
        sub_queries.append(product_subquery)
        output_columns = [c for c in product_select if c != "product_id"]
        output_columns.insert(0, "product_id")
        output_columns.append(total_alias)

    return LogicalPlan(
        question=question,
        intent=intent,
        sub_queries=sub_queries,
        merge_spec=MergeSpec(join_key="product_id", merge_type="left", post_filters=[], hash_join=True),
        output_columns=output_columns,
        involved_tables=sorted(list(involved_tables)),
        field_table_mapping=field_table_map,
    )


class MockLLM:
    def __init__(self):
        pass

    def generate_plan(self, question: str) -> LogicalPlan:
        return parse_natural_language(question)
