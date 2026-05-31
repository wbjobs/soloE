use anyhow::Result;
use std::fs;

use crate::config::Config;
use crate::migration::{create_db_pool, create_migrations_table, migrations_table_exists};

pub async fn execute() -> Result<()> {
    println!("Initializing migration project...");

    let config = Config::load()?;

    println!("Creating migrations directory...");
    fs::create_dir_all(&config.migrations_dir)?;
    println!("✓ Created directory: {}", config.migrations_dir);

    println!("Connecting to database...");
    let pool = create_db_pool(&config.database_url).await?;
    println!("✓ Connected to database");

    println!("Creating _migrations table...");
    if migrations_table_exists(&pool).await? {
        println!("  _migrations table already exists");
    } else {
        create_migrations_table(&pool).await?;
        println!("✓ Created _migrations table");
    }

    println!("\n✓ Initialization complete!");
    println!("\nNext steps:");
    println!("  1. Create a migration: pg_migrate create <migration_name>");
    println!("  2. Run migrations: pg_migrate up");

    Ok(())
}
