use std::collections::HashMap;
use std::net::{SocketAddr, TcpStream, UdpSocket};
use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tokio::time::timeout;
use tracing::{debug, info, warn};
use uuid::Uuid;

use crate::error::Result;
use crate::models::{ConnectionMethod, DeviceInfo, DeviceStatus, OSType};

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DiscoveryMessage {
    device_id: String,
    device_name: String,
    device_os: OSType,
    port: u16,
    timestamp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct HandshakeMessage {
    device_id: String,
    device_name: String,
    device_os: OSType,
    port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HolePunchResult {
    pub success: bool,
    pub device: Option<DeviceInfo>,
    pub attempts: u32,
}

#[derive(Debug, Clone)]
pub struct HolePunchAttempt {
    pub target_ip: String,
    pub target_port: u16,
    pub local_port: u16,
    pub status: String,
    pub attempts: u32,
}

pub struct DeviceDiscovery {
    socket: Arc<UdpSocket>,
    devices: Arc<RwLock<HashMap<String, DeviceInfo>>>,
    discovery_port: u16,
    transfer_port: u16,
    local_device_id: String,
    local_device_name: String,
    enable_hole_punch: bool,
    hole_punch_attempts: u32,
}

impl DeviceDiscovery {
    pub fn new(discovery_port: u16, transfer_port: u16, device_name: String) -> Result<Self> {
        let socket = UdpSocket::bind(format!("0.0.0.0:{}", discovery_port))?;
        socket.set_broadcast(true)?;
        socket.set_read_timeout(Some(Duration::from_secs(1)))?;

        Ok(Self {
            socket: Arc::new(socket),
            devices: Arc::new(RwLock::new(HashMap::new())),
            discovery_port,
            transfer_port,
            local_device_id: Uuid::new_v4().to_string(),
            local_device_name: device_name,
            enable_hole_punch: true,
            hole_punch_attempts: 5,
        })
    }

    pub fn with_hole_punch_config(mut self, enabled: bool, attempts: u32) -> Self {
        self.enable_hole_punch = enabled;
        self.hole_punch_attempts = attempts;
        self
    }

    pub async fn manual_connect(&self, ip: String, port: u16) -> Result<DeviceInfo> {
        info!("Attempting manual connection to {}:{}", ip, port);
        let addr: SocketAddr = format!("{}:{}", ip, port).parse()?;

        let handshake = HandshakeMessage {
            device_id: self.local_device_id.clone(),
            device_name: self.local_device_name.clone(),
            device_os: get_current_os(),
            port: self.transfer_port,
        };

        let msg_bytes = serde_json::to_vec(&handshake)?;

        for attempt in 1..=3 {
            debug!("Handshake attempt {} to {}", attempt, addr);
            match timeout(Duration::from_secs(2), async {
                let mut stream = TcpStream::connect_timeout(&addr, Duration::from_secs(2))?;
                stream.set_write_timeout(Some(Duration::from_secs(2)))?;
                Ok(stream)
            }).await {
                Ok(Ok(mut stream)) => {
                    use std::io::Write;
                    if stream.write_all(&msg_bytes).is_ok() {
                        let mut buf = [0u8; 1024];
                        stream.set_read_timeout(Some(Duration::from_secs(2)))?;
                        use std::io::Read;
                        
                        if let Ok(size) = stream.read(&mut buf) {
                            if let Ok(peer_handshake) = serde_json::from_slice::<HandshakeMessage>(&buf[..size]) {
                                info!("Successfully connected to device: {}", peer_handshake.device_name);
                                
                                let device_info = DeviceInfo {
                                    id: peer_handshake.device_id,
                                    name: peer_handshake.device_name,
                                    ip: ip.clone(),
                                    port: peer_handshake.port,
                                    os: peer_handshake.device_os,
                                    status: DeviceStatus::Online,
                                    last_seen: Utc::now(),
                                    connection_method: Some(ConnectionMethod::Manual),
                                    public_ip: None,
                                };

                                let mut devices = self.devices.write().await;
                                devices.insert(device_info.id.clone(), device_info.clone());
                                
                                return Ok(device_info);
                            }
                        }
                    }
                }
                _ => {}
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }

        Err(crate::error::AppError::Network(format!(
            "Failed to connect to {}:{} after 3 attempts",
            ip, port
        )))
    }

    pub async fn try_tcp_hole_punch(&self, target_ip: String, target_port: u16) -> Result<HolePunchResult> {
        if !self.enable_hole_punch {
            return Ok(HolePunchResult {
                success: false,
                device: None,
                attempts: 0,
            });
        }

        info!("Attempting TCP hole punching to {}:{}", target_ip, target_port);
        
        let target_addr: SocketAddr = format!("{}:{}", target_ip, target_port).parse()?;
        
        for attempt in 1..=self.hole_punch_attempts {
            debug!("Hole punch attempt {}/{}", attempt, self.hole_punch_attempts);
            
            match timeout(Duration::from_secs(1), async {
                TcpStream::connect_timeout(&target_addr, Duration::from_secs(1))
            }).await {
                Ok(Ok(stream)) => {
                    info!("TCP hole punch successful on attempt {}", attempt);
                    
                    let handshake = HandshakeMessage {
                        device_id: self.local_device_id.clone(),
                        device_name: self.local_device_name.clone(),
                        device_os: get_current_os(),
                        port: self.transfer_port,
                    };
                    
                    let msg_bytes = serde_json::to_vec(&handshake)?;
                    use std::io::Write;
                    stream.set_write_timeout(Some(Duration::from_secs(2)))?;
                    
                    if let Ok(()) = stream.try_clone()?.write_all(&msg_bytes) {
                        let mut buf = [0u8; 1024];
                        use std::io::Read;
                        stream.set_read_timeout(Some(Duration::from_secs(2)))?;
                        
                        if let Ok(size) = stream.try_clone()?.read(&mut buf) {
                            if let Ok(peer_handshake) = serde_json::from_slice::<HandshakeMessage>(&buf[..size]) {
                                let device_info = DeviceInfo {
                                    id: peer_handshake.device_id,
                                    name: peer_handshake.device_name,
                                    ip: target_ip.clone(),
                                    port: peer_handshake.port,
                                    os: peer_handshake.device_os,
                                    status: DeviceStatus::Online,
                                    last_seen: Utc::now(),
                                    connection_method: Some(ConnectionMethod::TcpHolePunch),
                                    public_ip: None,
                                };

                                let mut devices = self.devices.write().await;
                                devices.insert(device_info.id.clone(), device_info.clone());
                                
                                return Ok(HolePunchResult {
                                    success: true,
                                    device: Some(device_info),
                                    attempts: attempt,
                                });
                            }
                        }
                    }
                }
                _ => {}
            }
            
            tokio::time::sleep(Duration::from_millis(300)).await;
        }

        Ok(HolePunchResult {
            success: false,
            device: None,
            attempts: self.hole_punch_attempts,
        })
    }

    pub async fn start(&self) -> Result<()> {
        let socket = Arc::clone(&self.socket);
        let devices = Arc::clone(&self.devices);
        let discovery_port = self.discovery_port;
        let local_device_id = self.local_device_id.clone();
        let local_device_name = self.local_device_name.clone();

        tokio::spawn(async move {
            let mut buf = [0u8; 1024];
            loop {
                match socket.recv_from(&mut buf) {
                    Ok((size, src)) => {
                        if let Ok(msg) = serde_json::from_slice::<DiscoveryMessage>(&buf[..size]) {
                            if msg.device_id != local_device_id {
                                debug!("Received discovery message from {}: {}", src, msg.device_name);
                                let mut devices = devices.write().await;
                                devices.insert(
                                    msg.device_id.clone(),
                                    DeviceInfo {
                                        id: msg.device_id,
                                        name: msg.device_name,
                                        ip: src.ip().to_string(),
                                        port: msg.port,
                                        os: msg.device_os,
                                        status: DeviceStatus::Online,
                                        last_seen: Utc::now(),
                                        connection_method: Some(ConnectionMethod::Broadcast),
                                        public_ip: None,
                                    },
                                );
                            }
                        }
                    }
                    Err(e) => {
                        if e.kind() != std::io::ErrorKind::WouldBlock
                            && e.kind() != std::io::ErrorKind::TimedOut
                        {
                            warn!("Error receiving discovery message: {}", e);
                        }
                    }
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        });

        let socket = Arc::clone(&self.socket);
        let local_device_id = self.local_device_id.clone();
        let local_device_name = self.local_device_name.clone();

        tokio::spawn(async move {
            loop {
                let msg = DiscoveryMessage {
                    device_id: local_device_id.clone(),
                    device_name: local_device_name.clone(),
                    device_os: get_current_os(),
                    port: self.transfer_port,
                    timestamp: Utc::now().timestamp(),
                };

                if let Ok(msg_bytes) = serde_json::to_vec(&msg) {
                    let broadcast_addr: SocketAddr =
                        format!("255.255.255.255:{}", discovery_port).parse().unwrap();

                    if let Err(e) = socket.send_to(&msg_bytes, broadcast_addr) {
                        debug!("Error broadcasting: {}", e);
                    }
                }

                tokio::time::sleep(Duration::from_secs(2)).await;
            }
        });

        let devices = Arc::clone(&self.devices);
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(10)).await;
                let mut devices = devices.write().await;
                let now = Utc::now();
                devices.retain(|_, device| {
                    let offline_threshold = Duration::from_secs(10);
                    let elapsed = now.signed_duration_since(device.last_seen).to_std().unwrap_or_default();
                    elapsed < offline_threshold
                });
            }
        });

        Ok(())
    }

    pub async fn get_devices(&self) -> Vec<DeviceInfo> {
        let devices = self.devices.read().await;
        devices.values().cloned().collect()
    }

    pub fn get_local_device_id(&self) -> &str {
        &self.local_device_id
    }
}

fn get_current_os() -> OSType {
    if cfg!(target_os = "windows") {
        OSType::Windows
    } else if cfg!(target_os = "macos") {
        OSType::macOS
    } else if cfg!(target_os = "linux") {
        OSType::Linux
    } else {
        OSType::Unknown
    }
}
