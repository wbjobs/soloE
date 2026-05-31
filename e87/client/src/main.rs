use clap::{Parser, Subcommand};
use common::{decode, encode, Address, Key, NodeId, Request, Response, StatsResponse, Version};
use parking_lot::RwLock;
use quinn::{ClientConfig, Endpoint, ServerConfig};
use rustls::{
    Certificate, ClientConfig as TlsClientConfig, PrivateKey, RootCertStore,
    ServerConfig as TlsServerConfig,
};
use rustls_pemfile::{certs, pkcs8_private_keys};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tracing::{debug, error, info, warn};

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    #[arg(short, long, default_value = "127.0.0.1:8080")]
    server: String,

    #[arg(long, default_value = "certs/cert.pem")]
    ca_cert: String,

    #[arg(long)]
    node_id: Option<String>,

    #[arg(long)]
    listen: Option<String>,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    Register {
        #[arg(long)]
        address: String,
    },
    Put {
        key: String,
        value: String,
        #[arg(long)]
        ttl: Option<u64>,
    },
    Get {
        key: String,
        #[arg(long, default_value_t = 3)]
        max_retries: u32,
    },
    GetDirect {
        key: String,
        #[arg(long, default_value_t = 3)]
        max_retries: u32,
    },
    Update {
        key: String,
        value: String,
        #[arg(long)]
        version: u64,
    },
    Cas {
        key: String,
        value: String,
        #[arg(long)]
        expected_version: u64,
        #[arg(long)]
        ttl: Option<u64>,
    },
    Delete {
        key: String,
    },
    List,
    Stats,
    Daemon {
        #[arg(long)]
        address: String,
    },
}

struct BlockCacheEntry {
    value: Vec<u8>,
    version: Version,
    owner: NodeId,
    owner_address: Address,
    cached_at: u64,
}

struct QuicClient {
    endpoint: Endpoint,
    server_addr: SocketAddr,
    server_name: String,
    coordinator_conn: Option<quinn::Connection>,
    p2p_connections: RwLock<HashMap<Address, quinn::Connection>>,
    cache: RwLock<HashMap<Key, BlockCacheEntry>>,
    node_id: NodeId,
    tls_config: Arc<TlsClientConfig>,
}

impl QuicClient {
    async fn new(
        server_addr: SocketAddr,
        ca_cert_path: &str,
        server_name: &str,
        node_id: NodeId,
    ) -> anyhow::Result<Self> {
        let mut root_store = RootCertStore::empty();
        let certs = certs(&mut std::io::BufReader::new(std::fs::File::open(ca_cert_path)?))?;
        for cert in certs {
            root_store.add(&Certificate(cert))?;
        }

        let mut tls_config = TlsClientConfig::builder()
            .with_safe_defaults()
            .with_root_certificates(root_store)
            .with_no_client_auth();

        tls_config.max_early_data_size = u32::MAX;
        tls_config.alpn_protocols = vec![b"quic-mem-coord/1.0".to_vec()];

        let tls_config_arc = Arc::new(tls_config);
        let client_config = ClientConfig::new(tls_config_arc.clone());
        let mut endpoint = Endpoint::client("0.0.0.0:0".parse()?)?;
        endpoint.set_default_client_config(client_config);

        Ok(Self {
            endpoint,
            server_addr,
            server_name: server_name.to_string(),
            coordinator_conn: None,
            p2p_connections: RwLock::new(HashMap::new()),
            cache: RwLock::new(HashMap::new()),
            node_id,
            tls_config: tls_config_arc,
        })
    }

    async fn connect_coordinator(&mut self) -> anyhow::Result<()> {
        debug!("Connecting to coordinator {} (SNI: {})", self.server_addr, self.server_name);
        let conn = self
            .endpoint
            .connect(self.server_addr, &self.server_name)?
            .await?;
        self.coordinator_conn = Some(conn);
        info!("Connected to coordinator");
        Ok(())
    }

    async fn get_or_create_p2p_connection(
        &self,
        address: &str,
    ) -> anyhow::Result<quinn::Connection> {
        if let Some(conn) = self.p2p_connections.read().get(address) {
            if conn.close_reason().is_none() {
                return Ok(conn.clone());
            }
        }

        let addr: SocketAddr = address.parse()?;
        debug!("Creating new P2P connection to {}", addr);

        let client_config = ClientConfig::new(self.tls_config.clone());
        let conn = self
            .endpoint
            .connect_with(client_config, addr, "localhost")?
            .await?;

        self.p2p_connections
            .write()
            .insert(address.to_string(), conn.clone());
        Ok(conn)
    }

    async fn send_to_coordinator(&mut self, req: &Request) -> anyhow::Result<Response> {
        if self.coordinator_conn.is_none() {
            self.connect_coordinator().await?;
        }
        let conn = self.coordinator_conn.as_ref().unwrap();
        Self::send_request(conn, req).await
    }

    async fn send_request(conn: &quinn::Connection, req: &Request) -> anyhow::Result<Response> {
        let data = encode(req)?;
        let (mut send, mut recv) = conn.open_bi().await?;
        send.write_all(&data).await?;
        send.finish().await?;

        let mut buf = Vec::new();
        while let Some(chunk) = recv.read_chunk(usize::MAX, true).await? {
            buf.extend_from_slice(&chunk.bytes);
        }
        let resp = decode::<Response>(&buf)?;
        Ok(resp)
    }

    async fn compare_and_swap(
        &mut self,
        key: String,
        value: Vec<u8>,
        expected_version: Version,
        new_ttl: Option<u64>,
    ) -> anyhow::Result<Response> {
        let req = Request::CompareAndSwap {
            key,
            value,
            expected_version,
            new_ttl,
        };
        self.send_to_coordinator(&req).await
    }

    async fn get_stats(&mut self) -> anyhow::Result<StatsResponse> {
        let resp = self.send_to_coordinator(&Request::GetStats).await?;
        match resp {
            Response::Stats(stats) => Ok(stats),
            Response::Error(e) => Err(anyhow::anyhow!(e)),
            other => Err(anyhow::anyhow!("Unexpected response: {:?}", other)),
        }
    }

    async fn get_with_redirect(&mut self, key: &str, max_retries: u32) -> anyhow::Result<Response> {
        let mut attempts = 0;
        loop {
            attempts += 1;
            let resp = self.send_to_coordinator(&Request::Get { key: key.to_string() }).await?;

            match resp {
                Response::Value { .. } => {
                    if let Response::Value {
                        ref key,
                        ref value,
                        version,
                        ref owner,
                        ref owner_address,
                        ..
                    } = resp
                    {
                        let now = SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .unwrap()
                            .as_secs();
                        self.cache.write().insert(
                            key.clone(),
                            BlockCacheEntry {
                                value: value.clone(),
                                version,
                                owner: owner.clone(),
                                owner_address: owner_address.clone(),
                                cached_at: now,
                            },
                        );
                    }
                    return Ok(resp);
                }
                Response::OwnerUnavailable { .. } => {
                    if attempts > max_retries {
                        return Ok(resp);
                    }
                    warn!(
                        "Owner unavailable for key {}, attempt {}/{}, retrying...",
                        key, attempts, max_retries
                    );
                    tokio::time::sleep(Duration::from_millis(100 * attempts as u64)).await;
                }
                _ => return Ok(resp),
            }
        }
    }

    async fn get_direct_with_redirect(
        &mut self,
        key: &str,
        max_retries: u32,
    ) -> anyhow::Result<Response> {
        let mut attempts = 0;
        loop {
            attempts += 1;

            let cached = self.cache.read().get(key).cloned();

            if let Some(cache_entry) = cached {
                debug!("Trying direct P2P access to {} for key {}", cache_entry.owner_address, key);
                match self.get_or_create_p2p_connection(&cache_entry.owner_address).await {
                    Ok(conn) => {
                        match Self::send_request(&conn, &Request::Get { key: key.to_string() }).await {
                            Ok(Response::Value { .. }) => {
                                return Ok(Response::Value {
                                    key: key.to_string(),
                                    value: cache_entry.value,
                                    version: cache_entry.version,
                                    owner: cache_entry.owner,
                                    owner_address: cache_entry.owner_address,
                                    ttl_remaining: 0,
                                });
                            }
                            Ok(Response::KeyNotFound) => {
                                debug!("P2P key not found, falling back to coordinator");
                            }
                            Err(e) => {
                                warn!(
                                    "P2P connection to {} failed: {}, falling back to coordinator",
                                    cache_entry.owner_address, e
                                );
                                self.p2p_connections.write().remove(&cache_entry.owner_address);
                            }
                            Ok(other) => {
                                debug!("P2P returned unexpected response: {:?}", other);
                            }
                        }
                    }
                    Err(e) => {
                        warn!("Failed to connect to {}: {}", cache_entry.owner_address, e);
                        self.p2p_connections.write().remove(&cache_entry.owner_address);
                    }
                }
            }

            let resp = self.get_with_redirect(key, max_retries).await?;

            if let Response::OwnerUnavailable { .. } = resp {
                if attempts > max_retries {
                    return Ok(resp);
                }
                tokio::time::sleep(Duration::from_millis(200 * attempts as u64)).await;
                continue;
            }

            return Ok(resp);
        }
    }

    async fn close(&mut self) {
        if let Some(conn) = self.coordinator_conn.take() {
            conn.close(0u32.into(), b"client closing");
        }
        for (_, conn) in self.p2p_connections.write().drain() {
            conn.close(0u32.into(), b"client closing");
        }
        self.endpoint.wait_idle().await;
    }
}

fn generate_node_id() -> NodeId {
    use rand::RngCore;
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .init();

    let args = Args::parse();
    let server_addr: SocketAddr = args.server.parse()?;
    let node_id = args.node_id.unwrap_or_else(generate_node_id);

    let mut client = QuicClient::new(server_addr, &args.ca_cert, "localhost", node_id.clone()).await?;

    match args.command {
        Commands::Register { address } => {
            let resp = client
                .send_to_coordinator(&Request::Register {
                    node_id: node_id.clone(),
                    address,
                })
                .await?;
            match resp {
                Response::Registered => {
                    info!("Registered successfully as {}", node_id);
                }
                Response::Error(e) => {
                    error!("Registration failed: {}", e);
                    std::process::exit(1);
                }
                _ => {
                    warn!("Unexpected response: {:?}", resp);
                }
            }
        }
        Commands::Put { key, value, ttl } => {
            let resp = client
                .send_to_coordinator(&Request::Put {
                    key,
                    value: value.into_bytes(),
                    ttl,
                })
                .await?;
            match resp {
                Response::Ok => {
                    info!("Put successful");
                }
                Response::Error(e) => {
                    error!("Put failed: {}", e);
                    std::process::exit(1);
                }
                _ => {
                    warn!("Unexpected response: {:?}", resp);
                }
            }
        }
        Commands::Get { key, max_retries } => {
            let resp = client.get_with_redirect(&key, max_retries).await?;
            handle_get_response(resp);
        }
        Commands::GetDirect { key, max_retries } => {
            let resp = client.get_direct_with_redirect(&key, max_retries).await?;
            handle_get_response(resp);
        }
        Commands::Update {
            key,
            value,
            version,
        } => {
            let resp = client
                .send_to_coordinator(&Request::Update {
                    key,
                    value: value.into_bytes(),
                    version,
                })
                .await?;
            match resp {
                Response::Ok => {
                    info!("Update successful");
                }
                Response::VersionMismatch { current_version } => {
                    error!("Version mismatch. Current version: {}", current_version);
                    std::process::exit(1);
                }
                Response::KeyNotFound => {
                    error!("Key not found");
                    std::process::exit(1);
                }
                Response::Error(e) => {
                    error!("Update failed: {}", e);
                    std::process::exit(1);
                }
                _ => {
                    warn!("Unexpected response: {:?}", resp);
                }
            }
        }
        Commands::Cas {
            key,
            value,
            expected_version,
            ttl,
        } => {
            let resp = client
                .compare_and_swap(key.clone(), value.into_bytes(), expected_version, ttl)
                .await?;
            match resp {
                Response::CasSuccess { key, new_version } => {
                    println!("CAS success for key '{}'", key);
                    println!("New version: {}", new_version);
                }
                Response::CasConflict {
                    key,
                    expected_version,
                    current_version,
                } => {
                    error!(
                        "CAS conflict for key '{}': expected version {}, current version {}",
                        key, expected_version, current_version
                    );
                    std::process::exit(1);
                }
                Response::KeyNotFound => {
                    error!("Key not found");
                    std::process::exit(1);
                }
                Response::Error(e) => {
                    error!("CAS failed: {}", e);
                    std::process::exit(1);
                }
                _ => {
                    warn!("Unexpected response: {:?}", resp);
                }
            }
        }
        Commands::Delete { key } => {
            let resp = client
                .send_to_coordinator(&Request::Delete { key })
                .await?;
            match resp {
                Response::Ok => {
                    info!("Delete successful");
                }
                Response::KeyNotFound => {
                    println!("Key not found");
                    std::process::exit(1);
                }
                Response::Error(e) => {
                    error!("Delete failed: {}", e);
                    std::process::exit(1);
                }
                _ => {
                    warn!("Unexpected response: {:?}", resp);
                }
            }
        }
        Commands::List => {
            let resp = client.send_to_coordinator(&Request::ListKeys).await?;
            match resp {
                Response::KeyList(keys) => {
                    if keys.is_empty() {
                        println!("No keys found");
                    } else {
                        println!("Keys:");
                        for key in keys {
                            println!("  - {}", key);
                        }
                    }
                }
                Response::Error(e) => {
                    error!("List failed: {}", e);
                    std::process::exit(1);
                }
                _ => {
                    warn!("Unexpected response: {:?}", resp);
                }
            }
        }
        Commands::Stats => {
            let stats = client.get_stats().await?;
            print_stats(&stats);
        }
        Commands::Daemon { address } => {
            info!("Starting daemon mode, node_id: {}", node_id);
            let resp = client
                .send_to_coordinator(&Request::Register {
                    node_id: node_id.clone(),
                    address: address.clone(),
                })
                .await?;
            if !matches!(resp, Response::Registered) {
                error!("Registration failed: {:?}", resp);
                std::process::exit(1);
            }
            info!("Registered successfully as {}", node_id);

            loop {
                let req = Request::Heartbeat {
                    node_id: node_id.clone(),
                };
                match client.send_to_coordinator(&req).await {
                    Ok(Response::HeartbeatAck) => {
                        debug!("Heartbeat ack received");
                    }
                    Ok(resp) => {
                        warn!("Unexpected heartbeat response: {:?}", resp);
                    }
                    Err(e) => {
                        error!("Heartbeat error: {}", e);
                        if client.connect_coordinator().await.is_err() {
                            error!("Failed to reconnect, exiting");
                            break;
                        }
                    }
                }
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
        }
    }

    client.close().await;
    Ok(())
}

fn handle_get_response(resp: Response) {
    match resp {
        Response::Value {
            key,
            value,
            version,
            owner,
            owner_address,
            ttl_remaining,
        } => {
            println!("Key: {}", key);
            println!("Value: {}", String::from_utf8_lossy(&value));
            println!("Version: {}", version);
            println!("Owner: {}", owner);
            println!("Owner Address: {}", owner_address);
            println!("TTL Remaining: {}s", ttl_remaining);
        }
        Response::KeyNotFound => {
            println!("Key not found");
            std::process::exit(1);
        }
        Response::OwnerUnavailable { key } => {
            error!("Owner for key '{}' is unavailable and no failover target exists", key);
            std::process::exit(1);
        }
        Response::Error(e) => {
            error!("Get failed: {}", e);
            std::process::exit(1);
        }
        _ => {
            warn!("Unexpected response: {:?}", resp);
        }
    }
}

fn print_stats(stats: &StatsResponse) {
    println!("=== Coordinator Statistics ===");
    println!("Total blocks: {}", stats.total_blocks);
    println!("Total nodes: {}", stats.total_nodes);
    println!();
    println!("=== CAS Operations ===");
    println!("Total CAS operations: {}", stats.total_cas_operations);
    println!("Successful: {}", stats.total_cas_success);
    println!("Conflicts: {}", stats.total_cas_conflicts);
    println!("Conflict rate: {:.2}%", stats.cas_conflict_rate * 100.0);
    println!();
    if !stats.top_conflicted_keys.is_empty() {
        println!("=== Top 10 Conflicted Keys ===");
        for (i, (key, count)) in stats.top_conflicted_keys.iter().enumerate() {
            println!("  {}. {}: {} conflicts", i + 1, key, count);
        }
    }
}
