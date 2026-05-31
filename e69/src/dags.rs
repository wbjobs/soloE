use crate::error::{Result, SchedulerError};
use crate::scheduler::Task;
use chrono::{DateTime, Utc};
use dashmap::DashMap;
use petgraph::graph::{DiGraph, NodeIndex};
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum TaskStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DAGTask {
    pub id: String,
    pub name: String,
    pub module_id: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub status: TaskStatus,
    pub depends_on: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub error: Option<String>,
    pub assigned_worker: Option<String>,
}

impl DAGTask {
    pub fn new(name: String, module_id: String, depends_on: Vec<String>) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            module_id,
            args: Vec::new(),
            env: Vec::new(),
            status: TaskStatus::Pending,
            depends_on,
            created_at: Utc::now(),
            started_at: None,
            completed_at: None,
            error: None,
            assigned_worker: None,
        }
    }

    pub fn with_args(mut self, args: Vec<String>) -> Self {
        self.args = args;
        self
    }

    pub fn with_env(mut self, env: Vec<(String, String)>) -> Self {
        self.env = env;
        self
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DAGWorkflow {
    pub id: String,
    pub name: String,
    pub description: String,
    pub tasks: Vec<DAGTask>,
    pub status: TaskStatus,
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
}

impl DAGWorkflow {
    pub fn new(name: String, description: String) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            description,
            tasks: Vec::new(),
            status: TaskStatus::Pending,
            created_at: Utc::now(),
            started_at: None,
            completed_at: None,
        }
    }

    pub fn add_task(&mut self, task: DAGTask) -> Result<String> {
        let task_id = task.id.clone();
        self.tasks.push(task);
        Ok(task_id)
    }

    pub fn validate(&self) -> Result<()> {
        let mut graph = DiGraph::<String, ()>::new();
        let mut node_indices = std::collections::HashMap::new();

        for task in &self.tasks {
            let idx = graph.add_node(task.id.clone());
            node_indices.insert(task.id.clone(), idx);
        }

        for task in &self.tasks {
            let task_idx = node_indices.get(&task.id).unwrap();
            for dep in &task.depends_on {
                if let Some(dep_idx) = node_indices.get(dep) {
                    graph.add_edge(*dep_idx, *task_idx, ());
                } else {
                    return Err(SchedulerError::Other(format!(
                        "Task {} depends on non-existent task {}",
                        task.id, dep
                    )));
                }
            }
        }

        if petgraph::algo::is_cyclic_directed(&graph) {
            return Err(SchedulerError::Other(
                "DAG contains cyclic dependencies".to_string(),
            ));
        }

        Ok(())
    }

    pub fn get_ready_tasks(&self) -> Vec<&DAGTask> {
        self.tasks
            .iter()
            .filter(|task| {
                task.status == TaskStatus::Pending
                    && task.depends_on.iter().all(|dep_id| {
                        self.tasks
                            .iter()
                            .find(|t| t.id == *dep_id)
                            .map(|t| t.status == TaskStatus::Completed)
                            .unwrap_or(false)
                    })
            })
            .collect()
    }

    pub fn get_task(&self, task_id: &str) -> Option<&DAGTask> {
        self.tasks.iter().find(|t| t.id == task_id)
    }

    pub fn get_task_mut(&mut self, task_id: &str) -> Option<&mut DAGTask> {
        self.tasks.iter_mut().find(|t| t.id == task_id)
    }

    pub fn update_task_status(&mut self, task_id: &str, status: TaskStatus) -> Result<()> {
        let task = self
            .get_task_mut(task_id)
            .ok_or_else(|| SchedulerError::Other(format!("Task {} not found", task_id)))?;

        task.status = status;

        match status {
            TaskStatus::Running => task.started_at = Some(Utc::now()),
            TaskStatus::Completed | TaskStatus::Failed | TaskStatus::Cancelled => {
                task.completed_at = Some(Utc::now());
            }
            _ => {}
        }

        let all_completed = self
            .tasks
            .iter()
            .all(|t| t.status == TaskStatus::Completed);
        let any_failed = self
            .tasks
            .iter()
            .any(|t| t.status == TaskStatus::Failed);

        if all_completed {
            self.status = TaskStatus::Completed;
            self.completed_at = Some(Utc::now());
        } else if any_failed {
            self.status = TaskStatus::Failed;
            self.completed_at = Some(Utc::now());
        } else if self
            .tasks
            .iter()
            .any(|t| t.status == TaskStatus::Running)
        {
            self.status = TaskStatus::Running;
            if self.started_at.is_none() {
                self.started_at = Some(Utc::now());
            }
        }

        Ok(())
    }

    pub fn progress(&self) -> f64 {
        if self.tasks.is_empty() {
            return 100.0;
        }
        let completed = self
            .tasks
            .iter()
            .filter(|t| t.status == TaskStatus::Completed)
            .count();
        (completed as f64 / self.tasks.len() as f64) * 100.0
    }
}

pub struct DAGManager {
    workflows: Arc<DashMap<String, DAGWorkflow>>,
    running_workflows: Arc<DashMap<String, bool>>,
}

impl DAGManager {
    pub fn new() -> Self {
        Self {
            workflows: Arc::new(DashMap::new()),
            running_workflows: Arc::new(DashMap::new()),
        }
    }

    pub fn create_workflow(&self, name: String, description: String) -> String {
        let workflow = DAGWorkflow::new(name, description);
        let id = workflow.id.clone();
        self.workflows.insert(id.clone(), workflow);
        id
    }

    pub fn add_task_to_workflow(
        &self,
        workflow_id: &str,
        task: DAGTask,
    ) -> Result<String> {
        let mut workflow = self
            .workflows
            .get_mut(workflow_id)
            .ok_or_else(|| SchedulerError::Other(format!("Workflow {} not found", workflow_id)))?;

        workflow.add_task(task)
    }

    pub fn get_workflow(&self, workflow_id: &str) -> Result<DAGWorkflow> {
        self.workflows
            .get(workflow_id)
            .map(|w| w.clone())
            .ok_or_else(|| SchedulerError::Other(format!("Workflow {} not found", workflow_id)))
    }

    pub fn list_workflows(&self) -> Vec<DAGWorkflow> {
        self.workflows.iter().map(|w| w.clone()).collect()
    }

    pub fn validate_workflow(&self, workflow_id: &str) -> Result<()> {
        let workflow = self.get_workflow(workflow_id)?;
        workflow.validate()
    }

    pub fn start_workflow(&self, workflow_id: &str) -> Result<()> {
        self.validate_workflow(workflow_id)?;
        self.running_workflows.insert(workflow_id.to_string(), true);
        
        let mut workflow = self
            .workflows
            .get_mut(workflow_id)
            .ok_or_else(|| SchedulerError::Other(format!("Workflow {} not found", workflow_id)))?;
        
        workflow.status = TaskStatus::Running;
        workflow.started_at = Some(Utc::now());
        
        Ok(())
    }

    pub fn get_ready_tasks(&self, workflow_id: &str) -> Result<Vec<DAGTask>> {
        let workflow = self.get_workflow(workflow_id)?;
        Ok(workflow.get_ready_tasks().into_iter().cloned().collect())
    }

    pub fn update_task_status(&self, workflow_id: &str, task_id: &str, status: TaskStatus) -> Result<()> {
        let mut workflow = self
            .workflows
            .get_mut(workflow_id)
            .ok_or_else(|| SchedulerError::Other(format!("Workflow {} not found", workflow_id)))?;
        
        workflow.update_task_status(task_id, status)
    }

    pub fn cancel_workflow(&self, workflow_id: &str) -> Result<()> {
        let mut workflow = self
            .workflows
            .get_mut(workflow_id)
            .ok_or_else(|| SchedulerError::Other(format!("Workflow {} not found", workflow_id)))?;
        
        for task in &mut workflow.tasks {
            if task.status == TaskStatus::Pending || task.status == TaskStatus::Running {
                task.status = TaskStatus::Cancelled;
            }
        }
        
        workflow.status = TaskStatus::Cancelled;
        workflow.completed_at = Some(Utc::now());
        self.running_workflows.remove(workflow_id);
        
        Ok(())
    }

    pub fn delete_workflow(&self, workflow_id: &str) -> Result<()> {
        self.cancel_workflow(workflow_id)?;
        self.workflows.remove(workflow_id);
        Ok(())
    }
}

impl Default for DAGManager {
    fn default() -> Self {
        Self::new()
    }
}
