use crate::settings::{DEFAULT_SPEAK_HOTKEY, DEFAULT_TRANSLATE_HOTKEY};
use serde::Serialize;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

pub const HOTKEY_STATUS_EVENT: &str = "hotkey-status";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyStatusPayload {
    pub registered: bool,
    pub accelerator: &'static str,
    pub translate_accelerator: &'static str,
    pub platform: &'static str,
    pub state: &'static str,
    pub message: String,
    pub last_action: Option<String>,
    pub last_captured_text: Option<String>,
    pub last_audio_path: Option<String>,
    pub last_audio_output_directory: Option<String>,
    pub last_audio_chunk_count: Option<usize>,
    pub last_translation_text: Option<String>,
    pub last_translation_target_language: Option<String>,
}

#[derive(Default)]
struct HotkeySnapshot {
    registered: bool,
    state: &'static str,
    message: String,
    last_action: Option<String>,
    last_captured_text: Option<String>,
    last_audio_path: Option<String>,
    last_audio_output_directory: Option<String>,
    last_audio_chunk_count: Option<usize>,
    last_translation_text: Option<String>,
    last_translation_target_language: Option<String>,
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
                    "Global hotkeys {DEFAULT_SPEAK_HOTKEY} and {DEFAULT_TRANSLATE_HOTKEY} are not registered yet."
                ),
                last_action: None,
                last_captured_text: None,
                last_audio_path: None,
                last_audio_output_directory: None,
                last_audio_chunk_count: None,
                last_translation_text: None,
                last_translation_target_language: None,
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
            accelerator: DEFAULT_SPEAK_HOTKEY,
            translate_accelerator: DEFAULT_TRANSLATE_HOTKEY,
            platform: if cfg!(target_os = "windows") { "windows" } else { "unsupported" },
            state: snapshot.state,
            message: snapshot.message.clone(),
            last_action: snapshot.last_action.clone(),
            last_captured_text: snapshot.last_captured_text.clone(),
            last_audio_path: snapshot.last_audio_path.clone(),
            last_audio_output_directory: snapshot.last_audio_output_directory.clone(),
            last_audio_chunk_count: snapshot.last_audio_chunk_count,
            last_translation_text: snapshot.last_translation_text.clone(),
            last_translation_target_language: snapshot.last_translation_target_language.clone(),
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
    windows_impl::init_hotkeys(app);
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
    use super::{HotkeyState, DEFAULT_SPEAK_HOTKEY, DEFAULT_TRANSLATE_HOTKEY};
    use crate::{
        selection_capture::CaptureOptions,
        settings::SettingsState,
        translation::TranslateTextOptions,
        tts::SpeakTextOptions,
    };
    use std::{mem::MaybeUninit, thread, time::Duration};
    use tauri::{AppHandle, Manager};
    use windows::Win32::{
        Foundation::HWND,
        UI::{
            Input::KeyboardAndMouse::{
                RegisterHotKey, UnregisterHotKey, MOD_CONTROL, MOD_NOREPEAT, MOD_SHIFT, VK_SPACE,
                VK_T,
            },
            WindowsAndMessaging::{GetMessageW, MSG, WM_HOTKEY},
        },
    };

    const SPEAK_HOTKEY_ID: i32 = 0x564f41;
    const TRANSLATE_HOTKEY_ID: i32 = 0x564f54;

    pub fn init_hotkeys(app: &AppHandle) {
        let app_handle = app.clone();
        let state = app_handle.state::<HotkeyState>();
        state.update(&app_handle, |snapshot| {
            snapshot.state = "registering";
            snapshot.message = format!(
                "Registering global hotkeys {DEFAULT_SPEAK_HOTKEY} and {DEFAULT_TRANSLATE_HOTKEY} …"
            );
        });

        thread::spawn(move || unsafe {
            let modifiers = MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT;
            let speak = RegisterHotKey(HWND(std::ptr::null_mut()), SPEAK_HOTKEY_ID, modifiers, VK_SPACE.0 as u32);
            let translate = RegisterHotKey(HWND(std::ptr::null_mut()), TRANSLATE_HOTKEY_ID, modifiers, VK_T.0 as u32);

            if let Err(error) = speak {
                let state = app_handle.state::<HotkeyState>();
                state.update(&app_handle, |snapshot| {
                    snapshot.registered = false;
                    snapshot.state = "error";
                    snapshot.message = format!("Could not register speak hotkey {DEFAULT_SPEAK_HOTKEY}: {error}.");
                });
                return;
            }

            if let Err(error) = translate {
                let _ = UnregisterHotKey(HWND(std::ptr::null_mut()), SPEAK_HOTKEY_ID);
                let state = app_handle.state::<HotkeyState>();
                state.update(&app_handle, |snapshot| {
                    snapshot.registered = false;
                    snapshot.state = "error";
                    snapshot.message = format!("Could not register translate hotkey {DEFAULT_TRANSLATE_HOTKEY}: {error}.");
                });
                return;
            }

            let state = app_handle.state::<HotkeyState>();
            state.update(&app_handle, |snapshot| {
                snapshot.registered = true;
                snapshot.state = "idle";
                snapshot.message = format!(
                    "Global hotkeys ready: {DEFAULT_SPEAK_HOTKEY} speaks, {DEFAULT_TRANSLATE_HOTKEY} translates the current selection."
                );
            });

            let mut message = MaybeUninit::<MSG>::zeroed();
            loop {
                let result = GetMessageW(message.as_mut_ptr(), HWND(std::ptr::null_mut()), 0, 0).0;
                if result == -1 || result == 0 {
                    break;
                }

                let msg = message.assume_init();
                if msg.message == WM_HOTKEY {
                    match msg.wParam.0 as i32 {
                        SPEAK_HOTKEY_ID => trigger_capture_and_speak(&app_handle),
                        TRANSLATE_HOTKEY_ID => trigger_capture_and_translate(&app_handle),
                        _ => {}
                    }
                    thread::sleep(Duration::from_millis(50));
                }
            }

            let _ = UnregisterHotKey(HWND(std::ptr::null_mut()), SPEAK_HOTKEY_ID);
            let _ = UnregisterHotKey(HWND(std::ptr::null_mut()), TRANSLATE_HOTKEY_ID);
        });
    }

    fn begin_run(app: &AppHandle, action: &str, message: String) -> bool {
        let state = app.state::<HotkeyState>();
        if state.is_running.swap(true, std::sync::atomic::Ordering::SeqCst) {
            state.update(app, |snapshot| {
                snapshot.state = "working";
                snapshot.message = "Another hotkey run is still active. Ignoring the extra press."
                    .to_string();
            });
            false
        } else {
            state.update(app, |snapshot| {
                snapshot.state = "working";
                snapshot.last_action = Some(action.to_string());
                snapshot.message = message;
            });
            true
        }
    }

    fn finish_run(app: &AppHandle) {
        let state = app.state::<HotkeyState>();
        state.is_running.store(false, std::sync::atomic::Ordering::SeqCst);
    }

    fn trigger_capture_and_speak(app: &AppHandle) {
        if !begin_run(
            app,
            "speak",
            "Speak hotkey received. Copying the current selection and starting chunked OpenAI TTS …".to_string(),
        ) {
            return;
        }

        let app_handle = app.clone();
        thread::spawn(move || {
            let settings = app_handle.state::<SettingsState>().get();
            let result = crate::capture_and_speak_command(
                Some(CaptureOptions { copy_delay_ms: Some(140), restore_clipboard: Some(true) }),
                Some(SpeakTextOptions {
                    text: None,
                    voice: Some("alloy".to_string()),
                    model: None,
                    format: Some(settings.tts_format.clone()),
                    autoplay: Some(true),
                    max_chunk_chars: None,
                    max_parallel_requests: Some(3),
                    first_chunk_leading_silence_ms: Some(settings.first_chunk_leading_silence_ms),
                }),
                app_handle.state::<SettingsState>(),
            );

            let state = app_handle.state::<HotkeyState>();
            match result {
                Ok(result) => state.update(&app_handle, |snapshot| {
                    snapshot.state = "success";
                    snapshot.message = format!(
                        "Speak run finished. Captured {} chars, generated {} chunk(s) as {}, and started playback with a small first-chunk buffer.",
                        result.captured_text.chars().count(),
                        result.speech.chunk_count,
                        result.speech.format.to_uppercase()
                    );
                    snapshot.last_action = Some("speak".to_string());
                    snapshot.last_captured_text = Some(result.captured_text);
                    snapshot.last_audio_path = Some(result.speech.file_path);
                    snapshot.last_audio_output_directory = Some(result.speech.output_directory);
                    snapshot.last_audio_chunk_count = Some(result.speech.chunk_count);
                }),
                Err(error) => state.update(&app_handle, |snapshot| {
                    snapshot.state = "error";
                    snapshot.message = error;
                    snapshot.last_action = Some("speak".to_string());
                }),
            }

            finish_run(&app_handle);
        });
    }

    fn trigger_capture_and_translate(app: &AppHandle) {
        let target_language = app.state::<SettingsState>().get().translation_target_language;
        if !begin_run(
            app,
            "translate",
            format!("Translate hotkey received. Copying the current selection and translating it to {target_language} …"),
        ) {
            return;
        }

        let app_handle = app.clone();
        thread::spawn(move || {
            let settings = app_handle.state::<SettingsState>().get();
            let result = crate::capture_and_translate_command(
                Some(CaptureOptions { copy_delay_ms: Some(140), restore_clipboard: Some(true) }),
                Some(TranslateTextOptions {
                    text: None,
                    target_language: Some(settings.translation_target_language.clone()),
                    source_language: None,
                    model: None,
                }),
                app_handle.state::<SettingsState>(),
            );

            let state = app_handle.state::<HotkeyState>();
            match result {
                Ok(result) => state.update(&app_handle, |snapshot| {
                    snapshot.state = "success";
                    snapshot.message = format!(
                        "Translation finished to {} and playback started automatically as {}.",
                        result.translation.target_language,
                        result.speech.format.to_uppercase()
                    );
                    snapshot.last_action = Some("translate".to_string());
                    snapshot.last_captured_text = Some(result.captured_text);
                    snapshot.last_translation_target_language = Some(result.translation.target_language.clone());
                    snapshot.last_translation_text = Some(result.translation.text);
                    snapshot.last_audio_path = Some(result.speech.file_path);
                    snapshot.last_audio_output_directory = Some(result.speech.output_directory);
                    snapshot.last_audio_chunk_count = Some(result.speech.chunk_count);
                }),
                Err(error) => state.update(&app_handle, |snapshot| {
                    snapshot.state = "error";
                    snapshot.message = error;
                    snapshot.last_action = Some("translate".to_string());
                }),
            }

            finish_run(&app_handle);
        });
    }
}
