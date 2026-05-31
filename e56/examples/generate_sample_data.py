import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import os


def generate_stock_data(symbol, start_date, end_date, initial_price=100.0):
    dates = pd.date_range(start=start_date, end=end_date, freq='D')
    dates = dates[dates.dayofweek < 5]
    
    np.random.seed(hash(symbol) % 1000)
    
    returns = np.random.normal(0.001, 0.02, size=len(dates))
    
    prices = [initial_price]
    for ret in returns[1:]:
        prices.append(prices[-1] * (1 + ret))
    
    close_prices = np.array(prices)
    
    data = []
    for i, date in enumerate(dates):
        close = close_prices[i]
        high = close * (1 + abs(np.random.normal(0, 0.01)))
        low = close * (1 - abs(np.random.normal(0, 0.01)))
        open_price = low + np.random.random() * (high - low)
        volume = int(np.random.normal(1000000, 200000))
        
        data.append({
            'timestamp': date.strftime('%Y-%m-%d'),
            'open': round(open_price, 2),
            'high': round(high, 2),
            'low': round(low, 2),
            'close': round(close, 2),
            'volume': max(100000, volume)
        })
    
    return pd.DataFrame(data)


def main():
    output_dir = os.path.dirname(os.path.abspath(__file__))
    
    symbols = ['AAPL', 'MSFT', 'GOOG']
    
    start_date = datetime(2023, 1, 1)
    end_date = datetime(2024, 12, 31)
    
    for symbol in symbols:
        df = generate_stock_data(symbol, start_date, end_date, initial_price=np.random.randint(50, 200))
        
        file_path = os.path.join(output_dir, f'{symbol}.csv')
        df.to_csv(file_path, index=False)
        
        print(f'Generated {file_path} with {len(df)} records')
    
    print('\nSample data generation completed!')
    print(f'Files saved in: {output_dir}')


if __name__ == '__main__':
    main()
