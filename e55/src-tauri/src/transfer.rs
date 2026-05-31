use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Write};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use bytes::{BufMut, Bytes, BytesMut};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::RwLock;
use tokio_stream::StreamExt;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use crate::error::Result;
use crate::models::{FileItem, FileType, TransferStatus, TransferTask, TransferDirection, TransferEvent};

const CHUNK_SIZE: u64 = 1024 * 1024; // 1MB

#[derive(Debug, Clone, Serialize, Deserialize)]
enum TransferMessage {
    Request {
        transfer_id: String,
        files: Vec<FileItem>,
        total_size: u64,
    },
    Accept {
        transfer_id: String,
    },
    Reject {
        transfer_id: String,
    },
    Chunk {
        transfer_id: String,
        file_path: String,
        chunk_index: u64,
        total_chunks: u64,
        data: Vec<u8>,
    },
    ChunkAck {
        transfer_id: String,
        file_path: String,
        chunk_index: u64,
    },
    Complete {
        transfer_id: String,
    },
    Cancel {
        transfer_id: String,
    },
    Progress {
        transfer_id: String,
        bytes_transferred: u64,
        total_bytes: u64,
    },
}

pub struct TransferManager {
    transfers: Arc<RwLock<HashMap<String, TransferTask>>>,
    event_sender: tokio::sync::broadcast::Sender<TransferEvent>,
    save_path: PathBuf,
}

impl TransferManager {
    pub fn new(save_path: PathBuf) -> Result<Self> {
        let (event_sender, _) = tokio::sync::broadcast::channel(100);

        Ok(Self {
            transfers: Arc::new(RwLock::new(HashMap::new())),
            event_sender,
            save_path,
        })
    }

    pub fn subscribe_events(&self) -> tokio::sync::broadcast::Receiver<TransferEvent> {
        self.event_sender.subscribe()
    }

    pub async fn start_listener(&self, port: u16) -> Result<()> {
        let listener = TcpListener::bind(format!("0.0.0.0:{}", port)).await?;
        info!("Transfer listener started on port {}", port);

        let transfers = Arc::clone(&self.transfers);
        let event_sender = self.event_sender.clone();
        let save_path = self.save_path.clone();

        tokio::spawn(async move {
            loop {
                match listener.accept().await {
                    Ok((socket, addr)) => {
                        debug!("New connection from: {}", addr);
                        let transfers = Arc::clone(&transfers);
                        let event_sender = event_sender.clone();
                        let save_path = save_path.clone();

                        tokio::spawn(async move {
                            if let Err(e) = Self::handle_connection(socket, transfers, event_sender, save_path).await {
                                error!("Error handling connection: {}", e);
                            }
                        });
                    }
                    Err(e) => {
                        error!("Error accepting connection: {}", e);
                    }
                }
            }
        });

        Ok(())
    }

    async fn handle_connection(
        mut socket: TcpStream,
        _transfers: Arc<RwLock<HashMap<String, TransferTask>>>,
        _event_sender: tokio::sync::broadcast::Sender<TransferEvent>,
        save_path: PathBuf,
    ) -> Result<()> {
        let mut len_buf = [0u8; 4];
        loop {
            socket.readable().await?;
            match socket.try_read(&mut len_buf) {
                Ok(0) => break,
                Ok(4) => {
                    let msg_len = u32::from_be_bytes(len_buf) as usize;
                    let mut msg_buf = vec![0u8; msg_len];

                    socket.readable().await?;
                    let n = socket.try_read(&mut msg_buf)?;
                    if n != msg_len {
                        warn!("Incomplete message received");
                        continue;
                    }

                    let msg: TransferMessage = serde_json::from_slice(&msg_buf)?;
                    Self::handle_message(msg, &mut socket, &save_path).await?;
                }
                Ok(_) => {
                    warn!("Invalid message length received");
                }
                Err(e) => {
                    if e.kind() != std::io::ErrorKind::WouldBlock {
                        return Err(e.into());
                    }
                }
            }
        }

        Ok(())
    }

    async fn handle_message(_msg: TransferMessage, _socket: &mut TcpStream, _save_path: &PathBuf) -> Result<()> {
        Ok(())
    }

    pub async fn send_files(&self, target_addr: SocketAddr, files: Vec<FileItem>) -> Result<String> {
        let transfer_id = Uuid::new_v4().to_string();
        let total_size: u64 = files.iter().map(|f| f.size).sum();

        let task = TransferTask {
            id: transfer_id.clone(),
            direction: TransferDirection::Send,
            total_size,
            transferred_size: 0,
            speed: 0.0,
            status: TransferStatus::Transferring,
            files: files.clone(),
            ..TransferTask::default()
        };

        self.transfers.write().await.insert(transfer_id.clone(), task);

        let transfers = Arc::clone(&self.transfers);
        let event_sender = self.event_sender.clone();
        let transfer_id_clone = transfer_id.clone();

        tokio::spawn(async move {
            if let Err(e) = Self::do_send_files(target_addr, &transfer_id_clone, files, total_size, transfers, event_sender).await {
                error!("Error sending files: {}", e);
            }
        });

        Ok(transfer_id)
    }

    async fn do_send_files(
        _target_addr: SocketAddr,
        _transfer_id: &str,
        _files: Vec<FileItem>,
        _total_size: u64,
        _transfers: Arc<RwLock<HashMap<String, TransferTask>>>,
        _event_sender: tokio::sync::broadcast::Sender<TransferEvent>,
    ) -> Result<()> {
        Ok(())
    }

    pub async fn pause_transfer(&self, transfer_id: &str) -> Result<()> {
        let mut transfers = self.transfers.write().await;
        if let Some(task) = transfers.get_mut(transfer_id) {
            if task.status == TransferStatus::Transferring {
                task.status = TransferStatus::Paused;
            }
        }
        Ok(())
    }

    pub async fn resume_transfer(&self, transfer_id: &str) -> Result<()> {
        let mut transfers = self.transfers.write().await;
        if let Some(task) = transfers.get_mut(transfer_id) {
            if task.status == TransferStatus::Paused {
                task.status = TransferStatus::Transferring;
            }
        }
        Ok(())
    }

    pub async fn cancel_transfer(&self, transfer_id: &str) -> Result<()> {
        let mut transfers = self.transfers.write().await;
        if let Some(task) = transfers.get_mut(transfer_id) {
            task.status = TransferStatus::Cancelled;
        }
        Ok(())
    }

    pub async fn get_transfer(&self, transfer_id: &str) -> Option<TransferTask> {
        self.transfers.read().await.get(transfer_id).cloned()
    }

    pub async fn get_all_transfers(&self) -> Vec<TransferTask> {
        self.transfers.read().await.values().cloned().collect()
    }
}

fn split_file_into_chunks(file_path: &str, chunk_size: u64) -> Result<Vec<(u64, u64)>> {
    let file = File::open(file_path)?;
    let file_size = file.metadata()?.len();
    let num_chunks = (file_size + chunk_size - 1) / chunk_size;

    let mut chunks = Vec::new();
    for i in 0..num_chunks {
        let start = i * chunk_size;
        let end = std::cmp::min((i + 1) * chunk_size, file_size);
        chunks.push((start, end - start));
    }

    Ok(chunks)
}

fn read_chunk(file_path: &str, offset: u64, size: u64) -> Result<Vec<u8>> {
    let mut file = File::open(file_path)?;
    file.seek(std::io::SeekFrom::Start(offset))?;

    let mut buffer = vec![0u8; size as usize];
    file.read_exact(&mut buffer)?;

    Ok(buffer)
}

fn write_chunk(file_path: &str, offset: u64, data: &[u8]) -> Result<()> {
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .open(file_path)?;

    file.seek(std::io::SeekFrom::Start(offset))?;
    file.write_all(data)?;

    Ok(())
}
