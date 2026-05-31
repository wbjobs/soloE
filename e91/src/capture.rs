use crate::db::Database;
use crate::ocr::OcrEngine;
use crate::translator::translate;
use crate::TranslationResult;
use anyhow::{Context, Result};
use image::RgbaImage;
use parking_lot::Mutex;
use screenshots::Screen;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

pub struct CaptureState {
    last_mouse_pos: (i32, i32),
    hover_start: Option<Instant>,
    last_capture_time: Instant,
    ocr_fallback_shown: bool,
}

impl Default for CaptureState {
    fn default() -> Self {
        Self {
            last_mouse_pos: (0, 0),
            hover_start: None,
            last_capture_time: Instant::now() - Duration::from_secs(1),
            ocr_fallback_shown: false,
        }
    }
}

pub async fn start_capture_loop(
    app: AppHandle,
    db: Arc<Database>,
    direction: Arc<Mutex<String>>,
    capture_enabled: Arc<Mutex<bool>>,
    ocr_engine: Arc<Mutex<Option<OcrEngine>>>,
    silent_mode: Arc<Mutex<bool>>,
) {
    let mut state = CaptureState::default();
    
    loop {
        let capture_on = *capture_enabled.lock();
        let silent = *silent_mode.lock();
        
        if !capture_on {
            tokio::time::sleep(Duration::from_millis(100)).await;
            continue;
        }

        let engine_guard = ocr_engine.lock();
        let has_engine = engine_guard.is_some();
        let engine_ready = engine_guard.as_ref().map(|e| e.is_ready()).unwrap_or(false);
        drop(engine_guard);

        if has_engine && engine_ready {
            state.ocr_fallback_shown = false;
            if let Err(e) = capture_and_translate(&app, &db, &ocr_engine, &direction, &mut state, silent).await {
                eprintln!("Capture error: {}", e);
            }
        } else if !state.ocr_fallback_shown {
            state.ocr_fallback_shown = true;
            let error_msg = if !has_engine {
                "OCR 引擎正在初始化，请稍候..."
            } else {
                "OCR 引擎未就绪，已自动切换到手动输入模式"
            };
            let _ = app.emit("ocr:unavailable", error_msg);
            eprintln!("OCR unavailable: {}", error_msg);
        }

        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

async fn capture_and_translate(
    app: &AppHandle,
    db: &Database,
    ocr_engine: &Arc<Mutex<Option<OcrEngine>>>,
    direction: &Arc<Mutex<String>>,
    state: &mut CaptureState,
    silent: bool,
) -> Result<()> {
    let mouse_pos = get_mouse_position().unwrap_or(state.last_mouse_pos);
    
    let moved = (mouse_pos.0 - state.last_mouse_pos.0).abs() > 5
        || (mouse_pos.1 - state.last_mouse_pos.1).abs() > 5;
    
    if moved {
        state.last_mouse_pos = mouse_pos;
        state.hover_start = Some(Instant::now());
        return Ok(());
    }
    
    let hover_time = state.hover_start.unwrap_or_else(Instant::now).elapsed();
    if hover_time < Duration::from_millis(500) {
        return Ok(());
    }
    
    if state.last_capture_time.elapsed() < Duration::from_secs(2) {
        return Ok(());
    }
    state.last_capture_time = Instant::now();
    
    let image = capture_area_around_mouse(mouse_pos, 300, 100)
        .context("Failed to capture screen area")?;
    
    let engine_guard = ocr_engine.lock();
    let text = match engine_guard.as_ref() {
        Some(engine) => engine.recognize(&image).context("OCR recognition failed")?,
        None => {
            drop(engine_guard);
            return Ok(());
        }
    };
    drop(engine_guard);
    
    if text.is_empty() || text.len() < 2 {
        return Ok(());
    }
    
    app.emit("translation:started", ())?;
    
    let dir = direction.lock().clone();
    match translate(&text, &dir).await {
        Ok(result) => {
            let _ = db.insert_translation(&result).await;
            app.emit("translation:result", &result)?;
            if !silent {
                show_result_window(app, mouse_pos)?;
            }
        }
        Err(e) => {
            app.emit("translation:error", e.to_string())?;
        }
    }
    
    app.emit("translation:finished", ())?;
    
    Ok(())
}

pub async fn show_manual_input_fallback(app: &AppHandle, error: String) {
    let _ = app.emit("ocr:error", error.clone());
    
    let window_label = "manual-input";
    if app.get_webview_window(window_label).is_none() {
        let encoded = urlencoding::encode(&error);
        let url = tauri::WebviewUrl::App(format!("/manual-input.html?error={}", encoded).into());
        
        if let Ok(window) = tauri::WebviewWindowBuilder::new(
            app,
            window_label,
            url,
        )
        .title("手动输入文本")
        .inner_size(500.0, 400.0)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .minimizable(false)
        .maximizable(false)
        .build() {
            let _ = window.show();
        }
    }
}

fn get_mouse_position() -> Result<(i32, i32)> {
    #[cfg(target_os = "windows")]
    {
        use winapi::shared::windef::POINT;
        use winapi::um::winuser::GetCursorPos;
        use std::ptr::null_mut;
        
        unsafe {
            let mut point = POINT { x: 0, y: 0 };
            if GetCursorPos(&mut point) == 0 {
                anyhow::bail!("Failed to get cursor position");
            }
            Ok((point.x, point.y))
        }
    }
    
    #[cfg(not(target_os = "windows"))]
    {
        Ok((0, 0))
    }
}

fn capture_area_around_mouse(center: (i32, i32), width: u32, height: u32) -> Result<RgbaImage> {
    let screens = Screen::all().context("Failed to get screens")?;
    
    if screens.is_empty() {
        anyhow::bail!("No screens found");
    }
    
    let screen = screens[0];
    
    let x = (center.0 - width as i32 / 2).max(0);
    let y = (center.1 - height as i32 / 2).max(0);
    
    let image = screen
        .capture_area(x, y, width, height)
        .context("Failed to capture screen area")?;
    
    Ok(image)
}

fn show_result_window(app: &AppHandle, mouse_pos: (i32, i32)) -> Result<()> {
    if let Some(window) = app.get_webview_window("translate-result") {
        let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
            x: mouse_pos.0 + 20,
            y: mouse_pos.1 + 20,
        }));
        let _ = window.show();
    }
    Ok(())
}
