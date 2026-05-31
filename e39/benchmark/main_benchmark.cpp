#include <benchmark/benchmark.h>
#include "simple8b.h"
#include "gorilla.h"
#include "delta_delta.h"
#include <vector>
#include <random>

static std::vector<uint64_t> generate_uint64_data(size_t n) {
    std::random_device rd;
    std::mt19937 gen(rd());
    std::uniform_int_distribution<uint64_t> d(0, 1000000);
    std::vector<uint64_t> data(n);
    for (size_t i = 0; i < n; ++i) {
        data[i] = d(gen);
    }
    return data;
}

static std::vector<double> generate_double_data(size_t n) {
    std::random_device rd;
    std::mt19937 gen(rd());
    std::normal_distribution<> d(100, 10);
    std::vector<double> data(n);
    for (size_t i = 0; i < n; ++i) {
        data[i] = d(gen);
    }
    return data;
}

static std::vector<int64_t> generate_int64_data(size_t n) {
    std::random_device rd;
    std::mt19937 gen(rd());
    std::uniform_int_distribution<int64_t> d(0, 1000000);
    std::vector<int64_t> data(n);
    for (size_t i = 0; i < n; ++i) {
        data[i] = d(gen);
    }
    return data;
}

static void BM_Simple8b_Encode(benchmark::State& state) {
    auto data = generate_uint64_data(state.range(0));
    for (auto _ : state) {
        auto compressed = Simple8b::encode(data);
        benchmark::DoNotOptimize(compressed);
    }
    state.SetBytesProcessed(int64_t(state.iterations()) * data.size() * sizeof(uint64_t));
}

static void BM_Simple8b_Decode(benchmark::State& state) {
    auto data = generate_uint64_data(state.range(0));
    auto compressed = Simple8b::encode(data);
    for (auto _ : state) {
        auto decompressed = Simple8b::decode(compressed, data.size());
        benchmark::DoNotOptimize(decompressed);
    }
    state.SetBytesProcessed(int64_t(state.iterations()) * data.size() * sizeof(uint64_t));
}

static void BM_Gorilla_Compress(benchmark::State& state) {
    auto data = generate_double_data(state.range(0));
    for (auto _ : state) {
        GorillaCompressor compressor;
        for (double v : data) {
            compressor.compress(v);
        }
        auto compressed = compressor.finish();
        benchmark::DoNotOptimize(compressed);
    }
    state.SetBytesProcessed(int64_t(state.iterations()) * data.size() * sizeof(double));
}

static void BM_Gorilla_Decompress(benchmark::State& state) {
    auto data = generate_double_data(state.range(0));
    GorillaCompressor compressor;
    for (double v : data) {
        compressor.compress(v);
    }
    auto compressed = compressor.finish();
    for (auto _ : state) {
        GorillaDecompressor decompressor(compressed);
        for (size_t i = 0; i < data.size() && decompressor.has_next(); ++i) {
            benchmark::DoNotOptimize(decompressor.decompress());
        }
    }
    state.SetBytesProcessed(int64_t(state.iterations()) * data.size() * sizeof(double));
}

static void BM_DeltaDelta_Compress(benchmark::State& state) {
    auto data = generate_int64_data(state.range(0));
    for (auto _ : state) {
        DeltaDeltaCompressor compressor;
        for (int64_t v : data) {
            compressor.compress(v);
        }
        auto compressed = compressor.finish();
        benchmark::DoNotOptimize(compressed);
    }
    state.SetBytesProcessed(int64_t(state.iterations()) * data.size() * sizeof(int64_t));
}

static void BM_DeltaDelta_Decompress(benchmark::State& state) {
    auto data = generate_int64_data(state.range(0));
    DeltaDeltaCompressor compressor;
    for (int64_t v : data) {
        compressor.compress(v);
    }
    auto compressed = compressor.finish();
    for (auto _ : state) {
        DeltaDeltaDecompressor decompressor(compressed);
        for (size_t i = 0; i < data.size() && decompressor.has_next(); ++i) {
            benchmark::DoNotOptimize(decompressor.decompress());
        }
    }
    state.SetBytesProcessed(int64_t(state.iterations()) * data.size() * sizeof(int64_t));
}

BENCHMARK(BM_Simple8b_Encode)->Arg(10000)->Arg(100000)->Arg(1000000);
BENCHMARK(BM_Simple8b_Decode)->Arg(10000)->Arg(100000)->Arg(1000000);
BENCHMARK(BM_Gorilla_Compress)->Arg(10000)->Arg(100000)->Arg(1000000);
BENCHMARK(BM_Gorilla_Decompress)->Arg(10000)->Arg(100000)->Arg(1000000);
BENCHMARK(BM_DeltaDelta_Compress)->Arg(10000)->Arg(100000)->Arg(1000000);
BENCHMARK(BM_DeltaDelta_Decompress)->Arg(10000)->Arg(100000)->Arg(1000000);

BENCHMARK_MAIN();
