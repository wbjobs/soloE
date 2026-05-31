use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use notify::event::{AccessKind, AccessMode, CreateKind, ModifyKind, RenameMode};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use notify_debouncer_full::new_debouncer;
use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, mpsc, RwLock};
use tracing::{debug, error, info, warn};
use walkdir::WalkDir;

use crate::error::Result;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FileChangeType {
    Created,
    Modified,
    Removed,
    Renamed,
    Accessed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileChange {
    pub path: PathBuf,
    pub change_type: FileChangeType,
    pub timestamp: DateTime<Utc>,
    pub file_size: Option<u64>,
    pub old_path: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileMetadata {
    pub path: PathBuf,
    pub size: u64,
    pub modified: DateTime<Utc>,
    pub hash: String,
    pub chunk_hashes: Vec<String>,
}

pub struct FileWatcher {
    watch_path: PathBuf,
    watcher: Option<RecommendedWatcher>,
    changes_tx: broadcast::Sender<FileChange>,
    file_cache: Arc<RwLock<HashMap<PathBuf, FileMetadata>>>,
    chunk_size: u64,
}

impl FileWatcher {
    pub fn new(watch_path: PathBuf, chunk_size: u64) -> Result<Self> {
        let (changes_tx, _) = broadcast::channel(100);
        
        Ok(Self {
            watch_path,
            watcher: None,
            changes_tx,
            file_cache: Arc::new(RwLock::new(HashMap::new())),
            chunk_size,
        })
    }

    pub fn subscribe(&self) -> broadcast::Receiver<FileChange> {
        self.changes_tx.subscribe()
    }

    pub async fn start(&mut self) -> Result<()> {
        if !self.watch_path.exists() {
            return Err(crate::error::AppError::Network(format!(
                "Watch path does not exist: {:?}",
                self.watch_path
            )));
        }

        info!("Starting file watcher for: {:?}", self.watch_path);
        
        // Initial scan
        self.initial_scan().await?;

        let tx = self.changes_tx.clone();
        let file_cache = Arc::clone(&self.file_cache);
        let chunk_size = self.chunk_size;
        let watch_path = self.watch_path.clone();

        let (debouncer_tx, mut debouncer_rx) = mpsc::channel(100);

        let mut debouncer = new_debouncer(
            Duration::from_millis(500),
            Some(Duration::from_millis(2000)),
            move |res| {
                if let Ok(events) = res {
                    for event in events {
                        let _ = debouncer_tx.blocking_send(event);
                    }
                }
            },
        )?;

        debouncer
            .watcher()
            .watch(&self.watch_path, RecursiveMode::Recursive)?;

        self.watcher = Some(debouncer.watcher().to_owned());

        tokio::spawn(async move {
            while let Some(event) = debouncer_rx.recv().await {
                if let Ok(file_changes) = process_event(event, &watch_path) {
                    for mut change in file_changes {
                        if change.change_type == FileChangeType::Created 
                            || change.change_type == FileChangeType::Modified {
                            if let Ok(metadata) = Self::compute_file_metadata(&change.path, chunk_size).await {
                                let mut cache = file_cache.write().await;
                                cache.insert(change.path.clone(), metadata.clone());
                                change.file_size = Some(metadata.size);
                            }
                        } else if change.change_type == FileChangeType::Removed {
                            let mut cache = file_cache.write().await;
                            cache.remove(&change.path);
                        }

                        let _ = tx.send(change);
                    }
                }
            }
        });

        Ok(())
    }

    pub async fn stop(&mut self) -> Result<()> {
        if let Some(watcher) = self.watcher.take() {
            drop(watcher);
        }
        info!("File watcher stopped");
        Ok(())
    }

    async fn initial_scan(&self) -> Result<()> {
        info!("Performing initial scan of: {:?}", self.watch_path);
        
        let mut cache = self.file_cache.write().await;
        let chunk_size = self.chunk_size;

        for entry in WalkDir::new(&self.watch_path)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
        {
            let path = entry.path().to_path_buf();
            if let Ok(metadata) = Self::compute_file_metadata(&path, chunk_size).await {
                cache.insert(path, metadata);
            }
        }

        info!("Initial scan completed, found {} files", cache.len());
        Ok(())
    }

    async fn compute_file_metadata(path: &Path, chunk_size: u64) -> Result<FileMetadata> {
        use std::fs::File;
        use std::io::Read;

        let metadata = std::fs::metadata(path)?;
        let modified = DateTime::from(metadata.modified()?);
        let size = metadata.len();

        let mut file = File::open(path)?;
        let mut hasher = blake3::Hasher::new();
        let mut chunk_hashes = Vec::new();
        
        let mut buffer = vec![0u8; chunk_size as usize];
        loop {
            let bytes_read = file.read(&mut buffer)?;
            if bytes_read == 0 {
                break;
            }
            
            hasher.update(&buffer[..bytes_read]);
            
            let chunk_hash = blake3::hash(&buffer[..bytes_read]);
            chunk_hashes.push(chunk_hash.to_hex().to_string());
        }

        let file_hash = hasher.finalize().to_hex().to_string();

        Ok(FileMetadata {
            path: path.to_path_buf(),
            size,
            modified,
            hash: file_hash,
            chunk_hashes,
        })
    }

    pub async fn get_file_metadata(&self, path: &Path) -> Option<FileMetadata> {
        let cache = self.file_cache.read().await;
        cache.get(path).cloned()
    }

    pub async fn get_all_files(&self) -> Vec<FileMetadata> {
        let cache = self.file_cache.read().await;
        cache.values().cloned().collect()
    }

    pub async fn compare_files(
        &self,
        remote_files: &[FileMetadata],
    ) -> Result<Vec<FileDiff>> {
        let local_cache = self.file_cache.read().await;
        let mut diffs = Vec::new();

        for remote_file in remote_files {
            let rel_path = if remote_file.path.is_absolute() {
                remote_file.path.strip_prefix(&self.watch_path).unwrap_or(&remote_file.path)
            } else {
                &remote_file.path
            };

            let local_path = self.watch_path.join(rel_path);

            match local_cache.get(&local_path) {
                Some(local_file) => {
                    if local_file.hash != remote_file.hash {
                        let changed_chunks = self
                            .compare_chunks(&local_file.chunk_hashes, &remote_file.chunk_hashes)
                            .await;
                        
                        if !changed_chunks.is_empty() {
                            diffs.push(FileDiff {
                                path: rel_path.to_path_buf(),
                                diff_type: DiffType::Modified,
                                changed_chunks,
                                local_hash: Some(local_file.hash.clone()),
                                remote_hash: remote_file.hash.clone(),
                            });
                        }
                    }
                }
                None => {
                    diffs.push(FileDiff {
                        path: rel_path.to_path_buf(),
                        diff_type: DiffType::New,
                        changed_chunks: (0..remote_file.chunk_hashes.len()).collect(),
                        local_hash: None,
                        remote_hash: remote_file.hash.clone(),
                    });
                }
            }
        }

        // Check for deleted files
        for (local_path, _) in local_cache.iter() {
            let rel_path = local_path.strip_prefix(&self.watch_path).unwrap_or(local_path);
            let found = remote_files.iter().any(|r| {
                let r_rel = if r.path.is_absolute() {
                    r.path.strip_prefix(&self.watch_path).unwrap_or(&r.path)
                } else {
                    &r.path
                };
                r_rel == rel_path
            });

            if !found {
                diffs.push(FileDiff {
                    path: rel_path.to_path_buf(),
                    diff_type: DiffType::Deleted,
                    changed_chunks: Vec::new(),
                    local_hash: None,
                    remote_hash: String::new(),
                });
            }
        }

        Ok(diffs)
    }

    async fn compare_chunks(&self, local: &[String], remote: &[String]) -> Vec<usize> {
        let mut changed = Vec::new();
        let max_len = std::cmp::max(local.len(), remote.len());

        for i in 0..max_len {
            match (local.get(i), remote.get(i)) {
                (Some(l), Some(r)) if l != r => changed.push(i),
                (None, Some(_)) => changed.push(i),
                (Some(_), None) => changed.push(i),
                _ => {}
            }
        }

        changed
    }
}

fn process_event(event: Event, watch_path: &Path) -> Result<Vec<FileChange>> {
    let mut changes = Vec::new();

    match event.kind {
        EventKind::Create(create_kind) => {
            for path in event.paths {
                if path.starts_with(watch_path) {
                    let change_type = match create_kind {
                        CreateKind::File => FileChangeType::Created,
                        CreateKind::Folder => FileChangeType::Created,
                        _ => FileChangeType::Created,
                    };

                    changes.push(FileChange {
                        path,
                        change_type,
                        timestamp: Utc::now(),
                        file_size: None,
                        old_path: None,
                    });
                }
            }
        }
        EventKind::Modify(modify_kind) => {
            match modify_kind {
                ModifyKind::Data(_) | ModifyKind::Any => {
                    for path in event.paths {
                        if path.starts_with(watch_path) && path.is_file() {
                            changes.push(FileChange {
                                path,
                                change_type: FileChangeType::Modified,
                                timestamp: Utc::now(),
                                file_size: None,
                                old_path: None,
                            });
                        }
                    }
                }
                ModifyKind::Name(rename_mode) => {
                    if let RenameMode::Both = rename_mode {
                        if event.paths.len() == 2 {
                            let old_path = event.paths[0].clone();
                            let new_path = event.paths[1].clone();
                            if new_path.starts_with(watch_path) {
                                changes.push(FileChange {
                                    path: new_path,
                                    change_type: FileChangeType::Renamed,
                                    timestamp: Utc::now(),
                                    file_size: None,
                                    old_path: Some(old_path),
                                });
                            }
                        }
                    }
                }
                _ => {}
            }
        }
        EventKind::Remove(_) => {
            for path in event.paths {
                if path.starts_with(watch_path) {
                    changes.push(FileChange {
                        path,
                        change_type: FileChangeType::Removed,
                        timestamp: Utc::now(),
                        file_size: None,
                        old_path: None,
                    });
                }
            }
        }
        EventKind::Access(AccessKind::Close(AccessMode::Write)) => {
            for path in event.paths {
                if path.starts_with(watch_path) && path.is_file() {
                    changes.push(FileChange {
                        path,
                        change_type: FileChangeType::Modified,
                        timestamp: Utc::now(),
                        file_size: None,
                        old_path: None,
                    });
                }
            }
        }
        _ => {}
    }

    Ok(changes)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DiffType {
    New,
    Modified,
    Deleted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileDiff {
    pub path: PathBuf,
    pub diff_type: DiffType,
    pub changed_chunks: Vec<usize>,
    pub local_hash: Option<String>,
    pub remote_hash: String,
}

impl Drop for FileWatcher {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}
