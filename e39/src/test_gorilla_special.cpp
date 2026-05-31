#include "gorilla.h"
#include <iostream>
#include <vector>
#include <cmath>
#include <limits>

bool are_doubles_equal(double a, double b) {
    if (std::isnan(a) && std::isnan(b)) return true;
    if (std::isinf(a) && std::isinf(b)) {
        return (a > 0 && b > 0) || (a < 0 && b < 0);
    }
    return std::abs(a - b) < 1e-10;
}

int main() {
    std::cout << "Testing Gorilla compression with special values (NaN, Inf)...\n\n";

    std::vector<double> test_data = {
        100.0,
        101.5,
        std::numeric_limits<double>::quiet_NaN(),
        102.3,
        std::numeric_limits<double>::infinity(),
        103.7,
        -std::numeric_limits<double>::infinity(),
        104.2,
        105.0
    };

    std::cout << "Original data:\n";
    for (size_t i = 0; i < test_data.size(); ++i) {
        double v = test_data[i];
        if (std::isnan(v)) {
            std::cout << "  [" << i << "] NaN\n";
        } else if (std::isinf(v)) {
            std::cout << "  [" << i << "] " << (v > 0 ? "+Inf" : "-Inf") << "\n";
        } else {
            std::cout << "  [" << i << "] " << v << "\n";
        }
    }

    std::cout << "\nCompressing...\n";
    GorillaCompressor compressor;
    for (double v : test_data) {
        compressor.compress(v);
    }
    std::vector<uint8_t> compressed = compressor.finish();
    std::cout << "Compressed size: " << compressed.size() << " bytes\n";

    std::cout << "\nDecompressing...\n";
    GorillaDecompressor decompressor(compressed);
    std::vector<double> decompressed;

    for (size_t i = 0; i < test_data.size() && decompressor.has_next(); ++i) {
        double v = decompressor.decompress();
        decompressed.push_back(v);
    }

    std::cout << "Decompressed data:\n";
    for (size_t i = 0; i < decompressed.size(); ++i) {
        double v = decompressed[i];
        if (std::isnan(v)) {
            std::cout << "  [" << i << "] NaN\n";
        } else if (std::isinf(v)) {
            std::cout << "  [" << i << "] " << (v > 0 ? "+Inf" : "-Inf") << "\n";
        } else {
            std::cout << "  [" << i << "] " << v << "\n";
        }
    }

    std::cout << "\nVerification:\n";
    bool all_passed = true;
    for (size_t i = 0; i < test_data.size() && i < decompressed.size(); ++i) {
        bool match = are_doubles_equal(test_data[i], decompressed[i]);
        if (!match) {
            all_passed = false;
        }
        std::cout << "  [" << i << "] " << (match ? "PASS" : "FAIL") << "\n";
    }

    if (test_data.size() != decompressed.size()) {
        std::cout << "  Size mismatch: expected " << test_data.size()
                  << ", got " << decompressed.size() << "\n";
        all_passed = false;
    }

    std::cout << "\n" << (all_passed ? "ALL TESTS PASSED!" : "SOME TESTS FAILED!") << "\n";

    return all_passed ? 0 : 1;
}
