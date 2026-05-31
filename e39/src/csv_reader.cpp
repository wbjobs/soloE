#include "csv_reader.h"
#include <fstream>
#include <sstream>
#include <iostream>
#include <limits>

TimeSeriesData CSVReader::read(const std::string& filename, size_t max_rows) {
    TimeSeriesData data;
    std::ifstream file(filename);
    if (!file.is_open()) {
        std::cerr << "Error: Could not open file " << filename << std::endl;
        return data;
    }

    std::string line;
    std::getline(file, line);

    while (std::getline(file, line)) {
        if (max_rows > 0 && data.timestamps.size() >= max_rows) break;

        std::stringstream ss(line);
        std::string token;
        std::vector<std::string> tokens;

        while (std::getline(ss, token, ',')) {
            tokens.push_back(token);
        }

        if (tokens.size() >= 2) {
            try {
                int64_t timestamp = std::stoll(tokens[0]);
                double value = std::stod(tokens[1]);
                data.timestamps.push_back(timestamp);
                data.values.push_back(value);
            } catch (...) {
                continue;
            }
        }
    }

    std::cout << "Loaded " << data.size() << " data points from " << filename << std::endl;
    return data;
}

std::vector<uint64_t> CSVReader::to_uint64(const std::vector<double>& values) {
    std::vector<uint64_t> result;
    result.reserve(values.size());
    for (double v : values) {
        uint64_t val;
        std::memcpy(&val, &v, sizeof(val));
        result.push_back(val);
    }
    return result;
}

std::vector<int64_t> CSVReader::to_int64(const std::vector<double>& values) {
    std::vector<int64_t> result;
    result.reserve(values.size());
    for (double v : values) {
        result.push_back(static_cast<int64_t>(v * 1000));
    }
    return result;
}
