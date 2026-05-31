use crate::models::{
    AlertRecord, AlertRule, Condition, CreateAlertRuleRequest, RuleTrigger, VibrationData,
};
use chrono::Utc;
use parking_lot::RwLock;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::Arc;
use uuid::Uuid;

pub type SharedRuleEngine = Arc<RuleEngine>;

const SHARD_COUNT: usize = 16;

fn fan_id_hash(fan_id: &str) -> usize {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    fan_id.hash(&mut hasher);
    (hasher.finish() as usize) % SHARD_COUNT
}

struct RingBuffer {
    buf: Vec<bool>,
    values: Vec<f64>,
    head: usize,
    count: usize,
    capacity: usize,
}

impl RingBuffer {
    fn new(capacity: usize) -> Self {
        Self {
            buf: vec![false; capacity],
            values: vec![0.0; capacity],
            head: 0,
            count: 0,
            capacity,
        }
    }

    fn push(&mut self, value: bool, metric_value: f64) {
        self.buf[self.head] = value;
        self.values[self.head] = metric_value;
        self.head = (self.head + 1) % self.capacity;
        self.count = std::cmp::min(self.count + 1, self.capacity);
    }

    fn count_matches(&self) -> usize {
        if self.count == 0 {
            return 0;
        }
        if self.count < self.capacity {
            self.buf.iter().take(self.count).filter(|&&v| v).count()
        } else {
            self.buf.iter().filter(|&&v| v).count()
        }
    }

    fn get_recent_values(&self) -> Vec<f64> {
        if self.count == 0 {
            return Vec::new();
        }
        let mut result = Vec::with_capacity(self.count);
        if self.count < self.capacity {
            result.extend_from_slice(&self.values[..self.count].iter().filter(|&&v| v > 0.0).cloned());
        } else {
            let (a, b) = self.values.split_at(self.head);
            result.extend(b.iter().cloned());
            result.extend(a.iter().cloned());
        }
        result
    }

    fn clear(&mut self) {
        self.head = 0;
        self.count = 0;
        for v in &mut self.buf {
            *v = false;
        }
        for v in &mut self.values {
            *v = 0.0;
        }
    }
}

struct FanRuleState {
    consecutive_matches: u32,
    ring_buffer: Option<RingBuffer>,
    last_triggered: Option<chrono::DateTime<Utc>>,
    trigger_type: TriggerType,
}

enum TriggerType {
    Consecutive(u32),
    SlidingWindow { window_size: u32, min_matches: u32 },
}

impl From<&RuleTrigger> for TriggerType {
    fn from(trigger: &RuleTrigger) -> Self {
        match trigger {
            RuleTrigger::Consecutive { count } => TriggerType::Consecutive(*count),
            RuleTrigger::SlidingWindow {
                window_size,
                min_matches,
            } => TriggerType::SlidingWindow {
                window_size: *window_size,
                min_matches: *min_matches,
            },
        }
    }
}

struct Shard {
    fan_rule_states: RwLock<HashMap<(String, Uuid), FanRuleState>>,
}

impl Shard {
    fn new() -> Self {
        Self {
            fan_rule_states: RwLock::new(HashMap::new()),
        }
    }
}

pub struct RuleEngine {
    rules: RwLock<HashMap<Uuid, AlertRule>>,
    shards: [Shard; SHARD_COUNT],
}

impl RuleEngine {
    pub fn new() -> Self {
        Self {
            rules: RwLock::new(HashMap::new()),
            shards: std::array::from_fn(|_| Shard::new()),
        }
    }

    pub fn add_rule(&self, request: CreateAlertRuleRequest) -> AlertRule {
        let rule = AlertRule {
            id: Uuid::new_v4(),
            name: request.name,
            condition: request.condition,
            trigger: request.trigger,
            created_at: Utc::now(),
            enabled: true,
        };
        self.rules.write().insert(rule.id, rule.clone());
        rule
    }

    pub fn get_rules(&self) -> Vec<AlertRule> {
        self.rules.read().values().cloned().collect()
    }

    pub fn get_rule(&self, id: Uuid) -> Option<AlertRule> {
        self.rules.read().get(&id).cloned()
    }

    pub fn delete_rule(&self, id: Uuid) -> bool {
        if self.rules.write().remove(&id).is_some() {
            for shard in &self.shards {
                let mut states = shard.fan_rule_states.write();
                states.retain(|(_, rule_id), _| *rule_id != id);
            }
            true
        } else {
            false
        }
    }

    pub fn process_data(&self, data: &VibrationData) -> Vec<AlertRecord> {
        let mut alerts = Vec::new();
        let rules = self.rules.read();

        if rules.is_empty() {
            return alerts;
        }

        let shard_idx = fan_id_hash(&data.fan_id);
        let shard = &self.shards[shard_idx];

        for rule in rules.values() {
            if !rule.enabled {
                continue;
            }

            let key = (data.fan_id.clone(), rule.id);
            let condition_met = rule.condition.evaluate(data);
            let field_value = match rule.condition.field {
                crate::models::MetricField::Magnitude => data.magnitude,
                crate::models::MetricField::FreqHz => data.freq_hz,
            };

            let mut states = shard.fan_rule_states.write();
            let state = states.entry(key).or_insert_with(|| FanRuleState {
                consecutive_matches: 0,
                ring_buffer: match &rule.trigger {
                    RuleTrigger::SlidingWindow { window_size, .. } => {
                        Some(RingBuffer::new(window_size as usize))
                    }
                    _ => None,
                },
                last_triggered: None,
                trigger_type: TriggerType::from(&rule.trigger),
            });

            let mut triggered = false;
            let mut triggered_values = Vec::new();

            match state.trigger_type {
                TriggerType::Consecutive(required_count) => {
                    if condition_met {
                        state.consecutive_matches += 1;
                        if state.consecutive_matches >= required_count {
                            triggered = true;
                            triggered_values = vec![field_value];
                            state.last_triggered = Some(Utc::now());
                        }
                    } else {
                        state.consecutive_matches = 0;
                    }
                }
                TriggerType::SlidingWindow { min_matches, .. } => {
                    if let Some(ref mut rb) = state.ring_buffer {
                        rb.push(condition_met, field_value);
                        let match_count = rb.count_matches();
                        if match_count >= min_matches as usize {
                            triggered = true;
                            triggered_values = rb.get_recent_values();
                            state.last_triggered = Some(Utc::now());
                        }
                    }
                }
            }

            if triggered {
                alerts.push(AlertRecord {
                    rule_id: rule.id,
                    rule_name: rule.name.clone(),
                    fan_id: data.fan_id.clone(),
                    timestamp: Utc::now(),
                    triggered_values,
                });
            }
        }

        alerts
    }

    pub fn update_rule_condition(&self, id: Uuid, condition: Condition) -> Option<AlertRule> {
        let mut rules = self.rules.write();
        if let Some(rule) = rules.get_mut(&id) {
            rule.condition = condition;
            for shard in &self.shards {
                let mut states = shard.fan_rule_states.write();
                states.retain(|(_, rule_id), _| *rule_id != id);
            }
            Some(rule.clone())
        } else {
            None
        }
    }

    pub fn set_rule_enabled(&self, id: Uuid, enabled: bool) -> Option<AlertRule> {
        let mut rules = self.rules.write();
        if let Some(rule) = rules.get_mut(&id) {
            rule.enabled = enabled;
            if !enabled {
                for shard in &self.shards {
                    let mut states = shard.fan_rule_states.write();
                    states.retain(|(_, rule_id), _| *rule_id != id);
                }
            }
            Some(rule.clone())
        } else {
            None
        }
    }
}
