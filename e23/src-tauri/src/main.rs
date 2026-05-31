#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone)]
struct Note {
    id: i32,
    title: String,
    content: String,
    last_modified: String,
}

#[derive(Debug, thiserror::Error)]
enum Error {
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("Time error")]
    Time,
}

impl Serialize for Error {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.to_string().as_str())
    }
}

struct DbState(Mutex<Connection>);

fn init_database(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            last_modified TEXT NOT NULL
        )",
        [],
    )?;
    Ok(())
}

#[tauri::command]
fn get_notes(state: State<'_, DbState>) -> Result<Vec<Note>, Error> {
    let conn = state.0.lock().unwrap();
    let mut stmt = conn.prepare("SELECT id, title, content, last_modified FROM notes ORDER BY last_modified DESC")?;
    let notes = stmt.query_map([], |row| {
        Ok(Note {
            id: row.get(0)?,
            title: row.get(1)?,
            content: row.get(2)?,
            last_modified: row.get(3)?,
        })
    })?;
    let mut result = Vec::new();
    for note in notes {
        result.push(note?);
    }
    Ok(result)
}

#[tauri::command]
fn create_note(state: State<'_, DbState>, title: String, content: String) -> Result<Note, Error> {
    let conn = state.0.lock().unwrap();
    let now: DateTime<Utc> = Utc::now();
    let last_modified = now.to_rfc3339();
    conn.execute(
        "INSERT INTO notes (title, content, last_modified) VALUES (?1, ?2, ?3)",
        params![title, content, last_modified],
    )?;
    let id = conn.last_insert_rowid() as i32;
    Ok(Note {
        id,
        title,
        content,
        last_modified,
    })
}

#[tauri::command]
fn update_note(state: State<'_, DbState>, id: i32, title: String, content: String) -> Result<Note, Error> {
    let conn = state.0.lock().unwrap();
    let now: DateTime<Utc> = Utc::now();
    let last_modified = now.to_rfc3339();
    conn.execute(
        "UPDATE notes SET title = ?1, content = ?2, last_modified = ?3 WHERE id = ?4",
        params![title, content, last_modified, id],
    )?;
    Ok(Note {
        id,
        title,
        content,
        last_modified,
    })
}

#[tauri::command]
fn delete_note(state: State<'_, DbState>, id: i32) -> Result<(), Error> {
    let conn = state.0.lock().unwrap();
    conn.execute("DELETE FROM notes WHERE id = ?1", params![id])?;
    Ok(())
}

fn main() {
    let app_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| std::env::current_dir().unwrap());
    
    let db_path = app_dir.join("notes.db");
    let conn = Connection::open(db_path).expect("Failed to open database");
    init_database(&conn).expect("Failed to initialize database");

    tauri::Builder::default()
        .manage(DbState(Mutex::new(conn)))
        .invoke_handler(tauri::generate_handler![
            get_notes,
            create_note,
            update_note,
            delete_note
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
