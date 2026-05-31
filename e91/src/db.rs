use crate::TranslationResult;
use anyhow::{Context, Result};
use chrono::Local;
use rusqlite::{params, Connection};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

pub struct Database {
    conn: Arc<Mutex<Connection>>,
}

impl Database {
    pub fn new() -> Result<Self> {
        let app_dir = std::env::var("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("."));
        let db_path = app_dir.join("hover_translator").join("translations.db");
        
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let conn = Connection::open(&db_path)
            .with_context(|| format!("Failed to open database at {:?}", db_path))?;
        
        conn.execute(
            "CREATE TABLE IF NOT EXISTS translations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                original TEXT NOT NULL,
                translated TEXT NOT NULL,
                optimized TEXT NOT NULL,
                direction TEXT NOT NULL,
                timestamp DATETIME NOT NULL
            )",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_timestamp ON translations(timestamp)",
            [],
        )?;

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    pub async fn insert_translation(&self, result: &TranslationResult) -> Result<i64> {
        let conn = self.conn.lock().await;
        let timestamp = result.timestamp.format("%Y-%m-%d %H:%M:%S").to_string();
        
        conn.execute(
            "INSERT INTO translations (original, translated, optimized, direction, timestamp)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                result.original,
                result.translated,
                result.optimized,
                result.direction,
                timestamp,
            ],
        )?;

        let id = conn.last_insert_rowid();
        
        self.cleanup_old().await?;
        
        Ok(id)
    }

    async fn cleanup_old(&self) -> Result<()> {
        let conn = self.conn.lock().await;
        
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM translations",
            [],
            |row| row.get(0),
        )?;

        if count > 50 {
            let to_delete = count - 50;
            conn.execute(
                "DELETE FROM translations WHERE id IN (
                    SELECT id FROM translations ORDER BY timestamp ASC LIMIT ?1
                )",
                params![to_delete],
            )?;
        }

        Ok(())
    }

    pub async fn get_history(&self) -> Result<Vec<TranslationResult>> {
        let conn = self.conn.lock().await;
        
        let mut stmt = conn.prepare(
            "SELECT original, translated, optimized, direction, timestamp
             FROM translations
             ORDER BY timestamp DESC
             LIMIT 50",
        )?;

        let rows = stmt.query_map([], |row| {
            let timestamp_str: String = row.get(4)?;
            let timestamp = chrono::NaiveDateTime::parse_from_str(
                &timestamp_str,
                "%Y-%m-%d %H:%M:%S",
            )
            .unwrap_or_else(|_| Local::now().naive_local())
            .and_local_timezone(Local)
            .single()
            .unwrap_or_else(|| Local::now());

            Ok(TranslationResult {
                original: row.get(0)?,
                translated: row.get(1)?,
                optimized: row.get(2)?,
                direction: row.get(3)?,
                timestamp,
            })
        })?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row?);
        }

        Ok(results)
    }

    pub async fn clear_history(&self) -> Result<()> {
        let conn = self.conn.lock().await;
        conn.execute("DELETE FROM translations", [])?;
        Ok(())
    }
}
