use anyhow::Result;
use chrono::Utc;
use std::fs;

use crate::config::Config;

pub fn execute(name: &str) -> Result<()> {
    println!("Creating migration: {}", name);

    let config = Config::load()?;

    let timestamp = Utc::now().format("%Y%m%d%H%M%S").to_string();
    let filename = format!("{}_{}.sql", timestamp, name);
    let filepath = format!("{}/{}", config.migrations_dir, filename);

    let template = r#"-- up
-- Add your migration SQL here

-- down
-- Add your rollback SQL here
"#;

    fs::write(&filepath, template)?;

    println!("✓ Created migration file: {}", filepath);
    println!("\nEdit the file to add your SQL, then run 'pg_migrate up' to apply it.");

    Ok(())
}
