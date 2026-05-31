use crate::models::{AlertQueryParams, AlertRecord};
use chrono::{DateTime, Utc};
use reqwest::Client;
use serde::Deserialize;
use std::sync::Arc;
use thiserror::Error;
use uuid::Uuid;

#[derive(Error, Debug)]
pub enum StorageError {
    #[error("HTTP request failed: {0}")]
    HttpError(#[from] reqwest::Error),
    #[error("Query error: {0}")]
    QueryError(String),
    #[error("Invalid response: {0}")]
    InvalidResponse(String),
}

pub type SharedStorage = Arc<InfluxDBStorage>;

pub struct InfluxDBStorage {
    client: Client,
    url: String,
    token: String,
    org: String,
    bucket: String,
}

struct InfluxDBConfig<'a> {
    url: &'a str,
    token: &'a str,
    org: &'a str,
    bucket: &'a str,
}

impl InfluxDBStorage {
    pub fn new(url: String, token: String, org: String, bucket: String) -> Self {
        Self {
            client: Client::new(),
            url,
            token,
            org,
            bucket,
        }
    }

    fn config(&self) -> InfluxDBConfig {
        InfluxDBConfig {
            url: &self.url,
            token: &self.token,
            org: &self.org,
            bucket: &self.bucket,
        }
    }

    pub async fn write_alert(&self, alert: &AlertRecord) -> Result<(), StorageError> {
        let cfg = self.config();
        let write_url = format!("{}/api/v2/write?org={}&bucket={}", cfg.url, cfg.org, cfg.bucket);

        let values_str = alert
            .triggered_values
            .iter()
            .map(|v| v.to_string())
            .collect::<Vec<_>>()
            .join(",");

        let line_protocol = format!(
            "alerts,rule_id={},rule_name={},fan_id={} triggered_values=\"{}\" {}",
            alert.rule_id,
            alert.rule_name.replace(' ', "\\ "),
            alert.fan_id,
            values_str,
            alert.timestamp.timestamp_nanos_opt().unwrap_or_default()
        );

        self.client
            .post(&write_url)
            .header("Authorization", format!("Token {}", cfg.token))
            .body(line_protocol)
            .send()
            .await?
            .error_for_status()?;

        Ok(())
    }

    pub async fn query_alerts(&self, params: AlertQueryParams) -> Result<Vec<AlertRecord>, StorageError> {
        let cfg = self.config();
        let query_url = format!("{}/api/v2/query?org={}", cfg.url, cfg.org);

        let mut flux_query = format!(
            r#"from(bucket: "{}")
  |> range(start: {}, stop: {})
  |> filter(fn: (r) => r._measurement == "alerts")"#,
            cfg.bucket,
            params
                .start_time
                .map(|t| format!("{}", t.format("%Y-%m-%dT%H:%M:%SZ")))
                .unwrap_or_else(|| "-30d".to_string()),
            params
                .end_time
                .map(|t| format!("{}", t.format("%Y-%m-%dT%H:%M:%SZ")))
                .unwrap_or_else(|| "now()".to_string())
        );

        if let Some(fan_id) = &params.fan_id {
            flux_query.push_str(&format!(
                r#"
  |> filter(fn: (r) => r.fan_id == "{}")"#,
                fan_id
            ));
        }

        if let Some(rule_id) = &params.rule_id {
            flux_query.push_str(&format!(
                r#"
  |> filter(fn: (r) => r.rule_id == "{}")"#,
                rule_id
            ));
        }

        flux_query.push_str(
            r#"
  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
  |> keep(columns: ["_time", "rule_id", "rule_name", "fan_id", "triggered_values"])"#,
        );

        if let Some(limit) = params.limit {
            flux_query.push_str(&format!(
                r#"
  |> limit(n: {})
  |> sort(columns: ["_time"], desc: true)"#,
                limit
            ));
        }

        let request_body = serde_json::json!({
            "query": flux_query,
            "type": "flux"
        });

        let response = self
            .client
            .post(&query_url)
            .header("Authorization", format!("Token {}", cfg.token))
            .header("Content-Type", "application/json")
            .header("Accept", "application/csv")
            .body(serde_json::to_string(&request_body)?)
            .send()
            .await?
            .error_for_status()?;

        let csv_text = response.text().await?;
        parse_influx_csv(&csv_text)
    }
}

#[derive(Debug, Deserialize)]
struct InfluxRow {
    #[serde(rename = "_time")]
    time: String,
    #[serde(rename = "rule_id")]
    rule_id: String,
    #[serde(rename = "rule_name")]
    rule_name: String,
    #[serde(rename = "fan_id")]
    fan_id: String,
    #[serde(rename = "triggered_values")]
    triggered_values: String,
}

fn parse_influx_csv(csv: &str) -> Result<Vec<AlertRecord>, StorageError> {
    let mut records = Vec::new();
    let mut lines = csv.lines();

    let header_line = lines.next().ok_or_else(|| StorageError::InvalidResponse("Empty CSV".to_string()))?;
    let headers: Vec<&str> = header_line.split(',').collect();

    let time_idx = headers.iter().position(|h| *h == "_time").unwrap_or(0);
    let rule_id_idx = headers.iter().position(|h| *h == "rule_id").unwrap_or(0);
    let rule_name_idx = headers.iter().position(|h| *h == "rule_name").unwrap_or(0);
    let fan_id_idx = headers.iter().position(|h| *h == "fan_id").unwrap_or(0);
    let values_idx = headers.iter().position(|h| *h == "triggered_values").unwrap_or(0);

    for line in lines {
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let fields: Vec<&str> = line.split(',').collect();
        if fields.len() < 5 {
            continue;
        }

        let time_str = fields.get(time_idx).unwrap_or(&"");
        let timestamp = DateTime::parse_from_rfc3339(time_str)
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or_else(|_| Utc::now());

        let rule_id_str = fields.get(rule_id_idx).unwrap_or(&"");
        let rule_id = Uuid::parse_str(rule_id_str).unwrap_or_else(|_| Uuid::nil());

        let rule_name = fields.get(rule_name_idx).unwrap_or(&"").to_string();
        let fan_id = fields.get(fan_id_idx).unwrap_or(&"").to_string();

        let values_str = fields.get(values_idx).unwrap_or(&"");
        let triggered_values = values_str
            .split(',')
            .filter_map(|s| s.trim().parse::<f64>().ok())
            .collect();

        records.push(AlertRecord {
            rule_id,
            rule_name,
            fan_id,
            timestamp,
            triggered_values,
        });
    }

    Ok(records)
}
