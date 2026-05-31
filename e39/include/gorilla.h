#pragma once
#include <cstdint>
#include <vector>

enum class SpecialValueType : uint8_t {
    NORMAL = 0,
    NAN = 1,
    POS_INF = 2,
    NEG_INF = 3
};

class GorillaCompressor {
public:
    GorillaCompressor();
    void compress(double value);
    std::vector<uint8_t> finish();

private:
    uint64_t first_value;
    uint64_t prev_value;
    uint64_t prev_xor;
    bool first;
    std::vector<uint8_t> buffer;
    uint8_t bit_pos;

    SpecialValueType check_special(double value);
    void write_special_marker(SpecialValueType type);
    void write_bits(uint64_t value, uint8_t bits);
};

class GorillaDecompressor {
public:
    GorillaDecompressor(const std::vector<uint8_t>& data);
    double decompress();
    bool has_next();

private:
    const std::vector<uint8_t>& data;
    size_t byte_pos;
    uint8_t bit_pos;
    uint64_t prev_value;
    uint64_t prev_xor;
    bool first;

    double get_special_value(SpecialValueType type);
    uint64_t read_bits(uint8_t bits);
};
