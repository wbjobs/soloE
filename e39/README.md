# Time Series Compression Benchmark

A C++ framework for benchmarking time series compression algorithms, supporting Simple8b, Gorilla, and Delta-of-Delta compression.

## Algorithms Implemented

### 1. Simple8b
- Packs multiple integers into 64-bit words
- Best for integer data with small values
- 16 different selectors for varying bit widths

### 2. Gorilla Compression
- Facebook's time series compression algorithm
- XOR encoding with leading/trailing zero compression
- Best for floating-point time series data

### 3. Delta-of-Delta
- Two-level delta encoding
- Varint encoding for compressed deltas
- Best for timestamp and slowly changing values

## Project Structure

```
├── include/              # Header files
│   ├── simple8b.h
│   ├── gorilla.h
│   ├── delta_delta.h
│   ├── csv_reader.h
│   └── benchmark_framework.h
├── src/                  # Source files
│   ├── compression/      # Compression algorithm implementations
│   │   ├── simple8b.cpp
│   │   ├── gorilla.cpp
│   │   └── delta_delta.cpp
│   ├── csv_reader.cpp
│   ├── benchmark_framework.cpp
│   └── test_main.cpp
├── benchmark/            # Google Benchmark tests
│   └── main_benchmark.cpp
├── scripts/              # Python scripts for plotting and data generation
│   ├── plot_results.py
│   └── generate_sample_data.py
├── data/                 # CSV data files
└── CMakeLists.txt
```

## Dependencies

### C++ Dependencies
- CMake 3.14 or higher
- C++17 compliant compiler
- Google Benchmark library

### Python Dependencies
- pandas
- matplotlib
- numpy

## Build Instructions

### Windows (using Visual Studio)

```bash
mkdir build
cd build
cmake ..
cmake --build . --config Release
```

### Installing Google Benchmark

```bash
# Using vcpkg
vcpkg install benchmark:x64-windows

# Or build from source
git clone https://github.com/google/benchmark.git
cd benchmark
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release
cmake --install build
```

## Usage

### 1. Generate Sample Data

```bash
python scripts/generate_sample_data.py 1000000 data/timeseries.csv
```

### 2. Run Custom Benchmark

```bash
cd build/Release
./test_compression.exe [path_to_csv_file]
```

This will:
- Load CSV data (or generate test data if no file found)
- Run all three compression algorithms
- Measure compression ratio, speed, decompression speed, and memory usage
- Print results to console
- Save results to `benchmark_results.csv`

### 3. Run Google Benchmark

```bash
cd build/Release
./ts_compression_benchmark.exe
```

### 4. Generate Comparison Charts

```bash
python scripts/plot_results.py [benchmark_results.csv]
```

This generates:
- `compression_comparison.png`: 2x2 grid of bar charts
- `radar_comparison.png`: Normalized radar chart

## CSV Format

The input CSV file should have the following format:

```
timestamp,value
1620000000000,100.5
1620000001000,101.2
1620000002000,99.8
...
```

- `timestamp`: Unix timestamp in milliseconds (int64)
- `value`: Time series value (double)

## Benchmark Metrics

Each algorithm is evaluated on:

1. **Compression Ratio**: Original size / Compressed size (higher is better)
2. **Compression Speed**: MB processed per second (higher is better)
3. **Decompression Speed**: MB processed per second (higher is better)
4. **Peak Memory Usage**: Maximum memory allocated during compression/decompression (lower is better)

## Example Output

```
Loaded 1000000 data points from data/timeseries.csv

Running Simple8b benchmark...
Running Gorilla benchmark...
Running Delta-of-Delta benchmark...

==================================================
    Time Series Compression Benchmark Results
==================================================

Algorithm: Simple8b
  Original Size:    7812 KB
  Compressed Size:  4096 KB
  Compression Ratio: 1.91:1
  Compression Speed: 245.62 MB/s
  Decompression Speed: 512.34 MB/s
  Peak Memory Usage: 12288 KB
--------------------------------------------------
Algorithm: Gorilla
  ...
```

## Performance Notes

- **Simple8b**: Fastest compression/decompression, best for integer data
- **Gorilla**: Best compression ratio for floating-point time series
- **Delta-of-Delta**: Best for timestamps and slowly changing values

## License

MIT License
