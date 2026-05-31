#pragma once
#include <cstdint>
#include <vector>

class Simple8b {
public:
    static std::vector<uint64_t> encode(const std::vector<uint64_t>& values);
    static std::vector<uint64_t> decode(const std::vector<uint64_t>& encoded, size_t count);

private:
    static const uint8_t SELECTOR_BITS = 4;
    static const uint64_t MAX_VALUE = 0x1FFFFFFFFFFFFFFFULL;
    static const uint8_t N_VALUES[];
    static const uint8_t BIT_WIDTHS[];
};
