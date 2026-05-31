use clap::{Parser, Subcommand};
use indicatif::{ProgressBar, ProgressStyle};
use rudp::{dial, dial_with_ticket, listen, Connection, ConnectionState, SessionTicket};
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Write};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use bytes::Bytes;

#[derive(Parser)]
#[command(name = "rudp")]
#[command(about = "Reliable UDP protocol implementation with QUIC-like features")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    Server {
        #[arg(short, long, default_value = "127.0.0.1:8080")]
        addr: SocketAddr,

        #[arg(short, long)]
        tcp: bool,
    },

    Client {
        #[arg(short, long, default_value = "127.0.0.1:8080")]
        addr: SocketAddr,

        #[arg(short, long)]
        tcp: bool,

        #[command(subcommand)]
        action: ClientAction,
    },

    Benchmark {
        #[arg(short, long, default_value = "127.0.0.1:8080")]
        addr: SocketAddr,

        #[arg(short, long, default_value_t = 10)]
        seconds: u64,

        #[arg(short, long)]
        tcp: bool,
    },

    SendFiles {
        #[arg(short, long, default_value = "127.0.0.1:8080")]
        addr: SocketAddr,

        #[arg(short, long, num_args = 1.., required = true)]
        files: Vec<PathBuf>,
    },

    SessionResume {
        #[arg(short, long, default_value = "127.0.0.1:8080")]
        addr: SocketAddr,

        #[arg(short, long)]
        ticket: String,

        #[arg(short, long)]
        data: Option<PathBuf>,
    },

    Stats {
        #[arg(short, long, default_value = "127.0.0.1:8080")]
        addr: SocketAddr,

        #[arg(short, long, default_value_t = 5)]
        seconds: u64,
    },

    Migrate {
        #[arg(short, long, default_value = "127.0.0.1:8080")]
        addr: SocketAddr,

        #[arg(short, long)]
        new_addr: SocketAddr,
    },
}

#[derive(Subcommand)]
enum ClientAction {
    Send {
        #[arg(short, long)]
        file: String,
    },
    Receive {
        #[arg(short, long)]
        output: String,
    },
}

async fn run_rudp_server(addr: SocketAddr) -> anyhow::Result<()> {
    println!("RUDP Server listening on {}", addr);
    let mut listener = listen(addr).await?;

    while let Some(mut conn) = listener.recv().await {
        conn.wait_ack().await?;
        println!("New connection from {:?}", conn.active_path);

        tokio::spawn(async move {
            if let Err(e) = handle_rudp_connection(&mut conn).await {
                eprintln!("Connection error: {}", e);
            }
        });
    }

    Ok(())
}

async fn handle_rudp_connection(conn: &mut Connection) -> anyhow::Result<()> {
    let mut stream_buffers: HashMap<u32, Vec<u8>> = HashMap::new();

    while conn.state() == ConnectionState::Established {
        let data = conn.recv_any_stream().await?;

        for (stream_id, chunk) in data {
            println!("流 {} 收到 {} 字节", stream_id, chunk.len());
        }

        tokio::time::sleep(Duration::from_millis(10)).await;
    }

    Ok(())
}

async fn run_tcp_server(addr: SocketAddr) -> anyhow::Result<()> {
    println!("TCP Server listening on {}", addr);
    let listener = TcpListener::bind(addr).await?;

    while let Ok((mut socket, _)) = listener.accept().await {
        tokio::spawn(async move {
            let mut buf = vec![0u8; 65536];
            loop {
                match socket.read(&mut buf).await {
                    Ok(0) => break,
                    Ok(n) => {
                        let _ = socket.write_all(&buf[..n]).await;
                    }
                    Err(_) => break,
                }
            }
        });
    }

    Ok(())
}

async fn send_multiple_files(addr: SocketAddr, files: Vec<PathBuf>) -> anyhow::Result<()> {
    println!("连接到服务器: {}", addr);
    let mut conn = dial(addr).await?;
    println!("连接成功！");

    let mut file_streams = Vec::new();

    for (i, file_path) in files.iter().enumerate() {
        let stream_id = conn.create_stream().unwrap_or(i as u32);
        let mut f = File::open(file_path)?;
        let metadata = f.metadata()?;
        let file_size = metadata.len();

        println!("流 {}: 发送文件 {:?} ({} 字节)", stream_id, file_path, file_size);

        let mut buffer = Vec::new();
        f.read_to_end(&mut buffer)?;

        conn.send_to_stream(stream_id, &buffer).await?;
        file_streams.push((stream_id, file_path.clone(), file_size));
    }

    println!("正在发送数据...");
    conn.flush_streams().await?;

    println!("文件发送完成！");
    conn.print_stats();

    conn.close().await?;
    Ok(())
}

async fn run_benchmark(addr: SocketAddr, seconds: u64, use_tcp: bool) -> anyhow::Result<()> {
    let protocol = if use_tcp { "TCP" } else { "RUDP" };
    println!("运行 {} 基准测试 {} 秒...", protocol, seconds);

    let test_data = vec![0xABu8; 1024 * 64];
    let start = Instant::now();
    let mut total_sent = 0u64;

    if use_tcp {
        let mut socket = TcpStream::connect(addr).await?;

        while start.elapsed().as_secs() < seconds {
            socket.write_all(&test_data).await?;
            total_sent += test_data.len() as u64;
        }
    } else {
        let mut conn = dial(addr).await?;
        let stream_id = conn.create_stream().unwrap_or(0);

        while start.elapsed().as_secs() < seconds {
            conn.send_to_stream(stream_id, &test_data).await?;
            total_sent += test_data.len() as u64;
        }
        conn.flush_streams().await?;
        conn.print_stats();
        conn.close().await?;
    }

    let elapsed = start.elapsed();
    let throughput = (total_sent as f64 / 1024.0 / 1024.0) / elapsed.as_secs_f64();

    println!("\n{} 基准测试结果:", protocol);
    println!("  总发送数据: {:.2} MB", total_sent as f64 / 1024.0 / 1024.0);
    println!("  耗时: {:.2?}", elapsed);
    println!("  吞吐量: {:.2} MB/s", throughput);

    Ok(())
}

async fn run_stats_test(addr: SocketAddr, seconds: u64) -> anyhow::Result<()> {
    println!("=== 传输统计测试 ===");
    println!("测试时间: {} 秒\n", seconds);

    let test_data = vec![0xABu8; 1024 * 128];
    let start = Instant::now();

    let mut conn = dial(addr).await?;
    let stream_id = conn.create_stream().unwrap_or(0);

    let mut interval = tokio::time::interval(Duration::from_secs(1));
    let mut counter = 0;

    while start.elapsed().as_secs() < seconds {
        conn.send_to_stream(stream_id, &test_data).await?;
        counter += 1;

        interval.tick().await;

        if counter % 10 == 0 {
            println!("\n--- 第 {} 秒统计:", start.elapsed().as_secs());
            println!("  CWND: {}", conn.cwnd());
            println!("  RTT: {:?}", conn.rtt());
            println!("  在途包: {}", conn.inflight_count());
            println!("  活跃流: {}", conn.stream_count());
        }
    }

    conn.flush_streams().await?;

    println!("\n=== 最终统计 ===");
    conn.print_stats();

    conn.close().await?;

    Ok(())
}

async fn run_session_resume(addr: SocketAddr, ticket_path: String, data_path: Option<PathBuf>) -> anyhow::Result<()> {
    println!("=== 0-RTT 会话恢复测试 ===");

    if std::path::Path::new(&ticket_path).exists() {
        println!("读取会话票证...");
        let mut ticket_file = File::open(&ticket_path)?;
        let mut ticket_bytes = Vec::new();
        ticket_file.read_to_end(&mut ticket_bytes)?;

        if let Some(ticket) = SessionTicket::deserialize(&ticket_bytes) {
            println!("票证有效！使用 0-RTT 重连...");

            let mut conn = dial_with_ticket(addr, ticket).await?;

            if let Some(data_file) = data_path {
                let stream_id = conn.create_stream().unwrap_or(0);
                let mut f = File::open(data_file)?;
                let mut buffer = Vec::new();
                f.read_to_end(&mut buffer)?;

                println!("通过 0-RTT 发送数据...");
                conn.send_to_stream(stream_id, &buffer).await?;
                conn.flush_streams().await?;
            }

            conn.print_stats();
            conn.close().await?;
        } else {
            eprintln!("无效的票证文件！");
        }
    } else {
        println!("未找到票证，创建新连接并保存票证...");
        let conn = dial(addr).await?;

        if let Some(ticket) = &conn.session_ticket {
            let ticket_bytes = ticket.serialize();
            let mut ticket_file = File::create(&ticket_path)?;
            ticket_file.write_all(&ticket_bytes)?;
            println!("票证已保存到: {}", ticket_path);
        }

        conn.close().await?;
    }

    Ok(())
}

async fn run_migration_test(addr: SocketAddr, new_addr: SocketAddr) -> anyhow::Result<()> {
    println!("=== 连接迁移测试 ===");
    println!("原始地址: {}", addr);
    println!("新地址: {}", new_addr);

    let mut conn = dial(addr).await?;
    println!("连接已建立");

    let stream_id = conn.create_stream().unwrap_or(0);
    let test_data = b"Hello before migration!";
    conn.send_to_stream(stream_id, test_data).await?;
    conn.flush_streams().await?;

    println!("\n启动路径验证...");
    conn.initiate_migration(new_addr).await?;

    tokio::time::sleep(Duration::from_secs(2)).await;

    println!("\n切换到新路径...");
    match conn.migrate_to(new_addr).await {
        Ok(_) => println!("连接迁移成功！"),
        Err(e) => println!("连接迁移失败: {}", e),
    }

    let test_data2 = b"Hello after migration!";
    conn.send_to_stream(stream_id, test_data2).await?;
    conn.flush_streams().await?;

    println!("\n迁移后统计:");
    conn.print_stats();

    conn.close().await?;

    Ok(())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Server { addr, tcp } => {
            if tcp {
                run_tcp_server(addr).await?;
            } else {
                run_rudp_server(addr).await?;
            }
        }

        Commands::Client { addr, tcp, action } => match action {
            ClientAction::Send { file } => {
                if tcp {
                    println!("TCP 单文件发送...");
                } else {
                    send_multiple_files(addr, vec![PathBuf::from(file)]).await?;
                }
            }
            ClientAction::Receive { output } => {
                println!("接收模式，输出到: {}", output);
            }
        },

        Commands::Benchmark { addr, seconds, tcp } => {
            run_benchmark(addr, seconds, tcp).await?;
        }

        Commands::SendFiles { addr, files } => {
            send_multiple_files(addr, files).await?;
        }

        Commands::SessionResume { addr, ticket, data } => {
            run_session_resume(addr, ticket, data).await?;
        }

        Commands::Stats { addr, seconds } => {
            run_stats_test(addr, seconds).await?;
        }

        Commands::Migrate { addr, new_addr } => {
            run_migration_test(addr, new_addr).await?;
        }
    }

    Ok(())
}
