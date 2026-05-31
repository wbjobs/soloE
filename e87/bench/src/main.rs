use clap::Parser;
use common::{decode, encode, Key, Request, Response};
use quinn::{ClientConfig, Endpoint};
use rustls::{Certificate, ClientConfig as TlsClientConfig, RootCertStore};
use rustls_pemfile::certs;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tracing::{error, info};

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    #[arg(short, long, default_value = "127.0.0.1:8080")]
    server: String,

    #[arg(long, default_value = "certs/cert.pem")]
    ca_cert: String,

    #[arg(long, default_value_t = 1000)]
    ops_per_sec: u64,

    #[arg(long, default_value_t = 30)]
    duration_secs: u64,

    #[arg(long, default_value_t = 10)]
    connections: usize,

    #[arg(long, default_value_t = 1000)]
    key_pool_size: usize,

    #[arg(long, default_value_t = 64)]
    value_size: usize,

    #[arg(long, default_value = "0.5")]
    read_ratio: f64,
}

struct BenchClient {
    conn: quinn::Connection,
}

impl BenchClient {
    async fn new(server_addr: SocketAddr, ca_cert_path: &str) -> anyhow::Result<Self> {
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

        let client_config = ClientConfig::new(Arc::new(tls_config));
        let mut endpoint = Endpoint::client("0.0.0.0:0".parse()?)?;
        endpoint.set_default_client_config(client_config);

        let conn = endpoint.connect(server_addr, "localhost")?.await?;

        let node_id = generate_node_id();
        let req = Request::Register {
            node_id: node_id.clone(),
            address: format!("127.0.0.1:0"),
        };
        let data = encode(&req)?;
        let (mut send, mut recv) = conn.open_bi().await?;
        send.write_all(&data).await?;
        send.finish().await?;
        let mut buf = Vec::new();
        while let Some(chunk) = recv.read_chunk(usize::MAX, true).await? {
            buf.extend_from_slice(&chunk.bytes);
        }
        let _resp = decode::<Response>(&buf)?;

        Ok(Self { conn })
    }

    async fn send_request(&self, req: &Request) -> anyhow::Result<Response> {
        let data = encode(req)?;
        let (mut send, mut recv) = self.conn.open_bi().await?;
        send.write_all(&data).await?;
        send.finish().await?;

        let mut buf = Vec::new();
        while let Some(chunk) = recv.read_chunk(usize::MAX, true).await? {
            buf.extend_from_slice(&chunk.bytes);
        }
        let resp = decode::<Response>(&buf)?;
        Ok(resp)
    }

    async fn put(&self, key: Key, value: Vec<u8>) -> anyhow::Result<()> {
        let req = Request::Put {
            key,
            value,
            ttl: Some(600),
        };
        self.send_request(&req).await?;
        Ok(())
    }

    async fn get(&self, key: Key) -> anyhow::Result<Response> {
        let req = Request::Get { key };
        Ok(self.send_request(&req).await?)
    }
}

fn generate_node_id() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

fn generate_value(size: usize) -> Vec<u8> {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    (0..size).map(|_| rng.gen::<u8>()).collect()
}

struct Stats {
    ops_started: u64,
    ops_completed: u64,
    ops_success: u64,
    ops_failed: u64,
    read_ops: u64,
    write_ops: u64,
    latencies: Vec<u64>,
}

impl Stats {
    fn new() -> Self {
        Self {
            ops_started: 0,
            ops_completed: 0,
            ops_success: 0,
            ops_failed: 0,
            read_ops: 0,
            write_ops: 0,
            latencies: Vec::new(),
        }
    }

    fn merge(&mut self, other: &Stats) {
        self.ops_started += other.ops_started;
        self.ops_completed += other.ops_completed;
        self.ops_success += other.ops_success;
        self.ops_failed += other.ops_failed;
        self.read_ops += other.read_ops;
        self.write_ops += other.write_ops;
        self.latencies.extend(&other.latencies);
    }
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

    info!(
        "Starting benchmark: {} ops/sec for {}s, {} connections, {} key pool, {}b values, read ratio {}",
        args.ops_per_sec, args.duration_secs, args.connections, args.key_pool_size, args.value_size, args.read_ratio
    );

    let keys: Vec<String> = (0..args.key_pool_size)
        .map(|i| format!("bench_key_{}", i))
        .collect();

    info!("Initializing clients...");
    let mut clients = Vec::with_capacity(args.connections);
    for i in 0..args.connections {
        match BenchClient::new(server_addr, &args.ca_cert).await {
            Ok(c) => clients.push(Arc::new(c)),
            Err(e) => {
                error!("Failed to create client {}: {}", i, e);
            }
        }
    }
    if clients.is_empty() {
        anyhow::bail!("No clients created");
    }
    info!("Created {} clients", clients.len());

    info!("Pre-populating keys...");
    let value = generate_value(args.value_size);
    for key in &keys {
        if let Err(e) = clients[0].put(key.clone(), value.clone()).await {
            error!("Failed to pre-populate key {}: {}", key, e);
        }
    }
    info!("Pre-populated {} keys", keys.len());

    let stats = Arc::new(Mutex::new(Stats::new()));
    let start_time = Instant::now();
    let end_time = start_time + Duration::from_secs(args.duration_secs);

    let interval = Duration::from_micros(1_000_000 / args.ops_per_sec);
    let keys = Arc::new(keys);
    let mut tasks: Vec<JoinHandle<()>> = Vec::new();

    info!("Starting benchmark...");
    for conn_id in 0..args.connections {
        let client = clients[conn_id % clients.len()].clone();
        let keys = keys.clone();
        let stats = stats.clone();
        let interval = interval * args.connections as u32;
        let read_ratio = args.read_ratio;
        let value_size = args.value_size;
        let end_time = end_time;

        let task = tokio::spawn(async move {
            let mut next_tick = Instant::now() + Duration::from_micros(interval.as_micros() as u64 * conn_id as u64);
            let mut local_stats = Stats::new();

            while Instant::now() < end_time {
                let now = Instant::now();
                if now < next_tick {
                    tokio::time::sleep(next_tick - now).await;
                }
                next_tick += interval;

                local_stats.ops_started += 1;

                use rand::Rng;
                let is_read = rand::thread_rng().gen::<f64>() < read_ratio;
                let key_idx = rand::thread_rng().gen_range(0..keys.len());
                let key = keys[key_idx].clone();

                let op_start = Instant::now();
                let result = if is_read {
                    local_stats.read_ops += 1;
                    client.get(key).await
                } else {
                    local_stats.write_ops += 1;
                    let value = generate_value(value_size);
                    client.put(key, value).await.map(|_| Response::Ok)
                };

                let latency = op_start.elapsed().as_micros() as u64;
                local_stats.latencies.push(latency);
                local_stats.ops_completed += 1;

                match result {
                    Ok(Response::Value { .. }) | Ok(Response::Ok) => {
                        local_stats.ops_success += 1;
                    }
                    Ok(Response::KeyNotFound) | Ok(Response::OwnerUnavailable { .. }) => {
                        local_stats.ops_failed += 1;
                        if local_stats.ops_failed <= 5 {
                            error!("Op failed: key not found or unavailable");
                        }
                    }
                    Ok(Response::Error(e)) => {
                        local_stats.ops_failed += 1;
                        if local_stats.ops_failed <= 5 {
                            error!("Op failed: {}", e);
                        }
                    }
                    Ok(_) => {
                        local_stats.ops_success += 1;
                    }
                    Err(e) => {
                        local_stats.ops_failed += 1;
                        if local_stats.ops_failed <= 5 {
                            error!("Op failed: {}", e);
                        }
                    }
                }
            }

            let mut global = stats.lock().await;
            global.merge(&local_stats);
        });
        tasks.push(task);
    }

    let stats_clone = stats.clone();
    tokio::spawn(async move {
        let mut last_completed = 0u64;
        let mut last_time = Instant::now();
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            let s = stats_clone.lock().await;
            let elapsed = last_time.elapsed().as_secs_f64();
            let completed = s.ops_completed - last_completed;
            let throughput = completed as f64 / elapsed;
            info!(
                "Progress: {}/{}s, completed: {}, success: {}, failed: {}, throughput: {:.1} ops/sec",
                last_time.elapsed().as_secs(),
                args.duration_secs,
                s.ops_completed,
                s.ops_success,
                s.ops_failed,
                throughput
            );
            last_completed = s.ops_completed;
            last_time = Instant::now();
        }
    });

    for task in tasks {
        let _ = task.await;
    }

    let elapsed = start_time.elapsed();
    let final_stats = stats.lock().await;

    println!("\n=== Benchmark Results ===");
    println!("Duration: {:.2}s", elapsed.as_secs_f64());
    println!("Total ops started: {}", final_stats.ops_started);
    println!("Total ops completed: {}", final_stats.ops_completed);
    println!("Successful ops: {}", final_stats.ops_success);
    println!("Failed ops: {}", final_stats.ops_failed);
    println!("Read ops: {}", final_stats.read_ops);
    println!("Write ops: {}", final_stats.write_ops);
    println!(
        "Overall throughput: {:.2} ops/sec",
        final_stats.ops_completed as f64 / elapsed.as_secs_f64()
    );
    println!(
        "Success rate: {:.2}%",
        if final_stats.ops_completed > 0 {
            100.0 * final_stats.ops_success as f64 / final_stats.ops_completed as f64
        } else {
            0.0
        }
    );

    if !final_stats.latencies.is_empty() {
        let mut sorted = final_stats.latencies.clone();
        sorted.sort();
        let count = sorted.len();
        println!("\nLatency (microseconds):");
        println!("  Min: {}us", sorted[0]);
        println!("  Max: {}us", sorted[count - 1]);
        println!("  Avg: {:.0}us", sorted.iter().sum::<u64>() as f64 / count as f64);
        println!("  P50: {}us", sorted[count * 50 / 100]);
        println!("  P90: {}us", sorted[count * 90 / 100]);
        println!("  P99: {}us", sorted[(count * 99 / 100).min(count - 1)]);
        println!("  P999: {}us", sorted[(count * 999 / 1000).min(count - 1)]);
    }

    Ok(())
}
