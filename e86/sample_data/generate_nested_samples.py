"""Generate sample Parquet data with nested structures for testing."""

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
from pathlib import Path


def generate_nested_data():
    """Generate Parquet files with complex nested structures."""
    sample_dir = Path(__file__).parent

    users_data = [
        {
            "user_id": 1,
            "profile": {
                "name": "Alice Smith",
                "email": "alice@example.com",
                "age": 30,
                "address": {
                    "street": "123 Main St",
                    "city": "New York",
                    "zipcode": "10001"
                }
            },
            "orders": [
                {"order_id": 101, "amount": 99.99, "date": "2024-01-15"},
                {"order_id": 102, "amount": 49.99, "date": "2024-01-20"}
            ],
            "preferences": {
                "newsletter": True,
                "theme": "dark"
            }
        },
        {
            "user_id": 2,
            "profile": {
                "name": "Bob Johnson",
                "email": "bob@example.com",
                "age": 25,
                "address": {
                    "street": "456 Oak Ave",
                    "city": "Los Angeles",
                    "zipcode": "90001"
                }
            },
            "orders": [
                {"order_id": 103, "amount": 199.99, "date": "2024-01-18"}
            ],
            "preferences": {
                "newsletter": False,
                "theme": "light"
            }
        },
        {
            "user_id": 3,
            "profile": {
                "name": "Charlie Brown",
                "email": "charlie@example.com",
                "age": 35,
                "address": {
                    "street": "789 Pine Rd",
                    "city": "Chicago",
                    "zipcode": "60601"
                }
            },
            "orders": [
                {"order_id": 104, "amount": 149.99, "date": "2024-01-22"},
                {"order_id": 105, "amount": 79.99, "date": "2024-01-25"},
                {"order_id": 106, "amount": 299.99, "date": "2024-02-01"}
            ],
            "preferences": {
                "newsletter": True,
                "theme": "dark"
            }
        }
    ]

    schema = pa.schema([
        pa.field("user_id", pa.int64()),
        pa.field("profile", pa.struct([
            pa.field("name", pa.string()),
            pa.field("email", pa.string()),
            pa.field("age", pa.int32()),
            pa.field("address", pa.struct([
                pa.field("street", pa.string()),
                pa.field("city", pa.string()),
                pa.field("zipcode", pa.string())
            ]))
        ])),
        pa.field("orders", pa.list_(pa.struct([
            pa.field("order_id", pa.int64()),
            pa.field("amount", pa.float64()),
            pa.field("date", pa.string())
        ]))),
        pa.field("preferences", pa.struct([
            pa.field("newsletter", pa.bool_()),
            pa.field("theme", pa.string())
        ]))
    ])

    table = pa.Table.from_pylist(users_data, schema=schema)
    pq.write_table(table, sample_dir / 'users_nested.parquet')
    print(f"✓ Created users_nested.parquet with complex nested structures")
    print(f"  - Nested fields: profile, profile.address, orders, preferences")
    print(f"  - Schema includes: struct, list<struct>")

    nested_query = """
SELECT
    user_id,
    profile.name AS user_name,
    profile.email,
    profile.age,
    profile.address.city,
    profile.address.zipcode,
    preferences.theme
FROM users
WHERE profile.age > 25
"""
    with open(sample_dir / 'nested_query.sql', 'w') as f:
        f.write(nested_query)
    print(f"✓ Created nested_query.sql")


if __name__ == "__main__":
    generate_nested_data()
