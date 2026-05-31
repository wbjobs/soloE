mod efi;
mod secure_boot;

use efi::{BootEntry, EfiManager};
use secure_boot::{SecureBootCertificate, SecureBootManager};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Runtime;

#[derive(Debug, Serialize, Deserialize)]
pub struct AppState {
    efi_manager: EfiManager,
    secure_boot_manager: SecureBootManager,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            efi_manager: EfiManager::new(),
            secure_boot_manager: SecureBootManager::new(),
        }
    }
}

#[tauri::command]
pub async fn get_boot_entries<R: Runtime>(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<BootEntry>, String> {
    state.efi_manager.get_boot_entries().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_boot_entry<R: Runtime>(
    state: tauri::State<'_, AppState>,
    entry: BootEntry,
) -> Result<(), String> {
    state.efi_manager.add_boot_entry(&entry).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_boot_entry<R: Runtime>(
    state: tauri::State<'_, AppState>,
    entry_id: String,
) -> Result<(), String> {
    state.efi_manager.delete_boot_entry(&entry_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_boot_order<R: Runtime>(
    state: tauri::State<'_, AppState>,
    order: Vec<String>,
) -> Result<(), String> {
    state.efi_manager.set_boot_order(&order).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn backup_efi_config<R: Runtime>(
    state: tauri::State<'_, AppState>,
    path: PathBuf,
) -> Result<(), String> {
    state.efi_manager.backup_config(&path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn restore_efi_config<R: Runtime>(
    state: tauri::State<'_, AppState>,
    path: PathBuf,
) -> Result<(), String> {
    state.efi_manager.restore_config(&path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn is_secure_boot_enabled<R: Runtime>(
    state: tauri::State<'_, AppState>,
) -> Result<bool, String> {
    state.secure_boot_manager.is_secure_boot_enabled().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_secure_boot_certificates<R: Runtime>(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<SecureBootCertificate>, String> {
    state.secure_boot_manager.get_certificates().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn import_secure_boot_certificate<R: Runtime>(
    state: tauri::State<'_, AppState>,
    cert_path: PathBuf,
    db_type: String,
) -> Result<(), String> {
    state.secure_boot_manager.import_certificate(&cert_path, &db_type).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_secure_boot_certificate<R: Runtime>(
    state: tauri::State<'_, AppState>,
    cert_id: String,
    confirm_microsoft: bool,
) -> Result<(), String> {
    state.secure_boot_manager.delete_certificate(&cert_id, confirm_microsoft).await.map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            get_boot_entries,
            add_boot_entry,
            delete_boot_entry,
            set_boot_order,
            backup_efi_config,
            restore_efi_config,
            is_secure_boot_enabled,
            get_secure_boot_certificates,
            import_secure_boot_certificate,
            delete_secure_boot_certificate,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
