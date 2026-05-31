use serde::{Deserialize, Serialize};
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferSession {
    pub session_id: String,
    pub file_id: String,
    pub peer_id: String,
    pub total_chunks: u32,
    pub transferred_chunks: u32,
    pub start_time: u64,
    pub last_update: u64,
    pub bytes_transferred: u64,
}

pub struct TransferState {
    sessions: Mutex<Vec<TransferSession>>,
}

impl Default for TransferState {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(Vec::new()),
        }
    }
}
