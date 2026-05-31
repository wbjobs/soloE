mod file;
mod mdns;
mod transfer;
mod signaling;
mod report;

use file::{OpenFiles, ReceivedFiles};
use mdns::DiscoveryState;
use report::ReportManager;
use std::sync::Mutex;
use tauri::State;
use uuid::Uuid;

#[derive(Clone, serde::Serialize)]
struct DeviceEvent {
    event_type: String,
    device_id: String,
    device_name: String,
    address: String,
}

#[derive(Clone, serde::Serialize)]
struct TransferProgress {
    file_id: String,
    device_id: String,
    chunk_index: u32,
    total_chunks: u32,
    bytes_transferred: u64,
    speed: f64,
}

pub struct SignalingState {
    pub port: Mutex<Option<u16>>,
    pub url: Mutex<Option<String>>,
    pub device_id: Mutex<Option<String>>,
}

impl Default for SignalingState {
    fn default() -> Self {
        Self {
            port: Mutex::new(None),
            url: Mutex::new(None),
            device_id: Mutex::new(None),
        }
    }
}

#[tauri::command]
async fn start_signaling(
    device_name: String,
    port: u16,
    state: State<'_, SignalingState>,
) -> Result<String, String> {
    let device_id = Uuid::new_v4().to_string();
    let url = signaling::start_signaling_server(
        device_id.clone(),
        device_name,
        port,
    ).await?;

    *state.port.lock().unwrap() = Some(port);
    *state.url.lock().unwrap() = Some(url.clone());
    *state.device_id.lock().unwrap() = Some(device_id);

    Ok(url)
}

#[tauri::command]
async fn get_qrcode_payload(
    device_name: String,
    port: u16,
    state: State<'_, SignalingState>,
) -> Result<String, String> {
    let device_id = state
        .device_id
        .lock()
        .unwrap()
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    Ok(signaling::generate_qrcode_payload(
        &device_id,
        &device_name,
        "0.0.0.0",
        port,
    ))
}

#[tauri::command]
async fn get_all_reports(
    report_manager: State<'_, ReportManager>,
) -> Result<Vec<report::TransferReport>, String> {
    Ok(report_manager.get_all_reports())
}

#[tauri::command]
async fn get_report(
    report_id: String,
    report_manager: State<'_, ReportManager>,
) -> Result<Option<report::TransferReport>, String> {
    Ok(report_manager.get_report(&report_id))
}

#[tauri::command]
async fn export_report(
    report_id: String,
    report_manager: State<'_, ReportManager>,
) -> Result<String, String> {
    report_manager.export_report(&report_id)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(OpenFiles::default())
        .manage(ReceivedFiles::default())
        .manage(DiscoveryState::default())
        .manage(SignalingState::default())
        .manage(ReportManager::default())
        .invoke_handler(tauri::generate_handler![
            file::open_file,
            file::get_file_info,
            file::read_chunk,
            file::write_chunk,
            file::verify_file,
            file::create_file,
            mdns::start_discovery,
            mdns::stop_discovery,
            mdns::get_discovered_devices,
            mdns::announce_self,
            mdns::refresh_discovery,
            start_signaling,
            get_qrcode_payload,
            get_all_reports,
            get_report,
            export_report,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
