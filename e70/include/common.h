#pragma once

#include <string>
#include <vector>
#include <cstdint>
#include <memory>

namespace gene {

enum class Nucleotide {
    A = 0,
    T = 1,
    G = 2,
    C = 3,
    U = 4,
    N = 5,
    GAP = 6,
    INVALID = 255
};

enum class SequenceType {
    DNA,
    RNA,
    PROTEIN
};

struct Sequence {
    std::string id;
    std::string description;
    std::string raw_sequence;
    std::vector<uint8_t> encoded;
    SequenceType type;
    std::vector<uint8_t> quality;

    size_t length() const { return raw_sequence.size(); }
};

struct AlignmentResult {
    std::string query_id;
    std::string target_id;
    int score;
    float identity;
    size_t query_start;
    size_t query_end;
    size_t target_start;
    size_t target_end;
    std::string aligned_query;
    std::string aligned_target;
    std::string alignment_midline;
    std::vector<std::vector<int>> score_matrix;
    double time_ms;
    bool is_gpu_accelerated;
};

struct AlignmentConfig {
    int match_score = 2;
    int mismatch_penalty = -1;
    int gap_open_penalty = -2;
    int gap_extend_penalty = -1;
    std::string scoring_matrix = "BLOSUM62";
    bool use_gpu = true;
    size_t gpu_batch_size = 32;
    bool store_matrix = false;
};

}
