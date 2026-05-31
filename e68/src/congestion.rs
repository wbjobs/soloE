use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CongestionState {
    SlowStart,
    CongestionAvoidance,
    Recovery,
}

#[derive(Debug, Clone)]
pub struct NewReno {
    state: CongestionState,
    cwnd: u32,
    ssthresh: u32,
    recover: u32,
    acked_bytes: u32,
    max_cwnd: u32,
    min_cwnd: u32,
    initial_cwnd: u32,
    last_recovery_start: Option<Instant>,
    recovery_cooldown: Duration,
}

impl Default for NewReno {
    fn default() -> Self {
        Self::new()
    }
}

impl NewReno {
    pub fn new() -> Self {
        let initial_cwnd = 2;
        Self {
            state: CongestionState::SlowStart,
            cwnd: initial_cwnd,
            ssthresh: 100,
            recover: 0,
            acked_bytes: 0,
            max_cwnd: 1000,
            min_cwnd: 2,
            initial_cwnd,
            last_recovery_start: None,
            recovery_cooldown: Duration::from_millis(500),
        }
    }

    pub fn with_initial_cwnd(initial_cwnd: u32) -> Self {
        Self {
            state: CongestionState::SlowStart,
            cwnd: initial_cwnd,
            ssthresh: 100,
            recover: 0,
            acked_bytes: 0,
            max_cwnd: 1000,
            min_cwnd: 2,
            initial_cwnd,
            last_recovery_start: None,
            recovery_cooldown: Duration::from_millis(500),
        }
    }

    pub fn on_ack(&mut self, acked: u32) {
        if self.state == CongestionState::Recovery {
            if self.recover > 0 && acked >= self.recover {
                self.on_recovery_complete();
            }
            return;
        }

        match self.state {
            CongestionState::SlowStart => {
                self.cwnd += 1;
                if self.cwnd >= self.ssthresh {
                    self.state = CongestionState::CongestionAvoidance;
                    self.acked_bytes = 0;
                }
            }
            CongestionState::CongestionAvoidance => {
                self.acked_bytes += 1;
                if self.acked_bytes >= self.cwnd {
                    self.cwnd += 1;
                    self.acked_bytes = 0;
                }
            }
            CongestionState::Recovery => {}
        }

        self.cwnd = self.cwnd.clamp(self.min_cwnd, self.max_cwnd);
    }

    pub fn on_duplicate_ack(&mut self, dup_acks: u32, highest_seq: u32) -> bool {
        if dup_acks < 3 {
            return false;
        }

        if highest_seq <= self.recover {
            return false;
        }

        if let Some(last_recovery) = self.last_recovery_start {
            if last_recovery.elapsed() < self.recovery_cooldown {
                return false;
            }
        }

        self.fast_retransmit(highest_seq);
        true
    }

    pub fn on_timeout(&mut self) {
        self.ssthresh = std::cmp::max(self.cwnd / 2, self.min_cwnd);
        self.cwnd = self.min_cwnd;
        self.state = CongestionState::SlowStart;
        self.acked_bytes = 0;
        self.recover = 0;
        self.last_recovery_start = None;
    }

    fn fast_retransmit(&mut self, highest_seq: u32) {
        self.ssthresh = std::cmp::max(self.cwnd / 2, self.min_cwnd);
        self.cwnd = self.ssthresh + 3;
        self.state = CongestionState::Recovery;
        self.recover = highest_seq;
        self.last_recovery_start = Some(Instant::now());
        self.acked_bytes = 0;
    }

    pub fn on_recovery_complete(&mut self) {
        self.cwnd = self.ssthresh;
        self.state = CongestionState::CongestionAvoidance;
        self.acked_bytes = 0;
        self.recover = 0;
    }

    pub fn cwnd(&self) -> u32 {
        self.cwnd
    }

    pub fn ssthresh(&self) -> u32 {
        self.ssthresh
    }

    pub fn state(&self) -> CongestionState {
        self.state
    }

    pub fn can_send(&self, inflight: u32) -> bool {
        inflight < self.cwnd
    }

    pub fn in_recovery(&self) -> bool {
        self.state == CongestionState::Recovery
    }
}

#[derive(Debug, Clone)]
pub struct Pacer {
    last_send_time: Instant,
    min_packet_interval: Duration,
    max_burst: u32,
    burst_count: u32,
}

impl Default for Pacer {
    fn default() -> Self {
        Self::new()
    }
}

impl Pacer {
    pub fn new() -> Self {
        Self {
            last_send_time: Instant::now(),
            min_packet_interval: Duration::from_micros(100),
            max_burst: 10,
            burst_count: 0,
        }
    }

    pub fn update_rate(&mut self, cwnd: u32, rtt: Duration) {
        if rtt.is_zero() {
            return;
        }
        let packets_per_second = cwnd as f64 / rtt.as_secs_f64();
        if packets_per_second > 0.0 {
            let interval = 1_000_000.0 / packets_per_second;
            self.min_packet_interval = Duration::from_micros(interval as u64);
        }
        self.max_burst = std::cmp::max(cwnd / 4, 2);
    }

    pub fn can_send(&mut self) -> bool {
        let now = Instant::now();
        let elapsed = now.duration_since(self.last_send_time);

        if elapsed >= self.min_packet_interval {
            self.burst_count = 0;
            self.last_send_time = now;
            true
        } else if self.burst_count < self.max_burst {
            self.burst_count += 1;
            true
        } else {
            false
        }
    }

    pub fn wait_time(&self) -> Duration {
        let elapsed = self.last_send_time.elapsed();
        if elapsed < self.min_packet_interval {
            self.min_packet_interval - elapsed
        } else {
            Duration::ZERO
        }
    }

    pub fn notify_sent(&mut self) {
        self.last_send_time = Instant::now();
    }
}
