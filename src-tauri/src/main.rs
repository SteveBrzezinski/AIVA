#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use voice_overlay_assistant::hotkey;

#[tauri::command]
fn app_status() -> &'static str {
    "Voice Overlay Assistant MVP is ready: the Windows global hotkey can capture selected text, generate speech, and play it back."
}

fn main() {
    tauri::Builder::default()
        .manage(hotkey::HotkeyState::default())
        .setup(|app| {
            hotkey::init_hotkey(&app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_status,
            hotkey::get_hotkey_status,
            voice_overlay_assistant::capture_selected_text_command,
            voice_overlay_assistant::speak_text_command,
            voice_overlay_assistant::capture_and_speak_command
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
