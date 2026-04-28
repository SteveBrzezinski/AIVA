use crate::hotkey::{set_error, set_success, update_working};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictationInsertRequest {
    pub text: String,
    pub mode: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictationStatusRequest {
    pub mode: String,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictationInsertResult {
    pub text: String,
    pub mode: String,
    pub pasted: bool,
}

#[tauri::command]
pub fn report_dictation_transcribing_command(
    request: DictationStatusRequest,
    app: AppHandle,
) -> Result<(), String> {
    let mode = sanitize_mode(&request.mode);
    let action = action_for_mode(mode);
    update_working(
        &app,
        action,
        request
            .detail
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "Dictation recording finished. Transcribing...".to_string()),
    );
    Ok(())
}

#[tauri::command]
pub fn report_dictation_error_command(
    request: DictationStatusRequest,
    app: AppHandle,
) -> Result<(), String> {
    let mode = sanitize_mode(&request.mode);
    let action = action_for_mode(mode);
    set_error(
        &app,
        action,
        request
            .detail
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "Dictation failed.".to_string()),
        None,
        None,
        None,
    );
    Ok(())
}

#[tauri::command]
pub fn insert_dictation_text_command(
    request: DictationInsertRequest,
    app: AppHandle,
) -> Result<DictationInsertResult, String> {
    let text = request.text.trim().to_string();
    let mode = sanitize_mode(&request.mode);
    let action = action_for_mode(mode);

    if text.is_empty() {
        let message = "Dictation produced no text.".to_string();
        set_error(&app, action, message.clone(), None, None, None);
        return Err(message);
    }

    update_working(
        &app,
        action,
        if mode == "clipboard" {
            "Dictation transcribed. Copying text to clipboard...".to_string()
        } else {
            "Dictation transcribed. Pasting text into the active app...".to_string()
        },
    );

    platform::set_clipboard_text(&text).map_err(|error| {
        set_error(&app, action, error.clone(), Some(text.clone()), None, None);
        error
    })?;

    let pasted = mode == "paste";
    if pasted {
        platform::paste_clipboard().map_err(|error| {
            set_error(&app, action, error.clone(), Some(text.clone()), None, None);
            error
        })?;
    }

    set_success(
        &app,
        action,
        if pasted {
            format!("Dictation pasted {} character(s).", text.chars().count())
        } else {
            format!("Dictation copied {} character(s) to the clipboard.", text.chars().count())
        },
        Some(text.clone()),
    );

    Ok(DictationInsertResult { text, mode: mode.to_string(), pasted })
}

fn sanitize_mode(mode: &str) -> &'static str {
    if mode.trim().eq_ignore_ascii_case("clipboard") {
        "clipboard"
    } else {
        "paste"
    }
}

fn action_for_mode(mode: &str) -> &'static str {
    if mode == "clipboard" {
        "dictation-clipboard"
    } else {
        "dictation-paste"
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use std::{mem::size_of, ptr, thread, time::Duration};
    use windows::Win32::{
        Foundation::{GlobalFree, HANDLE, HWND},
        System::{
            DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData},
            Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE},
        },
        UI::Input::KeyboardAndMouse::{
            keybd_event, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VK_CONTROL, VK_V,
        },
    };

    const CF_UNICODETEXT_FORMAT: u32 = 13;

    pub fn set_clipboard_text(text: &str) -> Result<(), String> {
        let mut wide: Vec<u16> = text.encode_utf16().collect();
        wide.push(0);
        let byte_len = wide.len() * size_of::<u16>();

        unsafe {
            let handle = GlobalAlloc(GMEM_MOVEABLE, byte_len)
                .map_err(|error| format!("Failed to allocate clipboard memory: {error}"))?;
            let locked = GlobalLock(handle);
            if locked.is_null() {
                let _ = GlobalFree(handle);
                return Err("Failed to lock clipboard memory.".to_string());
            }

            ptr::copy_nonoverlapping(wide.as_ptr(), locked.cast::<u16>(), wide.len());
            let _ = GlobalUnlock(handle);

            OpenClipboard(HWND(std::ptr::null_mut()))
                .map_err(|error| format!("Failed to open Windows clipboard: {error}"))?;

            let mut ownership_transferred = false;
            let result = (|| {
                EmptyClipboard()
                    .map_err(|error| format!("Failed to clear Windows clipboard: {error}"))?;
                SetClipboardData(CF_UNICODETEXT_FORMAT, HANDLE(handle.0)).map_err(|error| {
                    format!("Failed to write dictation text to Windows clipboard: {error}")
                })?;
                ownership_transferred = true;
                Ok(())
            })();

            let _ = CloseClipboard();
            if !ownership_transferred {
                let _ = GlobalFree(handle);
            }

            result
        }
    }

    pub fn paste_clipboard() -> Result<(), String> {
        unsafe {
            keybd_event(VK_CONTROL.0 as u8, 0, KEYBD_EVENT_FLAGS(0), 0);
            keybd_event(VK_V.0 as u8, 0, KEYBD_EVENT_FLAGS(0), 0);
            thread::sleep(Duration::from_millis(20));
            keybd_event(VK_V.0 as u8, 0, KEYEVENTF_KEYUP, 0);
            keybd_event(VK_CONTROL.0 as u8, 0, KEYEVENTF_KEYUP, 0);
        }
        Ok(())
    }
}

#[cfg(not(target_os = "windows"))]
mod platform {
    pub fn set_clipboard_text(_text: &str) -> Result<(), String> {
        Err("Dictation clipboard insertion is currently implemented for Windows only.".to_string())
    }

    pub fn paste_clipboard() -> Result<(), String> {
        Err("Dictation paste insertion is currently implemented for Windows only.".to_string())
    }
}
