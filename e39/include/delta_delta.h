#pragma once
#include <cstdint>
#include <vector>

class DeltaDeltaCompressor {
public:
    DeltaDeltaCompressor();
    void compress(int64_t value);
    std::vector<uint8_t> finish();

private:
    int64_t prev_value;
    int64_t prev_delta;
    bool first;
    bool second;
    std::vector<uint8_t> buffer;

    void write_varint(int64_t value);
};

class DeltaDeltaDecompressor {
public:
    DeltaDeltaDecompressor(const std::vector<uint8_t>& data);
    int64_t decompress();
    bool has_next();

private:
    const std::vector<uint8_t>& data;
    size_t pos;
    int64_t prev_value;
    int64_t prev_delta;
    bool first;
    bool second;

    int64_t read_varint();
};
