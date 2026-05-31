use rand::Rng;
use rand_distr::{Normal, Distribution};
use rayon::prelude::*;
use std::collections::{HashMap, HashSet, VecDeque};
use std::f64::consts::PI;
use std::sync::{Arc, Mutex};

const OVERLOAD_THRESHOLD: f64 = 0.95;
const RECOVERY_THRESHOLD: f64 = 0.70;
const HOT_CONTENT_TOP_N: usize = 50;
const CONTENT_POPULARITY_DECAY: f64 = 0.95;
const PUSH_TO_NODE_RATIO: f64 = 0.3;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NodeStatus {
    Healthy,
    Overloaded,
}

#[derive(Debug, Clone)]
struct NodeStatusEvent {
    node_id: usize,
    new_status: NodeStatus,
    timestamp: u64,
}

#[derive(Debug, Clone)]
struct EventBus {
    events: Arc<Mutex<VecDeque<NodeStatusEvent>>>,
    subscribers: Arc<Mutex<Vec<Box<dyn Fn(NodeStatusEvent) + Send + Sync>>>>,
}

impl EventBus {
    fn new() -> Self {
        EventBus {
            events: Arc::new(Mutex::new(VecDeque::new())),
            subscribers: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn publish(&self, event: NodeStatusEvent) {
        let mut events = self.events.lock().unwrap();
        events.push_back(event.clone());
        
        let subscribers = self.subscribers.lock().unwrap();
        for subscriber in subscribers.iter() {
            subscriber(event.clone());
        }
    }

    fn subscribe<F>(&self, callback: F)
    where
        F: Fn(NodeStatusEvent) + Send + Sync + 'static,
    {
        let mut subscribers = self.subscribers.lock().unwrap();
        subscribers.push(Box::new(callback));
    }
}

#[derive(Debug, Clone)]
struct RequestHistory {
    content_requests: Vec<Vec<usize>>,
    content_sizes: HashMap<usize, f64>,
}

impl RequestHistory {
    fn new() -> Self {
        RequestHistory {
            content_requests: Vec::new(),
            content_sizes: HashMap::new(),
        }
    }

    fn record_request(&mut self, content_id: usize, content_size: f64, window: usize) {
        while self.content_requests.len() <= window {
            self.content_requests.push(Vec::new());
        }
        self.content_requests[window].push(content_id);
        self.content_sizes.insert(content_id, content_size);
    }

    fn predict_hot_content(&self, next_hours: usize) -> Vec<(usize, f64)> {
        let mut popularity: HashMap<usize, f64> = HashMap::new();
        
        for (window_idx, window) in self.content_requests.iter().rev().take(next_hours).enumerate() {
            let decay = CONTENT_POPULARITY_DECAY.powi(window_idx as i32);
            for &content_id in window {
                *popularity.entry(content_id).or_insert(0.0) += decay;
            }
        }

        let mut sorted: Vec<_> = popularity.into_iter().collect();
        sorted.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        sorted.truncate(HOT_CONTENT_TOP_N);
        sorted
    }

    fn get_content_size(&self, content_id: usize) -> f64 {
        *self.content_sizes.get(&content_id).unwrap_or(&1.0)
    }
}

#[derive(Debug, Clone)]
struct HotContentPusher {
    hot_content: Arc<Mutex<Vec<(usize, f64)>>>,
}

impl HotContentPusher {
    fn new() -> Self {
        HotContentPusher {
            hot_content: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn update_hot_content(&self, hot_content: Vec<(usize, f64)>) {
        let mut guard = self.hot_content.lock().unwrap();
        *guard = hot_content;
    }

    fn get_hot_content(&self) -> Vec<(usize, f64)> {
        self.hot_content.lock().unwrap().clone()
    }

    fn push_to_nodes(&self, nodes: &mut [EdgeNode], history: &RequestHistory) -> usize {
        let hot_content = self.get_hot_content();
        if hot_content.is_empty() {
            return 0;
        }

        let push_count = (nodes.len() as f64 * PUSH_TO_NODE_RATIO) as usize;
        let mut total_pushed = 0;

        for node in nodes.iter_mut().take(push_count) {
            for &(content_id, _) in &hot_content {
                let size = history.get_content_size(content_id);
                if node.can_cache(size) && !node.has_content(content_id) {
                    node.pre_cache_content(content_id, size);
                    total_pushed += 1;
                }
            }
        }

        total_pushed
    }
}

#[derive(Debug, Clone, Copy)]
struct GeoLocation {
    latitude: f64,
    longitude: f64,
}

impl GeoLocation {
    fn random() -> Self {
        let mut rng = rand::thread_rng();
        GeoLocation {
            latitude: rng.gen_range(-90.0..90.0),
            longitude: rng.gen_range(-180.0..180.0),
        }
    }

    fn distance_to(&self, other: &GeoLocation) -> f64 {
        const EARTH_RADIUS_KM: f64 = 6371.0;
        let lat1 = self.latitude.to_radians();
        let lat2 = other.latitude.to_radians();
        let delta_lat = (other.latitude - self.latitude).to_radians();
        let delta_lon = (other.longitude - self.longitude).to_radians();

        let a = (delta_lat / 2.0).sin().powi(2) 
            + lat1.cos() * lat2.cos() * (delta_lon / 2.0).sin().powi(2);
        let c = 2.0 * a.sqrt().atan2((1.0 - a).sqrt());

        EARTH_RADIUS_KM * c
    }
}

#[derive(Debug, Clone)]
struct EdgeNode {
    id: usize,
    location: GeoLocation,
    upload_bandwidth_mbps: f64,
    used_bandwidth_mbps: f64,
    storage_capacity_gb: f64,
    used_storage_gb: f64,
    cache: HashSet<usize>,
    pre_cached_content: HashSet<usize>,
    status: NodeStatus,
    event_bus: Option<Arc<EventBus>>,
}

impl EdgeNode {
    fn new(id: usize) -> Self {
        let mut rng = rand::thread_rng();
        let normal = Normal::new(100.0, 30.0).unwrap();
        
        EdgeNode {
            id,
            location: GeoLocation::random(),
            upload_bandwidth_mbps: normal.sample(&mut rng).max(20.0),
            used_bandwidth_mbps: 0.0,
            storage_capacity_gb: rng.gen_range(50.0..500.0),
            used_storage_gb: 0.0,
            cache: HashSet::new(),
            pre_cached_content: HashSet::new(),
            status: NodeStatus::Healthy,
            event_bus: None,
        }
    }

    fn with_event_bus(mut self, event_bus: Arc<EventBus>) -> Self {
        self.event_bus = Some(event_bus);
        self
    }

    fn available_bandwidth(&self) -> f64 {
        self.upload_bandwidth_mbps - self.used_bandwidth_mbps
    }

    fn bandwidth_utilization(&self) -> f64 {
        self.used_bandwidth_mbps / self.upload_bandwidth_mbps
    }

    fn has_content(&self, content_id: usize) -> bool {
        self.cache.contains(&content_id) || self.pre_cached_content.contains(&content_id)
    }

    fn is_pre_cached(&self, content_id: usize) -> bool {
        self.pre_cached_content.contains(&content_id)
    }

    fn can_cache(&self, content_size_gb: f64) -> bool {
        (self.storage_capacity_gb - self.used_storage_gb) >= content_size_gb
    }

    fn cache_content(&mut self, content_id: usize, content_size_gb: f64) {
        if self.can_cache(content_size_gb) && !self.has_content(content_id) {
            self.cache.insert(content_id);
            self.used_storage_gb += content_size_gb;
        }
    }

    fn pre_cache_content(&mut self, content_id: usize, content_size_gb: f64) {
        if self.can_cache(content_size_gb) && !self.has_content(content_id) {
            self.pre_cached_content.insert(content_id);
            self.used_storage_gb += content_size_gb;
        }
    }

    fn consume_bandwidth(&mut self, amount: f64, timestamp: u64) {
        let old_utilization = self.bandwidth_utilization();
        self.used_bandwidth_mbps = self.used_bandwidth_mbps.min(self.upload_bandwidth_mbps) + amount.min(self.available_bandwidth());
        let new_utilization = self.bandwidth_utilization();

        if old_utilization < OVERLOAD_THRESHOLD && new_utilization >= OVERLOAD_THRESHOLD {
            self.set_status(NodeStatus::Overloaded, timestamp);
        }
    }

    fn release_bandwidth(&mut self, amount: f64, timestamp: u64) {
        self.used_bandwidth_mbps = (self.used_bandwidth_mbps - amount).max(0.0);
        let new_utilization = self.bandwidth_utilization();

        if self.status == NodeStatus::Overloaded && new_utilization < RECOVERY_THRESHOLD {
            self.set_status(NodeStatus::Healthy, timestamp);
        }
    }

    fn set_status(&mut self, new_status: NodeStatus, timestamp: u64) {
        if self.status != new_status {
            self.status = new_status;
            
            if let Some(event_bus) = &self.event_bus {
                let event = NodeStatusEvent {
                    node_id: self.id,
                    new_status,
                    timestamp,
                };
                event_bus.publish(event);
            }
        }
    }

    fn is_available(&self) -> bool {
        self.status == NodeStatus::Healthy && self.available_bandwidth() > 0.0
    }

    fn clear_pre_cache(&mut self) {
        for content_id in self.pre_cached_content.drain() {
            let size = 1.0;
            self.used_storage_gb = (self.used_storage_gb - size).max(0.0);
        }
    }
}

#[derive(Debug, Clone)]
struct Request {
    id: usize,
    user_location: GeoLocation,
    content_id: usize,
    content_size_gb: f64,
}

impl Request {
    fn new(id: usize) -> Self {
        let mut rng = rand::thread_rng();
        Request {
            id,
            user_location: GeoLocation::random(),
            content_id: rng.gen_range(0..1000),
            content_size_gb: rng.gen_range(0.01..5.0),
        }
    }

    fn with_hot_content_bias(id: usize, hot_content: &[usize]) -> Self {
        let mut rng = rand::thread_rng();
        let content_id = if !hot_content.is_empty() && rng.gen_bool(0.4) {
            hot_content[rng.gen_range(0..hot_content.len())]
        } else {
            rng.gen_range(0..1000)
        };
        
        Request {
            id,
            user_location: GeoLocation::random(),
            content_id,
            content_size_gb: rng.gen_range(0.01..5.0),
        }
    }
}

#[derive(Debug, Clone)]
struct SimulationResult {
    average_response_time_ms: f64,
    bandwidth_utilization: f64,
    cache_hit_rate: f64,
    pre_cache_hit_rate: f64,
    pre_push_count: usize,
    overload_events: usize,
    recovery_events: usize,
}

trait SchedulingAlgorithm {
    fn select_node(&self, request: &Request, nodes: &[EdgeNode]) -> Option<usize>;
}

struct RandomScheduler;

impl SchedulingAlgorithm for RandomScheduler {
    fn select_node(&self, _request: &Request, nodes: &[EdgeNode]) -> Option<usize> {
        let available_nodes: Vec<_> = nodes.iter().filter(|n| n.is_available()).collect();
        if available_nodes.is_empty() {
            return None;
        }
        let mut rng = rand::thread_rng();
        Some(available_nodes[rng.gen_range(0..available_nodes.len())].id)
    }
}

struct NearestNodeScheduler;

impl SchedulingAlgorithm for NearestNodeScheduler {
    fn select_node(&self, request: &Request, nodes: &[EdgeNode]) -> Option<usize> {
        nodes.par_iter()
            .filter(|node| node.is_available())
            .min_by_key(|node| {
                (node.location.distance_to(&request.user_location) * 1000.0) as u64
            })
            .map(|node| node.id)
    }
}

struct LoadBalancedScheduler {
    node_status_cache: Arc<Mutex<HashMap<usize, NodeStatus>>>,
}

impl LoadBalancedScheduler {
    fn new(event_bus: &Arc<EventBus>) -> Self {
        let status_cache = Arc::new(Mutex::new(HashMap::new()));
        let cache_clone = status_cache.clone();
        
        event_bus.subscribe(move |event| {
            let mut cache = cache_clone.lock().unwrap();
            cache.insert(event.node_id, event.new_status);
        });

        LoadBalancedScheduler {
            node_status_cache: status_cache,
        }
    }
}

impl SchedulingAlgorithm for LoadBalancedScheduler {
    fn select_node(&self, request: &Request, nodes: &[EdgeNode]) -> Option<usize> {
        let status_cache = self.node_status_cache.lock().unwrap();
        
        nodes.par_iter()
            .filter(|node| {
                let cached_status = status_cache.get(&node.id).copied().unwrap_or(node.status);
                cached_status == NodeStatus::Healthy && node.available_bandwidth() > 0.0
            })
            .min_by_key(|node| {
                let distance = node.location.distance_to(&request.user_location);
                let load_factor = node.bandwidth_utilization();
                let score = distance * (1.0 + load_factor * 5.0);
                (score * 1000.0) as u64
            })
            .map(|node| node.id)
    }
}

struct CDNSimulator {
    nodes: Vec<EdgeNode>,
    total_bandwidth_capacity: f64,
    event_bus: Arc<EventBus>,
    overload_count: Arc<Mutex<usize>>,
    recovery_count: Arc<Mutex<usize>>,
    request_history: RequestHistory,
    hot_content_pusher: HotContentPusher,
}

impl CDNSimulator {
    fn new(node_count: usize) -> Self {
        let event_bus = Arc::new(EventBus::new());
        let overload_count = Arc::new(Mutex::new(0));
        let recovery_count = Arc::new(Mutex::new(0));

        let oc = overload_count.clone();
        let rc = recovery_count.clone();
        event_bus.subscribe(move |event| {
            match event.new_status {
                NodeStatus::Overloaded => *oc.lock().unwrap() += 1,
                NodeStatus::Healthy => *rc.lock().unwrap() += 1,
            }
        });

        let nodes: Vec<EdgeNode> = (0..node_count)
            .into_par_iter()
            .map(|id| EdgeNode::new(id).with_event_bus(event_bus.clone()))
            .collect();
        
        let total_bandwidth_capacity: f64 = nodes.par_iter()
            .map(|n| n.upload_bandwidth_mbps)
            .sum();

        CDNSimulator {
            nodes,
            total_bandwidth_capacity,
            event_bus,
            overload_count,
            recovery_count,
            request_history: RequestHistory::new(),
            hot_content_pusher: HotContentPusher::new(),
        }
    }

    fn get_event_bus(&self) -> Arc<EventBus> {
        self.event_bus.clone()
    }

    fn build_request_history(&mut self, requests_per_hour: usize, hours: usize) {
        for window in 0..hours {
            for _ in 0..requests_per_hour {
                let mut rng = rand::thread_rng();
                let content_id = rng.gen_range(0..1000);
                let size = rng.gen_range(0.01..5.0);
                self.request_history.record_request(content_id, size, window);
            }
        }
    }

    fn predict_and_push_hot_content(&mut self, predict_hours: usize) -> usize {
        let hot_content = self.request_history.predict_hot_content(predict_hours);
        self.hot_content_pusher.update_hot_content(hot_content);
        self.hot_content_pusher.push_to_nodes(&mut self.nodes, &self.request_history)
    }

    fn get_hot_content_ids(&self) -> Vec<usize> {
        self.hot_content_pusher.get_hot_content()
            .into_iter()
            .map(|(id, _)| id)
            .collect()
    }

    fn calculate_response_time(&self, request: &Request, node_id: usize) -> f64 {
        let node = &self.nodes[node_id];
        let distance = node.location.distance_to(&request.user_location);
        
        let propagation_delay_ms = (distance / 200000.0) * 1000.0;
        
        let bandwidth_allocated = node.available_bandwidth().min(request.content_size_gb * 8.0);
        let transfer_time_ms = if bandwidth_allocated > 0.0 {
            (request.content_size_gb * 8000.0 / bandwidth_allocated) * 1000.0
        } else {
            10000.0
        };

        let cache_penalty = if node.has_content(request.content_id) {
            0.0
        } else {
            500.0
        };

        propagation_delay_ms + transfer_time_ms + cache_penalty
    }

    fn run_simulation(
        &mut self,
        requests: &[Request],
        scheduler: &dyn SchedulingAlgorithm,
        enable_pre_push: bool,
    ) -> SimulationResult {
        *self.overload_count.lock().unwrap() = 0;
        *self.recovery_count.lock().unwrap() = 0;
        
        let pre_push_count = if enable_pre_push {
            self.predict_and_push_hot_content(1)
        } else {
            0
        };

        let mut hit_count = 0;
        let mut pre_cache_hit_count = 0;
        let mut total_response_time = 0.0;
        let mut total_bandwidth_used = 0.0;

        for (timestamp, request) in requests.iter().enumerate() {
            if let Some(node_id) = scheduler.select_node(request, &self.nodes) {
                let node = &mut self.nodes[node_id];
                
                if node.has_content(request.content_id) {
                    hit_count += 1;
                    if node.is_pre_cached(request.content_id) {
                        pre_cache_hit_count += 1;
                    }
                } else if node.can_cache(request.content_size_gb) {
                    node.cache_content(request.content_id, request.content_size_gb);
                }

                let bandwidth_needed = request.content_size_gb * 8.0;
                let bandwidth_used = bandwidth_needed.min(node.available_bandwidth());
                
                node.consume_bandwidth(bandwidth_used, timestamp as u64);
                total_bandwidth_used += bandwidth_used;

                total_response_time += self.calculate_response_time(request, node_id);
            }
        }

        let average_response_time_ms = total_response_time / requests.len() as f64;
        let bandwidth_utilization = total_bandwidth_used / self.total_bandwidth_capacity;
        let cache_hit_rate = hit_count as f64 / requests.len() as f64;
        let pre_cache_hit_rate = if hit_count > 0 {
            pre_cache_hit_count as f64 / hit_count as f64
        } else {
            0.0
        };
        let overload_events = *self.overload_count.lock().unwrap();
        let recovery_events = *self.recovery_count.lock().unwrap();

        SimulationResult {
            average_response_time_ms,
            bandwidth_utilization,
            cache_hit_rate,
            pre_cache_hit_rate,
            pre_push_count,
            overload_events,
            recovery_events,
        }
    }

    fn reset(&mut self) {
        for node in &mut self.nodes {
            node.used_bandwidth_mbps = 0.0;
            node.used_storage_gb = 0.0;
            node.cache.clear();
            node.pre_cached_content.clear();
            node.status = NodeStatus::Healthy;
        }
        *self.overload_count.lock().unwrap() = 0;
        *self.recovery_count.lock().unwrap() = 0;
    }
}

fn main() {
    println!("=== P2P CDN Node Scheduling Simulator ===");
    println!("Simulating 1000 edge nodes with 10000 requests");
    println!("Overload Threshold: {:.0}%, Recovery Threshold: {:.0}%", 
             OVERLOAD_THRESHOLD * 100.0, RECOVERY_THRESHOLD * 100.0);
    println!("Hot Content Prediction: Top {} items, Push to {:.0}% of nodes\n", 
             HOT_CONTENT_TOP_N, PUSH_TO_NODE_RATIO * 100.0);

    let node_count = 1000;
    let request_count = 10000;

    println!("Generating edge nodes...");
    let mut simulator = CDNSimulator::new(node_count);
    let event_bus = simulator.get_event_bus();

    println!("Building request history for prediction...");
    simulator.build_request_history(5000, 6);

    let hot_content_ids = simulator.get_hot_content_ids();
    println!("Predicted {} hot content items!", hot_content_ids.len());

    println!("Generating requests (with 40% hot content bias)...");
    let requests: Vec<Request> = (0..request_count)
        .into_par_iter()
        .map(|id| Request::with_hot_content_bias(id, &hot_content_ids))
        .collect();

    let schedulers: Vec<(&str, Box<dyn SchedulingAlgorithm>)> = vec![
        ("Random Scheduling", Box::new(RandomScheduler)),
        ("Nearest Node Scheduling", Box::new(NearestNodeScheduler)),
        ("Load-Balanced Scheduling (Event-Driven)", Box::new(LoadBalancedScheduler::new(&event_bus))),
    ];

    for (name, scheduler) in schedulers {
        simulator.reset();
        println!("\n=== {} ===", name);
        
        println!("\n--- Without Pre-Push ---");
        let result_without = simulator.run_simulation(&requests, scheduler.as_ref(), false);
        println!("Average Response Time: {:.2} ms", result_without.average_response_time_ms);
        println!("Bandwidth Utilization: {:.2}%", result_without.bandwidth_utilization * 100.0);
        println!("Cache Hit Rate: {:.2}%", result_without.cache_hit_rate * 100.0);
        println!("Overload Events: {}", result_without.overload_events);

        simulator.reset();
        println!("\n--- With Hot Content Pre-Push ---");
        let result_with = simulator.run_simulation(&requests, scheduler.as_ref(), true);
        println!("Average Response Time: {:.2} ms", result_with.average_response_time_ms);
        println!("Bandwidth Utilization: {:.2}%", result_with.bandwidth_utilization * 100.0);
        println!("Cache Hit Rate: {:.2}%", result_with.cache_hit_rate * 100.0);
        println!("Pre-Cache Hit Rate: {:.2}%", result_with.pre_cache_hit_rate * 100.0);
        println!("Content Items Pushed: {}", result_with.pre_push_count);
        println!("Overload Events: {}", result_with.overload_events);

        let time_improvement = (result_without.average_response_time_ms - result_with.average_response_time_ms) 
            / result_without.average_response_time_ms * 100.0;
        let hit_rate_improvement = (result_with.cache_hit_rate - result_without.cache_hit_rate) 
            / result_without.cache_hit_rate * 100.0;

        println!("\n--- Improvement ---");
        println!("Response Time: {:.2}%", time_improvement);
        println!("Cache Hit Rate: {:.2}%", hit_rate_improvement);
    }

    println!("\n=== Simulation Complete ===");
    println!("\nKey Features:");
    println!("- Event-driven status updates (no 5s health check delay)");
    println!("- Time-decay based hot content prediction");
    println!("- Proactive content pre-push to edge nodes");
    println!("- Pre-cache hit rate tracking and comparison");
}
