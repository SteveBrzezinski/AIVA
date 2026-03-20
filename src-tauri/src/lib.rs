pub mod hotkey;
pub mod selection_capture;
pub mod tts;

mod commands {
    use super::selection_capture::{capture_selected_text, CaptureOptions, CaptureResult};
    use super::tts::{speak_text, SpeakTextOptions, SpeakTextResult};
    use serde::Serialize;

    #[tauri::command]
    pub fn capture_selected_text_command(
        options: Option<CaptureOptions>,
    ) -> Result<CaptureResult, String> {
        capture_selected_text(options)
    }

    #[tauri::command]
    pub fn speak_text_command(options: SpeakTextOptions) -> Result<SpeakTextResult, String> {
        speak_text(options)
    }

    #[derive(Debug, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct CaptureAndSpeakResult {
        pub captured_text: String,
        pub restored_clipboard: bool,
        pub note: Option<String>,
        pub speech: SpeakTextResult,
    }

    #[tauri::command]
    pub fn capture_and_speak_command(
        capture_options: Option<CaptureOptions>,
        speak_options: Option<SpeakTextOptions>,
    ) -> Result<CaptureAndSpeakResult, String> {
        let capture = capture_selected_text(capture_options)?;

        if capture.text.trim().is_empty() {
            return Err(capture
                .note
                .unwrap_or_else(|| "No marked text could be captured.".to_string()));
        }

        let base_speak = speak_options.unwrap_or(SpeakTextOptions {
            text: None,
            voice: None,
            model: None,
            format: None,
            autoplay: Some(true),
            max_chunk_chars: None,
            max_parallel_requests: None,
        });

        let speech = speak_text(SpeakTextOptions {
            text: Some(capture.text.clone()),
            voice: base_speak.voice,
            model: base_speak.model,
            format: base_speak.format,
            autoplay: base_speak.autoplay,
            max_chunk_chars: base_speak.max_chunk_chars,
            max_parallel_requests: base_speak.max_parallel_requests,
        })?;

        Ok(CaptureAndSpeakResult {
            captured_text: capture.text,
            restored_clipboard: capture.restored_clipboard,
            note: capture.note,
            speech,
        })
    }
}

pub use commands::{capture_and_speak_command, capture_selected_text_command, speak_text_command};
