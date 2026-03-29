pub mod hotkey;
pub mod openclaw;
pub mod run_controller;
pub mod selection_capture;
pub mod settings;
pub mod stt;
pub mod translation;
pub mod tts;

mod commands {
    use std::sync::Arc;

    use super::hotkey;
    use super::openclaw::{submit_voice_turn, OpenClawBridgeResult, OpenClawVoiceTurnOptions};
    use super::run_controller::{CancelResult, PauseResumeResult, RunController};
    use super::selection_capture::{capture_selected_text, CaptureOptions, CaptureResult};
    use super::settings::{AppSettings, LanguageOption, SettingsState, LANGUAGE_OPTIONS};
    use super::stt::{append_stt_debug_log, AppendSttDebugLogOptions, AppendSttDebugLogResult};
    use super::translation::{translate_text, TranslateTextOptions, TranslateTextResult};
    use super::tts::{speak_text, speak_text_with_progress_and_control, SpeakTextOptions, SpeakTextResult, TtsProgress};
    use serde::Serialize;
    use tauri::{AppHandle, State};

    #[tauri::command]
    pub fn pause_resume_current_run(controller: State<'_, RunController>) -> Result<String, String> {
        Ok(match controller.pause_resume() {
            PauseResumeResult::NoActiveRun => return Err("No active run can be paused or resumed.".to_string()),
            PauseResumeResult::CancelPending(snapshot) => format!("Cancel already requested for current {} run during phase '{}'.", snapshot.action, snapshot.phase),
            PauseResumeResult::Paused(snapshot) => format!("Paused current {} run during phase '{}'.", snapshot.action, snapshot.phase),
            PauseResumeResult::Resumed(snapshot) => format!("Resumed current {} run during phase '{}'.", snapshot.action, snapshot.phase),
        })
    }

    #[tauri::command]
    pub fn cancel_current_run(controller: State<'_, RunController>) -> Result<String, String> {
        Ok(match controller.cancel() {
            CancelResult::NoActiveRun => return Err("No active run to cancel.".to_string()),
            CancelResult::CancelRequested(snapshot) => format!("Cancelling current {} run during phase '{}'.", snapshot.action, snapshot.phase),
            CancelResult::AlreadyRequested(snapshot) => format!("Cancel was already requested for current {} run during phase '{}'.", snapshot.action, snapshot.phase),
        })
    }

    #[tauri::command]
    pub fn capture_selected_text_command(options: Option<CaptureOptions>) -> Result<CaptureResult, String> {
        capture_selected_text(options)
    }

    #[tauri::command]
    pub fn speak_text_command(options: SpeakTextOptions, settings: State<'_, SettingsState>) -> Result<SpeakTextResult, String> {
        speak_text(options, &settings.get())
    }

    #[tauri::command]
    pub fn translate_text_command(
        options: TranslateTextOptions,
        settings: State<'_, SettingsState>,
    ) -> Result<TranslateTextResult, String> {
        translate_text(options, &settings.get())
    }

    #[tauri::command]
    pub fn get_settings(settings: State<'_, SettingsState>) -> AppSettings { settings.get() }

    #[tauri::command]
    pub fn update_settings(next: AppSettings, settings: State<'_, SettingsState>) -> Result<AppSettings, String> {
        settings.update(next)
    }

    #[tauri::command]
    pub fn reset_settings(settings: State<'_, SettingsState>) -> Result<AppSettings, String> { settings.reset() }

    #[tauri::command]
    pub fn get_language_options() -> Vec<LanguageOption> { LANGUAGE_OPTIONS.to_vec() }

    #[tauri::command]
    pub fn append_stt_debug_log_command(
        options: AppendSttDebugLogOptions,
    ) -> Result<AppendSttDebugLogResult, String> {
        append_stt_debug_log(options)
    }

    #[derive(Debug, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct CaptureAndSpeakResult {
        pub captured_text: String,
        pub restored_clipboard: bool,
        pub note: Option<String>,
        pub speech: SpeakTextResult,
    }

    #[derive(Debug, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct CaptureAndTranslateResult {
        pub captured_text: String,
        pub restored_clipboard: bool,
        pub note: Option<String>,
        pub translation: TranslateTextResult,
        pub speech: SpeakTextResult,
    }

    #[derive(Debug, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct OpenClawVoiceTurnResult {
        pub transcript: String,
        pub openclaw: OpenClawBridgeResult,
        pub speech: SpeakTextResult,
    }

    #[tauri::command]
    pub fn capture_and_speak_command(
        capture_options: Option<CaptureOptions>,
        speak_options: Option<SpeakTextOptions>,
        settings: State<'_, SettingsState>,
    ) -> Result<CaptureAndSpeakResult, String> {
        let capture = capture_selected_text(capture_options)?;
        if capture.text.trim().is_empty() {
            return Err(capture.note.unwrap_or_else(|| "No marked text could be captured.".to_string()));
        }
        let app_settings = settings.get();
        let base_speak = speak_options.unwrap_or(SpeakTextOptions {
            text: None,
            voice: None,
            model: None,
            format: None,
            mode: None,
            autoplay: Some(true),
            max_chunk_chars: None,
            max_parallel_requests: None,
            first_chunk_leading_silence_ms: None,
        });
        let speech = speak_text(
            SpeakTextOptions {
                text: Some(capture.text.clone()),
                voice: base_speak.voice,
                model: base_speak.model,
                format: base_speak.format,
                mode: base_speak.mode.or(Some(app_settings.tts_mode.clone())),
                autoplay: base_speak.autoplay,
                max_chunk_chars: base_speak.max_chunk_chars,
                max_parallel_requests: base_speak.max_parallel_requests,
                first_chunk_leading_silence_ms: base_speak.first_chunk_leading_silence_ms,
            },
            &app_settings,
        )?;
        Ok(CaptureAndSpeakResult { captured_text: capture.text, restored_clipboard: capture.restored_clipboard, note: capture.note, speech })
    }

    #[tauri::command]
    pub fn capture_and_translate_command(
        capture_options: Option<CaptureOptions>,
        translate_options: Option<TranslateTextOptions>,
        settings: State<'_, SettingsState>,
    ) -> Result<CaptureAndTranslateResult, String> {
        let capture = capture_selected_text(capture_options)?;
        if capture.text.trim().is_empty() {
            return Err(capture.note.unwrap_or_else(|| "No marked text could be captured.".to_string()));
        }
        let app_settings = settings.get();
        let base = translate_options.unwrap_or(TranslateTextOptions {
            text: None,
            target_language: Some(app_settings.translation_target_language.clone()),
            source_language: None,
            model: None,
        });
        let translation = translate_text(TranslateTextOptions {
            text: Some(capture.text.clone()),
            target_language: base.target_language.or(Some(app_settings.translation_target_language.clone())),
            source_language: base.source_language,
            model: base.model,
        }, &app_settings)?;
        let speech = speak_text(
            SpeakTextOptions {
                text: Some(translation.text.clone()),
                voice: None,
                model: None,
                format: Some(app_settings.tts_format.clone()),
                mode: Some(app_settings.tts_mode.clone()),
                autoplay: Some(true),
                max_chunk_chars: None,
                max_parallel_requests: Some(3),
                first_chunk_leading_silence_ms: Some(app_settings.first_chunk_leading_silence_ms),
            },
            &app_settings,
        )?;
        Ok(CaptureAndTranslateResult { captured_text: capture.text, restored_clipboard: capture.restored_clipboard, note: capture.note, translation, speech })
    }

    #[tauri::command]
    pub fn run_openclaw_voice_turn_command(
        options: OpenClawVoiceTurnOptions,
        app: AppHandle,
        settings: State<'_, SettingsState>,
    ) -> Result<OpenClawVoiceTurnResult, String> {
        let transcript = options.transcript.clone().unwrap_or_default().trim().to_string();
        if transcript.is_empty() {
            return Err("No transcript provided for the assistant voice turn.".to_string());
        }

        let app_settings = settings.get();
        let run_handle = hotkey::begin_managed_run(
            &app,
            "assistant_voice",
            format!(
                "Voice request captured. Sending {} character(s) to OpenClaw …",
                transcript.chars().count()
            ),
        )?;
        let run_access = run_handle.access();

        let openclaw = match submit_voice_turn(options, &app_settings, Some(&run_access)) {
            Ok(result) => result,
            Err(error) if crate::run_controller::is_cancelled_error(&error) => {
                hotkey::set_cancelled(
                    &app,
                    "assistant_voice",
                    "Assistant voice run cancelled.".to_string(),
                    Some(transcript.clone()),
                    None,
                    None,
                );
                return Err(error);
            }
            Err(error) => {
                hotkey::set_error(
                    &app,
                    "assistant_voice",
                    error.clone(),
                    Some(transcript.clone()),
                    None,
                    None,
                );
                return Err(error);
            }
        };

        hotkey::update_working(
            &app,
            "assistant_voice",
            format!(
                "OpenClaw replied with {} character(s). Speaking the response …",
                openclaw.text.chars().count()
            ),
        );

        let progress_app = app.clone();
        let progress = Arc::new(move |progress: TtsProgress| {
            hotkey::apply_tts_progress(&progress_app, "assistant_voice", progress)
        });
        let speech = match speak_text_with_progress_and_control(
            SpeakTextOptions {
                text: Some(openclaw.text.clone()),
                voice: None,
                model: None,
                format: Some(app_settings.tts_format.clone()),
                mode: Some(app_settings.tts_mode.clone()),
                autoplay: Some(true),
                max_chunk_chars: None,
                max_parallel_requests: Some(3),
                first_chunk_leading_silence_ms: Some(app_settings.first_chunk_leading_silence_ms),
            },
            &app_settings,
            Some(progress),
            Some(run_access.clone()),
        ) {
            Ok(result) => result,
            Err(error) if crate::run_controller::is_cancelled_error(&error) => {
                hotkey::set_cancelled(
                    &app,
                    "assistant_voice",
                    "Assistant voice run cancelled.".to_string(),
                    Some(transcript.clone()),
                    None,
                    None,
                );
                return Err(error);
            }
            Err(error) => {
                hotkey::set_error(
                    &app,
                    "assistant_voice",
                    format!("Assistant response playback failed: {error}"),
                    Some(transcript.clone()),
                    None,
                    None,
                );
                return Err(error);
            }
        };

        hotkey::set_voice_run_success(
            &app,
            format!(
                "Assistant voice run finished. OpenClaw replied and {} mode started audible playback{}.",
                speech.mode,
                speech
                    .start_latency_ms
                    .map(|value| format!(" after {value} ms"))
                    .unwrap_or_default()
            ),
            transcript.clone(),
            &speech,
        );

        Ok(OpenClawVoiceTurnResult {
            transcript,
            openclaw,
            speech,
        })
    }
}

pub use commands::{append_stt_debug_log_command, cancel_current_run, capture_and_speak_command, capture_and_translate_command, capture_selected_text_command, get_language_options, get_settings, pause_resume_current_run, reset_settings, run_openclaw_voice_turn_command, speak_text_command, translate_text_command, update_settings};
