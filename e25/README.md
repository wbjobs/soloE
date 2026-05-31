# pg_migrate - PostgreSQL Database Migration Tool

A command-line tool for managing PostgreSQL database migrations written in Rust.

## Features

- `init` - Initialize project, create migrations directory and `_migrations` table
- `create <name>` - Create new migration file with `-- up` and `-- down` sections
- `up` - Apply all pending migrations in timestamp order
- `down` - Rollback the last applied migration

## Installation

```bash
cargo build --release
```

## Usage

### 1. Configure Database Connection

Copy `.env.example` to `.env` and update with your database credentials:

```bash
cp .env.example .env
# Edit .env with your DATABASE_URL
```

### 2. Initialize Project

```bash
cargo run -- init
```

This will:
- Create `migrations/` directory
- Create `_migrations` table in your database to track migration history

### 3. Create a Migration

```bash
cargo run -- create create_users_table
```

This creates a file like `migrations/20240101120000_create_users_table.sql` with:

```sql
-- up
-- Add your migration SQL here

-- down
-- Add your rollback SQL here
```

Edit the file with your SQL:

```sql
-- up
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- down
DROP TABLE users;
```

### 4. Apply Migrations

```bash
cargo run -- up
```

### 5. Rollback Migration

```bash
cargo run -- down
```

## Migration File Format

Each migration file must contain:
- `-- up` section: SQL to apply the migration
- `-- down` section: SQL to rollback the migration

Files are named with the pattern `YYYYMMDDHHMMSS_<name>.sql` to ensure proper ordering.

## Seed Data

The `seed` command populates the database with initial test data.

### Important Notes

1. **Development Only**: Seed command only runs in development environment.
   - Set `RUST_ENV=development` or `ENV=development` in your `.env` file
   - In production, the command will be blocked for safety

2. **Idempotent**: Seed files should use `INSERT ... ON CONFLICT DO NOTHING`
   - This ensures the seed can be run multiple times without errors
   - Example:
     ```sql
     INSERT INTO users (id, name, email) VALUES
     (1, 'Admin', 'admin@example.com')
     ON CONFLICT (id) DO NOTHING;
     ```

### Usage

```bash
# Ensure you're in development environment
# RUST_ENV=development should be set in .env

cargo run -- seed
```

### Seed Files

Place `.sql` files in the `seeds/` directory. Files are executed in alphabetical order.

Example structure:
```
seeds/
├── 01_users.sql      # Executed first
├── 02_roles.sql      # Executed second
└── 03_products.sql   # Executed third
```
