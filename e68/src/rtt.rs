use std::time::{Duration, Instant};

#[derive(Debug, Clone)]
pub struct RttEstimator {
    smoothed_rtt: Duration,
    rtt_var: Duration,
    min_rtt: Duration,
    first_measurement: bool,
    min_rto: Duration,
    max_rto: Duration,
}

impl Default for RttEstimator {
    fn default() -> Self {
        Self::new()
    }
}

impl RttEstimator {
    pub fn new() -> Self {
        Self {
            smoothed_rtt: Duration::from_millis(200),
            rtt_var: Duration::from_millis(100),
            min_rtt: Duration::MAX,
            first_measurement: true,
            min_rto: Duration::from_millis(200),
            max_rto: Duration::from_secs(60),
        }
    }

    pub fn update(&mut self, rtt: Duration, is_retransmit: bool) {
        if rtt.is_zero() {
            return;
        }

        if is_retransmit {
            return;
        }

        if rtt < self.min_rtt {
            self.min_rtt = rtt;
        }

        if self.first_measurement {
            self.smoothed_rtt = rtt;
            self.rtt_var = rtt / 2;
            self.first_measurement = false;
        } else {
            let rtt_var = self.rtt_var.as_micros() as i64;
            let smoothed_rtt = self.smoothed_rtt.as_micros() as i64;
            let rtt_micros = rtt.as_micros() as i64;

            let delta = rtt_micros - smoothed_rtt;
            let new_smoothed_rtt = smoothed_rtt + delta / 8;
            let new_rtt_var = rtt_var + (delta.abs() - rtt_var) / 4;

            self.smoothed_rtt = Duration::from_micros(new_smoothed_rtt.max(0) as u64);
            self.rtt_var = Duration::from_micros(new_rtt_var.max(0) as u64);
        }
    }

    pub fn update_for_retransmit(&mut self) {
        self.smoothed_rtt = self.smoothed_rtt * 2;
        self.rtt_var = self.rtt_var * 2;
    }

    pub fn smoothed_rtt(&self) -> Duration {
        self.smoothed_rtt
    }

    pub fn rtt_var(&self) -> Duration {
        self.rtt_var
    }

    pub fn min_rtt(&self) -> Duration {
        self.min_rtt
    }

    pub fn rto(&self) -> Duration {
        let rto = self.smoothed_rtt + self.rtt_var * 4;
        rto.clamp(self.min_rto, self.max_rto)
    }
}

#[derive(Debug, Clone)]
pub struct InflightPacket {
    pub seq_num: u32,
    pub sent_time: Instant,
    pub size: usize,
    pub retransmitted: bool,
    pub rto_count: u32,
    pub transmitted: bool,
}

impl InflightPacket {
    pub fn new(seq_num: u32, size: usize) -> Self {
        Self {
            seq_num,
            sent_time: Instant::now(),
            size,
            retransmitted: false,
            rto_count: 0,
            transmitted: true,
        }
    }

    pub fn retransmit(&mut self) {
        self.sent_time = Instant::now();
        self.retransmitted = true;
        self.rto_count += 1;
        self.transmitted = true;
    }

    pub fn elapsed(&self) -> Duration {
        self.sent_time.elapsed()
    }

    pub fn is_timed_out(&self, rto: Duration) -> bool {
        self.elapsed() > rto
    }

    pub fn current_rto(&self, base_rto: Duration) -> Duration {
        let exponent = std::cmp::min(self.rto_count, 6);
        base_rto * (1 << exponent)
    }
}
