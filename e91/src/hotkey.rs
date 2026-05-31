use std::sync::Arc;
use parking_lot::Mutex;
use tauri::AppHandle;

#[cfg(windows)]
use winapi::{
    shared::minwindef::{ATOM, DWORD, LPARAM, LRESULT, UINT, WPARAM},
    um::{
        libloaderapi::GetModuleHandleW,
        winuser::{
            CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW,
            RegisterHotKey, RegisterClassW, TranslateMessage, UnregisterHotKey,
            MSG, WM_HOTKEY, WNDCLASSW,
        },
    },
};

#[cfg(windows)]
const MOD_CONTROL: UINT = 0x0002;
#[cfg(windows)]
const MOD_SHIFT: UINT = 0x0004;
#[cfg(windows)]
const KEY_H: UINT = 0x48;
#[cfg(windows)]
const KEY_T: UINT = 0x54;
#[cfg(windows)]
const ID_HOTKEY_HISTORY: i32 = 1;
#[cfg(windows)]
const ID_HOTKEY_TRANSLATE: i32 = 2;

#[cfg(windows)]
pub fn register_hotkeys() {
    std::thread::spawn(|| {
        unsafe {
            let h_instance = GetModuleHandleW(std::ptr::null());
            
            let class_name: Vec<u16> = "GlobalHotkeyWindow".encode_utf16().collect();
            let mut wnd_class = WNDCLASSW {
                style: 0,
                lpfnWndProc: Some(window_proc),
                cbClsExtra: 0,
                cbWndExtra: 0,
                hInstance: h_instance,
                hIcon: std::ptr::null_mut(),
                hCursor: std::ptr::null_mut(),
                hbrBackground: std::ptr::null_mut(),
                lpszMenuName: std::ptr::null(),
                lpszClassName: class_name.as_ptr(),
            };
            
            RegisterClassW(&wnd_class);
            
            let hwnd = CreateWindowExW(
                0,
                class_name.as_ptr(),
                class_name.as_ptr(),
                0,
                0, 0, 0, 0,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                h_instance,
                std::ptr::null_mut(),
            );
            
            RegisterHotKey(hwnd, ID_HOTKEY_HISTORY, MOD_CONTROL, KEY_H);
            RegisterHotKey(hwnd, ID_HOTKEY_TRANSLATE, MOD_CONTROL | MOD_SHIFT, KEY_T);
            
            let mut msg: MSG = std::mem::zeroed();
            while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            
            UnregisterHotKey(hwnd, ID_HOTKEY_HISTORY);
            UnregisterHotKey(hwnd, ID_HOTKEY_TRANSLATE);
        }
    });
}

#[cfg(windows)]
unsafe extern "system" fn window_proc(
    hwnd: winapi::shared::windef::HWND,
    msg: UINT,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if msg == WM_HOTKEY {
        let app_handle = APP_HANDLE.lock();
        if let Some(app) = app_handle.as_ref() {
            match wparam as i32 {
                ID_HOTKEY_HISTORY => {
                    let _ = app.emit("shortcut", "Ctrl+H");
                }
                ID_HOTKEY_TRANSLATE => {
                    let _ = app.emit("shortcut", "Ctrl+Shift+T");
                }
                _ => {}
            }
        }
        return 0;
    }
    DefWindowProcW(hwnd, msg, wparam, lparam)
}

#[cfg(windows)]
static APP_HANDLE: parking_lot::Mutex<Option<AppHandle>> = parking_lot::Mutex::new(None);

#[cfg(windows)]
pub fn set_app_handle(handle: AppHandle) {
    *APP_HANDLE.lock() = Some(handle);
}

#[cfg(not(windows))]
pub fn register_hotkeys() {}

#[cfg(not(windows))]
pub fn set_app_handle(_handle: AppHandle) {}
