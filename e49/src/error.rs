use thiserror::Error;

#[derive(Error, Debug)]
pub enum SymConflictError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Command execution error: {0}")]
    CommandExecution(String),

    #[error("Tool not found: {0}")]
    ToolNotFound(String),

    #[error("Parse error: {0}")]
    ParseError(String),

    #[error("Unsupported platform: {0}")]
    UnsupportedPlatform(String),

    #[error("Invalid file: {0}")]
    InvalidFile(String),

    #[error("JSON serialization error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Regex error: {0}")]
    Regex(#[from] regex::Error),

    #[error("Other error: {0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, SymConflictError>;
