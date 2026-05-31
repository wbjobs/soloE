from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from sqlalchemy import Column, Integer, String, DateTime, Text, JSON

from config import settings

Base = declarative_base()

engine = create_async_engine(settings.DATABASE_URL, echo=False)
async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Meeting(Base):
    __tablename__ = "meetings"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String(255), nullable=False)
    title = Column(String(255), nullable=False)
    created_at = Column(DateTime, nullable=False)
    duration = Column(Integer, default=0)
    transcription = Column(Text, nullable=True)
    speakers = Column(JSON, nullable=True)
    decisions = Column(JSON, nullable=True)
    todos = Column(JSON, nullable=True)
    disputes = Column(JSON, nullable=True)
    summary = Column(Text, nullable=True)
    xmind_path = Column(String(500), nullable=True)
    status = Column(String(50), default="processing")


async def get_db():
    async with async_session() as session:
        yield session


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
