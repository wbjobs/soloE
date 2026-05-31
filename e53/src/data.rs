use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct SeriesKey {
    pub metric: String,
    pub tags: HashMap<String, String>,
}

impl SeriesKey {
    pub fn new(metric: String, tags: HashMap<String, String>) -> Self {
        Self { metric, tags }
    }
}

impl fmt::Display for SeriesKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut tags_str = String::new();
        let mut sorted_tags: Vec<_> = self.tags.iter().collect();
        sorted_tags.sort_by(|a, b| a.0.cmp(b.0));
        
        for (i, (k, v)) in sorted_tags.iter().enumerate() {
            if i > 0 {
                tags_str.push_str(",");
            }
            tags_str.push_str(&format!("{}=\"{}\"", k, v));
        }
        
        write!(f, "{}{{{}}}", self.metric, tags_str)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sample {
    pub timestamp: i64,
    pub value: f64,
}

impl Sample {
    pub fn new(timestamp: i64, value: f64) -> Self {
        Self { timestamp, value }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeSeries {
    pub key: SeriesKey,
    pub samples: Vec<Sample>,
}

impl TimeSeries {
    pub fn new(key: SeriesKey) -> Self {
        Self {
            key,
            samples: Vec::new(),
        }
    }

    pub fn push(&mut self, sample: Sample) {
        self.samples.push(sample);
    }

    pub fn sort_by_time(&mut self) {
        self.samples.sort_by_key(|s| s.timestamp);
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WriteRequest {
    pub metric: String,
    pub tags: HashMap<String, String>,
    pub timestamp: i64,
    pub value: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QueryResponse {
    pub results: Vec<QueryResult>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QueryResult {
    pub metric: String,
    pub tags: HashMap<String, String>,
    pub values: Vec<(i64, f64)>,
}
