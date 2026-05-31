#include "pair_end_aligner.h"
#include "fasta_parser.h"
#include <sstream>
#include <iomanip>
#include <numeric>
#include <algorithm>

namespace gene {

PairEndAligner::PairEndAligner(const Config& config) : config_(config) {
}

void PairEndAligner::set_expected_insert_size(int mean, int std_dev) {
    config_.expected_insert_size = mean;
    config_.insert_size_std = std_dev;
}

std::string PairEndAligner::determine_orientation(int start1, int end1,
                                                    int start2, int end2) {
    bool read1_forward = start1 < end1;
    bool read2_forward = start2 < end2;
    
    if (read1_forward && !read2_forward) {
        return "FR";
    } else if (!read1_forward && read2_forward) {
        return "RF";
    } else if (read1_forward && read2_forward) {
        return "FF";
    } else {
        return "RR";
    }
}

bool PairEndAligner::check_orientation(const BandedAlignmentResult& aln1,
                                        const BandedAlignmentResult& aln2,
                                        const Sequence& ref) {
    int start1 = static_cast<int>(aln1.base_result.target_start);
    int end1 = static_cast<int>(aln1.base_result.target_end);
    int start2 = static_cast<int>(aln2.base_result.target_start);
    int end2 = static_cast<int>(aln2.base_result.target_end);
    
    std::string orientation = determine_orientation(start1, end1, start2, end2);
    
    return orientation == "FR" || orientation == "RF";
}

int PairEndAligner::compute_insert_size(const BandedAlignmentResult& aln1,
                                          const BandedAlignmentResult& aln2,
                                          const Sequence& ref) {
    int start1 = static_cast<int>(aln1.base_result.target_start);
    int end1 = static_cast<int>(aln1.base_result.target_end);
    int start2 = static_cast<int>(aln2.base_result.target_start);
    int end2 = static_cast<int>(aln2.base_result.target_end);
    
    int left_most = std::min({start1, end1, start2, end2});
    int right_most = std::max({start1, end1, start2, end2});
    
    return right_most - left_most;
}

bool PairEndAligner::check_concordance(int insert_size, const std::string& orientation) {
    if (orientation != "FR" && orientation != "RF") {
        return false;
    }
    
    int lower = config_.expected_insert_size - 3 * config_.insert_size_std;
    int upper = config_.expected_insert_size + 3 * config_.insert_size_std;
    
    return insert_size >= lower && insert_size <= upper;
}

void PairEndAligner::combine_variants(PairedAlignmentResult& result) {
    result.combined_variants = result.alignment1.variants;
    
    for (const auto& var : result.alignment2.variants) {
        bool found = false;
        for (auto& existing : result.combined_variants) {
            if (existing.target_pos == var.target_pos &&
                existing.type == var.type) {
                existing.quality = (existing.quality + var.quality) / 2.0f;
                found = true;
                break;
            }
        }
        if (!found) {
            result.combined_variants.push_back(var);
        }
    }
    
    std::sort(result.combined_variants.begin(), result.combined_variants.end(),
              [](const Variant& a, const Variant& b) {
                  return a.target_pos < b.target_pos;
              });
}

void PairEndAligner::detect_fusion_candidate(PairedAlignmentResult& result,
                                              const Sequence& ref1,
                                              const Sequence& ref2) {
    if (!config_.detect_fusions) return;
    
    if (result.is_discordant && 
        result.alignment1.base_result.score > config_.fusion_score_threshold &&
        result.alignment2.base_result.score > config_.fusion_score_threshold) {
        
        std::stringstream ss;
        ss << "Fusion_candidate:" 
           << result.alignment1.base_result.target_id << ":" 
           << result.alignment1.base_result.target_end << "-"
           << result.alignment2.base_result.target_id << ":"
           << result.alignment2.base_result.target_start;
        result.fusion_candidate = ss.str();
    }
}

PairedAlignmentResult PairEndAligner::align_pair(const PairedRead& pair,
                                                   const Sequence& reference1,
                                                   const Sequence& reference2) {
    PairedAlignmentResult result;
    result.pair_id = pair.pair_id;
    result.expected_insert_size = static_cast<float>(config_.expected_insert_size);
    
    BandedAligner aligner(config_.alignment_config);
    
    result.alignment1 = aligner.align(pair.read1, reference1);
    result.alignment2 = aligner.align(pair.read2, reference2);
    
    int start1 = static_cast<int>(result.alignment1.base_result.target_start);
    int end1 = static_cast<int>(result.alignment1.base_result.target_end);
    int start2 = static_cast<int>(result.alignment2.base_result.target_start);
    int end2 = static_cast<int>(result.alignment2.base_result.target_end);
    
    result.orientation = determine_orientation(start1, end1, start2, end2);
    
    result.observed_insert_size = compute_insert_size(result.alignment1,
                                                       result.alignment2,
                                                       reference1);
    
    result.insert_size_deviation = std::abs(result.observed_insert_size - 
                                              config_.expected_insert_size) /
                                    static_cast<float>(config_.insert_size_std);
    
    result.is_concordant = check_concordance(result.observed_insert_size,
                                               result.orientation);
    result.is_discordant = !result.is_concordant;
    
    combine_variants(result);
    
    detect_fusion_candidate(result, reference1, reference2);
    
    return result;
}

PairedAlignmentResult PairEndAligner::align_pair_single_ref(const PairedRead& pair,
                                                              const Sequence& reference) {
    return align_pair(pair, reference, reference);
}

std::vector<PairedAlignmentResult> PairEndAligner::align_batch(
    const std::vector<PairedRead>& pairs,
    const Sequence& reference) {
    
    std::vector<PairedAlignmentResult> results;
    results.reserve(pairs.size());
    
    for (const auto& pair : pairs) {
        results.push_back(align_pair_single_ref(pair, reference));
    }
    
    auto metrics = compute_library_metrics(results);
    set_expected_insert_size(static_cast<int>(metrics.mean_insert_size),
                              static_cast<int>(metrics.std_insert_size));
    
    return results;
}

LibraryMetrics PairEndAligner::compute_library_metrics(
    const std::vector<PairedAlignmentResult>& results) {
    
    LibraryMetrics metrics;
    metrics.total_pairs = results.size();
    
    std::vector<int> insert_sizes;
    
    for (const auto& result : results) {
        if (result.is_concordant) {
            metrics.concordant_pairs++;
            insert_sizes.push_back(result.observed_insert_size);
        } else {
            metrics.discordant_pairs++;
        }
    }
    
    if (!insert_sizes.empty()) {
        std::sort(insert_sizes.begin(), insert_sizes.end());
        
        float sum = std::accumulate(insert_sizes.begin(), insert_sizes.end(), 0.0f);
        metrics.mean_insert_size = sum / insert_sizes.size();
        
        float sq_sum = 0.0f;
        for (int s : insert_sizes) {
            float diff = s - metrics.mean_insert_size;
            sq_sum += diff * diff;
        }
        metrics.std_insert_size = std::sqrt(sq_sum / insert_sizes.size());
        
        size_t mid = insert_sizes.size() / 2;
        if (insert_sizes.size() % 2 == 0) {
            metrics.median_insert_size = (insert_sizes[mid - 1] + insert_sizes[mid]) / 2.0f;
        } else {
            metrics.median_insert_size = static_cast<float>(insert_sizes[mid]);
        }
        
        size_t q25_idx = insert_sizes.size() / 4;
        size_t q75_idx = 3 * insert_sizes.size() / 4;
        metrics.q25_insert_size = static_cast<float>(insert_sizes[q25_idx]);
        metrics.q75_insert_size = static_cast<float>(insert_sizes[q75_idx]);
    }
    
    return metrics;
}

std::vector<PairedRead> PairEndAligner::load_paired_fastq(
    const std::string& fastq1,
    const std::string& fastq2,
    SequenceType type) {
    
    auto reads1 = FastqParser::parse_file(fastq1, type);
    auto reads2 = FastqParser::parse_file(fastq2, type);
    
    size_t min_size = std::min(reads1.size(), reads2.size());
    
    std::vector<PairedRead> pairs;
    pairs.reserve(min_size);
    
    for (size_t i = 0; i < min_size; i++) {
        PairedRead pair;
        pair.read1 = reads1[i];
        pair.read2 = reads2[i];
        pair.pair_id = reads1[i].id;
        pairs.push_back(pair);
    }
    
    return pairs;
}

VariantCaller::VariantCaller(const Config& config) : config_(config) {
}

Variant VariantCaller::create_snp(size_t query_pos, size_t target_pos,
                                    char ref_base, char alt_base, float quality) {
    Variant var;
    var.type = Variant::SNP;
    var.query_pos = query_pos;
    var.target_pos = target_pos;
    var.ref_base = std::string(1, ref_base);
    var.alt_base = std::string(1, alt_base);
    var.length = 1;
    var.quality = quality;
    return var;
}

Variant VariantCaller::create_indel(size_t query_pos, size_t target_pos,
                                      const std::string& ref, const std::string& alt,
                                      Variant::Type type, float quality) {
    Variant var;
    var.type = type;
    var.query_pos = query_pos;
    var.target_pos = target_pos;
    var.ref_base = ref;
    var.alt_base = alt;
    var.length = std::max(ref.size(), alt.size());
    var.quality = quality;
    return var;
}

std::string VariantCaller::get_variant_context(const Sequence& target,
                                                 size_t pos, size_t context_size) {
    size_t start = (pos > context_size) ? (pos - context_size) : 0;
    size_t end = std::min(pos + context_size + 1, target.length());
    return target.raw_sequence.substr(start, end - start);
}

void VariantCaller::annotate_variant(Variant& var,
                                      const std::string& aligned_query,
                                      const std::string& aligned_target,
                                      size_t alignment_pos) {
    var.context = "";
    
    size_t context_start = (alignment_pos > 5) ? (alignment_pos - 5) : 0;
    size_t context_end = std::min(alignment_pos + 6, aligned_query.size());
    
    for (size_t i = context_start; i < context_end && i < aligned_target.size(); i++) {
        if (i == alignment_pos) {
            var.context += "[" + std::string(1, aligned_target[i]) + "]";
        } else {
            var.context += aligned_target[i];
        }
    }
}

float VariantCaller::compute_variant_quality(const std::string& context,
                                               size_t variant_pos) {
    float base_quality = 30.0f;
    
    if (variant_pos < config_.min_distance_from_end ||
        variant_pos > context.size() - config_.min_distance_from_end) {
        base_quality -= 10.0f;
    }
    
    int homopolymer_length = 0;
    char base = context[variant_pos];
    for (int i = static_cast<int>(variant_pos); 
         i >= 0 && context[static_cast<size_t>(i)] == base; i--) {
        homopolymer_length++;
    }
    for (size_t i = variant_pos + 1; 
         i < context.size() && context[i] == base; i++) {
        homopolymer_length++;
    }
    
    if (homopolymer_length > 5) {
        base_quality -= static_cast<float>(homopolymer_length - 5) * 2.0f;
    }
    
    return std::max(0.0f, base_quality);
}

bool VariantCaller::is_in_repeat_region(const std::string& sequence, size_t pos) {
    if (pos < 3 || pos + 3 >= sequence.size()) {
        return false;
    }
    
    for (size_t unit = 1; unit <= 3; unit++) {
        bool is_repeat = true;
        for (size_t i = pos - unit; i <= pos + unit; i++) {
            if (sequence[i] != sequence[i - unit]) {
                is_repeat = false;
                break;
            }
        }
        if (is_repeat) return true;
    }
    
    return false;
}

std::vector<Variant> VariantCaller::call_variants(const AlignmentResult& alignment,
                                                    const Sequence& query,
                                                    const Sequence& target) {
    std::vector<Variant> variants;
    
    const std::string& aligned_query = alignment.aligned_query;
    const std::string& aligned_target = alignment.aligned_target;
    
    size_t query_pos = alignment.query_start;
    size_t target_pos = alignment.target_start;
    
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
            
            std::string context = get_variant_context(target, target_pos, 5);
            var.quality = compute_variant_quality(context, 5);
            annotate_variant(var, aligned_query, aligned_target, pos);
            variants.push_back(var);
        } else if (q != t) {
            Variant var = create_snp(query_pos, target_pos, t, q, 30.0f);
            std::string context = get_variant_context(target, target_pos, 5);
            var.quality = compute_variant_quality(context, 5);
            annotate_variant(var, aligned_query, aligned_target, pos);
            variants.push_back(var);
            query_pos++;
            target_pos++;
        } else {
            query_pos++;
            target_pos++;
        }
    }
    
    return variants;
}

std::vector<Variant> VariantCaller::call_variants_from_banded(
    const BandedAlignmentResult& alignment,
    const Sequence& query,
    const Sequence& target) {
    
    return call_variants(alignment.base_result, query, target);
}

std::vector<Variant> VariantCaller::filter_variants(
    const std::vector<Variant>& variants,
    size_t query_length,
    size_t target_length) {
    
    std::vector<Variant> filtered;
    
    for (const auto& var : variants) {
        if (var.quality < config_.min_quality) {
            continue;
        }
        
        if (var.target_pos < static_cast<size_t>(config_.min_distance_from_end) ||
            var.target_pos > target_length - config_.min_distance_from_end) {
            continue;
        }
        
        filtered.push_back(var);
    }
    
    return filtered;
}

std::vector<Variant> VariantCaller::merge_overlapping_variants(
    const std::vector<Variant>& variants) {
    
    if (variants.empty()) return {};
    
    std::vector<Variant> sorted = variants;
    std::sort(sorted.begin(), sorted.end(),
              [](const Variant& a, const Variant& b) {
                  return a.target_pos < b.target_pos;
              });
    
    std::vector<Variant> merged;
    Variant current = sorted[0];
    
    for (size_t i = 1; i < sorted.size(); i++) {
        if (sorted[i].type == current.type &&
            sorted[i].target_pos == current.target_pos + current.length) {
            current.ref_base += sorted[i].ref_base;
            current.alt_base += sorted[i].alt_base;
            current.length += sorted[i].length;
            current.quality = (current.quality + sorted[i].quality) / 2.0f;
        } else {
            merged.push_back(current);
            current = sorted[i];
        }
    }
    
    merged.push_back(current);
    return merged;
}

std::string VariantCaller::generate_vcf(const std::vector<Variant>& variants,
                                          const std::string& sample_name,
                                          const std::string& reference_name) {
    std::stringstream ss;
    
    ss << "##fileformat=VCFv4.2\n";
    ss << "##source=GeneAlignmentService\n";
    ss << "##reference=" << reference_name << "\n";
    ss << "##INFO=<ID=TYPE,Number=1,Type=String,Description=\"Variant type\">\n";
    ss << "##INFO=<ID=LEN,Number=1,Type=Integer,Description=\"Variant length\">\n";
    ss << "##FORMAT=<ID=GT,Number=1,Type=String,Description=\"Genotype\">\n";
    ss << "##FORMAT=<ID=GQ,Number=1,Type=Float,Description=\"Genotype quality\">\n";
    ss << "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\t" << sample_name << "\n";
    
    for (const auto& var : variants) {
        std::string type_str;
        switch (var.type) {
            case Variant::SNP: type_str = "SNP"; break;
            case Variant::INSERTION: type_str = "INS"; break;
            case Variant::DELETION: type_str = "DEL"; break;
            case Variant::MISMATCH: type_str = "MISMATCH"; break;
        }
        
        std::string ref = var.ref_base.empty() ? "N" : var.ref_base;
        std::string alt = var.alt_base.empty() ? "." : var.alt_base;
        
        ss << reference_name << "\t"
           << var.target_pos + 1 << "\t"
           << ".\t"
           << ref << "\t"
           << alt << "\t"
           << std::fixed << std::setprecision(1) << var.quality << "\t"
           << "PASS\t"
           << "TYPE=" << type_str << ";LEN=" << var.length << "\t"
           << "GT:GQ\t"
           << "0/1:" << var.quality << "\n";
    }
    
    return ss.str();
}

}
