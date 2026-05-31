use hover_translator_lib::{db::Database, hotkey, ocr::OcrEngine, start_capture_loop, tray, TranslationResult};
use std::sync::Arc;
use parking_lot::Mutex;
use tauri::{Emitter, Manager, WebviewUrl};

#[derive(Debug, Clone)]
pub struct AppState {
    pub db: Arc<Database>,
    pub direction: Arc<Mutex<String>>,
    pub capture_enabled: Arc<Mutex<bool>>,
    pub ocr_engine: Arc<Mutex<Option<OcrEngine>>>,
    pub ocr_error: Arc<Mutex<Option<String>>>,
    pub silent_mode: Arc<Mutex<bool>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let db = Arc::new(Database::new().expect("Failed to initialize database"));
    let direction = Arc::new(Mutex::new("zh-en".to_string()));
    let capture_enabled = Arc::new(Mutex::new(false));
    let ocr_engine: Arc<Mutex<Option<OcrEngine>>> = Arc::new(Mutex::new(None));
    let ocr_error: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let silent_mode: Arc<Mutex<bool>> = Arc::new(Mutex::new(false));

    let state = AppState {
        db: db.clone(),
        direction: direction.clone(),
        capture_enabled: capture_enabled.clone(),
        ocr_engine: ocr_engine.clone(),
        ocr_error: ocr_error.clone(),
        silent_mode: silent_mode.clone(),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            toggle_capture,
            translate_text,
            get_history,
            clear_history,
            set_translation_direction,
            get_translation_direction,
            show_history,
            show_history_window,
            retry_ocr_init,
            show_manual_input,
            get_ocr_status,
            toggle_silent_mode,
            get_silent_mode,
            trigger_translate,
        ])
        .setup(move |app| {
            tray::setup_tray(app, direction.clone(), capture_enabled.clone(), silent_mode.clone())?;
            
            let floating_window = app.get_webview_window("floating-ball").unwrap();
            floating_window.set_always_on_top(true).unwrap();
            
            let result_window = app.get_webview_window("translate-result").unwrap();
            result_window.set_always_on_top(true).unwrap();

            hotkey::set_app_handle(app.handle().clone());
            hotkey::register_hotkeys();

            let app_handle = app.handle().clone();
            let ocr_engine_clone = ocr_engine.clone();
            let ocr_error_clone = ocr_error.clone();
            
            tokio::spawn(async move {
                match OcrEngine::new().await {
                    Ok(engine) => {
                        *ocr_engine_clone.lock() = Some(engine);
                        eprintln!("OCR engine initialized successfully");
                    }
                    Err(e) => {
                        let error_msg = e.to_string();
                        eprintln!("OCR initialization failed: {}", error_msg);
                        *ocr_error_clone.lock() = Some(error_msg.clone());
                        let _ = app_handle.emit("ocr:initialization_failed", error_msg);
                    }
                }
                
                start_capture_loop(
                    app_handle,
                    db,
                    direction,
                    capture_enabled,
                    ocr_engine_clone,
                    silent_mode,
                ).await;
            });

            let app_handle = app.handle().clone();
            app.listen_global("shortcut", move |event| {
                if let Some(shortcut) = event.payload() {
                    match shortcut {
                        "Ctrl+H" => {
                            let app_clone = app_handle.clone();
                            tauri::async_runtime::spawn(async move {
                                show_history_window_command(app_clone).await;
                            });
                        }
                        "Ctrl+Shift+T" => {
                            let app_clone = app_handle.clone();
                            tauri::async_runtime::spawn(async move {
                                trigger_translate_command(app_clone).await;
                            });
                        }
                        _ => {}
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

async fn show_history_window_command(app: tauri::AppHandle) {
    let window_label = "history";
    
    if let Some(window) = app.get_webview_window(window_label) {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("history:refresh", ());
        return;
    }
    
    if let Ok(window) = tauri::WebviewWindowBuilder::new(
        &app,
        window_label,
        WebviewUrl::App("/history.html".into()),
    )
    .title("翻译历史")
    .inner_size(700.0, 600.0)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(true)
    .minimizable(false)
    .maximizable(false)
    .build() {
        let _ = window.show();
    }
}

async fn trigger_translate_command(app: tauri::AppHandle) {
    let window_label = "manual-input";
    
    if let Some(window) = app.get_webview_window(window_label) {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    
    if let Ok(window) = tauri::WebviewWindowBuilder::new(
        &app,
        window_label,
        WebviewUrl::App("/manual-input.html".into()),
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

#[tauri::command]
pub fn toggle_capture(state: tauri::State<'_, AppState>) -> bool {
    let mut enabled = state.capture_enabled.lock();
    *enabled = !*enabled;
    *enabled
}

#[tauri::command]
pub async fn translate_text(
    text: String,
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<TranslationResult, String> {
    let direction = state.direction.lock().clone();
    let result = hover_translator_lib::translate(&text, &direction)
        .await
        .map_err(|e| e.to_string())?;
    
    let _ = state.db.insert_translation(&result).await;
    
    app.emit("translation:result", &result).map_err(|e| e.to_string())?;
    
    Ok(result)
}

#[tauri::command]
pub async fn get_history(state: tauri::State<'_, AppState>) -> Result<Vec<TranslationResult>, String> {
    state.db.get_history().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_history(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.db.clear_history().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_translation_direction(direction: String, state: tauri::State<'_, AppState>) {
    let mut dir = state.direction.lock();
    *dir = direction;
}

#[tauri::command]
pub fn get_translation_direction(state: tauri::State<'_, AppState>) -> String {
    state.direction.lock().clone()
}

#[tauri::command]
pub fn show_history(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("translate-result") {
        let _ = window.show();
    }
}

#[tauri::command]
pub fn show_history_window(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        show_history_window_command(app).await;
    });
}

#[tauri::command]
pub async fn retry_ocr_init(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<hover_translator_lib::ocr::OcrInitResult, String> {
    let mut engine_guard = state.ocr_engine.lock();
    
    let mut new_engine = match OcrEngine::new().await {
        Ok(engine) => engine,
        Err(e) => {
            let result = hover_translator_lib::ocr::OcrInitResult {
                success: false,
                status: hover_translator_lib::ocr::OcrStatus::Error { message: e.to_string() },
                message: e.to_string(),
            };
            return Ok(result);
        }
    };
    
    let result = new_engine.try_recover().await;
    
    if result.success {
        *engine_guard = Some(new_engine);
        *state.ocr_error.lock() = None;
        let _ = app.emit("ocr:ready", ());
    }
    
    Ok(result)
}

#[tauri::command]
pub fn show_manual_input(
    app: tauri::AppHandle,
    error: Option<String>,
) -> Result<(), String> {
    let window_label = "manual-input";
    
    if let Some(window) = app.get_webview_window(window_label) {
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }
    
    let url = match error {
        Some(err) => {
            let encoded = urlencoding::encode(&err);
            WebviewUrl::App(format!("/manual-input.html?error={}", encoded).into())
        }
        None => WebviewUrl::App("/manual-input.html".into()),
    };
    
    let _window = tauri::WebviewWindowBuilder::new(
        &app,
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
    .build()
    .map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
pub fn get_ocr_status(state: tauri::State<'_, AppState>) -> (bool, Option<String>) {
    let engine = state.ocr_engine.lock();
    let error = state.ocr_error.lock();
    
    let is_ready = engine.as_ref().map(|e| e.is_ready()).unwrap_or(false);
    let error_msg = error.clone();
    
    (is_ready, error_msg)
}

#[tauri::command]
pub fn toggle_silent_mode(state: tauri::State<'_, AppState>, app: tauri::AppHandle) -> bool {
    let mut silent = state.silent_mode.lock();
    *silent = !*silent;
    
    if let Some(window) = app.get_webview_window("floating-ball") {
        if *silent {
            let _ = window.hide();
        } else {
            let _ = window.show();
        }
    }
    
    *silent
}

#[tauri::command]
pub fn get_silent_mode(state: tauri::State<'_, AppState>) -> bool {
    *state.silent_mode.lock()
}

#[tauri::command]
pub fn trigger_translate(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        trigger_translate_command(app).await;
    });
}

fn main() {
    run();
}
