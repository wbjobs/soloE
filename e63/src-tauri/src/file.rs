use memmap2::Mmap;
use sha2::{Sha256, Digest};
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;
use uuid::Uuid;

const CHUNK_SIZE: u64 = 1024 * 1024;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FileInfo {
    pub file_id: String,
    pub name: String,
    pub size: u64,
    pub total_chunks: u32,
    pub chunk_hashes: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ChunkData {
    pub file_id: String,
    pub index: u32,
    pub data: Vec<u8>,
    pub hash: String,
}

pub struct OpenFiles {
    files: Mutex<HashMap<String, (File, Mmap, FileInfo)>>,
}

impl Default for OpenFiles {
    fn default() -> Self {
        Self {
            files: Mutex::new(HashMap::new()),
        }
    }
}

pub struct ReceivedFiles {
    files: Mutex<HashMap<String, (File, u64, Vec<bool>, Vec<String>)>>,
}

impl Default for ReceivedFiles {
    fn default() -> Self {
        Self {
            files: Mutex::new(HashMap::new()),
        }
    }
}

#[tauri::command]
pub async fn open_file(
    path: String,
    open_files: State<'_, OpenFiles>,
) -> Result<FileInfo, String> {
    let path = PathBuf::from(path);
    if !path.exists() {
        return Err("File not found".to_string());
    }

    let file = File::open(&path).map_err(|e| e.to_string())?;
    let mmap = unsafe { Mmap::map(&file).map_err(|e| e.to_string())? };
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    let size = metadata.len();
    let total_chunks = ((size + CHUNK_SIZE - 1) / CHUNK_SIZE) as u32;

    let name = path
        .file_name()
        .ok_or_else(|| "Invalid filename".to_string())?
        .to_string_lossy()
        .to_string();

    let file_id = Uuid::new_v4().to_string();
    let mut chunk_hashes = Vec::with_capacity(total_chunks as usize);

    for i in 0..total_chunks {
        let start = (i as u64) * CHUNK_SIZE;
        let end = std::cmp::min(start + CHUNK_SIZE, size);
        let chunk_data = &mmap[start as usize..end as usize];
        let mut hasher = Sha256::new();
        hasher.update(chunk_data);
        let hash = format!("{:x}", hasher.finalize());
        chunk_hashes.push(hash);
    }

    let file_info = FileInfo {
        file_id: file_id.clone(),
        name,
        size,
        total_chunks,
        chunk_hashes,
    };

    let mut files = open_files.files.lock().unwrap();
    files.insert(file_id, (file, mmap, file_info.clone()));

    Ok(file_info)
}

#[tauri::command]
pub async fn get_file_info(
    file_id: String,
    open_files: State<'_, OpenFiles>,
) -> Result<FileInfo, String> {
    let files = open_files.files.lock().unwrap();
    files
        .get(&file_id)
        .map(|(_, _, info)| info.clone())
        .ok_or_else(|| "File not found".to_string())
}

#[tauri::command]
pub async fn read_chunk(
    file_id: String,
    chunk_index: u32,
    open_files: State<'_, OpenFiles>,
) -> Result<ChunkData, String> {
    let files = open_files.files.lock().unwrap();
    let (_, mmap, info) = files
        .get(&file_id)
        .ok_or_else(|| "File not found".to_string())?;

    if chunk_index >= info.total_chunks {
        return Err("Invalid chunk index".to_string());
    }

    let start = (chunk_index as u64) * CHUNK_SIZE;
    let end = std::cmp::min(start + CHUNK_SIZE, info.size);
    let data = mmap[start as usize..end as usize].to_vec();
    let hash = info.chunk_hashes[chunk_index as usize].clone();

    Ok(ChunkData {
        file_id,
        index: chunk_index,
        data,
        hash,
    })
}

#[tauri::command]
pub async fn create_file(
    file_id: String,
    name: String,
    size: u64,
    total_chunks: u32,
    save_path: String,
    received_files: State<'_, ReceivedFiles>,
) -> Result<(), String> {
    let path = PathBuf::from(save_path).join(name);
    let mut file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .open(&path)
        .map_err(|e| e.to_string())?;

    file.set_len(size).map_err(|e| e.to_string())?;
    file.flush().map_err(|e| e.to_string())?;

    let chunk_received = vec![false; total_chunks as usize];
    let chunk_hashes = Vec::with_capacity(total_chunks as usize);

    let mut files = received_files.files.lock().unwrap();
    files.insert(file_id, (file, size, chunk_received, chunk_hashes));

    Ok(())
}

#[cfg(windows)]
fn write_at_offset(file: &mut File, data: &[u8], offset: u64) -> std::io::Result<()> {
    use std::os::windows::fs::FileExt;
    file.seek_write(data, offset)?;
    Ok(())
}

#[cfg(unix)]
fn write_at_offset(file: &mut File, data: &[u8], offset: u64) -> std::io::Result<()> {
    use std::os::unix::fs::FileExt;
    file.write_at(data, offset)?;
    Ok(())
}

#[tauri::command]
pub async fn write_chunk(
    chunk: ChunkData,
    received_files: State<'_, ReceivedFiles>,
) -> Result<bool, String> {
    let mut files = received_files.files.lock().unwrap();
    let (file, size, chunk_received, chunk_hashes) = files
        .get_mut(&chunk.file_id)
        .ok_or_else(|| "File not found".to_string())?;

    let chunk_idx = chunk.index as usize;

    if chunk_received[chunk_idx] {
        return Ok(true);
    }

    if !chunk.hash.is_empty() {
        let mut hasher = Sha256::new();
        hasher.update(&chunk.data);
        let calculated_hash = format!("{:x}", hasher.finalize());

        if calculated_hash != chunk.hash {
            return Err(format!(
                "Chunk hash mismatch: expected {}, got {}",
                chunk.hash, calculated_hash
            ));
        }
    }

    let start = (chunk.index as u64) * CHUNK_SIZE;
    if start >= *size {
        return Err(format!(
            "Invalid chunk position: start={}, size={}",
            start, size
        ));
    }

    let expected_size = std::cmp::min(CHUNK_SIZE, *size - start) as usize;
    if chunk.data.len() != expected_size {
        return Err(format!(
            "Chunk size mismatch: expected {} bytes, got {} bytes",
            expected_size,
            chunk.data.len()
        ));
    }

    write_at_offset(file, &chunk.data, start).map_err(|e| e.to_string())?;
    file.flush().map_err(|e| e.to_string())?;

    if chunk_hashes.len() <= chunk_idx {
        chunk_hashes.resize(chunk_idx + 1, String::new());
    }
    chunk_hashes[chunk_idx] = chunk.hash;

    chunk_received[chunk_idx] = true;

    let all_received = chunk_received.iter().all(|&x| x);

    if all_received {
        let mmap = unsafe { Mmap::map(&*file).map_err(|e| e.to_string())? };
        for (i, hash) in chunk_hashes.iter().enumerate() {
            if hash.is_empty() {
                continue;
            }
            let start = (i as u64) * CHUNK_SIZE;
            let end = std::cmp::min(start + CHUNK_SIZE, *size);
            let chunk_data = &mmap[start as usize..end as usize];
            let mut hasher = Sha256::new();
            hasher.update(chunk_data);
            let calculated_hash = format!("{:x}", hasher.finalize());
            if &calculated_hash != hash {
                return Err(format!(
                    "Final verification failed at chunk {}: expected {}, got {}",
                    i, hash, calculated_hash
                ));
            }
        }
    }

    Ok(all_received)
}

#[tauri::command]
pub async fn verify_file(
    file_id: String,
    chunk_hashes: Vec<String>,
    received_files: State<'_, ReceivedFiles>,
) -> Result<bool, String> {
    let files = received_files.files.lock().unwrap();
    let (file, size, chunk_received, _) = files
        .get(&file_id)
        .ok_or_else(|| "File not found".to_string())?;

    for (i, &received) in chunk_received.iter().enumerate() {
        if !received {
            return Err(format!("Chunk {} not received", i));
        }
    }

    let mmap = unsafe { Mmap::map(file).map_err(|e| e.to_string())? };
    let total_chunks = chunk_hashes.len() as u32;

    for i in 0..total_chunks {
        let start = (i as u64) * CHUNK_SIZE;
        let end = std::cmp::min(start + CHUNK_SIZE, *size);
        let chunk_data = &mmap[start as usize..end as usize];
        let mut hasher = Sha256::new();
        hasher.update(chunk_data);
        let hash = format!("{:x}", hasher.finalize());
        if hash != chunk_hashes[i as usize] {
            return Err(format!(
                "Chunk {} hash mismatch: expected {}, got {}",
                i, chunk_hashes[i as usize], hash
            ));
        }
    }

    Ok(true)
}
