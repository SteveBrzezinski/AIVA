use std::sync::{
    atomic::{AtomicBool, AtomicI32, AtomicU64, Ordering},
    Mutex, OnceLock,
};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

// ── Shared state ──────────────────────────────────────────────────────────────

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

static SCREEN_W: AtomicI32 = AtomicI32::new(1920);
static SCREEN_H: AtomicI32 = AtomicI32::new(1080);

/// Hitbox of the visible action bar (i32::MIN = none).
static AB_X: AtomicI32 = AtomicI32::new(i32::MIN);
static AB_Y: AtomicI32 = AtomicI32::new(0);
static AB_W: AtomicI32 = AtomicI32::new(0);
static AB_H: AtomicI32 = AtomicI32::new(0);

/// Whether the orb widget is currently visible (toggled by hotkey).
static ORB_VISIBLE: AtomicBool = AtomicBool::new(false);

/// Mouse-hook: last LBUTTONDOWN position and double-click state.
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
/// Written asynchronously (background thread) after the action bar is shown.
/// Read + cleared by get_captured_text when a button is clicked.
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
/// The overlay calls this when a Vorlesen/Übersetzen button is clicked.
/// Returns None if no text is ready yet or the capture window has passed.
#[tauri::command]
pub fn get_captured_text() -> Option<String> {
    CAPTURED_TEXT.lock().ok()?.take()
}

/// Called by the hotkey thread to show the action bar at the current cursor position.
/// Used for the Ctrl+Shift+A hotkey as a manual trigger for apps where the
/// accessibility hook doesn't fire (e.g. Chrome, Electron, Discord).
pub fn show_action_bar_at_cursor() {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::POINT;
        use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
        let mut pt = POINT::default();
        if unsafe { GetCursorPos(&mut pt) }.is_ok() {
            fire_selection(pt.x, pt.y);
        }
    }
}

/// Called by the frontend to sync orb visibility so proximity_loop can
/// avoid checking the orb zone when the orb is hidden.
#[tauri::command]
pub fn set_orb_visible(visible: bool) {
    ORB_VISIBLE.store(visible, Ordering::Relaxed);
    eprintln!("[overlay] orb visible: {visible}");
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
    thread::spawn(mouse_hook_thread);          // double-click fallback
    thread::spawn(accessibility_hook_thread);  // primary: EVENT_OBJECT_TEXTSELECTIONCHANGED
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
        thread::sleep(Duration::from_millis(80));
        let Some(overlay) = app.get_webview_window("overlay") else {
            continue;
        };
        let sw = SCREEN_W.load(Ordering::Relaxed);
        let sh = SCREEN_H.load(Ordering::Relaxed);
        let mut pt = POINT::default();
        if unsafe { GetCursorPos(&mut pt) }.is_err() {
            continue;
        }

        // Orb zone (bottom-right) – only interactive when orb is visible
        let in_orb = ORB_VISIBLE.load(Ordering::Relaxed)
            && pt.x > sw - 300
            && pt.y > sh - 180;

        // Action bar zone
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

        // Left edge nav strip (first 60px of screen width)
        let in_edge = pt.x < 60;

        let _ = overlay.set_ignore_cursor_events(!(in_orb || in_ab || in_edge));
    }
}

// ── Win32 clipboard helpers (no PowerShell, fast) ────────────────────────────

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

#[cfg(target_os = "windows")]
unsafe fn send_ctrl_c() {
    use std::mem::size_of;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS,
        KEYEVENTF_KEYUP, VIRTUAL_KEY, VK_CONTROL,
    };
    const VK_C: VIRTUAL_KEY = VIRTUAL_KEY(0x43u16);
    let no_flags = KEYBD_EVENT_FLAGS(0);
    let inputs = [
        INPUT { r#type: INPUT_KEYBOARD, Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VK_CONTROL, wScan: 0, dwFlags: no_flags, time: 0, dwExtraInfo: 0 } } },
        INPUT { r#type: INPUT_KEYBOARD, Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VK_C,       wScan: 0, dwFlags: no_flags, time: 0, dwExtraInfo: 0 } } },
        INPUT { r#type: INPUT_KEYBOARD, Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VK_C,       wScan: 0, dwFlags: KEYEVENTF_KEYUP, time: 0, dwExtraInfo: 0 } } },
        INPUT { r#type: INPUT_KEYBOARD, Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VK_CONTROL, wScan: 0, dwFlags: KEYEVENTF_KEYUP, time: 0, dwExtraInfo: 0 } } },
    ];
    SendInput(&inputs, size_of::<INPUT>() as i32);
}

/// Try to capture the currently selected text via Win32 Ctrl+C + clipboard.
/// Saves and restores the previous clipboard content.
/// Returns None if no text is selected.
#[cfg(target_os = "windows")]
fn try_capture_selected_text() -> Option<String> {
    unsafe {
        let prev = clipboard_read_unicode();
        clipboard_clear();
        send_ctrl_c();
        thread::sleep(Duration::from_millis(120));
        let captured = clipboard_read_unicode();
        match prev {
            Some(ref t) => clipboard_write_unicode(t),
            None => clipboard_clear(),
        }
        captured
    }
}

// ── Accessibility event hook (primary text-selection detection) ───────────────
//
// Uses SetWinEventHook(EVENT_OBJECT_TEXTSELECTIONCHANGED) which fires in:
// - Notepad, Word, VS Code, and most native Windows text fields
// - Does NOT fire in Chrome/Electron (use hotkeys for those)
// - Does NOT fire in games / full-screen apps → zero gaming interference

#[cfg(target_os = "windows")]
fn accessibility_hook_thread() {
    use windows::Win32::Foundation::{HMODULE, HWND};
    use windows::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
    use windows::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, GetMessageW, MSG,
        EVENT_OBJECT_TEXTSELECTIONCHANGED, WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS,
    };
    unsafe {
        let hook: HWINEVENTHOOK = SetWinEventHook(
            EVENT_OBJECT_TEXTSELECTIONCHANGED,
            EVENT_OBJECT_TEXTSELECTIONCHANGED,
            HMODULE::default(),
            Some(win_event_proc),
            0, 0,
            WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
        );
        if hook.0.is_null() {
            eprintln!("[overlay] WinEventHook install FAILED");
            return;
        }
        eprintln!("[overlay] WinEventHook installed (EVENT_OBJECT_TEXTSELECTIONCHANGED)");
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, HWND::default(), 0, 0).as_bool() {
            DispatchMessageW(&msg);
        }
    }
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn win_event_proc(
    _hook: windows::Win32::UI::Accessibility::HWINEVENTHOOK,
    event: u32,
    _hwnd: windows::Win32::Foundation::HWND,
    _id_object: i32,
    _id_child: i32,
    _event_thread: u32,
    _event_time: u32,
) {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetCursorPos, EVENT_OBJECT_TEXTSELECTIONCHANGED,
    };
    if event != EVENT_OBJECT_TEXTSELECTIONCHANGED {
        return;
    }
    let mut pt = POINT::default();
    if GetCursorPos(&mut pt).is_err() {
        return;
    }
    let (x, y) = (pt.x, pt.y);
    // Pre-check debounce before spawning to avoid thundering-herd
    let now = ms_now();
    if now.saturating_sub(LAST_EMIT_MS.load(Ordering::Relaxed)) < 400 {
        return;
    }
    eprintln!("[overlay] accessibility: text selection changed at ({x},{y})");
    thread::spawn(move || fire_selection(x, y));
}

// ── Mouse hook (fallback: double-click in apps without accessibility events) ──
//
// Drag detection is intentionally REMOVED to prevent gaming lag.
// The accessibility hook handles drag-to-select in supported apps.
// This hook ONLY detects double-click word-selection as a fallback.

const WM_LBUTTONDOWN: u32 = 0x0201;
const WM_LBUTTONUP: u32 = 0x0202;

fn ms_now() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(target_os = "windows")]
fn mouse_hook_thread() {
    use windows::Win32::Foundation::{HMODULE, HWND};
    use windows::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, GetMessageW, SetWindowsHookExW, MSG, WH_MOUSE_LL,
    };
    unsafe {
        match SetWindowsHookExW(WH_MOUSE_LL, Some(ll_mouse_proc), HMODULE::default(), 0) {
            Ok(_hook) => eprintln!("[overlay] WH_MOUSE_LL hook installed (double-click fallback)"),
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
                if now.saturating_sub(prev_ms) < 500 && dx * dx + dy * dy < 16 {
                    DBL_PENDING.store(true, Ordering::Relaxed);
                } else {
                    DBL_PENDING.store(false, Ordering::Relaxed);
                }
                LAST_DOWN_X.store(x, Ordering::Relaxed);
                LAST_DOWN_Y.store(y, Ordering::Relaxed);
            }
            WM_LBUTTONUP => {
                if DBL_PENDING.swap(false, Ordering::Relaxed) {
                    // Pre-debounce before spawning (prevents thread storms)
                    let now = ms_now();
                    if now.saturating_sub(LAST_EMIT_MS.load(Ordering::Relaxed)) >= 400 {
                        eprintln!("[overlay] double-click at ({x},{y}) – scheduling fire_selection");
                        thread::spawn(move || {
                            thread::sleep(Duration::from_millis(80));
                            fire_selection(x, y);
                        });
                    }
                }
                // Drag detection removed – accessibility hook handles that.
            }
            _ => {}
        }
    }
    CallNextHookEx(HHOOK::default(), ncode, wparam, lparam)
}

// ── fire_selection ─────────────────────────────────────────────────────────────
//
// Shows the action bar immediately, then captures text asynchronously so it
// is ready by the time the user clicks a button (typically > 300 ms later).

fn fire_selection(x: i32, y: i32) {
    let sw = SCREEN_W.load(Ordering::Relaxed);
    let sh = SCREEN_H.load(Ordering::Relaxed);

    // Skip orb zone
    if x > sw - 300 && y > sh - 180 {
        return;
    }

    // Debounce 400 ms
    let now = ms_now();
    if now.saturating_sub(LAST_EMIT_MS.load(Ordering::Relaxed)) < 400 {
        return;
    }
    LAST_EMIT_MS.store(now, Ordering::Relaxed);

    eprintln!("[overlay] fire_selection ({x},{y}), screen {sw}x{sh}");

    // Clear any stale pre-captured text
    if let Ok(mut guard) = CAPTURED_TEXT.lock() {
        *guard = None;
    }

    // Fire event immediately – action bar appears without waiting for text capture
    POLL_Y.store(y, Ordering::Relaxed);
    POLL_X.store(x, Ordering::Release);
    if let Some(app) = APP_HANDLE.get() {
        #[derive(serde::Serialize, Clone)]
        struct Payload { x: i32, y: i32, screen_w: i32, screen_h: i32 }
        let _ = app.emit("text-selected", Payload { x, y, screen_w: sw, screen_h: sh });
        eprintln!("[overlay] text-selected event emitted");
    }

    // Background: capture text via Win32 Ctrl+C so it is ready when user clicks
    // a button (~200–500 ms later in practice).
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(80));
        #[cfg(target_os = "windows")]
        {
            if let Some(text) = try_capture_selected_text() {
                eprintln!("[overlay] pre-captured {} chars", text.len());
                if let Ok(mut guard) = CAPTURED_TEXT.lock() {
                    *guard = Some(text);
                }
            } else {
                eprintln!("[overlay] pre-capture: nothing on clipboard (non-text selection or no selection)");
            }
        }
    });
}
