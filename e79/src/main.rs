mod api;
mod models;
mod mqtt;
mod rules;
mod storage;

use actix_web::{web, App, HttpServer};
use std::sync::Arc;

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    env_logger::init_from_env(env_logger::Env::new().default_filter_or("info"));

    let mqtt_broker = std::env::var("MQTT_BROKER").unwrap_or_else(|_| "localhost".to_string());
    let mqtt_port: u16 = std::env::var("MQTT_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(1883);
    let mqtt_topic =
        std::env::var("MQTT_TOPIC").unwrap_or_else(|_| "wind/farm/+/vibration".to_string());

    let influxdb_url =
        std::env::var("INFLUXDB_URL").unwrap_or_else(|_| "http://localhost:8086".to_string());
    let influxdb_token = std::env::var("INFLUXDB_TOKEN").unwrap_or_else(|_| "my-token".to_string());
    let influxdb_org = std::env::var("INFLUXDB_ORG").unwrap_or_else(|_| "my-org".to_string());
    let influxdb_bucket =
        std::env::var("INFLUXDB_BUCKET").unwrap_or_else(|_| "wind-farm".to_string());

    let server_host = std::env::var("SERVER_HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
    let server_port: u16 = std::env::var("SERVER_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(8080);

    log::info!("Starting Wind Farm Monitor Service...");
    log::info!("MQTT Broker: {}:{}", mqtt_broker, mqtt_port);
    log::info!("MQTT Topic: {}", mqtt_topic);
    log::info!("InfluxDB URL: {}", influxdb_url);
    log::info!("InfluxDB Org: {}", influxdb_org);
    log::info!("InfluxDB Bucket: {}", influxdb_bucket);

    let rule_engine = Arc::new(rules::RuleEngine::new());
    let storage = Arc::new(storage::InfluxDBStorage::new(
        influxdb_url,
        influxdb_token,
        influxdb_org,
        influxdb_bucket,
    ));

    let mqtt_subscriber = mqtt::MqttSubscriber::new(mqtt_broker, mqtt_port, mqtt_topic);
    mqtt_subscriber.start(rule_engine.clone(), storage.clone());

    let rule_engine_clone = rule_engine.clone();
    let storage_clone = storage.clone();

    log::info!("Starting HTTP server on {}:{}", server_host, server_port);

    HttpServer::new(move || {
        App::new()
            .app_data(web::Data::new(rule_engine_clone.clone()))
            .app_data(web::Data::new(storage_clone.clone()))
            .configure(api::configure)
    })
    .bind((server_host.as_str(), server_port))?
    .run()
    .await
}
