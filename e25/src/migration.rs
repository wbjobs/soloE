use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use sqlx::{postgres::PgPoolOptions, PgConnection, PgPool, Row};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct MigrationFile {
    pub timestamp: String,
    pub name: String,
    pub filename: String,
    pub path: PathBuf,
    pub up_sql: String,
    pub down_sql: String,
}

#[derive(Debug, sqlx::FromRow)]
pub struct MigrationRecord {
    pub id: i32,
    pub name: String,
    pub timestamp: String,
    pub applied_at: DateTime<Utc>,
}

impl MigrationFile {
    pub fn from_path(path: PathBuf) -> Result<Self> {
        let filename = path
            .file_name()
            .context("Invalid filename")?
            .to_str()
            .context("Invalid UTF-8 in filename")?
            .to_string();

        let parts: Vec<&str> = filename.splitn(2, '_').collect();
        if parts.len() != 2 {
            anyhow::bail!("Invalid migration filename format: {}", filename);
        }

        let timestamp = parts[0].to_string();
        let name_with_ext = parts[1];
        let name = name_with_ext
            .strip_suffix(".sql")
            .context("Migration file must have .sql extension")?
            .to_string();

        let content = fs::read_to_string(&path)
            .with_context(|| format!("Failed to read migration file: {}", filename))?;

        let (up_sql, down_sql) = Self::parse_sql(&content)?;

        Ok(Self {
            timestamp,
            name,
            filename,
            path,
            up_sql,
            down_sql,
        })
    }

    fn parse_sql(content: &str) -> Result<(String, String)> {
        let parts: Vec<&str> = content.split("-- down").collect();
        if parts.len() != 2 {
            anyhow::bail!("Migration file must contain -- down separator");
        }

        let up_part = parts[0];
        let up_sql = up_part
            .strip_prefix("-- up")
            .context("Migration file must start with -- up")?
            .trim()
            .to_string();

        let down_sql = parts[1].trim().to_string();

        if up_sql.is_empty() {
            anyhow::bail!("-- up section cannot be empty");
        }

        Ok((up_sql, down_sql))
    }

    pub fn requires_non_transaction(&self, sql: &str) -> bool {
        let upper_sql = sql.to_uppercase();
        let non_transaction_keywords = [
            "CREATE INDEX CONCURRENTLY",
            "DROP INDEX CONCURRENTLY",
            "REINDEX CONCURRENTLY",
            "VACUUM",
            "CREATE DATABASE",
            "DROP DATABASE",
            "ALTER SYSTEM",
        ];

        for keyword in &non_transaction_keywords {
            if upper_sql.contains(keyword) {
                return true;
            }
        }
        false
    }
}

pub async fn create_db_pool(database_url: &str) -> Result<PgPool> {
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(database_url)
        .await
        .context("Failed to connect to database")?;

    Ok(pool)
}

pub async fn migrations_table_exists(pool: &PgPool) -> Result<bool> {
    let result = sqlx::query(
        "SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_name = '_migrations'
        )"
    )
    .fetch_one(pool)
    .await
    .context("Failed to check if _migrations table exists")?;

    Ok(result.get(0))
}

pub async fn create_migrations_table(pool: &PgPool) -> Result<()> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS _migrations (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            timestamp VARCHAR(255) NOT NULL UNIQUE,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )"
    )
    .execute(pool)
    .await
    .context("Failed to create _migrations table")?;

    Ok(())
}

pub async fn get_applied_migrations(pool: &PgPool) -> Result<Vec<MigrationRecord>> {
    let migrations = sqlx::query_as::<_, MigrationRecord>(
        "SELECT id, name, timestamp, applied_at FROM _migrations ORDER BY timestamp ASC"
    )
    .fetch_all(pool)
    .await
    .context("Failed to fetch applied migrations")?;

    Ok(migrations)
}

pub async fn get_latest_migration(pool: &PgPool) -> Result<Option<MigrationRecord>> {
    let migration = sqlx::query_as::<_, MigrationRecord>(
        "SELECT id, name, timestamp, applied_at FROM _migrations ORDER BY timestamp DESC LIMIT 1"
    )
    .fetch_optional(pool)
    .await
    .context("Failed to fetch latest migration")?;

    Ok(migration)
}

pub async fn apply_migration(pool: &PgPool, migration: &MigrationFile) -> Result<()> {
    let needs_non_transaction = migration.requires_non_transaction(&migration.up_sql);

    if needs_non_transaction {
        println!("  (Detected non-transactional SQL, running without transaction)");
        
        let mut conn = pool.acquire().await.context("Failed to acquire connection")?;
        
        sqlx::query(&migration.up_sql)
            .execute(&mut *conn)
            .await
            .with_context(|| format!("Failed to execute up SQL for {}", migration.filename))?;

        sqlx::query(
            "INSERT INTO _migrations (name, timestamp) VALUES ($1, $2)"
        )
        .bind(&migration.name)
        .bind(&migration.timestamp)
        .execute(&mut *conn)
        .await
        .with_context(|| format!("Failed to record migration: {}", migration.filename))?;
    } else {
        let mut tx = pool.begin().await.context("Failed to start transaction")?;

        sqlx::query(&migration.up_sql)
            .execute(&mut *tx)
            .await
            .with_context(|| format!("Failed to execute up SQL for {}", migration.filename))?;

        sqlx::query(
            "INSERT INTO _migrations (name, timestamp) VALUES ($1, $2)"
        )
        .bind(&migration.name)
        .bind(&migration.timestamp)
        .execute(&mut *tx)
        .await
        .with_context(|| format!("Failed to record migration: {}", migration.filename))?;

        tx.commit().await.context("Failed to commit transaction")?;
    }

    Ok(())
}

pub async fn rollback_migration(pool: &PgPool, migration: &MigrationFile) -> Result<()> {
    if migration.down_sql.is_empty() {
        anyhow::bail!("-- down section is empty, cannot rollback {}", migration.filename);
    }

    let needs_non_transaction = migration.requires_non_transaction(&migration.down_sql);

    if needs_non_transaction {
        println!("  (Detected non-transactional SQL, running without transaction)");
        
        let mut conn = pool.acquire().await.context("Failed to acquire connection")?;
        
        sqlx::query(&migration.down_sql)
            .execute(&mut *conn)
            .await
            .with_context(|| format!("Failed to execute down SQL for {}", migration.filename))?;

        sqlx::query(
            "DELETE FROM _migrations WHERE timestamp = $1"
        )
        .bind(&migration.timestamp)
        .execute(&mut *conn)
        .await
        .with_context(|| format!("Failed to delete migration record: {}", migration.filename))?;
    } else {
        let mut tx = pool.begin().await.context("Failed to start transaction")?;

        sqlx::query(&migration.down_sql)
            .execute(&mut *tx)
            .await
            .with_context(|| format!("Failed to execute down SQL for {}", migration.filename))?;

        sqlx::query(
            "DELETE FROM _migrations WHERE timestamp = $1"
        )
        .bind(&migration.timestamp)
        .execute(&mut *tx)
        .await
        .with_context(|| format!("Failed to delete migration record: {}", migration.filename))?;

        tx.commit().await.context("Failed to commit transaction")?;
    }

    Ok(())
}
