use anyhow::Result;
use std::collections::HashSet;
use walkdir::WalkDir;

use crate::config::Config;
use crate::migration::{apply_migration, create_db_pool, get_applied_migrations, MigrationFile};

pub async fn execute() -> Result<()> {
    println!("Running migrations...\n");

    let config = Config::load()?;
    let pool = create_db_pool(&config.database_url).await?;

    let applied_migrations = get_applied_migrations(&pool).await?;
    let applied_timestamps: HashSet<String> = applied_migrations
        .iter()
        .map(|m| m.timestamp.clone())
        .collect();

    let mut migration_files: Vec<MigrationFile> = Vec::new();

    for entry in WalkDir::new(&config.migrations_dir)
        .max_depth(1)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("sql") {
            match MigrationFile::from_path(path.to_path_buf()) {
                Ok(migration) => {
                    if !applied_timestamps.contains(&migration.timestamp) {
                        migration_files.push(migration);
                    }
                }
                Err(e) => eprintln!("Warning: {}", e),
            }
        }
    }

    migration_files.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));

    if migration_files.is_empty() {
        println!("✓ No pending migrations to apply.");
        return Ok(());
    }

    println!("Found {} pending migration(s):", migration_files.len());
    for migration in &migration_files {
        println!("  - {}", migration.filename);
    }
    println!();

    let mut applied = 0;

    for migration in migration_files {
        print!("Applying: {} ... ", migration.filename);
        
        match apply_migration(&pool, &migration).await {
            Ok(_) => {
                println!("✓ Success");
                applied += 1;
            }
            Err(e) => {
                println!("✗ Failed");
                eprintln!("Error: {}", e);
                anyhow::bail!("Migration failed: {}", migration.filename);
            }
        }
    }

    println!("\n✓ Applied {} migration(s) successfully!", applied);

    Ok(())
}
