#include "delta_delta.h"
#include <cstdint>

DeltaDeltaCompressor::DeltaDeltaCompressor()
    : prev_value(0), prev_delta(0), first(true), second(false) {}

void DeltaDeltaCompressor::write_varint(int64_t value) {
    uint64_t uvalue = static_cast<uint64_t>((value << 1) ^ (value >> 63));
    while (uvalue >= 0x80) {
        buffer.push_back(static_cast<uint8_t>(uvalue | 0x80));
        uvalue >>= 7;
    }
    buffer.push_back(static_cast<uint8_t>(uvalue));
}

void DeltaDeltaCompressor::compress(int64_t value) {
    if (first) {
        write_varint(value);
        prev_value = value;
        first = false;
        second = true;
        return;
    }
    if (second) {
        int64_t delta = value - prev_value;
        write_varint(delta);
        prev_delta = delta;
        prev_value = value;
        second = false;
        return;
    }
    int64_t delta = value - prev_value;
    int64_t delta_of_delta = delta - prev_delta;
    write_varint(delta_of_delta);
    prev_delta = delta;
    prev_value = value;
}

std::vector<uint8_t> DeltaDeltaCompressor::finish() {
    return buffer;
}

DeltaDeltaDecompressor::DeltaDeltaDecompressor(const std::vector<uint8_t>& data)
    : data(data), pos(0), prev_value(0), prev_delta(0), first(true), second(false) {}

int64_t DeltaDeltaDecompressor::read_varint() {
    uint64_t result = 0;
    int shift = 0;
    while (pos < data.size()) {
        uint8_t b = data[pos++];
        result |= static_cast<uint64_t>(b & 0x7F) << shift;
        if (!(b & 0x80)) break;
        shift += 7;
    }
    int64_t signed_val = static_cast<int64_t>((result >> 1) ^ -(result & 1));
    return signed_val;
}

int64_t DeltaDeltaDecompressor::decompress() {
    if (first) {
        prev_value = read_varint();
        first = false;
        second = true;
        return prev_value;
    }
    if (second) {
        prev_delta = read_varint();
        prev_value += prev_delta;
        second = false;
        return prev_value;
    }
    int64_t delta_of_delta = read_varint();
    prev_delta += delta_of_delta;
    prev_value += prev_delta;
    return prev_value;
}

bool DeltaDeltaDecompressor::has_next() {
    return pos < data.size();
}
