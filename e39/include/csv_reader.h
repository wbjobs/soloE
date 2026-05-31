#pragma once
#include <vector>
#include <string>
#include <cstdint>

struct TimeSeriesData {
    std::vector<int64_t> timestamps;
    std::vector<double> values;
    size_t size() const { return timestamps.size(); }
};

class CSVReader {
public:
    static TimeSeriesData read(const std::string& filename, size_t max_rows = 0);
    static std::vector<uint64_t> to_uint64(const std::vector<double>& values);
    static std::vector<int64_t> to_int64(const std::vector<double>& values);
};
