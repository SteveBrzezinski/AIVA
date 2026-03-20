use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    env, fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicUsize, Ordering},
        mpsc, Arc,
    },
    thread,
    time::{SystemTime, UNIX_EPOCH},
};

const DEFAULT_MODEL: &str = "gpt-4o-mini-tts";
const DEFAULT_VOICE: &str = "alloy";
const DEFAULT_FORMAT: &str = "mp3";
const DEFAULT_MAX_CHUNK_CHARS: usize = 280;
const DEFAULT_MAX_PARALLEL_REQUESTS: usize = 3;
const MAX_PARALLEL_REQUESTS_LIMIT: usize = 4;
const MIN_CHUNK_CHARS: usize = 120;
const MAX_CHUNK_CHARS: usize = 1_200;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeakTextOptions {
    pub text: Option<String>,
    pub voice: Option<String>,
    pub model: Option<String>,
    pub format: Option<String>,
    pub autoplay: Option<bool>,
    pub max_chunk_chars: Option<usize>,
    pub max_parallel_requests: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeakTextResult {
    pub file_path: String,
    pub output_directory: String,
    pub bytes_written: usize,
    pub chunk_count: usize,
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

#[derive(Clone)]
struct ResolvedSpeakOptions {
    voice: String,
    model: String,
    format: String,
    autoplay: bool,
    max_chunk_chars: usize,
    max_parallel_requests: usize,
}

#[derive(Debug, Clone)]
struct ChunkJob {
    index: usize,
    text: String,
    file_path: PathBuf,
}

#[derive(Debug, Clone)]
struct GeneratedChunk {
    index: usize,
    file_path: String,
    bytes_written: usize,
}

enum PipelineMessage {
    ChunkReady(GeneratedChunk),
    Failed(String),
}

trait SpeechProvider: Send + Sync + Clone + 'static {
    fn synthesize_chunk(
        &self,
        options: &ResolvedSpeakOptions,
        chunk: &ChunkJob,
    ) -> Result<GeneratedChunk, String>;
}

#[derive(Clone)]
struct OpenAiSpeechProvider {
    api_key: String,
    client: reqwest::blocking::Client,
}

impl OpenAiSpeechProvider {
    fn new(api_key: String) -> Self {
        Self {
            api_key,
            client: reqwest::blocking::Client::new(),
        }
    }
}

impl SpeechProvider for OpenAiSpeechProvider {
    fn synthesize_chunk(
        &self,
        options: &ResolvedSpeakOptions,
        chunk: &ChunkJob,
    ) -> Result<GeneratedChunk, String> {
        let response = self
            .client
            .post("https://api.openai.com/v1/audio/speech")
            .bearer_auth(&self.api_key)
            .header("Content-Type", "application/json")
            .json(&OpenAiSpeechRequest {
                model: &options.model,
                voice: &options.voice,
                input: &chunk.text,
                response_format: &options.format,
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

        fs::write(&chunk.file_path, &bytes)
            .map_err(|err| format!("Failed to write audio file: {err}"))?;

        Ok(GeneratedChunk {
            index: chunk.index,
            file_path: chunk.file_path.to_string_lossy().to_string(),
            bytes_written: bytes.len(),
        })
    }
}

struct ChunkedSpeechPipeline<P> {
    provider: P,
    chunker: TextChunker,
}

impl<P> ChunkedSpeechPipeline<P>
where
    P: SpeechProvider,
{
    fn new(provider: P, chunker: TextChunker) -> Self {
        Self { provider, chunker }
    }

    fn run(&self, text: &str, options: ResolvedSpeakOptions) -> Result<SpeakTextResult, String> {
        let chunks = self.chunker.split(text);
        if chunks.is_empty() {
            return Err("No text provided for speech synthesis".into());
        }

        let output_directory = build_output_directory()?;
        let jobs: Vec<ChunkJob> = chunks
            .into_iter()
            .enumerate()
            .map(|(index, chunk_text)| ChunkJob {
                index,
                text: chunk_text,
                file_path: build_chunk_path(&output_directory, index, &options.format),
            })
            .collect();

        let worker_count = options
            .max_parallel_requests
            .min(jobs.len())
            .max(1);

        let expected_chunks = jobs.len();
        let (sender, receiver) = mpsc::channel::<PipelineMessage>();
        let next_index = Arc::new(AtomicUsize::new(0));
        let shared_jobs = Arc::new(jobs);
        let mut worker_handles = Vec::with_capacity(worker_count);

        for _ in 0..worker_count {
            let provider = self.provider.clone();
            let options = options.clone();
            let sender = sender.clone();
            let next_index = Arc::clone(&next_index);
            let jobs = Arc::clone(&shared_jobs);

            worker_handles.push(thread::spawn(move || {
                loop {
                    let job_index = next_index.fetch_add(1, Ordering::SeqCst);
                    if job_index >= jobs.len() {
                        break;
                    }

                    let job = jobs[job_index].clone();
                    let message = match provider.synthesize_chunk(&options, &job) {
                        Ok(chunk) => PipelineMessage::ChunkReady(chunk),
                        Err(error) => PipelineMessage::Failed(format!(
                            "Chunk {} of {} failed: {error}",
                            job.index + 1,
                            jobs.len()
                        )),
                    };

                    if sender.send(message).is_err() {
                        break;
                    }
                }
            }));
        }
        drop(sender);

        let playback_result =
            self.collect_and_play_ordered_chunks(receiver, expected_chunks, options.autoplay);
        let join_result = join_worker_handles(worker_handles);

        if let Err(error) = join_result {
            if playback_result.is_ok() {
                return Err(error);
            }
        }

        let ordered_chunks = playback_result?;
        let first_chunk = ordered_chunks
            .first()
            .ok_or_else(|| "No audio chunks were produced.".to_string())?;

        Ok(SpeakTextResult {
            file_path: first_chunk.file_path.clone(),
            output_directory: output_directory.to_string_lossy().to_string(),
            bytes_written: ordered_chunks.iter().map(|chunk| chunk.bytes_written).sum(),
            chunk_count: ordered_chunks.len(),
            voice: options.voice,
            model: options.model,
            format: options.format,
            autoplay: options.autoplay,
        })
    }

    fn collect_and_play_ordered_chunks(
        &self,
        receiver: mpsc::Receiver<PipelineMessage>,
        expected_chunks: usize,
        autoplay: bool,
    ) -> Result<Vec<GeneratedChunk>, String> {
        let mut buffered = HashMap::<usize, GeneratedChunk>::new();
        let mut ordered = Vec::with_capacity(expected_chunks);
        let mut next_index = 0usize;

        while ordered.len() < expected_chunks {
            if let Some(chunk) = buffered.remove(&next_index) {
                self.play_chunk_if_needed(&chunk, autoplay)?;
                ordered.push(chunk);
                next_index += 1;
                continue;
            }

            match receiver.recv() {
                Ok(PipelineMessage::ChunkReady(chunk)) => {
                    if chunk.index == next_index {
                        self.play_chunk_if_needed(&chunk, autoplay)?;
                        ordered.push(chunk);
                        next_index += 1;

                        while let Some(buffered_chunk) = buffered.remove(&next_index) {
                            self.play_chunk_if_needed(&buffered_chunk, autoplay)?;
                            ordered.push(buffered_chunk);
                            next_index += 1;
                        }
                    } else {
                        buffered.insert(chunk.index, chunk);
                    }
                }
                Ok(PipelineMessage::Failed(error)) => return Err(error),
                Err(_) => {
                    return Err(
                        "The chunked TTS pipeline stopped before all audio chunks were ready."
                            .to_string(),
                    )
                }
            }
        }

        Ok(ordered)
    }

    fn play_chunk_if_needed(&self, chunk: &GeneratedChunk, autoplay: bool) -> Result<(), String> {
        if autoplay {
            play_audio(&chunk.file_path)?;
        }

        Ok(())
    }
}

#[derive(Clone)]
struct TextChunker {
    max_chunk_chars: usize,
}

impl TextChunker {
    fn new(max_chunk_chars: usize) -> Self {
        Self { max_chunk_chars }
    }

    fn split(&self, text: &str) -> Vec<String> {
        let normalized = text.replace("\r\n", "\n");
        let trimmed = normalized.trim();

        if trimmed.is_empty() {
            return Vec::new();
        }

        let mut chunks = Vec::new();
        let mut current = String::new();

        for sentence in split_into_sentences(trimmed) {
            for part in split_segment_to_fit(&sentence, self.max_chunk_chars) {
                if current.is_empty() {
                    current = part;
                    continue;
                }

                if char_count(&current) + 1 + char_count(&part) <= self.max_chunk_chars {
                    current.push(' ');
                    current.push_str(&part);
                } else {
                    chunks.push(current);
                    current = part;
                }
            }
        }

        if !current.is_empty() {
            chunks.push(current);
        }

        chunks
    }
}

fn char_count(value: &str) -> usize {
    value.chars().count()
}

fn split_into_sentences(text: &str) -> Vec<String> {
    let mut sentences = Vec::new();
    let mut start = 0usize;
    let mut previous_was_newline = false;
    let mut iter = text.char_indices().peekable();

    while let Some((index, ch)) = iter.next() {
        let mut boundary = false;
        let mut boundary_end = index + ch.len_utf8();

        if matches!(ch, '.' | '!' | '?') {
            let mut lookahead = iter.clone();
            while let Some((quote_index, next)) = lookahead.peek().copied() {
                if matches!(next, '"' | '\'' | ')' | ']' | '}') {
                    boundary_end = quote_index + next.len_utf8();
                    lookahead.next();
                    continue;
                }

                boundary = next.is_whitespace();
                break;
            }

            if lookahead.peek().is_none() {
                boundary = true;
            }
        } else if ch == '\n' {
            if previous_was_newline {
                boundary = true;
            }
            previous_was_newline = true;
        } else if !ch.is_whitespace() {
            previous_was_newline = false;
        }

        if boundary {
            let segment = text[start..boundary_end].trim();
            if !segment.is_empty() {
                sentences.push(segment.to_string());
            }

            start = boundary_end;
            while let Some((next_index, next_ch)) = iter.peek().copied() {
                if next_ch.is_whitespace() {
                    iter.next();
                    start = next_index + next_ch.len_utf8();
                } else {
                    break;
                }
            }
            previous_was_newline = false;
        }
    }

    let tail = text[start..].trim();
    if !tail.is_empty() {
        sentences.push(tail.to_string());
    }

    if sentences.is_empty() {
        vec![text.trim().to_string()]
    } else {
        sentences
    }
}

fn split_segment_to_fit(segment: &str, max_chars: usize) -> Vec<String> {
    let trimmed = segment.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    if char_count(trimmed) <= max_chars {
        return vec![trimmed.to_string()];
    }

    let mut parts = Vec::new();
    let mut current = String::new();

    for token in trimmed.split_whitespace() {
        let token_len = char_count(token);
        let current_len = char_count(&current);
        let separator_len = usize::from(!current.is_empty());

        if current_len + separator_len + token_len <= max_chars {
            if !current.is_empty() {
                current.push(' ');
            }
            current.push_str(token);
            continue;
        }

        if !current.is_empty() {
            parts.push(current);
            current = String::new();
        }

        if token_len <= max_chars {
            current.push_str(token);
            continue;
        }

        let split_tokens = split_long_token(token, max_chars);
        let last_index = split_tokens.len().saturating_sub(1);
        for (index, split_token) in split_tokens.into_iter().enumerate() {
            if index == last_index {
                current = split_token;
            } else {
                parts.push(split_token);
            }
        }
    }

    if !current.is_empty() {
        parts.push(current);
    }

    parts
}

fn split_long_token(token: &str, max_chars: usize) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();

    for ch in token.chars() {
        current.push(ch);
        if char_count(&current) >= max_chars {
            parts.push(current);
            current = String::new();
        }
    }

    if !current.is_empty() {
        parts.push(current);
    }

    parts
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

fn build_output_directory() -> Result<PathBuf, String> {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_micros())
        .unwrap_or(0);

    let mut dir = env::temp_dir();
    dir.push("voice-overlay-assistant");
    dir.push("tts-output");
    dir.push(format!("speech-{ts}"));

    fs::create_dir_all(&dir).map_err(|err| format!("Failed to create output directory: {err}"))?;
    Ok(dir)
}

fn build_chunk_path(output_directory: &Path, index: usize, format: &str) -> PathBuf {
    output_directory.join(format!("chunk-{:03}.{format}", index + 1))
}

fn resolve_format(format: Option<String>) -> Result<String, String> {
    let value = format
        .unwrap_or_else(|| DEFAULT_FORMAT.to_string())
        .trim()
        .to_lowercase();

    match value.as_str() {
        "mp3" | "wav" => Ok(value),
        _ => Err(format!(
            "Unsupported audio format '{value}'. Use 'mp3' or 'wav'."
        )),
    }
}

fn resolve_parallel_requests(value: Option<usize>) -> usize {
    value
        .unwrap_or(DEFAULT_MAX_PARALLEL_REQUESTS)
        .clamp(1, MAX_PARALLEL_REQUESTS_LIMIT)
}

fn resolve_max_chunk_chars(value: Option<usize>) -> usize {
    value
        .unwrap_or(DEFAULT_MAX_CHUNK_CHARS)
        .clamp(MIN_CHUNK_CHARS, MAX_CHUNK_CHARS)
}

fn join_worker_handles(handles: Vec<thread::JoinHandle<()>>) -> Result<(), String> {
    for handle in handles {
        if handle.join().is_err() {
            return Err("A TTS worker thread panicked while preparing audio chunks.".to_string());
        }
    }

    Ok(())
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

    let resolved = ResolvedSpeakOptions {
        voice: options.voice.unwrap_or_else(|| DEFAULT_VOICE.to_string()),
        model: options.model.unwrap_or_else(|| DEFAULT_MODEL.to_string()),
        format: resolve_format(options.format)?,
        autoplay: options.autoplay.unwrap_or(true),
        max_chunk_chars: resolve_max_chunk_chars(options.max_chunk_chars),
        max_parallel_requests: resolve_parallel_requests(options.max_parallel_requests),
    };

    let provider = OpenAiSpeechProvider::new(api_key);
    let pipeline = ChunkedSpeechPipeline::new(provider, TextChunker::new(resolved.max_chunk_chars));

    pipeline.run(&text, resolved)
}

#[cfg(test)]
mod tests {
    use super::{split_into_sentences, TextChunker};

    #[test]
    fn keeps_short_text_in_one_chunk() {
        let chunks = TextChunker::new(280).split("Hello world. This still fits.");
        assert_eq!(chunks, vec!["Hello world. This still fits."]);
    }

    #[test]
    fn prefers_sentence_boundaries() {
        let chunks = TextChunker::new(24).split("First sentence. Second one. Third one.");
        assert_eq!(chunks, vec!["First sentence.", "Second one. Third one."]);
    }

    #[test]
    fn falls_back_to_word_wrapping_for_long_sentences() {
        let chunks =
            TextChunker::new(30).split("First sentence. Second sentence is a bit longer than the limit. Third one.");

        assert_eq!(
            chunks,
            vec![
                "First sentence.",
                "Second sentence is a bit",
                "longer than the limit.",
                "Third one."
            ]
        );
    }

    #[test]
    fn splits_double_newlines_into_separate_segments() {
        let sentences = split_into_sentences("Title\n\nBody starts here.");
        assert_eq!(sentences, vec!["Title", "Body starts here."]);
    }
}
