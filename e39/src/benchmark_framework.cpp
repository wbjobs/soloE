#include "benchmark_framework.h"
#include "simple8b.h"
#include "gorilla.h"
#include "delta_delta.h"
#include <iostream>
#include <fstream>
#include <iomanip>
#include <algorithm>
#include <cmath>
#include <windows.h>
#include <psapi.h>

size_t BenchmarkFramework::get_current_memory_usage() {
    PROCESS_MEMORY_COUNTERS_EX pmc;
    GetProcessMemoryInfo(GetCurrentProcess(), reinterpret_cast<PROCESS_MEMORY_COUNTERS*>(&pmc), sizeof(pmc));
    return pmc.PrivateUsage;
}

size_t BenchmarkFramework::get_peak_memory_usage() {
    PROCESS_MEMORY_COUNTERS_EX pmc;
    GetProcessMemoryInfo(GetCurrentProcess(), reinterpret_cast<PROCESS_MEMORY_COUNTERS*>(&pmc), sizeof(pmc));
    return pmc.PeakWorkingSetSize;
}

DataStatistics BenchmarkFramework::analyze_data(const std::vector<double>& data) {
    DataStatistics stats;
    stats.count = data.size();
    
    if (stats.count == 0) {
        stats.mean = stats.variance = stats.std_dev = stats.cv = 0;
        stats.min_val = stats.max_val = stats.range = 0;
        stats.zero_ratio = stats.repeat_ratio = 0;
        return stats;
    }

    double sum = 0;
    double min_val = data[0], max_val = data[0];
    for (double v : data) {
        sum += v;
        if (v < min_val) min_val = v;
        if (v > max_val) max_val = v;
    }
    stats.mean = sum / stats.count;
    stats.min_val = min_val;
    stats.max_val = max_val;
    stats.range = max_val - min_val;

    double var_sum = 0;
    for (double v : data) {
        double diff = v - stats.mean;
        var_sum += diff * diff;
    }
    stats.variance = var_sum / stats.count;
    stats.std_dev = std::sqrt(stats.variance);
    stats.cv = (stats.mean != 0) ? (stats.std_dev / std::abs(stats.mean)) : 0;

    size_t zero_count = 0;
    size_t repeat_count = 0;
    double prev = data[0];
    for (size_t i = 0; i < data.size(); ++i) {
        if (std::abs(data[i]) < 1e-10) zero_count++;
        if (i > 0 && std::abs(data[i] - prev) < 1e-10) repeat_count++;
        prev = data[i];
    }
    stats.zero_ratio = static_cast<double>(zero_count) / stats.count;
    stats.repeat_ratio = static_cast<double>(repeat_count) / (stats.count - 1);

    return stats;
}

double BenchmarkFramework::predict_simple8b_ratio(const DataStatistics& stats) {
    if (stats.count == 0) return 1.0;

    double normalized_range = stats.range / (std::abs(stats.mean) + 1e-10);
    double score = 1.0;

    if (normalized_range < 0.1) score += 2.5;
    else if (normalized_range < 0.5) score += 1.5;
    else if (normalized_range < 1.0) score += 0.8;

    score += stats.zero_ratio * 2.0;
    score += stats.repeat_ratio * 1.5;

    if (stats.cv < 0.01) score += 1.0;
    else if (stats.cv < 0.1) score += 0.5;

    return std::max(1.0, score);
}

double BenchmarkFramework::predict_gorilla_ratio(const DataStatistics& stats) {
    if (stats.count == 0) return 1.0;

    double score = 2.0;

    score += stats.repeat_ratio * 3.0;

    if (stats.cv < 0.001) score += 2.5;
    else if (stats.cv < 0.01) score += 1.5;
    else if (stats.cv < 0.05) score += 0.8;
    else if (stats.cv < 0.1) score += 0.3;

    double normalized_range = stats.range / (std::abs(stats.mean) + 1e-10);
    if (normalized_range < 0.01) score += 1.0;
    else if (normalized_range < 0.1) score += 0.5;

    return std::max(1.0, score);
}

double BenchmarkFramework::predict_delta_delta_ratio(const DataStatistics& stats) {
    if (stats.count == 0) return 1.0;

    double score = 1.5;

    if (stats.cv < 0.001) score += 3.0;
    else if (stats.cv < 0.01) score += 2.0;
    else if (stats.cv < 0.05) score += 1.0;
    else if (stats.cv < 0.1) score += 0.5;

    score += stats.repeat_ratio * 2.5;

    double normalized_trend = stats.range / (std::abs(stats.mean) + 1e-10);
    if (normalized_trend < 0.1) score += 0.8;

    return std::max(1.0, score);
}

std::vector<AlgorithmPrediction> BenchmarkFramework::predict_best_algorithm(const DataStatistics& stats) {
    std::vector<AlgorithmPrediction> predictions;

    AlgorithmPrediction p_simple8b;
    p_simple8b.algorithm = "Simple8b";
    p_simple8b.predicted_ratio = predict_simple8b_ratio(stats);
    p_simple8b.confidence_score = 0.7;
    
    if (stats.zero_ratio > 0.3) {
        p_simple8b.reason = "高零值比例 (" + std::to_string(static_cast<int>(stats.zero_ratio * 100)) + "%)";
    } else if (stats.cv < 0.1) {
        p_simple8b.reason = "低变异系数 (CV=" + std::to_string(stats.cv).substr(0, 4) + ")";
    } else {
        p_simple8b.reason = "小整数范围数据";
    }
    predictions.push_back(p_simple8b);

    AlgorithmPrediction p_gorilla;
    p_gorilla.algorithm = "Gorilla";
    p_gorilla.predicted_ratio = predict_gorilla_ratio(stats);
    p_gorilla.confidence_score = 0.85;
    
    if (stats.repeat_ratio > 0.5) {
        p_gorilla.reason = "高重复率 (" + std::to_string(static_cast<int>(stats.repeat_ratio * 100)) + "%)";
    } else if (stats.cv < 0.05) {
        p_gorilla.reason = "时间序列低波动 (CV=" + std::to_string(stats.cv).substr(0, 4) + ")";
    } else {
        p_gorilla.reason = "浮点数时序数据";
    }
    predictions.push_back(p_gorilla);

    AlgorithmPrediction p_delta;
    p_delta.algorithm = "Delta-of-Delta";
    p_delta.predicted_ratio = predict_delta_delta_ratio(stats);
    p_delta.confidence_score = 0.8;
    
    if (stats.cv < 0.01) {
        p_delta.reason = "极平稳趋势 (CV=" + std::to_string(stats.cv).substr(0, 5) + ")";
    } else if (stats.range / (std::abs(stats.mean) + 1e-10) < 0.1) {
        p_delta.reason = "数值范围紧凑";
    } else {
        p_delta.reason = "单调趋势时间戳";
    }
    predictions.push_back(p_delta);

    std::sort(predictions.begin(), predictions.end(),
        [](const AlgorithmPrediction& a, const AlgorithmPrediction& b) {
            return a.predicted_ratio > b.predicted_ratio;
        });

    return predictions;
}

BenchmarkResult BenchmarkFramework::run_simple8b(const std::vector<uint64_t>& data) {
    BenchmarkResult result;
    result.algorithm = "Simple8b";
    result.original_size = data.size() * sizeof(uint64_t);

    size_t mem_before = get_peak_memory_usage();

    std::vector<uint64_t> compressed;
    double comp_time = measure_time([&]() {
        compressed = Simple8b::encode(data);
    });

    result.compressed_size = compressed.size() * sizeof(uint64_t);
    result.compression_ratio = static_cast<double>(result.original_size) / result.compressed_size;
    result.compression_speed_mbs = result.original_size / (1024.0 * 1024.0) / comp_time;

    std::vector<uint64_t> decompressed;
    double decomp_time = measure_time([&]() {
        decompressed = Simple8b::decode(compressed, data.size());
    });

    result.decompression_speed_mbs = result.original_size / (1024.0 * 1024.0) / decomp_time;
    result.peak_memory_bytes = get_peak_memory_usage() - mem_before;

    return result;
}

BenchmarkResult BenchmarkFramework::run_gorilla(const std::vector<double>& data) {
    BenchmarkResult result;
    result.algorithm = "Gorilla";
    result.original_size = data.size() * sizeof(double);

    size_t mem_before = get_peak_memory_usage();

    std::vector<uint8_t> compressed;
    double comp_time = measure_time([&]() {
        GorillaCompressor compressor;
        for (double v : data) {
            compressor.compress(v);
        }
        compressed = compressor.finish();
    });

    result.compressed_size = compressed.size();
    result.compression_ratio = static_cast<double>(result.original_size) / result.compressed_size;
    result.compression_speed_mbs = result.original_size / (1024.0 * 1024.0) / comp_time;

    double decomp_time = measure_time([&]() {
        GorillaDecompressor decompressor(compressed);
        for (size_t i = 0; i < data.size() && decompressor.has_next(); ++i) {
            decompressor.decompress();
        }
    });

    result.decompression_speed_mbs = result.original_size / (1024.0 * 1024.0) / decomp_time;
    result.peak_memory_bytes = get_peak_memory_usage() - mem_before;

    return result;
}

BenchmarkResult BenchmarkFramework::run_delta_delta(const std::vector<int64_t>& data) {
    BenchmarkResult result;
    result.algorithm = "Delta-of-Delta";
    result.original_size = data.size() * sizeof(int64_t);

    size_t mem_before = get_peak_memory_usage();

    std::vector<uint8_t> compressed;
    double comp_time = measure_time([&]() {
        DeltaDeltaCompressor compressor;
        for (int64_t v : data) {
            compressor.compress(v);
        }
        compressed = compressor.finish();
    });

    result.compressed_size = compressed.size();
    result.compression_ratio = static_cast<double>(result.original_size) / result.compressed_size;
    result.compression_speed_mbs = result.original_size / (1024.0 * 1024.0) / comp_time;

    double decomp_time = measure_time([&]() {
        DeltaDeltaDecompressor decompressor(compressed);
        for (size_t i = 0; i < data.size() && decompressor.has_next(); ++i) {
            decompressor.decompress();
        }
    });

    result.decompression_speed_mbs = result.original_size / (1024.0 * 1024.0) / decomp_time;
    result.peak_memory_bytes = get_peak_memory_usage() - mem_before;

    return result;
}

void BenchmarkFramework::print_results(const std::vector<BenchmarkResult>& results, 
                                        const DataStatistics& stats,
                                        const std::vector<AlgorithmPrediction>& predictions) {
    std::cout << "\n";
    std::cout << "==================================================" << std::endl;
    std::cout << "    Time Series Compression Benchmark Results" << std::endl;
    std::cout << "==================================================" << std::endl;
    std::cout << "\n";

    std::cout << "Data Statistics:" << std::endl;
    std::cout << "  Data Points:      " << stats.count << std::endl;
    std::cout << "  Mean Value:       " << std::fixed << std::setprecision(4) << stats.mean << std::endl;
    std::cout << "  Std Deviation:    " << std::fixed << std::setprecision(4) << stats.std_dev << std::endl;
    std::cout << "  Variation (CV):   " << std::fixed << std::setprecision(4) << stats.cv << std::endl;
    std::cout << "  Value Range:      [" << std::fixed << std::setprecision(2) << stats.min_val << ", " << stats.max_val << "]" << std::endl;
    std::cout << "  Zero Ratio:       " << std::fixed << std::setprecision(1) << stats.zero_ratio * 100 << "%" << std::endl;
    std::cout << "  Repeat Ratio:     " << std::fixed << std::setprecision(1) << stats.repeat_ratio * 100 << "%" << std::endl;
    std::cout << "--------------------------------------------------" << std::endl;
    std::cout << "\n";

    std::cout << "Algorithm Recommendations (based on data patterns):" << std::endl;
    std::cout << "\n";
    for (size_t i = 0; i < predictions.size(); ++i) {
        const auto& p = predictions[i];
        std::string rank = (i == 0) ? "★ BEST" : "  " + std::to_string(i + 1);
        std::cout << rank << ". " << std::setw(16) << std::left << p.algorithm 
                  << "  Predicted: " << std::fixed << std::setprecision(2) << p.predicted_ratio << ":1"
                  << "  (" << p.reason << ")" << std::endl;
    }
    std::cout << "--------------------------------------------------" << std::endl;
    std::cout << "\n";

    std::cout << "Actual Benchmark Results:" << std::endl;
    std::cout << "\n";
    for (const auto& r : results) {
        double pred_ratio = 0;
        for (const auto& p : predictions) {
            if (p.algorithm == r.algorithm) {
                pred_ratio = p.predicted_ratio;
                break;
            }
        }
        
        std::cout << "● " << r.algorithm << std::endl;
        std::cout << "  Original Size:    " << r.original_size / 1024 << " KB" << std::endl;
        std::cout << "  Compressed Size:  " << r.compressed_size / 1024 << " KB" << std::endl;
        std::cout << "  Compression Ratio: " << std::fixed << std::setprecision(2) << r.compression_ratio << ":1";
        if (pred_ratio > 0) {
            double diff = r.compression_ratio - pred_ratio;
            std::cout << "  (Predicted: " << std::fixed << std::setprecision(2) << pred_ratio << ":1";
            std::cout << ", Error: " << std::fixed << std::setprecision(2) << (diff / pred_ratio * 100) << "%)";
        }
        std::cout << std::endl;
        std::cout << "  Compression Speed: " << std::fixed << std::setprecision(2) << r.compression_speed_mbs << " MB/s" << std::endl;
        std::cout << "  Decompression Speed: " << std::fixed << std::setprecision(2) << r.decompression_speed_mbs << " MB/s" << std::endl;
        std::cout << "  Peak Memory Usage: " << r.peak_memory_bytes / 1024 << " KB" << std::endl;
        std::cout << "--------------------------------------------------" << std::endl;
    }
}

void BenchmarkFramework::save_results(const std::vector<BenchmarkResult>& results, 
                                       const DataStatistics& stats,
                                       const std::vector<AlgorithmPrediction>& predictions,
                                       const std::string& filename) {
    std::ofstream file(filename);
    if (!file.is_open()) {
        std::cerr << "Error: Could not open file " << filename << std::endl;
        return;
    }

    file << "# Data Statistics\n";
    file << "data_points," << stats.count << "\n";
    file << "mean_value," << std::fixed << std::setprecision(8) << stats.mean << "\n";
    file << "std_deviation," << std::fixed << std::setprecision(8) << stats.std_dev << "\n";
    file << "coefficient_of_variation," << std::fixed << std::setprecision(8) << stats.cv << "\n";
    file << "min_value," << std::fixed << std::setprecision(8) << stats.min_val << "\n";
    file << "max_value," << std::fixed << std::setprecision(8) << stats.max_val << "\n";
    file << "zero_ratio," << std::fixed << std::setprecision(8) << stats.zero_ratio << "\n";
    file << "repeat_ratio," << std::fixed << std::setprecision(8) << stats.repeat_ratio << "\n";
    file << "\n";

    file << "# Algorithm Predictions\n";
    file << "algorithm,predicted_ratio,confidence,reason\n";
    for (const auto& p : predictions) {
        file << p.algorithm << ","
             << std::fixed << std::setprecision(6) << p.predicted_ratio << ","
             << std::fixed << std::setprecision(3) << p.confidence_score << ",\""
             << p.reason << "\"\n";
    }
    file << "\n";

    file << "# Benchmark Results\n";
    file << "algorithm,original_size_bytes,compressed_size_bytes,compression_ratio,"
         << "compression_speed_mbs,decompression_speed_mbs,peak_memory_bytes\n";

    for (const auto& r : results) {
        file << r.algorithm << ","
             << r.original_size << ","
             << r.compressed_size << ","
             << r.compression_ratio << ","
             << r.compression_speed_mbs << ","
             << r.decompression_speed_mbs << ","
             << r.peak_memory_bytes << "\n";
    }

    std::cout << "Results saved to " << filename << std::endl;
}
