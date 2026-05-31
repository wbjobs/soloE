use std::collections::BTreeMap;
use bytes::Bytes;

#[derive(Debug, Clone)]
pub struct SendWindow {
    base: u32,
    next_seq: u32,
    capacity: u32,
    peer_window: u32,
    inflight: BTreeMap<u32, Bytes>,
    max_inflight_bytes: usize,
}

impl SendWindow {
    pub fn new(initial_seq: u32, capacity: u32) -> Self {
        Self {
            base: initial_seq,
            next_seq: initial_seq,
            capacity,
            peer_window: capacity,
            inflight: BTreeMap::new(),
            max_inflight_bytes: 10 * 1024 * 1024,
        }
    }

    pub fn can_send(&self, data_len: u32) -> bool {
        let used = self.next_seq - self.base;
        let available = self.available_window();
        used + data_len <= available
    }

    pub fn available_window(&self) -> u32 {
        std::cmp::min(self.capacity, self.peer_window)
    }

    pub fn send(&mut self, data: Bytes) -> Option<u32> {
        if !self.can_send(1) {
            return None;
        }

        let seq = self.next_seq;
        self.inflight.insert(seq, data);
        self.next_seq += 1;
        Some(seq)
    }

    pub fn ack(&mut self, ack_num: u32) -> Vec<(u32, Bytes)> {
        let mut acked = Vec::new();

        while self.base < ack_num {
            if let Some(data) = self.inflight.remove(&self.base) {
                acked.push((self.base, data));
            }
            self.base += 1;
        }

        acked
    }

    pub fn update_peer_window(&mut self, window_size: u32) {
        self.peer_window = window_size;
    }

    pub fn inflight_count(&self) -> usize {
        self.inflight.len()
    }

    pub fn get_inflight(&self, seq: u32) -> Option<&Bytes> {
        self.inflight.get(&seq)
    }

    pub fn base(&self) -> u32 {
        self.base
    }

    pub fn next_seq(&self) -> u32 {
        self.next_seq
    }

    pub fn get_inflight_range(&self) -> Vec<u32> {
        self.inflight.keys().cloned().collect()
    }
}

#[derive(Debug, Clone)]
pub struct RecvWindow {
    base: u32,
    capacity: u32,
    received: BTreeMap<u32, Bytes>,
    max_memory: usize,
    current_memory: usize,
    max_hole_size: u32,
}

impl RecvWindow {
    pub fn new(initial_seq: u32, capacity: u32) -> Self {
        Self {
            base: initial_seq,
            capacity,
            received: BTreeMap::new(),
            max_memory: 10 * 1024 * 1024,
            current_memory: 0,
            max_hole_size: 1000,
        }
    }

    pub fn receive(&mut self, seq: u32, data: Bytes) -> bool {
        if seq < self.base {
            return false;
        }

        if seq >= self.base + self.capacity {
            return false;
        }

        let hole_size = seq - self.base;
        if hole_size > self.max_hole_size {
            return false;
        }

        if self.received.contains_key(&seq) {
            return true;
        }

        let new_memory = self.current_memory + data.len();
        if new_memory > self.max_memory {
            return false;
        }

        self.current_memory = new_memory;
        self.received.insert(seq, data);
        true
    }

    pub fn read_available(&mut self) -> Vec<Bytes> {
        let mut available = Vec::new();

        while let Some(data) = self.received.remove(&self.base) {
            self.current_memory -= data.len();
            available.push(data);
            self.base += 1;
        }

        available
    }

    pub fn window_size(&self) -> u32 {
        std::cmp::min(
            self.capacity - self.received.len() as u32,
            (self.max_memory.saturating_sub(self.current_memory) / 1400) as u32
        )
    }

    pub fn base(&self) -> u32 {
        self.base
    }

    pub fn highest_received(&self) -> u32 {
        self.received.keys().next_back().copied().unwrap_or(self.base - 1)
    }

    pub fn get_sack_blocks(&self) -> Vec<(u32, u32)> {
        let mut blocks = Vec::new();
        let mut current_start: Option<u32> = None;

        for &seq in self.received.keys() {
            if seq < self.base {
                continue;
            }

            match current_start {
                None => {
                    current_start = Some(seq);
                }
                Some(start) => {
                    if seq > self.highest_received_in_range(start) + 1 {
                        blocks.push((start, self.highest_received_in_range(start)));
                        current_start = Some(seq);
                    }
                }
            }
        }

        if let Some(start) = current_start {
            blocks.push((start, self.highest_received_in_range(start)));
        }

        blocks.truncate(10);
        blocks
    }

    fn highest_received_in_range(&self, start: u32) -> u32 {
        let mut seq = start;
        while self.received.contains_key(&(seq + 1)) {
            seq += 1;
        }
        seq
    }

    pub fn memory_usage(&self) -> usize {
        self.current_memory
    }

    pub fn clear_old_packets(&mut self, max_age: u32) {
        let cutoff = self.base.saturating_sub(max_age);
        while let Some((&seq, _)) = self.received.first_key_value() {
            if seq < cutoff {
                if let Some(data) = self.received.remove(&seq) {
                    self.current_memory -= data.len();
                }
            } else {
                break;
            }
        }
    }
}
