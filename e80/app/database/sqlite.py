import os
from sqlalchemy import create_engine, Column, Integer, String, Float, Date
from sqlalchemy.orm import sessionmaker, declarative_base

from ..config import settings

Base = declarative_base()


class Sale(Base):
    __tablename__ = "sales"

    id = Column(Integer, primary_key=True, autoincrement=True)
    product_id = Column(String(50), nullable=False, index=True)
    region = Column(String(50), nullable=False, index=True)
    amount = Column(Float, nullable=False)
    quantity = Column(Integer, nullable=False)
    sale_date = Column(Date, nullable=False, index=True)
    customer_id = Column(String(50), nullable=True)


_sqlite_engine = None
_SqliteSessionLocal = None


def get_sqlite_engine():
    global _sqlite_engine
    if _sqlite_engine is None:
        db_dir = os.path.dirname(settings.sqlite_db_path)
        if db_dir and not os.path.exists(db_dir):
            os.makedirs(db_dir, exist_ok=True)
        _sqlite_engine = create_engine(
            f"sqlite:///{settings.sqlite_db_path}",
            connect_args={"check_same_thread": False},
        )
    return _sqlite_engine


def get_sqlite_session():
    global _SqliteSessionLocal
    if _SqliteSessionLocal is None:
        _SqliteSessionLocal = sessionmaker(
            autocommit=False, autoflush=False, bind=get_sqlite_engine()
        )
    return _SqliteSessionLocal()


def init_sqlite_db():
    engine = get_sqlite_engine()
    Base.metadata.create_all(bind=engine)
    return engine
