use anyhow::Result;
use std::fs;

use crate::config::Config;
use crate::migration::{create_db_pool, get_latest_migration, rollback_migration, MigrationFile};

pub async fn execute() -> Result<()> {
    println!("Rolling back last migration...\n");

    let config = Config::load()?;
    let pool = create_db_pool(&config.database_url).await?;

    let latest_migration = get_latest_migration(&pool).await?;

    let latest_migration = match latest_migration {
        Some(m) => m,
        None => {
            println!("✓ No migrations have been applied yet.");
            return Ok(());
        }
    };

    println!("Latest applied migration: {} ({})", latest_migration.name, latest_migration.timestamp);

    let migration_files = fs::read_dir(&config.migrations_dir)?;
    let mut found_migration: Option<MigrationFile> = None;

    for entry in migration_files {
        let entry = entry?;
        let path = entry.path();
        if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("sql") {
            if let Ok(migration) = MigrationFile::from_path(path.to_path_buf()) {
                if migration.timestamp == latest_migration.timestamp {
                    found_migration = Some(migration);
                    break;
                }
            }
        }
    }

    let migration_file = match found_migration {
        Some(m) => m,
        None => {
            anyhow::bail!(
                "Could not find migration file for timestamp: {}",
                latest_migration.timestamp
            );
        }
    };

    print!("Rolling back: {} ... ", migration_file.filename);

    match rollback_migration(&pool, &migration_file).await {
        Ok(_) => {
            println!("✓ Success");
            println!("\n✓ Rolled back 1 migration successfully!");
        }
        Err(e) => {
            println!("✗ Failed");
            eprintln!("Error: {}", e);
            anyhow::bail!("Rollback failed: {}", migration_file.filename);
        }
    }

    Ok(())
}
