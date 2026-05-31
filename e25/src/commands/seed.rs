use anyhow::{Context, Result};
use std::fs;
use walkdir::WalkDir;

use crate::config::Config;
use crate::migration::create_db_pool;

pub async fn execute() -> Result<()> {
    println!("Running seed data...\n");

    let config = Config::load()?;

    if !config.is_development() {
        println!("⚠️  Warning: Seed command is only allowed in development environment.");
        println!("   Current environment: {:?}", config.environment);
        println!("\n   To run seeds, set RUST_ENV=development or ENV=development.");
        anyhow::bail!("Seed command blocked for non-development environment");
    }

    println!("✓ Environment check passed (development)");

    let pool = create_db_pool(&config.database_url).await?;
    println!("✓ Connected to database\n");

    let mut seed_files: Vec<_> = WalkDir::new(&config.seeds_dir)
        .max_depth(1)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .and_then(|s| s.to_str())
                .map(|s| s == "sql")
                .unwrap_or(false)
        })
        .collect();

    if seed_files.is_empty() {
        println!("No seed files found in '{}' directory.", config.seeds_dir);
        println!("Create .sql files in the seeds directory to populate initial data.");
        println!("\nTip: Use INSERT ... ON CONFLICT DO NOTHING for idempotent inserts.");
        return Ok(());
    }

    seed_files.sort_by_key(|e| e.file_name().to_owned());

    println!("Found {} seed file(s):", seed_files.len());
    for entry in &seed_files {
        println!("  - {}", entry.file_name().to_string_lossy());
    }
    println!();

    let mut applied = 0;

    for entry in seed_files {
        let filename = entry.file_name().to_string_lossy().to_string();
        print!("Seeding: {} ... ", filename);

        let content = fs::read_to_string(entry.path())
            .with_context(|| format!("Failed to read seed file: {}", filename))?;

        let has_idempotent = content.to_uppercase().contains("ON CONFLICT");
        
        if !has_idempotent {
            println!("⚠️");
            println!("  Warning: Seed file does not contain 'ON CONFLICT'.");
            println!("  This may cause duplicate key errors if run multiple times.");
            println!("  Consider using: INSERT ... ON CONFLICT DO NOTHING");
            print!("  Continue? (y/N) ");
            
            // For now, we'll proceed but warn the user
            println!();
        }

        match sqlx::query(&content)
            .execute(&pool)
            .await
        {
            Ok(_) => {
                println!("✓ Success");
                applied += 1;
            }
            Err(e) => {
                println!("✗ Failed");
                eprintln!("  Error: {}", e);
                anyhow::bail!("Seed failed: {}", filename);
            }
        }
    }

    println!("\n✓ Applied {} seed file(s) successfully!", applied);

    Ok(())
}
