pub mod db;
pub mod ocr;
pub mod translator;
pub mod capture;
pub mod tray;
pub mod hotkey;

pub use capture::start_capture_loop;
pub use db::Database;
pub use hotkey::{register_hotkeys, set_app_handle};
pub use ocr::{OcrEngine, OcrInitResult, OcrStatus};
pub use translator::translate;

use chrono::{DateTime, Local};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranslationResult {
    pub original: String,
    pub translated: String,
    pub optimized: String,
    pub direction: String,
    pub timestamp: DateTime<Local>,
}
