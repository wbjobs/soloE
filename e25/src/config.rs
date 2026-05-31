use anyhow::{Context, Result};
use std::env;

pub struct Config {
    pub database_url: String,
    pub migrations_dir: String,
    pub seeds_dir: String,
    pub environment: Environment,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Environment {
    Development,
    Production,
    Other(String),
}

impl Config {
    pub fn load() -> Result<Self> {
        let database_url = env::var("DATABASE_URL")
            .context("DATABASE_URL environment variable not set")?;
        
        let environment = Self::detect_environment();
        
        Ok(Self {
            database_url,
            migrations_dir: "migrations".to_string(),
            seeds_dir: "seeds".to_string(),
            environment,
        })
    }

    fn detect_environment() -> Environment {
        let env = env::var("RUST_ENV")
            .or_else(|_| env::var("ENV"))
            .unwrap_or_else(|_| "development".to_string())
            .to_lowercase();

        match env.as_str() {
            "development" | "dev" => Environment::Development,
            "production" | "prod" => Environment::Production,
            _ => Environment::Other(env),
        }
    }

    pub fn is_development(&self) -> bool {
        matches!(self.environment, Environment::Development)
    }
}
