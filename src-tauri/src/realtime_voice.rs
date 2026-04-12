const OPENAI_REALTIME_VOICES: &[&str] = &[
    "alloy",
    "ash",
    "ballad",
    "cedar",
    "coral",
    "echo",
    "marin",
    "sage",
    "shimmer",
    "verse",
];

fn normalize_realtime_model_key(model: &str) -> &'static str {
    match model.trim().to_lowercase().as_str() {
        "gpt-realtime-mini" | "realtime-mini" | "realtime_mini" => "gpt-realtime-mini",
        _ => "gpt-realtime",
    }
}

pub fn realtime_voice_options_for_model(model: &str) -> &'static [&'static str] {
    match normalize_realtime_model_key(model) {
        "gpt-realtime-mini" => OPENAI_REALTIME_VOICES,
        _ => OPENAI_REALTIME_VOICES,
    }
}

pub fn default_realtime_voice_for_model(model: &str) -> &'static str {
    if realtime_voice_options_for_model(model).contains(&"marin") {
        "marin"
    } else {
        realtime_voice_options_for_model(model)
            .first()
            .copied()
            .unwrap_or("marin")
    }
}

pub fn sanitize_realtime_voice_for_model(value: &str, model: &str) -> String {
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase();

    if realtime_voice_options_for_model(model).contains(&normalized.as_str()) {
        normalized
    } else {
        default_realtime_voice_for_model(model).to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::{
        default_realtime_voice_for_model, realtime_voice_options_for_model,
        sanitize_realtime_voice_for_model,
    };

    #[test]
    fn returns_supported_openai_realtime_voices_for_each_model() {
        assert_eq!(realtime_voice_options_for_model("gpt-realtime").len(), 10);
        assert_eq!(realtime_voice_options_for_model("gpt-realtime-mini").len(), 10);
        assert!(realtime_voice_options_for_model("gpt-realtime").contains(&"marin"));
        assert!(realtime_voice_options_for_model("gpt-realtime-mini").contains(&"cedar"));
    }

    #[test]
    fn sanitizes_realtime_voice_against_the_selected_model() {
        assert_eq!(
            sanitize_realtime_voice_for_model("sage", "gpt-realtime"),
            "sage"
        );
        assert_eq!(
            sanitize_realtime_voice_for_model("invalid-voice", "gpt-realtime-mini"),
            "marin"
        );
        assert_eq!(default_realtime_voice_for_model("gpt-realtime"), "marin");
    }
}
