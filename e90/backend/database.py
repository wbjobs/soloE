from sqlalchemy import create_engine, Column, Integer, String, LargeBinary, DateTime, ForeignKey, Float, JSON, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from datetime import datetime

DATABASE_URL = "sqlite:///./ldpc_protector.db"

engine = create_engine(
    DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


class Image(Base):
    __tablename__ = "images"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    total_blocks = Column(Integer)
    block_size = Column(Integer, default=4096)
    redundancy_rate = Column(Float, default=0.2)
    use_interleave = Column(Boolean, default=False)
    interleave_map = Column(JSON, nullable=True)
    interleave_group_size = Column(Integer, default=64)
    created_at = Column(DateTime, default=datetime.utcnow)

    blocks = relationship("Block", back_populates="image", cascade="all, delete-orphan")
    rebuild_tasks = relationship("RebuildTask", back_populates="image", cascade="all, delete-orphan")


class Block(Base):
    __tablename__ = "blocks"

    id = Column(Integer, primary_key=True, index=True)
    image_id = Column(Integer, ForeignKey("images.id"))
    block_index = Column(Integer)
    logical_index = Column(Integer, nullable=True)
    interleave_group = Column(Integer, nullable=True)
    block_hash = Column(String, index=True)
    parity_data = Column(LargeBinary)
    created_at = Column(DateTime, default=datetime.utcnow)

    image = relationship("Image", back_populates="blocks")


class AsyncTask(Base):
    __tablename__ = "async_tasks"

    id = Column(String, primary_key=True, index=True)
    task_type = Column(String, index=True)
    status = Column(String, default="pending")
    image_name = Column(String, index=True)
    progress = Column(Integer, default=0)
    total = Column(Integer, default=0)
    message = Column(String, nullable=True)
    result = Column(JSON, nullable=True)
    error = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class RebuildTask(Base):
    __tablename__ = "rebuild_tasks"

    id = Column(String, primary_key=True, index=True)
    image_id = Column(Integer, ForeignKey("images.id"))
    name = Column(String, index=True)
    status = Column(String, default="collecting")
    total_blocks = Column(Integer)
    block_size = Column(Integer, default=4096)
    collected_blocks = Column(JSON, default=dict)
    node_contributions = Column(JSON, default=dict)
    recovered_blocks = Column(JSON, default=list)
    unrecoverable_blocks = Column(JSON, default=list)
    result_path = Column(String, nullable=True)
    progress = Column(Integer, default=0)
    message = Column(String, nullable=True)
    error = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    image = relationship("Image", back_populates="rebuild_tasks")
    fragments = relationship("Fragment", back_populates="rebuild_task", cascade="all, delete-orphan")


class Fragment(Base):
    __tablename__ = "fragments"

    id = Column(Integer, primary_key=True, index=True)
    rebuild_task_id = Column(String, ForeignKey("rebuild_tasks.id"))
    node_id = Column(String, index=True)
    node_name = Column(String, nullable=True)
    block_data = Column(LargeBinary)
    block_index = Column(Integer, index=True)
    block_hash = Column(String, nullable=True)
    is_valid = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    rebuild_task = relationship("RebuildTask", back_populates="fragments")


class NodeContribution(Base):
    __tablename__ = "node_contributions"

    id = Column(Integer, primary_key=True, index=True)
    rebuild_task_id = Column(String, ForeignKey("rebuild_tasks.id"))
    node_id = Column(String, index=True)
    node_name = Column(String, nullable=True)
    blocks_contributed = Column(Integer, default=0)
    unique_blocks = Column(Integer, default=0)
    first_seen = Column(DateTime, default=datetime.utcnow)
    last_seen = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
