use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo, UnregisterStatus};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Manager;
use uuid::Uuid;

const SERVICE_TYPE: &str = "_p2pfiletransfer._udp.local.";
const SERVICE_NAME: &str = "P2PFileTransfer";
const DISCOVERY_INTERVAL: u64 = 5;
const DEVICE_TIMEOUT: u64 = 30;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Device {
    pub id: String,
    pub name: String,
    pub address: String,
    pub port: u16,
    pub last_seen: u64,
}

pub struct DiscoveryState {
    devices: Arc<Mutex<HashMap<String, Device>>>,
    daemon: Arc<Mutex<Option<ServiceDaemon>>>,
    running: Arc<Mutex<bool>>,
    my_device_id: Arc<Mutex<Option<String>>>,
}

impl Default for DiscoveryState {
    fn default() -> Self {
        Self {
            devices: Arc::new(Mutex::new(HashMap::new())),
            daemon: Arc::new(Mutex::new(None)),
            running: Arc::new(Mutex::new(false)),
            my_device_id: Arc::new(Mutex::new(None)),
        }
    }
}

fn get_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[tauri::command]
pub async fn start_discovery(state: tauri::State<'_, DiscoveryState>) -> Result<(), String> {
    let mut running = state.running.lock().unwrap();
    if *running {
        return Ok(());
    }

    let daemon = ServiceDaemon::new().map_err(|e| format!("Failed to create mDNS daemon: {}", e))?;
    let receiver = daemon.browse(SERVICE_TYPE).map_err(|e| format!("Failed to browse: {}", e))?;

    let devices = Arc::clone(&state.devices);
    let running_flag = Arc::clone(&state.running);

    *running = true;

    let mut daemon_lock = state.daemon.lock().unwrap();
    *daemon_lock = Some(daemon.clone());
    drop(daemon_lock);
    drop(running);

    tokio::spawn(async move {
        println!("mDNS discovery started");
        while *running_flag.lock().unwrap() {
            match receiver.recv_timeout(Duration::from_secs(DISCOVERY_INTERVAL)) {
                Ok(event) => match event {
                    ServiceEvent::ServiceResolved(info) => {
                        let device_id = info
                            .get_property_val_str("id")
                            .unwrap_or(&Uuid::new_v4().to_string())
                            .to_string();
                        let device_name = info
                            .get_property_val_str("name")
                            .unwrap_or("Unknown Device")
                            .to_string();

                        let addresses: Vec<_> = info.get_addresses().iter().collect();
                        let address = addresses
                            .first()
                            .map(|a| a.to_string())
                            .unwrap_or_else(|| "unknown".to_string());

                        let device = Device {
                            id: device_id.clone(),
                            name: device_name,
                            address,
                            port: info.get_port(),
                            last_seen: get_timestamp(),
                        };

                        let mut devices = devices.lock().unwrap();
                        println!("Discovered device: {} ({}:{})", device.name, device.address, device.port);
                        devices.insert(device_id, device);
                    }
                    ServiceEvent::ServiceRemoved(_, _) => {
                    }
                    ServiceEvent::SearchStarted(_) => {
                    }
                    _ => {}
                },
                Err(_) => {
                    let now = get_timestamp();
                    let mut devices = devices.lock().unwrap();
                    devices.retain(|_, d| now - d.last_seen < DEVICE_TIMEOUT);
                }
            }
        }
        println!("mDNS discovery stopped");
    });

    Ok(())
}

#[tauri::command]
pub async fn stop_discovery(state: tauri::State<'_, DiscoveryState>) -> Result<(), String> {
    let mut running = state.running.lock().unwrap();
    *running = false;

    if let Some(device_id) = state.my_device_id.lock().unwrap().take() {
        if let Some(daemon) = state.daemon.lock().unwrap().take() {
            let unregister_receiver = daemon.unregister(&device_id).map_err(|e| e.to_string())?;
            let _ = unregister_receiver.recv_timeout(Duration::from_secs(2));
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn get_discovered_devices(
    state: tauri::State<'_, DiscoveryState>,
) -> Result<Vec<Device>, String> {
    let devices = state.devices.lock().unwrap();
    let now = get_timestamp();

    let active_devices: Vec<Device> = devices
        .values()
        .filter(|d| now - d.last_seen < DEVICE_TIMEOUT)
        .cloned()
        .collect();

    Ok(active_devices)
}

#[tauri::command]
pub async fn announce_self(
    device_name: String,
    port: u16,
    state: tauri::State<'_, DiscoveryState>,
) -> Result<(), String> {
    let daemon = ServiceDaemon::new().map_err(|e| format!("Failed to create mDNS daemon: {}", e))?;
    let device_id = format!("{}-{}", SERVICE_NAME, Uuid::new_v4());

    let my_service = ServiceInfo::new(
        SERVICE_TYPE,
        &device_id,
        &format!("{}.local.", device_name.replace(' ', "-")),
        "",
        port,
        &[
            ("id", device_id.as_str()),
            ("name", device_name.as_str()),
            ("version", "1.0"),
        ],
    )
    .map_err(|e| format!("Failed to create service info: {}", e))?;

    daemon.register(my_service).map_err(|e| format!("Failed to register service: {}", e))?;

    *state.my_device_id.lock().unwrap() = Some(device_id.clone());

    let mut daemon_lock = state.daemon.lock().unwrap();
    if daemon_lock.is_none() {
        *daemon_lock = Some(daemon.clone());
    }

    println!("Announcing self: {} on port {}", device_name, port);

    Ok(())
}

#[tauri::command]
pub async fn refresh_discovery(state: tauri::State<'_, DiscoveryState>) -> Result<(), String> {
    if let Some(daemon) = state.daemon.lock().unwrap().as_ref() {
        daemon.stop_browse(SERVICE_TYPE).map_err(|e| e.to_string())?;
        let _ = daemon.browse(SERVICE_TYPE).map_err(|e| e.to_string())?;
    }
    Ok(())
}
