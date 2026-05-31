use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, mpsc, RwLock};
use tokio::time::timeout;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use crate::error::Result;
use crate::file_watcher::{FileChange, FileDiff, FileMetadata, FileWatcher};
use crate::models::DeviceInfo;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SyncStatus {
    Idle,
    Scanning,
    Syncing,
    Paused,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SyncMode {
    Bidirectional,
    SendOnly,
    ReceiveOnly,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncStats {
    pub files_synced: u64,
    pub bytes_transferred: u64,
    pub files_to_sync: u64,
    pub bytes_to_sync: u64,
    pub errors: u64,
    pub start_time: DateTime<Utc>,
    pub last_sync_time: Option<DateTime<Utc>>,
}

impl Default for SyncStats {
    fn default() -> Self {
        Self {
            files_synced: 0,
            bytes_transferred: 0,
            files_to_sync: 0,
            bytes_to_sync: 0,
            errors: 0,
            start_time: Utc::now(),
            last_sync_time: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncSessionConfig {
    pub session_id: String,
    pub local_path: PathBuf,
    pub peer_device: DeviceInfo,
    pub sync_mode: SyncMode,
    pub chunk_size: u64,
    pub auto_start: bool,
    pub ignore_patterns: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SyncMessageType {
    Hello,
    FileListRequest,
    FileListResponse,
    ChunkRequest,
    ChunkResponse,
    SyncComplete,
    FileChangeNotify,
    Ack,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncMessage {
    pub message_id: String,
    pub session_id: String,
    pub message_type: SyncMessageType,
    pub payload: serde_json::Value,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncProgress {
    pub session_id: String,
    pub current_file: PathBuf,
    pub progress: f64,
    pub bytes_transferred: u64,
    pub total_bytes: u64,
    pub status: SyncStatus,
}

pub struct SyncSession {
    config: SyncSessionConfig,
    watcher: Option<FileWatcher>,
    status: Arc<RwLock<SyncStatus>>,
    stats: Arc<RwLock<SyncStats>>,
    progress_tx: broadcast::Sender<SyncProgress>,
    event_tx: broadcast::Sender<SyncSessionEvent>,
    pending_transfers: Arc<RwLock<HashMap<PathBuf, FileDiff>>>,
    is_running: Arc<RwLock<bool>>,
}

#[derive(Debug, Clone, Serialize)]
pub enum SyncSessionEvent {
    StatusChanged {
        session_id: String,
        old_status: SyncStatus,
        new_status: SyncStatus,
    },
    FileSynced {
        session_id: String,
        path: PathBuf,
        bytes_transferred: u64,
    },
    ErrorOccurred {
        session_id: String,
        error: String,
    },
    Progress(SyncProgress),
}

impl SyncSession {
    pub fn new(config: SyncSessionConfig) -> Result<Self> {
        let (progress_tx, _) = broadcast::channel(100);
        let (event_tx, _) = broadcast::channel(100);

        let watcher = FileWatcher::new(config.local_path.clone(), config.chunk_size)?;

        Ok(Self {
            config,
            watcher: Some(watcher),
            status: Arc::new(RwLock::new(SyncStatus::Idle)),
            stats: Arc::new(RwLock::new(SyncStats::default())),
            progress_tx,
            event_tx,
            pending_transfers: Arc::new(RwLock::new(HashMap::new())),
            is_running: Arc::new(RwLock::new(false)),
        })
    }

    pub fn subscribe_progress(&self) -> broadcast::Receiver<SyncProgress> {
        self.progress_tx.subscribe()
    }

    pub fn subscribe_events(&self) -> broadcast::Receiver<SyncSessionEvent> {
        self.event_tx.subscribe()
    }

    pub async fn start(&mut self) -> Result<()> {
        info!("Starting sync session: {}", self.config.session_id);

        *self.is_running.write().await = true;
        self.set_status(SyncStatus::Scanning).await;

        // Start file watcher
        if let Some(watcher) = self.watcher.as_mut() {
            watcher.start().await?;
            
            // Subscribe to file changes
            let mut change_rx = watcher.subscribe();
            let session_id = self.config.session_id.clone();
            let event_tx = self.event_tx.clone();
            let peer_device = self.config.peer_device.clone();
            let is_running = Arc::clone(&self.is_running);

            tokio::spawn(async move {
                while *is_running.read().await {
                    match timeout(Duration::from_secs(1), change_rx.recv()).await {
                        Ok(Ok(change)) => {
                            debug!("File change detected: {:?}", change);
                            // Send change notification to peer
                            let _ = event_tx.send(SyncSessionEvent::FileSynced {
                                session_id: session_id.clone(),
                                path: change.path,
                                bytes_transferred: 0,
                            });
                        }
                        Ok(Err(e)) => {
                            error!("Error receiving file change: {}", e);
                            break;
                        }
                        Err(_) => continue,
                    }
                }
            });
        }

        // Start initial sync
        if self.config.auto_start {
            tokio::spawn({
                let this = Arc::new(RwLock::new(self));
                async move {
                    let this = this.read().await;
                    let _ = this.perform_initial_sync().await;
                }
            });
        }

        Ok(())
    }

    pub async fn stop(&mut self) -> Result<()> {
        info!("Stopping sync session: {}", self.config.session_id);
        
        *self.is_running.write().await = false;
        
        if let Some(watcher) = self.watcher.as_mut() {
            watcher.stop().await?;
        }

        self.set_status(SyncStatus::Idle).await;
        Ok(())
    }

    pub async fn pause(&mut self) -> Result<()> {
        info!("Pausing sync session: {}", self.config.session_id);
        *self.is_running.write().await = false;
        self.set_status(SyncStatus::Paused).await;
        Ok(())
    }

    pub async fn resume(&mut self) -> Result<()> {
        info!("Resuming sync session: {}", self.config.session_id);
        *self.is_running.write().await = true;
        self.set_status(SyncStatus::Syncing).await;
        Ok(())
    }

    async fn perform_initial_sync(&self) -> Result<()> {
        info!("Performing initial sync for session: {}", self.config.session_id);
        
        self.set_status(SyncStatus::Syncing).await;

        // Get local file list
        let local_files = if let Some(watcher) = self.watcher.as_ref() {
            watcher.get_all_files().await
        } else {
            Vec::new()
        };

        // In a real implementation, we would exchange file lists with peer
        // and compute the diff, then transfer only changed chunks
        
        debug!("Local files to sync: {}", local_files.len());

        let mut stats = self.stats.write().await;
        stats.files_to_sync = local_files.len() as u64;
        stats.bytes_to_sync = local_files.iter().map(|f| f.size).sum();
        stats.start_time = Utc::now();
        drop(stats);

        // Simulate sync progress
        for (index, file) in local_files.iter().enumerate() {
            if !*self.is_running.read().await {
                break;
            }

            let progress = ((index + 1) as f64 / local_files.len() as f64) * 100.0;

            let _ = self.progress_tx.send(SyncProgress {
                session_id: self.config.session_id.clone(),
                current_file: file.path.clone(),
                progress,
                bytes_transferred: file.size,
                total_bytes: file.size,
                status: SyncStatus::Syncing,
            });

            let mut stats = self.stats.write().await;
            stats.files_synced = (index + 1) as u64;
            stats.bytes_transferred += file.size;

            // Simulate transfer delay
            tokio::time::sleep(Duration::from_millis(100)).await;
        }

        let mut stats = self.stats.write().await;
        stats.last_sync_time = Some(Utc::now());
        drop(stats);

        self.set_status(SyncStatus::Idle).await;
        info!("Initial sync completed for session: {}", self.config.session_id);

        Ok(())
    }

    pub async fn sync_now(&self) -> Result<()> {
        info!("Manual sync requested for session: {}", self.config.session_id);
        self.perform_initial_sync().await
    }

    async fn set_status(&self, new_status: SyncStatus) {
        let mut status = self.status.write().await;
        let old_status = status.clone();
        *status = new_status.clone();
        drop(status);

        let _ = self.event_tx.send(SyncSessionEvent::StatusChanged {
            session_id: self.config.session_id.clone(),
            old_status,
            new_status,
        });
    }

    pub async fn get_status(&self) -> SyncStatus {
        self.status.read().await.clone()
    }

    pub async fn get_stats(&self) -> SyncStats {
        self.stats.read().await.clone()
    }

    pub fn get_config(&self) -> &SyncSessionConfig {
        &self.config
    }

    pub async fn get_local_files(&self) -> Vec<FileMetadata> {
        if let Some(watcher) = self.watcher.as_ref() {
            watcher.get_all_files().await
        } else {
            Vec::new()
        }
    }
}

pub struct SyncSessionManager {
    sessions: Arc<RwLock<HashMap<String, Arc<RwLock<SyncSession>>>>>,
    event_tx: broadcast::Sender<SyncSessionEvent>,
}

impl SyncSessionManager {
    pub fn new() -> Self {
        let (event_tx, _) = broadcast::channel(100);
        
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            event_tx,
        }
    }

    pub async fn create_session(&self, config: SyncSessionConfig) -> Result<String> {
        let session_id = config.session_id.clone();
        
        let session = SyncSession::new(config)?;
        let session = Arc::new(RwLock::new(session));
        
        let mut sessions = self.sessions.write().await;
        sessions.insert(session_id.clone(), session);
        
        info!("Created sync session: {}", session_id);
        Ok(session_id)
    }

    pub async fn start_session(&self, session_id: &str) -> Result<()> {
        let sessions = self.sessions.read().await;
        if let Some(session) = sessions.get(session_id) {
            let mut session = session.write().await;
            session.start().await?;
            Ok(())
        } else {
            Err(crate::error::AppError::Network(format!(
                "Session not found: {}",
                session_id
            )))
        }
    }

    pub async fn stop_session(&self, session_id: &str) -> Result<()> {
        let sessions = self.sessions.read().await;
        if let Some(session) = sessions.get(session_id) {
            let mut session = session.write().await;
            session.stop().await?;
            Ok(())
        } else {
            Err(crate::error::AppError::Network(format!(
                "Session not found: {}",
                session_id
            )))
        }
    }

    pub async fn remove_session(&self, session_id: &str) -> Result<()> {
        let mut sessions = self.sessions.write().await;
        if let Some(session) = sessions.remove(session_id) {
            let mut session = session.write().await;
            session.stop().await?;
            info!("Removed sync session: {}", session_id);
            Ok(())
        } else {
            Err(crate::error::AppError::Network(format!(
                "Session not found: {}",
                session_id
            )))
        }
    }

    pub async fn get_session_status(&self, session_id: &str) -> Option<SyncStatus> {
        let sessions = self.sessions.read().await;
        sessions
            .get(session_id)
            .and_then(|s| s.try_read())
            .map(|s| futures::executor::block_on(s.get_status()))
    }

    pub async fn get_all_sessions(&self) -> Vec<SyncSessionConfig> {
        let sessions = self.sessions.read().await;
        sessions
            .values()
            .filter_map(|s| s.try_read())
            .map(|s| s.get_config().clone())
            .collect()
    }

    pub async fn sync_now(&self, session_id: &str) -> Result<()> {
        let sessions = self.sessions.read().await;
        if let Some(session) = sessions.get(session_id) {
            let session = session.read().await;
            session.sync_now().await?;
            Ok(())
        } else {
            Err(crate::error::AppError::Network(format!(
                "Session not found: {}",
                session_id
            )))
        }
    }

    pub fn subscribe_events(&self) -> broadcast::Receiver<SyncSessionEvent> {
        self.event_tx.subscribe()
    }
}

impl Default for SyncSessionManager {
    fn default() -> Self {
        Self::new()
    }
}
