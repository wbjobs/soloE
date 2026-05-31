#pragma once
#include <string>
#include <chrono>
#include <cstddef>
#include <functional>
#include <vector>

struct DataStatistics {
    size_t count;
    double mean;
    double variance;
    double std_dev;
    double cv;
    double min_val;
    double max_val;
    double range;
    double zero_ratio;
    double repeat_ratio;
};

struct AlgorithmPrediction {
    std::string algorithm;
    double predicted_ratio;
    double confidence_score;
    std::string reason;
};

struct BenchmarkResult {
    std::string algorithm;
    double compression_ratio;
    double compression_speed_mbs;
    double decompression_speed_mbs;
    size_t peak_memory_bytes;
    size_t original_size;
    size_t compressed_size;
};

class BenchmarkFramework {
public:
    static DataStatistics analyze_data(const std::vector<double>& data);
    static std::vector<AlgorithmPrediction> predict_best_algorithm(const DataStatistics& stats);

    static BenchmarkResult run_simple8b(const std::vector<uint64_t>& data);
    static BenchmarkResult run_gorilla(const std::vector<double>& data);
    static BenchmarkResult run_delta_delta(const std::vector<int64_t>& data);

    static void print_results(const std::vector<BenchmarkResult>& results, 
                              const DataStatistics& stats,
                              const std::vector<AlgorithmPrediction>& predictions);
    static void save_results(const std::vector<BenchmarkResult>& results, 
                             const DataStatistics& stats,
                             const std::vector<AlgorithmPrediction>& predictions,
                             const std::string& filename);

private:
    static size_t get_current_memory_usage();
    static size_t get_peak_memory_usage();

    static double predict_simple8b_ratio(const DataStatistics& stats);
    static double predict_gorilla_ratio(const DataStatistics& stats);
    static double predict_delta_delta_ratio(const DataStatistics& stats);

    template<typename F>
    static double measure_time(F&& func) {
        auto start = std::chrono::high_resolution_clock::now();
        func();
        auto end = std::chrono::high_resolution_clock::now();
        std::chrono::duration<double> diff = end - start;
        return diff.count();
    }
};
