use bytes::{Buf, BufMut, Bytes, BytesMut};
use std::fmt;

pub const MAX_PACKET_SIZE: usize = 1400;
pub const HEADER_SIZE: usize = 29;

pub const CONNECTION_ID_SIZE: usize = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum PacketType {
    Syn = 0,
    SynAck = 1,
    Ack = 2,
    Data = 3,
    Fin = 4,
    FinAck = 5,
    ZeroRtt = 6,
    PathChallenge = 7,
    PathResponse = 8,
    ConnectionClose = 9,
}

impl TryFrom<u8> for PacketType {
    type Error = ();

    fn try_from(v: u8) -> Result<Self, Self::Error> {
        match v {
            0 => Ok(PacketType::Syn),
            1 => Ok(PacketType::SynAck),
            2 => Ok(PacketType::Ack),
            3 => Ok(PacketType::Data),
            4 => Ok(PacketType::Fin),
            5 => Ok(PacketType::FinAck),
            6 => Ok(PacketType::ZeroRtt),
            7 => Ok(PacketType::PathChallenge),
            8 => Ok(PacketType::PathResponse),
            9 => Ok(PacketType::ConnectionClose),
            _ => Err(()),
        }
    }
}

#[derive(Debug, Clone)]
pub struct Packet {
    pub packet_type: PacketType,
    pub seq_num: u32,
    pub ack_num: u32,
    pub window_size: u32,
    pub stream_id: u32,
    pub connection_id: [u8; CONNECTION_ID_SIZE],
    pub timestamp: u32,
    pub payload: Bytes,
}

impl Packet {
    pub fn new(
        packet_type: PacketType,
        seq_num: u32,
        ack_num: u32,
        window_size: u32,
        stream_id: u32,
        connection_id: [u8; CONNECTION_ID_SIZE],
        payload: Bytes,
    ) -> Self {
        Self {
            packet_type,
            seq_num,
            ack_num,
            window_size,
            stream_id,
            connection_id,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u32,
            payload,
        }
    }

    pub fn syn(
        seq_num: u32,
        window_size: u32,
        connection_id: [u8; CONNECTION_ID_SIZE],
        initial_stream_id: u32,
        ticket: Option<Bytes>,
    ) -> Self {
        let payload = if let Some(ticket) = ticket {
            let mut data = BytesMut::new();
            data.put_u32(initial_stream_id);
            data.put_u16(ticket.len() as u16);
            data.put_slice(&ticket);
            data.freeze()
        } else {
            let mut data = BytesMut::new();
            data.put_u32(initial_stream_id);
            data.freeze()
        };
        Self::new(
            PacketType::Syn,
            seq_num,
            0,
            window_size,
            0,
            connection_id,
            payload,
        )
    }

    pub fn syn_ack(
        seq_num: u32,
        ack_num: u32,
        window_size: u32,
        connection_id: [u8; CONNECTION_ID_SIZE],
        server_ticket: Option<Bytes>,
    ) -> Self {
        let payload = if let Some(ticket) = server_ticket {
            let mut data = BytesMut::new();
            data.put_u16(ticket.len() as u16);
            data.put_slice(&ticket);
            data.freeze()
        } else {
            Bytes::new()
        };
        Self::new(
            PacketType::SynAck,
            seq_num,
            ack_num,
            window_size,
            0,
            connection_id,
            payload,
        )
    }

    pub fn zero_rtt(
        seq_num: u32,
        window_size: u32,
        connection_id: [u8; CONNECTION_ID_SIZE],
        stream_id: u32,
        payload: Bytes,
    ) -> Self {
        Self::new(
            PacketType::ZeroRtt,
            seq_num,
            0,
            window_size,
            stream_id,
            connection_id,
            payload,
        )
    }

    pub fn ack(
        seq_num: u32,
        ack_num: u32,
        window_size: u32,
        connection_id: [u8; CONNECTION_ID_SIZE],
    ) -> Self {
        Self::new(
            PacketType::Ack,
            seq_num,
            ack_num,
            window_size,
            0,
            connection_id,
            Bytes::new(),
        )
    }

    pub fn data(
        seq_num: u32,
        ack_num: u32,
        window_size: u32,
        stream_id: u32,
        connection_id: [u8; CONNECTION_ID_SIZE],
        payload: Bytes,
    ) -> Self {
        Self::new(
            PacketType::Data,
            seq_num,
            ack_num,
            window_size,
            stream_id,
            connection_id,
            payload,
        )
    }

    pub fn fin(
        seq_num: u32,
        ack_num: u32,
        window_size: u32,
        stream_id: u32,
        connection_id: [u8; CONNECTION_ID_SIZE],
    ) -> Self {
        Self::new(
            PacketType::Fin,
            seq_num,
            ack_num,
            window_size,
            stream_id,
            connection_id,
            Bytes::new(),
        )
    }

    pub fn path_challenge(
        seq_num: u32,
        connection_id: [u8; CONNECTION_ID_SIZE],
        challenge: [u8; 8],
    ) -> Self {
        Self::new(
            PacketType::PathChallenge,
            seq_num,
            0,
            0,
            0,
            connection_id,
            Bytes::copy_from_slice(&challenge),
        )
    }

    pub fn path_response(
        seq_num: u32,
        connection_id: [u8; CONNECTION_ID_SIZE],
        response: [u8; 8],
    ) -> Self {
        Self::new(
            PacketType::PathResponse,
            seq_num,
            0,
            0,
            0,
            connection_id,
            Bytes::copy_from_slice(&response),
        )
    }

    pub fn serialize(&self) -> Bytes {
        let mut buf = BytesMut::with_capacity(HEADER_SIZE + self.payload.len());
        buf.put_u8(self.packet_type as u8);
        buf.put_u32(self.seq_num);
        buf.put_u32(self.ack_num);
        buf.put_u32(self.window_size);
        buf.put_u32(self.stream_id);
        buf.put_slice(&self.connection_id);
        buf.put_u32(self.timestamp);
        buf.put_u32(self.payload.len() as u32);
        buf.put_slice(&self.payload);
        buf.freeze()
    }

    pub fn deserialize(data: &[u8]) -> Option<Self> {
        if data.len() < HEADER_SIZE {
            return None;
        }

        let mut buf = data;
        let packet_type = PacketType::try_from(buf.get_u8()).ok()?;
        let seq_num = buf.get_u32();
        let ack_num = buf.get_u32();
        let window_size = buf.get_u32();
        let stream_id = buf.get_u32();
        
        let mut connection_id = [0u8; CONNECTION_ID_SIZE];
        buf.copy_to_slice(&mut connection_id);
        
        let timestamp = buf.get_u32();
        let payload_len = buf.get_u32() as usize;

        if buf.remaining() < payload_len {
            return None;
        }

        let payload = buf.copy_to_bytes(payload_len);

        Some(Self {
            packet_type,
            seq_num,
            ack_num,
            window_size,
            stream_id,
            connection_id,
            timestamp,
            payload,
        })
    }

    pub fn size(&self) -> usize {
        HEADER_SIZE + self.payload.len()
    }
}

impl fmt::Debug for Packet {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "Packet({:?}, seq={}, stream={}, payload={}B)",
            self.packet_type,
            self.seq_num,
            self.stream_id,
            self.payload.len()
        )
    }
}

#[derive(Debug, Clone)]
pub struct SessionTicket {
    pub connection_id: [u8; CONNECTION_ID_SIZE],
    pub initial_seq: u32,
    pub initial_stream_id: u32,
    pub max_stream_id: u32,
    pub creation_time: u64,
    pub peer_addr: Vec<u8>,
}

impl SessionTicket {
    pub fn serialize(&self) -> Bytes {
        let mut buf = BytesMut::new();
        buf.put_slice(&self.connection_id);
        buf.put_u32(self.initial_seq);
        buf.put_u32(self.initial_stream_id);
        buf.put_u32(self.max_stream_id);
        buf.put_u64(self.creation_time);
        buf.put_u16(self.peer_addr.len() as u16);
        buf.put_slice(&self.peer_addr);
        buf.freeze()
    }

    pub fn deserialize(data: &[u8]) -> Option<Self> {
        if data.len() < 30 {
            return None;
        }
        
        let mut buf = data;
        let mut connection_id = [0u8; CONNECTION_ID_SIZE];
        buf.copy_to_slice(&mut connection_id);
        let initial_seq = buf.get_u32();
        let initial_stream_id = buf.get_u32();
        let max_stream_id = buf.get_u32();
        let creation_time = buf.get_u64();
        let peer_addr_len = buf.get_u16() as usize;
        
        if buf.remaining() < peer_addr_len {
            return None;
        }
        
        let peer_addr = buf.copy_to_bytes(peer_addr_len).to_vec();
        
        Some(Self {
            connection_id,
            initial_seq,
            initial_stream_id,
            max_stream_id,
            creation_time,
            peer_addr,
        })
    }
}
