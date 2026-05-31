use clap::Parser;
use common::{
    decode, encode, Address, BlockMetadata, Key, MemoryBlock, NodeId, Request, Response,
    StatsResponse, Version, DEFAULT_TTL,
};
use parking_lot::RwLock;
use quinn::{Endpoint, ServerConfig};
use rustls::{Certificate, PrivateKey, ServerConfig as TlsServerConfig};
use rustls_pemfile::{certs, pkcs8_private_keys};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::mpsc;
use tracing::{debug, error, info, warn};

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    #[arg(short, long, default_value = "0.0.0.0:8080")]
    listen: String,

    #[arg(long, default_value = "certs/cert.pem")]
    cert: String,

    #[arg(long, default_value = "certs/key.pem")]
    key: String,

    #[arg(long, default_value_t = 5)]
    heartbeat_interval: u64,

    #[arg(long, default_value_t = 10)]
    node_timeout: u64,
}

struct NodeInfo {
    address: Address,
    last_seen: u64,
    is_connected: bool,
}

struct CasStats {
    total_ops: u64,
    success_ops: u64,
    conflict_ops: u64,
    per_key_conflicts: HashMap<Key, u64>,
}

impl CasStats {
    fn new() -> Self {
        Self {
            total_ops: 0,
            success_ops: 0,
            conflict_ops: 0,
            per_key_conflicts: HashMap::new(),
        }
    }

    fn record_success(&mut self) {
        self.total_ops += 1;
        self.success_ops += 1;
    }

    fn record_conflict(&mut self, key: &Key) {
        self.total_ops += 1;
        self.conflict_ops += 1;
        *self.per_key_conflicts.entry(key.clone()).or_insert(0) += 1;
    }

    fn conflict_rate(&self) -> f64 {
        if self.total_ops == 0 {
            0.0
        } else {
            self.conflict_ops as f64 / self.total_ops as f64
        }
    }
}

struct CoordinatorState {
    blocks: RwLock<HashMap<Key, MemoryBlock>>,
    nodes: RwLock<HashMap<NodeId, NodeInfo>>,
    cas_stats: RwLock<CasStats>,
    node_timeout: u64,
}

impl CoordinatorState {
    fn new(node_timeout: u64) -> Self {
        Self {
            blocks: RwLock::new(HashMap::new()),
            nodes: RwLock::new(HashMap::new()),
            cas_stats: RwLock::new(CasStats::new()),
            node_timeout,
        }
    }

    fn register_node(&self, node_id: NodeId, address: Address) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        self.nodes.write().insert(
            node_id,
            NodeInfo {
                address,
                last_seen: now,
                is_connected: true,
            },
        );
    }

    fn mark_node_disconnected(&self, node_id: &NodeId) {
        let mut nodes = self.nodes.write();
        if let Some(node) = nodes.get_mut(node_id) {
            node.is_connected = false;
            warn!("Node {} marked as disconnected", node_id);
        }
    }

    fn heartbeat(&self, node_id: &NodeId) -> bool {
        let mut nodes = self.nodes.write();
        if let Some(node) = nodes.get_mut(node_id) {
            node.last_seen = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs();
            node.is_connected = true;
            true
        } else {
            false
        }
    }

    fn is_node_alive(&self, node_id: &NodeId) -> bool {
        let nodes = self.nodes.read();
        if let Some(node) = nodes.get(node_id) {
            if !node.is_connected {
                return false;
            }
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs();
            now - node.last_seen < self.node_timeout
        } else {
            false
        }
    }

    fn get_node_address(&self, node_id: &NodeId) -> Option<Address> {
        let nodes = self.nodes.read();
        nodes.get(node_id).map(|n| n.address.clone())
    }

    fn put_block(&self, key: Key, value: Vec<u8>, owner: NodeId, ttl: Option<u64>) -> Response {
        let ttl = ttl.unwrap_or(DEFAULT_TTL);
        let nodes = self.nodes.read();
        let address = match nodes.get(&owner) {
            Some(node) => node.address.clone(),
            None => return Response::Error("Node not registered".to_string()),
        };
        drop(nodes);

        let mut blocks = self.blocks.write();
        if let Some(block) = blocks.get_mut(&key) {
            if block.owner != owner {
                return Response::Error("Key owned by another node".to_string());
            }
            block.value = value;
            block.version += 1;
            block.ttl = ttl;
            block.refresh_ttl();
        } else {
            let block = MemoryBlock::new(key.clone(), value, owner, address, ttl);
            blocks.insert(key, block);
        }
        Response::Ok
    }

    fn get_block(&self, key: &Key) -> Response {
        let blocks = self.blocks.read();
        let block = match blocks.get(key) {
            Some(b) => b.clone(),
            None => return Response::KeyNotFound,
        };
        drop(blocks);

        if block.is_expired() {
            self.blocks.write().remove(key);
            return Response::KeyNotFound;
        }

        if !self.is_node_alive(&block.owner) {
            warn!(
                "Key {} owner {} is offline, attempting failover",
                key, block.owner
            );
            if let Some(new_block) = self.try_failover_key(key) {
                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_secs();
                let ttl_remaining = new_block.expires_at.saturating_sub(now);
                return Response::Value {
                    key: new_block.key.clone(),
                    value: new_block.value.clone(),
                    version: new_block.version,
                    owner: new_block.owner.clone(),
                    owner_address: new_block.owner_address.clone(),
                    ttl_remaining,
                };
            } else {
                return Response::OwnerUnavailable { key: key.clone() };
            }
        }

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let ttl_remaining = block.expires_at.saturating_sub(now);

        Response::Value {
            key: block.key.clone(),
            value: block.value.clone(),
            version: block.version,
            owner: block.owner.clone(),
            owner_address: block.owner_address.clone(),
            ttl_remaining,
        }
    }

    fn try_failover_key(&self, key: &Key) -> Option<MemoryBlock> {
        let alive_nodes: Vec<(NodeId, Address)> = self
            .nodes
            .read()
            .iter()
            .filter(|(_, info)| {
                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_secs();
                info.is_connected && now - info.last_seen < self.node_timeout
            })
            .map(|(id, info)| (id.clone(), info.address.clone()))
            .collect();

        if alive_nodes.is_empty() {
            warn!("No alive nodes available for failover of key {}", key);
            return None;
        }

        let mut blocks = self.blocks.write();
        let block = blocks.get_mut(key)?;

        if self.is_node_alive(&block.owner) {
            return Some(block.clone());
        }

        let mut rng = rand::thread_rng();
        let idx = rand::Rng::gen_range(&mut rng, 0..alive_nodes.len());
        let (new_owner, new_address) = alive_nodes[idx].clone();

        info!(
            "Failing over key {} from {} to {}",
            key, block.owner, new_owner
        );
        block.owner = new_owner;
        block.owner_address = new_address;
        block.version += 1;

        Some(block.clone())
    }

    fn update_block(
        &self,
        key: Key,
        value: Vec<u8>,
        version: Version,
        requester: NodeId,
    ) -> Response {
        let mut blocks = self.blocks.write();
        let block = match blocks.get_mut(&key) {
            Some(b) => b,
            None => return Response::KeyNotFound,
        };

        if block.is_expired() {
            blocks.remove(&key);
            return Response::KeyNotFound;
        }

        if block.version != version {
            return Response::VersionMismatch {
                current_version: block.version,
            };
        }

        if block.owner != requester {
            return Response::Error("Not the owner of this key".to_string());
        }

        block.value = value;
        block.version += 1;
        block.refresh_ttl();
        Response::Ok
    }

    fn compare_and_swap(
        &self,
        key: Key,
        value: Vec<u8>,
        expected_version: Version,
        new_ttl: Option<u64>,
        requester: NodeId,
    ) -> Response {
        let mut blocks = self.blocks.write();
        let block = match blocks.get_mut(&key) {
            Some(b) => b,
            None => {
                self.cas_stats.write().record_conflict(&key);
                return Response::KeyNotFound;
            }
        };

        if block.is_expired() {
            blocks.remove(&key);
            self.cas_stats.write().record_conflict(&key);
            return Response::KeyNotFound;
        }

        if block.owner != requester {
            self.cas_stats.write().record_conflict(&key);
            return Response::Error("Not the owner of this key".to_string());
        }

        if block.version != expected_version {
            let current_version = block.version;
            self.cas_stats.write().record_conflict(&key);
            warn!(
                "CAS conflict for key {}: expected={}, current={}",
                key, expected_version, current_version
            );
            return Response::CasConflict {
                key,
                expected_version,
                current_version,
            };
        }

        block.value = value;
        block.version += 1;
        if let Some(ttl) = new_ttl {
            block.ttl = ttl;
        }
        block.refresh_ttl();

        let new_version = block.version;
        self.cas_stats.write().record_success();
        debug!(
            "CAS success for key {}: version {} -> {}",
            key, expected_version, new_version
        );

        Response::CasSuccess { key, new_version }
    }

    fn get_stats(&self) -> StatsResponse {
        let blocks = self.blocks.read();
        let nodes = self.nodes.read();
        let stats = self.cas_stats.read();

        let mut per_key_conflicts: Vec<(Key, u64)> = stats
            .per_key_conflicts
            .iter()
            .map(|(k, v)| (k.clone(), *v))
            .collect();
        per_key_conflicts.sort_by(|a, b| b.1.cmp(&a.1));
        let top_conflicted_keys = per_key_conflicts.iter().take(10).cloned().collect();

        StatsResponse {
            total_blocks: blocks.len() as u64,
            total_nodes: nodes.len() as u64,
            total_cas_operations: stats.total_ops,
            total_cas_success: stats.success_ops,
            total_cas_conflicts: stats.conflict_ops,
            cas_conflict_rate: stats.conflict_rate(),
            per_key_conflicts: stats.per_key_conflicts.clone(),
            top_conflicted_keys,
        }
    }

    fn delete_block(&self, key: &Key, requester: NodeId) -> Response {
        let mut blocks = self.blocks.write();
        let block = match blocks.get(key) {
            Some(b) => b,
            None => return Response::KeyNotFound,
        };

        if block.owner != requester {
            return Response::Error("Not the owner of this key".to_string());
        }

        blocks.remove(key);
        Response::Ok
    }

    fn list_keys(&self) -> Response {
        let blocks = self.blocks.read();
        let keys: Vec<Key> = blocks
            .iter()
            .filter(|(_, b)| !b.is_expired())
            .map(|(k, _)| k.clone())
            .collect();
        Response::KeyList(keys)
    }

    fn failover_dead_nodes(&self) -> Vec<Key> {
        let mut reallocated = Vec::new();
        let alive_nodes: Vec<(NodeId, Address)> = self
            .nodes
            .read()
            .iter()
            .filter(|(_, info)| {
                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_secs();
                now - info.last_seen < self.node_timeout
            })
            .map(|(id, info)| (id.clone(), info.address.clone()))
            .collect();

        if alive_nodes.is_empty() {
            return reallocated;
        }

        let mut blocks = self.blocks.write();
        let mut rng = rand::thread_rng();
        let dead_keys: Vec<Key> = blocks
            .iter()
            .filter(|(_, b)| !self.is_node_alive(&b.owner) || b.is_expired())
            .map(|(k, _)| k.clone())
            .collect();

        for key in dead_keys {
            if let Some(block) = blocks.get_mut(&key) {
                if block.is_expired() {
                    blocks.remove(&key);
                    continue;
                }
                let idx = rand::Rng::gen_range(&mut rng, 0..alive_nodes.len());
                let (new_owner, new_address) = alive_nodes[idx].clone();
                block.owner = new_owner;
                block.owner_address = new_address;
                block.version += 1;
                reallocated.push(key);
            }
        }

        reallocated
    }

    fn get_metadata(&self) -> Vec<BlockMetadata> {
        let blocks = self.blocks.read();
        blocks
            .iter()
            .filter(|(_, b)| !b.is_expired())
            .map(|(_, b)| b.into())
            .collect()
    }
}

fn load_certs(path: &str) -> std::io::Result<Vec<Certificate>> {
    let certs = certs(&mut std::io::BufReader::new(std::fs::File::open(path)?))
        .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidInput, "invalid cert"))?
        .into_iter()
        .map(Certificate)
        .collect();
    Ok(certs)
}

fn load_keys(path: &str) -> std::io::Result<Vec<PrivateKey>> {
    let keys = pkcs8_private_keys(&mut std::io::BufReader::new(std::fs::File::open(path)?))
        .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidInput, "invalid key"))?
        .into_iter()
        .map(PrivateKey)
        .collect();
    Ok(keys)
}

fn configure_server(cert_path: &str, key_path: &str) -> anyhow::Result<ServerConfig> {
    let certs = load_certs(cert_path)?;
    let mut keys = load_keys(key_path)?;
    if keys.is_empty() {
        anyhow::bail!("No private keys found");
    }

    let mut tls_config = TlsServerConfig::builder()
        .with_safe_defaults()
        .with_no_client_auth()
        .with_single_cert(certs, keys.remove(0))?;

    tls_config.max_early_data_size = u32::MAX;
    tls_config.alpn_protocols = vec![b"quic-mem-coord/1.0".to_vec()];

    let mut server_config = ServerConfig::with_crypto(Arc::new(tls_config));
    server_config.transport = Arc::new(get_transport_config());
    Ok(server_config)
}

fn get_transport_config() -> quinn::TransportConfig {
    let mut config = quinn::TransportConfig::default();
    config.max_idle_timeout(Some(Duration::from_secs(60).try_into().unwrap()));
    config.keep_alive_interval(Some(Duration::from_secs(10)));
    config
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,coordinator=debug".into()),
        )
        .init();

    let args = Args::parse();
    let state = Arc::new(CoordinatorState::new(args.node_timeout));

    let server_config = configure_server(&args.cert, &args.key)?;
    let addr: SocketAddr = args.listen.parse()?;
    let (server, _) = Endpoint::server(server_config, addr)?;
    info!("Coordinator listening on {}", addr);

    let state_clone = state.clone();
    tokio::spawn(async move {
        let mut interval =
            tokio::time::interval(Duration::from_secs(args.heartbeat_interval));
        loop {
            interval.tick().await;
            let reallocated = state_clone.failover_dead_nodes();
            if !reallocated.is_empty() {
                info!("Failover completed, reallocated {} keys", reallocated.len());
                for key in reallocated {
                    debug!("Reallocated key: {}", key);
                }
            }
        }
    });

    while let Some(conn) = server.accept().await {
        let state = state.clone();
        tokio::spawn(async move {
            if let Err(e) = handle_connection(conn, state).await {
                error!("Connection error: {}", e);
            }
        });
    }

    Ok(())
}

async fn handle_connection(
    conn: quinn::Connecting,
    state: Arc<CoordinatorState>,
) -> anyhow::Result<()> {
    let conn = conn.await?;
    let peer_addr = conn.remote_address();
    debug!("New connection from {}", peer_addr);

    let connection = Arc::new(conn);
    let node_id: Arc<RwLock<Option<NodeId>>> = Arc::new(RwLock::new(None));
    let node_id_clone = node_id.clone();
    let state_clone = state.clone();
    let conn_clone = connection.clone();

    tokio::spawn(async move {
        conn_clone.closed().await;
        debug!("Connection closed for peer {}", peer_addr);
        if let Some(id) = node_id_clone.read().as_ref() {
            state_clone.mark_node_disconnected(id);
            info!("Node {} disconnected due to connection close", id);
        }
    });

    while let Ok(Some((mut send, mut recv))) = connection.accept_bi().await {
        let state = state.clone();
        let node_id = node_id.clone();
        tokio::spawn(async move {
            let mut buf = Vec::new();
            while let Ok(Some(chunk)) = recv.read_chunk(usize::MAX, true).await {
                buf.extend_from_slice(&chunk.bytes);
            }
            if buf.is_empty() {
                return;
            }
            match decode::<Request>(&buf) {
                Ok(req) => {
                    let resp = handle_request(req, state, &node_id);
                    if let Ok(data) = encode(&resp) {
                        let _ = send.write_all(&data).await;
                        let _ = send.finish().await;
                    }
                }
                Err(e) => {
                    warn!("Invalid request: {}", e);
                    let resp = Response::Error(format!("Invalid request: {}", e));
                    if let Ok(data) = encode(&resp) {
                        let _ = send.write_all(&data).await;
                        let _ = send.finish().await;
                    }
                }
            }
        });
    }

    Ok(())
}

fn handle_request(
    req: Request,
    state: Arc<CoordinatorState>,
    conn_node_id: &RwLock<Option<NodeId>>,
) -> Response {
    match req {
        Request::Register { node_id, address } => {
            info!("Registering node: {} at {}", node_id, address);
            state.register_node(node_id.clone(), address);
            *conn_node_id.write() = Some(node_id);
            Response::Registered
        }
        Request::Put { key, value, ttl } => {
            let owner = match conn_node_id.read().clone() {
                Some(id) => id,
                None => return Response::Error("Not registered".to_string()),
            };
            state.put_block(key, value, owner, ttl)
        }
        Request::Get { key } => state.get_block(&key),
        Request::Update {
            key,
            value,
            version,
        } => {
            let requester = match conn_node_id.read().clone() {
                Some(id) => id,
                None => return Response::Error("Not registered".to_string()),
            };
            state.update_block(key, value, version, requester)
        }
        Request::CompareAndSwap {
            key,
            value,
            expected_version,
            new_ttl,
        } => {
            let requester = match conn_node_id.read().clone() {
                Some(id) => id,
                None => return Response::Error("Not registered".to_string()),
            };
            state.compare_and_swap(key, value, expected_version, new_ttl, requester)
        }
        Request::Delete { key } => {
            let requester = match conn_node_id.read().clone() {
                Some(id) => id,
                None => return Response::Error("Not registered".to_string()),
            };
            state.delete_block(&key, requester)
        }
        Request::ListKeys => state.list_keys(),
        Request::Heartbeat { node_id } => {
            if state.heartbeat(&node_id) {
                Response::HeartbeatAck
            } else {
                Response::Error("Node not registered".to_string())
            }
        }
        Request::GetStats => Response::Stats(state.get_stats()),
    }
}
