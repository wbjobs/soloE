use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::{DateTime, Utc};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum OSType {
    Windows,
    macOS,
    Linux,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DeviceStatus {
    Online,
    Offline,
    Connecting,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ConnectionMethod {
    Broadcast,
    Manual,
    TcpHolePunch,
    SignalingServer,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
    pub ip: String,
    pub port: u16,
    pub os: OSType,
    pub status: DeviceStatus,
    pub last_seen: DateTime<Utc>,
    pub connection_method: Option<ConnectionMethod>,
    pub public_ip: Option<String>,
}

impl Default for DeviceInfo {
    fn default() -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name: String::from("Unknown Device"),
            ip: String::from("127.0.0.1"),
            port: 58778,
            os: OSType::Unknown,
            status: DeviceStatus::Offline,
            last_seen: Utc::now(),
            connection_method: None,
            public_ip: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FileType {
    File,
    Folder,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileItem {
    pub id: String,
    pub name: String,
    pub path: String,
    pub size: u64,
    pub file_type: FileType,
    pub children: Option<Vec<FileItem>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TransferDirection {
    Send,
    Receive,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TransferStatus {
    Pending,
    Transferring,
    Paused,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferTask {
    pub id: String,
    pub direction: TransferDirection,
    pub peer_device: DeviceInfo,
    pub files: Vec<FileItem>,
    pub total_size: u64,
    pub transferred_size: u64,
    pub speed: f64,
    pub status: TransferStatus,
    pub start_time: DateTime<Utc>,
    pub end_time: Option<DateTime<Utc>>,
    pub error: Option<String>,
}

impl Default for TransferTask {
    fn default() -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            direction: TransferDirection::Send,
            peer_device: DeviceInfo::default(),
            files: Vec::new(),
            total_size: 0,
            transferred_size: 0,
            speed: 0.0,
            status: TransferStatus::Pending,
            start_time: Utc::now(),
            end_time: None,
            error: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub device_name: String,
    pub save_path: String,
    pub auto_accept: bool,
    pub max_concurrent_transfers: u32,
    pub enable_encryption: bool,
    pub discovery_port: u16,
    pub transfer_port: u16,
    pub enable_hole_punch: bool,
    pub hole_punch_attempts: u32,
    pub enable_signaling: bool,
    pub signaling_server_url: String,
    pub signaling_api_key: Option<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            device_name: String::from("My Device"),
            save_path: String::new(),
            auto_accept: false,
            max_concurrent_transfers: 3,
            enable_encryption: true,
            discovery_port: 58777,
            transfer_port: 58778,
            enable_hole_punch: true,
            hole_punch_attempts: 5,
            enable_signaling: false,
            signaling_server_url: String::from("wss://signaling.lanshare.dev"),
            signaling_api_key: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TransferEvent {
    Progress {
        transfer_id: String,
        bytes_transferred: u64,
        total_bytes: u64,
    },
    Speed {
        transfer_id: String,
        bytes_per_second: f64,
    },
    Completed {
        transfer_id: String,
    },
    Failed {
        transfer_id: String,
        error: String,
    },
    DeviceDiscovered {
        device: DeviceInfo,
    },
    DeviceOffline {
        device_id: String,
    },
    TransferRequest {
        from_device: DeviceInfo,
        files: Vec<FileItem>,
        transfer_id: String,
    },
}
