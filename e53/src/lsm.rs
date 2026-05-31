use crate::compression::{compress_floats, decompress_floats, Simple8B};
use crate::data::{Sample, SeriesKey};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BinaryHeap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use thiserror::Error;
use tokio::runtime::Handle;

#[derive(Error, Debug)]
pub enum LsmError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Serialization error: {0}")]
    Serialization(#[from] bincode::Error),
    #[error("Compression error")]
    Compression,
    #[error("Join error: {0}")]
    Join(#[from] tokio::task::JoinError),
}

pub type Result<T> = std::result::Result<T, LsmError>;

const MEMTABLE_SIZE_THRESHOLD: usize = 16 * 1024 * 1024;
const SSTABLE_LEVELS: usize = 6;
const LEVEL0_MAX_SSTABLES: usize = 4;
const MAX_SSTABLE_SIZE: usize = 64 * 1024 * 1024;
const BLOOM_FILTER_SIZE: usize = 1024 * 8;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LsmMetrics {
    pub write_amplification: f64,
    pub read_amplification: f64,
    pub total_writes: u64,
    pub total_compacted_bytes: u64,
    pub total_queries: u64,
    pub sstables_read_per_query: f64,
}

#[derive(Clone, Serialize, Deserialize)]
struct BloomFilter {
    bits: Vec<u8>,
    hash_count: usize,
}

impl BloomFilter {
    fn new(size: usize, hash_count: usize) -> Self {
        Self {
            bits: vec![0; size],
            hash_count,
        }
    }

    fn insert(&mut self, key: &SeriesKey) {
        let bytes = bincode::serialize(key).unwrap_or_default();
        for i in 0..self.hash_count {
            let hash = self.hash(&bytes, i);
            let bit = hash % (self.bits.len() * 8);
            self.bits[bit / 8] |= 1 << (bit % 8);
        }
    }

    fn might_contain(&self, key: &SeriesKey) -> bool {
        let bytes = bincode::serialize(key).unwrap_or_default();
        for i in 0..self.hash_count {
            let hash = self.hash(&bytes, i);
            let bit = hash % (self.bits.len() * 8);
            if (self.bits[bit / 8] & (1 << (bit % 8))) == 0 {
                return false;
            }
        }
        true
    }

    fn hash(&self, bytes: &[u8], seed: usize) -> usize {
        let mut h = seed as u64;
        for &b in bytes {
            h = h.wrapping_mul(31).wrapping_add(b as u64);
        }
        h as usize
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BlockEntry {
    key: SeriesKey,
    timestamps_compressed: Vec<u64>,
    values_compressed: Vec<u8>,
    min_ts: i64,
    max_ts: i64,
}

pub struct MemTable {
    data: BTreeMap<SeriesKey, Vec<Sample>>,
    size: usize,
}

impl MemTable {
    pub fn new() -> Self {
        Self {
            data: BTreeMap::new(),
            size: 0,
        }
    }

    pub fn insert(&mut self, key: SeriesKey, sample: Sample) {
        let entry = self.data.entry(key).or_insert_with(Vec::new);
        entry.push(sample);
        self.size += 8 + 8;
    }

    pub fn get(&self, key: &SeriesKey, start: i64, end: i64) -> Vec<Sample> {
        self.data
            .get(key)
            .map(|samples| {
                samples
                    .iter()
                    .filter(|s| s.timestamp >= start && s.timestamp <= end)
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn size(&self) -> usize {
        self.size
    }

    pub fn is_empty(&self) -> bool {
        self.data.is_empty()
    }

    pub fn into_btree_map(self) -> BTreeMap<SeriesKey, Vec<Sample>> {
        self.data
    }
}

impl Default for MemTable {
    fn default() -> Self {
        Self::new()
    }
}

pub struct SSTable {
    path: PathBuf,
    level: usize,
    size: usize,
    index: BTreeMap<SeriesKey, (usize, i64, i64)>,
    bloom_filter: BloomFilter,
    min_key: SeriesKey,
    max_key: SeriesKey,
}

impl SSTable {
    pub fn create(path: PathBuf, level: usize, data: &BTreeMap<SeriesKey, Vec<Sample>>) -> Result<Self> {
        let mut entries: Vec<BlockEntry> = Vec::new();
        let mut index = BTreeMap::new();
        let mut bloom_filter = BloomFilter::new(BLOOM_FILTER_SIZE, 4);

        let min_key = data.keys().next().unwrap().clone();
        let max_key = data.keys().last().unwrap().clone();

        for (key, samples) in data {
            bloom_filter.insert(key);

            let mut timestamps = Vec::with_capacity(samples.len());
            let mut values = Vec::with_capacity(samples.len());
            let mut min_ts = i64::MAX;
            let mut max_ts = i64::MIN;

            for sample in samples {
                timestamps.push(sample.timestamp);
                values.push(sample.value);
                min_ts = min_ts.min(sample.timestamp);
                max_ts = max_ts.max(sample.timestamp);
            }

            let timestamps_compressed = Simple8B::compress_deltas(&timestamps)
                .map_err(|_| LsmError::Compression)?;
            let values_compressed = compress_floats(&values)
                .map_err(|_| LsmError::Compression)?;

            entries.push(BlockEntry {
                key: key.clone(),
                timestamps_compressed,
                values_compressed: values_compressed.clone(),
                min_ts,
                max_ts,
            });

            index.insert(key.clone(), (entries.len() - 1, min_ts, max_ts));
        }

        let file = File::create(&path)?;
        let mut writer = BufWriter::new(file);
        bincode::serialize_into(&mut writer, &(&entries, &bloom_filter))?;
        writer.flush()?;

        let size = path.metadata()?.len() as usize;

        Ok(Self {
            path,
            level,
            size,
            index,
            bloom_filter,
            min_key,
            max_key,
        })
    }

    pub fn load(path: PathBuf, level: usize) -> Result<Self> {
        let file = File::open(&path)?;
        let mut reader = BufReader::new(file);
        let (entries, bloom_filter): (Vec<BlockEntry>, BloomFilter) = bincode::deserialize_from(&mut reader)?;

        let mut index = BTreeMap::new();
        let mut min_key: Option<SeriesKey> = None;
        let mut max_key: Option<SeriesKey> = None;

        for (i, entry) in entries.iter().enumerate() {
            index.insert(entry.key.clone(), (i, entry.min_ts, entry.max_ts));
            if min_key.is_none() || entry.key < min_key.as_ref().unwrap().clone() {
                min_key = Some(entry.key.clone());
            }
            if max_key.is_none() || entry.key > max_key.as_ref().unwrap().clone() {
                max_key = Some(entry.key.clone());
            }
        }

        let size = path.metadata()?.len() as usize;

        Ok(Self {
            path,
            level,
            size,
            index,
            bloom_filter,
            min_key: min_key.unwrap(),
            max_key: max_key.unwrap(),
        })
    }

    pub fn might_contain(&self, key: &SeriesKey) -> bool {
        if key < &self.min_key || key > &self.max_key {
            return false;
        }
        self.bloom_filter.might_contain(key)
    }

    pub fn get(&self, key: &SeriesKey, start: i64, end: i64) -> Result<Vec<Sample>> {
        if !self.might_contain(key) {
            return Ok(Vec::new());
        }

        let index_entry = self.index.get(key);
        if index_entry.is_none() {
            return Ok(Vec::new());
        }

        let (_, min_ts, max_ts) = index_entry.unwrap();
        if *max_ts < start || *min_ts > end {
            return Ok(Vec::new());
        }

        let file = File::open(&self.path)?;
        let mut reader = BufReader::new(file);
        let (entries, _): (Vec<BlockEntry>, BloomFilter) = bincode::deserialize_from(&mut reader)?;

        for entry in entries {
            if &entry.key == key {
                let timestamps = Simple8B::decompress_deltas(&entry.timestamps_compressed)
                    .map_err(|_| LsmError::Compression)?;
                let values = decompress_floats(&entry.values_compressed)
                    .map_err(|_| LsmError::Compression)?;

                let mut samples = Vec::new();
                for ((ts, val)) in timestamps.iter().zip(values.iter()) {
                    if *ts >= start && *ts <= end {
                        samples.push(Sample::new(*ts, *val));
                    }
                }
                return Ok(samples);
            }
        }

        Ok(Vec::new())
    }

    pub fn get_all_series(&self) -> Result<Vec<SeriesKey>> {
        Ok(self.index.keys().cloned().collect())
    }

    pub fn size(&self) -> usize {
        self.size
    }

    pub fn overlaps_with(&self, other: &SSTable) -> bool {
        !(self.max_key < other.min_key || self.min_key > other.max_key)
    }
}

struct Metrics {
    total_writes: AtomicU64,
    total_compacted_bytes: AtomicU64,
    total_queries: AtomicU64,
    total_sstables_read: AtomicU64,
    bytes_written: AtomicU64,
}

impl Metrics {
    fn new() -> Self {
        Self {
            total_writes: AtomicU64::new(0),
            total_compacted_bytes: AtomicU64::new(0),
            total_queries: AtomicU64::new(0),
            total_sstables_read: AtomicU64::new(0),
            bytes_written: AtomicU64::new(0),
        }
    }

    fn record_write(&self) {
        self.total_writes.fetch_add(1, Ordering::Relaxed);
    }

    fn record_compaction(&self, bytes: usize) {
        self.total_compacted_bytes.fetch_add(bytes as u64, Ordering::Relaxed);
    }

    fn record_query(&self, sstables_read: usize) {
        self.total_queries.fetch_add(1, Ordering::Relaxed);
        self.total_sstables_read.fetch_add(sstables_read as u64, Ordering::Relaxed);
    }

    fn record_bytes_written(&self, bytes: usize) {
        self.bytes_written.fetch_add(bytes as u64, Ordering::Relaxed);
    }

    fn get_metrics(&self) -> LsmMetrics {
        let total_writes = self.total_writes.load(Ordering::Relaxed);
        let total_queries = self.total_queries.load(Ordering::Relaxed);
        let total_sstables_read = self.total_sstables_read.load(Ordering::Relaxed);
        let total_compacted_bytes = self.total_compacted_bytes.load(Ordering::Relaxed);
        let bytes_written = self.bytes_written.load(Ordering::Relaxed);

        let write_amplification = if total_writes > 0 {
            (bytes_written + total_compacted_bytes) as f64 / (total_writes * 16) as f64
        } else {
            0.0
        };

        let sstables_read_per_query = if total_queries > 0 {
            total_sstables_read as f64 / total_queries as f64
        } else {
            0.0
        };

        LsmMetrics {
            write_amplification,
            read_amplification: sstables_read_per_query,
            total_writes,
            total_compacted_bytes,
            total_queries,
            sstables_read_per_query,
        }
    }
}

pub struct LsmTree {
    memtable: Arc<RwLock<MemTable>>,
    immutable_memtables: Arc<RwLock<Vec<MemTable>>>,
    levels: Arc<RwLock<Vec<Vec<Arc<SSTable>>>>>,
    wal_path: PathBuf,
    data_dir: PathBuf,
    sstable_counter: Arc<RwLock<usize>>,
    metrics: Arc<Metrics>,
    compaction_semaphore: Arc<tokio::sync::Semaphore>,
}

impl LsmTree {
    pub fn new(data_dir: PathBuf) -> Result<Self> {
        fs::create_dir_all(&data_dir)?;

        let wal_path = data_dir.join("wal.log");
        let mut levels = Vec::with_capacity(SSTABLE_LEVELS);
        for _ in 0..SSTABLE_LEVELS {
            levels.push(Vec::new());
        }

        let tree = Self {
            memtable: Arc::new(RwLock::new(MemTable::new())),
            immutable_memtables: Arc::new(RwLock::new(Vec::new())),
            levels: Arc::new(RwLock::new(levels)),
            wal_path,
            data_dir,
            sstable_counter: Arc::new(RwLock::new(0)),
            metrics: Arc::new(Metrics::new()),
            compaction_semaphore: Arc::new(tokio::sync::Semaphore::new(1)),
        };

        tree.recover_wal()?;
        tree.load_sstables()?;
        tree.start_compaction_thread();

        Ok(tree)
    }

    fn recover_wal(&self) -> Result<()> {
        if !self.wal_path.exists() {
            return Ok(());
        }

        let file = File::open(&self.wal_path)?;
        let mut reader = BufReader::new(file);

        loop {
            let result: std::result::Result<(SeriesKey, Sample), _> =
                bincode::deserialize_from(&mut reader);
            match result {
                Ok((key, sample)) => {
                    self.memtable.write().insert(key, sample);
                }
                Err(_) => break,
            }
        }

        Ok(())
    }

    fn load_sstables(&self) -> Result<()> {
        let mut levels = self.levels.write();
        let mut max_counter = 0;

        for level in 0..SSTABLE_LEVELS {
            let level_dir = self.data_dir.join(format!("level{}", level));
            if !level_dir.exists() {
                continue;
            }

            for entry in fs::read_dir(level_dir)? {
                let entry = entry?;
                let path = entry.path();
                if path.is_file() && path.extension().map_or(false, |e| e == "sst") {
                    if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                        if let Ok(num) = stem.parse::<usize>() {
                            max_counter = max_counter.max(num);
                        }
                    }
                    let sstable = SSTable::load(path, level)?;
                    levels[level].push(Arc::new(sstable));
                }
            }

            levels[level].sort_by(|a, b| a.min_key.cmp(&b.min_key));
        }

        *self.sstable_counter.write() = max_counter;

        Ok(())
    }

    pub fn insert(&self, key: SeriesKey, sample: Sample) -> Result<()> {
        self.metrics.record_write();

        {
            let mut wal = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&self.wal_path)?;
            bincode::serialize_into(&mut wal, &(&key, &sample))?;
            wal.flush()?;
            self.metrics.record_bytes_written(16);
        }

        let needs_flush = {
            let mut memtable = self.memtable.write();
            memtable.insert(key, sample);
            memtable.size() >= MEMTABLE_SIZE_THRESHOLD
        };

        if needs_flush {
            let mut imm_memtables = self.immutable_memtables.write();
            let old_memtable = std::mem::take(&mut *self.memtable.write());
            imm_memtables.push(old_memtable);
            drop(imm_memtables);
        }

        Ok(())
    }

    fn start_compaction_thread(&self) {
        let memtable = self.memtable.clone();
        let imm_memtables = self.immutable_memtables.clone();
        let levels = self.levels.clone();
        let data_dir = self.data_dir.clone();
        let sstable_counter = self.sstable_counter.clone();
        let wal_path = self.wal_path.clone();
        let metrics = self.metrics.clone();
        let semaphore = self.compaction_semaphore.clone();

        std::thread::spawn(move || {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async move {
                let mut interval = tokio::time::interval(Duration::from_millis(100));

                loop {
                    interval.tick().await;

                    let imm_count = imm_memtables.read().len();
                    if imm_count > 0 {
                        let _permit = semaphore.acquire().await;
                        let memtables: Vec<MemTable> = {
                            let mut imm = imm_memtables.write();
                            imm.drain(..).collect()
                        };

                        for memtable in memtables {
                            if !memtable.is_empty() {
                                let data = memtable.into_btree_map();
                                let counter = {
                                    let mut c = sstable_counter.write();
                                    *c += 1;
                                    *c
                                };

                                let level0_dir = data_dir.join("level0");
                                let _ = fs::create_dir_all(&level0_dir);
                                let sstable_path = level0_dir.join(format!("{}.sst", counter));

                                if let Ok(sstable) = SSTable::create(sstable_path, 0, &data) {
                                    metrics.record_bytes_written(sstable.size());
                                    levels.write()[0].push(Arc::new(sstable));
                                }

                                let _ = fs::remove_file(&wal_path);
                            }
                        }
                    }

                    let level0_count = levels.read()[0].len();
                    if level0_count >= LEVEL0_MAX_SSTABLES {
                        let _permit = semaphore.acquire().await;
                        let _ = Self::run_leveled_compaction(
                            levels.clone(),
                            data_dir.clone(),
                            sstable_counter.clone(),
                            metrics.clone(),
                        );
                    }
                }
            });
        });
    }

    fn run_leveled_compaction(
        levels: Arc<RwLock<Vec<Vec<Arc<SSTable>>>>>,
        data_dir: PathBuf,
        sstable_counter: Arc<RwLock<usize>>,
        metrics: Arc<Metrics>,
    ) -> Result<()> {
        for level in 0..SSTABLE_LEVELS - 1 {
            let max_level_size = (1 << level) * MAX_SSTABLE_SIZE * LEVEL0_MAX_SSTABLES;
            let level_size: usize = levels.read()[level].iter().map(|s| s.size()).sum();

            if level_size >= max_level_size {
                Self::compact_level(
                    levels.clone(),
                    level,
                    data_dir.clone(),
                    sstable_counter.clone(),
                    metrics.clone(),
                )?;
            }
        }
        Ok(())
    }

    fn compact_level(
        levels: Arc<RwLock<Vec<Vec<Arc<SSTable>>>>>,
        level: usize,
        data_dir: PathBuf,
        sstable_counter: Arc<RwLock<usize>>,
        metrics: Arc<Metrics>,
    ) -> Result<()> {
        let mut levels_guard = levels.write();
        let level_sstables = &levels_guard[level];
        if level_sstables.is_empty() {
            return Ok(());
        }

        let sstable_to_compact = level_sstables.last().unwrap().clone();
        let mut overlapping_sstables = vec![sstable_to_compact.clone()];

        let next_level = level + 1;
        for sstable in &levels_guard[next_level] {
            if sstable.overlaps_with(&sstable_to_compact) {
                overlapping_sstables.push(sstable.clone());
            }
        }

        let mut merged_data: BTreeMap<SeriesKey, Vec<Sample>> = BTreeMap::new();
        let mut total_compacted_size = 0;

        for sstable in &overlapping_sstables {
            total_compacted_size += sstable.size();
            let series_keys = sstable.get_all_series()?;
            for key in series_keys {
                let samples = sstable.get(&key, i64::MIN, i64::MAX)?;
                let entry = merged_data.entry(key).or_insert_with(Vec::new);
                entry.extend(samples);
            }
        }

        for samples in merged_data.values_mut() {
            samples.sort_by_key(|s| s.timestamp);
            samples.dedup_by_key(|s| s.timestamp);
        }

        let mut new_sstables = Vec::new();
        let mut current_chunk: BTreeMap<SeriesKey, Vec<Sample>> = BTreeMap::new();
        let mut current_size = 0;

        for (key, samples) in merged_data {
            let sample_size = samples.len() * 16;
            if current_size + sample_size > MAX_SSTABLE_SIZE && !current_chunk.is_empty() {
                let counter = {
                    let mut c = sstable_counter.write();
                    *c += 1;
                    *c
                };

                let next_level_dir = data_dir.join(format!("level{}", next_level));
                let _ = fs::create_dir_all(&next_level_dir);
                let sstable_path = next_level_dir.join(format!("{}.sst", counter));

                let sstable = SSTable::create(sstable_path, next_level, &current_chunk)?;
                new_sstables.push(Arc::new(sstable));
                current_chunk = BTreeMap::new();
                current_size = 0;
            }
            current_chunk.insert(key, samples);
            current_size += sample_size;
        }

        if !current_chunk.is_empty() {
            let counter = {
                let mut c = sstable_counter.write();
                *c += 1;
                *c
            };

            let next_level_dir = data_dir.join(format!("level{}", next_level));
            let _ = fs::create_dir_all(&next_level_dir);
            let sstable_path = next_level_dir.join(format!("{}.sst", counter));

            let sstable = SSTable::create(sstable_path, next_level, &current_chunk)?;
            new_sstables.push(Arc::new(sstable));
        }

        let overlapping_keys: HashSet<_> = overlapping_sstables
            .iter()
            .map(|s| s.path.file_name().unwrap())
            .collect();

        levels_guard[level].retain(|s| !overlapping_keys.contains(&s.path.file_name().unwrap()));
        levels_guard[next_level].retain(|s| !overlapping_keys.contains(&s.path.file_name().unwrap()));

        for sstable in overlapping_sstables {
            let _ = fs::remove_file(&sstable.path);
        }

        for sstable in new_sstables {
            metrics.record_bytes_written(sstable.size());
            levels_guard[next_level].push(sstable);
        }

        levels_guard[next_level].sort_by(|a, b| a.min_key.cmp(&b.min_key));

        metrics.record_compaction(total_compacted_size);

        Ok(())
    }

    pub fn query(&self, key: &SeriesKey, start: i64, end: i64) -> Result<Vec<Sample>> {
        let mut all_samples = Vec::new();
        let mut sstables_read = 0;

        {
            let memtable = self.memtable.read();
            all_samples.extend(memtable.get(key, start, end));
        }

        {
            let imm_memtables = self.immutable_memtables.read();
            for memtable in imm_memtables.iter() {
                all_samples.extend(memtable.get(key, start, end));
            }
        }

        {
            let levels = self.levels.read();
            for level in levels.iter() {
                for sstable in level.iter() {
                    if sstable.might_contain(key) {
                        if let Some((_, min_ts, max_ts)) = sstable.index.get(key) {
                            if *max_ts >= start && *min_ts <= end {
                                let samples = sstable.get(key, start, end)?;
                                all_samples.extend(samples);
                                sstables_read += 1;
                            }
                        }
                    }
                }
            }
        }

        self.metrics.record_query(sstables_read);

        Self::merge_samples(&mut all_samples);

        Ok(all_samples)
    }

    fn merge_samples(samples: &mut Vec<Sample>) {
        samples.sort_by(|a, b| {
            a.timestamp.cmp(&b.timestamp).then_with(|| {
                b.value.partial_cmp(&a.value).unwrap_or(std::cmp::Ordering::Equal)
            })
        });

        samples.dedup_by(|a, b| a.timestamp == b.timestamp);
    }

    pub fn get_all_series_keys(&self) -> Result<Vec<SeriesKey>> {
        let mut keys = HashSet::new();

        {
            let memtable = self.memtable.read();
            keys.extend(memtable.data.keys().cloned());
        }

        {
            let levels = self.levels.read();
            for level in levels.iter().rev() {
                for sstable in level.iter() {
                    keys.extend(sstable.get_all_series()?);
                }
            }
        }

        let mut key_list: Vec<_> = keys.into_iter().collect();
        key_list.sort();
        Ok(key_list)
    }

    pub fn get_metrics(&self) -> LsmMetrics {
        self.metrics.get_metrics()
    }

    pub fn delete_series_older_than(&self, cutoff_time: i64) -> Result<()> {
        let mut levels = self.levels.write();

        for level in 0..SSTABLE_LEVELS {
            let mut to_remove = Vec::new();
            let mut to_update = Vec::new();

            for sstable in &levels[level] {
                let mut all_expired = true;
                let mut has_data = false;

                for key in sstable.get_all_series()? {
                    if let Some((_, _, max_ts)) = sstable.index.get(&key) {
                        if *max_ts >= cutoff_time {
                            all_expired = false;
                            has_data = true;
                            break;
                        }
                    }
                }

                if all_expired && has_data {
                    to_remove.push(sstable.path.clone());
                }
            }

            levels[level].retain(|s| !to_remove.contains(&s.path));
            for path in to_remove {
                let _ = fs::remove_file(path);
            }
        }

        Ok(())
    }
}
