use std::path::PathBuf;

use dirs::home_dir;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use tracing::{debug, info};

use crate::error::Result;
use crate::models::{AppSettings, TransferTask};

pub struct Storage {
    conn: Connection,
}

impl Storage {
    pub fn new() -> Result<Self> {
        let mut db_path = Self::get_app_dir()?;
        db_path.push("lanshare.db");

        debug!("Opening database at: {:?}", db_path);

        let conn = Connection::open(db_path)?;
        Self::init_tables(&conn)?;

        Ok(Self { conn })
    }

    fn get_app_dir() -> Result<PathBuf> {
        let mut path = home_dir().ok_or_else(|| crate::error::AppError::InvalidConfig(
            "Could not find home directory".to_string()
        ))?;

        path.push(".lanshare");
        std::fs::create_dir_all(&path)?;
        Ok(path)
    }

    fn init_tables(conn: &Connection) -> Result<()> {
        conn.execute(
            "CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS transfers (
                id TEXT PRIMARY KEY,
                data TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS transfer_chunks (
                transfer_id TEXT NOT NULL,
                file_path TEXT NOT NULL,
                chunk_index INTEGER NOT NULL,
                completed BOOLEAN NOT NULL DEFAULT 0,
                PRIMARY KEY (transfer_id, file_path, chunk_index)
            )",
            [],
        )?;

        Ok(())
    }

    pub fn save_settings(&self, settings: &AppSettings) -> Result<()> {
        let settings_json = serde_json::to_string(settings)?;
        self.conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            params!["settings", settings_json],
        )?;
        info!("Settings saved successfully");
        Ok(())
    }

    pub fn load_settings(&self) -> Result<AppSettings> {
        let result: Option<String> = self.conn.query_row(
            "SELECT value FROM settings WHERE key = ?",
            params!["settings"],
            |row| row.get(0),
        ).optional()?;

        match result {
            Some(json) => Ok(serde_json::from_str(&json)?),
            None => Ok(AppSettings::default()),
        }
    }

    pub fn save_transfer(&self, transfer: &TransferTask) -> Result<()> {
        let transfer_json = serde_json::to_string(transfer)?;
        self.conn.execute(
            "INSERT OR REPLACE INTO transfers (id, data) VALUES (?1, ?2)",
            params![transfer.id, transfer_json],
        )?;
        debug!("Transfer saved: {}", transfer.id);
        Ok(())
    }

    pub fn load_transfers(&self) -> Result<Vec<TransferTask>> {
        let mut stmt = self.conn.prepare("SELECT data FROM transfers ORDER BY created_at DESC")?;
        let transfer_iter = stmt.query_map([], |row| row.get::<_, String>(0))?;

        let mut transfers = Vec::new();
        for json in transfer_iter {
            if let Ok(json) = json {
                if let Ok(transfer) = serde_json::from_str(&json) {
                    transfers.push(transfer);
                }
            }
        }

        Ok(transfers)
    }

    pub fn delete_transfer(&self, transfer_id: &str) -> Result<()> {
        self.conn.execute(
            "DELETE FROM transfers WHERE id = ?",
            params![transfer_id],
        )?;
        Ok(())
    }

    pub fn save_chunk_status(&self, transfer_id: &str, file_path: &str, chunk_index: u64, completed: bool) -> Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO transfer_chunks (transfer_id, file_path, chunk_index, completed) VALUES (?1, ?2, ?3, ?4)",
            params![transfer_id, file_path, chunk_index, completed],
        )?;
        Ok(())
    }

    pub fn get_completed_chunks(&self, transfer_id: &str, file_path: &str) -> Result<Vec<u64>> {
        let mut stmt = self.conn.prepare(
            "SELECT chunk_index FROM transfer_chunks WHERE transfer_id = ? AND file_path = ? AND completed = 1"
        )?;
        let chunk_iter = stmt.query_map(params![transfer_id, file_path], |row| row.get(0))?;

        let mut chunks = Vec::new();
        for chunk in chunk_iter {
            if let Ok(chunk) = chunk {
                chunks.push(chunk);
            }
        }

        Ok(chunks)
    }
}
