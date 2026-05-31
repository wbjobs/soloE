use clap::Parser;
use std::path::PathBuf;

#[derive(Parser, Debug, Clone)]
#[command(author, version, about, long_about = None)]
pub struct Config {
    #[arg(long, default_value = "0.0.0.0")]
    pub host: String,

    #[arg(long, default_value_t = 8080)]
    pub port: u16,

    #[arg(long)]
    pub data_dir: Option<PathBuf>,

    #[arg(long, default_value_t = 7)]
    pub retention_days: u32,

    #[arg(long, default_value = "info")]
    pub log_level: String,
}

impl Config {
    pub fn get_data_dir(&self) -> PathBuf {
        self.data_dir.clone().unwrap_or_else(|| {
            let mut dir = PathBuf::new();
            dir.push("data");
            dir
        })
    }
}
