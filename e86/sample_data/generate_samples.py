"""Generate sample Parquet data for testing."""

import os
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
from pathlib import Path


def generate_sample_data():
    """Generate sample Parquet files and partitioned datasets."""
    sample_dir = Path(__file__).parent

    orders_data = pd.DataFrame({
        'order_id': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        'customer_id': [101, 102, 101, 103, 102, 101, 104, 103, 102, 101],
        'product_id': [201, 202, 203, 201, 204, 202, 203, 201, 205, 202],
        'quantity': [2, 1, 5, 3, 2, 4, 1, 6, 2, 3],
        'unit_price': [49.99, 29.99, 19.99, 49.99, 99.99, 29.99, 19.99, 49.99, 149.99, 29.99],
        'order_date': ['2024-01-15', '2024-01-16', '2024-01-17', '2024-01-18', '2024-01-19',
                     '2024-02-01', '2024-02-05', '2024-02-10', '2024-02-15', '2024-02-20'],
        'status': ['completed', 'completed', 'pending', 'completed', 'completed',
                     'completed', 'cancelled', 'completed', 'completed', 'pending']
    })

    orders_table = pa.Table.from_pandas(orders_data)
    pq.write_table(orders_table, sample_dir / 'orders.parquet')
    print(f"✓ Created orders.parquet ({len(orders_data)} rows)")

    customers_data = pd.DataFrame({
        'customer_id': [101, 102, 103, 104, 105],
        'customer_name': ['Alice Smith', 'Bob Johnson', 'Charlie Brown', 'Diana Ross', 'Edward Norton'],
        'email': ['alice@example.com', 'bob@example.com', 'charlie@example.com', 'diana@example.com', 'edward@example.com'],
        'region': ['North', 'South', 'East', 'West', 'North'],
        'signup_date': ['2023-01-15', '2023-02-20', '2023-03-10', '2023-04-05', '2023-05-12']
    })

    customers_table = pa.Table.from_pandas(customers_data)
    pq.write_table(customers_table, sample_dir / 'customers.parquet')
    print(f"✓ Created customers.parquet ({len(customers_data)} rows)")

    products_data = pd.DataFrame({
        'product_id': [201, 202, 203, 204, 205],
        'product_name': ['Laptop', 'Mouse', 'Keyboard', 'Monitor', 'Headphones'],
        'category': ['Electronics', 'Electronics', 'Electronics', 'Electronics', 'Electronics'],
        'brand': ['TechCo', 'TechCo', 'KeyPro', 'ViewMax', 'SoundX'],
        'price': [999.99, 49.99, 79.99, 299.99, 199.99]
    })

    products_table = pa.Table.from_pandas(products_data)
    pq.write_table(products_table, sample_dir / 'products.parquet')
    print(f"✓ Created products.parquet ({len(products_data)} rows)")

    partitioned_dir = sample_dir / 'sales_partitioned'
    partitioned_dir.mkdir(exist_ok=True)

    all_sales = []
    for year in ['2023', '2024']:
        year_dir = partitioned_dir / f'year={year}'
        year_dir.mkdir(exist_ok=True)
        for month in ['01', '02', '03']:
            month_dir = year_dir / f'month={month}'
            month_dir.mkdir(exist_ok=True)

            sales_data = pd.DataFrame({
                'sale_id': range(len(all_sales), len(all_sales) + 5),
                'product_id': [201, 202, 203, 201, 202],
                'amount': [100.0, 50.0, 75.0, 200.0, 150.0],
                'quantity': [1, 2, 1, 2, 3]
            })
            all_sales.extend(range(len(all_sales), len(all_sales) + 5))

            sales_table = pa.Table.from_pandas(sales_data)
            pq.write_table(sales_table, month_dir / 'data.parquet')
            print(f"✓ Created sales_partitioned/year={year}/month={month}/data.parquet ({len(sales_data)} rows)")

    print("\nSample data generation complete!")
    print(f"Total files created: 3 single files + partitioned dataset")


if __name__ == "__main__":
    generate_sample_data()
