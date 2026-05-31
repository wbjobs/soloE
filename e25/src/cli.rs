use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "pg_migrate")]
#[command(about = "PostgreSQL database migration tool", long_about = None)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand)]
pub enum Commands {
    Init,
    Create { name: String },
    Up,
    Down,
    Seed,
}
