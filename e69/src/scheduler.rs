use crate::config::{Priority, ResourceLimits, SchedulerConfig};
use crate::error::{Result, SchedulerError};
use crate::ipc::IpcManager;
use crate::metrics::MetricsCollector;
use crate::module::{ModuleManager, WasiModule};
use crossbeam::channel;
use std::sync::Arc;
use std::time::Instant;
use uuid::Uuid;
use wasmtime::{Engine, Linker, Store};

#[derive(Debug, Clone)]
pub struct Task {
    pub id: String,
    pub module: WasiModule,
    pub priority: Priority,
    pub submitted_at: Instant,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}

impl PartialEq for Task {
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id
    }
}

impl Eq for Task {}

impl std::hash::Hash for Task {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.id.hash(state);
    }
}

impl Ord for Task {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.priority.cmp(&other.priority)
            .then_with(|| other.submitted_at.cmp(&self.submitted_at))
    }
}

impl PartialOrd for Task {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

pub struct TaskQueue {
    sender: channel::Sender<Task>,
    receiver: channel::Receiver<Task>,
    max_size: usize,
    metrics: MetricsCollector,
}

impl TaskQueue {
    pub fn new(max_size: usize, metrics: MetricsCollector) -> Self {
        let (sender, receiver) = channel::bounded(max_size);
        Self {
            sender,
            receiver,
            max_size,
            metrics,
        }
    }

    pub fn enqueue(&self, task: Task) -> Result<()> {
        self.sender.send(task).map_err(|_| {
            SchedulerError::Other("Queue is full".to_string())
        })?;
        self.metrics.record_enqueue();
        Ok(())
    }

    pub fn dequeue(&self) -> Option<Task> {
        match self.receiver.try_recv() {
            Ok(task) => {
                self.metrics.record_dequeue();
                Some(task)
            }
            Err(_) => None,
        }
    }

    pub fn dequeue_blocking(&self) -> Option<Task> {
        match self.receiver.recv() {
            Ok(task) => {
                self.metrics.record_dequeue();
                Some(task)
            }
            Err(_) => None,
        }
    }

    pub fn len(&self) -> usize {
        self.receiver.len()
    }

    pub fn is_empty(&self) -> bool {
        self.receiver.is_empty()
    }
}

impl Clone for TaskQueue {
    fn clone(&self) -> Self {
        Self {
            sender: self.sender.clone(),
            receiver: self.receiver.clone(),
            max_size: self.max_size,
            metrics: self.metrics.clone(),
        }
    }
}

struct StoreLimiter {
    memory_used: usize,
    max_memory: usize,
}

impl wasmtime::ResourceLimiter for StoreLimiter {
    fn memory_growing(
        &mut self,
        current: usize,
        desired: usize,
        _maximum: Option<usize>,
    ) -> std::result::Result<bool, wasmtime::Error> {
        if desired > self.max_memory {
            Ok(false)
        } else {
            self.memory_used = desired;
            Ok(true)
        }
    }

    fn table_growing(
        &mut self,
        _current: u32,
        _desired: u32,
        _maximum: Option<u32>,
    ) -> std::result::Result<bool, wasmtime::Error> {
        Ok(true)
    }
}

struct StoreData {
    wasi_ctx: wasmtime_wasi::WasiCtx,
    limiter: StoreLimiter,
}

pub struct WasiScheduler {
    engine: Arc<Engine>,
    module_manager: ModuleManager,
    task_queue: TaskQueue,
    metrics: MetricsCollector,
    ipc_manager: Arc<IpcManager>,
    workers: Vec<std::thread::JoinHandle<()>>,
    shutdown: channel::Sender<()>,
    config: SchedulerConfig,
}

impl WasiScheduler {
    pub fn new(config: SchedulerConfig) -> Result<Self> {
        let engine = Arc::new(Engine::default());
        let metrics = MetricsCollector::new(config.enable_metrics);
        let module_manager = ModuleManager::new(Arc::clone(&engine));
        let task_queue = TaskQueue::new(config.max_queue_size, metrics.clone());
        let ipc_manager = Arc::new(IpcManager::new(100, 10 * 1024 * 1024));
        let (shutdown, shutdown_rx) = channel::bounded(1);

        let mut workers = Vec::with_capacity(config.thread_pool_size);

        for _ in 0..config.thread_pool_size {
            let task_queue = task_queue.clone();
            let engine = Arc::clone(&engine);
            let metrics = metrics.clone();
            let shutdown = shutdown_rx.clone();

            let handle = std::thread::spawn(move || {
                Self::worker_loop(task_queue, engine, metrics, shutdown);
            });
            workers.push(handle);
        }

        Ok(Self {
            engine,
            module_manager,
            task_queue,
            metrics,
            ipc_manager,
            workers,
            shutdown,
            config,
        })
    }

    pub fn load_module(
        &self,
        name: String,
        path: &str,
        priority: Priority,
        limits: Option<ResourceLimits>,
    ) -> Result<String> {
        self.module_manager.load_module(name, path, priority, limits)
    }

    pub fn unload_module(&self, module_id: &str) -> Result<()> {
        self.module_manager.unload_module(module_id)
    }

    pub fn submit_task(&self, module_id: &str, args: Vec<String>, env: Vec<(String, String)>) -> Result<String> {
        let module = self.module_manager.get_module(module_id)?;
        let task = Task {
            id: Uuid::new_v4().to_string(),
            module,
            priority: module.priority,
            submitted_at: Instant::now(),
            args,
            env,
        };
        let task_id = task.id.clone();
        self.task_queue.enqueue(task)?;
        Ok(task_id)
    }

    pub fn list_modules(&self) -> Vec<(String, String, Priority)> {
        self.module_manager.list_modules()
    }

    pub fn queue_length(&self) -> usize {
        self.task_queue.len()
    }

    pub fn get_execution_metrics(&self) -> crate::metrics::ExecutionMetrics {
        self.metrics.get_execution_metrics()
    }

    pub fn get_queue_metrics(&self) -> crate::metrics::QueueMetrics {
        self.metrics.get_queue_metrics()
    }

    pub fn get_ipc_manager(&self) -> Arc<IpcManager> {
        Arc::clone(&self.ipc_manager)
    }

    pub fn shutdown(&self) {
        let _ = self.shutdown.send(());
    }

    fn worker_loop(
        task_queue: TaskQueue,
        engine: Arc<Engine>,
        metrics: MetricsCollector,
        shutdown: channel::Receiver<()>,
    ) {
        loop {
            crossbeam::select! {
                recv(shutdown) -> _ => break,
                recv(task_queue.receiver) -> task => {
                    if let Ok(task) = task {
                        let start = Instant::now();
                        let success = Self::execute_task(&engine, &task).is_ok();
                        let duration = start.elapsed();
                        metrics.record_execution(duration, success);
                    }
                }
            }
        }
    }

    fn execute_task(engine: &Engine, task: &Task) -> Result<()> {
        let limits = &task.module.limits;
        
        let wasi_ctx = wasmtime_wasi::WasiCtxBuilder::new()
            .inherit_stdio()
            .args(&task.args)?
            .envs(&task.env)?
            .build();

        let limiter = StoreLimiter {
            memory_used: 0,
            max_memory: limits.max_memory_bytes,
        };

        let store_data = StoreData { wasi_ctx, limiter };
        
        let mut store = Store::new(engine, store_data);
        store.limiter(|data| &mut data.limiter);

        let mut linker = Linker::new(engine);
        wasmtime_wasi::add_to_linker(&mut linker, |s| &mut s.wasi_ctx)?;

        let instance = linker.instantiate(&mut store, &task.module.module)?;

        let start = Instant::now();
        let timeout = std::time::Duration::from_millis(limits.max_cpu_time_ms);

        let (result_tx, result_rx) = channel::bounded(1);
        
        let handle = std::thread::spawn(move || {
            let result = match instance.get_func(&mut store, "_start") {
                Ok(func) => func.call(&mut store, &[], &mut []).map_err(|e| {
                    SchedulerError::Other(format!("Execution error: {}", e))
                }),
                Err(_) => Ok(()),
            };
            let _ = result_tx.send(result);
        });

        let result = match result_rx.recv_timeout(timeout) {
            Ok(res) => res,
            Err(_) => {
                return Err(SchedulerError::ExecutionTimeout(task.module.name.clone()));
            }
        };

        let _ = handle.join();
        result?;
        Ok(())
    }
}

impl Drop for WasiScheduler {
    fn drop(&mut self) {
        self.shutdown();
        for _ in 0..self.workers.len() {
            let _ = self.shutdown.send(());
        }
    }
}
