use crate::lsm::LsmTree;
use std::sync::Arc;
use std::time::Duration;
use tokio::time::interval;
use tracing::info;

pub struct TtlManager {
    lsm: Arc<LsmTree>,
    retention_days: u32,
}

impl TtlManager {
    pub fn new(lsm: Arc<LsmTree>, retention_days: u32) -> Self {
        Self { lsm, retention_days }
    }

    pub async fn run(self) {
        let mut interval = interval(Duration::from_secs(24 * 60 * 60));

        loop {
            interval.tick().await;
            self.cleanup_expired_data();
        }
    }

    fn cleanup_expired_data(&self) {
        let cutoff_time = chrono::Utc::now().timestamp_millis()
            - (self.retention_days as i64) * 24 * 60 * 60 * 1000;

        info!(
            "Starting TTL cleanup: removing data older than {} ({} days retention)",
            cutoff_time, self.retention_days
        );

        if let Err(e) = self.lsm.delete_series_older_than(cutoff_time) {
            tracing::error!("TTL cleanup failed: {}", e);
        } else {
            info!("TTL cleanup completed successfully");
        }
    }
}
