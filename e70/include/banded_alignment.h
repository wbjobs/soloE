#pragma once

#include "common.h"
#include <vector>
#include <string>
#include <algorithm>
#include <cmath>

namespace gene {

enum class AlignmentType {
    GLOBAL,
    LOCAL,
    SEMI_GLOBAL
};

struct BandedAlignmentConfig {
    int band_width = 50;
    int match_score = 2;
    int mismatch_penalty = -2;
    int gap_open_penalty = -4;
    int gap_extend_penalty = -1;
    AlignmentType type = AlignmentType::GLOBAL;
    bool use_affine_gap = true;
};

struct Variant {
    enum Type {
        SNP,
        INSERTION,
        DELETION,
        MISMATCH
    };
    
    Type type;
    size_t query_pos;
    size_t target_pos;
    std::string ref_base;
    std::string alt_base;
    size_t length;
    float quality;
    std::string context;
    
    std::string to_string() const {
        std::stringstream ss;
        switch (type) {
            case SNP: ss << "SNP"; break;
            case INSERTION: ss << "INS"; break;
            case DELETION: ss << "DEL"; break;
            case MISMATCH: ss << "MISMATCH"; break;
        }
        ss << ":" << target_pos << ":" << ref_base << ">" << alt_base;
        return ss.str();
    }
};

struct BandedAlignmentResult {
    AlignmentResult base_result;
    int band_width_used;
    int cells_computed;
    int total_cells;
    float memory_saving_ratio;
    std::vector<Variant> variants;
    std::vector<std::pair<int, int>> computed_cells_mask;
};

class BandedAligner {
public:
    explicit BandedAligner(const BandedAlignmentConfig& config = BandedAlignmentConfig());
    
    BandedAlignmentResult align(const Sequence& query, const Sequence& target);
    
    BandedAlignmentResult align_long_sequences(const Sequence& query, const Sequence& target);
    
    static BandedAlignmentConfig suggest_config(size_t seq_length);
    
    static int suggest_band_width(size_t seq_length, float expected_identity = 0.8f);

private:
    void init_score_matrix(size_t rows, size_t cols);
    
    int get_score(size_t i, size_t j) const;
    
    void set_score(size_t i, size_t j, int score);
    
    bool is_in_band(size_t i, size_t j, size_t len1, size_t len2) const;
    
    void traceback(const Sequence& query, const Sequence& target, 
                   BandedAlignmentResult& result);
    
    void detect_variants(BandedAlignmentResult& result,
                         const Sequence& query,
                         const Sequence& target);
    
    int compute_diagonal_band(size_t i, size_t len1, size_t len2) const;
    
    BandedAlignmentConfig config_;
    std::vector<std::vector<int>> score_matrix_;
    std::vector<std::vector<int>> trace_matrix_;
    std::vector<std::vector<int>> gap_i_matrix_;
    std::vector<std::vector<int>> gap_j_matrix_;
};

}
