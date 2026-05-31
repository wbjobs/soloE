#include "task_queue.h"
#include <sstream>
#include <iomanip>
#include <algorithm>

namespace gene {

TaskQueue::TaskQueue(size_t num_workers) 
    : running_(true), task_counter_(0), running_count_(0), completed_count_(0) {
    
    if (num_workers == 0) {
        num_workers = std::thread::hardware_concurrency();
        if (num_workers == 0) num_workers = 4;
    }

    for (size_t i = 0; i < num_workers; ++i) {
        workers_.emplace_back(&TaskQueue::worker_thread, this, i);
    }
}

TaskQueue::~TaskQueue() {
    shutdown();
}

void TaskQueue::shutdown() {
    running_ = false;
    cv_.notify_all();
    
    for (auto& worker : workers_) {
        if (worker.joinable()) {
            worker.join();
        }
    }
    workers_.clear();
}

std::string TaskQueue::generate_task_id() {
    std::stringstream ss;
    ss << "task_" << std::setw(8) << std::setfill('0') << task_counter_++;
    return ss.str();
}

std::string TaskQueue::submit_task(const Sequence& query, 
                                    const Sequence& target,
                                    const AlignmentConfig& config,
                                    std::chrono::milliseconds timeout) {
    auto task = std::make_shared<AlignmentTask>();
    task->task_id = generate_task_id();
    task->query = query;
    task->target = target;
    task->config = config;
    task->status = TaskStatus::PENDING;
    task->submit_time = std::chrono::steady_clock::now();
    task->timeout_ms = timeout;

    {
        std::lock_guard<std::mutex> lock(queue_mutex_);
        queue_.push(task);
        tasks_map_[task->task_id] = task;
    }
    
    cv_.notify_one();
    return task->task_id;
}

TaskStatus TaskQueue::get_task_status(const std::string& task_id) {
    std::lock_guard<std::mutex> lock(queue_mutex_);
    auto it = tasks_map_.find(task_id);
    if (it == tasks_map_.end()) {
        return TaskStatus::CANCELLED;
    }
    return it->second->status;
}

std::shared_ptr<AlignmentTask> TaskQueue::get_task_result(const std::string& task_id) {
    std::lock_guard<std::mutex> lock(queue_mutex_);
    auto it = tasks_map_.find(task_id);
    if (it == tasks_map_.end()) {
        return nullptr;
    }
    return it->second;
}

bool TaskQueue::wait_for_task(const std::string& task_id, std::chrono::milliseconds timeout) {
    auto start = std::chrono::steady_clock::now();
    
    while (true) {
        {
            std::lock_guard<std::mutex> lock(queue_mutex_);
            auto it = tasks_map_.find(task_id);
            if (it == tasks_map_.end()) {
                return false;
            }
            
            auto status = it->second->status;
            if (status == TaskStatus::COMPLETED || 
                status == TaskStatus::TIMEOUT || 
                status == TaskStatus::FAILED ||
                status == TaskStatus::CANCELLED) {
                return true;
            }
        }

        if (timeout != std::chrono::milliseconds::zero()) {
            auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::steady_clock::now() - start);
            if (elapsed >= timeout) {
                return false;
            }
        }

        std::this_thread::sleep_for(HEARTBEAT_INTERVAL);
    }
}

void TaskQueue::cancel_task(const std::string& task_id) {
    std::lock_guard<std::mutex> lock(queue_mutex_);
    auto it = tasks_map_.find(task_id);
    if (it != tasks_map_.end()) {
        if (it->second->status == TaskStatus::PENDING) {
            it->second->status = TaskStatus::CANCELLED;
        }
    }
}

void TaskQueue::set_completion_callback(TaskCallback callback) {
    std::lock_guard<std::mutex> lock(callback_mutex_);
    completion_callback_ = callback;
}

size_t TaskQueue::get_pending_count() const {
    std::lock_guard<std::mutex> lock(queue_mutex_);
    return queue_.size();
}

size_t TaskQueue::get_running_count() const {
    return running_count_.load();
}

size_t TaskQueue::get_completed_count() const {
    return completed_count_.load();
}

void TaskQueue::clear_completed() {
    std::lock_guard<std::mutex> lock(queue_mutex_);
    for (auto it = tasks_map_.begin(); it != tasks_map_.end(); ) {
        if (it->second->status == TaskStatus::COMPLETED ||
            it->second->status == TaskStatus::TIMEOUT ||
            it->second->status == TaskStatus::FAILED ||
            it->second->status == TaskStatus::CANCELLED) {
            it = tasks_map_.erase(it);
        } else {
            ++it;
        }
    }
}

bool TaskQueue::check_timeout(AlignmentTask& task) {
    auto now = std::chrono::steady_clock::now();
    auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(now - task.submit_time);
    
    if (elapsed > task.timeout_ms) {
        task.status = TaskStatus::TIMEOUT;
        task.error_message = "Task timed out after " + 
                            std::to_string(task.timeout_ms.count()) + "ms";
        task.end_time = now;
        return true;
    }
    return false;
}

void TaskQueue::process_task(AlignmentTask& task) {
}

void TaskQueue::worker_thread(size_t worker_id) {
    while (running_) {
        std::shared_ptr<AlignmentTask> task = nullptr;
        
        {
            std::unique_lock<std::mutex> lock(queue_mutex_);
            cv_.wait_for(lock, HEARTBEAT_INTERVAL, [this] {
                return !queue_.empty() || !running_;
            });

            if (!running_) break;
            if (queue_.empty()) continue;

            while (!queue_.empty()) {
                auto front = queue_.front();
                if (front->status == TaskStatus::CANCELLED) {
                    queue_.pop();
                    continue;
                }
                
                if (check_timeout(*front)) {
                    queue_.pop();
                    completed_count_++;
                    continue;
                }
                
                task = front;
                queue_.pop();
                break;
            }
        }

        if (!task) continue;

        task->status = TaskStatus::RUNNING;
        task->start_time = std::chrono::steady_clock::now();
        running_count_++;

        try {
            process_task(*task);
            
            if (task->status != TaskStatus::TIMEOUT) {
                task->status = TaskStatus::COMPLETED;
            }
        } catch (const std::exception& e) {
            task->status = TaskStatus::FAILED;
            task->error_message = e.what();
        }

        task->end_time = std::chrono::steady_clock::now();
        running_count_--;
        completed_count_++;

        {
            std::lock_guard<std::mutex> lock(callback_mutex_);
            if (completion_callback_) {
                completion_callback_(*task);
            }
        }
    }
}

ResultCache& ResultCache::get_instance() {
    static ResultCache instance;
    return instance;
}

ResultCache::ResultCache() 
    : max_size_(1000), ttl_(3600), total_hits_(0), total_misses_(0) {
}

ResultCache::~ResultCache() {
}

std::string ResultCache::generate_key(const std::string& query_id, 
                                       const std::string& target_id,
                                       const AlignmentConfig& config) {
    std::stringstream ss;
    ss << query_id << "_" << target_id << "_" 
       << config.match_score << "_" << config.mismatch_penalty << "_"
       << config.gap_open_penalty << "_" << config.gap_extend_penalty;
    return ss.str();
}

std::shared_ptr<ResultCache::CacheEntry> ResultCache::get(const std::string& key) {
    std::lock_guard<std::mutex> lock(mutex_);
    
    cleanup_expired();
    
    auto it = cache_.find(key);
    if (it == cache_.end()) {
        total_misses_++;
        return nullptr;
    }
    
    total_hits_++;
    it->second->hit_count++;
    return it->second;
}

void ResultCache::put(const std::string& key, const AlignmentResult& result) {
    std::lock_guard<std::mutex> lock(mutex_);
    
    evict_if_needed();
    
    auto entry = std::make_shared<CacheEntry>();
    entry->result = result;
    entry->created_at = std::chrono::steady_clock::now();
    entry->hit_count = 1;
    
    cache_[key] = entry;
}

void ResultCache::invalidate(const std::string& key) {
    std::lock_guard<std::mutex> lock(mutex_);
    cache_.erase(key);
}

void ResultCache::clear() {
    std::lock_guard<std::mutex> lock(mutex_);
    cache_.clear();
}

size_t ResultCache::size() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return cache_.size();
}

void ResultCache::set_max_size(size_t max_size) {
    std::lock_guard<std::mutex> lock(mutex_);
    max_size_ = max_size;
    evict_if_needed();
}

void ResultCache::set_ttl(std::chrono::seconds ttl) {
    std::lock_guard<std::mutex> lock(mutex_);
    ttl_ = ttl;
    cleanup_expired();
}

void ResultCache::evict_if_needed() {
    if (cache_.size() < max_size_) return;
    
    size_t to_remove = cache_.size() - max_size_ + 1;
    std::vector<std::pair<std::string, size_t>> hit_counts;
    
    for (const auto& pair : cache_) {
        hit_counts.emplace_back(pair.first, pair.second->hit_count);
    }
    
    std::sort(hit_counts.begin(), hit_counts.end(),
              [](const auto& a, const auto& b) { return a.second < b.second; });
    
    for (size_t i = 0; i < to_remove && i < hit_counts.size(); ++i) {
        cache_.erase(hit_counts[i].first);
    }
}

void ResultCache::cleanup_expired() {
    auto now = std::chrono::steady_clock::now();
    
    for (auto it = cache_.begin(); it != cache_.end(); ) {
        auto age = std::chrono::duration_cast<std::chrono::seconds>(now - it->second->created_at);
        if (age > ttl_) {
            it = cache_.erase(it);
        } else {
            ++it;
        }
    }
}

}
