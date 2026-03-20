use serde::Serialize;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

pub const DEFAULT_HOTKEY: &str = "Ctrl+Shift+Space";
pub const HOTKEY_STATUS_EVENT: &str = "hotkey-status";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyStatusPayload {
    pub registered: bool,
    pub accelerator: &'static str,
    pub platform: &'static str,
    pub state: &'static str,
    pub message: String,
    pub last_captured_text: Option<String>,
    pub last_audio_path: Option<String>,
    pub last_audio_output_directory: Option<String>,
    pub last_audio_chunk_count: Option<usize>,
}

#[derive(Default)]
struct HotkeySnapshot {
    registered: bool,
    state: &'static str,
    message: String,
    last_captured_text: Option<String>,
    last_audio_path: Option<String>,
    last_audio_output_directory: Option<String>,
    last_audio_chunk_count: Option<usize>,
}

pub struct HotkeyState {
    snapshot: Mutex<HotkeySnapshot>,
    is_running: AtomicBool,
}

impl Default for HotkeyState {
    fn default() -> Self {
        Self {
            snapshot: Mutex::new(HotkeySnapshot {
                registered: false,
                state: "idle",
                message: format!(
                    "Global hotkey {DEFAULT_HOTKEY} is not registered yet."
                ),
                last_captured_text: None,
                last_audio_path: None,
                last_audio_output_directory: None,
                last_audio_chunk_count: None,
            }),
            is_running: AtomicBool::new(false),
        }
    }
}

impl HotkeyState {
    fn payload(&self) -> HotkeyStatusPayload {
        let snapshot = self.snapshot.lock().expect("hotkey snapshot poisoned");
        HotkeyStatusPayload {
            registered: snapshot.registered,
            accelerator: DEFAULT_HOTKEY,
            platform: if cfg!(target_os = "windows") {
                "windows"
            } else {
                "unsupported"
            },
            state: snapshot.state,
            message: snapshot.message.clone(),
            last_captured_text: snapshot.last_captured_text.clone(),
            last_audio_path: snapshot.last_audio_path.clone(),
            last_audio_output_directory: snapshot.last_audio_output_directory.clone(),
            last_audio_chunk_count: snapshot.last_audio_chunk_count,
        }
    }

    fn update<F>(&self, app: &AppHandle, updater: F)
    where
        F: FnOnce(&mut HotkeySnapshot),
    {
        {
            let mut snapshot = self.snapshot.lock().expect("hotkey snapshot poisoned");
            updater(&mut snapshot);
        }

        let _ = app.emit(HOTKEY_STATUS_EVENT, self.payload());
    }
}

#[tauri::command]
pub fn get_hotkey_status(state: State<'_, HotkeyState>) -> HotkeyStatusPayload {
    state.payload()
}

#[cfg(target_os = "windows")]
pub fn init_hotkey(app: &AppHandle) {
    windows_impl::init_hotkey(app);
}

#[cfg(not(target_os = "windows"))]
pub fn init_hotkey(app: &AppHandle) {
    let state = app.state::<HotkeyState>();
    state.update(app, |snapshot| {
        snapshot.registered = false;
        snapshot.state = "unsupported";
        snapshot.message =
            "Global hotkey MVP is currently implemented for the packaged Windows app only."
                .to_string();
    });
}

#[cfg(target_os = "windows")]
mod windows_impl {
    use super::{HotkeyState, DEFAULT_HOTKEY};
    use crate::{selection_capture::CaptureOptions, tts::SpeakTextOptions};
    use std::{mem::MaybeUninit, thread, time::Duration};
    use tauri::{AppHandle, Manager};
    use windows::Win32::{
        Foundation::HWND,
        UI::{
            Input::KeyboardAndMouse::{
                RegisterHotKey, UnregisterHotKey, MOD_CONTROL, MOD_NOREPEAT, MOD_SHIFT,
                VK_SPACE,
            },
            WindowsAndMessaging::{GetMessageW, MSG, WM_HOTKEY},
        },
    };

    const HOTKEY_ID: i32 = 0x564f41;

    pub fn init_hotkey(app: &AppHandle) {
        let app_handle = app.clone();
        let state = app_handle.state::<HotkeyState>();
        let state: tauri::State<'_, HotkeyState> = state;
        state.update(&app_handle, |snapshot| {
            snapshot.state = "registering";
            snapshot.message = format!("Registering global hotkey {DEFAULT_HOTKEY} …");
        });

        thread::spawn(move || unsafe {
            let modifiers = MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT;

            match RegisterHotKey(HWND(std::ptr::null_mut()), HOTKEY_ID, modifiers, VK_SPACE.0 as u32) {
                Ok(_) => {
                    let state = app_handle.state::<HotkeyState>();
                    state.update(&app_handle, |snapshot| {
                        snapshot.registered = true;
                        snapshot.state = "idle";
                        snapshot.message = format!(
                            "Global hotkey {DEFAULT_HOTKEY} is ready. Mark text in any Windows app and press it there."
                        );
                    });
                }
                Err(error) => {
                    let state = app_handle.state::<HotkeyState>();
                    state.update(&app_handle, |snapshot| {
                        snapshot.registered = false;
                        snapshot.state = "error";
                        snapshot.message = format!(
                            "Could not register global hotkey {DEFAULT_HOTKEY}: {error}. Another app may already be using it."
                        );
                    });
                    return;
                }
            }

            let mut message = MaybeUninit::<MSG>::zeroed();
            loop {
                let result = GetMessageW(message.as_mut_ptr(), HWND(std::ptr::null_mut()), 0, 0).0;
                if result == -1 || result == 0 {
                    break;
                }

                let msg = message.assume_init();
                if msg.message == WM_HOTKEY && msg.wParam.0 as i32 == HOTKEY_ID {
                    trigger_capture_and_speak(&app_handle);
                    thread::sleep(Duration::from_millis(50));
                }
            }

            let _ = UnregisterHotKey(HWND(std::ptr::null_mut()), HOTKEY_ID);
        });
    }

    fn trigger_capture_and_speak(app: &AppHandle) {
        let state = app.state::<HotkeyState>();
        if state.is_running.swap(true, std::sync::atomic::Ordering::SeqCst) {
            state.update(app, |snapshot| {
                snapshot.state = "working";
                snapshot.message =
                    "Hotkey pressed again while audio generation is still running. Ignoring the extra press."
                        .to_string();
            });
            return;
        }

        state.update(app, |snapshot| {
            snapshot.state = "working";
            snapshot.message =
                "Hotkey received. Copying the current selection and starting the chunked OpenAI TTS pipeline …"
                    .to_string();
        });

        let app_handle = app.clone();
        thread::spawn(move || {
            let result = crate::capture_and_speak_command(
                Some(CaptureOptions {
                    copy_delay_ms: Some(140),
                    restore_clipboard: Some(true),
                }),
                Some(SpeakTextOptions {
                    text: None,
                    voice: Some("alloy".to_string()),
                    model: None,
                    format: Some("mp3".to_string()),
                    autoplay: Some(true),
                    max_chunk_chars: None,
                    max_parallel_requests: Some(3),
                }),
            );

            let state = app_handle.state::<HotkeyState>();
            match result {
                Ok(result) => state.update(&app_handle, |snapshot| {
                    snapshot.state = "success";
                    let chunk_label = if result.speech.chunk_count == 1 {
                        "1 audio chunk".to_string()
                    } else {
                        format!("{} audio chunks", result.speech.chunk_count)
                    };
                    let summary = format!(
                        "Hotkey run finished. Captured {} characters, generated {}, and started playback as soon as chunk 1 was ready.",
                        result.captured_text.chars().count(),
                        chunk_label
                    );
                    snapshot.message = match result.note {
                        Some(note) if !note.trim().is_empty() => format!("{summary} {note}"),
                        _ => summary,
                    };
                    snapshot.last_captured_text = Some(result.captured_text);
                    snapshot.last_audio_path = Some(result.speech.file_path);
                    snapshot.last_audio_output_directory =
                        Some(result.speech.output_directory);
                    snapshot.last_audio_chunk_count = Some(result.speech.chunk_count);
                }),
                Err(error) => state.update(&app_handle, |snapshot| {
                    snapshot.state = "error";
                    snapshot.message = error;
                }),
            }

            state
                .is_running
                .store(false, std::sync::atomic::Ordering::SeqCst);
        });
    }
}
