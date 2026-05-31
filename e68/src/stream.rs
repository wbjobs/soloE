use crate::window::{RecvWindow, SendWindow};
use bytes::{Buf, Bytes, BytesMut};
use std::collections::BTreeMap;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamState {
    Open,
    SendFin,
    RecvFin,
    Closed,
    Reset,
}

#[derive(Debug, Clone)]
pub struct Stream {
    pub id: u32,
    pub state: StreamState,
    
    send_window: SendWindow,
    recv_window: RecvWindow,
    
    send_buf: BytesMut,
    recv_buf: BytesMut,
    
    bytes_sent: u64,
    bytes_recv: u64,
    
    creation_time: Instant,
    last_active: Instant,
    
    send_fin_seq: Option<u32>,
    recv_fin_seq: Option<u32>,
}

impl Stream {
    pub fn new(id: u32, initial_send_seq: u32, window_size: u32) -> Self {
        let now = Instant::now();
        Self {
            id,
            state: StreamState::Open,
            send_window: SendWindow::new(initial_send_seq, window_size),
            recv_window: RecvWindow::new(0, window_size),
            send_buf: BytesMut::new(),
            recv_buf: BytesMut::new(),
            bytes_sent: 0,
            bytes_recv: 0,
            creation_time: now,
            last_active: now,
            send_fin_seq: None,
            recv_fin_seq: None,
        }
    }

    pub fn send(&mut self, data: &[u8]) -> usize {
        if self.state != StreamState::Open && self.state != StreamState::RecvFin {
            return 0;
        }
        self.send_buf.extend_from_slice(data);
        self.last_active = Instant::now();
        data.len()
    }

    pub fn get_send_data(&mut self, max_size: usize) -> Option<(u32, Bytes)> {
        if self.send_buf.is_empty() {
            return None;
        }
        
        let chunk_size = std::cmp::min(max_size, self.send_buf.len());
        let chunk: Bytes = self.send_buf.split_to(chunk_size).freeze();
        let seq = self.send_window.send(chunk.clone())?;
        
        Some((seq, chunk))
    }

    pub fn receive(&mut self, seq: u32, data: Bytes) -> bool {
        if self.state == StreamState::Closed || self.state == StreamState::Reset {
            return false;
        }
        
        let result = self.recv_window.receive(seq, data);
        if result {
            self.last_active = Instant::now();
        }
        result
    }

    pub fn read_available(&mut self) -> Vec<Bytes> {
        let available = self.recv_window.read_available();
        self.bytes_recv += available.iter().map(|b| b.len() as u64).sum::<u64>();
        self.last_active = Instant::now();
        available
    }

    pub fn ack(&mut self, ack_num: u32) -> usize {
        let acked = self.send_window.ack(ack_num);
        self.last_active = Instant::now();
        acked.len()
    }

    pub fn close_send(&mut self, seq: u32) {
        if self.state == StreamState::Open {
            self.state = StreamState::SendFin;
        } else if self.state == StreamState::RecvFin {
            self.state = StreamState::Closed;
        }
        self.send_fin_seq = Some(seq);
    }

    pub fn close_recv(&mut self, seq: u32) -> bool {
        self.recv_fin_seq = Some(seq);
        if self.state == StreamState::Open {
            self.state = StreamState::RecvFin;
            false
        } else if self.state == StreamState::SendFin {
            self.state = StreamState::Closed;
            true
        } else {
            false
        }
    }

    pub fn reset(&mut self) {
        self.state = StreamState::Reset;
        self.send_buf.clear();
        self.recv_buf.clear();
    }

    pub fn is_closed(&self) -> bool {
        matches!(self.state, StreamState::Closed | StreamState::Reset)
    }

    pub fn can_send(&self) -> bool {
        !self.send_buf.is_empty() 
            && self.send_window.can_send(1) 
            && !self.is_closed()
    }

    pub fn has_data(&self) -> bool {
        !self.send_buf.is_empty() || self.send_window.inflight_count() > 0
    }

    pub fn idle_time(&self) -> Duration {
        self.last_active.elapsed()
    }

    pub fn update_peer_window(&mut self, window_size: u32) {
        self.send_window.update_peer_window(window_size);
    }

    pub fn inflight_count(&self) -> usize {
        self.send_window.inflight_count()
    }

    pub fn get_inflight_data(&self, seq: u32) -> Option<Bytes> {
        self.send_window.get_inflight(seq).cloned()
    }
}

#[derive(Debug, Clone)]
pub struct StreamManager {
    streams: BTreeMap<u32, Stream>,
    max_streams: u32,
    next_stream_id: u32,
    initial_window_size: u32,
}

impl StreamManager {
    pub fn new(max_streams: u32, initial_window_size: u32) -> Self {
        Self {
            streams: BTreeMap::new(),
            max_streams,
            next_stream_id: 0,
            initial_window_size,
        }
    }

    pub fn create_stream(&mut self, initial_seq: u32) -> Option<u32> {
        if self.streams.len() >= self.max_streams as usize {
            return None;
        }

        let stream_id = self.next_stream_id;
        let stream = Stream::new(stream_id, initial_seq, self.initial_window_size);
        self.streams.insert(stream_id, stream);
        self.next_stream_id += 2;
        
        Some(stream_id)
    }

    pub fn create_stream_with_id(&mut self, stream_id: u32, initial_seq: u32) -> bool {
        if self.streams.len() >= self.max_streams as usize {
            return false;
        }
        if self.streams.contains_key(&stream_id) {
            return false;
        }

        let stream = Stream::new(stream_id, initial_seq, self.initial_window_size);
        self.streams.insert(stream_id, stream);
        self.next_stream_id = self.next_stream_id.max(stream_id + 2);
        true
    }

    pub fn get_stream(&self, stream_id: u32) -> Option<&Stream> {
        self.streams.get(&stream_id)
    }

    pub fn get_stream_mut(&mut self, stream_id: u32) -> Option<&mut Stream> {
        self.streams.get_mut(&stream_id)
    }

    pub fn get_or_create_stream(&mut self, stream_id: u32, initial_seq: u32) -> &mut Stream {
        self.streams.entry(stream_id).or_insert_with(|| {
            Stream::new(stream_id, initial_seq, self.initial_window_size)
        })
    }

    pub fn remove_stream(&mut self, stream_id: u32) -> Option<Stream> {
        self.streams.remove(&stream_id)
    }

    pub fn active_streams(&self) -> Vec<u32> {
        self.streams.keys().copied().collect()
    }

    pub fn active_count(&self) -> usize {
        self.streams.len()
    }

    pub fn get_streams_with_data(&self) -> Vec<u32> {
        self.streams
            .iter()
            .filter(|(_, s)| s.has_data() && !s.is_closed())
            .map(|(id, _)| *id)
            .collect()
    }

    pub fn get_idle_streams(&self, timeout: Duration) -> Vec<u32> {
        self.streams
            .iter()
            .filter(|(_, s)| s.idle_time() > timeout)
            .map(|(id, _)| *id)
            .collect()
    }

    pub fn total_bytes_sent(&self) -> u64 {
        self.streams.values().map(|s| s.bytes_sent).sum()
    }

    pub fn total_bytes_recv(&self) -> u64 {
        self.streams.values().map(|s| s.bytes_recv).sum()
    }

    pub fn cleanup_closed(&mut self) -> usize {
        let closed: Vec<u32> = self.streams
            .iter()
            .filter(|(_, s)| s.is_closed())
            .map(|(id, _)| *id)
            .collect();
        
        let count = closed.len();
        for id in closed {
            self.streams.remove(&id);
        }
        count
    }

    pub fn set_next_stream_id(&mut self, id: u32) {
        self.next_stream_id = id;
    }
}
