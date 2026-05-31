use std::time::{Duration, Instant};
use std::collections::VecDeque;

#[derive(Debug, Clone)]
pub struct RttSample {
    pub timestamp: Instant,
    pub rtt: Duration,
    pub smoothed_rtt: Duration,
    pub rtt_var: Duration,
}

#[derive(Debug, Clone)]
pub struct CwndSample {
    pub timestamp: Instant,
    pub cwnd: u32,
    pub state: &'static str,
    pub inflight: u32,
}

#[derive(Debug, Clone)]
pub struct LossEvent {
    pub timestamp: Instant,
    pub seq_num: u32,
    pub is_timeout: bool,
    pub rto: Option<Duration>,
}

#[derive(Debug, Clone)]
pub struct StreamStats {
    pub stream_id: u32,
    pub bytes_sent: u64,
    pub bytes_recv: u64,
    pub bytes_retrans: u64,
    pub packets_sent: u64,
    pub packets_recv: u64,
    pub packets_retrans: u64,
    pub created_at: Instant,
    pub closed_at: Option<Instant>,
}

impl Default for StreamStats {
    fn default() -> Self {
        Self::new(0)
    }
}

impl StreamStats {
    pub fn new(stream_id: u32) -> Self {
        Self {
            stream_id,
            bytes_sent: 0,
            bytes_recv: 0,
            bytes_retrans: 0,
            packets_sent: 0,
            packets_recv: 0,
            packets_retrans: 0,
            created_at: Instant::now(),
            closed_at: None,
        }
    }

    pub fn duration(&self) -> Duration {
        self.closed_at.unwrap_or_else(Instant::now)
            .duration_since(self.created_at)
    }

    pub fn throughput(&self) -> f64 {
        let dur = self.duration().as_secs_f64();
        if dur > 0.0 {
            self.bytes_sent as f64 / dur
        } else {
            0.0
        }
    }
}

#[derive(Debug, Clone)]
pub struct ConnectionStats {
    pub start_time: Instant,
    pub total_bytes_sent: u64,
    pub total_bytes_recv: u64,
    pub total_packets_sent: u64,
    pub total_packets_recv: u64,
    pub total_retrans_packets: u64,
    pub total_acks: u64,
    pub total_dupacks: u64,
    pub total_timeouts: u64,
    pub total_fast_retrans: u64,
    pub zero_rtt_accepted: bool,
    pub connection_migrations: u32,
    
    rtt_history: VecDeque<RttSample>,
    cwnd_history: VecDeque<CwndSample>,
    loss_events: VecDeque<LossEvent>,
    
    min_rtt: Duration,
    max_rtt: Duration,
    last_rtt: Duration,
    
    stream_stats: std::collections::HashMap<u32, StreamStats>,
    
    max_history_size: usize,
}

impl Default for ConnectionStats {
    fn default() -> Self {
        Self::new()
    }
}

impl ConnectionStats {
    pub fn new() -> Self {
        Self {
            start_time: Instant::now(),
            total_bytes_sent: 0,
            total_bytes_recv: 0,
            total_packets_sent: 0,
            total_packets_recv: 0,
            total_retrans_packets: 0,
            total_acks: 0,
            total_dupacks: 0,
            total_timeouts: 0,
            total_fast_retrans: 0,
            zero_rtt_accepted: false,
            connection_migrations: 0,
            rtt_history: VecDeque::new(),
            cwnd_history: VecDeque::new(),
            loss_events: VecDeque::new(),
            min_rtt: Duration::MAX,
            max_rtt: Duration::ZERO,
            last_rtt: Duration::ZERO,
            stream_stats: std::collections::HashMap::new(),
            max_history_size: 1000,
        }
    }

    pub fn record_rtt(&mut self, rtt: Duration, smoothed_rtt: Duration, rtt_var: Duration) {
        self.last_rtt = rtt;
        self.min_rtt = self.min_rtt.min(rtt);
        self.max_rtt = self.max_rtt.max(rtt);

        self.rtt_history.push_back(RttSample {
            timestamp: Instant::now(),
            rtt,
            smoothed_rtt,
            rtt_var,
        });

        if self.rtt_history.len() > self.max_history_size {
            self.rtt_history.pop_front();
        }
    }

    pub fn record_cwnd(&mut self, cwnd: u32, state: &'static str, inflight: u32) {
        self.cwnd_history.push_back(CwndSample {
            timestamp: Instant::now(),
            cwnd,
            state,
            inflight,
        });

        if self.cwnd_history.len() > self.max_history_size {
            self.cwnd_history.pop_front();
        }
    }

    pub fn record_loss(&mut self, seq_num: u32, is_timeout: bool, rto: Option<Duration>) {
        self.loss_events.push_back(LossEvent {
            timestamp: Instant::now(),
            seq_num,
            is_timeout,
            rto,
        });

        if is_timeout {
            self.total_timeouts += 1;
        } else {
            self.total_fast_retrans += 1;
        }

        if self.loss_events.len() > self.max_history_size {
            self.loss_events.pop_front();
        }
    }

    pub fn record_retransmit(&mut self, count: u64) {
        self.total_retrans_packets += count;
    }

    pub fn record_ack(&mut self, is_dup: bool) {
        self.total_acks += 1;
        if is_dup {
            self.total_dupacks += 1;
        }
    }

    pub fn get_or_create_stream(&mut self, stream_id: u32) -> &mut StreamStats {
        self.stream_stats
            .entry(stream_id)
            .or_insert_with(|| StreamStats::new(stream_id))
    }

    pub fn record_stream_send(&mut self, stream_id: u32, bytes: u64, is_retrans: bool) {
        let stats = self.get_or_create_stream(stream_id);
        stats.bytes_sent += bytes;
        stats.packets_sent += 1;
        if is_retrans {
            stats.bytes_retrans += bytes;
            stats.packets_retrans += 1;
        }
    }

    pub fn record_stream_recv(&mut self, stream_id: u32, bytes: u64) {
        let stats = self.get_or_create_stream(stream_id);
        stats.bytes_recv += bytes;
        stats.packets_recv += 1;
    }

    pub fn close_stream(&mut self, stream_id: u32) {
        if let Some(stats) = self.stream_stats.get_mut(&stream_id) {
            stats.closed_at = Some(Instant::now());
        }
    }

    pub fn retransmission_rate(&self) -> f64 {
        if self.total_packets_sent == 0 {
            0.0
        } else {
            self.total_retrans_packets as f64 / self.total_packets_sent as f64
        }
    }

    pub fn loss_rate(&self) -> f64 {
        if self.total_packets_sent == 0 {
            0.0
        } else {
            (self.total_timeouts + self.total_fast_retrans) as f64 / self.total_packets_sent as f64
        }
    }

    pub fn average_throughput(&self) -> f64 {
        let dur = self.start_time.elapsed().as_secs_f64();
        if dur > 0.0 {
            self.total_bytes_sent as f64 / dur
        } else {
            0.0
        }
    }

    pub fn average_rtt(&self) -> Duration {
        if self.rtt_history.is_empty() {
            return Duration::ZERO;
        }
        
        let total_micros: u64 = self.rtt_history
            .iter()
            .map(|s| s.rtt.as_micros() as u64)
            .sum();
        
        Duration::from_micros(total_micros / self.rtt_history.len() as u64)
    }

    pub fn get_rtt_history(&self) -> &VecDeque<RttSample> {
        &self.rtt_history
    }

    pub fn get_cwnd_history(&self) -> &VecDeque<CwndSample> {
        &self.cwnd_history
    }

    pub fn get_loss_events(&self) -> &VecDeque<LossEvent> {
        &self.loss_events
    }

    pub fn get_stream_stats(&self, stream_id: u32) -> Option<&StreamStats> {
        self.stream_stats.get(&stream_id)
    }

    pub fn get_all_stream_stats(&self) -> Vec<&StreamStats> {
        self.stream_stats.values().collect()
    }

    pub fn duration(&self) -> Duration {
        self.start_time.elapsed()
    }

    pub fn print_summary(&self) {
        println!("\n=== 传输统计摘要 ===");
        println!("连接时长: {:.2?}", self.duration());
        println!("总发送: {} 字节 ({} 包)", self.total_bytes_sent, self.total_packets_sent);
        println!("总接收: {} 字节 ({} 包)", self.total_bytes_recv, self.total_packets_recv);
        println!("平均吞吐量: {:.2} MB/s", self.average_throughput() / 1024.0 / 1024.0);
        println!();
        println!("RTT统计:");
        println!("  最小: {:.2?}", self.min_rtt);
        println!("  最大: {:.2?}", self.max_rtt);
        println!("  平均: {:.2?}", self.average_rtt());
        println!("  最新: {:.2?}", self.last_rtt);
        println!();
        println!("丢包/重传:");
        println!("  超时次数: {}", self.total_timeouts);
        println!("  快速重传: {}", self.total_fast_retrans);
        println!("  重复ACK: {}", self.total_dupacks);
        println!("  重传率: {:.2}%", self.retransmission_rate() * 100.0);
        println!("  丢包率: {:.2}%", self.loss_rate() * 100.0);
        println!();
        println!("高级特性:");
        println!("  0-RTT接受: {}", if self.zero_rtt_accepted { "是" } else { "否" });
        println!("  连接迁移次数: {}", self.connection_migrations);
        println!();
        println!("活跃流: {} 个", self.stream_stats.len());
        for (id, stats) in &self.stream_stats {
            if stats.closed_at.is_none() {
                println!("  流 {}: 发送 {} 字节, 接收 {} 字节",
                    id, stats.bytes_sent, stats.bytes_recv);
            }
        }
    }

    pub fn generate_cwnd_report(&self) -> String {
        let mut report = String::from("CWND变化报告:\n");
        for sample in self.cwnd_history.iter().step_by(10.max(1)) {
            report.push_str(&format!(
                "  {:?} - cwnd={}, state={}, inflight={}\n",
                sample.timestamp.duration_since(self.start_time),
                sample.cwnd,
                sample.state,
                sample.inflight
            ));
        }
        report
    }
}
