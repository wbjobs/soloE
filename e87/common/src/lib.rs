use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

pub const DEFAULT_TTL: u64 = 300;

pub type Key = String;
pub type Value = Vec<u8>;
pub type Version = u64;
pub type NodeId = String;
pub type Address = String;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryBlock {
    pub key: Key,
    pub value: Value,
    pub version: Version,
    pub owner: NodeId,
    pub owner_address: Address,
    pub ttl: u64,
    pub expires_at: u64,
}

impl MemoryBlock {
    pub fn new(
        key: Key, value: Value, owner: NodeId, owner_address: Address, ttl: u64) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        Self {
            key,
            value,
            version: 1,
            owner,
            owner_address,
            ttl,
            expires_at: now + ttl,
        }
    }

    pub fn is_expired(&self) -> bool {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        now >= self.expires_at
    }

    pub fn refresh_ttl(&mut self) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        self.expires_at = now + self.ttl;
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Request {
    Register {
        node_id: NodeId,
        address: Address,
    },
    Put {
        key: Key,
        value: Value,
        ttl: Option<u64>,
    },
    Get {
        key: Key,
    },
    Update {
        key: Key,
        value: Value,
        version: Version,
    },
    CompareAndSwap {
        key: Key,
        value: Value,
        expected_version: Version,
        new_ttl: Option<u64>,
    },
    Delete {
        key: Key,
    },
    ListKeys,
    Heartbeat {
        node_id: NodeId,
    },
    GetStats,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Response {
    Ok,
    Value {
        key: Key,
        value: Value,
        version: Version,
        owner: NodeId,
        owner_address: Address,
        ttl_remaining: u64,
    },
    KeyNotFound,
    KeyList(Vec<Key>),
    Registered,
    HeartbeatAck,
    VersionMismatch {
        current_version: Version,
    },
    CasSuccess {
        key: Key,
        new_version: Version,
    },
    CasConflict {
        key: Key,
        expected_version: Version,
        current_version: Version,
    },
    OwnerUnavailable {
        key: Key,
    },
    Stats(StatsResponse),
    Error(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatsResponse {
    pub total_blocks: u64,
    pub total_nodes: u64,
    pub total_cas_operations: u64,
    pub total_cas_success: u64,
    pub total_cas_conflicts: u64,
    pub cas_conflict_rate: f64,
    pub per_key_conflicts: HashMap<Key, u64>,
    pub top_conflicted_keys: Vec<(Key, u64)>,
}

impl Default for StatsResponse {
    fn default() -> Self {
        Self {
            total_blocks: 0,
            total_nodes: 0,
            total_cas_operations: 0,
            total_cas_success: 0,
            total_cas_conflicts: 0,
            cas_conflict_rate: 0.0,
            per_key_conflicts: HashMap::new(),
            top_conflicted_keys: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockMetadata {
    pub key: Key,
    pub version: Version,
    pub owner: NodeId,
    pub owner_address: Address,
    pub ttl: u64,
    pub expires_at: u64,
}

impl From<&MemoryBlock> for BlockMetadata {
    fn from(block: &MemoryBlock) -> Self {
        Self {
            key: block.key.clone(),
            version: block.version,
            owner: block.owner.clone(),
            owner_address: block.owner_address.clone(),
            ttl: block.ttl,
            expires_at: block.expires_at,
        }
    }
}

pub fn encode(msg: &impl Serialize) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    Ok(serde_json::to_vec(msg)?)
}

pub fn decode<'a, T: Deserialize<'a>>(data: &'a [u8]) -> Result<T, Box<dyn std::error::Error>> {
    Ok(serde_json::from_slice(data)?)
}
