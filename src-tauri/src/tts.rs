use serde::{Deserialize, Serialize};
use std::{env, fs, path::PathBuf, process::Command, time::{SystemTime, UNIX_EPOCH}};

const DEFAULT_MODEL: &str = "gpt-4o-mini-tts";
const DEFAULT_VOICE: &str = "alloy";
const DEFAULT_FORMAT: &str = "mp3";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeakTextOptions {
    pub text: Option<String>,
    pub voice: Option<String>,
    pub model: Option<String>,
    pub format: Option<String>,
    pub autoplay: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeakTextResult {
    pub file_path: String,
    pub bytes_written: usize,
    pub voice: String,
    pub model: String,
    pub format: String,
    pub autoplay: bool,
}

#[derive(Serialize)]
struct OpenAiSpeechRequest<'a> {
    model: &'a str,
    voice: &'a str,
    input: &'a str,
    response_format: &'a str,
}

fn load_env_file_if_present() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let env_path = manifest_dir.parent().map(|p| p.join(".env"));

    if let Some(path) = env_path {
        if let Ok(contents) = fs::read_to_string(path) {
            for line in contents.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() || trimmed.starts_with('#') {
                    continue;
                }
                if let Some((key, value)) = trimmed.split_once('=') {
                    if env::var_os(key.trim()).is_none() {
                        let clean = value.trim().trim_matches('"').trim_matches('\'');
                        env::set_var(key.trim(), clean);
                    }
                }
            }
        }
    }
}

fn build_output_path(format: &str) -> PathBuf {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);

    let mut dir = env::temp_dir();
    dir.push("voice-overlay-assistant");
    dir.push("tts-output");
    let _ = fs::create_dir_all(&dir);
    dir.push(format!("speech-{ts}.{format}"));
    dir
}

fn play_audio(file_path: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let escaped = file_path.replace('\'', "''");
        let lower = file_path.to_lowercase();

        let script = if lower.ends_with(".mp3") {
            format!(
                r#"$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class MciBridge {{
  [DllImport("winmm.dll", CharSet = CharSet.Auto)]
  public static extern int mciSendString(string command, StringBuilder buffer, int bufferSize, IntPtr hwndCallback);
}}
"@
$alias = 'voiceoverlayclip'
$path = '{escaped}'
$openResult = [MciBridge]::mciSendString("open `"$path`" type mpegvideo alias $alias", $null, 0, [IntPtr]::Zero)
if ($openResult -ne 0) {{
  throw "MCI open failed with code $openResult"
}}
try {{
  $playResult = [MciBridge]::mciSendString("play $alias wait", $null, 0, [IntPtr]::Zero)
  if ($playResult -ne 0) {{
    throw "MCI play failed with code $playResult"
  }}
}} finally {{
  [void][MciBridge]::mciSendString("close $alias", $null, 0, [IntPtr]::Zero)
}}
"#
            )
        } else {
            format!(
                r#"$ErrorActionPreference = 'Stop'
$player = New-Object System.Media.SoundPlayer
$player.SoundLocation = '{escaped}'
$player.Load()
$player.PlaySync()
"#
            )
        };

        let output = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .output()
            .map_err(|err| format!("Failed to launch audio player: {err}"))?;

        if output.status.success() {
            Ok(())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let detail = if !stderr.is_empty() {
                stderr
            } else if !stdout.is_empty() {
                stdout
            } else {
                format!("status {}", output.status)
            };
            Err(format!("Audio playback failed: {detail}"))
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = file_path;
        Err("Audio playback MVP is currently implemented for Windows only".into())
    }
}

pub fn speak_text(options: SpeakTextOptions) -> Result<SpeakTextResult, String> {
    load_env_file_if_present();

    let text = options.text.unwrap_or_default().trim().to_string();
    if text.is_empty() {
        return Err("No text provided for speech synthesis".into());
    }

    let api_key = env::var("OPENAI_API_KEY")
        .map_err(|_| "OPENAI_API_KEY is missing. Add it to the project's .env file.".to_string())?;

    let voice = options.voice.unwrap_or_else(|| DEFAULT_VOICE.to_string());
    let model = options.model.unwrap_or_else(|| DEFAULT_MODEL.to_string());
    let format = options.format.unwrap_or_else(|| DEFAULT_FORMAT.to_string());
    let autoplay = options.autoplay.unwrap_or(true);

    let client = reqwest::blocking::Client::new();
    let response = client
        .post("https://api.openai.com/v1/audio/speech")
        .bearer_auth(api_key)
        .header("Content-Type", "application/json")
        .json(&OpenAiSpeechRequest {
            model: &model,
            voice: &voice,
            input: &text,
            response_format: &format,
        })
        .send()
        .map_err(|err| format!("OpenAI request failed: {err}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(format!("OpenAI TTS failed ({status}): {body}"));
    }

    let bytes = response
        .bytes()
        .map_err(|err| format!("Failed to read audio response: {err}"))?;

    let path = build_output_path(&format);
    fs::write(&path, &bytes).map_err(|err| format!("Failed to write audio file: {err}"))?;

    if autoplay {
        play_audio(&path.to_string_lossy())?;
    }

    Ok(SpeakTextResult {
        file_path: path.to_string_lossy().to_string(),
        bytes_written: bytes.len(),
        voice,
        model,
        format,
        autoplay,
    })
}
