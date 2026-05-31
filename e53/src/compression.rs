use std::error::Error;
use std::fmt;

#[derive(Debug)]
pub enum CompressionError {
    InvalidInput,
    DecompressionFailed,
}

impl fmt::Display for CompressionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CompressionError::InvalidInput => write!(f, "Invalid input for compression"),
            CompressionError::DecompressionFailed => write!(f, "Decompression failed"),
        }
    }
}

impl Error for CompressionError {}

const SELECTORS: [usize; 16] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20, 24, 32, 64];

pub struct Simple8B;

impl Simple8B {
    pub fn compress(timestamps: &[u64]) -> Result<Vec<u64>, CompressionError> {
        if timestamps.is_empty() {
            return Ok(Vec::new());
        }

        let mut compressed = Vec::new();
        let mut i = 0;
        let n = timestamps.len();

        while i < n {
            let mut best_selector = 15;
            let mut best_count = 0;

            for selector in (1..=15).rev() {
                let bits = SELECTORS[selector];
                let max_count = 60 / bits;
                let count = max_count.min(n - i);
                let mut max_val = 0;
                for j in 0..count {
                    if timestamps[i + j] > max_val {
                        max_val = timestamps[i + j];
                    }
                }
                if max_val < (1u64 << bits) {
                    best_selector = selector;
                    best_count = count;
                    break;
                }
            }

            let bits = SELECTORS[best_selector];
            let count = best_count;
            let mut word = (best_selector as u64) << 60;

            for j in 0..count {
                let val = timestamps[i + j];
                let shift = 60 - ((j + 1) * bits);
                word |= val << shift;
            }

            compressed.push(word);
            i += count;
        }

        Ok(compressed)
    }

    pub fn decompress(compressed: &[u64]) -> Result<Vec<u64>, CompressionError> {
        let mut decompressed = Vec::new();

        for &word in compressed {
            let selector = (word >> 60) as usize;
            let bits = SELECTORS[selector];
            if bits == 0 {
                continue;
            }
            let count = 60 / bits;
            let mask = (1u64 << bits) - 1;

            for i in 0..count {
                let shift = 60 - ((i + 1) * bits);
                let val = (word >> shift) & mask;
                if val != 0 || decompressed.len() > 0 {
                    decompressed.push(val);
                }
            }
        }

        Ok(decompressed)
    }

    pub fn compress_deltas(timestamps: &[i64]) -> Result<Vec<u64>, CompressionError> {
        if timestamps.is_empty() {
            return Ok(Vec::new());
        }

        let mut deltas = Vec::with_capacity(timestamps.len());
        let mut prev = 0;

        for &ts in timestamps {
            let delta = ts - prev;
            if delta < 0 {
                return Err(CompressionError::InvalidInput);
            }
            deltas.push(delta as u64);
            prev = ts;
        }

        Self::compress(&deltas)
    }

    pub fn decompress_deltas(compressed: &[u64]) -> Result<Vec<i64>, CompressionError> {
        let deltas = Self::decompress(compressed)?;
        let mut timestamps = Vec::with_capacity(deltas.len());
        let mut prev = 0;

        for delta in deltas {
            prev += delta as i64;
            timestamps.push(prev);
        }

        Ok(timestamps)
    }
}

pub fn compress_floats(values: &[f64]) -> Result<Vec<u8>, Box<dyn Error>> {
    let mut bytes = Vec::with_capacity(values.len() * 8);
    for &v in values {
        bytes.extend_from_slice(&v.to_be_bytes());
    }
    Ok(bytes)
}

pub fn decompress_floats(bytes: &[u8]) -> Result<Vec<f64>, Box<dyn Error>> {
    let mut values = Vec::with_capacity(bytes.len() / 8);
    for chunk in bytes.chunks_exact(8) {
        let mut arr = [0u8; 8];
        arr.copy_from_slice(chunk);
        values.push(f64::from_be_bytes(arr));
    }
    Ok(values)
}
