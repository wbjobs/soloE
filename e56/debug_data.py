import sys
import os

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from backend.engine.data_handler import DataHandler


def test_data():
    handler = DataHandler()
    
    data_path = os.path.join("examples", "AAPL.csv")
    handler.load_csv(data_path, "AAPL")
    
    df = handler.get_data("AAPL")
    print("数据形状:", df.shape)
    print("\n前5行:")
    print(df.head())
    print("\n后5行:")
    print(df.tail())
    
    merged = handler.get_merged_data()
    print("\n合并数据形状:", merged.shape)
    print("合并数据列:", merged.columns.tolist())
    print("合并数据符号:", merged['symbol'].unique())


if __name__ == "__main__":
    test_data()
