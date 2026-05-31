#pragma once

#include "common.h"
#include <queue>
#include <mutex>
#include <condition_variable>
#include <thread>
#include <atomic>
#include <chrono>
#include <functional>
#include <future>
#include <vector>
#include <unordered_map>

namespace gene {

enum class TaskStatus {
    PENDING,
    RUNNING,
    COMPLETED,
    TIMEOUT,
    FAILED,
    CANCELLED
};

struct AlignmentTask {
    std::string task_id;
    Sequence query;
    Sequence target;
    AlignmentConfig config;
    AlignmentResult result;
    TaskStatus status;
    std::chrono::steady_clock::time_point submit_time;
    std::chrono::steady_clock::time_point start_time;
    std::chrono::steady_clock::time_point end_time;
    std::chrono::milliseconds timeout_ms;
    std::string error_message;
};

class TaskQueue {
public:
    using TaskCallback = std::function<void(const AlignmentTask&)>;

    explicit TaskQueue(size_t num_workers = 0);
    ~TaskQueue();

    std::string submit_task(const Sequence& query, 
                            const Sequence& target,
                            const AlignmentConfig& config,
                            std::chrono::milliseconds timeout = std::chrono::milliseconds(30000));

    TaskStatus get_task_status(const std::string& task_id);
    
    std::shared_ptr<AlignmentTask> get_task_result(const std::string& task_id);
    
    bool wait_for_task(const std::string& task_id, 
                       std::chrono::milliseconds timeout = std::chrono::milliseconds::zero());

    void cancel_task(const std::string& task_id);
    
    void set_completion_callback(TaskCallback callback);

    size_t get_pending_count() const;
    size_t get_running_count() const;
    size_t get_completed_count() const;

    void shutdown();
    void clear_completed();

private:
    void worker_thread(size_t worker_id);
    
    void process_task(AlignmentTask& task);
    
    bool check_timeout(AlignmentTask& task);
    
    std::string generate_task_id();

    std::queue<std::shared_ptr<AlignmentTask>> queue_;
    std::unordered_map<std::string, std::shared_ptr<AlignmentTask>> tasks_map_;
    
    mutable std::mutex queue_mutex_;
    std::condition_variable cv_;
    std::vector<std::thread> workers_;
    std::atomic<bool> running_;
    std::atomic<size_t> task_counter_;
    std::atomic<size_t> running_count_;
    std::atomic<size_t> completed_count_;
    
    TaskCallback completion_callback_;
    std::mutex callback_mutex_;

    static constexpr std::chrono::milliseconds HEARTBEAT_INTERVAL{100};
};

class ResultCache {
public:
    static ResultCache& get_instance();

    struct CacheEntry {
        AlignmentResult result;
        std::chrono::steady_clock::time_point created_at;
        size_t hit_count;
    };

    std::shared_ptr<CacheEntry> get(const std::string& key);
    
    void put(const std::string& key, const AlignmentResult& result);
    
    void invalidate(const std::string& key);
    
    void clear();
    
    size_t size() const;
    
    void set_max_size(size_t max_size);
    
    void set_ttl(std::chrono::seconds ttl);

    std::string generate_key(const std::string& query_id, 
                             const std::string& target_id,
                             const AlignmentConfig& config);

private:
    ResultCache();
    ~ResultCache();

    void evict_if_needed();
    void cleanup_expired();

    mutable std::mutex mutex_;
    std::unordered_map<std::string, std::shared_ptr<CacheEntry>> cache_;
    size_t max_size_;
    std::chrono::seconds ttl_;
    std::atomic<size_t> total_hits_;
    std::atomic<size_t> total_misses_;
};

}
