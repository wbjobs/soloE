use anyhow::Result;
use parking_lot::Mutex;
use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

pub fn setup_tray(
    app: &AppHandle,
    direction: Arc<Mutex<String>>,
    capture_enabled: Arc<Mutex<bool>>,
    silent_mode: Arc<Mutex<bool>>,
) -> Result<()> {
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let toggle_capture = MenuItem::with_id(app, "toggle_capture", "开启/关闭捕获", true, None::<&str>)?;
    let toggle_silent = MenuItem::with_id(app, "toggle_silent", "静默模式", true, None::<&str>)?;
    let manual_input = MenuItem::with_id(app, "manual_input", "手动输入文本", true, None::<&str>)?;
    let show_history = MenuItem::with_id(app, "show_history", "翻译历史 (Ctrl+H)", true, None::<&str>)?;
    let trigger_translate = MenuItem::with_id(app, "trigger_translate", "快捷翻译 (Ctrl+Shift+T)", true, None::<&str>)?;
    let zh_to_en = MenuItem::with_id(app, "zh_en", "中 → 英", true, None::<&str>)?;
    let en_to_zh = MenuItem::with_id(app, "en_zh", "英 → 中", true, None::<&str>)?;
    
    let menu = Menu::with_items(app, &[
        &toggle_capture,
        &toggle_silent,
        &manual_input,
        &show_history,
        &trigger_translate,
        &zh_to_en,
        &en_to_zh,
        &quit,
    ])?;
    
    let _tray = TrayIconBuilder::with_id("main-tray")
        .tooltip("悬浮翻译球")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "quit" => {
                app.exit(0);
            }
            "toggle_capture" => {
                let mut enabled = capture_enabled.lock();
                *enabled = !*enabled;
            }
            "toggle_silent" => {
                let mut silent = silent_mode.lock();
                *silent = !*silent;
                if *silent {
                    if let Some(window) = app.get_webview_window("floating-ball") {
                        let _ = window.hide();
                    }
                } else {
                    if let Some(window) = app.get_webview_window("floating-ball") {
                        let _ = window.show();
                    }
                }
            }
            "manual_input" => {
                let _ = app.emit("manual_input_request", ());
                let window_label = "manual-input";
                if app.get_webview_window(window_label).is_none() {
                    let url = tauri::WebviewUrl::App("/manual-input.html".into());
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
                } else if let Some(window) = app.get_webview_window(window_label) {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "show_history" => {
                let window_label = "history";
                if app.get_webview_window(window_label).is_none() {
                    let url = tauri::WebviewUrl::App("/history.html".into());
                    if let Ok(window) = tauri::WebviewWindowBuilder::new(
                        app,
                        window_label,
                        url,
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
                } else if let Some(window) = app.get_webview_window(window_label) {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.emit("history:refresh", ());
                }
            }
            "trigger_translate" => {
                let _ = app.emit("shortcut", "Ctrl+Shift+T");
            }
            "zh_en" => {
                let mut dir = direction.lock();
                *dir = "zh-en".to_string();
                let _ = app.emit("translation:direction", "zh-en");
            }
            "en_zh" => {
                let mut dir = direction.lock();
                *dir = "en-zh".to_string();
                let _ = app.emit("translation:direction", "en-zh");
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("floating-ball") {
                    let _ = window.show();
                }
            }
        })
        .build(app)?;
    
    Ok(())
}
