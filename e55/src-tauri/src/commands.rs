use std::path::PathBuf;
use std::sync::Arc;

use tauri::{AppHandle, Manager, State};
use tokio::sync::RwLock;
use tracing::{debug, info};
use uuid::Uuid;

use crate::error::Result;
use crate::file_watcher::FileMetadata;
use crate::models::{AppSettings, DeviceInfo, FileItem, TransferEvent, TransferTask};
use crate::sync_session::{SyncMode, SyncSessionConfig, SyncSessionManager, SyncStats, SyncStatus};
use crate::{DeviceDiscovery, Storage, TransferManager};

pub struct AppState {
    pub discovery: Arc<DeviceDiscovery>,
    pub storage: Arc<Storage>,
    pub transfer_manager: Arc<TransferManager>,
    pub sync_manager: Arc<SyncSessionManager>,
}

#[tauri::command]
pub async fn discover_devices(state: State<'_, AppState>) -> Result<Vec<DeviceInfo>> {
    debug!("Received command: discover_devices");
    let devices = state.discovery.get_devices().await;
    Ok(devices)
}

#[tauri::command]
pub async fn manual_connect(state: State<'_, AppState>, ip: String, port: u16) -> Result<DeviceInfo> {
    debug!("Received command: manual_connect to {}:{}", ip, port);
    let device = state.discovery.manual_connect(ip, port).await?;
    Ok(device)
}

#[tauri::command]
pub async fn try_tcp_hole_punch(state: State<'_, AppState>, target_ip: String, target_port: u16) -> Result<crate::discovery::HolePunchResult> {
    debug!("Received command: try_tcp_hole_punch to {}:{}", target_ip, target_port);
    let result = state.discovery.try_tcp_hole_punch(target_ip, target_port).await?;
    Ok(result)
}

#[tauri::command]
pub async fn get_signaling_devices(state: State<'_, AppState>) -> Result<Vec<DeviceInfo>> {
    debug!("Received command: get_signaling_devices");
    Ok(Vec::new())
}

#[tauri::command]
pub async fn connect_via_signaling(state: State<'_, AppState>, device_id: String) -> Result<DeviceInfo> {
    debug!("Received command: connect_via_signaling to {}", device_id);
    Err(crate::error::AppError::Network("Signaling server connection not implemented yet".to_string()))
}

#[tauri::command]
pub async fn get_local_device_info(state: State<'_, AppState>) -> Result<DeviceInfo> {
    debug!("Received command: get_local_device_info");
    let device_id = state.discovery.get_local_device_id().to_string();
    
    Ok(DeviceInfo {
        id: device_id,
        name: "Local Device".to_string(),
        ip: "127.0.0.1".to_string(),
        port: 58778,
        os: if cfg!(target_os = "windows") {
            crate::models::OSType::Windows
        } else if cfg!(target_os = "macos") {
            crate::models::OSType::macOS
        } else {
            crate::models::OSType::Linux
        },
        status: crate::models::DeviceStatus::Online,
        last_seen: chrono::Utc::now(),
        connection_method: None,
        public_ip: None,
    })
}

#[tauri::command]
pub async fn start_transfer(
    state: State<'_, AppState>,
    target_device_id: String,
    files: Vec<FileItem>,
) -> Result<String> {
    debug!("Received command: start_transfer to {}", target_device_id);
    
    let devices = state.discovery.get_devices().await;
    let target_device = devices.iter().find(|d| d.id == target_device_id);
    
    if let Some(device) = target_device {
        let addr = format!("{}:{}", device.ip, device.port).parse()?;
        let transfer_id = state.transfer_manager.send_files(addr, files).await?;
        Ok(transfer_id)
    } else {
        Err(crate::error::AppError::DeviceNotFound(target_device_id))
    }
}

#[tauri::command]
pub async fn pause_transfer(state: State<'_, AppState>, transfer_id: String) -> Result<()> {
    debug!("Received command: pause_transfer {}", transfer_id);
    state.transfer_manager.pause_transfer(&transfer_id).await?;
    Ok(())
}

#[tauri::command]
pub async fn resume_transfer(state: State<'_, AppState>, transfer_id: String) -> Result<()> {
    debug!("Received command: resume_transfer {}", transfer_id);
    state.transfer_manager.resume_transfer(&transfer_id).await?;
    Ok(())
}

#[tauri::command]
pub async fn cancel_transfer(state: State<'_, AppState>, transfer_id: String) -> Result<()> {
    debug!("Received command: cancel_transfer {}", transfer_id);
    state.transfer_manager.cancel_transfer(&transfer_id).await?;
    Ok(())
}

#[tauri::command]
pub async fn get_transfers(state: State<'_, AppState>) -> Result<Vec<TransferTask>> {
    debug!("Received command: get_transfers");
    let transfers = state.transfer_manager.get_all_transfers().await;
    Ok(transfers)
}

#[tauri::command]
pub async fn save_settings(state: State<'_, AppState>, settings: AppSettings) -> Result<()> {
    debug!("Received command: save_settings");
    state.storage.save_settings(&settings)?;
    Ok(())
}

#[tauri::command]
pub async fn load_settings(state: State<'_, AppState>) -> Result<AppSettings> {
    debug!("Received command: load_settings");
    let settings = state.storage.load_settings()?;
    Ok(settings)
}

#[tauri::command]
pub async fn get_transfer_history(state: State<'_, AppState>) -> Result<Vec<TransferTask>> {
    debug!("Received command: get_transfer_history");
    let history = state.storage.load_transfers()?;
    Ok(history)
}

#[tauri::command]
pub async fn delete_transfer_history(state: State<'_, AppState>, transfer_id: String) -> Result<()> {
    debug!("Received command: delete_transfer_history {}", transfer_id);
    state.storage.delete_transfer(&transfer_id)?;
    Ok(())
}

// Sync Session Commands
#[tauri::command]
pub async fn create_sync_session(
    state: State<'_, AppState>,
    local_path: PathBuf,
    peer_device: DeviceInfo,
    sync_mode: String,
) -> Result<String> {
    debug!("Received command: create_sync_session to {}", peer_device.name);

    let sync_mode_enum = match sync_mode.as_str() {
        "bidirectional" => SyncMode::Bidirectional,
        "send_only" => SyncMode::SendOnly,
        "receive_only" => SyncMode::ReceiveOnly,
        _ => SyncMode::Bidirectional,
    };

    let config = SyncSessionConfig {
        session_id: Uuid::new_v4().to_string(),
        local_path,
        peer_device,
        sync_mode: sync_mode_enum,
        chunk_size: 1024 * 1024, // 1MB
        auto_start: true,
        ignore_patterns: Vec::new(),
    };

    let session_id = state.sync_manager.create_session(config).await?;
    Ok(session_id)
}

#[tauri::command]
pub async fn start_sync_session(state: State<'_, AppState>, session_id: String) -> Result<()> {
    debug!("Received command: start_sync_session {}", session_id);
    state.sync_manager.start_session(&session_id).await?;
    Ok(())
}

#[tauri::command]
pub async fn stop_sync_session(state: State<'_, AppState>, session_id: String) -> Result<()> {
    debug!("Received command: stop_sync_session {}", session_id);
    state.sync_manager.stop_session(&session_id).await?;
    Ok(())
}

#[tauri::command]
pub async fn remove_sync_session(state: State<'_, AppState>, session_id: String) -> Result<()> {
    debug!("Received command: remove_sync_session {}", session_id);
    state.sync_manager.remove_session(&session_id).await?;
    Ok(())
}

#[tauri::command]
pub async fn get_sync_sessions(state: State<'_, AppState>) -> Result<Vec<SyncSessionConfig>> {
    debug!("Received command: get_sync_sessions");
    let sessions = state.sync_manager.get_all_sessions().await;
    Ok(sessions)
}

#[tauri::command]
pub async fn get_sync_session_status(state: State<'_, AppState>, session_id: String) -> Result<Option<String>> {
    debug!("Received command: get_sync_session_status {}", session_id);
    let status = state.sync_manager.get_session_status(&session_id).await;
    Ok(status.map(|s| match s {
        SyncStatus::Idle => "idle".to_string(),
        SyncStatus::Scanning => "scanning".to_string(),
        SyncStatus::Syncing => "syncing".to_string(),
        SyncStatus::Paused => "paused".to_string(),
        SyncStatus::Error => "error".to_string(),
    }))
}

#[tauri::command]
pub async fn sync_session_now(state: State<'_, AppState>, session_id: String) -> Result<()> {
    debug!("Received command: sync_session_now {}", session_id);
    state.sync_manager.sync_now(&session_id).await?;
    Ok(())
}

pub async fn setup_event_forwarding(app_handle: AppHandle, transfer_manager: Arc<TransferManager>) {
    let mut rx = transfer_manager.subscribe_events();
    
    tokio::spawn(async move {
        while let Ok(event) = rx.recv().await {
            let event_name = match &event {
                TransferEvent::Progress { .. } => "transfer://progress",
                TransferEvent::Speed { .. } => "transfer://speed",
                TransferEvent::Completed { .. } => "transfer://completed",
                TransferEvent::Failed { .. } => "transfer://failed",
                TransferEvent::DeviceDiscovered { .. } => "device://discovered",
                TransferEvent::DeviceOffline { .. } => "device://offline",
                TransferEvent::TransferRequest { .. } => "transfer://request",
            };
            
            let _ = app_handle.emit_all(event_name, &event);
        }
    });
}
