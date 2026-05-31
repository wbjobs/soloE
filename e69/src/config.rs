use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceLimits {
    pub max_cpu_time_ms: u64,
    pub max_memory_bytes: u64,
    pub max_file_descriptors: u32,
}

impl Default for ResourceLimits {
    fn default() -> Self {
        Self {
            max_cpu_time_ms: 5000,
            max_memory_bytes: 64 * 1024 * 1024,
            max_file_descriptors: 64,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchedulerConfig {
    pub thread_pool_size: usize,
    pub max_queue_size: usize,
    pub default_limits: ResourceLimits,
    pub enable_metrics: bool,
    pub enable_ipc: bool,
}

impl Default for SchedulerConfig {
    fn default() -> Self {
        Self {
            thread_pool_size: num_cpus::get(),
            max_queue_size: 1000,
            default_limits: ResourceLimits::default(),
            enable_metrics: true,
            enable_ipc: true,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum Priority {
    Low = 0,
    Normal = 1,
    High = 2,
    Critical = 3,
}

impl Default for Priority {
    fn default() -> Self {
        Priority::Normal
    }
}
