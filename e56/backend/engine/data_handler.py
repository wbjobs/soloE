import pandas as pd
import numpy as np
from typing import Dict, List, Optional, Iterator, Tuple
from dataclasses import dataclass
from datetime import datetime
import gc


@dataclass
class OHLCV:
    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float
    symbol: str


class StreamDataIterator:
    def __init__(self, data_iterator, symbol: str):
        self.data_iterator = data_iterator
        self.symbol = symbol
        self.current_chunk = None
        self.chunk_index = 0

    def __iter__(self):
        return self

    def __next__(self) -> Optional[OHLCV]:
        if self.current_chunk is None or self.chunk_index >= len(self.current_chunk):
            try:
                self.current_chunk = next(self.data_iterator)
                self.chunk_index = 0
            except StopIteration:
                raise StopIteration
        
        row = self.current_chunk.iloc[self.chunk_index]
        self.chunk_index += 1
        
        return OHLCV(
            timestamp=row['timestamp'],
            open=float(row['open']),
            high=float(row['high']),
            low=float(row['low']),
            close=float(row['close']),
            volume=float(row['volume']),
            symbol=self.symbol
        )


class DataHandler:
    def __init__(self, use_compression: bool = True, chunk_size: int = 10000):
        self.data: Dict[str, pd.DataFrame] = {}
        self.symbols: List[str] = []
        self.use_compression = use_compression
        self.chunk_size = chunk_size
        self.data_stats: Dict[str, dict] = {}

    def _optimize_dtypes(self, df: pd.DataFrame) -> pd.DataFrame:
        if not self.use_compression:
            return df
        
        df = df.copy()
        
        df['open'] = pd.to_numeric(df['open'], downcast='float')
        df['high'] = pd.to_numeric(df['high'], downcast='float')
        df['low'] = pd.to_numeric(df['low'], downcast='float')
        df['close'] = pd.to_numeric(df['close'], downcast='float')
        df['volume'] = pd.to_numeric(df['volume'], downcast='float')
        
        if 'symbol' in df.columns:
            df['symbol'] = df['symbol'].astype('category')
        
        return df

    def load_csv(self, file_path: str, symbol: str, 
                 timestamp_col: str = 'timestamp',
                 open_col: str = 'open',
                 high_col: str = 'high',
                 low_col: str = 'low',
                 close_col: str = 'close',
                 volume_col: str = 'volume',
                 stream: bool = False) -> bool:
        try:
            if stream:
                return True
            
            df = pd.read_csv(file_path)
            
            required_cols = [timestamp_col, open_col, high_col, low_col, close_col, volume_col]
            for col in required_cols:
                if col not in df.columns:
                    raise ValueError(f"CSV缺少必要列: {col}")
            
            df[timestamp_col] = pd.to_datetime(df[timestamp_col])
            df = df.sort_values(timestamp_col).reset_index(drop=True)
            
            renamed_df = df.rename(columns={
                timestamp_col: 'timestamp',
                open_col: 'open',
                high_col: 'high',
                low_col: 'low',
                close_col: 'close',
                volume_col: 'volume'
            })
            
            renamed_df['symbol'] = symbol
            
            renamed_df = self._optimize_dtypes(renamed_df)
            
            self.data[symbol] = renamed_df
            self.symbols = list(self.data.keys())
            
            self.data_stats[symbol] = {
                'rows': len(renamed_df),
                'memory_usage_mb': renamed_df.memory_usage(deep=True).sum() / 1024 / 1024,
                'date_range': (renamed_df['timestamp'].min(), renamed_df['timestamp'].max())
            }
            
            return True
        except Exception as e:
            print(f"加载CSV失败: {e}")
            return False

    def stream_csv(self, file_path: str, symbol: str,
                   timestamp_col: str = 'timestamp',
                   open_col: str = 'open',
                   high_col: str = 'high',
                   low_col: str = 'low',
                   close_col: str = 'close',
                   volume_col: str = 'volume') -> Optional[StreamDataIterator]:
        try:
            csv_iter = pd.read_csv(
                file_path,
                chunksize=self.chunk_size,
                parse_dates=[timestamp_col]
            )
            
            def wrapped_iterator():
                for chunk in csv_iter:
                    chunk = chunk.sort_values(timestamp_col).reset_index(drop=True)
                    chunk = chunk.rename(columns={
                        timestamp_col: 'timestamp',
                        open_col: 'open',
                        high_col: 'high',
                        low_col: 'low',
                        close_col: 'close',
                        volume_col: 'volume'
                    })
                    chunk = self._optimize_dtypes(chunk)
                    yield chunk
                    gc.collect()
            
            return StreamDataIterator(wrapped_iterator(), symbol)
        except Exception as e:
            print(f"创建流式迭代器失败: {e}")
            return None

    def get_data(self, symbol: str) -> Optional[pd.DataFrame]:
        return self.data.get(symbol)

    def get_all_symbols(self) -> List[str]:
        return self.symbols

    def get_merged_data(self) -> pd.DataFrame:
        if not self.data:
            return pd.DataFrame()
        
        dfs = []
        for symbol, df in self.data.items():
            df_copy = df.copy()
            df_copy['symbol'] = symbol
            dfs.append(df_copy)
        
        merged = pd.concat(dfs, ignore_index=True)
        merged = merged.sort_values('timestamp').reset_index(drop=True)
        return merged

    def stream_merged_data(self) -> Iterator[OHLCV]:
        all_data = []
        
        for symbol in self.symbols:
            if symbol in self.data:
                df = self.data[symbol]
                for _, row in df.iterrows():
                    all_data.append((
                        row['timestamp'],
                        OHLCV(
                            timestamp=row['timestamp'],
                            open=float(row['open']),
                            high=float(row['high']),
                            low=float(row['low']),
                            close=float(row['close']),
                            volume=float(row['volume']),
                            symbol=symbol
                        )
                    ))
        
        all_data.sort(key=lambda x: x[0])
        
        for _, ohlcv in all_data:
            yield ohlcv

    def get_price_at_time(self, symbol: str, timestamp: datetime) -> Optional[float]:
        if symbol not in self.data:
            return None
        
        df = self.data[symbol]
        df_filtered = df[df['timestamp'] <= timestamp]
        if len(df_filtered) > 0:
            return float(df_filtered.iloc[-1]['close'])
        return None

    def get_data_range(self, symbol: str, start: datetime, end: datetime) -> Optional[pd.DataFrame]:
        if symbol not in self.data:
            return None
        
        df = self.data[symbol]
        return df[(df['timestamp'] >= start) & (df['timestamp'] <= end)]

    def get_memory_usage(self) -> Dict[str, float]:
        total = 0.0
        per_symbol = {}
        
        for symbol, df in self.data.items():
            mem_mb = df.memory_usage(deep=True).sum() / 1024 / 1024
            per_symbol[symbol] = mem_mb
            total += mem_mb
        
        return {
            'total_mb': total,
            'per_symbol_mb': per_symbol
        }

    def clear_data(self):
        self.data.clear()
        self.symbols.clear()
        self.data_stats.clear()
        gc.collect()
