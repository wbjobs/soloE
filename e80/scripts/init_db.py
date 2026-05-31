import os
import sys
from datetime import date, timedelta
from dateutil.relativedelta import relativedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database.sqlite import get_sqlite_session, init_sqlite_db, Sale
from app.database.postgresql import mock_pg_data


def generate_sales_data():
    session = get_sqlite_session()

    try:
        session.query(Sale).delete()
        session.commit()

        today = date.today()
        last_month = today - relativedelta(months=1)

        regions = ["上海", "北京", "广州", "深圳", "杭州"]
        product_ids = [f"P{i:03d}" for i in range(1, 11)]

        sales_records = []
        base_amounts = {
            "P001": 7999, "P002": 14999, "P003": 1899, "P004": 5999, "P005": 6499,
            "P006": 4799, "P007": 2699, "P008": 9999, "P009": 12999, "P010": 6999,
        }

        for day_offset in range(60):
            sale_date = today - timedelta(days=day_offset)
            is_last_month = sale_date >= last_month.replace(day=1) and sale_date < today.replace(day=1)
            is_this_month = sale_date >= today.replace(day=1)

            for region in regions:
                region_multiplier = 1.5 if region == "上海" else 1.0

                for pid in product_ids:
                    if is_last_month and pid == "P002" and region == "上海":
                        quantity = 15
                    elif is_last_month and region == "上海":
                        quantity = 3 if pid in ["P001", "P004"] else 1
                    elif is_this_month:
                        quantity = 1
                    else:
                        continue

                    if quantity > 0:
                        amount = base_amounts[pid] * quantity * region_multiplier
                        sales_records.append(
                            Sale(
                                product_id=pid,
                                region=region,
                                amount=amount,
                                quantity=quantity,
                                sale_date=sale_date,
                                customer_id=f"C{hash(pid + region + str(sale_date)) % 1000:03d}",
                            )
                        )

        session.bulk_save_objects(sales_records)
        session.commit()
        print(f"Inserted {len(sales_records)} sales records")

    except Exception as e:
        session.rollback()
        print(f"Error: {e}")
        raise
    finally:
        session.close()


def main():
    print("Initializing SQLite database...")
    init_sqlite_db()
    print("Generating sales data...")
    generate_sales_data()
    print("Mock PostgreSQL product data:")
    for product in mock_pg_data():
        print(f"  {product['product_id']}: {product['product_name']}")
    print("\nDatabase initialization completed!")


if __name__ == "__main__":
    main()
