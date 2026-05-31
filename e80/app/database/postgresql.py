from typing import List, Dict, Any, Optional
from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime
from sqlalchemy.orm import sessionmaker, declarative_base

from ..config import settings

Base = declarative_base()


class Product(Base):
    __tablename__ = "products"

    product_id = Column(String(50), primary_key=True)
    product_name = Column(String(200), nullable=False)
    category = Column(String(100), nullable=False, index=True)
    price = Column(Float, nullable=False)
    brand = Column(String(100), nullable=True)
    created_at = Column(DateTime, nullable=True)


_pg_engine = None
_PgSessionLocal = None
_mock_data: List[Dict[str, Any]] = []


def mock_pg_data() -> List[Dict[str, Any]]:
    global _mock_data
    if not _mock_data:
        _mock_data = [
            {"product_id": "P001", "product_name": "iPhone 15 Pro", "category": "手机", "price": 7999.0, "brand": "Apple"},
            {"product_id": "P002", "product_name": "MacBook Pro 14", "category": "电脑", "price": 14999.0, "brand": "Apple"},
            {"product_id": "P003", "product_name": "AirPods Pro", "category": "耳机", "price": 1899.0, "brand": "Apple"},
            {"product_id": "P004", "product_name": "华为 Mate 60", "category": "手机", "price": 5999.0, "brand": "华为"},
            {"product_id": "P005", "product_name": "小米14 Ultra", "category": "手机", "price": 6499.0, "brand": "小米"},
            {"product_id": "P006", "product_name": "iPad Air", "category": "平板", "price": 4799.0, "brand": "Apple"},
            {"product_id": "P007", "product_name": "索尼 WH-1000XM5", "category": "耳机", "price": 2699.0, "brand": "索尼"},
            {"product_id": "P008", "product_name": "戴尔 XPS 13", "category": "电脑", "price": 9999.0, "brand": "戴尔"},
            {"product_id": "P009", "product_name": "联想 ThinkPad X1", "category": "电脑", "price": 12999.0, "brand": "联想"},
            {"product_id": "P010", "product_name": "三星 Galaxy S24", "category": "手机", "price": 6999.0, "brand": "三星"},
        ]
    return _mock_data


def get_pg_engine():
    global _pg_engine
    if _pg_engine is None and not settings.use_mock_pg:
        _pg_engine = create_engine(
            f"postgresql+psycopg2://{settings.pg_user}:{settings.pg_password}"
            f"@{settings.pg_host}:{settings.pg_port}/{settings.pg_db}"
        )
    return _pg_engine


def get_pg_session():
    global _PgSessionLocal
    if _PgSessionLocal is None and not settings.use_mock_pg:
        _PgSessionLocal = sessionmaker(
            autocommit=False, autoflush=False, bind=get_pg_engine()
        )
    return _PgSessionLocal() if _PgSessionLocal else None


def init_pg_db():
    if not settings.use_mock_pg:
        engine = get_pg_engine()
        Base.metadata.create_all(bind=engine)
        return engine
    return None


def query_products_mock(
    product_ids: Optional[List[str]] = None,
    category: Optional[str] = None,
    columns: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    data = mock_pg_data()
    results = []

    for item in data:
        if product_ids and item["product_id"] not in product_ids:
            continue
        if category and item.get("category") != category:
            continue

        if columns:
            filtered = {k: v for k, v in item.items() if k in columns}
            results.append(filtered)
        else:
            results.append(item.copy())

    return results
