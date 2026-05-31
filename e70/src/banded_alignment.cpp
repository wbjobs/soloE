#include "banded_alignment.h"
#include <sstream>
#include <iomanip>
#include <climits>

namespace gene {

BandedAligner::BandedAligner(const BandedAlignmentConfig& config) 
    : config_(config) {
}

int BandedAligner::suggest_band_width(size_t seq_length, float expected_identity) {
    float divergence = 1.0f - expected_identity;
    int expected_gaps = static_cast<int>(seq_length * divergence * 2);
    return std::max(20, expected_gaps + 10);
}

BandedAlignmentConfig BandedAligner::suggest_config(size_t seq_length) {
    BandedAlignmentConfig config;
    
    if (seq_length > 50000) {
        config.band_width = 200;
    } else if (seq_length > 10000) {
        config.band_width = 100;
    } else if (seq_length > 1000) {
        config.band_width = 50;
    } else {
        config.band_width = 20;
    }
    
    return config;
}

bool BandedAligner::is_in_band(size_t i, size_t j, size_t len1, size_t len2) const {
    int diagonal = static_cast<int>(j) - static_cast<int>(i);
    int expected_diagonal = 0;
    
    if (config_.type == AlignmentType::GLOBAL) {
        expected_diagonal = 0;
    } else if (config_.type == AlignmentType::SEMI_GLOBAL) {
        expected_diagonal = static_cast<int>((len2 - len1) / 2);
    }
    
    return std::abs(diagonal - expected_diagonal) <= config_.band_width / 2;
}

int BandedAligner::compute_diagonal_band(size_t i, size_t len1, size_t len2) const {
    int expected_diagonal = 0;
    if (config_.type == AlignmentType::SEMI_GLOBAL) {
        expected_diagonal = static_cast<int>((len2 - len1) / 2);
    }
    return expected_diagonal;
}

void BandedAligner::init_score_matrix(size_t rows, size_t cols) {
    score_matrix_.resize(rows, std::vector<int>(cols, INT_MIN / 2));
    trace_matrix_.resize(rows, std::vector<int>(cols, 0));
    
    if (config_.use_affine_gap) {
        gap_i_matrix_.resize(rows, std::vector<int>(cols, INT_MIN / 2));
        gap_j_matrix_.resize(rows, std::vector<int>(cols, INT_MIN / 2));
    }
    
    if (config_.type == AlignmentType::GLOBAL) {
        for (size_t i = 0; i < rows; i++) {
            if (is_in_band(i, 0, rows - 1, cols - 1)) {
                score_matrix_[i][0] = config_.gap_open_penalty + 
                                      static_cast<int>(i) * config_.gap_extend_penalty;
                trace_matrix_[i][0] = 2;
            }
        }
        for (size_t j = 0; j < cols; j++) {
            if (is_in_band(0, j, rows - 1, cols - 1)) {
                score_matrix_[0][j] = config_.gap_open_penalty + 
                                      static_cast<int>(j) * config_.gap_extend_penalty;
                trace_matrix_[0][j] = 3;
            }
        }
        score_matrix_[0][0] = 0;
    } else {
        for (size_t i = 0; i < rows; i++) {
            score_matrix_[i][0] = 0;
        }
        for (size_t j = 0; j < cols; j++) {
            score_matrix_[0][j] = 0;
        }
    }
}

int BandedAligner::get_score(size_t i, size_t j) const {
    if (i >= score_matrix_.size() || j >= score_matrix_[0].size()) {
        return INT_MIN / 2;
    }
    return score_matrix_[i][j];
}

void BandedAligner::set_score(size_t i, size_t j, int score) {
    if (i < score_matrix_.size() && j < score_matrix_[0].size()) {
        score_matrix_[i][j] = score;
    }
}

BandedAlignmentResult BandedAligner::align(const Sequence& query, 
                                             const Sequence& target) {
    return align_long_sequences(query, target);
}

BandedAlignmentResult BandedAligner::align_long_sequences(const Sequence& query, 
                                                            const Sequence& target) {
    BandedAlignmentResult result;
    result.band_width_used = config_.band_width;
    
    size_t n = query.length();
    size_t m = target.length();
    
    result.total_cells = static_cast<int>((n + 1) * (m + 1));
    
    size_t rows = n + 1;
    size_t cols = m + 1;
    
    init_score_matrix(rows, cols);
    
    int cells_computed = 0;
    
    for (size_t i = 1; i <= n; i++) {
        size_t j_start = (i > config_.band_width / 2) ? (i - config_.band_width / 2) : 1;
        size_t j_end = std::min(m, i + config_.band_width / 2);
        
        if (config_.type == AlignmentType::SEMI_GLOBAL) {
            int expected_diag = static_cast<int>((m - n) / 2);
            j_start = std::max(1UL, static_cast<size_t>(std::max(0, 
                static_cast<int>(i) + expected_diag - config_.band_width / 2)));
            j_end = std::min(m, static_cast<size_t>(
                static_cast<int>(i) + expected_diag + config_.band_width / 2));
        }
        
        for (size_t j = j_start; j <= j_end; j++) {
            if (!is_in_band(i, j, n, m)) {
                continue;
            }
            
            cells_computed++;
            
            char q = query.raw_sequence[i - 1];
            char t = target.raw_sequence[j - 1];
            
            int match = (q == t) ? config_.match_score : config_.mismatch_penalty;
            
            int diagonal_score = get_score(i - 1, j - 1) + match;
            int up_score = get_score(i - 1, j) + config_.gap_extend_penalty;
            int left_score = get_score(i, j - 1) + config_.gap_extend_penalty;
            
            if (config_.use_affine_gap) {
                int gap_open_from_diag = get_score(i - 1, j - 1) + 
                                         config_.gap_open_penalty + config_.gap_extend_penalty;
                int gap_open_from_up = get_score(i - 1, j) + config_.gap_extend_penalty;
                int gap_open_from_left = get_score(i, j - 1) + config_.gap_extend_penalty;
                
                up_score = std::max(up_score, gap_open_from_diag);
                left_score = std::max(left_score, gap_open_from_diag);
            }
            
            int max_score = std::max({diagonal_score, up_score, left_score});
            
            if (config_.type == AlignmentType::LOCAL) {
                max_score = std::max(0, max_score);
            }
            
            set_score(i, j, max_score);
            
            if (max_score == diagonal_score) {
                trace_matrix_[i][j] = 1;
            } else if (max_score == up_score) {
                trace_matrix_[i][j] = 2;
            } else {
                trace_matrix_[i][j] = 3;
            }
        }
    }
    
    result.cells_computed = cells_computed;
    result.memory_saving_ratio = 1.0f - static_cast<float>(cells_computed) / result.total_cells;
    
    traceback(query, target, result);
    
    detect_variants(result, query, target);
    
    return result;
}

void BandedAligner::traceback(const Sequence& query, const Sequence& target,
                               BandedAlignmentResult& result) {
    size_t n = query.length();
    size_t m = target.length();
    
    size_t i = n;
    size_t j = m;
    
    if (config_.type == AlignmentType::LOCAL) {
        int max_score = INT_MIN;
        size_t max_i = 0, max_j = 0;
        for (size_t x = 0; x <= n; x++) {
            for (size_t y = 0; y <= m; y++) {
                if (is_in_band(x, y, n, m) && get_score(x, y) > max_score) {
                    max_score = get_score(x, y);
                    max_i = x;
                    max_j = y;
                }
            }
        }
        i = max_i;
        j = max_j;
    }
    
    result.base_result.query_end = i;
    result.base_result.target_end = j;
    
    std::string aligned_query, aligned_target, midline;
    
    int matches = 0;
    int total = 0;
    
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && trace_matrix_[i][j] == 1) {
            char q = query.raw_sequence[i - 1];
            char t = target.raw_sequence[j - 1];
            aligned_query.push_back(q);
            aligned_target.push_back(t);
            
            if (q == t) {
                midline.push_back('|');
                matches++;
            } else {
                midline.push_back('*');
            }
            i--;
            j--;
            total++;
        } else if (i > 0 && trace_matrix_[i][j] == 2) {
            aligned_query.push_back(query.raw_sequence[i - 1]);
            aligned_target.push_back('-');
            midline.push_back(' ');
            i--;
            total++;
        } else if (j > 0 && trace_matrix_[i][j] == 3) {
            aligned_query.push_back('-');
            aligned_target.push_back(target.raw_sequence[j - 1]);
            midline.push_back(' ');
            j--;
            total++;
        } else {
            break;
        }
        
        if (config_.type == AlignmentType::LOCAL && get_score(i, j) == 0) {
            break;
        }
    }
    
    result.base_result.query_start = i;
    result.base_result.target_start = j;
    
    std::reverse(aligned_query.begin(), aligned_query.end());
    std::reverse(aligned_target.begin(), aligned_target.end());
    std::reverse(midline.begin(), midline.end());
    
    result.base_result.aligned_query = aligned_query;
    result.base_result.aligned_target = aligned_target;
    result.base_result.alignment_midline = midline;
    result.base_result.score = get_score(n, m);
    result.base_result.identity = total > 0 ? 
        static_cast<float>(matches) / total : 0.0f;
}

void BandedAligner::detect_variants(BandedAlignmentResult& result,
                                      const Sequence& query,
                                      const Sequence& target) {
    const std::string& aligned_query = result.base_result.aligned_query;
    const std::string& aligned_target = result.base_result.aligned_target;
    
    size_t query_pos = result.base_result.query_start;
    size_t target_pos = result.base_result.target_start;
    
    for (size_t pos = 0; pos < aligned_query.size(); pos++) {
        char q = aligned_query[pos];
        char t = aligned_target[pos];
        
        if (q == '-' || t == '-') {
            Variant var;
            var.query_pos = query_pos;
            var.target_pos = target_pos;
            
            if (q == '-') {
                var.type = Variant::DELETION;
                var.ref_base = std::string(1, t);
                var.alt_base = "";
                var.length = 1;
                target_pos++;
            } else {
                var.type = Variant::INSERTION;
                var.ref_base = "";
                var.alt_base = std::string(1, q);
                var.length = 1;
                query_pos++;
            }
            
            var.quality = 30.0f;
            result.variants.push_back(var);
        } else if (q != t) {
            Variant var;
            var.type = Variant::SNP;
            var.query_pos = query_pos;
            var.target_pos = target_pos;
            var.ref_base = std::string(1, t);
            var.alt_base = std::string(1, q);
            var.length = 1;
            var.quality = 30.0f;
            result.variants.push_back(var);
            query_pos++;
            target_pos++;
        } else {
            query_pos++;
            target_pos++;
        }
    }
    
    std::vector<Variant> merged;
    for (size_t k = 0; k < result.variants.size(); ) {
        Variant current = result.variants[k];
        k++;
        
        while (k < result.variants.size() &&
               result.variants[k].type == current.type &&
               result.variants[k].target_pos == current.target_pos + current.length) {
            current.ref_base += result.variants[k].ref_base;
            current.alt_base += result.variants[k].alt_base;
            current.length += result.variants[k].length;
            k++;
        }
        
        merged.push_back(current);
    }
    
    result.variants = merged;
}

}
