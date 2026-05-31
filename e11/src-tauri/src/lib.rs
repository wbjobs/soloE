mod crypto;

use crypto::{encrypt_file, decrypt_file, CryptoError};
use std::fs;
use std::path::Path;

#[derive(serde::Serialize)]
pub struct FileInfo {
    name: String,
    path: String,
    size: u64,
    modified: String,
    is_encrypted: bool,
}

#[derive(serde::Serialize)]
pub struct CommandResult {
    success: bool,
    message: String,
}

impl From<Result<(), CryptoError>> for CommandResult {
    fn from(result: Result<(), CryptoError>) -> Self {
        match result {
            Ok(_) => CommandResult {
                success: true,
                message: "Operation successful".to_string(),
            },
            Err(e) => CommandResult {
                success: false,
                message: e.to_string(),
            },
        }
    }
}

#[tauri::command]
async fn scan_folder(folder_path: String) -> Result<Vec<FileInfo>, String> {
    let path = Path::new(&folder_path);
    let mut files = Vec::new();

    if !path.is_dir() {
        return Err("Not a directory".to_string());
    }

    let entries = fs::read_dir(path).map_err(|e| e.to_string())?;

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_path = entry.path();

        if file_path.is_file() {
            let metadata = fs::metadata(&file_path).map_err(|e| e.to_string())?;
            let name = entry.file_name().to_string_lossy().to_string();
            let modified = metadata
                .modified()
                .map(|t| format!("{:?}", t))
                .unwrap_or_else(|_| "Unknown".to_string());

            files.push(FileInfo {
                name: name.clone(),
                path: file_path.to_string_lossy().to_string(),
                size: metadata.len(),
                modified,
                is_encrypted: name.ends_with(".enc"),
            });
        }
    }

    Ok(files)
}

#[tauri::command]
async fn encrypt(file_path: String, password: String) -> CommandResult {
    encrypt_file(&file_path, &password).into()
}

#[tauri::command]
async fn decrypt(file_path: String, password: String) -> CommandResult {
    decrypt_file(&file_path, &password).into()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![scan_folder, encrypt, decrypt])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
