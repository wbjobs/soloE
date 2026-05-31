#!/usr/bin/env python3
import pandas as pd
import numpy as np
from datetime import datetime, timedelta

def generate_timeseries_data(num_points=1000000, output_file='data/timeseries.csv'):
    start_time = datetime.now()
    timestamps = [int((start_time + timedelta(milliseconds=i)).timestamp() * 1000) for i in range(num_points)]

    values = []
    base_value = 100.0
    for i in range(num_points):
        seasonality = 10 * np.sin(2 * np.pi * i / 1000)
        noise = np.random.normal(0, 2)
        trend = i * 0.0001
        value = base_value + seasonality + noise + trend
        values.append(value)

    df = pd.DataFrame({
        'timestamp': timestamps,
        'value': values
    })

    df.to_csv(output_file, index=False)
    print(f"Generated {num_points} data points and saved to {output_file}")
    return df

if __name__ == '__main__':
    import sys
    num_points = int(sys.argv[1]) if len(sys.argv) > 1 else 1000000
    output_file = sys.argv[2] if len(sys.argv) > 2 else 'data/timeseries.csv'
    generate_timeseries_data(num_points, output_file)
