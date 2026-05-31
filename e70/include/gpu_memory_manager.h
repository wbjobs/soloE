#pragma once

#include "common.h"
#include <cuda_runtime.h>
#include <vector>
#include <memory>
#include <mutex>
#include <unordered_map>

namespace gene::gpu {

class GPUMemoryManager {
public:
    static GPUMemoryManager& get_instance();

    struct MemoryInfo {
        size_t total_bytes;
        size_t free_bytes;
        size_t used_bytes;
        float utilization;
    };

    MemoryInfo get_memory_info(int device_id = 0);

    size_t get_safe_allocation_size(size_t requested_size, int device_id = 0);

    bool can_allocate(size_t size, int device_id = 0);

    template<typename T>
    std::shared_ptr<T> allocate(size_t count, int device_id = 0) {
        std::lock_guard<std::mutex> lock(mutex_);
        size_t bytes = count * sizeof(T);
        
        if (!can_allocate_internal(bytes, device_id)) {
            return nullptr;
        }

        T* dev_ptr = nullptr;
        cudaError_t err = cudaMalloc(&dev_ptr, bytes);
        if (err != cudaSuccess || dev_ptr == nullptr) {
            return nullptr;
        }

        allocations_[reinterpret_cast<uintptr_t>(dev_ptr)] = bytes;
        return std::shared_ptr<T>(dev_ptr, [this](T* ptr) {
            this->free_gpu(ptr);
        });
    }

    void free_gpu(void* ptr);

    size_t calculate_matrix_size(size_t seq1_len, size_t seq2_len);
    
    size_t calculate_batch_memory(size_t batch_size, size_t max_seq_len);
    
    size_t get_optimal_batch_size(size_t max_seq_len, int device_id = 0);

    void clear_cache();

private:
    GPUMemoryManager();
    ~GPUMemoryManager();
    
    GPUMemoryManager(const GPUMemoryManager&) = delete;
    GPUMemoryManager& operator=(const GPUMemoryManager&) = delete;

    bool can_allocate_internal(size_t size, int device_id);

    std::mutex mutex_;
    std::unordered_map<uintptr_t, size_t> allocations_;
    static constexpr float SAFETY_FACTOR = 0.85f;
};

class GPUBatchScheduler {
public:
    struct BatchTask {
        std::vector<Sequence> queries;
        std::vector<Sequence> targets;
        size_t batch_id;
    };

    GPUBatchScheduler(int device_id = 0);

    std::vector<BatchTask> schedule_batches(const std::vector<Sequence>& queries,
                                             const std::vector<Sequence>& targets,
                                             size_t max_batch_size = 0);

    size_t get_optimal_tasks_per_batch(size_t max_seq_len);

private:
    int device_id_;
    GPUMemoryManager& memory_manager_;
};

}
