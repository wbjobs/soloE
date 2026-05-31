# Parquet Data Lineage System

A complete data lineage tracking system with:
- **CLI Tool**: Parses Parquet files and analyzes SQL column-level lineage
- **Backend Service**: FastAPI server for visualizing lineage DAG graphs

## Features

### CLI Tool
- Parse Parquet files and partitioned datasets
- Extract schema and column statistics
- Analyze SQL queries for column-level lineage (using SQLGlot + DuckDB)
- Build complete lineage DAG graphs
- Export to JSON/CSV
- Upload lineage data to backend service

### Backend Service
- REST API for lineage data management
- Interactive DAG visualization (Apache ECharts)
- CSV/JSON export
- Filter edges by transformation type

## Installation

```bash
pip install -r requirements.txt
```

## Usage

### 1. Generate Sample Data

```bash
cd sample_data
python generate_samples.py
```

### 2. CLI Tool Commands

#### Parse Parquet Schema
```bash
python -m lineage_cli schema sample_data/orders.parquet --pretty
python -m lineage_cli schema sample_data/orders.parquet -o schema.json
```

#### Analyze SQL Lineage
```bash
# Basic lineage analysis
python -m lineage_cli lineage \
  --sql sample_data/query.sql \
  -t orders sample_data/orders.parquet \
  -t customers sample_data/customers.parquet \
  -t products sample_data/products.parquet \
  --pretty

# Save to file and upload to backend
python -m lineage_cli lineage \
  --sql sample_data/query.sql \
  -t orders sample_data/orders.parquet \
  -t customers sample_data/customers.parquet \
  -t products sample_data/products.parquet \
  -o lineage_result.json \
  -u http://localhost:8000

# With DuckDB validation
python -m lineage_cli lineage \
  --sql "SELECT customer_id, SUM(quantity) as total_qty FROM orders GROUP BY customer_id" \
  -t orders sample_data/orders.parquet \
  --run-duckdb
```

#### Upload Existing Lineage File
```bash
python -m lineage_cli upload lineage_result.json -u http://localhost:8000 -n "Order Analysis"
```

#### Export Lineage Data
```bash
python -m lineage_cli export lineage_result.json -f csv -o lineage.csv
python -m lineage_cli export lineage_result.json -f json -o lineage_export.json
```

### 3. Start Backend Service

```bash
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Access the UI at: http://localhost:8000

### 4. View Lineage Graph

After uploading lineage data, visit:
`http://localhost:8000/lineage/<lineage_id>`

## Project Structure

```
e86/
├── lineage_cli/              # CLI Tool
│   ├── __init__.py
│   ├── __main__.py
│   ├── cli.py               # Main CLI entry
│   └── core/
│       ├── __init__.py
│       ├── parquet_parser.py   # Parquet schema/stats parser
│       ├── sql_lineage.py      # SQL lineage analyzer
│       └── lineage_combiner.py # Graph builder
├── backend/                 # FastAPI Backend
│   ├── main.py              # FastAPI app
│   ├── templates/
│   │   ├── index.html          # Home page
│   │   └── lineage_view.html   # DAG visualization
│   └── static/              # Static assets
├── sample_data/             # Sample data
│   ├── generate_samples.py     # Data generator
│   └── query.sql               # Sample SQL
└── requirements.txt         # Dependencies
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/lineage` | Upload lineage data |
| GET | `/api/lineage` | List all lineage records |
| GET | `/api/lineage/{id}` | Get lineage data |
| DELETE | `/api/lineage/{id}` | Delete lineage record |
| GET | `/api/lineage/{id}/export/{format}` | Export as json/csv |
| GET | `/lineage/{id}` | Visualize lineage graph |

## Visualization Features

- **Interactive DAG**: Drag nodes, zoom/pan
- **Node Types**: Tables (green), Source Columns (blue), Output Columns (orange)
- **Edge Types**: Direct (solid green), Transform (dashed orange)
- **Node Details**: Click nodes to see metadata
- **Filters**: Show only direct or transform edges
- **Export**: Download as JSON or CSV

## Supported SQL Features

- SELECT queries with aliases
- JOINs (INNER, LEFT, RIGHT, FULL)
- WHERE clauses
- GROUP BY with aggregations (SUM, AVG, COUNT, etc.)
- CASE WHEN expressions
- CAST operations
- Arithmetic operations
- Subqueries (basic)
- Window functions (basic)

## Partitioned Datasets

The tool supports Hive-style partitioned Parquet datasets:
```
sales/
  year=2023/
    month=01/
      data.parquet
    month=02/
      data.parquet
  year=2024/
    ...
```

Both the CLI parser and DuckDB runner automatically detect and handle partitions.
