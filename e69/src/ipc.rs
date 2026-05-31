use crate::error::{Result, SchedulerError};
use dashmap::DashMap;
use parking_lot::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct IpcMessage {
    pub sequence: u64,
    pub sender_id: String,
    pub data: Vec<u8>,
    pub timestamp: std::time::Instant,
}

struct LockFreeRingBuffer {
    buffer: Vec<u8>,
    capacity: usize,
    head: AtomicUsize,
    tail: AtomicUsize,
}

impl LockFreeRingBuffer {
    fn new(capacity: usize) -> Self {
        Self {
            buffer: vec![0u8; capacity],
            capacity,
            head: AtomicUsize::new(0),
            tail: AtomicUsize::new(0),
        }
    }

    fn write(&self, data: &[u8]) -> Result<usize> {
        let mut tail = self.tail.load(Ordering::Relaxed);
        let head = self.head.load(Ordering::Acquire);
        
        let available = if tail >= head {
            self.capacity - tail + head
        } else {
            head - tail
        };
        
        if data.len() > available {
            return Err(SchedulerError::IpcError("Buffer full".to_string()));
        }

        let to_write = data.len();
        for (i, &byte) in data.iter().enumerate() {
            let pos = (tail + i) % self.capacity;
            unsafe {
                std::ptr::write_volatile(self.buffer.as_ptr().add(pos) as *mut u8, byte);
            }
        }
        
        self.tail.store((tail + to_write) % self.capacity, Ordering::Release);
        Ok(to_write)
    }

    fn read(&self, buf: &mut [u8]) -> Result<usize> {
        let mut head = self.head.load(Ordering::Relaxed);
        let tail = self.tail.load(Ordering::Acquire);
        
        if head == tail {
            return Ok(0);
        }
        
        let available = if tail > head {
            tail - head
        } else {
            self.capacity - head + tail
        };
        
        let to_read = std::cmp::min(buf.len(), available);
        for i in 0..to_read {
            let pos = (head + i) % self.capacity;
            buf[i] = unsafe { std::ptr::read_volatile(self.buffer.as_ptr().add(pos)) };
        }
        
        self.head.store((head + to_read) % self.capacity, Ordering::Release);
        Ok(to_read)
    }

    fn available(&self) -> usize {
        let head = self.head.load(Ordering::Relaxed);
        let tail = self.tail.load(Ordering::Relaxed);
        if tail >= head {
            tail - head
        } else {
            self.capacity - head + tail
        }
    }
}

#[derive(Clone)]
pub struct SharedMemoryRegion {
    pub id: String,
    pub name: String,
    pub size: usize,
    buffer: Arc<LockFreeRingBuffer>,
    message_queue: Arc<Mutex<Vec<IpcMessage>>>,
    sequence_counter: Arc<AtomicUsize>,
}

impl SharedMemoryRegion {
    pub fn new(name: String, size: usize) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            size,
            buffer: Arc::new(LockFreeRingBuffer::new(size)),
            message_queue: Arc::new(Mutex::new(Vec::new())),
            sequence_counter: Arc::new(AtomicUsize::new(0)),
        }
    }

    pub fn send_message(&self, sender_id: String, data: Vec<u8>) -> Result<u64> {
        let sequence = self.sequence_counter.fetch_add(1, Ordering::SeqCst) as u64;
        let message = IpcMessage {
            sequence,
            sender_id,
            data,
            timestamp: std::time::Instant::now(),
        };
        
        let mut queue = self.message_queue.lock();
        queue.push(message);
        queue.sort_by_key(|m| m.sequence);
        Ok(sequence)
    }

    pub fn receive_message(&self) -> Option<IpcMessage> {
        let mut queue = self.message_queue.lock();
        if !queue.is_empty() {
            Some(queue.remove(0))
        } else {
            None
        }
    }

    pub fn read_raw(&self, buf: &mut [u8]) -> Result<usize> {
        self.buffer.read(buf)
    }

    pub fn write_raw(&self, buf: &[u8]) -> Result<usize> {
        self.buffer.write(buf)
    }

    pub fn available_data(&self) -> usize {
        self.buffer.available()
    }

    pub fn message_count(&self) -> usize {
        self.message_queue.lock().len()
    }
}

#[derive(Clone)]
pub struct IpcManager {
    regions: Arc<DashMap<String, SharedMemoryRegion>>,
    max_regions: usize,
    max_region_size: usize,
}

impl IpcManager {
    pub fn new(max_regions: usize, max_region_size: usize) -> Self {
        Self {
            regions: Arc::new(DashMap::new()),
            max_regions,
            max_region_size,
        }
    }

    pub fn create_region(&self, name: String, size: usize) -> Result<String> {
        if self.regions.len() >= self.max_regions {
            return Err(SchedulerError::IpcError(
                "Maximum number of shared memory regions reached".to_string(),
            ));
        }

        if size > self.max_region_size {
            return Err(SchedulerError::IpcError(format!(
                "Region size {} exceeds maximum {}",
                size, self.max_region_size
            )));
        }

        if self.regions.iter().any(|r| r.name == name) {
            return Err(SchedulerError::IpcError(format!(
                "Shared memory region '{}' already exists",
                name
            )));
        }

        let region = SharedMemoryRegion::new(name, size);
        let id = region.id.clone();
        self.regions.insert(id.clone(), region);
        Ok(id)
    }

    pub fn destroy_region(&self, region_id: &str) -> Result<()> {
        if self.regions.remove(region_id).is_none() {
            return Err(SchedulerError::IpcError(format!(
                "Shared memory region '{}' not found",
                region_id
            )));
        }
        Ok(())
    }

    pub fn get_region(&self, region_id: &str) -> Result<SharedMemoryRegion> {
        self.regions
            .get(region_id)
            .map(|r| r.clone())
            .ok_or_else(|| {
                SchedulerError::IpcError(format!(
                    "Shared memory region '{}' not found",
                    region_id
                ))
            })
    }

    pub fn find_region_by_name(&self, name: &str) -> Option<SharedMemoryRegion> {
        self.regions
            .iter()
            .find(|r| r.name == name)
            .map(|r| r.clone())
    }

    pub fn list_regions(&self) -> Vec<(String, String, usize)> {
        self.regions
            .iter()
            .map(|r| (r.id.clone(), r.name.clone(), r.size))
            .collect()
    }

    pub fn broadcast(&self, region_name: &str, sender_id: String, data: Vec<u8>) -> Result<u64> {
        if let Some(region) = self.find_region_by_name(region_name) {
            region.send_message(sender_id, data)
        } else {
            Err(SchedulerError::IpcError(format!(
                "Region '{}' not found",
                region_name
            )))
        }
    }
}
