"""CLI tool for Parquet data lineage analysis."""

import json
import sys
from pathlib import Path
from typing import Dict, List, Optional

import click
import requests

from .core.parquet_parser import parse_parquet, ParquetMetadata
from .core.sql_lineage import analyze_sql_lineage, DuckDBLineageRunner, ImpactAnalyzer, LineageResult
from .core.lineage_combiner import build_lineage_graph, build_multi_query_lineage_graph, LineageGraph, MultiQueryLineageGraph


@click.group()
@click.version_option(version="0.1.0")
def cli():
    """Parquet Data Lineage Analysis Tool."""
    pass


@cli.command()
@click.argument("path", type=click.Path(exists=True))
@click.option("--output", "-o", type=click.Path(), help="Output JSON file path")
@click.option("--no-stats", is_flag=True, help="Skip collecting column statistics")
@click.option("--sample-rows", type=int, default=None, help="Number of rows to sample for stats")
@click.option("--flatten", is_flag=True, help="Recursively flatten nested columns")
@click.option("--pretty", is_flag=True, help="Pretty print JSON output")
def schema(path: str, output: Optional[str], no_stats: bool, sample_rows: Optional[int], flatten: bool, pretty: bool):
    """Parse Parquet file/dataset schema and statistics."""
    try:
        click.echo(f"Parsing Parquet data from: {path}")
        if flatten:
            click.echo("Flattening nested columns...")

        metadata = parse_parquet(
            path,
            collect_stats=not no_stats,
            sample_rows=sample_rows,
            flatten=flatten
        )

        click.echo(f"✓ Found {metadata.row_count} rows in {metadata.file_count} files")
        click.echo(f"✓ Schema has {len(metadata.columns)} columns")

        if metadata.is_partitioned:
            click.echo(f"✓ Partitioned by: {', '.join(metadata.partition_columns)}")

        if flatten:
            nested_cols = [c.name for c in metadata.columns if c.is_nested]
            click.echo(f"✓ Flattened {len(nested_cols)} nested columns")

        result_json = metadata.to_json(indent=2 if pretty else None)

        if output:
            with open(output, "w", encoding="utf-8") as f:
                f.write(result_json)
            click.echo(f"✓ Schema written to: {output}")
        else:
            click.echo("\nSchema:")
            click.echo(result_json)

    except Exception as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)


@cli.command()
@click.option("--sql", "-s", required=True, help="SQL query string or path to .sql file")
@click.option("--table", "-t", multiple=True, type=(str, click.Path(exists=True)),
              help="Table name and Parquet path pairs (e.g., -t orders data/orders.parquet)")
@click.option("--output", "-o", type=click.Path(), help="Output lineage JSON file path")
@click.option("--upload", "-u", help="Backend service URL to upload lineage data")
@click.option("--name", "-n", help="Name for this lineage analysis")
@click.option("--flatten", is_flag=True, help="Recursively flatten nested columns")
@click.option("--run-duckdb", is_flag=True, help="Execute query with DuckDB to validate")
@click.option("--no-stats", is_flag=True, help="Skip collecting column statistics")
@click.option("--sample-rows", type=int, default=10000, help="Sample rows for stats")
@click.option("--pretty", is_flag=True, help="Pretty print JSON output")
def lineage(sql: str, table: tuple, output: Optional[str], upload: Optional[str], name: Optional[str],
            flatten: bool, run_duckdb: bool, no_stats: bool, sample_rows: Optional[int], pretty: bool):
    """Analyze SQL query column-level lineage."""
    try:
        if Path(sql).exists() and sql.endswith(".sql"):
            with open(sql, "r", encoding="utf-8") as f:
                sql_query = f.read()
            click.echo(f"Loaded SQL from file: {sql}")
        else:
            sql_query = sql

        click.echo(f"Analyzing lineage for query:\n{sql_query[:200]}...")

        parquet_metadatas: Dict[str, ParquetMetadata] = {}
        table_schemas: Dict[str, List[str]] = {}

        runner = None
        if run_duckdb:
            runner = DuckDBLineageRunner(flatten_nested=flatten)

        for table_name, parquet_path in table:
            click.echo(f"Parsing Parquet data for table '{table_name}': {parquet_path}")
            if flatten:
                click.echo("  Flattening nested columns...")
            metadata = parse_parquet(
                parquet_path,
                collect_stats=not no_stats,
                sample_rows=sample_rows,
                flatten=flatten
            )
            parquet_metadatas[table_name] = metadata
            table_schemas[table_name] = [col.name for col in metadata.columns]
            click.echo(f"  ✓ {metadata.row_count} rows, {len(metadata.columns)} columns")
            if flatten:
                nested_count = sum(1 for c in metadata.columns if c.is_nested)
                if nested_count > 0:
                    click.echo(f"  ✓ Flattened {nested_count} nested columns")

            if runner:
                click.echo(f"  Registering with DuckDB...")
                cols = runner.register_parquet(table_name, parquet_path)
                click.echo(f"  ✓ Registered with {len(cols)} columns")

        click.echo("Analyzing SQL lineage...")
        lineage_result = analyze_sql_lineage(sql_query, table_schemas)

        click.echo(f"✓ Query type: {lineage_result.query_type}")
        click.echo(f"✓ Output columns: {len(lineage_result.output_columns)}")
        click.echo(f"✓ Column lineage entries: {len(lineage_result.column_lineage)}")

        if runner:
            try:
                click.echo("Validating query with DuckDB...")
                result_cols = runner.get_query_result_schema(sql_query)
                click.echo(f"✓ Query executed successfully, returns {len(result_cols)} columns")
                runner.close()
            except Exception as e:
                click.echo(f"⚠ DuckDB execution warning: {e}")
                if runner:
                    runner.close()

        click.echo("Building lineage graph...")
        graph = build_lineage_graph(parquet_metadatas, lineage_result)
        click.echo(f"✓ Graph has {len(graph.nodes)} nodes and {len(graph.edges)} edges")

        result_json = graph.to_json(indent=2 if pretty else None)

        if output:
            with open(output, "w", encoding="utf-8") as f:
                f.write(result_json)
            click.echo(f"✓ Lineage data written to: {output}")
        else:
            click.echo("\nLineage summary:")
            for entry in lineage_result.column_lineage:
                sources = ", ".join(entry.source_columns) if entry.source_columns else "none"
                click.echo(f"  {entry.output_column} ← {sources} [{entry.transformation}]")

        if upload:
            click.echo(f"Uploading lineage data to: {upload}")
            try:
                upload_data = graph.to_dict()
                if name:
                    upload_data["name"] = name
                response = requests.post(
                    f"{upload.rstrip('/')}/api/lineage",
                    json=upload_data,
                    headers={"Content-Type": "application/json"}
                )
                response.raise_for_status()
                result = response.json()
                click.echo(f"✓ Upload successful! View at: {upload}/lineage/{result.get('id', '?')}")
            except Exception as e:
                click.echo(f"⚠ Upload failed: {e}")

    except Exception as e:
        click.echo(f"Error: {e}", err=True)
        import traceback
        traceback.print_exc()
        sys.exit(1)


@cli.command()
@click.argument("lineage_file", type=click.Path(exists=True))
@click.option("--upload", "-u", required=True, help="Backend service URL")
@click.option("--name", "-n", help="Optional name for this lineage")
def upload(lineage_file: str, upload: str, name: Optional[str]):
    """Upload existing lineage JSON to backend service."""
    try:
        click.echo(f"Reading lineage file: {lineage_file}")
        with open(lineage_file, "r", encoding="utf-8") as f:
            lineage_data = json.load(f)

        if name:
            lineage_data["name"] = name

        click.echo(f"Uploading to: {upload}")
        response = requests.post(
            f"{upload.rstrip('/')}/api/lineage",
            json=lineage_data,
            headers={"Content-Type": "application/json"}
        )
        response.raise_for_status()
        result = response.json()
        click.echo(f"✓ Upload successful!")
        click.echo(f"  ID: {result.get('id')}")
        click.echo(f"  View: {upload.rstrip('/')}/lineage/{result.get('id', '')}")

    except Exception as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)


@cli.command()
@click.argument("lineage_file", type=click.Path(exists=True))
@click.option("--format", "-f", type=click.Choice(["csv", "json"]), default="csv", help="Export format")
@click.option("--output", "-o", type=click.Path(), help="Output file path")
def export(lineage_file: str, format: str, output: Optional[str]):
    """Export lineage data to CSV or JSON."""
    try:
        click.echo(f"Reading lineage file: {lineage_file}")
        with open(lineage_file, "r", encoding="utf-8") as f:
            lineage_data = json.load(f)

        if format == "json":
            result = json.dumps(lineage_data, indent=2)
            default_output = "lineage_export.json"
        else:
            result = _lineage_to_csv(lineage_data)
            default_output = "lineage_export.csv"

        output_path = output or default_output
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(result)

        click.echo(f"✓ Exported to: {output_path}")

    except Exception as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)


def _lineage_to_csv(lineage_data: dict) -> str:
    """Convert lineage graph data to CSV format."""
    edges = lineage_data.get("edges", [])
    nodes = {n["id"]: n for n in lineage_data.get("nodes", [])}

    lines = ["source,target,transformation,is_direct,source_type,target_type"]

    for edge in edges:
        source_node = nodes.get(edge["source"], {})
        target_node = nodes.get(edge["target"], {})
        line = ",".join([
            edge["source"],
            edge["target"],
            edge.get("transformation", ""),
            str(edge.get("is_direct", False)),
            source_node.get("type", ""),
            target_node.get("type", "")
        ])
        lines.append(line)

    return "\n".join(lines) + "\n"


@cli.command()
@click.option("--column", "-c", required=True, help="Source column name to analyze impact (e.g., users.profile.city)")
@click.option("--sql", "-s", multiple=True, help="SQL query string or path to .sql file")
@click.option("--sql-dir", type=click.Path(exists=True, file_okay=False), help="Directory containing multiple .sql files")
@click.option("--table", "-t", multiple=True, type=(str, click.Path(exists=True)),
              help="Table name and Parquet path pairs")
@click.option("--output", "-o", type=click.Path(), help="Output impact analysis JSON file path")
@click.option("--flatten", is_flag=True, help="Recursively flatten nested columns")
@click.option("--max-depth", type=int, default=10, help="Maximum depth for impact traversal")
@click.option("--pretty", is_flag=True, help="Pretty print JSON output")
def impact(column: str, sql: tuple, sql_dir: Optional[str], table: tuple, output: Optional[str],
           flatten: bool, max_depth: int, pretty: bool):
    """Analyze downstream impact of a column change across SQL queries."""
    try:
        sql_queries: List[str] = []
        
        for sql_item in sql:
            if Path(sql_item).exists() and sql_item.endswith(".sql"):
                with open(sql_item, "r", encoding="utf-8") as f:
                    sql_queries.append(f.read())
                click.echo(f"Loaded SQL from file: {sql_item}")
            else:
                sql_queries.append(sql_item)
        
        if sql_dir:
            sql_files = sorted(Path(sql_dir).glob("*.sql"))
            for sql_file in sql_files:
                with open(sql_file, "r", encoding="utf-8") as f:
                    sql_queries.append(f.read())
                click.echo(f"Loaded SQL from file: {sql_file}")
        
        if not sql_queries:
            click.echo("Error: No SQL queries provided", err=True)
            sys.exit(1)
        
        click.echo(f"Analyzing impact for column: {column}")
        click.echo(f"Processing {len(sql_queries)} SQL queries...")

        parquet_metadatas: Dict[str, ParquetMetadata] = {}
        table_schemas: Dict[str, List[str]] = {}

        for table_name, parquet_path in table:
            click.echo(f"Parsing Parquet data for table '{table_name}': {parquet_path}")
            metadata = parse_parquet(
                parquet_path,
                collect_stats=False,
                flatten=flatten
            )
            parquet_metadatas[table_name] = metadata
            table_schemas[table_name] = [col.name for col in metadata.columns]
            click.echo(f"  ✓ {metadata.row_count} rows, {len(metadata.columns)} columns")

        lineage_results: List[LineageResult] = []
        for i, sql_query in enumerate(sql_queries):
            click.echo(f"Analyzing query {i+1}/{len(sql_queries)}...")
            result = analyze_sql_lineage(sql_query, table_schemas)
            lineage_results.append(result)
            click.echo(f"  ✓ {len(result.column_lineage)} lineage entries")

        click.echo("Building impact graph...")
        analyzer = ImpactAnalyzer(lineage_results)
        impact_result = analyzer.analyze(column, max_depth=max_depth)

        click.echo(f"\nImpact Analysis Results:")
        click.echo(f"  Source column: {impact_result.source_column}")
        click.echo(f"  Total affected columns: {impact_result.total_affected}")
        
        if impact_result.affected_columns:
            click.echo(f"\n  Affected columns:")
            for col in impact_result.affected_columns:
                click.echo(f"    - {col}")
        
        if impact_result.affected_queries:
            click.echo(f"\n  Affected queries: {len(impact_result.affected_queries)}")

        result_json = impact_result.to_json(indent=2 if pretty else None)

        if output:
            with open(output, "w", encoding="utf-8") as f:
                f.write(result_json)
            click.echo(f"\n✓ Impact analysis written to: {output}")
        else:
            click.echo("\n" + result_json)

    except Exception as e:
        click.echo(f"Error: {e}", err=True)
        import traceback
        traceback.print_exc()
        sys.exit(1)


@cli.command()
@click.option("--sql-dir", required=True, type=click.Path(exists=True, file_okay=False),
              help="Directory containing multiple .sql files")
@click.option("--table", "-t", multiple=True, type=(str, click.Path(exists=True)),
              help="Table name and Parquet path pairs")
@click.option("--output", "-o", type=click.Path(), help="Output combined lineage JSON file path")
@click.option("--upload", "-u", help="Backend service URL to upload lineage data")
@click.option("--name", "-n", help="Name for this batch lineage analysis")
@click.option("--flatten", is_flag=True, help="Recursively flatten nested columns")
@click.option("--pretty", is_flag=True, help="Pretty print JSON output")
def batch_lineage(sql_dir: str, table: tuple, output: Optional[str], upload: Optional[str],
                  name: Optional[str], flatten: bool, pretty: bool):
    """Analyze lineage for multiple SQL files in a directory."""
    try:
        sql_files = sorted(Path(sql_dir).glob("*.sql"))
        if not sql_files:
            click.echo(f"No .sql files found in: {sql_dir}", err=True)
            sys.exit(1)

        click.echo(f"Found {len(sql_files)} SQL files in: {sql_dir}")

        sql_queries: List[str] = []
        for sql_file in sql_files:
            with open(sql_file, "r", encoding="utf-8") as f:
                sql_queries.append(f.read())
            click.echo(f"  ✓ {sql_file.name}")

        parquet_metadatas: Dict[str, ParquetMetadata] = {}
        table_schemas: Dict[str, List[str]] = {}

        for table_name, parquet_path in table:
            click.echo(f"Parsing Parquet data for table '{table_name}': {parquet_path}")
            metadata = parse_parquet(parquet_path, collect_stats=True, flatten=flatten)
            parquet_metadatas[table_name] = metadata
            table_schemas[table_name] = [col.name for col in metadata.columns]
            click.echo(f"  ✓ {metadata.row_count} rows, {len(metadata.columns)} columns")

        lineage_results: List[LineageResult] = []
        for i, sql_query in enumerate(sql_queries):
            click.echo(f"Analyzing query {i+1}/{len(sql_queries)}: {sql_files[i].name}")
            result = analyze_sql_lineage(sql_query, table_schemas)
            lineage_results.append(result)
            click.echo(f"  ✓ {len(result.column_lineage)} lineage entries")

        click.echo("Building combined lineage graph...")
        graph = build_multi_query_lineage_graph(parquet_metadatas, lineage_results)
        click.echo(f"✓ Graph has {len(graph.nodes)} nodes and {len(graph.edges)} edges")

        result_json = graph.to_json(indent=2 if pretty else None)

        if output:
            with open(output, "w", encoding="utf-8") as f:
                f.write(result_json)
            click.echo(f"✓ Batch lineage data written to: {output}")

        if upload:
            click.echo(f"Uploading to backend: {upload}")
            try:
                upload_data = graph.to_dict()
                if name:
                    upload_data["name"] = name
                response = requests.post(
                    f"{upload.rstrip('/')}/api/lineage",
                    json=upload_data,
                    headers={"Content-Type": "application/json"}
                )
                response.raise_for_status()
                result = response.json()
                click.echo(f"✓ Upload successful! View at: {upload}/lineage/{result.get('id', '?')}")
            except Exception as e:
                click.echo(f"⚠ Upload failed: {e}")

    except Exception as e:
        click.echo(f"Error: {e}", err=True)
        import traceback
        traceback.print_exc()
        sys.exit(1)


def main():
    """Entry point for the CLI."""
    cli()


if __name__ == "__main__":
    main()
