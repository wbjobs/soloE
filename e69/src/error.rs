use thiserror::Error;
use wasmtime::Error as WasmtimeError;

#[derive(Error, Debug)]
pub enum SchedulerError {
    #[error("Wasmtime error: {0}")]
    Wasmtime(#[from] WasmtimeError),

    #[error("Module not found: {0}")]
    ModuleNotFound(String),

    #[error("Module already exists: {0}")]
    ModuleAlreadyExists(String),

    #[error("Resource limit exceeded: {0}")]
    ResourceLimitExceeded(String),

    #[error("IPC error: {0}")]
    IpcError(String),

    #[error("Execution timeout: module {0} exceeded CPU time limit")]
    ExecutionTimeout(String),

    #[error("Invalid priority: {0}")]
    InvalidPriority(u32),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Other error: {0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, SchedulerError>;
