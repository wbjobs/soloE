use crate::data::{Sample, SeriesKey};
use crate::lsm::LsmTree;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::time::interval;
use tracing::{info, warn};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum AggregationType {
    Avg,
    Max,
    Min,
    Sum,
    Count,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownsamplingRule {
    pub metric_pattern: String,
    pub tags_filter: Option<HashMap<String, String>>,
    pub source_resolution_ms: u64,
    pub target_resolution_ms: u64,
    pub aggregation: AggregationType,
    pub retention_days: u32,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownsampledSample {
    pub timestamp: i64,
    pub value: f64,
    pub aggregation: AggregationType,
    pub count: u64,
}

#[derive(Clone)]
pub struct DownsamplingTask {
    rule: DownsamplingRule,
    last_processed_timestamp: i64,
}

pub struct DownsamplingManager {
    rules: Arc<RwLock<Vec<DownsamplingRule>>>,
    tasks: Arc<RwLock<Vec<DownsamplingTask>>>,
    lsm: Arc<LsmTree>,
    is_running: Arc<std::sync::atomic::AtomicBool>,
}

impl DownsamplingManager {
    pub fn new(lsm: Arc<LsmTree>) -> Self {
        Self {
            rules: Arc::new(RwLock::new(Vec::new())),
            tasks: Arc::new(RwLock::new(Vec::new())),
            lsm,
            is_running: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }
    }

    pub fn add_rule(&self, rule: DownsamplingRule) {
        let mut rules = self.rules.write();
        rules.push(rule.clone());
        
        let mut tasks = self.tasks.write();
        tasks.push(DownsamplingTask {
            rule,
            last_processed_timestamp: 0,
        });
    }

    pub fn remove_rule(&self, index: usize) -> Option<DownsamplingRule> {
        let mut rules = self.rules.write();
        if index < rules.len() {
            let mut tasks = self.tasks.write();
            tasks.remove(index);
            Some(rules.remove(index))
        } else {
            None
        }
    }

    pub fn get_rules(&self) -> Vec<DownsamplingRule> {
        self.rules.read().clone()
    }

    pub async fn run(&self) {
        self.is_running.store(true, std::sync::atomic::Ordering::Relaxed);
        let mut interval = interval(Duration::from_secs(60));
        
        info!("Downsampling manager started");
        
        while self.is_running.load(std::sync::atomic::Ordering::Relaxed) {
            interval.tick().await;
            self.process_tasks().await;
        }
    }

    async fn process_tasks(&self) {
        let task_count = self.tasks.read().len();
        
        for i in 0..task_count {
            let mut task = {
                let tasks = self.tasks.read();
                if i < tasks.len() {
                    tasks[i].clone()
                } else {
                    continue;
                }
            };
            
            if !task.rule.enabled {
                continue;
            }
            
            if let Err(e) = self.process_task(&mut task).await {
                warn!("Downsampling task failed: {}", e);
            }
            
            let mut tasks = self.tasks.write();
            if i < tasks.len() {
                tasks[i].last_processed_timestamp = task.last_processed_timestamp;
            }
        }
    }

    async fn process_task(&self, task: &mut DownsamplingTask) -> Result<(), String> {
        let now = chrono::Utc::now().timestamp_millis();
        let window_size = task.rule.target_resolution_ms as i64;
        
        let start_time = task.last_processed_timestamp;
        let end_time = now - window_size;
        
        if start_time >= end_time {
            return Ok(());
        }
        
        info!(
            "Processing downsampling for {}: {} -> {}, window {}ms",
            task.rule.metric_pattern,
            start_time,
            end_time,
            task.rule.target_resolution_ms
        );
        
        let series_keys = self.lsm.get_all_series_keys()
            .map_err(|e| e.to_string())?;
        
        for key in series_keys {
            if !key.metric.starts_with(&task.rule.metric_pattern) {
                continue;
            }
            
            if let Some(tags_filter) = &task.rule.tags_filter {
                let mut matches = true;
                for (k, v) in tags_filter {
                    if key.tags.get(k) != Some(v) {
                        matches = false;
                        break;
                    }
                }
                if !matches {
                    continue;
                }
            }
            
            let samples = self.lsm.query(&key, start_time, end_time)
                .map_err(|e| e.to_string())?;
            
            let downsampled = self.downsample_samples(
                &samples,
                task.rule.target_resolution_ms,
                task.rule.aggregation,
            );
            
            if !downsampled.is_empty() {
                let downsampled_metric_name = Self::get_downsampled_key(
                    &key.metric,
                    task.rule.target_resolution_ms,
                    task.rule.aggregation,
                );
                
                let mut downsampled_tags = key.tags.clone();
                downsampled_tags.insert(
                    "resolution_ms".to_string(),
                    task.rule.target_resolution_ms.to_string(),
                );
                downsampled_tags.insert(
                    "aggregation".to_string(),
                    format!("{:?}", task.rule.aggregation).to_lowercase(),
                );
                
                let downsampled_key = SeriesKey::new(downsampled_metric_name.clone(), downsampled_tags);
                
                for sample in downsampled {
                    let _ = self.lsm.insert(downsampled_key.clone(), sample);
                }
                
                info!(
                    "Wrote {} downsampled points for {} at {}ms resolution",
                    downsampled.len(),
                    downsampled_metric_name,
                    task.rule.target_resolution_ms
                );
            }
        }
        
        task.last_processed_timestamp = end_time;
        
        Ok(())
    }

    fn downsample_samples(
        &self,
        samples: &[Sample],
        resolution_ms: u64,
        aggregation: AggregationType,
    ) -> Vec<Sample> {
        if samples.is_empty() {
            return Vec::new();
        }
        
        let mut buckets: HashMap<i64, Vec<f64>> = HashMap::new();
        
        for sample in samples {
            let bucket_ts = (sample.timestamp / resolution_ms as i64) * resolution_ms as i64;
            buckets.entry(bucket_ts).or_default().push(sample.value);
        }
        
        let mut result = Vec::new();
        for (bucket_ts, values) in buckets {
            let aggregated = match aggregation {
                AggregationType::Avg => {
                    let sum: f64 = values.iter().sum();
                    sum / values.len() as f64
                }
                AggregationType::Max => {
                    *values.iter().fold(&f64::NEG_INFINITY, |a, b| a.max(b))
                }
                AggregationType::Min => {
                    *values.iter().fold(&f64::INFINITY, |a, b| a.min(b))
                }
                AggregationType::Sum => values.iter().sum(),
                AggregationType::Count => values.len() as f64,
            };
            
            result.push(Sample::new(bucket_ts, aggregated));
        }
        
        result.sort_by_key(|s| s.timestamp);
        result
    }

    fn get_downsampled_key(metric: &str, resolution_ms: u64, aggregation: AggregationType) -> String {
        let agg_str = match aggregation {
            AggregationType::Avg => "avg",
            AggregationType::Max => "max",
            AggregationType::Min => "min",
            AggregationType::Sum => "sum",
            AggregationType::Count => "count",
        };
        format!("{}_downsampled_{}_{}", metric, resolution_ms, agg_str)
    }

    pub fn find_best_resolution(
        &self,
        metric: &str,
        start_time: i64,
        end_time: i64,
    ) -> Option<(u64, AggregationType)> {
        let rules = self.rules.read();
        let query_range = end_time - start_time;
        
        let mut best_rule: Option<&DownsamplingRule> = None;
        let mut best_score = 0;
        
        for rule in rules.iter().filter(|r| r.enabled) {
            if !metric.starts_with(&rule.metric_pattern) {
                continue;
            }
            
            let coverage = (rule.target_resolution_ms * 1000) as i64;
            if query_range >= coverage {
                let score = rule.target_resolution_ms;
                if score > best_score {
                    best_score = score;
                    best_rule = Some(rule);
                }
            }
        }
        
        best_rule.map(|r| (r.target_resolution_ms, r.aggregation))
    }

    pub fn stop(&self) {
        self.is_running.store(false, std::sync::atomic::Ordering::Relaxed);
    }
}

pub async fn query_with_downsampling(
    lsm: &Arc<LsmTree>,
    downsampling_manager: &Arc<DownsamplingManager>,
    key: &crate::data::SeriesKey,
    start: i64,
    end: i64,
) -> crate::lsm::Result<Vec<Sample>> {
    let query_range = end - start;
    
    let best_resolution = downsampling_manager.find_best_resolution(&key.metric, start, end);
    
    if let Some((resolution_ms, aggregation)) = best_resolution {
        let agg_str = match aggregation {
            AggregationType::Avg => "avg",
            AggregationType::Max => "max",
            AggregationType::Min => "min",
            AggregationType::Sum => "sum",
            AggregationType::Count => "count",
        };
        
        let downsampled_metric_name = format!(
            "{}_downsampled_{}_{}",
            key.metric, resolution_ms, agg_str
        );
        
        let mut downsampled_tags = key.tags.clone();
        downsampled_tags.insert("resolution_ms".to_string(), resolution_ms.to_string());
        downsampled_tags.insert("aggregation".to_string(), agg_str.to_string());
        
        let downsampled_key = SeriesKey::new(downsampled_metric_name.clone(), downsampled_tags);
        let downsampled_samples = lsm.query(&downsampled_key, start, end)?;
        
        if !downsampled_samples.is_empty() {
            info!(
                "Using downsampled data for {}: {}ms resolution (query range: {}ms)",
                key.metric, resolution_ms, query_range
            );
            return Ok(downsampled_samples);
        }
    }
    
    let original_samples = lsm.query(key, start, end)?;
    Ok(original_samples)
}
