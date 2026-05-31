#include "gpu_memory_manager.h"
#include <algorithm>
#include <stdexcept>

namespace gene::gpu {

GPUMemoryManager& GPUMemoryManager::get_instance() {
    static GPUMemoryManager instance;
    return instance;
}

GPUMemoryManager::GPUMemoryManager() {
}

GPUMemoryManager::~GPUMemoryManager() {
    clear_cache();
}

GPUMemoryManager::MemoryInfo GPUMemoryManager::get_memory_info(int device_id) {
    std::lock_guard<std::mutex> lock(mutex_);
    
    cudaSetDevice(device_id);
    size_t free_bytes, total_bytes;
    cudaError_t err = cudaMemGetInfo(&free_bytes, &total_bytes);
    
    if (err != cudaSuccess) {
        return {0, 0, 0, 0.0f};
    }

    MemoryInfo info;
    info.total_bytes = total_bytes;
    info.free_bytes = free_bytes;
    info.used_bytes = total_bytes - free_bytes;
    info.utilization = static_cast<float>(info.used_bytes) / total_bytes;
    
    return info;
}

size_t GPUMemoryManager::get_safe_allocation_size(size_t requested_size, int device_id) {
    auto info = get_memory_info(device_id);
    size_t max_safe = static_cast<size_t>(info.free_bytes * SAFETY_FACTOR);
    return std::min(requested_size, max_safe);
}

bool GPUMemoryManager::can_allocate(size_t size, int device_id) {
    std::lock_guard<std::mutex> lock(mutex_);
    return can_allocate_internal(size, device_id);
}

bool GPUMemoryManager::can_allocate_internal(size_t size, int device_id) {
    size_t free_bytes, total_bytes;
    cudaSetDevice(device_id);
    cudaError_t err = cudaMemGetInfo(&free_bytes, &total_bytes);
    
    if (err != cudaSuccess) {
        return false;
    }

    return size <= static_cast<size_t>(free_bytes * SAFETY_FACTOR);
}

void GPUMemoryManager::free_gpu(void* ptr) {
    if (ptr == nullptr) return;
    
    std::lock_guard<std::mutex> lock(mutex_);
    uintptr_t key = reinterpret_cast<uintptr_t>(ptr);
    auto it = allocations_.find(key);
    
    if (it != allocations_.end()) {
        cudaFree(ptr);
        allocations_.erase(it);
    }
}

size_t GPUMemoryManager::calculate_matrix_size(size_t seq1_len, size_t seq2_len) {
    size_t rows = seq1_len + 1;
    size_t cols = seq2_len + 1;
    return rows * cols * sizeof(int32_t);
}

size_t GPUMemoryManager::calculate_batch_memory(size_t batch_size, size_t max_seq_len) {
    size_t per_task = calculate_matrix_size(max_seq_len, max_seq_len);
    size_t sequence_storage = batch_size * 2 * max_seq_len * sizeof(uint8_t);
    size_t result_storage = batch_size * sizeof(int32_t);
    
    return per_task * batch_size + sequence_storage + result_storage + 1024 * 1024;
}

size_t GPUMemoryManager::get_optimal_batch_size(size_t max_seq_len, int device_id) {
    auto info = get_memory_info(device_id);
    size_t available = static_cast<size_t>(info.free_bytes * SAFETY_FACTOR);
    
    size_t per_task = calculate_matrix_size(max_seq_len, max_seq_len);
    per_task += 2 * max_seq_len * sizeof(uint8_t) + sizeof(int32_t);
    
    if (per_task == 0) return 1;
    if (per_task > available) return 1;
    
    size_t optimal = available / per_task;
    return std::max(1UL, std::min(optimal, static_cast<size_t>(128)));
}

void GPUMemoryManager::clear_cache() {
    std::lock_guard<std::mutex> lock(mutex_);
    for (auto& pair : allocations_) {
        cudaFree(reinterpret_cast<void*>(pair.first));
    }
    allocations_.clear();
}

GPUBatchScheduler::GPUBatchScheduler(int device_id) 
    : device_id_(device_id), memory_manager_(GPUMemoryManager::get_instance()) {
}

size_t GPUBatchScheduler::get_optimal_tasks_per_batch(size_t max_seq_len) {
    return memory_manager_.get_optimal_batch_size(max_seq_len, device_id_);
}

std::vector<GPUBatchScheduler::BatchTask> 
GPUBatchScheduler::schedule_batches(const std::vector<Sequence>& queries,
                                     const std::vector<Sequence>& targets,
                                     size_t max_batch_size) {
    size_t max_seq_len = 0;
    for (const auto& q : queries) {
        max_seq_len = std::max(max_seq_len, q.length());
    }
    for (const auto& t : targets) {
        max_seq_len = std::max(max_seq_len, t.length());
    }

    size_t optimal_batch = get_optimal_tasks_per_batch(max_seq_len);
    if (max_batch_size > 0) {
        optimal_batch = std::min(optimal_batch, max_batch_size);
    }

    std::vector<BatchTask> batches;
    size_t total_tasks = queries.size() * targets.size();
    size_t current_batch = 0;
    size_t task_count = 0;

    BatchTask current;
    current.batch_id = current_batch;

    for (const auto& query : queries) {
        for (const auto& target : targets) {
            current.queries.push_back(query);
            current.targets.push_back(target);
            task_count++;

            if (task_count >= optimal_batch) {
                batches.push_back(current);
                current_batch++;
                current = BatchTask();
                current.batch_id = current_batch;
                task_count = 0;
            }
        }
    }

    if (!current.queries.empty()) {
        batches.push_back(current);
    }

    return batches;
}

}
