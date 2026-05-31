use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VibrationData {
    pub fan_id: String,
    pub timestamp: DateTime<Utc>,
    pub freq_hz: f64,
    pub magnitude: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ComparisonOperator {
    GreaterThan,
    GreaterThanOrEqual,
    LessThan,
    LessThanOrEqual,
    Equal,
    NotEqual,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MetricField {
    Magnitude,
    FreqHz,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Condition {
    pub field: MetricField,
    pub operator: ComparisonOperator,
    pub threshold: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "config")]
pub enum RuleTrigger {
    Consecutive {
        count: u32,
    },
    SlidingWindow {
        window_size: u32,
        min_matches: u32,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertRule {
    pub id: Uuid,
    pub name: String,
    pub condition: Condition,
    pub trigger: RuleTrigger,
    pub created_at: DateTime<Utc>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateAlertRuleRequest {
    pub name: String,
    pub condition: Condition,
    pub trigger: RuleTrigger,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertRecord {
    pub rule_id: Uuid,
    pub rule_name: String,
    pub fan_id: String,
    pub timestamp: DateTime<Utc>,
    pub triggered_values: Vec<f64>,
}

impl ComparisonOperator {
    pub fn evaluate(&self, value: f64, threshold: f64) -> bool {
        match self {
            ComparisonOperator::GreaterThan => value > threshold,
            ComparisonOperator::GreaterThanOrEqual => value >= threshold,
            ComparisonOperator::LessThan => value < threshold,
            ComparisonOperator::LessThanOrEqual => value <= threshold,
            ComparisonOperator::Equal => (value - threshold).abs() < f64::EPSILON,
            ComparisonOperator::NotEqual => (value - threshold).abs() >= f64::EPSILON,
        }
    }
}

impl Condition {
    pub fn evaluate(&self, data: &VibrationData) -> bool {
        let value = match self.field {
            MetricField::Magnitude => data.magnitude,
            MetricField::FreqHz => data.freq_hz,
        };
        self.operator.evaluate(value, self.threshold)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertQueryParams {
    pub fan_id: Option<String>,
    pub rule_id: Option<Uuid>,
    pub start_time: Option<DateTime<Utc>>,
    pub end_time: Option<DateTime<Utc>>,
    pub limit: Option<usize>,
}
