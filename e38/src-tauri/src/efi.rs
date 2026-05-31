use serde::{Deserialize, Serialize};
use std::process::Stdio;
use std::path::Path;
use std::time::Duration;
use tokio::fs;
use tokio::process::Command;
use tokio::time::sleep;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BootEntry {
    pub id: String,
    pub name: String,
    pub partition: String,
    pub disk: String,
    pub active: bool,
    pub order: usize,
}

#[derive(Debug, thiserror::Error)]
pub enum EfiError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Command error: {0}")]
    Command(String),
    #[error("Unsupported OS")]
    UnsupportedOs,
    #[error("Parse error: {0}")]
    Parse(String),
    #[error("NVRAM sync failed after multiple attempts")]
    NvramSyncFailed,
}

pub struct EfiManager;

impl EfiManager {
    pub fn new() -> Self {
        EfiManager
    }

    pub async fn get_boot_entries(&self) -> Result<Vec<BootEntry>, EfiError> {
        let os = std::env::consts::OS;
        match os {
            "linux" => self.get_boot_entries_linux().await,
            "windows" => self.get_boot_entries_windows().await,
            "macos" => self.get_boot_entries_macos().await,
            _ => Err(EfiError::UnsupportedOs),
        }
    }

    async fn get_boot_entries_linux(&self) -> Result<Vec<BootEntry>, EfiError> {
        let output = Command::new("efibootmgr")
            .arg("-v")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            return Err(EfiError::Command(stderr));
        }

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        self.parse_efibootmgr_output(&stdout)
    }

    fn parse_efibootmgr_output(&self, output: &str) -> Result<Vec<BootEntry>, EfiError> {
        let mut entries = Vec::new();
        let boot_order_regex = regex::Regex::new(r"BootOrder: ([0-9A-Fa-f,]+)").unwrap();
        let boot_entry_regex = regex::Regex::new(r"Boot([0-9A-Fa-f]{4})\*?\s+([^\t]+)\t+([^\n]+)").unwrap();

        let mut boot_order: Vec<String> = Vec::new();
        if let Some(cap) = boot_order_regex.captures(output) {
            boot_order = cap[1]
                .split(',')
                .map(|s| s.to_string())
                .collect();
        }

        for cap in boot_entry_regex.captures_iter(output) {
            let id = cap[1].to_string();
            let name = cap[2].trim().to_string();
            let path_info = &cap[3];

            let (partition, disk) = self.parse_linux_path(path_info);
            let order = boot_order.iter().position(|x| x == &id).unwrap_or(usize::MAX);
            let active = path_info.contains("*");

            entries.push(BootEntry {
                id,
                name,
                partition,
                disk,
                active,
                order,
            });
        }

        entries.sort_by_key(|e| e.order);
        Ok(entries)
    }

    fn parse_linux_path(&self, path: &str) -> (String, String) {
        let partition = if path.contains("HD(") {
            let parts: Vec<&str> = path.split("HD(").collect();
            if parts.len() > 1 {
                let hd_part = parts[1].split(')').next().unwrap_or("");
                format!("HD({})", hd_part)
            } else {
                "Unknown".to_string()
            }
        } else {
            "Unknown".to_string()
        };

        let disk = if path.contains("/dev/") {
            let parts: Vec<&str> = path.split("/dev/").collect();
            if parts.len() > 1 {
                let disk_part = parts[1].split_whitespace().next().unwrap_or("");
                format!("/dev/{}", disk_part)
            } else {
                "Unknown".to_string()
            }
        } else {
            "Unknown".to_string()
        };

        (partition, disk)
    }

    async fn get_boot_entries_windows(&self) -> Result<Vec<BootEntry>, EfiError> {
        let output = Command::new("bcdedit")
            .arg("/enum")
            .arg("{fwbootmgr}")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            return Err(EfiError::Command(stderr));
        }

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        self.parse_bcdedit_output(&stdout)
    }

    fn parse_bcdedit_output(&self, output: &str) -> Result<Vec<BootEntry>, EfiError> {
        let mut entries = Vec::new();
        let lines: Vec<&str> = output.lines().collect();

        let mut current_id: Option<String> = None;
        let mut current_name: Option<String> = None;
        let mut current_device: Option<String> = None;
        let mut order = 0;

        for line in lines {
            let line = line.trim();
            if line.starts_with("identifier") {
                if let Some(id) = current_id.take() {
                    entries.push(BootEntry {
                        id: id.clone(),
                        name: current_name.take().unwrap_or_else(|| "Unknown".to_string()),
                        partition: current_device.take().unwrap_or_else(|| "Unknown".to_string()),
                        disk: "Unknown".to_string(),
                        active: true,
                        order,
                    });
                    order += 1;
                }
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    current_id = Some(parts[1].to_string());
                }
            } else if line.starts_with("description") {
                let parts: Vec<&str> = line.splitn(2, ' ').collect();
                if parts.len() >= 2 {
                    current_name = Some(parts[1].trim().to_string());
                }
            } else if line.starts_with("device") {
                let parts: Vec<&str> = line.splitn(2, ' ').collect();
                if parts.len() >= 2 {
                    current_device = Some(parts[1].trim().to_string());
                }
            }
        }

        if let Some(id) = current_id.take() {
            entries.push(BootEntry {
                id: id.clone(),
                name: current_name.take().unwrap_or_else(|| "Unknown".to_string()),
                partition: current_device.take().unwrap_or_else(|| "Unknown".to_string()),
                disk: "Unknown".to_string(),
                active: true,
                order,
            });
        }

        Ok(entries)
    }

    async fn get_boot_entries_macos(&self) -> Result<Vec<BootEntry>, EfiError> {
        Ok(vec![
            BootEntry {
                id: "0001".to_string(),
                name: "macOS".to_string(),
                partition: "disk0s1".to_string(),
                disk: "/dev/disk0".to_string(),
                active: true,
                order: 0,
            },
            BootEntry {
                id: "0002".to_string(),
                name: "Windows Boot Manager".to_string(),
                partition: "disk0s2".to_string(),
                disk: "/dev/disk0".to_string(),
                active: true,
                order: 1,
            },
        ])
    }

    pub async fn add_boot_entry(&self, entry: &BootEntry) -> Result<(), EfiError> {
        let os = std::env::consts::OS;
        match os {
            "linux" => {
                let output = Command::new("efibootmgr")
                    .args(["-c", "-L", &entry.name, "-d", &entry.disk, "-p", "1", "-l", "\\EFI\\BOOT\\bootx64.efi"])
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped())
                    .output()
                    .await?;

                if !output.status.success() {
                    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                    return Err(EfiError::Command(stderr));
                }

                self.sync_nvram_linux().await?;
                Ok(())
            }
            "windows" => {
                self.sync_nvram_windows().await?;
                Ok(())
            }
            "macos" => {
                Ok(())
            }
            _ => Err(EfiError::UnsupportedOs),
        }
    }

    pub async fn delete_boot_entry(&self, entry_id: &str) -> Result<(), EfiError> {
        let os = std::env::consts::OS;
        match os {
            "linux" => {
                let output = Command::new("efibootmgr")
                    .args(["-b", entry_id, "-B"])
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped())
                    .output()
                    .await?;

                if !output.status.success() {
                    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                    return Err(EfiError::Command(stderr));
                }

                self.sync_nvram_linux().await?;
                Ok(())
            }
            "windows" => {
                self.sync_nvram_windows().await?;
                Ok(())
            }
            "macos" => {
                Ok(())
            }
            _ => Err(EfiError::UnsupportedOs),
        }
    }

    pub async fn set_boot_order(&self, order: &[String]) -> Result<(), EfiError> {
        let os = std::env::consts::OS;
        let order_str = order.join(",");
        
        match os {
            "linux" => {
                self.set_boot_order_linux(&order_str).await?;
                Ok(())
            }
            "windows" => {
                self.set_boot_order_windows(order).await?;
                Ok(())
            }
            "macos" => {
                Ok(())
            }
            _ => Err(EfiError::UnsupportedOs),
        }
    }

    async fn set_boot_order_linux(&self, order_str: &str) -> Result<(), EfiError> {
        const MAX_RETRIES: u32 = 3;
        
        for attempt in 1..=MAX_RETRIES {
            let output = Command::new("efibootmgr")
                .args(["-o", order_str])
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .output()
                .await?;

            if output.status.success() {
                sleep(Duration::from_millis(100)).await;
                
                self.sync_nvram_linux().await?;
                
                if self.verify_boot_order_linux(order_str).await? {
                    return Ok(());
                }
            }

            if attempt < MAX_RETRIES {
                sleep(Duration::from_millis(200 * attempt as u64)).await;
            }
        }

        Err(EfiError::NvramSyncFailed)
    }

    async fn set_boot_order_windows(&self, order: &[String]) -> Result<(), EfiError> {
        const MAX_RETRIES: u32 = 3;
        
        for attempt in 1..=MAX_RETRIES {
            let display_order: Vec<String> = order.iter()
                .map(|id| format!("{{{}}}", id))
                .collect();
            
            let output = Command::new("bcdedit")
                .args(["/set", "{fwbootmgr}", "displayorder"])
                .args(&display_order)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .output()
                .await?;

            if output.status.success() {
                sleep(Duration::from_millis(100)).await;
                
                self.sync_nvram_windows().await?;
                
                return Ok(());
            }

            if attempt < MAX_RETRIES {
                sleep(Duration::from_millis(200 * attempt as u64)).await;
            }
        }

        Err(EfiError::NvramSyncFailed)
    }

    async fn sync_nvram_linux(&self) -> Result<(), EfiError> {
        self.flush_efi_variables().await?;
        sleep(Duration::from_millis(150)).await;
        
        let _ = Command::new("efibootmgr")
            .arg("-v")
            .output()
            .await;

        Ok(())
    }

    async fn flush_efi_variables(&self) -> Result<(), EfiError> {
        let efi_var_path = Path::new("/sys/firmware/efi/efivars/");
        if efi_var_path.exists() {
            let _ = Command::new("sync")
                .output()
                .await;

            let drop_caches = Path::new("/proc/sys/vm/drop_caches");
            if drop_caches.exists() {
                let _ = fs::write(drop_caches, "3").await;
            }
        }

        Ok(())
    }

    async fn verify_boot_order_linux(&self, expected_order: &str) -> Result<bool, EfiError> {
        let output = Command::new("efibootmgr")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await?;

        if !output.status.success() {
            return Ok(false);
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let boot_order_regex = regex::Regex::new(r"BootOrder: ([0-9A-Fa-f,]+)").unwrap();
        
        if let Some(cap) = boot_order_regex.captures(&stdout) {
            let current_order = &cap[1];
            Ok(current_order == expected_order)
        } else {
            Ok(false)
        }
    }

    async fn sync_nvram_windows(&self) -> Result<(), EfiError> {
        let _ = Command::new("bcdedit")
            .args(["/enum", "{fwbootmgr}"])
            .output()
            .await;

        sleep(Duration::from_millis(200)).await;

        Ok(())
    }

    pub async fn backup_config(&self, path: &Path) -> Result<(), EfiError> {
        let entries = self.get_boot_entries().await?;
        let json = serde_json::to_string_pretty(&entries)?;
        fs::write(path, json).await?;
        Ok(())
    }

    pub async fn restore_config(&self, path: &Path) -> Result<(), EfiError> {
        let json = fs::read_to_string(path).await?;
        let entries: Vec<BootEntry> = serde_json::from_str(&json)?;
        
        let mut order: Vec<String> = entries.iter()
            .map(|e| e.id.clone())
            .collect();
        order.sort_by_key(|id| {
            entries.iter()
                .find(|e| &e.id == id)
                .map(|e| e.order)
                .unwrap_or(usize::MAX)
        });
        
        if !order.is_empty() {
            self.set_boot_order(&order).await?;
        }
        
        Ok(())
    }
}

impl Default for EfiManager {
    fn default() -> Self {
        Self::new()
    }
}
