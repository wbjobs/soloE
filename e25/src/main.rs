mod cli;
mod config;
mod migration;
mod commands;

use anyhow::Result;
use cli::{Cli, Commands};
use clap::Parser;

#[tokio::main]
async fn main() -> Result<()> {
    dotenv::dotenv().ok();
    let cli = Cli::parse();

    match cli.command {
        Commands::Init => commands::init::execute().await?,
        Commands::Create { name } => commands::create::execute(&name)?,
        Commands::Up => commands::up::execute().await?,
        Commands::Down => commands::down::execute().await?,
        Commands::Seed => commands::seed::execute().await?,
    }

    Ok(())
}
