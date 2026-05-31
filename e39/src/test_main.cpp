#include "csv_reader.h"
#include "benchmark_framework.h"
#include <iostream>
#include <random>
#include <string>
#include <cmath>

int main(int argc, char* argv[]) {
    std::string csv_file = "data/timeseries.csv";
    std::string data_pattern = "normal";

    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];
        if (arg == "--pattern" && i + 1 < argc) {
            data_pattern = argv[++i];
        } else if (arg.find(".csv") != std::string::npos) {
            csv_file = arg;
        }
    }

    TimeSeriesData data = CSVReader::read(csv_file);

    if (data.size() == 0) {
        std::cout << "No data loaded. Generating test data with pattern: " << data_pattern << "..." << std::endl;
        std::random_device rd;
        std::mt19937 gen(rd());

        const size_t test_size = 1000000;
        data.timestamps.resize(test_size);
        data.values.resize(test_size);

        if (data_pattern == "stable") {
            std::cout << "  Pattern: Very stable time series (low volatility)" << std::endl;
            for (size_t i = 0; i < test_size; ++i) {
                data.timestamps[i] = static_cast<int64_t>(i);
                data.values[i] = 100.0 + i * 0.0001;
            }
        } else if (data_pattern == "periodic") {
            std::cout << "  Pattern: Periodic time series with high repeatability" << std::endl;
            for (size_t i = 0; i < test_size; ++i) {
                data.timestamps[i] = static_cast<int64_t>(i);
                data.values[i] = 100.0 + 5.0 * std::sin(i * 0.001);
            }
        } else if (data_pattern == "sparse") {
            std::cout << "  Pattern: Sparse data with many zeros" << std::endl;
            std::uniform_int_distribution<> d(0, 100);
            for (size_t i = 0; i < test_size; ++i) {
                data.timestamps[i] = static_cast<int64_t>(i);
                data.values[i] = (d(gen) > 70) ? static_cast<double>(d(gen)) : 0.0;
            }
        } else {
            std::cout << "  Pattern: Normal distribution time series" << std::endl;
            std::normal_distribution<> d(100, 10);
            for (size_t i = 0; i < test_size; ++i) {
                data.timestamps[i] = static_cast<int64_t>(i);
                data.values[i] = d(gen);
            }
        }
        std::cout << "Generated " << test_size << " test data points" << std::endl;
    }

    std::cout << "\nAnalyzing data patterns..." << std::endl;
    DataStatistics stats = BenchmarkFramework::analyze_data(data.values);

    std::cout << "\nPredicting best algorithm based on data statistics..." << std::endl;
    std::vector<AlgorithmPrediction> predictions = BenchmarkFramework::predict_best_algorithm(stats);

    std::vector<uint64_t> uint_data = CSVReader::to_uint64(data.values);
    std::vector<int64_t> int_data = CSVReader::to_int64(data.values);

    std::vector<BenchmarkResult> results;

    std::cout << "\nRunning Simple8b benchmark..." << std::endl;
    results.push_back(BenchmarkFramework::run_simple8b(uint_data));

    std::cout << "Running Gorilla benchmark..." << std::endl;
    results.push_back(BenchmarkFramework::run_gorilla(data.values));

    std::cout << "Running Delta-of-Delta benchmark..." << std::endl;
    results.push_back(BenchmarkFramework::run_delta_delta(int_data));

    BenchmarkFramework::print_results(results, stats, predictions);
    BenchmarkFramework::save_results(results, stats, predictions, "benchmark_results.csv");

    return 0;
}
