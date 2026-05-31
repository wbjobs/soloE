use crate::cluster::{ClusterManager, ClusterStats};
use crate::config::{Priority, ResourceLimits, SchedulerConfig};
use crate::dags::{DAGManager, DAGTask, DAGWorkflow, TaskStatus};
use crate::error::SchedulerError;
use crate::ipc::IpcManager;
use crate::metrics::MetricsCollector;
use crate::module::{ModuleManager, WasiModule};
use crate::scheduler::WasiScheduler;
use crate::Result;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json, Response};
use axum::routing::{get, post, delete};
use axum::Router;
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::broadcast;
use uuid::Uuid;

#[derive(Clone)]
pub struct AppState {
    pub scheduler: Arc<WasiScheduler>,
    pub cluster: Arc<ClusterManager>,
    pub dag_manager: Arc<DAGManager>,
    pub ipc_manager: Arc<IpcManager>,
    pub module_manager: Arc<ModuleManager>,
    pub metrics: MetricsCollector,
    pub event_sender: broadcast::Sender<WebEvent>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum WebEvent {
    TaskStarted { task_id: String, worker_id: String },
    TaskCompleted { task_id: String, success: bool },
    WorkerConnected { worker_id: String, name: String },
    WorkerDisconnected { worker_id: String },
    WorkflowCreated { workflow_id: String, name: String },
    WorkflowUpdated { workflow_id: String, status: TaskStatus },
}

#[derive(Debug, Serialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
}

impl<T> ApiResponse<T> {
    pub fn ok(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
        }
    }

    pub fn err(message: String) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(message),
        }
    }
}

impl IntoResponse for SchedulerError {
    fn into_response(self) -> Response {
        let status = match &self {
            SchedulerError::ModuleNotFound(_) => StatusCode::NOT_FOUND,
            SchedulerError::Other(_) => StatusCode::BAD_REQUEST,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        };

        (status, Json(ApiResponse::<()>::err(self.to_string()))).into_response()
    }
}

#[derive(Debug, Deserialize)]
pub struct CreateModuleRequest {
    pub name: String,
    pub path: String,
    pub priority: Option<Priority>,
}

#[derive(Debug, Deserialize)]
pub struct CreateWorkflowRequest {
    pub name: String,
    pub description: String,
}

#[derive(Debug, Deserialize)]
pub struct AddTaskRequest {
    pub name: String,
    pub module_id: String,
    pub depends_on: Vec<String>,
    pub args: Option<Vec<String>>,
}

pub async fn get_modules(state: State<AppState>) -> Result<Json<ApiResponse<Vec<WasiModule>>>, SchedulerError> {
    let modules = state.module_manager.list_modules().into_iter()
        .map(|(id, name, priority)| {
            state.module_manager.get_module(&id).unwrap_or_else(|_| unreachable!())
        })
        .collect();
    Ok(Json(ApiResponse::ok(modules)))
}

pub async fn create_module(
    state: State<AppState>,
    Json(req): Json<CreateModuleRequest>,
) -> Result<Json<ApiResponse<String>>, SchedulerError> {
    let module_id = state.scheduler.load_module(
        req.name,
        &req.path,
        req.priority.unwrap_or(Priority::Normal),
        None,
    )?;
    Ok(Json(ApiResponse::ok(module_id)))
}

pub async fn delete_module(
    state: State<AppState>,
    Path(module_id): Path<String>,
) -> Result<Json<ApiResponse<()>>, SchedulerError> {
    state.scheduler.unload_module(&module_id)?;
    Ok(Json(ApiResponse::ok(())))
}

pub async fn get_workflows(state: State<AppState>) -> Result<Json<ApiResponse<Vec<DAGWorkflow>>>, SchedulerError> {
    let workflows = state.dag_manager.list_workflows();
    Ok(Json(ApiResponse::ok(workflows)))
}

pub async fn get_workflow(
    state: State<AppState>,
    Path(workflow_id): Path<String>,
) -> Result<Json<ApiResponse<DAGWorkflow>>, SchedulerError> {
    let workflow = state.dag_manager.get_workflow(&workflow_id)?;
    Ok(Json(ApiResponse::ok(workflow)))
}

pub async fn create_workflow(
    state: State<AppState>,
    Json(req): Json<CreateWorkflowRequest>,
) -> Result<Json<ApiResponse<String>>, SchedulerError> {
    let workflow_id = state.dag_manager.create_workflow(req.name, req.description);
    Ok(Json(ApiResponse::ok(workflow_id)))
}

pub async fn start_workflow(
    state: State<AppState>,
    Path(workflow_id): Path<String>,
) -> Result<Json<ApiResponse<()>>, SchedulerError> {
    state.dag_manager.start_workflow(&workflow_id)?;
    if state.cluster.is_coordinator {
        state.cluster.schedule_ready_tasks(&workflow_id).await?;
    }
    Ok(Json(ApiResponse::ok(())))
}

pub async fn cancel_workflow(
    state: State<AppState>,
    Path(workflow_id): Path<String>,
) -> Result<Json<ApiResponse<()>>, SchedulerError> {
    state.dag_manager.cancel_workflow(&workflow_id)?;
    Ok(Json(ApiResponse::ok(())))
}

pub async fn add_task_to_workflow(
    state: State<AppState>,
    Path(workflow_id): Path<String>,
    Json(req): Json<AddTaskRequest>,
) -> Result<Json<ApiResponse<String>>, SchedulerError> {
    let mut task = DAGTask::new(req.name, req.module_id, req.depends_on);
    if let Some(args) = req.args {
        task = task.with_args(args);
    }
    let task_id = state.dag_manager.add_task_to_workflow(&workflow_id, task)?;
    Ok(Json(ApiResponse::ok(task_id)))
}

pub async fn get_cluster_stats(state: State<AppState>) -> Result<Json<ApiResponse<ClusterStats>>, SchedulerError> {
    let stats = state.cluster.cluster_stats();
    Ok(Json(ApiResponse::ok(stats)))
}

pub async fn get_workers(state: State<AppState>) -> Result<Json<ApiResponse<Vec<crate::cluster::WorkerNode>>>, SchedulerError> {
    let workers = state.cluster.list_workers();
    Ok(Json(ApiResponse::ok(workers)))
}

pub async fn get_execution_metrics(state: State<AppState>) -> Result<Json<ApiResponse<crate::metrics::ExecutionMetrics>>, SchedulerError> {
    let metrics = state.scheduler.get_execution_metrics();
    Ok(Json(ApiResponse::ok(metrics)))
}

pub async fn get_queue_metrics(state: State<AppState>) -> Result<Json<ApiResponse<crate::metrics::QueueMetrics>>, SchedulerError> {
    let metrics = state.scheduler.get_queue_metrics();
    Ok(Json(ApiResponse::ok(metrics)))
}

pub async fn health_check() -> Json<ApiResponse<String>> {
    Json(ApiResponse::ok("healthy".to_string()))
}

pub async fn start_web_server(
    bind_addr: SocketAddr,
    scheduler: Arc<WasiScheduler>,
    cluster: Arc<ClusterManager>,
    dag_manager: Arc<DAGManager>,
    ipc_manager: Arc<IpcManager>,
    module_manager: Arc<ModuleManager>,
    metrics: MetricsCollector,
) -> Result<()> {
    let (event_sender, _) = broadcast::channel(100);

    let state = AppState {
        scheduler,
        cluster,
        dag_manager,
        ipc_manager,
        module_manager,
        metrics,
        event_sender,
    };

    let router = Router::new()
        .route("/api/health", get(health_check))
        .route("/api/modules", get(get_modules).post(create_module))
        .route("/api/modules/:id", delete(delete_module))
        .route("/api/workflows", get(get_workflows).post(create_workflow))
        .route("/api/workflows/:id", get(get_workflow))
        .route("/api/workflows/:id/start", post(start_workflow))
        .route("/api/workflows/:id/cancel", post(cancel_workflow))
        .route("/api/workflows/:id/tasks", post(add_task_to_workflow))
        .route("/api/cluster/stats", get(get_cluster_stats))
        .route("/api/cluster/workers", get(get_workers))
        .route("/api/metrics/execution", get(get_execution_metrics))
        .route("/api/metrics/queue", get(get_queue_metrics))
        .fallback_service(axum::routing::get_service(serve_static_files))
        .with_state(state);

    tracing::info!("Web server listening on http://{}", bind_addr);

    axum::Server::bind(&bind_addr)
        .serve(router.into_make_service())
        .await
        .map_err(|e| SchedulerError::Other(format!("Web server error: {}", e)))?;

    Ok(())
}

async fn serve_static_files(
    request: axum::http::Request<axum::body::Body>,
) -> Result<Response, StatusCode> {
    let path = request.uri().path();
    let path = if path == "/" {
        "/index.html"
    } else {
        path
    };

    let content = get_static_file(path).ok_or(StatusCode::NOT_FOUND)?;
    let mime = mime_guess::from_path(path).first_or_octet_stream();

    Ok(Response::builder()
        .header("content-type", mime.as_ref())
        .body(axum::body::Body::from(content))
        .unwrap())
}

fn get_static_file(path: &str) -> Option<Vec<u8>> {
    match path {
        "/index.html" => Some(include_bytes!("../static/index.html").to_vec()),
        "/styles.css" => Some(include_bytes!("../static/styles.css").to_vec()),
        "/app.js" => Some(include_bytes!("../static/app.js").to_vec()),
        _ => None,
    }
}
