#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod discovery;
mod error;
mod file_watcher;
mod models;
mod storage;
mod sync_session;
mod transfer;

use std::path::PathBuf;
use std::sync::Arc;

use tauri::Manager;
use tracing::{info, Level};
use tracing_subscriber::FmtSubscriber;

use commands::{setup_event_forwarding, AppState};
use discovery::DeviceDiscovery;
use storage::Storage;
use sync_session::SyncSessionManager;
use transfer::TransferManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let subscriber = FmtSubscriber::builder()
        .with_max_level(Level::DEBUG)
        .finish();
    tracing::subscriber::set_global_default(subscriber).expect("setting default subscriber failed");

    info!("Starting LAN Share application...");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            
            tauri::async_runtime::spawn(async move {
                let storage = Arc::new(Storage::new().expect("Failed to initialize storage"));
                let settings = storage.load_settings().unwrap_or_default();
                
                let discovery = Arc::new(
                    DeviceDiscovery::new(settings.discovery_port, settings.transfer_port, settings.device_name.clone())
                        .expect("Failed to initialize device discovery"),
                );
                
                let save_path = if settings.save_path.is_empty() {
                    dirs::download_dir().unwrap_or_else(|| PathBuf::from("."))
                } else {
                    PathBuf::from(&settings.save_path)
                };
                
                let transfer_manager = Arc::new(
                    TransferManager::new(save_path).expect("Failed to initialize transfer manager"),
                );
                
                discovery.start().await.expect("Failed to start discovery");
                transfer_manager
                    .start_listener(settings.transfer_port)
                    .await
                    .expect("Failed to start transfer listener");
                
                setup_event_forwarding(app_handle.clone(), transfer_manager.clone()).await;
                
                let sync_manager = Arc::new(SyncSessionManager::new());
                
                let state = AppState {
                    discovery,
                    storage,
                    transfer_manager,
                    sync_manager,
                };
                
                app_handle.manage(state);
                info!("Application state initialized successfully");
            });
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::discover_devices,
            commands::manual_connect,
            commands::try_tcp_hole_punch,
            commands::get_signaling_devices,
            commands::connect_via_signaling,
            commands::get_local_device_info,
            commands::start_transfer,
            commands::pause_transfer,
            commands::resume_transfer,
            commands::cancel_transfer,
            commands::get_transfers,
            commands::save_settings,
            commands::load_settings,
            commands::get_transfer_history,
            commands::delete_transfer_history,
            commands::create_sync_session,
            commands::start_sync_session,
            commands::stop_sync_session,
            commands::remove_sync_session,
            commands::get_sync_sessions,
            commands::get_sync_session_status,
            commands::sync_session_now,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
