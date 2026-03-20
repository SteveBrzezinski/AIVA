# Windows-first selection capture MVP for Tauri

## Goal

Capture the user's currently selected text when a global hotkey is pressed, without permanently disturbing their clipboard.

## Pragmatic MVP flow

1. User presses a registered global hotkey (example: `Ctrl+Shift+Space`).
2. The frontend invokes a Tauri command such as `capture_selected_text`.
3. Rust backend:
   - snapshots the current clipboard text if present
   - clears clipboard text to reduce stale-read ambiguity
   - simulates `Ctrl+C` on Windows with `SendInput`
   - waits briefly for the focused app to populate the clipboard
   - reads clipboard text
   - restores the previous clipboard text when possible
4. Command returns:
   - captured text
   - whether clipboard restoration succeeded
   - optional note/caveat

## Why this approach

Windows does not provide a universal "read selected text from any app" API. For an MVP, the most reliable cross-app approach is still:

- trigger the target app's normal Copy shortcut
- read the clipboard
- restore clipboard contents

This works in many native apps, browsers, editors, and Electron apps, but it is not guaranteed everywhere.

## Caveats

- Only text clipboard is restored in this MVP. Rich clipboard formats, images, HTML, file lists, and app-specific clipboard payloads are not preserved yet.
- Some apps ignore synthetic `Ctrl+C` or require elevated permissions / same-integrity interaction.
- Some apps expose no selectable text or use custom controls.
- Clipboard listeners may briefly observe the temporary clipboard change.
- If the user changes clipboard contents during the capture window, restore behavior may overwrite that new clipboard text. To avoid hiding that, the backend returns restore status and notes.
- On Windows, `SendInput` generally cannot inject into higher-integrity/elevated apps from a normal app.

## Suggested UX

- Show a subtle overlay / toast: `Capturing selection…`
- If empty result, do not treat as hard failure; surface `No text selection found`.
- Allow a settings toggle:
  - `Restore clipboard after capture` (default on)
  - `Capture delay (ms)` default ~120

## Integration points

### Frontend global hotkey

Use a Tauri-supported global shortcut plugin in the real app shell. When triggered:

- call `invoke('capture_selected_text', { options })`
- use the returned `text`
- feed it into your overlay / assistant flow

### Backend command

Expose a Tauri command that wraps the Windows implementation and returns a serializable struct.

## Files added in this repo

- `src-tauri/src/selection_capture.rs` — Windows-first implementation
- `src-tauri/src/lib.rs` — example Tauri command wiring
- `src/utils/selectionCapture.ts` — frontend invoke helper

## Recommended next step inside a real scaffold

1. Merge the Rust module into the generated `src-tauri` crate.
2. Add `serde`, `tauri`, and `windows` crate deps.
3. Register the command in `tauri::generate_handler!`.
4. Hook the frontend hotkey plugin to call the command.
5. Test against:
   - Notepad
   - VS Code
   - Chrome / Edge
   - Word / Outlook
   - Explorer rename field / unsupported surfaces
