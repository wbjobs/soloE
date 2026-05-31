use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;
use chrono::{DateTime, Utc};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceInfo {
    pub device_id: String,
    pub device_name: String,
    pub address: String,
    pub port: u16,
    pub last_seen: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignalingMessage {
    pub from: String,
    pub to: String,
    pub msg_type: String,
    pub payload: serde_json::Value,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QrCodePayload {
    pub device_id: String,
    pub device_name: String,
    pub address: String,
    pub port: u16,
    pub session_id: String,
    pub timestamp: i64,
}

pub struct AppState {
    devices: Mutex<HashMap<String, DeviceInfo>>,
    messages: Mutex<HashMap<String, Vec<SignalingMessage>>>,
    my_device_id: String,
    my_device_name: String,
}

impl AppState {
    pub fn new(device_id: String, device_name: String) -> Self {
        Self {
            devices: Mutex::new(HashMap::new()),
            messages: Mutex::new(HashMap::new()),
            my_device_id: device_id,
            my_device_name: device_name,
        }
    }
}

pub fn create_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/health", get(health_check))
        .route("/devices", get(get_devices))
        .route("/devices/:device_id", get(get_device))
        .route("/register", post(register_device))
        .route("/signal/:device_id", post(send_signal))
        .route("/signal/:device_id/poll", get(poll_signals))
        .route("/qrcode", get(get_qrcode_info))
        .with_state(state)
}

async fn health_check() -> impl IntoResponse {
    Json(serde_json::json!({ "status": "ok" }))
}

async fn get_devices(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let devices = state.devices.lock().await;
    Json(devices.values().cloned().collect::<Vec<_>>())
}

async fn get_device(
    State(state): State<Arc<AppState>>,
    Path(device_id): Path<String>,
) -> impl IntoResponse {
    let devices = state.devices.lock().await;
    if let Some(device) = devices.get(&device_id) {
        Json(serde_json::json!(device)).into_response()
    } else {
        (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Device not found" }))).into_response()
    }
}

async fn register_device(
    State(state): State<Arc<AppState>>,
    Json(device): Json<DeviceInfo>,
) -> impl IntoResponse {
    let mut devices = state.devices.lock().await;
    devices.insert(device.device_id.clone(), device);
    Json(serde_json::json!({ "status": "ok" }))
}

async fn send_signal(
    State(state): State<Arc<AppState>>,
    Path(target_id): Path<String>,
    Json(message): Json<SignalingMessage>,
) -> impl IntoResponse {
    let mut messages = state.messages.lock().await;
    let queue = messages.entry(target_id).or_insert_with(Vec::new);
    queue.push(message);
    Json(serde_json::json!({ "status": "ok" }))
}

async fn poll_signals(
    State(state): State<Arc<AppState>>,
    Path(device_id): Path<String>,
) -> impl IntoResponse {
    let mut messages = state.messages.lock().await;
    let queue = messages.entry(device_id).or_insert_with(Vec::new);
    let result: Vec<SignalingMessage> = queue.drain(..).collect();
    Json(result)
}

async fn get_qrcode_info(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let payload = QrCodePayload {
        device_id: state.my_device_id.clone(),
        device_name: state.my_device_name.clone(),
        address: "0.0.0.0".to_string(),
        port: 8888,
        session_id: Uuid::new_v4().to_string(),
        timestamp: Utc::now().timestamp(),
    };
    Json(payload)
}

pub async fn start_signaling_server(
    device_id: String,
    device_name: String,
    port: u16,
) -> Result<String, String> {
    let state = Arc::new(AppState::new(device_id, device_name));
    let router = create_router(state);

    let addr = format!("0.0.0.0:{}", port);
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .map_err(|e| format!("Failed to bind: {}", e))?;

    tokio::spawn(async move {
        println!("Signaling server running on {}", addr);
        axum::serve(listener, router).await.ok();
    });

    Ok(format!("http://0.0.0.0:{}", port))
}

pub fn generate_qrcode_payload(
    device_id: &str,
    device_name: &str,
    address: &str,
    port: u16,
) -> String {
    let payload = QrCodePayload {
        device_id: device_id.to_string(),
        device_name: device_name.to_string(),
        address: address.to_string(),
        port,
        session_id: Uuid::new_v4().to_string(),
        timestamp: Utc::now().timestamp(),
    };
    serde_json::to_string(&payload).unwrap_or_default()
}
