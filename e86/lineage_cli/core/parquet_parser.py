"""Parquet file schema and statistics parser."""

import json
import os
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple

import pyarrow as pa
import pyarrow.parquet as pq
import pyarrow.dataset as ds


@dataclass
class ColumnStats:
    null_count: int = 0
    distinct_count: Optional[int] = None
    min_value: Optional[Any] = None
    max_value: Optional[Any] = None
    avg_value: Optional[float] = None
    total_count: int = 0


@dataclass
class NestedFieldInfo:
    """Information about a nested field in the schema."""
    path: str
    name: str
    full_name: str
    type: str
    nullable: bool
    is_struct: bool
    is_list: bool
    is_leaf: bool
    children: List["NestedFieldInfo"] = field(default_factory=list)
    parent_path: Optional[str] = None


@dataclass
class ColumnSchema:
    name: str
    type: str
    nullable: bool
    stats: ColumnStats = field(default_factory=ColumnStats)
    is_nested: bool = False
    nested_path: Optional[str] = None
    parent_path: Optional[str] = None
    is_leaf_column: bool = True


@dataclass
class PartitionInfo:
    column: str
    values: List[str]
    type: str


@dataclass
class ParquetMetadata:
    path: str
    is_partitioned: bool
    partition_columns: List[str]
    partitions: List[PartitionInfo]
    row_count: int
    file_count: int
    total_size_bytes: int
    columns: List[ColumnSchema]
    raw_schema: Dict[str, Any]
    nested_schema: List[NestedFieldInfo] = field(default_factory=list)
    is_flattened: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent, default=str)


class ParquetParser:
    """Parser for Parquet files and partitioned datasets."""

    def __init__(self, path: str, flatten: bool = False):
        self.path = Path(path)
        self.flatten = flatten
        if not self.path.exists():
            raise FileNotFoundError(f"Path does not exist: {path}")

    def _is_partitioned_dataset(self) -> bool:
        """Check if the path contains a partitioned dataset."""
        if self.path.is_file():
            return False
        try:
            dataset = ds.dataset(self.path, format="parquet")
            return len(dataset.partitioning.schema.names) > 0
        except Exception:
            return False

    def _collect_partition_info(self, dataset: ds.FileSystemDataset) -> List[PartitionInfo]:
        """Collect partition information from the dataset."""
        partitions = []
        if not dataset.partitioning.schema.names:
            return partitions

        for part_col in dataset.partitioning.schema.names:
            partition_field = dataset.partitioning.schema.field(part_col)
            values = []

            for frag in dataset.get_fragments():
                partition_expression = frag.partition_expression
                if partition_expression is not None:
                    try:
                        parts = str(partition_expression).split(" AND ")
                        for part in parts:
                            if "=" in part:
                                col, val = part.split("=", 1)
                                if col.strip() == part_col:
                                    val = val.strip().strip("'\"")
                                    if val not in values:
                                        values.append(val)
                    except Exception:
                        continue

            partitions.append(PartitionInfo(
                column=part_col,
                values=sorted(values),
                type=str(partition_field.type)
            ))

        return partitions

    def _flatten_nested_type(self, field: pa.Field, parent_path: str = "", 
                             nested_fields: List[NestedFieldInfo] = None,
                             processed_paths: set = None) -> List[Tuple[str, pa.Field, str, bool]]:
        """Recursively flatten nested types and collect field information."""
        if nested_fields is None:
            nested_fields = []
        if processed_paths is None:
            processed_paths = set()

        current_path = f"{parent_path}.{field.name}" if parent_path else field.name
        
        if current_path in processed_paths:
            return []
        processed_paths.add(current_path)

        field_type = field.type

        is_struct = pa.types.is_struct(field_type)
        is_list = pa.types.is_list(field_type)
        is_map = pa.types.is_map(field_type)
        is_large_list = pa.types.is_large_list(field_type)
        is_fixed_size_list = pa.types.is_fixed_size_list(field_type)

        is_container = is_struct or is_list or is_map or is_large_list or is_fixed_size_list
        is_leaf = not is_container

        field_info = NestedFieldInfo(
            path=current_path,
            name=field.name,
            full_name=current_path,
            type=str(field_type),
            nullable=field.nullable,
            is_struct=is_struct,
            is_list=is_list or is_large_list or is_fixed_size_list,
            is_leaf=is_leaf,
            parent_path=parent_path or None
        )

        result = []
        children_paths = []

        if is_struct:
            for child in field_type:
                child_path = f"{current_path}.{child.name}"
                children_paths.append(child_path)
                child_results = self._flatten_nested_type(child, current_path, nested_fields, processed_paths)
                result.extend(child_results)
        elif is_list or is_large_list:
            value_field = field_type.value_field
            if pa.types.is_struct(value_field.type):
                for child in value_field.type:
                    list_path = f"{current_path}.{child.name}"
                    children_paths.append(list_path)
                    child_results = self._flatten_nested_type(child, list_path, nested_fields, processed_paths)
                    result.extend(child_results)
            else:
                result.append((current_path, value_field, parent_path, True))
                field_info.is_leaf = True
        elif is_map:
            key_field = field_type.key_field
            item_field = field_type.item_field
            key_path = f"{current_path}.{key_field.name}"
            item_path = f"{current_path}.{item_field.name}"
            result.append((key_path, key_field, current_path, True))
            result.append((item_path, item_field, current_path, True))
            field_info.is_leaf = False
            children_paths.extend([key_path, item_path])
        else:
            result.append((current_path, field, parent_path, True))
            field_info.is_leaf = True

        for child_path in children_paths:
            child_info = next((n for n in nested_fields if n.path == child_path), None)
            if child_info:
                field_info.children.append(child_info)

        nested_fields.append(field_info)
        return result

    def _get_flattened_schema(self, schema: pa.Schema) -> Tuple[List[Tuple[str, pa.Field, str, bool]], List[NestedFieldInfo]]:
        """Get flattened schema information."""
        all_fields = []
        nested_fields = []

        for i in range(len(schema)):
            field = schema.field(i)
            field_results = self._flatten_nested_type(field, "", nested_fields)
            all_fields.extend(field_results)

        root_fields = [n for n in nested_fields if n.parent_path is None]
        return all_fields, root_fields

    def _get_flattened_column(self, table: pa.Table, column_path: str) -> Optional[pa.ChunkedArray]:
        """Get a column from a potentially nested table using dot notation path."""
        parts = column_path.split(".")
        current = table

        for i, part in enumerate(parts):
            if isinstance(current, pa.Table):
                if part not in current.column_names:
                    return None
                current = current.column(part)
            else:
                current_type = current.type
                if pa.types.is_struct(current_type):
                    if part not in current_type.names:
                        return None
                    current = current.field(part)
                elif pa.types.is_list(current_type) or pa.types.is_large_list(current_type):
                    value_field = current_type.value_field
                    if part == value_field.name:
                        current = current.values
                    elif pa.types.is_struct(value_field.type):
                        if part in value_field.type.names:
                            current = current.values.field(part)
                        else:
                            return None
                    else:
                        return None
                else:
                    return None

        return current

    def _collect_stats(self, table: pa.Table, column_name: str, is_nested: bool = False) -> ColumnStats:
        """Collect statistics for a single column, supporting nested columns."""
        try:
            if is_nested:
                column = self._get_flattened_column(table, column_name)
                if column is None:
                    return ColumnStats()
            else:
                column = table.column(column_name)
        except Exception:
            return ColumnStats()

        stats = ColumnStats(total_count=len(column))

        try:
            null_count = column.null_count
            stats.null_count = null_count

            if null_count == len(column):
                return stats

            try:
                non_null = column.drop_null()
                if len(non_null) > 0:
                    if pa.types.is_primitive(non_null.type):
                        min_val = pa.compute.min(non_null).as_py()
                        max_val = pa.compute.max(non_null).as_py()
                        stats.min_value = min_val
                        stats.max_value = max_val

                        if pa.types.is_numeric(non_null.type):
                            avg_val = pa.compute.mean(non_null).as_py()
                            stats.avg_value = float(avg_val) if avg_val is not None else None

                        try:
                            distinct = pa.compute.count_distinct(non_null).as_py()
                            stats.distinct_count = distinct
                        except Exception:
                            pass
            except Exception:
                pass
        except Exception:
            pass

        return stats

    def parse(self, collect_stats: bool = True, sample_rows: Optional[int] = None) -> ParquetMetadata:
        """Parse Parquet file or dataset and extract metadata."""
        if self.path.is_file():
            return self._parse_single_file(collect_stats, sample_rows)
        else:
            return self._parse_dataset(collect_stats, sample_rows)

    def _parse_single_file(self, collect_stats: bool, sample_rows: Optional[int]) -> ParquetMetadata:
        """Parse a single Parquet file."""
        parquet_file = pq.ParquetFile(self.path)
        schema = parquet_file.schema_arrow
        row_count = parquet_file.metadata.num_rows

        columns = []
        table = None
        nested_schema = []

        if collect_stats:
            if sample_rows and sample_rows < row_count:
                table = parquet_file.read_row_group(0).slice(0, sample_rows)
                for rg in range(1, parquet_file.num_row_groups):
                    if len(table) >= sample_rows:
                        break
                    chunk = parquet_file.read_row_group(rg).slice(0, min(sample_rows - len(table), parquet_file.metadata.row_group(rg).num_rows))
                    table = pa.concat_tables([table, chunk])
            else:
                table = parquet_file.read()

        if self.flatten:
            flattened_fields, nested_schema = self._get_flattened_schema(schema)
            for col_path, field, parent_path, is_leaf in flattened_fields:
                col_stats = ColumnStats()
                if collect_stats and table is not None:
                    col_stats = self._collect_stats(table, col_path, is_nested=True)

                columns.append(ColumnSchema(
                    name=col_path,
                    type=str(field.type),
                    nullable=field.nullable,
                    stats=col_stats,
                    is_nested="." in col_path,
                    nested_path=col_path,
                    parent_path=parent_path or None,
                    is_leaf_column=is_leaf
                ))
        else:
            for i in range(len(schema)):
                field = schema.field(i)
                col_stats = ColumnStats()
                if collect_stats and table is not None:
                    col_stats = self._collect_stats(table, field.name)

                columns.append(ColumnSchema(
                    name=field.name,
                    type=str(field.type),
                    nullable=field.nullable,
                    stats=col_stats,
                    is_nested=False,
                    nested_path=None,
                    parent_path=None,
                    is_leaf_column=True
                ))

        total_size = self.path.stat().st_size
        raw_schema_dict = {
            "fields": [
                {
                    "name": f.name,
                    "type": str(f.type),
                    "nullable": f.nullable
                }
                for f in schema
            ]
        }

        return ParquetMetadata(
            path=str(self.path),
            is_partitioned=False,
            partition_columns=[],
            partitions=[],
            row_count=row_count,
            file_count=1,
            total_size_bytes=total_size,
            columns=columns,
            raw_schema=raw_schema_dict,
            nested_schema=nested_schema,
            is_flattened=self.flatten
        )

    def _parse_dataset(self, collect_stats: bool, sample_rows: Optional[int]) -> ParquetMetadata:
        """Parse a partitioned Parquet dataset."""
        dataset = ds.dataset(self.path, format="parquet")
        is_partitioned = len(dataset.partitioning.schema.names) > 0
        partition_cols = dataset.partitioning.schema.names if is_partitioned else []

        partitions = []
        if is_partitioned:
            partitions = self._collect_partition_info(dataset)

        files = list(dataset.files)
        file_count = len(files)
        total_size = sum(os.path.getsize(f) for f in files if os.path.exists(f))

        row_count = 0
        for f in files:
            try:
                pf = pq.ParquetFile(f)
                row_count += pf.metadata.num_rows
            except Exception:
                continue

        columns = []
        schema = dataset.schema
        nested_schema = []

        table = None
        if collect_stats:
            if sample_rows and sample_rows < row_count:
                fragments = list(dataset.get_fragments())
                collected = 0
                tables = []
                for frag in fragments:
                    if collected >= sample_rows:
                        break
                    frag_table = frag.to_table()
                    if len(frag_table) > 0:
                        take_count = min(sample_rows - collected, len(frag_table))
                        tables.append(frag_table.slice(0, take_count))
                        collected += take_count
                if tables:
                    table = pa.concat_tables(tables)
            else:
                table = dataset.to_table()

        if self.flatten:
            flattened_fields, nested_schema = self._get_flattened_schema(schema)
            for col_path, field, parent_path, is_leaf in flattened_fields:
                col_stats = ColumnStats()
                if collect_stats and table is not None:
                    col_stats = self._collect_stats(table, col_path, is_nested=True)

                columns.append(ColumnSchema(
                    name=col_path,
                    type=str(field.type),
                    nullable=field.nullable,
                    stats=col_stats,
                    is_nested="." in col_path,
                    nested_path=col_path,
                    parent_path=parent_path or None,
                    is_leaf_column=is_leaf
                ))
        else:
            for i in range(len(schema)):
                field = schema.field(i)
                col_stats = ColumnStats()
                if collect_stats and table is not None and field.name in table.column_names:
                    col_stats = self._collect_stats(table, field.name)

                columns.append(ColumnSchema(
                    name=field.name,
                    type=str(field.type),
                    nullable=field.nullable,
                    stats=col_stats,
                    is_nested=False,
                    nested_path=None,
                    parent_path=None,
                    is_leaf_column=True
                ))

        raw_schema_dict = {
            "fields": [
                {
                    "name": f.name,
                    "type": str(f.type),
                    "nullable": f.nullable
                }
                for f in schema
            ]
        }

        return ParquetMetadata(
            path=str(self.path),
            is_partitioned=is_partitioned,
            partition_columns=partition_cols,
            partitions=partitions,
            row_count=row_count,
            file_count=file_count,
            total_size_bytes=total_size,
            columns=columns,
            raw_schema=raw_schema_dict,
            nested_schema=nested_schema,
            is_flattened=self.flatten
        )


def parse_parquet(path: str, collect_stats: bool = True, sample_rows: Optional[int] = None, flatten: bool = False) -> ParquetMetadata:
    """Convenience function to parse Parquet metadata."""
    parser = ParquetParser(path, flatten=flatten)
    return parser.parse(collect_stats=collect_stats, sample_rows=sample_rows)
