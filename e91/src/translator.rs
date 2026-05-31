use crate::TranslationResult;
use anyhow::{Context, Result};
use chrono::Local;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Serialize, Deserialize)]
struct OllamaRequest {
    model: String,
    prompt: String,
    stream: bool,
    temperature: f32,
}

#[derive(Debug, Deserialize)]
struct OllamaResponse {
    response: String,
    #[allow(dead_code)]
    done: bool,
}

pub struct Translator {
    client: Client,
    ollama_url: String,
    model: String,
}

impl Translator {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
            ollama_url: "http://localhost:11434/api/generate".to_string(),
            model: "llama3".to_string(),
        }
    }

    pub async fn translate(&self, text: &str, direction: &str) -> Result<TranslationResult> {
        let (source_lang, target_lang) = match direction {
            "zh-en" => ("Chinese", "English"),
            "en-zh" => ("English", "Chinese"),
            _ => ("Chinese", "English"),
        };

        let translated = self.simple_translate(text, source_lang, target_lang).await?;
        let optimized = self.optimize_grammar(&translated, target_lang).await?;

        Ok(TranslationResult {
            original: text.to_string(),
            translated,
            optimized,
            direction: direction.to_string(),
            timestamp: Local::now(),
        })
    }

    async fn simple_translate(&self, text: &str, source: &str, target: &str) -> Result<String> {
        let prompt = format!(
            "Translate the following {source} text to {target}. Only output the translation, no explanations.\n\nText: {text}\n\nTranslation:",
            source = source,
            target = target,
            text = text
        );

        self.call_ollama(&prompt).await
    }

    async fn optimize_grammar(&self, text: &str, target_lang: &str) -> Result<String> {
        let prompt = format!(
            "Improve the following {target} text to make it more natural, grammatically correct, and idiomatic. Only output the improved text, no explanations.\n\nText: {text}\n\nImproved:",
            target = target_lang,
            text = text
        );

        self.call_ollama(&prompt).await
    }

    async fn call_ollama(&self, prompt: &str) -> Result<String> {
        let request = OllamaRequest {
            model: self.model.clone(),
            prompt: prompt.to_string(),
            stream: false,
            temperature: 0.7,
        };

        let response = self
            .client
            .post(&self.ollama_url)
            .json(&request)
            .send()
            .await
            .context("Failed to connect to Ollama")?;

        if !response.status().is_success() {
            let status = response.status();
            let error = response.text().await.unwrap_or_default();
            anyhow::bail!("Ollama request failed: {} - {}", status, error);
        }

        let value: Value = response.json().await.context("Failed to parse Ollama response")?;
        
        let result = value
            .get("response")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .unwrap_or_default();

        Ok(result)
    }
}

impl Default for Translator {
    fn default() -> Self {
        Self::new()
    }
}

pub async fn translate(text: &str, direction: &str) -> Result<TranslationResult> {
    let translator = Translator::new();
    translator.translate(text, direction).await
}
