#pragma once

#include "common.h"
#include "banded_alignment.h"
#include <vector>
#include <string>
#include <algorithm>
#include <numeric>

namespace gene {

struct PairedRead {
    Sequence read1;
    Sequence read2;
    std::string pair_id;
    bool is_proper_pair = false;
    int insert_size = 0;
    int insert_size_std = 0;
    float mapping_quality = 0.0f;
};

struct PairedAlignmentResult {
    std::string pair_id;
    BandedAlignmentResult alignment1;
    BandedAlignmentResult alignment2;
    bool is_concordant = false;
    bool is_discordant = false;
    int observed_insert_size = 0;
    float expected_insert_size = 0.0f;
    float insert_size_deviation = 0.0f;
    std::string orientation;
    std::vector<Variant> combined_variants;
    std::string fusion_candidate;
    
    std::string to_string() const {
        std::stringstream ss;
        ss << "Pair: " << pair_id << "\n";
        ss << "  Concordant: " << (is_concordant ? "yes" : "no") << "\n";
        ss << "  Orientation: " << orientation << "\n";
        ss << "  Insert size: " << observed_insert_size 
           << " (expected: " << expected_insert_size << ")\n";
        ss << "  Variants: " << combined_variants.size() << "\n";
        return ss.str();
    }
};

struct LibraryMetrics {
    float mean_insert_size = 0.0f;
    float std_insert_size = 0.0f;
    float median_insert_size = 0.0f;
    float q25_insert_size = 0.0f;
    float q75_insert_size = 0.0f;
    size_t total_pairs = 0;
    size_t concordant_pairs = 0;
    size_t discordant_pairs = 0;
    
    bool is_within_normal_range(int insert_size) const {
        float lower = mean_insert_size - 3 * std_insert_size;
        float upper = mean_insert_size + 3 * std_insert_size;
        return insert_size >= lower && insert_size <= upper;
    }
};

class PairEndAligner {
public:
    struct Config {
        int expected_insert_size = 300;
        int insert_size_std = 50;
        int max_insert_size = 1000;
        int min_insert_size = 50;
        bool allow_discordant = true;
        bool detect_fusions = false;
        int fusion_score_threshold = 30;
        BandedAlignmentConfig alignment_config;
    };
    
    explicit PairEndAligner(const Config& config = Config());
    
    PairedAlignmentResult align_pair(const PairedRead& pair,
                                      const Sequence& reference1,
                                      const Sequence& reference2);
    
    PairedAlignmentResult align_pair_single_ref(const PairedRead& pair,
                                                 const Sequence& reference);
    
    std::vector<PairedAlignmentResult> align_batch(
        const std::vector<PairedRead>& pairs,
        const Sequence& reference);
    
    LibraryMetrics compute_library_metrics(
        const std::vector<PairedAlignmentResult>& results);
    
    void set_expected_insert_size(int mean, int std_dev);
    
    static std::vector<PairedRead> load_paired_fastq(
        const std::string& fastq1,
        const std::string& fastq2,
        SequenceType type = SequenceType::DNA);

private:
    bool check_orientation(const BandedAlignmentResult& aln1,
                           const BandedAlignmentResult& aln2,
                           const Sequence& ref);
    
    int compute_insert_size(const BandedAlignmentResult& aln1,
                            const BandedAlignmentResult& aln2,
                            const Sequence& ref);
    
    bool check_concordance(int insert_size, const std::string& orientation);
    
    void combine_variants(PairedAlignmentResult& result);
    
    void detect_fusion_candidate(PairedAlignmentResult& result,
                                  const Sequence& ref1,
                                  const Sequence& ref2);
    
    std::string determine_orientation(int start1, int end1, 
                                       int start2, int end2);
    
    Config config_;
};

class VariantCaller {
public:
    struct Config {
        int min_quality = 20;
        int min_coverage = 3;
        float min_vaf = 0.1f;
        int min_distance_from_end = 5;
        bool filter_near_gap = true;
    };
    
    explicit VariantCaller(const Config& config = Config());
    
    std::vector<Variant> call_variants(const AlignmentResult& alignment,
                                        const Sequence& query,
                                        const Sequence& target);
    
    std::vector<Variant> call_variants_from_banded(
        const BandedAlignmentResult& alignment,
        const Sequence& query,
        const Sequence& target);
    
    std::vector<Variant> filter_variants(const std::vector<Variant>& variants,
                                          size_t query_length,
                                          size_t target_length);
    
    std::vector<Variant> merge_overlapping_variants(
        const std::vector<Variant>& variants);
    
    std::string generate_vcf(const std::vector<Variant>& variants,
                              const std::string& sample_name,
                              const std::string& reference_name);
    
    static Variant create_snp(size_t query_pos, size_t target_pos,
                               char ref_base, char alt_base, float quality);
    
    static Variant create_indel(size_t query_pos, size_t target_pos,
                                 const std::string& ref, const std::string& alt,
                                 Variant::Type type, float quality);
    
    static std::string get_variant_context(const Sequence& target,
                                            size_t pos, size_t context_size = 10);

private:
    void annotate_variant(Variant& var,
                           const std::string& aligned_query,
                           const std::string& aligned_target,
                           size_t alignment_pos);
    
    float compute_variant_quality(const std::string& context,
                                   size_t variant_pos);
    
    bool is_in_repeat_region(const std::string& sequence, size_t pos);
    
    Config config_;
};

}
