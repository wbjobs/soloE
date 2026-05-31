use crate::models::VibrationData;
use crate::rules::SharedRuleEngine;
use crate::storage::SharedStorage;
use rumqttc::{AsyncClient, Event, Incoming, MqttOptions, QoS};
use std::time::Duration;
use tokio::task::JoinHandle;

const INITIAL_RECONNECT_DELAY: Duration = Duration::from_secs(1);
const MAX_RECONNECT_DELAY: Duration = Duration::from_secs(60);
const BACKOFF_MULTIPLIER: u32 = 2;

pub struct MqttSubscriber {
    broker_url: String,
    port: u16,
    topic: String,
}

impl MqttSubscriber {
    pub fn new(broker_url: String, port: u16, topic: String) -> Self {
        Self {
            broker_url,
            port,
            topic,
        }
    }

    pub fn start(
        self,
        rule_engine: SharedRuleEngine,
        storage: SharedStorage,
    ) -> JoinHandle<()> {
        let broker_url = self.broker_url.clone();
        let port = self.port;
        let topic = self.topic.clone();

        tokio::spawn(async move {
            let mut reconnect_delay = INITIAL_RECONNECT_DELAY;
            let mut connection_attempts = 0;

            loop {
                log::info!(
                    "Connecting to MQTT broker at {}:{} (attempt {})",
                    broker_url,
                    port,
                    connection_attempts + 1
                );

                let mut mqttoptions = MqttOptions::new("wind-farm-monitor", &broker_url, port);
                mqttoptions.set_keep_alive(Duration::from_secs(30));
                mqttoptions.set_inflight(100);
                mqttoptions.set_manual_acks(false);
                mqttoptions.set_clean_session(true);

                let (client, mut eventloop) = AsyncClient::new(mqttoptions, 100);

                match client.subscribe(topic.clone(), QoS::AtLeastOnce).await {
                    Ok(_) => {
                        log::info!("Subscribed to MQTT topic: {}", topic);
                        reconnect_delay = INITIAL_RECONNECT_DELAY;
                        connection_attempts = 0;
                    }
                    Err(e) => {
                        log::warn!("Failed to subscribe to topic: {}", e);
                    }
                }

                let mut connected = false;
                loop {
                    match eventloop.poll().await {
                        Ok(Event::Incoming(Incoming::Publish(publish))) => {
                            let payload = publish.payload.to_vec();
                            match serde_json::from_slice::<VibrationData>(&payload) {
                                Ok(data) => {
                                    log::debug!(
                                        "Received vibration data from fan {}: magnitude={}, freq={}",
                                        data.fan_id,
                                        data.magnitude,
                                        data.freq_hz
                                    );

                                    let alerts = rule_engine.process_data(&data);
                                    for alert in alerts {
                                        log::info!(
                                            "Alert triggered: rule={}, fan={}, values={:?}",
                                            alert.rule_name,
                                            alert.fan_id,
                                            alert.triggered_values
                                        );
                                        if let Err(e) = storage.write_alert(&alert).await {
                                            log::error!("Failed to write alert to InfluxDB: {}", e);
                                        }
                                    }
                                }
                                Err(e) => {
                                    log::warn!("Failed to parse vibration data: {}", e);
                                }
                            }
                        }
                        Ok(Event::Incoming(Incoming::ConnAck(_))) => {
                            if !connected {
                                log::info!("Successfully connected to MQTT broker");
                                connected = true;
                                if let Err(e) = client.subscribe(topic.clone(), QoS::AtLeastOnce).await {
                                    log::warn!("Failed to subscribe after reconnect: {}", e);
                                }
                            }
                        }
                        Ok(_) => {}
                        Err(e) => {
                            log::error!("MQTT connection error: {}", e);
                            connected = false;
                            break;
                        }
                    }
                }

                connection_attempts += 1;
                log::warn!(
                    "MQTT connection lost, reconnecting in {:?} (attempt {})",
                    reconnect_delay,
                    connection_attempts
                );

                tokio::time::sleep(reconnect_delay).await;

                reconnect_delay = std::cmp::min(
                    reconnect_delay
                        .checked_mul(BACKOFF_MULTIPLIER)
                        .unwrap_or(MAX_RECONNECT_DELAY),
                    MAX_RECONNECT_DELAY,
                );
            }
        })
    }
}
