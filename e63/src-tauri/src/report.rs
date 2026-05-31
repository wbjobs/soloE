use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use chrono::{DateTime, Utc, Duration};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkTransferRecord {
    pub chunk_index: u32,
    pub start_time: DateTime<Utc>,
    pub end_time: DateTime<Utc>,
    pub duration_ms: i64,
    pub retry_count: u32,
    pub success: bool,
    pub hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferReport {
    pub report_id: String,
    pub file_id: String,
    pub file_name: String,
    pub file_size: u64,
    pub total_chunks: u32,
    pub peer_id: String,
    pub peer_name: String,
    pub direction: String,
    pub start_time: DateTime<Utc>,
    pub end_time: DateTime<Utc>,
    pub total_duration_ms: i64,
    pub total_bytes_transferred: u64,
    pub average_speed_mbps: f64,
    pub successful_chunks: u32,
    pub failed_chunks: u32,
    pub total_retries: u32,
    pub chunk_records: Vec<ChunkTransferRecord>,
    pub success: bool,
}

pub struct ReportManager {
    reports: Mutex<HashMap<String, TransferReport>>,
    in_progress: Mutex<HashMap<String, Vec<ChunkTransferRecord>>>,
    chunk_start_times: Mutex<HashMap<(String, u32), DateTime<Utc>>>>,
    chunk_retry_counts: Mutex<HashMap<(String, u32), u32>>,
}

impl Default for ReportManager {
    fn default() -> Self {
        Self {
            reports: Mutex::new(HashMap::new()),
            in_progress: Mutex::new(HashMap::new()),
            chunk_start_times: Mutex::new(HashMap::new()),
            chunk_retry_counts: Mutex::new(HashMap::new()),
        }
    }
}

impl ReportManager {
    pub fn start_transfer(&self, session_id: &str) {
        let mut in_progress = self.in_progress.lock().unwrap();
        in_progress.insert(session_id.to_string(), Vec::new());
    }

    pub fn record_chunk_start(&self, session_id: &str, chunk_index: u32) {
        let mut start_times = self.chunk_start_times.lock().unwrap();
        start_times.insert((session_id.to_string(), chunk_index), Utc::now());
    }

    pub fn record_chunk_retry(&self, session_id: &str, chunk_index: u32) {
        let mut retry_counts = self.chunk_retry_counts.lock().unwrap();
        let key = (session_id.to_string(), chunk_index);
        let count = retry_counts.entry(key).or_insert(0);
        *count += 1;
    }

    pub fn get_retry_count(&self, session_id: &str, chunk_index: u32) -> u32 {
        let retry_counts = self.chunk_retry_counts.lock().unwrap();
        *retry_counts.get(&(session_id.to_string(), chunk_index)).unwrap_or(&0)
    }

    pub fn record_chunk_end(
        &self,
        session_id: &str,
        chunk_index: u32,
        hash: String,
        success: bool,
    ) {
        let start_times = self.chunk_start_times.lock().unwrap();
        let start_time = start_times
            .get(&(session_id.to_string(), chunk_index))
            .copied()
            .unwrap_or_else(Utc::now);

        let retry_count = self.get_retry_count(session_id, chunk_index);
        let end_time = Utc::now();
        let duration = end_time.signed_duration_since(start_time);

        let record = ChunkTransferRecord {
            chunk_index,
            start_time,
            end_time,
            duration_ms: duration.num_milliseconds(),
            retry_count,
            success,
            hash,
        };

        let mut in_progress = self.in_progress.lock().unwrap();
        if let Some(records) = in_progress.get_mut(session_id) {
            records.push(record);
        }
    }

    pub fn finish_transfer(
        &self,
        session_id: &str,
        file_id: String,
        file_name: String,
        file_size: u64,
        peer_id: String,
        peer_name: String,
        direction: String,
        success: bool,
    ) -> TransferReport {
        let chunk_records = {
            let mut in_progress = self.in_progress.lock().unwrap();
            in_progress
                .remove(session_id)
                .unwrap_or_default()
        };

        let start_time = chunk_records
            .first()
            .map(|r| r.start_time)
            .unwrap_or_else(Utc::now);
        let end_time = Utc::now();
        let total_duration = end_time.signed_duration_since(start_time);

        let successful_chunks = chunk_records.iter().filter(|r| r.success).count() as u32;
        let failed_chunks = chunk_records.iter().filter(|r| !r.success).count() as u32;
        let total_retries: u32 = chunk_records.iter().map(|r| r.retry_count).sum();

        let total_bytes_transferred = if success { file_size } else { 0 };
        let duration_seconds = total_duration.num_milliseconds() as f64 / 1000.0;
        let average_speed_mbps = if duration_seconds > 0.0 {
            (total_bytes_transferred as f64 * 8.0) / (duration_seconds * 1024.0 * 1024.0)
        } else {
            0.0
        };

        let report = TransferReport {
            report_id: Uuid::new_v4().to_string(),
            file_id,
            file_name,
            file_size,
            total_chunks: chunk_records.len() as u32,
            peer_id,
            peer_name,
            direction,
            start_time,
            end_time,
            total_duration_ms: total_duration.num_milliseconds(),
            total_bytes_transferred,
            average_speed_mbps,
            successful_chunks,
            failed_chunks,
            total_retries,
            chunk_records,
            success,
        };

        let mut reports = self.reports.lock().unwrap();
        reports.insert(report.report_id.clone(), report.clone());

        report
    }

    pub fn get_report(&self, report_id: &str) -> Option<TransferReport> {
        let reports = self.reports.lock().unwrap();
        reports.get(report_id).cloned()
    }

    pub fn get_all_reports(&self) -> Vec<TransferReport> {
        let reports = self.reports.lock().unwrap();
        reports.values().cloned().collect()
    }

    pub fn clear_reports(&self) {
        let mut reports = self.reports.lock().unwrap();
        reports.clear();
    }

    pub fn export_report(&self, report_id: &str) -> Result<String, String> {
        let report = self.get_report(report_id)
            .ok_or_else(|| "Report not found".to_string())?;
        serde_json::to_string_pretty(&report)
            .map_err(|e| format!("Failed to serialize report: {}", e))
    }
}
