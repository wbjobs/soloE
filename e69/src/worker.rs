use crate::config::Priority;
use crate::error::{Result, SchedulerError};
use crate::metrics::MetricsCollector;
use crate::module::WasiModule;
use parking_lot::Mutex;
use priority_queue::PriorityQueue;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Semaphore;
use uuid::Uuid;

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

pub struct TaskQueue {
    queue: Arc<Mutex<PriorityQueue<Task, Priority>>>,
    max_size: usize,
    metrics: MetricsCollector,
}

impl TaskQueue {
    pub fn new(max_size: usize, metrics: MetricsCollector) -> Self {
        Self {
            queue: Arc::new(Mutex::new(PriorityQueue::new())),
            max_size,
            metrics,
        }
    }

    pub fn enqueue(&self, task: Task) -> Result<()> {
        let mut queue = self.queue.lock();
        if queue.len() >= self.max_size {
            return Err(SchedulerError::Other("Queue is full".to_string()));
        }
        let priority = task.priority;
        queue.push(task, priority);
        self.metrics.record_enqueue();
        Ok(())
    }

    pub fn dequeue(&self) -> Option<Task> {
        let mut queue = self.queue.lock();
        let task = queue.pop().map(|(task, _)| task);
        if task.is_some() {
            self.metrics.record_dequeue();
        }
        task
    }

    pub fn len(&self) -> usize {
        self.queue.lock().len()
    }

    pub fn is_empty(&self) -> bool {
        self.queue.lock().is_empty()
    }
}

impl Clone for TaskQueue {
    fn clone(&self) -> Self {
        Self {
            queue: Arc::clone(&self.queue),
            max_size: self.max_size,
            metrics: self.metrics.clone(),
        }
    }
}

pub struct ThreadPool {
    workers: Vec<std::thread::JoinHandle<()>>,
    task_queue: TaskQueue,
    semaphore: Arc<Semaphore>,
    engine: Arc<wasmtime::Engine>,
    metrics: MetricsCollector,
    ipc_manager: Arc<crate::ipc::IpcManager>,
}

impl ThreadPool {
    pub fn new(
        size: usize,
        task_queue: TaskQueue,
        engine: Arc<wasmtime::Engine>,
        metrics: MetricsCollector,
        ipc_manager: Arc<crate::ipc::IpcManager>,
    ) -> Self {
        let semaphore = Arc::new(Semaphore::new(size));
        let mut workers = Vec::with_capacity(size);

        for _ in 0..size {
            let task_queue = task_queue.clone();
            let engine = Arc::clone(&engine);
            let metrics = metrics.clone();
            let ipc_manager = Arc::clone(&ipc_manager);
            let permit = semaphore.clone().acquire_owned().await.unwrap();

            let handle = std::thread::spawn(move || {
                worker_thread(task_queue, engine, metrics, ipc_manager);
                drop(permit);
            });
            workers.push(handle);
        }

        Self {
            workers,
            task_queue,
            semaphore,
            engine,
            metrics,
            ipc_manager,
        }
    }

    pub fn submit_task(&self, module: WasiModule, args: Vec<String>, env: Vec<(String, String)>) -> Result<String> {
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

    pub fn queue_len(&self) -> usize {
        self.task_queue.len()
    }
}

fn worker_thread(
    task_queue: TaskQueue,
    engine: Arc<wasmtime::Engine>,
    metrics: MetricsCollector,
    ipc_manager: Arc<crate::ipc::IpcManager>,
) {
    loop {
        if let Some(task) = task_queue.dequeue() {
            let start = Instant::now();
            let success = execute_task(&engine, &task, &ipc_manager).is_ok();
            let duration = start.elapsed();
            metrics.record_execution(duration, success);
        } else {
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
    }
}

fn execute_task(
    engine: &wasmtime::Engine,
    task: &Task,
    ipc_manager: &crate::ipc::IpcManager,
) -> Result<()> {
    let mut store = wasmtime::Store::new(engine, ());
    
    let mut wasi_ctx = wasmtime_wasi::WasiCtxBuilder::new()
        .inherit_stdio()
        .args(&task.args)?
        .envs(&task.env)?
        .build();
    
    let mut linker = wasmtime::Linker::new(engine);
    wasmtime_wasi::add_to_linker(&mut linker, |s| s)?;
    
    let instance = linker.instantiate(&mut store, &task.module.module)?;
    
    let start = Instant::now();
    let timeout = std::time::Duration::from_millis(task.module.limits.max_cpu_time_ms);
    
    let result = std::thread::scope(|s| {
        let handle = s.spawn(|| {
            if let Ok(func) = instance.get_func(&mut store, "_start") {
                let _ = func.call(&mut store, &[], &mut []);
            }
        });
        
        loop {
            if handle.is_finished() {
                return handle.join().map_err(|_| {
                    SchedulerError::Other("Task panicked".to_string())
                });
            }
            if start.elapsed() > timeout {
                return Err(SchedulerError::ExecutionTimeout(task.module.name.clone()));
            }
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
    });
    
    result?;
    Ok(())
}
