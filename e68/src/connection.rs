use crate::congestion::{CongestionState, NewReno, Pacer};
use crate::metrics::ConnectionStats;
use crate::packet::{Packet, PacketType, SessionTicket, MAX_PACKET_SIZE, CONNECTION_ID_SIZE};
use crate::rtt::{InflightPacket, RttEstimator};
use crate::stream::{Stream, StreamManager, StreamState};
use crate::window::{RecvWindow, SendWindow};
use bytes::{Buf, Bytes, BytesMut};
use rand::Rng;
use std::collections::{HashMap, VecDeque};
use std::net::{SocketAddr, ToSocketAddrs};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};
use tokio::net::UdpSocket;
use tokio::sync::mpsc;
use tokio::time::timeout;

const WINDOW_CAPACITY: u32 = 1024;
const MAX_PAYLOAD_SIZE: usize = MAX_PACKET_SIZE - 50;
const MAX_RETRIES: u32 = 15;
const MAX_STREAMS: u32 = 100;
const PATH_CHALLENGE_SIZE: usize = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionState {
    Closed,
    SynSent,
    SynReceived,
    Established,
    FinWait,
    CloseWait,
    ZeroRttSent,
}

#[derive(Debug, Clone)]
pub struct PathInfo {
    pub addr: SocketAddr,
    pub connection_id: [u8; CONNECTION_ID_SIZE],
    pub validated: bool,
    pub challenge: Option<[u8; PATH_CHALLENGE_SIZE]>,
    pub challenge_sent: Option<Instant>,
    pub rtt_estimator: RttEstimator,
    pub total_packets: u64,
}

impl PathInfo {
    pub fn new(addr: SocketAddr, connection_id: [u8; CONNECTION_ID_SIZE]) -> Self {
        Self {
            addr,
            connection_id,
            validated: true,
            challenge: None,
            challenge_sent: None,
            rtt_estimator: RttEstimator::new(),
            total_packets: 0,
        }
    }
}

pub struct Connection {
    socket: Arc<UdpSocket>,
    state: ConnectionState,

    local_cid: [u8; CONNECTION_ID_SIZE],
    remote_cid: [u8; CONNECTION_ID_SIZE],

    paths: HashMap<SocketAddr, PathInfo>,
    active_path: SocketAddr,

    local_seq: u32,
    remote_seq: u32,

    send_window: SendWindow,
    recv_window: RecvWindow,

    stream_manager: StreamManager,

    rtt_estimator: RttEstimator,
    congestion: NewReno,
    pacer: Pacer,

    inflight: HashMap<u32, InflightPacket>,
    inflight_stream: HashMap<u32, u32>,
    last_ack_num: u32,
    dup_ack_count: u32,

    send_buf: BytesMut,

    retransmit_queue: VecDeque<u32>,
    max_inflight: usize,

    loss_count: u32,
    last_loss_time: Option<Instant>,

    session_ticket: Option<SessionTicket>,
    zero_rtt_data: VecDeque<Bytes>,
    zero_rtt_accepted: bool,

    metrics: ConnectionStats,

    path_validation_pending: Option<SocketAddr>,
}

impl Connection {
    pub fn new(socket: Arc<UdpSocket>, peer_addr: SocketAddr) -> Self {
        let mut rng = rand::thread_rng();
        let initial_seq = rng.gen();
        let local_cid = Self::generate_cid();

        Self {
            socket,
            state: ConnectionState::Closed,
            local_cid,
            remote_cid: [0; CONNECTION_ID_SIZE],
            paths: HashMap::new(),
            active_path: peer_addr,
            local_seq: initial_seq,
            remote_seq: 0,
            send_window: SendWindow::new(initial_seq, WINDOW_CAPACITY),
            recv_window: RecvWindow::new(0, WINDOW_CAPACITY),
            stream_manager: StreamManager::new(MAX_STREAMS, WINDOW_CAPACITY),
            rtt_estimator: RttEstimator::new(),
            congestion: NewReno::new(),
            pacer: Pacer::new(),
            inflight: HashMap::new(),
            inflight_stream: HashMap::new(),
            last_ack_num: 0,
            dup_ack_count: 0,
            send_buf: BytesMut::new(),
            retransmit_queue: VecDeque::new(),
            max_inflight: 1000,
            loss_count: 0,
            last_loss_time: None,
            session_ticket: None,
            zero_rtt_data: VecDeque::new(),
            zero_rtt_accepted: false,
            metrics: ConnectionStats::new(),
            path_validation_pending: None,
        }
    }

    fn generate_cid() -> [u8; CONNECTION_ID_SIZE] {
        let mut rng = rand::thread_rng();
        let mut cid = [0; CONNECTION_ID_SIZE];
        rng.fill(&mut cid);
        cid
    }

    pub fn set_session_ticket(&mut self, ticket: SessionTicket) {
        self.remote_cid = ticket.connection_id;
        self.stream_manager.set_next_stream_id(ticket.initial_stream_id);
        self.zero_rtt_accepted = true;
        self.metrics.zero_rtt_accepted = true;
        self.session_ticket = Some(ticket);
    }

    pub fn add_zero_rtt_data(&mut self, data: Bytes) {
        self.zero_rtt_data.push_back(data);
    }

    pub async fn connect(&mut self) -> anyhow::Result<()> {
        self.state = ConnectionState::SynSent;
        self.local_seq = rand::thread_rng().gen();
        self.send_window = SendWindow::new(self.local_seq, WINDOW_CAPACITY);

        let mut ticket_bytes = None;
        if let Some(ticket) = &self.session_ticket {
            ticket_bytes = Some(ticket.serialize());
        }

        let first_stream_id = self.stream_manager.next_stream_id;
        let syn = Packet::syn(
            self.local_seq,
            WINDOW_CAPACITY,
            self.local_cid,
            first_stream_id,
            ticket_bytes,
        );
        self.send_packet(&syn, self.active_path).await?;
        self.local_seq += 1;

        while !self.zero_rtt_data.is_empty() {
            let data = self.zero_rtt_data.pop_front().unwrap();
            let packet = Packet::zero_rtt(
                self.local_seq,
                WINDOW_CAPACITY,
                self.local_cid,
                first_stream_id,
                data,
            );
            self.send_packet(&packet, self.active_path).await?;
            self.local_seq += 1;
        }

        let deadline = Instant::now() + Duration::from_secs(10);
        while Instant::now() < deadline {
            if let Some(packet) = self.recv_packet_timeout(Duration::from_millis(500)).await? {
                if packet.packet_type == PacketType::SynAck {
                    self.remote_seq = packet.seq_num + 1;
                    self.remote_cid = packet.connection_id;
                    self.recv_window = RecvWindow::new(packet.seq_num + 1, WINDOW_CAPACITY);
                    self.send_window.update_peer_window(packet.window_size);

                    let mut path = PathInfo::new(self.active_path, packet.connection_id);
                    path.validated = true;
                    self.paths.insert(self.active_path, path);

                    let ack = Packet::ack(
                        self.local_seq,
                        self.remote_seq,
                        self.recv_window.window_size(),
                        self.local_cid,
                    );
                    self.send_packet(&ack, self.active_path).await?;

                    self.state = ConnectionState::Established;
                    return Ok(());
                }
            }
        }

        anyhow::bail!("Connection timeout")
    }

    pub async fn accept(&mut self) -> anyhow::Result<()> {
        let deadline = Instant::now() + Duration::from_secs(10);
        while Instant::now() < deadline {
            if let Some(packet) = self.recv_packet_timeout(Duration::from_millis(500)).await? {
                if packet.packet_type == PacketType::Syn {
                    self.state = ConnectionState::SynReceived;
                    self.remote_seq = packet.seq_num + 1;
                    self.remote_cid = packet.connection_id;
                    self.recv_window = RecvWindow::new(packet.seq_num + 1, WINDOW_CAPACITY);
                    self.send_window.update_peer_window(packet.window_size);

                    let mut payload = &packet.payload[..];
                    if payload.len() >= 4 {
                        let initial_stream_id = payload.get_u32();
                        self.stream_manager.set_next_stream_id(initial_stream_id);
                    }

                    self.local_seq = rand::thread_rng().gen();
                    self.send_window = SendWindow::new(self.local_seq, WINDOW_CAPACITY);

                    let server_ticket = SessionTicket {
                        connection_id: self.local_cid,
                        initial_seq: self.local_seq,
                        initial_stream_id: self.stream_manager.next_stream_id,
                        max_stream_id: self.stream_manager.next_stream_id + 100,
                        creation_time: SystemTime::now()
                            .duration_since(SystemTime::UNIX_EPOCH)
                            .unwrap()
                            .as_secs(),
                        peer_addr: Vec::new(),
                    };

                    let syn_ack = Packet::syn_ack(
                        self.local_seq,
                        self.remote_seq,
                        WINDOW_CAPACITY,
                        self.local_cid,
                        Some(server_ticket.serialize()),
                    );
                    self.send_packet(&syn_ack, self.active_path).await?;
                    self.local_seq += 1;

                    let mut path = PathInfo::new(self.active_path, packet.connection_id);
                    path.validated = true;
                    self.paths.insert(self.active_path, path);

                    return Ok(());
                }
            }
        }

        anyhow::bail!("Accept timeout")
    }

    pub async fn wait_ack(&mut self) -> anyhow::Result<()> {
        let deadline = Instant::now() + Duration::from_secs(10);
        while Instant::now() < deadline {
            if let Some(packet) = self.recv_packet_timeout(Duration::from_millis(500)).await? {
                if packet.packet_type == PacketType::Ack {
                    self.process_ack(packet.ack_num, packet.window_size);
                    self.state = ConnectionState::Established;
                    return Ok(());
                }
            }
        }

        anyhow::bail!("Wait ack timeout")
    }

    pub fn create_stream(&mut self) -> Option<u32> {
        let stream_id = self.stream_manager.create_stream(self.local_seq)?;
        Some(stream_id)
    }

    pub async fn send_to_stream(&mut self, stream_id: u32, data: &[u8]) -> anyhow::Result<usize> {
        if self.state != ConnectionState::Established {
            anyhow::bail!("Connection not established");
        }

        let stream = self.stream_manager
            .get_stream_mut(stream_id)
            .ok_or_else(|| anyhow::anyhow!("Stream {} not found", stream_id))?;
        
        Ok(stream.send(data))
    }

    pub async fn recv_from_stream(&mut self, stream_id: u32) -> anyhow::Result<Vec<Bytes>> {
        if self.state != ConnectionState::Established {
            anyhow::bail!("Connection not established");
        }

        let stream = self.stream_manager
            .get_stream_mut(stream_id)
            .ok_or_else(|| anyhow::anyhow!("Stream {} not found", stream_id))?;
        
        Ok(stream.read_available())
    }

    pub async fn close_stream(&mut self, stream_id: u32) -> anyhow::Result<()> {
        if let Some(stream) = self.stream_manager.get_stream_mut(stream_id) {
            let fin = Packet::fin(
                self.local_seq,
                self.remote_seq,
                self.recv_window.window_size(),
                stream_id,
                self.local_cid,
            );
            self.send_packet(&fin, self.active_path).await?;
            self.local_seq += 1;
            stream.close_send(self.local_seq);
            self.metrics.close_stream(stream_id);
        }
        Ok(())
    }

    pub async fn initiate_migration(&mut self, new_addr: SocketAddr) -> anyhow::Result<()> {
        let mut challenge = [0u8; PATH_CHALLENGE_SIZE];
        rand::thread_rng().fill(&mut challenge);

        let challenge_packet = Packet::path_challenge(
            self.local_seq,
            self.local_cid,
            challenge,
        );

        self.send_packet(&challenge_packet, new_addr).await?;
        self.local_seq += 1;

        let new_cid = Self::generate_cid();
        let mut new_path = PathInfo::new(new_addr, new_cid);
        new_path.challenge = Some(challenge);
        new_path.challenge_sent = Some(Instant::now());
        new_path.validated = false;
        self.paths.insert(new_addr, new_path);
        self.path_validation_pending = Some(new_addr);

        Ok(())
    }

    pub async fn migrate_to(&mut self, new_addr: SocketAddr) -> anyhow::Result<()> {
        if self.paths.contains_key(&new_addr) && self.paths[&new_addr].validated {
            self.active_path = new_addr;
            self.metrics.connection_migrations += 1;
            Ok(())
        } else {
            anyhow::bail!("Path not validated")
        }
    }

    pub fn active_streams(&self) -> Vec<u32> {
        self.stream_manager.active_streams()
    }

    pub fn stream_count(&self) -> usize {
        self.stream_manager.active_count()
    }

    pub async fn flush_streams(&mut self) -> anyhow::Result<()> {
        while self.state == ConnectionState::Established {
            self.check_retransmit().await?;

            if !self.retransmit_queue.is_empty() {
                self.process_retransmit_queue().await?;
                continue;
            }

            let mut has_data = false;
            let streams_with_data = self.stream_manager.get_streams_with_data();

            for stream_id in streams_with_data {
                let inflight_count = self.inflight.len() as u32;
                if !self.congestion.can_send(inflight_count) {
                    break;
                }

                if !self.pacer.can_send() {
                    tokio::time::sleep(self.pacer.wait_time()).await;
                    continue;
                }

                if let Some(stream) = self.stream_manager.get_stream_mut(stream_id) {
                    if let Some((seq, payload)) = stream.get_send_data(MAX_PAYLOAD_SIZE) {
                        let packet = Packet::data(
                            seq,
                            self.remote_seq,
                            self.recv_window.window_size(),
                            stream_id,
                            self.local_cid,
                            payload.clone(),
                        );

                        self.send_packet(&packet, self.active_path).await?;
                        self.inflight.insert(seq, InflightPacket::new(seq, packet.size()));
                        self.inflight_stream.insert(seq, stream_id);
                        self.pacer.notify_sent();
                        self.metrics.record_stream_send(stream_id, payload.len() as u64, false);
                        has_data = true;
                    }
                }
            }

            if !has_data && self.inflight.is_empty() {
                break;
            }

            if !self.inflight.is_empty() {
                if let Some(packet) = self.recv_packet_timeout(Duration::from_millis(10)).await? {
                    self.process_packet(packet).await?;
                }
            } else if !has_data {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }

        Ok(())
    }

    pub async fn recv_any_stream(&mut self) -> anyhow::Result<Vec<(u32, Bytes)>> {
        let mut result = Vec::new();

        if let Some(packet) = self.recv_packet_timeout(Duration::from_millis(100)).await? {
            self.process_packet(packet).await?;
        }

        for &stream_id in &self.stream_manager.active_streams() {
            if let Some(stream) = self.stream_manager.get_stream_mut(stream_id) {
                let data = stream.read_available();
                for chunk in data {
                    result.push((stream_id, chunk));
                }
            }
        }

        Ok(result)
    }

    async fn process_packet(&mut self, packet: Packet) -> anyhow::Result<()> {
        match packet.packet_type {
            PacketType::Data => {
                self.process_data_packet(packet).await?;
            }
            PacketType::Ack => {
                self.process_ack(packet.ack_num, packet.window_size);
            }
            PacketType::Fin => {
                if let Some(stream) = self.stream_manager.get_stream_mut(packet.stream_id) {
                    stream.close_recv(packet.seq_num);
                }
                let ack = Packet::ack(
                    self.local_seq,
                    packet.seq_num + 1,
                    self.recv_window.window_size(),
                    self.local_cid,
                );
                self.send_packet(&ack, self.active_path).await?;
            }
            PacketType::PathChallenge => {
                let response = Packet::path_response(
                    self.local_seq,
                    self.local_cid,
                    packet.payload[..PATH_CHALLENGE_SIZE].try_into().unwrap(),
                );
                self.send_packet(&response, self.active_path).await?;
                self.local_seq += 1;
            }
            PacketType::PathResponse => {
                let response_data: [u8; PATH_CHALLENGE_SIZE] = packet.payload[..PATH_CHALLENGE_SIZE].try_into().unwrap();
                for (addr, path) in &mut self.paths {
                    if path.challenge == Some(response_data) {
                        path.validated = true;
                        path.challenge = None;
                        println!("路径已验证: {}", addr);
                    }
                }
            }
            _ => {}
        }

        Ok(())
    }

    async fn process_data_packet(&mut self, packet: Packet) -> anyhow::Result<()> {
        let stream_id = packet.stream_id;
        self.stream_manager.get_or_create_stream(stream_id, 0);

        if let Some(stream) = self.stream_manager.get_stream_mut(stream_id) {
            stream.receive(packet.seq_num, packet.payload.clone());
            self.metrics.record_stream_recv(stream_id, packet.payload.len() as u64);
        }

        let highest = self.recv_window.highest_received();
        if highest >= self.remote_seq {
            let ack = Packet::ack(
                self.local_seq,
                self.recv_window.base(),
                self.recv_window.window_size(),
                self.local_cid,
            );
            self.send_packet(&ack, self.active_path).await?;
        }

        Ok(())
    }

    fn process_ack(&mut self, ack_num: u32, window_size: u32) {
        self.send_window.update_peer_window(window_size);

        if ack_num < self.last_ack_num {
            return;
        }

        if ack_num == self.last_ack_num {
            self.dup_ack_count += 1;
            self.metrics.record_ack(true);

            let highest_inflight = self.inflight.keys().max().copied().unwrap_or(ack_num);
            if self.congestion.on_duplicate_ack(self.dup_ack_count, highest_inflight) {
                for (&seq, inflight) in &self.inflight {
                    if seq < highest_inflight && !inflight.retransmitted {
                        self.retransmit_queue.push_back(seq);
                    }
                }
                self.truncate_retransmit_queue();
            }
            return;
        }

        self.dup_ack_count = 0;
        self.last_ack_num = ack_num;
        self.metrics.record_ack(false);

        let acked = self.send_window.ack(ack_num);
        for (seq, _) in &acked {
            if let Some(inflight) = self.inflight.remove(seq) {
                if !inflight.retransmitted {
                    self.rtt_estimator.update(inflight.elapsed(), false);
                    self.pacer.update_rate(self.congestion.cwnd(), self.rtt_estimator.smoothed_rtt());
                    self.metrics.record_rtt(
                        inflight.elapsed(),
                        self.rtt_estimator.smoothed_rtt(),
                        self.rtt_estimator.rtt_var(),
                    );
                }
                self.congestion.on_ack(1);
            }
            if let Some(stream_id) = self.inflight_stream.remove(seq) {
                if let Some(stream) = self.stream_manager.get_stream_mut(stream_id) {
                    stream.ack(seq);
                }
            }
        }

        self.metrics.record_cwnd(
            self.congestion.cwnd(),
            match self.congestion.state() {
                CongestionState::SlowStart => "慢启动",
                CongestionState::CongestionAvoidance => "拥塞避免",
                CongestionState::Recovery => "恢复",
            },
            self.inflight.len() as u32,
        );
    }

    async fn check_retransmit(&mut self) -> anyhow::Result<()> {
        let base_rto = self.rtt_estimator.rto();
        let mut timed_out = Vec::new();

        for (&seq, inflight) in &self.inflight {
            let packet_rto = inflight.current_rto(base_rto);
            if inflight.is_timed_out(packet_rto) && !inflight.retransmitted {
                timed_out.push(seq);
            }
        }

        if !timed_out.is_empty() {
            self.congestion.on_timeout();
            self.rtt_estimator.update_for_retransmit();
            self.loss_count += 1;
            self.last_loss_time = Some(Instant::now());

            for &seq in &timed_out {
                self.metrics.record_loss(seq, true, Some(base_rto));
            }

            timed_out.truncate(self.congestion.cwnd() as usize / 2 + 1);

            for seq in timed_out {
                if self.inflight.get(&seq).map(|i| i.rto_count).unwrap_or(0) < MAX_RETRIES {
                    self.retransmit_queue.push_back(seq);
                }
            }
            self.truncate_retransmit_queue();
        }

        Ok(())
    }

    fn truncate_retransmit_queue(&mut self) {
        let max_queue_size = std::cmp::max(self.congestion.cwnd() as usize / 2, 5);
        self.retransmit_queue.truncate(max_queue_size);
    }

    async fn process_retransmit_queue(&mut self) -> anyhow::Result<()> {
        while let Some(seq) = self.retransmit_queue.pop_front() {
            if let Some(stream_id) = self.inflight_stream.get(&seq).copied() {
                if let Some(stream) = self.stream_manager.get_stream(stream_id) {
                    if let Some(data) = stream.get_inflight_data(seq) {
                        let packet = Packet::data(
                            seq,
                            self.remote_seq,
                            self.recv_window.window_size(),
                            stream_id,
                            self.local_cid,
                            data.clone(),
                        );

                        if let Some(inflight) = self.inflight.get_mut(&seq) {
                            inflight.retransmit();
                        }

                        if !self.pacer.can_send() {
                            tokio::time::sleep(self.pacer.wait_time()).await;
                        }

                        self.send_packet(&packet, self.active_path).await?;
                        self.pacer.notify_sent();
                        self.metrics.record_stream_send(stream_id, data.len() as u64, true);
                        self.metrics.record_retransmit(1);
                    }
                }
            }
        }
        Ok(())
    }

    async fn send_packet(&self, packet: &Packet, addr: SocketAddr) -> anyhow::Result<()> {
        let data = packet.serialize();
        self.socket.send_to(&data, addr).await?;
        self.metrics.total_packets_sent += 1;
        self.metrics.total_bytes_sent += data.len() as u64;
        Ok(())
    }

    async fn recv_packet_timeout(&self, dur: Duration) -> anyhow::Result<Option<Packet>> {
        let mut buf = vec![0u8; MAX_PACKET_SIZE];

        match timeout(dur, self.socket.recv_from(&mut buf)).await {
            Ok(Ok((len, addr))) => {
                if let Some(packet) = Packet::deserialize(&buf[..len]) {
                    self.metrics.total_packets_recv += 1;
                    self.metrics.total_bytes_recv += len as u64;
                    return Ok(Some(packet));
                }
                Ok(None)
            }
            Ok(Err(e)) => Err(e.into()),
            Err(_) => Ok(None),
        }
    }

    pub async fn close(&mut self) -> anyhow::Result<()> {
        if self.state == ConnectionState::Established {
            self.state = ConnectionState::FinWait;

            for &stream_id in &self.stream_manager.active_streams() {
                self.close_stream(stream_id).await?;
            }
        }

        self.state = ConnectionState::Closed;
        Ok(())
    }

    pub fn state(&self) -> ConnectionState {
        self.state
    }

    pub fn rtt(&self) -> Duration {
        self.rtt_estimator.smoothed_rtt()
    }

    pub fn cwnd(&self) -> u32 {
        self.congestion.cwnd()
    }

    pub fn inflight_count(&self) -> usize {
        self.inflight.len()
    }

    pub fn metrics(&self) -> &ConnectionStats {
        &self.metrics
    }

    pub fn print_stats(&self) {
        self.metrics.print_summary();
    }
}

pub async fn listen(addr: SocketAddr) -> anyhow::Result<mpsc::Receiver<Connection>> {
    let socket = Arc::new(UdpSocket::bind(addr).await?);
    let (tx, rx) = mpsc::channel(100);

    tokio::spawn(async move {
        let mut buf = vec![0u8; MAX_PACKET_SIZE];
        let mut connections = HashMap::new();

        loop {
            match socket.recv_from(&mut buf).await {
                Ok((len, peer_addr)) => {
                    if let Some(packet) = Packet::deserialize(&buf[..len]) {
                        if packet.packet_type == PacketType::Syn {
                            if !connections.contains_key(&peer_addr) {
                                let mut conn = Connection::new(socket.clone(), peer_addr);
                                conn.state = ConnectionState::SynReceived;
                                conn.remote_seq = packet.seq_num + 1;
                                conn.remote_cid = packet.connection_id;
                                conn.recv_window = RecvWindow::new(packet.seq_num + 1, WINDOW_CAPACITY);
                                conn.send_window.update_peer_window(packet.window_size);

                                let mut payload = &packet.payload[..];
                                if payload.len() >= 4 {
                                    let initial_stream_id = payload.get_u32();
                                    conn.stream_manager.set_next_stream_id(initial_stream_id);
                                }

                                conn.local_seq = rand::thread_rng().gen();
                                conn.send_window = SendWindow::new(conn.local_seq, WINDOW_CAPACITY);

                                let server_ticket = SessionTicket {
                                    connection_id: conn.local_cid,
                                    initial_seq: conn.local_seq,
                                    initial_stream_id: conn.stream_manager.next_stream_id,
                                    max_stream_id: conn.stream_manager.next_stream_id + 100,
                                    creation_time: SystemTime::now()
                                        .duration_since(SystemTime::UNIX_EPOCH)
                                        .unwrap()
                                        .as_secs(),
                                    peer_addr: Vec::new(),
                                };

                                let syn_ack = Packet::syn_ack(
                                    conn.local_seq,
                                    conn.remote_seq,
                                    WINDOW_CAPACITY,
                                    conn.local_cid,
                                    Some(server_ticket.serialize()),
                                );

                                if conn.send_packet(&syn_ack, peer_addr).await.is_ok() {
                                    conn.local_seq += 1;
                                    let mut path = PathInfo::new(peer_addr, packet.connection_id);
                                    path.validated = true;
                                    conn.paths.insert(peer_addr, path);
                                    connections.insert(peer_addr, ());
                                    let _ = tx.send(conn).await;
                                }
                            }
                        }
                    }
                }
                Err(_) => break,
            }
        }
    });

    Ok(rx)
}

pub async fn dial(addr: SocketAddr) -> anyhow::Result<Connection> {
    let socket = Arc::new(UdpSocket::bind("0.0.0.0:0".parse::<SocketAddr>().unwrap()).await?);
    let mut conn = Connection::new(socket, addr);
    conn.connect().await?;
    Ok(conn)
}

pub async fn dial_with_ticket(addr: SocketAddr, ticket: SessionTicket) -> anyhow::Result<Connection> {
    let socket = Arc::new(UdpSocket::bind("0.0.0.0:0".parse::<SocketAddr>().unwrap()).await?);
    let mut conn = Connection::new(socket, addr);
    conn.set_session_ticket(ticket);
    conn.connect().await?;
    Ok(conn)
}
