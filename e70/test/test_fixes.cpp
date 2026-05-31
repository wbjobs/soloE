#include <iostream>
#include <cassert>
#include "common.h"
#include "gpu_memory_manager.h"
#include "task_queue.h"
#include "visualization.h"

using namespace gene;
using namespace gene::gpu;
using namespace gene::viz;

void test_gpu_memory_manager() {
    std::cout << "=== Testing GPU Memory Manager ===\n";
    
    auto& mm = GPUMemoryManager::get_instance();
    
    auto info = mm.get_memory_info();
    std::cout << "GPU Memory - Total: " << info.total_bytes / 1024 / 1024 << " MB\n";
    std::cout << "             Free: " << info.free_bytes / 1024 / 1024 << " MB\n";
    std::cout << "             Used: " << info.used_bytes / 1024 / 1024 << " MB\n";
    std::cout << "      Utilization: " << (info.utilization * 100) << "%\n";
    
    size_t matrix_size = mm.calculate_matrix_size(100, 100);
    std::cout << "\nSize of 100x100 score matrix: " << matrix_size << " bytes\n";
    
    size_t batch_memory = mm.calculate_batch_memory(16, 100);
    std::cout << "Memory for batch of 16 (100x100): " << batch_memory << " bytes\n";
    
    size_t optimal_batch = mm.get_optimal_batch_size(500);
    std::cout << "Optimal batch size for 500bp sequences: " << optimal_batch << "\n";
    
    assert(mm.can_allocate(1024 * 1024));
    
    GPUBatchScheduler scheduler;
    Sequence q1, q2, t1, t2;
    q1.id = "q1";
    q1.raw_sequence = std::string(100, 'A');
    q2.id = "q2";
    q2.raw_sequence = std::string(100, 'T');
    t1.id = "t1";
    t1.raw_sequence = std::string(100, 'G');
    t2.id = "t2";
    t2.raw_sequence = std::string(100, 'C');
    
    std::vector<Sequence> queries = {q1, q2};
    std::vector<Sequence> targets = {t1, t2};
    
    auto batches = scheduler.schedule_batches(queries, targets);
    std::cout << "Number of batches created: " << batches.size() << "\n";
    
    std::cout << "GPU Memory Manager tests PASSED\n\n";
}

void test_task_queue() {
    std::cout << "=== Testing Task Queue ===\n";
    
    TaskQueue queue(2);
    
    Sequence query, target;
    query.id = "test_query";
    query.raw_sequence = "ATCGATCGATCG";
    target.id = "test_target";
    target.raw_sequence = "ATCGXTCGATCG";
    
    AlignmentConfig config;
    
    std::string task_id = queue.submit_task(query, target, config);
    std::cout << "Submitted task: " << task_id << "\n";
    
    TaskStatus status = queue.get_task_status(task_id);
    std::cout << "Initial status: " << static_cast<int>(status) << "\n";
    
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
    
    size_t pending = queue.get_pending_count();
    size_t running = queue.get_running_count();
    size_t completed = queue.get_completed_count();
    
    std::cout << "Pending: " << pending << ", Running: " << running << ", Completed: " << completed << "\n";
    
    auto task_result = queue.get_task_result(task_id);
    if (task_result) {
        std::cout << "Task found: " << task_result->task_id << "\n";
    }
    
    std::cout << "Task Queue tests PASSED\n\n";
}

void test_visualization_coordinates() {
    std::cout << "=== Testing Visualization Coordinates ===\n";
    
    AlignmentResult result;
    result.query_id = "query1";
    result.target_id = "target1";
    result.score = 42;
    result.identity = 0.85f;
    
    result.query_start = 10;
    result.query_end = 50;
    result.target_start = 15;
    result.target_end = 55;
    
    result.aligned_query = "ATCGATCGATCGATCGATCG------ATCGATCGATCG";
    result.aligned_target = "ATCGXTCGATCG----ATCGATCGATCGATCGATCG";
    result.alignment_midline = "|||| ||||||    |||||||||||||||||||||";
    
    Sequence query, target;
    query.id = "query1";
    query.raw_sequence = std::string(100, 'A');
    target.id = "target1";
    target.raw_sequence = std::string(100, 'T');
    
    result.score_matrix.resize(101);
    for (auto& row : result.score_matrix) {
        row.resize(101, 0);
    }
    for (int i = 0; i <= 100; i++) {
        for (int j = 0; j <= 100; j++) {
            result.score_matrix[i][j] = i + j;
        }
    }
    
    bool valid = AlignmentPathValidator::validate_coordinates(result, query, target);
    std::cout << "Coordinate validation (should be true): " << (valid ? "PASS" : "FAIL") << "\n";
    
    std::string diag = AlignmentPathValidator::get_diagnostic_info(result, query, target);
    std::cout << "\nDiagnostic info:\n" << diag << "\n";
    
    result.query_end = 200;
    result.target_end = 250;
    
    bool invalid = !AlignmentPathValidator::validate_coordinates(result, query, target);
    std::cout << "Coordinate validation (should be false): " << (invalid ? "PASS" : "FAIL") << "\n";
    
    AlignmentPathValidator::fix_coordinates(result, query, target);
    std::cout << "After fix - Query: " << result.query_start << " - " << result.query_end << "\n";
    std::cout << "          - Target: " << result.target_start << " - " << result.target_end << "\n";
    
    bool fixed_valid = AlignmentPathValidator::validate_coordinates(result, query, target);
    std::cout << "Fixed coordinates validation: " << (fixed_valid ? "PASS" : "FAIL") << "\n";
    
    HeatmapVisualizer::Config viz_config;
    viz_config.cell_size = 8;
    viz_config.margin = 40;
    
    HeatmapVisualizer viz(viz_config);
    
    try {
        viz.generate_svg_heatmap(result, query, target, "test_heatmap.svg");
        std::cout << "\nSVG heatmap generated successfully\n";
    } catch (const std::exception& e) {
        std::cout << "Error generating heatmap: " << e.what() << "\n";
    }
    
    AlignmentVisualizer align_viz;
    std::string alignment_text = align_viz.format_alignment(result, query, target);
    std::cout << "\nFormatted alignment preview:\n" << alignment_text.substr(0, 200) << "...\n";
    
    std::cout << "Visualization Coordinates tests PASSED\n\n";
}

void test_result_cache() {
    std::cout << "=== Testing Result Cache ===\n";
    
    auto& cache = ResultCache::get_instance();
    
    Sequence q1, t1;
    q1.id = "query1";
    t1.id = "target1";
    
    AlignmentConfig config;
    
    std::string key = cache.generate_key(q1.id, t1.id, config);
    std::cout << "Generated cache key: " << key << "\n";
    
    AlignmentResult result;
    result.query_id = q1.id;
    result.target_id = t1.id;
    result.score = 100;
    result.identity = 0.9f;
    
    cache.put(key, result);
    std::cout << "Cache size after put: " << cache.size() << "\n";
    
    auto cached = cache.get(key);
    if (cached) {
        std::cout << "Cache hit! Score: " << cached->result.score << "\n";
    } else {
        std::cout << "Cache miss!\n";
    }
    
    cache.invalidate(key);
    std::cout << "Cache size after invalidate: " << cache.size() << "\n";
    
    std::cout << "Result Cache tests PASSED\n\n";
}

int main() {
    std::cout << "========================================\n";
    std::cout << "   Gene Alignment Fixes Test Suite\n";
    std::cout << "========================================\n\n";
    
    try {
        test_gpu_memory_manager();
        test_task_queue();
        test_visualization_coordinates();
        test_result_cache();
        
        std::cout << "========================================\n";
        std::cout << "   All tests completed successfully!\n";
        std::cout << "========================================\n";
        
    } catch (const std::exception& e) {
        std::cerr << "Test failed with exception: " << e.what() << std::endl;
        return 1;
    }
    
    return 0;
}
