#include "simple8b.h"
#include <algorithm>
#include <cstring>

const uint8_t Simple8b::N_VALUES[] = {240, 120, 60, 30, 20, 15, 12, 10, 8, 7, 6, 5, 4, 3, 2, 1};
const uint8_t Simple8b::BIT_WIDTHS[] = {0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20, 30, 60};

std::vector<uint64_t> Simple8b::encode(const std::vector<uint64_t>& values) {
    std::vector<uint64_t> encoded;
    size_t i = 0;
    size_t n = values.size();

    while (i < n) {
        bool found = false;
        for (int s = 0; s < 16; ++s) {
            size_t n_vals = N_VALUES[s];
            uint8_t bit_width = BIT_WIDTHS[s];
            uint64_t max_val = (bit_width == 0) ? 0 : ((1ULL << bit_width) - 1);

            size_t end = std::min(i + n_vals, n);
            bool ok = true;
            for (size_t j = i; j < end; ++j) {
                if (values[j] > max_val) {
                    ok = false;
                    break;
                }
            }

            if (ok) {
                uint64_t word = static_cast<uint64_t>(s);
                size_t shift = SELECTOR_BITS;
                for (size_t j = i; j < end; ++j) {
                    word |= (values[j] << shift);
                    shift += bit_width;
                }
                encoded.push_back(word);
                i += n_vals;
                found = true;
                break;
            }
        }
        if (!found) {
            uint64_t word = 15ULL;
            word |= (values[i] << SELECTOR_BITS);
            encoded.push_back(word);
            i++;
        }
    }
    return encoded;
}

std::vector<uint64_t> Simple8b::decode(const std::vector<uint64_t>& encoded, size_t count) {
    std::vector<uint64_t> decoded;
    decoded.reserve(count);

    for (uint64_t word : encoded) {
        uint8_t selector = static_cast<uint8_t>(word & 0xF);
        size_t n_vals = N_VALUES[selector];
        uint8_t bit_width = BIT_WIDTHS[selector];
        uint64_t mask = (bit_width == 0) ? 0 : ((1ULL << bit_width) - 1);

        size_t shift = SELECTOR_BITS;
        for (size_t j = 0; j < n_vals && decoded.size() < count; ++j) {
            uint64_t val = (word >> shift) & mask;
            decoded.push_back(val);
            shift += bit_width;
        }
    }
    return decoded;
}
