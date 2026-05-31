#include "gorilla.h"
#include <cstring>
#include <cmath>
#include <limits>

GorillaCompressor::GorillaCompressor()
    : first_value(0), prev_value(0), prev_xor(0), first(true), bit_pos(0) {}

void GorillaCompressor::write_bits(uint64_t value, uint8_t bits) {
    while (bits > 0) {
        if (bit_pos == 0) {
            buffer.push_back(0);
        }
        uint8_t avail = 8 - bit_pos;
        uint8_t to_write = (bits < avail) ? bits : avail;
        uint8_t shift = avail - to_write;
        uint8_t mask = ((1 << to_write) - 1) << shift;
        buffer.back() |= static_cast<uint8_t>(((value >> (bits - to_write)) << shift) & mask);
        bits -= to_write;
        bit_pos = (bit_pos + to_write) % 8;
    }
}

SpecialValueType GorillaCompressor::check_special(double value) {
    if (std::isnan(value)) {
        return SpecialValueType::NAN;
    }
    if (std::isinf(value)) {
        return value > 0 ? SpecialValueType::POS_INF : SpecialValueType::NEG_INF;
    }
    return SpecialValueType::NORMAL;
}

void GorillaCompressor::write_special_marker(SpecialValueType type) {
    write_bits(0b1111, 4);
    write_bits(static_cast<uint64_t>(type), 2);
}

void GorillaCompressor::compress(double value) {
    SpecialValueType special_type = check_special(value);

    if (first) {
        if (special_type != SpecialValueType::NORMAL) {
            value = 0.0;
        }
        uint64_t val;
        std::memcpy(&val, &value, sizeof(val));
        first_value = val;
        prev_value = val;
        write_bits(val, 64);

        if (special_type != SpecialValueType::NORMAL) {
            write_special_marker(special_type);
        }
        first = false;
        return;
    }

    if (special_type != SpecialValueType::NORMAL) {
        write_special_marker(special_type);
        return;
    }

    uint64_t val;
    std::memcpy(&val, &value, sizeof(val));

    uint64_t xor_val = prev_value ^ val;
    if (xor_val == 0) {
        write_bits(0, 1);
    } else {
        write_bits(1, 1);
        uint8_t leading = static_cast<uint8_t>(__builtin_clzll(xor_val));
        uint8_t trailing = static_cast<uint8_t>(__builtin_ctzll(xor_val));
        uint8_t meaningful = 64 - leading - trailing;

        uint8_t prev_leading = static_cast<uint8_t>(__builtin_clzll(prev_xor));
        uint8_t prev_trailing = static_cast<uint8_t>(__builtin_ctzll(prev_xor));
        uint8_t prev_meaningful = 64 - prev_leading - prev_trailing;

        if (prev_xor != 0 && leading >= prev_leading && trailing >= prev_trailing) {
            write_bits(0, 1);
            write_bits(xor_val >> trailing, prev_meaningful);
        } else {
            write_bits(1, 1);
            write_bits(leading, 5);
            write_bits(meaningful, 6);
            write_bits(xor_val >> trailing, meaningful);
        }
        prev_xor = xor_val;
    }
    prev_value = val;
}

std::vector<uint8_t> GorillaCompressor::finish() {
    write_bits(0xFFFFFFFFFFFFFFFFULL, 12);
    return buffer;
}

GorillaDecompressor::GorillaDecompressor(const std::vector<uint8_t>& data)
    : data(data), byte_pos(0), bit_pos(0), prev_value(0), prev_xor(0), first(true) {}

uint64_t GorillaDecompressor::read_bits(uint8_t bits) {
    uint64_t result = 0;
    while (bits > 0) {
        if (byte_pos >= data.size()) return 0;
        uint8_t avail = 8 - bit_pos;
        uint8_t to_read = (bits < avail) ? bits : avail;
        uint8_t shift = avail - to_read;
        uint8_t mask = ((1 << to_read) - 1) << shift;
        result = (result << to_read) | ((data[byte_pos] & mask) >> shift);
        bits -= to_read;
        bit_pos += to_read;
        if (bit_pos >= 8) {
            bit_pos = 0;
            byte_pos++;
        }
    }
    return result;
}

double GorillaDecompressor::get_special_value(SpecialValueType type) {
    switch (type) {
        case SpecialValueType::NAN:
            return std::numeric_limits<double>::quiet_NaN();
        case SpecialValueType::POS_INF:
            return std::numeric_limits<double>::infinity();
        case SpecialValueType::NEG_INF:
            return -std::numeric_limits<double>::infinity();
        default:
            return 0.0;
    }
}

void unread_bits(uint8_t& bit_pos, size_t& byte_pos, uint8_t bits) {
    while (bits > 0) {
        if (bit_pos == 0) {
            bit_pos = 8;
            byte_pos--;
        }
        uint8_t to_unread = (bits < bit_pos) ? bits : bit_pos;
        bit_pos -= to_unread;
        bits -= to_unread;
    }
}

double GorillaDecompressor::decompress() {
    if (first) {
        prev_value = read_bits(64);
        first = false;

        uint8_t saved_bit_pos = bit_pos;
        size_t saved_byte_pos = byte_pos;

        uint64_t marker = read_bits(4);
        if (marker == 0b1111) {
            uint64_t type_val = read_bits(2);
            SpecialValueType type = static_cast<SpecialValueType>(type_val);
            return get_special_value(type);
        }

        bit_pos = saved_bit_pos;
        byte_pos = saved_byte_pos;

        double val;
        std::memcpy(&val, &prev_value, sizeof(val));
        return val;
    }

    uint8_t saved_bit_pos = bit_pos;
    size_t saved_byte_pos = byte_pos;

    uint64_t prefix = read_bits(4);
    if (prefix == 0b1111) {
        uint64_t type_val = read_bits(2);
        SpecialValueType type = static_cast<SpecialValueType>(type_val);
        return get_special_value(type);
    }

    bit_pos = saved_bit_pos;
    byte_pos = saved_byte_pos;

    uint64_t control = read_bits(1);
    if (control == 0) {
        double val;
        std::memcpy(&val, &prev_value, sizeof(val));
        return val;
    }

    uint64_t control2 = read_bits(1);
    uint64_t xor_val;

    if (control2 == 0) {
        uint8_t prev_leading = static_cast<uint8_t>(__builtin_clzll(prev_xor));
        uint8_t prev_trailing = static_cast<uint8_t>(__builtin_ctzll(prev_xor));
        uint8_t prev_meaningful = 64 - prev_leading - prev_trailing;
        xor_val = read_bits(prev_meaningful) << prev_trailing;
    } else {
        uint8_t leading = static_cast<uint8_t>(read_bits(5));
        uint8_t meaningful = static_cast<uint8_t>(read_bits(6));
        uint8_t trailing = 64 - leading - meaningful;
        xor_val = read_bits(meaningful) << trailing;
        prev_xor = xor_val;
    }

    uint64_t val = prev_value ^ xor_val;
    prev_value = val;
    double dval;
    std::memcpy(&dval, &val, sizeof(dval));
    return dval;
}

bool GorillaDecompressor::has_next() {
    return byte_pos < data.size() - 2;
}
