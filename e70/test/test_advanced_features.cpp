#include <iostream>
#include <iomanip>
#include <random>
#include <algorithm>
#include "../include/common.h"
#include "../include/banded_alignment.h"
#include "../include/pair_end_aligner.h"

using namespace gene;

std::string generate_dna_sequence(size_t length) {
    std::string dna = "ATCG";
    std::random_device rd;
    std::mt19937 gen(rd());
    std::uniform_int_distribution<> dist(0, 3);
    
    std::string result;
    result.reserve(length);
    for (size_t i = 0; i < length; i++) {
        result += dna[dist(gen)];
    }
    return result;
}

std::string introduce_variants(const std::string& ref, double snp_rate, double indel_rate) {
    std::random_device rd;
    std::mt19937 gen(rd());
    std::uniform_real_distribution<> prob(0.0, 1.0);
    std::uniform_int_distribution<> base_dist(0, 3);
    std::uniform_int_distribution<> indel_len_dist(1, 5);
    
    std::string result;
    result.reserve(ref.size());
    
    for (size_t i = 0; i < ref.size(); i++) {
        double p = prob(gen);
        
        if (p < snp_rate) {
            std::string bases = "ATCG";
            char new_base;
            do {
                new_base = bases[base_dist(gen)];
            } while (new_base == ref[i]);
            result += new_base;
        } else if (p < snp_rate + indel_rate / 2) {
            int len = indel_len_dist(gen);
            for (int j = 0; j < len; j++) {
                std::string bases = "ATCG";
                result += bases[base_dist(gen)];
            }
        } else if (p < snp_rate + indel_rate) {
            int len = std::min(indel_len_dist(gen), static_cast<int>(ref.size() - i));
            i += len - 1;
        } else {
            result += ref[i];
        }
    }
    
    return result;
}

void test_banded_alignment() {
    std::cout << "===============================================\n";
    std::cout << "   1. Testing Banded Alignment\n";
    std::cout << "===============================================\n\n";
    
    size_t seq_lengths[] = {100, 1000, 10000};
    
    for (size_t len : seq_lengths) {
        std::cout << "--- Sequence Length: " << len << " ---\n";
        
        std::string ref = generate_dna_sequence(len);
        std::string query = introduce_variants(ref, 0.05, 0.01);
        
        Sequence ref_seq;
        ref_seq.id = "reference_" + std::to_string(len);
        ref_seq.raw_sequence = ref;
        ref_seq.type = SequenceType::DNA;
        
        Sequence query_seq;
        query_seq.id = "query_" + std::to_string(len);
        query_seq.raw_sequence = query;
        query_seq.type = SequenceType::DNA;
        
        BandedAlignmentConfig config;
        config.band_width = std::max(50, static_cast<int>(len * 0.1));
        config.match_score = 2;
        config.mismatch_penalty = -2;
        config.gap_open_penalty = -4;
        config.gap_extend_penalty = -1;
        
        BandedAligner aligner(config);
        
        auto start = std::chrono::high_resolution_clock::now();
        BandedAlignmentResult result = aligner.align_long_sequences(query_seq, ref_seq);
        auto end = std::chrono::high_resolution_clock::now();
        
        auto duration = std::chrono::duration_cast<std::chrono::milliseconds>(end - start);
        
        std::cout << "  Alignment Score: " << result.base_result.score << "\n";
        std::cout << "  Identity: " << std::fixed << std::setprecision(2) 
                  << (result.base_result.identity * 100) << "%\n";
        std::cout << "  Band Width Used: " << result.band_width_used << "\n";
        std::cout << "  Cells Computed: " << result.cells_computed << "\n";
        std::cout << "  Total Cells: " << result.total_cells << "\n";
        std::cout << "  Memory Saving: " << std::fixed << std::setprecision(2)
                  << (result.memory_saving_ratio * 100) << "%\n";
        std::cout << "  Time: " << duration.count() << "ms\n";
        std::cout << "  Variants Detected: " << result.variants.size() << "\n";
        
        if (!result.variants.empty()) {
            std::cout << "  First 5 Variants:\n";
            for (size_t i = 0; i < std::min(size_t(5), result.variants.size()); i++) {
                const auto& var = result.variants[i];
                std::string type_str;
                switch (var.type) {
                    case Variant::SNP: type_str = "SNP"; break;
                    case Variant::INSERTION: type_str = "INS"; break;
                    case Variant::DELETION: type_str = "DEL"; break;
                    default: type_str = "OTHER"; break;
                }
                std::cout << "    Pos " << var.target_pos << ": " << type_str 
                          << " " << var.ref_base << " -> " << var.alt_base 
                          << " (Q=" << var.quality << ")\n";
            }
        }
        
        std::cout << "\n";
    }
}

void test_pair_end_alignment() {
    std::cout << "===============================================\n";
    std::cout << "   2. Testing Pair-End Alignment\n";
    std::cout << "===============================================\n\n";
    
    size_t ref_length = 5000;
    size_t read_length = 150;
    int insert_size = 300;
    
    std::cout << "Reference Length: " << ref_length << "\n";
    std::cout << "Read Length: " << read_length << "\n";
    std::cout << "Expected Insert Size: " << insert_size << "\n\n";
    
    std::string ref = generate_dna_sequence(ref_length);
    Sequence ref_seq;
    ref_seq.id = "chr1";
    ref_seq.raw_sequence = ref;
    ref_seq.type = SequenceType::DNA;
    
    std::vector<PairedRead> pairs;
    
    for (size_t i = 0; i < 10; i++) {
        size_t start_pos = 1000 + i * 100;
        
        std::string read1_seq = ref.substr(start_pos, read_length);
        read1_seq = introduce_variants(read1_seq, 0.01, 0.002);
        
        size_t start2 = start_pos + insert_size - read_length;
        std::string read2_seq = ref.substr(start2, read_length);
        read2_seq = introduce_variants(read2_seq, 0.01, 0.002);
        
        std::reverse(read2_seq.begin(), read2_seq.end());
        for (char& c : read2_seq) {
            switch (c) {
                case 'A': c = 'T'; break;
                case 'T': c = 'A'; break;
                case 'G': c = 'C'; break;
                case 'C': c = 'G'; break;
            }
        }
        
        PairedRead pair;
        pair.pair_id = "pair_" + std::to_string(i);
        pair.read1.id = "read1_" + std::to_string(i);
        pair.read1.raw_sequence = read1_seq;
        pair.read1.type = SequenceType::DNA;
        pair.read2.id = "read2_" + std::to_string(i);
        pair.read2.raw_sequence = read2_seq;
        pair.read2.type = SequenceType::DNA;
        
        pairs.push_back(pair);
    }
    
    PairEndAligner::Config pe_config;
    pe_config.expected_insert_size = insert_size;
    pe_config.insert_size_std = 50;
    pe_config.alignment_config.band_width = 50;
    
    PairEndAligner aligner(pe_config);
    
    auto start = std::chrono::high_resolution_clock::now();
    auto results = aligner.align_batch(pairs, ref_seq);
    auto end = std::chrono::high_resolution_clock::now();
    
    auto duration = std::chrono::duration_cast<std::chrono::milliseconds>(end - start);
    
    LibraryMetrics metrics = aligner.compute_library_metrics(results);
    
    std::cout << "--- Library Metrics ---\n";
    std::cout << "  Total Pairs: " << metrics.total_pairs << "\n";
    std::cout << "  Concordant Pairs: " << metrics.concordant_pairs << "\n";
    std::cout << "  Discordant Pairs: " << metrics.discordant_pairs << "\n";
    std::cout << "  Mean Insert Size: " << std::fixed << std::setprecision(1) 
              << metrics.mean_insert_size << "\n";
    std::cout << "  Std Insert Size: " << std::fixed << std::setprecision(1) 
              << metrics.std_insert_size << "\n";
    std::cout << "  Median Insert Size: " << std::fixed << std::setprecision(1) 
              << metrics.median_insert_size << "\n";
    std::cout << "  Processing Time: " << duration.count() << "ms\n\n";
    
    std::cout << "--- First 5 Pair Results ---\n";
    for (size_t i = 0; i < std::min(size_t(5), results.size()); i++) {
        const auto& result = results[i];
        std::cout << "  Pair " << i << " (" << result.pair_id << "):\n";
        std::cout << "    Orientation: " << result.orientation << "\n";
        std::cout << "    Insert Size: " << result.observed_insert_size << "\n";
        std::cout << "    Concordant: " << (result.is_concordant ? "Yes" : "No") << "\n";
        std::cout << "    Read1 Score: " << result.alignment1.base_result.score << "\n";
        std::cout << "    Read2 Score: " << result.alignment2.base_result.score << "\n";
        std::cout << "    Combined Variants: " << result.combined_variants.size() << "\n";
        if (!result.fusion_candidate.empty()) {
            std::cout << "    Fusion Candidate: " << result.fusion_candidate << "\n";
        }
        std::cout << "\n";
    }
}

void test_variant_calling() {
    std::cout << "===============================================\n";
    std::cout << "   3. Testing Variant Calling\n";
    std::cout << "===============================================\n\n";
    
    std::string ref = "ATCGATCGATCGATCGATCGATCGATCGATCGATCGATCG";
    std::string query = "ATCGACCGATCG--TCGATCGATCGATCGATCGATCGA";
    
    std::cout << "Reference: " << ref << "\n";
    std::cout << "Query:     " << query << "\n\n";
    
    Sequence ref_seq;
    ref_seq.id = "ref1";
    ref_seq.raw_sequence = ref;
    ref_seq.type = SequenceType::DNA;
    
    Sequence query_seq;
    query_seq.id = "query1";
    query_seq.raw_sequence = query;
    query_seq.type = SequenceType::DNA;
    
    BandedAlignmentConfig config;
    config.band_width = 20;
    BandedAligner aligner(config);
    
    BandedAlignmentResult alignment = aligner.align(query_seq, ref_seq);
    
    VariantCaller vc;
    auto variants = vc.call_variants_from_banded(alignment, query_seq, ref_seq);
    
    std::cout << "--- Raw Variants (" << variants.size() << ") ---\n";
    for (const auto& var : variants) {
        std::string type_str;
        switch (var.type) {
            case Variant::SNP: type_str = "SNP"; break;
            case Variant::INSERTION: type_str = "INS"; break;
            case Variant::DELETION: type_str = "DEL"; break;
            default: type_str = "OTHER"; break;
        }
        std::cout << "  Pos " << var.target_pos << ": " << type_str
                  << " " << var.ref_base << " -> " << var.alt_base
                  << " (Q=" << var.quality << ")\n";
    }
    
    auto filtered = vc.filter_variants(variants, query_seq.length(), ref_seq.length());
    auto merged = vc.merge_overlapping_variants(filtered);
    
    std::cout << "\n--- Merged Variants (" << merged.size() << ") ---\n";
    for (const auto& var : merged) {
        std::string type_str;
        switch (var.type) {
            case Variant::SNP: type_str = "SNP"; break;
            case Variant::INSERTION: type_str = "INS"; break;
            case Variant::DELETION: type_str = "DEL"; break;
            default: type_str = "OTHER"; break;
        }
        std::cout << "  Pos " << var.target_pos << ": " << type_str
                  << " len=" << var.length
                  << " " << var.ref_base << " -> " << var.alt_base
                  << " (Q=" << var.quality << ")\n";
    }
    
    std::string vcf = vc.generate_vcf(merged, "SAMPLE1", "ref1");
    std::cout << "\n--- VCF Output ---\n";
    std::cout << vcf << "\n";
}

void test_large_sequence_performance() {
    std::cout << "===============================================\n";
    std::cout << "   4. Testing Large Sequence Performance\n";
    std::cout << "===============================================\n\n";
    
    size_t lengths[] = {5000, 10000, 25000};
    
    for (size_t len : lengths) {
        std::cout << "--- Length: " << len << " ---\n";
        
        std::string ref = generate_dna_sequence(len);
        std::string query = introduce_variants(ref, 0.03, 0.005);
        
        Sequence ref_seq;
        ref_seq.id = "ref_large";
        ref_seq.raw_sequence = ref;
        
        Sequence query_seq;
        query_seq.id = "query_large";
        query_seq.raw_sequence = query;
        
        BandedAlignmentConfig config;
        config.band_width = static_cast<int>(len * 0.05) + 20;
        config.band_width = std::min(500, config.band_width);
        
        BandedAligner aligner(config);
        
        auto start = std::chrono::high_resolution_clock::now();
        auto result = aligner.align_long_sequences(query_seq, ref_seq);
        auto end = std::chrono::high_resolution_clock::now();
        
        auto duration = std::chrono::duration_cast<std::chrono::milliseconds>(end - start);
        
        std::cout << "  Band Width: " << config.band_width << "\n";
        std::cout << "  Time: " << duration.count() << "ms\n";
        std::cout << "  Memory Saving: " << std::fixed << std::setprecision(2)
                  << (result.memory_saving_ratio * 100) << "%\n";
        std::cout << "  Score: " << result.base_result.score << "\n";
        std::cout << "  Identity: " << std::fixed << std::setprecision(2)
                  << (result.base_result.identity * 100) << "%\n";
        std::cout << "  Variants: " << result.variants.size() << "\n\n";
    }
}

void test_vcf_generation() {
    std::cout << "===============================================\n";
    std::cout << "   5. Testing VCF Generation\n";
    std::cout << "===============================================\n\n";
    
    std::string ref = generate_dna_sequence(2000);
    std::string query = introduce_variants(ref, 0.02, 0.005);
    
    Sequence ref_seq;
    ref_seq.id = "chr1";
    ref_seq.raw_sequence = ref;
    
    Sequence query_seq;
    query_seq.id = "sample";
    query_seq.raw_sequence = query;
    
    BandedAlignmentConfig config;
    config.band_width = 100;
    BandedAligner aligner(config);
    
    auto result = aligner.align(query_seq, ref_seq);
    
    VariantCaller::Config vc_config;
    vc_config.min_quality = 20;
    VariantCaller vc(vc_config);
    
    auto variants = vc.call_variants_from_banded(result, query_seq, ref_seq);
    auto filtered = vc.filter_variants(variants, query_seq.length(), ref_seq.length());
    
    std::string vcf = vc.generate_vcf(filtered, "SAMPLE001", "chr1");
    
    std::cout << "Generated VCF with " << filtered.size() << " variants\n\n";
    std::cout << vcf << "\n";
}

int main() {
    std::cout << "\n";
    std::cout << "#####################################################\n";
    std::cout << "#     Gene Alignment - Advanced Features Test      #\n";
    std::cout << "#   Banded Alignment | Pair-End | Variant Calling   #\n";
    std::cout << "#####################################################\n\n";
    
    try {
        test_banded_alignment();
        test_pair_end_alignment();
        test_variant_calling();
        test_large_sequence_performance();
        test_vcf_generation();
        
        std::cout << "===============================================\n";
        std::cout << "   All Tests Completed Successfully!\n";
        std::cout << "===============================================\n";
        
    } catch (const std::exception& e) {
        std::cerr << "Test failed with exception: " << e.what() << std::endl;
        return 1;
    }
    
    return 0;
}
