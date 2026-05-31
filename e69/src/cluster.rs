use crate::config::{Priority, ResourceLimits};
use crate::dags::{DAGManager, DAGTask, TaskStatus};
use crate::error::{Result, SchedulerError};
use crate::scheduler::WasiScheduler;
use chrono::{DateTime, Utc};
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerNode {
    pub id: String,
    pub name: String,
    pub address: String,
    pub status: NodeStatus,
    pub cpu_cores: usize,
    pub total_memory_mb: usize,
    pub available_memory_mb: usize,
    pub running_tasks: usize,
    pub max_tasks: usize,
    pub last_heartbeat: DateTime<Utc>,
    pub registered_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NodeStatus {
    Online,
    Offline,
    Busy,
    Draining,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskAssignment {
    pub task_id: String,
    pub workflow_id: String,
    pub worker_id: String,
    pub module_id: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub priority: Priority,
    pub assigned_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskResult {
    pub task_id: String,
    pub workflow_id: String,
    pub worker_id: String,
    pub success: bool,
    pub error_message: Option<String>,
    pub execution_time_ms: u64,
    pub completed_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeartbeatMessage {
    pub worker_id: String,
    pub available_memory_mb: usize,
    pub running_tasks: usize,
    pub cpu_usage_percent: f32,
}

pub struct ClusterManager {
    pub node_id: String,
    pub node_name: String,
    pub is_coordinator: bool,
    pub workers: Arc<DashMap<String, WorkerNode>>,
    pub scheduler: Arc<WasiScheduler>,
    pub dag_manager: Arc<DAGManager>,
    pub task_assignments: Arc<DashMap<String, TaskAssignment>>,
    pub task_results: Arc<DashMap<String, TaskResult>>,
    coordinator_address: Arc<RwLock<Option<String>>>,
}

impl ClusterManager {
    pub fn new(
        node_name: String,
        is_coordinator: bool,
        scheduler: Arc<WasiScheduler>,
        dag_manager: Arc<DAGManager>,
    ) -> Self {
        let node_id = Uuid::new_v4().to_string();

        Self {
            node_id,
            node_name,
            is_coordinator,
            workers: Arc::new(DashMap::new()),
            scheduler,
            dag_manager,
            task_assignments: Arc::new(DashMap::new()),
            task_results: Arc::new(DashMap::new()),
            coordinator_address: Arc::new(RwLock::new(None)),
        }
    }

    pub async fn register_worker(&self, worker: WorkerNode) -> Result<()> {
        if !self.is_coordinator {
            return Err(SchedulerError::Other(
                "Only coordinator can register workers".to_string(),
            ));
        }

        tracing::info!("Registering worker: {} ({})", worker.name, worker.id);
        self.workers.insert(worker.id.clone(), worker);
        Ok(())
    }

    pub async fn unregister_worker(&self, worker_id: &str) -> Result<()> {
        if !self.is_coordinator {
            return Err(SchedulerError::Other(
                "Only coordinator can unregister workers".to_string(),
            ));
        }

        tracing::info!("Unregistering worker: {}", worker_id);
        self.workers.remove(worker_id);
        Ok(())
    }

    pub async fn process_heartbeat(&self, heartbeat: HeartbeatMessage) -> Result<()> {
        if !self.is_coordinator {
            return Ok(());
        }

        if let Some(mut worker) = self.workers.get_mut(&heartbeat.worker_id) {
            worker.available_memory_mb = heartbeat.available_memory_mb;
            worker.running_tasks = heartbeat.running_tasks;
            worker.last_heartbeat = Utc::now();
            worker.status = if heartbeat.running_tasks >= worker.max_tasks {
                NodeStatus::Busy
            } else {
                NodeStatus::Online
            };
        }

        Ok(())
    }

    pub async fn find_best_worker(&self, required_memory_mb: usize) -> Result<Option<WorkerNode>> {
        if !self.is_coordinator {
            return Err(SchedulerError::Other(
                "Only coordinator can assign tasks".to_string(),
            ));
        }

        let mut best_worker: Option<WorkerNode> = None;
        let mut best_score = 0;

        for worker in self.workers.iter() {
            if worker.status != NodeStatus::Online {
                continue;
            }
            if worker.available_memory_mb < required_memory_mb {
                continue;
            }
            if worker.running_tasks >= worker.max_tasks {
                continue;
            }

            let score = (worker.available_memory_mb as isize)
                - (worker.running_tasks as isize * 100);

            if best_worker.is_none() || score > best_score {
                best_score = score;
                best_worker = Some(worker.clone());
            }
        }

        Ok(best_worker)
    }

    pub async fn assign_task(&self, workflow_id: &str, task: &DAGTask) -> Result<TaskAssignment> {
        if !self.is_coordinator {
            return Err(SchedulerError::Other(
                "Only coordinator can assign tasks".to_string(),
            ));
        }

        let worker = self
            .find_best_worker(64)
            .await?
            .ok_or_else(|| SchedulerError::Other("No available workers".to_string()))?;

        let assignment = TaskAssignment {
            task_id: task.id.clone(),
            workflow_id: workflow_id.to_string(),
            worker_id: worker.id.clone(),
            module_id: task.module_id.clone(),
            args: task.args.clone(),
            env: task.env.clone(),
            priority: Priority::Normal,
            assigned_at: Utc::now(),
        };

        self.task_assignments
            .insert(task.id.clone(), assignment.clone());

        self.dag_manager
            .update_task_status(workflow_id, &task.id, TaskStatus::Running)?;

        tracing::info!(
            "Assigned task {} to worker {}",
            task.id,
            worker.name
        );

        Ok(assignment)
    }

    pub async fn submit_task_result(&self, result: TaskResult) -> Result<()> {
        self.task_results.insert(result.task_id.clone(), result.clone());

        self.dag_manager.update_task_status(
            &result.workflow_id,
            &result.task_id,
            if result.success {
                TaskStatus::Completed
            } else {
                TaskStatus::Failed
            },
        )?;

        Ok(())
    }

    pub async fn schedule_ready_tasks(&self, workflow_id: &str) -> Result<()> {
        if !self.is_coordinator {
            return Err(SchedulerError::Other(
                "Only coordinator can schedule tasks".to_string(),
            ));
        }

        let ready_tasks = self.dag_manager.get_ready_tasks(workflow_id)?;
        for task in ready_tasks {
            match self.assign_task(workflow_id, &task).await {
                Ok(assignment) => {
                    tracing::info!("Task {} assigned to worker {}", task.id, assignment.worker_id);
                }
                Err(e) => {
                    tracing::warn!("Failed to assign task {}: {}", task.id, e);
                }
            }
        }

        Ok(())
    }

    pub async fn start_coordinator(&self, bind_addr: SocketAddr) -> Result<()> {
        if !self.is_coordinator {
            return Err(SchedulerError::Other(
                "This node is not a coordinator".to_string(),
            ));
        }

        tracing::info!("Starting coordinator on {}", bind_addr);

        let workers = Arc::clone(&self.workers);
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(30));
            loop {
                interval.tick().await;
                let now = Utc::now();
                let mut offline_workers = Vec::new();
                for worker in workers.iter() {
                    let elapsed = (now - worker.last_heartbeat).num_seconds();
                    if elapsed > 60 {
                        tracing::warn!("Worker {} timed out", worker.name);
                        offline_workers.push(worker.id.clone());
                    }
                }
                for worker_id in offline_workers {
                    workers.remove(&worker_id);
                }
            }
        });

        Ok(())
    }

    pub async fn connect_to_coordinator(&self, coordinator_addr: String) -> Result<()> {
        if self.is_coordinator {
            return Err(SchedulerError::Other(
                "Coordinator cannot connect to another coordinator".to_string(),
            ));
        }

        tracing::info!("Connecting to coordinator: {}", coordinator_addr);
        *self.coordinator_address.write().await = Some(coordinator_addr);

        Ok(())
    }

    pub fn list_workers(&self) -> Vec<WorkerNode> {
        self.workers.iter().map(|w| w.clone()).collect()
    }

    pub fn get_worker(&self, worker_id: &str) -> Option<WorkerNode> {
        self.workers.get(worker_id).map(|w| w.clone())
    }

    pub fn get_task_assignment(&self, task_id: &str) -> Option<TaskAssignment> {
        self.task_assignments.get(task_id).map(|a| a.clone())
    }

    pub fn get_task_result(&self, task_id: &str) -> Option<TaskResult> {
        self.task_results.get(task_id).map(|r| r.clone())
    }

    pub fn cluster_stats(&self) -> ClusterStats {
        let workers = self.list_workers();
        ClusterStats {
            total_workers: workers.len(),
            online_workers: workers.iter().filter(|w| w.status == NodeStatus::Online).count(),
            busy_workers: workers.iter().filter(|w| w.status == NodeStatus::Busy).count(),
            total_running_tasks: workers.iter().map(|w| w.running_tasks).sum(),
            total_memory_mb: workers.iter().map(|w| w.total_memory_mb).sum(),
            available_memory_mb: workers.iter().map(|w| w.available_memory_mb).sum(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClusterStats {
    pub total_workers: usize,
    pub online_workers: usize,
    pub busy_workers: usize,
    pub total_running_tasks: usize,
    pub total_memory_mb: usize,
    pub available_memory_mb: usize,
}
