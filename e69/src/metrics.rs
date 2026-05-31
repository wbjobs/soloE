use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct ExecutionMetrics {
    pub total_executions: u64,
    pub successful_executions: u64,
    pub failed_executions: u64,
    pub total_execution_time_ms: u64,
    pub min_execution_time_ms: u64,
    pub max_execution_time_ms: u64,
}

impl Default for ExecutionMetrics {
    fn default() -> Self {
        Self {
            total_executions: 0,
            successful_executions: 0,
            failed_executions: 0,
            total_execution_time_ms: 0,
            min_execution_time_ms: u64::MAX,
            max_execution_time_ms: 0,
        }
    }
}

impl ExecutionMetrics {
    pub fn avg_execution_time_ms(&self) -> f64 {
        if self.total_executions == 0 {
            0.0
        } else {
            self.total_execution_time_ms as f64 / self.total_executions as f64
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct QueueMetrics {
    pub current_queue_length: usize,
    pub peak_queue_length: usize,
    pub total_enqueued: u64,
    pub total_dequeued: u64,
}

#[derive(Clone)]
pub struct MetricsCollector {
    total_executions: Arc<AtomicU64>,
    successful_executions: Arc<AtomicU64>,
    failed_executions: Arc<AtomicU64>,
    total_execution_time_ms: Arc<AtomicU64>,
    min_execution_time_ms: Arc<AtomicU64>,
    max_execution_time_ms: Arc<AtomicU64>,
    current_queue_length: Arc<AtomicU64>,
    peak_queue_length: Arc<AtomicU64>,
    total_enqueued: Arc<AtomicU64>,
    total_dequeued: Arc<AtomicU64>,
    enabled: bool,
}

impl MetricsCollector {
    pub fn new(enabled: bool) -> Self {
        Self {
            total_executions: Arc::new(AtomicU64::new(0)),
            successful_executions: Arc::new(AtomicU64::new(0)),
            failed_executions: Arc::new(AtomicU64::new(0)),
            total_execution_time_ms: Arc::new(AtomicU64::new(0)),
            min_execution_time_ms: Arc::new(AtomicU64::new(u64::MAX)),
            max_execution_time_ms: Arc::new(AtomicU64::new(0)),
            current_queue_length: Arc::new(AtomicU64::new(0)),
            peak_queue_length: Arc::new(AtomicU64::new(0)),
            total_enqueued: Arc::new(AtomicU64::new(0)),
            total_dequeued: Arc::new(AtomicU64::new(0)),
            enabled,
        }
    }

    pub fn record_execution(&self, duration: Duration, success: bool) {
        if !self.enabled {
            return;
        }
        let ms = duration.as_millis() as u64;
        self.total_executions.fetch_add(1, Ordering::Relaxed);
        if success {
            self.successful_executions.fetch_add(1, Ordering::Relaxed);
        } else {
            self.failed_executions.fetch_add(1, Ordering::Relaxed);
        }
        self.total_execution_time_ms.fetch_add(ms, Ordering::Relaxed);
        
        let mut current_min = self.min_execution_time_ms.load(Ordering::Relaxed);
        while ms < current_min {
            match self.min_execution_time_ms.compare_exchange(
                current_min,
                ms,
                Ordering::Relaxed,
                Ordering::Relaxed,
            ) {
                Ok(_) => break,
                Err(actual) => current_min = actual,
            }
        }
        
        let mut current_max = self.max_execution_time_ms.load(Ordering::Relaxed);
        while ms > current_max {
            match self.max_execution_time_ms.compare_exchange(
                current_max,
                ms,
                Ordering::Relaxed,
                Ordering::Relaxed,
            ) {
                Ok(_) => break,
                Err(actual) => current_max = actual,
            }
        }
    }

    pub fn record_enqueue(&self) {
        if !self.enabled {
            return;
        }
        self.total_enqueued.fetch_add(1, Ordering::Relaxed);
        let current = self.current_queue_length.fetch_add(1, Ordering::Relaxed) + 1;
        
        let mut peak = self.peak_queue_length.load(Ordering::Relaxed);
        while current > peak as usize {
            match self.peak_queue_length.compare_exchange(
                peak,
                current as u64,
                Ordering::Relaxed,
                Ordering::Relaxed,
            ) {
                Ok(_) => break,
                Err(actual) => peak = actual,
            }
        }
    }

    pub fn record_dequeue(&self) {
        if !self.enabled {
            return;
        }
        self.total_dequeued.fetch_add(1, Ordering::Relaxed);
        let _ = self.current_queue_length.fetch_update(
            Ordering::Relaxed,
            Ordering::Relaxed,
            |x| if x > 0 { Some(x - 1) } else { None },
        );
    }

    pub fn get_execution_metrics(&self) -> ExecutionMetrics {
        ExecutionMetrics {
            total_executions: self.total_executions.load(Ordering::Relaxed),
            successful_executions: self.successful_executions.load(Ordering::Relaxed),
            failed_executions: self.failed_executions.load(Ordering::Relaxed),
            total_execution_time_ms: self.total_execution_time_ms.load(Ordering::Relaxed),
            min_execution_time_ms: self.min_execution_time_ms.load(Ordering::Relaxed),
            max_execution_time_ms: self.max_execution_time_ms.load(Ordering::Relaxed),
        }
    }

    pub fn get_queue_metrics(&self) -> QueueMetrics {
        QueueMetrics {
            current_queue_length: self.current_queue_length.load(Ordering::Relaxed) as usize,
            peak_queue_length: self.peak_queue_length.load(Ordering::Relaxed) as usize,
            total_enqueued: self.total_enqueued.load(Ordering::Relaxed),
            total_dequeued: self.total_dequeued.load(Ordering::Relaxed),
        }
    }

    pub fn reset(&self) {
        self.total_executions.store(0, Ordering::Relaxed);
        self.successful_executions.store(0, Ordering::Relaxed);
        self.failed_executions.store(0, Ordering::Relaxed);
        self.total_execution_time_ms.store(0, Ordering::Relaxed);
        self.min_execution_time_ms.store(u64::MAX, Ordering::Relaxed);
        self.max_execution_time_ms.store(0, Ordering::Relaxed);
        self.current_queue_length.store(0, Ordering::Relaxed);
        self.peak_queue_length.store(0, Ordering::Relaxed);
        self.total_enqueued.store(0, Ordering::Relaxed);
        self.total_dequeued.store(0, Ordering::Relaxed);
    }
}
