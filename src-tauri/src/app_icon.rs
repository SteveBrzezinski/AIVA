use tauri::{image::Image, AppHandle, Manager, Runtime};

const MAIN_WINDOW_LABEL: &str = "main";
const CORAL_COMPANION_ICON_BYTES: &[u8] = include_bytes!("../icons/AIVA.png");

pub fn load_coral_companion_icon() -> Result<Image<'static>, String> {
    Image::from_bytes(CORAL_COMPANION_ICON_BYTES)
        .map_err(|error| format!("Failed to load embedded CoralCompanion icon: {error}"))
}

pub fn apply_main_window_icon<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let window = app.get_webview_window(MAIN_WINDOW_LABEL).ok_or_else(|| {
        "Main window is missing, so the CoralCompanion taskbar icon cannot be applied."
            .to_string()
    })?;

    window
        .set_icon(load_coral_companion_icon()?)
        .map_err(|error| format!("Failed to apply CoralCompanion taskbar icon: {error}"))
}
