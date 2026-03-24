use std::sync::{
    atomic::{AtomicBool, AtomicI32, AtomicU64, Ordering},
    Mutex, OnceLock,
};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Manager};

// ── Shared state ──────────────────────────────────────────────────────────────

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

static SCREEN_W: AtomicI32 = AtomicI32::new(1920);
static SCREEN_H: AtomicI32 = AtomicI32::new(1080);

/// Hitbox of the visible action bar (i32::MIN = none).
static AB_X: AtomicI32 = AtomicI32::new(i32::MIN);
static AB_Y: AtomicI32 = AtomicI32::new(0);
static AB_W: AtomicI32 = AtomicI32::new(0);
static AB_H: AtomicI32 = AtomicI32::new(0);

/// Mouse-hook: last LBUTTONDOWN position and double-click state.
static MOUSE_DOWN_X: AtomicI32 = AtomicI32::new(0);
static MOUSE_DOWN_Y: AtomicI32 = AtomicI32::new(0);
static LAST_DOWN_X: AtomicI32 = AtomicI32::new(0);
static LAST_DOWN_Y: AtomicI32 = AtomicI32::new(0);
static LAST_DOWN_MS: AtomicU64 = AtomicU64::new(0);
static DBL_PENDING: AtomicBool = AtomicBool::new(false);

/// Pending selection for poll_selection (i32::MIN = nothing pending).
/// Written: Y first, then X. Read: swap X back to MIN to atomically claim it.
static POLL_X: AtomicI32 = AtomicI32::new(i32::MIN);
static POLL_Y: AtomicI32 = AtomicI32::new(0);

static LAST_EMIT_MS: AtomicU64 = AtomicU64::new(0);

/// Pre-captured text from the most recent text-selection event.
/// Written by fire_selection after Win32 Ctrl+C capture.
/// Read+cleared by get_captured_text when overlay action button is clicked.
static CAPTURED_TEXT: Mutex<Option<String>> = Mutex::new(None);

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Frontend polls this every ~200 ms as a reliable fallback for the event system.
/// Returns [x, y, screenW, screenH] in physical pixels, or null if no pending selection.
#[tauri::command]
pub fn poll_selection() -> Option<[i32; 4]> {
    let x = POLL_X.swap(i32::MIN, Ordering::AcqRel);
    if x == i32::MIN {
        return None;
    }
    let y = POLL_Y.load(Ordering::Relaxed);
    let sw = SCREEN_W.load(Ordering::Relaxed);
    let sh = SCREEN_H.load(Ordering::Relaxed);
    Some([x, y, sw, sh])
}

/// Returns and clears the pre-captured text from the last text-selection event.
/// Call this from the overlay when a Vorlesen / Übersetzen button is clicked.
/// Returns None if the selection has expired or was never captured.
#[tauri::command]
pub fn get_captured_text() -> Option<String> {
    CAPTURED_TEXT.lock().ok()?.take()
}

#[tauri::command]
pub fn set_action_bar_rect(x: i32, y: i32, w: i32, h: i32) {
    AB_X.store(x, Ordering::Relaxed);
    AB_Y.store(y, Ordering::Relaxed);
    AB_W.store(w, Ordering::Relaxed);
    AB_H.store(h, Ordering::Relaxed);
}

#[tauri::command]
pub fn clear_action_bar_rect() {
    AB_X.store(i32::MIN, Ordering::Relaxed);
}

#[tauri::command]
pub fn show_main_window(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
    }
}

// ── Entry point ───────────────────────────────────────────────────────────────

pub fn setup(app: &AppHandle) {
    APP_HANDLE.get_or_init(|| app.clone());
    #[cfg(target_os = "windows")]
    setup_windows(app);
}

// ── Windows ───────────────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn setup_windows(app: &AppHandle) {
    use tauri::{PhysicalPosition, PhysicalSize};

    if let Some(overlay) = app.get_webview_window("overlay") {
        if let Ok(Some(monitor)) = app.primary_monitor() {
            let pos = monitor.position();
            let size = monitor.size();
            SCREEN_W.store(size.width as i32, Ordering::Relaxed);
            SCREEN_H.store(size.height as i32, Ordering::Relaxed);
            let _ = overlay.set_position(PhysicalPosition::new(pos.x, pos.y));
            let _ = overlay.set_size(PhysicalSize::new(size.width, size.height));
        }
        apply_noactivate(&overlay);
        let _ = overlay.set_ignore_cursor_events(true);
        let _ = overlay.show();
        eprintln!(
            "[overlay] window shown, size={}x{}",
            SCREEN_W.load(Ordering::Relaxed),
            SCREEN_H.load(Ordering::Relaxed)
        );
    } else {
        eprintln!("[overlay] ERROR: could not get overlay window");
    }

    let app1 = app.clone();
    thread::spawn(move || proximity_loop(app1));
    thread::spawn(mouse_hook_thread);
    eprintln!("[overlay] threads spawned");
}

#[cfg(target_os = "windows")]
fn apply_noactivate(window: &tauri::WebviewWindow) {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE,
    };
    let Ok(handle) = window.window_handle() else { return };
    let RawWindowHandle::Win32(h) = handle.as_raw() else { return };
    let hwnd = HWND(h.hwnd.get() as *mut core::ffi::c_void);
    unsafe {
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex | WS_EX_NOACTIVATE.0 as isize);
    }
}

#[cfg(target_os = "windows")]
fn proximity_loop(app: AppHandle) {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    loop {
        thread::sleep(Duration::from_millis(50));
        let Some(overlay) = app.get_webview_window("overlay") else {
            continue;
        };
        let sw = SCREEN_W.load(Ordering::Relaxed);
        let sh = SCREEN_H.load(Ordering::Relaxed);
        let mut pt = POINT::default();
        if unsafe { GetCursorPos(&mut pt) }.is_err() {
            continue;
        }

        let in_orb = pt.x > sw - 300 && pt.y > sh - 140;
        let (ax, ay, aw, ah) = (
            AB_X.load(Ordering::Relaxed),
            AB_Y.load(Ordering::Relaxed),
            AB_W.load(Ordering::Relaxed),
            AB_H.load(Ordering::Relaxed),
        );
        let in_ab = ax != i32::MIN && {
            let p = 30i32;
            pt.x >= ax - p && pt.x <= ax + aw + p && pt.y >= ay - p && pt.y <= ay + ah + p
        };
        let _ = overlay.set_ignore_cursor_events(!(in_orb || in_ab));
    }
}

// ── Win32 clipboard helpers ───────────────────────────────────────────────────
//
// These use Win32 directly (no PowerShell) so they are fast enough to run
// inline in the mouse-hook thread without triggering the low-level hook timeout.

#[cfg(target_os = "windows")]
unsafe fn clipboard_read_unicode() -> Option<String> {
    use windows::Win32::Foundation::{HGLOBAL, HWND};
    use windows::Win32::System::DataExchange::{CloseClipboard, GetClipboardData, OpenClipboard};
    use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};
    const CF_UNICODETEXT: u32 = 13;

    if OpenClipboard(HWND::default()).is_err() {
        return None;
    }
    let result = (|| -> Option<String> {
        let h = GetClipboardData(CF_UNICODETEXT).ok()?;
        // h.0 is *mut c_void (Copy). HGLOBAL has no Drop, so temporaries are safe.
        let ptr = GlobalLock(HGLOBAL(h.0)) as *const u16;
        if ptr.is_null() {
            return None;
        }
        let char_count = GlobalSize(HGLOBAL(h.0)) / 2;
        let slice = std::slice::from_raw_parts(ptr, char_count);
        let end = slice.iter().position(|&c| c == 0).unwrap_or(slice.len());
        let text = String::from_utf16_lossy(&slice[..end]);
        let _ = GlobalUnlock(HGLOBAL(h.0));
        if text.trim().is_empty() { None } else { Some(text) }
    })();
    let _ = CloseClipboard();
    result
}

#[cfg(target_os = "windows")]
unsafe fn clipboard_write_unicode(text: &str) {
    use windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL, HWND};
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
    };
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
    const CF_UNICODETEXT: u32 = 13;

    let utf16: Vec<u16> = text.encode_utf16().chain(std::iter::once(0u16)).collect();
    let byte_size = utf16.len() * 2;
    // hmem.0 is *mut c_void (Copy); HGLOBAL has no Drop so HGLOBAL(hmem.0) temporaries are safe.
    let hmem = match GlobalAlloc(GMEM_MOVEABLE, byte_size) {
        Ok(h) => h,
        Err(_) => return,
    };
    let ptr = GlobalLock(HGLOBAL(hmem.0)) as *mut u16;
    if ptr.is_null() {
        let _ = GlobalFree(HGLOBAL(hmem.0));
        return;
    }
    std::ptr::copy_nonoverlapping(utf16.as_ptr(), ptr, utf16.len());
    let _ = GlobalUnlock(HGLOBAL(hmem.0));

    if OpenClipboard(HWND::default()).is_ok() {
        let _ = EmptyClipboard();
        if SetClipboardData(CF_UNICODETEXT, HANDLE(hmem.0)).is_err() {
            let _ = GlobalFree(HGLOBAL(hmem.0));
        }
        // On success Windows owns the memory; do NOT free hmem.
        let _ = CloseClipboard();
    } else {
        let _ = GlobalFree(HGLOBAL(hmem.0));
    }
}

#[cfg(target_os = "windows")]
unsafe fn clipboard_clear() {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard};
    if OpenClipboard(HWND::default()).is_ok() {
        let _ = EmptyClipboard();
        let _ = CloseClipboard();
    }
}

/// Send Ctrl+C to the currently focused window via SendInput (Win32, no PowerShell).
#[cfg(target_os = "windows")]
unsafe fn send_ctrl_c() {
    use std::mem::size_of;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
        SendInput, VIRTUAL_KEY, VK_CONTROL,
    };
    const VK_C: VIRTUAL_KEY = VIRTUAL_KEY(0x43u16);
    let no_flags = KEYBD_EVENT_FLAGS(0);
    let inputs = [
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VK_CONTROL, wScan: 0, dwFlags: no_flags, time: 0, dwExtraInfo: 0 } },
        },
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VK_C, wScan: 0, dwFlags: no_flags, time: 0, dwExtraInfo: 0 } },
        },
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VK_C, wScan: 0, dwFlags: KEYEVENTF_KEYUP, time: 0, dwExtraInfo: 0 } },
        },
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VK_CONTROL, wScan: 0, dwFlags: KEYEVENTF_KEYUP, time: 0, dwExtraInfo: 0 } },
        },
    ];
    SendInput(&inputs, size_of::<INPUT>() as i32);
}

// ── Mouse hook ────────────────────────────────────────────────────────────────

const WM_LBUTTONDOWN: u32 = 0x0201;
const WM_LBUTTONUP: u32 = 0x0202;

fn ms_now() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Check if text is currently selected by sending Ctrl+C via Win32 and reading
/// the clipboard. Saves and restores the previous clipboard content.
/// Returns None if no text is selected (e.g. the drag was a window resize).
#[cfg(target_os = "windows")]
fn try_capture_selected_text() -> Option<String> {
    unsafe {
        let prev = clipboard_read_unicode();
        clipboard_clear();
        send_ctrl_c();
        thread::sleep(Duration::from_millis(120));
        let captured = clipboard_read_unicode();
        // Restore previous clipboard state
        match prev {
            Some(ref t) => clipboard_write_unicode(t),
            None => clipboard_clear(),
        }
        captured
    }
}

/// Store coords for polling AND emit Tauri event.
/// Only fires if actual text is selected (confirmed via Win32 Ctrl+C check).
/// Called from background thread 80 ms after mouse-up.
fn fire_selection(x: i32, y: i32) {
    let sw = SCREEN_W.load(Ordering::Relaxed);
    let sh = SCREEN_H.load(Ordering::Relaxed);

    // Skip orb zone
    if x > sw - 300 && y > sh - 140 {
        return;
    }

    // Debounce 400 ms
    let now = ms_now();
    if now.saturating_sub(LAST_EMIT_MS.load(Ordering::Relaxed)) < 400 {
        return;
    }

    // Verify actual text is selected via Win32 clipboard check
    #[cfg(target_os = "windows")]
    let text = match try_capture_selected_text() {
        Some(t) => t,
        None => {
            eprintln!("[overlay] drag/dbl-click at ({x},{y}) – no text selected, skipping");
            return;
        }
    };
    #[cfg(not(target_os = "windows"))]
    let text = String::new();

    LAST_EMIT_MS.store(now, Ordering::Relaxed);

    let preview = &text[..text.len().min(60)];
    eprintln!(
        "[overlay] text selection at ({x},{y}), screen {sw}x{sh}, len={}, preview={preview:?}",
        text.len()
    );

    // Store text so overlay can use it without a second Ctrl+C
    if let Ok(mut guard) = CAPTURED_TEXT.lock() {
        *guard = Some(text);
    }

    // Store for poll_selection fallback
    POLL_Y.store(y, Ordering::Relaxed);
    POLL_X.store(x, Ordering::Release);

    // Emit Tauri event (broadcast to all webviews)
    if let Some(app) = APP_HANDLE.get() {
        use tauri::Emitter;
        #[derive(serde::Serialize, Clone)]
        struct Payload {
            x: i32,
            y: i32,
            screen_w: i32,
            screen_h: i32,
        }
        let _ = app.emit("text-selected", Payload { x, y, screen_w: sw, screen_h: sh });
        eprintln!("[overlay] event emitted");
    }
}

#[cfg(target_os = "windows")]
fn mouse_hook_thread() {
    use windows::Win32::Foundation::{HMODULE, HWND};
    use windows::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, GetMessageW, SetWindowsHookExW, MSG, WH_MOUSE_LL,
    };
    unsafe {
        match SetWindowsHookExW(WH_MOUSE_LL, Some(ll_mouse_proc), HMODULE::default(), 0) {
            Ok(_hook) => eprintln!("[overlay] WH_MOUSE_LL hook installed"),
            Err(e) => eprintln!("[overlay] WH_MOUSE_LL hook FAILED: {:?}", e),
        }
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, HWND::default(), 0, 0).as_bool() {
            DispatchMessageW(&msg);
        }
    }
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn ll_mouse_proc(
    ncode: i32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::UI::WindowsAndMessaging::{CallNextHookEx, HHOOK, MSLLHOOKSTRUCT};

    if ncode >= 0 {
        let data = &*(lparam.0 as *const MSLLHOOKSTRUCT);
        let msg = wparam.0 as u32;
        let x = data.pt.x;
        let y = data.pt.y;

        match msg {
            WM_LBUTTONDOWN => {
                let now = ms_now();
                let prev_ms = LAST_DOWN_MS.swap(now, Ordering::Relaxed);
                let prev_x = LAST_DOWN_X.load(Ordering::Relaxed);
                let prev_y = LAST_DOWN_Y.load(Ordering::Relaxed);
                let dx = x - prev_x;
                let dy = y - prev_y;
                // Double-click: second down within 500 ms at nearly same position
                if now.saturating_sub(prev_ms) < 500 && dx * dx + dy * dy < 16 {
                    DBL_PENDING.store(true, Ordering::Relaxed);
                } else {
                    DBL_PENDING.store(false, Ordering::Relaxed);
                }
                LAST_DOWN_X.store(x, Ordering::Relaxed);
                LAST_DOWN_Y.store(y, Ordering::Relaxed);
                MOUSE_DOWN_X.store(x, Ordering::Relaxed);
                MOUSE_DOWN_Y.store(y, Ordering::Relaxed);
            }
            WM_LBUTTONUP => {
                let is_dbl = DBL_PENDING.swap(false, Ordering::Relaxed);
                let dx = x - MOUSE_DOWN_X.load(Ordering::Relaxed);
                let dy = y - MOUSE_DOWN_Y.load(Ordering::Relaxed);
                let is_drag = dx * dx + dy * dy > 25; // > 5 px
                if is_dbl || is_drag {
                    eprintln!(
                        "[overlay] mouse up: dbl={is_dbl} drag={is_drag} pos=({x},{y}) – checking clipboard"
                    );
                    thread::spawn(move || {
                        // Short delay so the target app can finalize its selection
                        thread::sleep(Duration::from_millis(80));
                        fire_selection(x, y);
                    });
                }
            }
            _ => {}
        }
    }
    CallNextHookEx(HHOOK::default(), ncode, wparam, lparam)
}
