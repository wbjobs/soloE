use anyhow::{Context, Result};
use image::RgbaImage;
use rusty_tesseract::{Args, Image};
use std::path::{Path, PathBuf};
use std::process::Command;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum OcrStatus {
    Ready,
    Initializing,
    TesseractNotFound,
    LanguagePackMissing { missing: Vec<String> },
    Downloading { package: String, progress: u32 },
    Error { message: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcrInitResult {
    pub success: bool,
    pub status: OcrStatus,
    pub message: String,
}

pub struct OcrEngine {
    args: Args,
    tesseract_path: Option<PathBuf>,
    pub status: OcrStatus,
}

impl OcrEngine {
    pub async fn new() -> Result<Self> {
        let mut engine = Self {
            args: Args::default(),
            tesseract_path: None,
            status: OcrStatus::Initializing,
        };
        
        match engine.initialize().await {
            Ok(_) => Ok(engine),
            Err(e) => {
                engine.status = OcrStatus::Error { message: e.to_string() };
                Err(e)
            }
        }
    }
    
    async fn initialize(&mut self) -> Result<()> {
        self.tesseract_path = self.find_tesseract().await;
        
        if self.tesseract_path.is_none() {
            self.status = OcrStatus::TesseractNotFound;
            anyhow::bail!("Tesseract OCR 未安装。请从 https://github.com/UB-Mannheim/tesseract/wiki 下载安装，或手动输入文本进行翻译。");
        }
        
        let required_langs = vec!["eng", "chi_sim"];
        let available_langs = self.get_available_languages()?;
        let missing: Vec<String> = required_langs
            .iter()
            .filter(|l| !available_langs.contains(&l.to_string()))
            .map(|l| l.to_string())
            .collect();
        
        if !missing.is_empty() {
            self.status = OcrStatus::LanguagePackMissing { missing: missing.clone() };
            let msg = format!(
                "缺少语言包: {}. 正在尝试自动下载...",
                missing.join(", ")
            );
            anyhow::bail!("{}", msg);
        }
        
        self.args.lang = "eng+chi_sim".to_string();
        self.args.oem = 1;
        self.args.psm = 6;
        self.status = OcrStatus::Ready;
        
        Ok(())
    }
    
    async fn find_tesseract(&self) -> Option<PathBuf> {
        if let Ok(output) = Command::new("where").arg("tesseract").output() {
            if output.status.success() {
                if let Ok(path_str) = String::from_utf8(output.stdout) {
                    let path = PathBuf::from(path_str.trim().lines().next().unwrap_or(""));
                    if path.exists() {
                        return Some(path);
                    }
                }
            }
        }
        
        let common_paths = vec![
            r"C:\Program Files\Tesseract-OCR\tesseract.exe",
            r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
        ];
        
        for p in common_paths {
            let path = PathBuf::from(p);
            if path.exists() {
                return Some(path);
            }
        }
        
        None
    }
    
    fn get_available_languages(&self) -> Result<Vec<String>> {
        let tesseract_path = self.tesseract_path.as_ref()
            .context("Tesseract not found")?;
            
        let output = Command::new(tesseract_path)
            .arg("--list-langs")
            .output()
            .context("Failed to execute tesseract")?;
            
        if !output.status.success() {
            anyhow::bail!("Failed to get language list");
        }
        
        let output_str = String::from_utf8_lossy(&output.stdout);
        let languages: Vec<String> = output_str
            .lines()
            .skip(1)
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect();
            
        Ok(languages)
    }
    
    pub async fn download_language_pack(&mut self, lang: &str) -> Result<()> {
        self.status = OcrStatus::Downloading {
            package: lang.to_string(),
            progress: 0,
        };
        
        let tessdata_path = self.get_tessdata_path()?;
        std::fs::create_dir_all(&tessdata_path).ok();
        
        let url = format!(
            "https://github.com/tesseract-ocr/tessdata/raw/main/{}.traineddata",
            lang
        );
        
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()?;
            
        let response = client.get(&url).send().await
            .with_context(|| format!("Failed to download language pack: {}", lang))?;
            
        if !response.status().is_success() {
            anyhow::bail!("Download failed with status: {}", response.status());
        }
        
        let total_size = response.content_length().unwrap_or(0);
        let mut downloaded = 0u64;
        let mut dest = std::fs::File::create(tessdata_path.join(format!("{}.traineddata", lang)))?;
        
        let mut stream = response.bytes_stream();
        while let Some(chunk) = futures::StreamExt::next(&mut stream).await {
            let chunk = chunk?;
            use std::io::Write;
            dest.write_all(&chunk)?;
            downloaded += chunk.len() as u64;
            if total_size > 0 {
                let progress = ((downloaded as f64 / total_size as f64) * 100.0) as u32;
                self.status = OcrStatus::Downloading {
                    package: lang.to_string(),
                    progress,
                };
            }
        }
        
        self.status = OcrStatus::Ready;
        Ok(())
    }
    
    fn get_tessdata_path(&self) -> Result<PathBuf> {
        let tesseract_path = self.tesseract_path.as_ref()
            .context("Tesseract not found")?;
            
        let parent = tesseract_path.parent()
            .context("Invalid tesseract path")?;
            
        Ok(parent.join("tessdata"))
    }
    
    pub async fn try_recover(&mut self) -> OcrInitResult {
        match self.initialize().await {
            Ok(_) => OcrInitResult {
                success: true,
                status: OcrStatus::Ready,
                message: "OCR 引擎初始化成功".to_string(),
            },
            Err(e) => {
                if let OcrStatus::LanguagePackMissing { missing } = &self.status {
                    for lang in missing.clone() {
                        if let Err(dl_err) = self.download_language_pack(&lang).await {
                            return OcrInitResult {
                                success: false,
                                status: OcrStatus::Error { message: dl_err.to_string() },
                                message: format!("下载语言包失败: {}", dl_err),
                            };
                        }
                    }
                    return match self.initialize().await {
                        Ok(_) => OcrInitResult {
                            success: true,
                            status: OcrStatus::Ready,
                            message: "语言包下载完成，OCR 已就绪".to_string(),
                        },
                        Err(e) => OcrInitResult {
                            success: false,
                            status: OcrStatus::Error { message: e.to_string() },
                            message: e.to_string(),
                        },
                    };
                }
                OcrInitResult {
                    success: false,
                    status: self.status.clone(),
                    message: e.to_string(),
                }
            }
        }
    }

    pub fn recognize(&self, image: &RgbaImage) -> Result<String> {
        if let OcrStatus::Ready = self.status {
        } else {
            anyhow::bail!("OCR 引擎未就绪");
        }
        
        let temp_path = Path::new("temp_ocr.png");
        image.save(temp_path).context("Failed to save temp image")?;
        
        let mut img = Image::from_path(temp_path).context("Failed to load image for OCR")?;
        if let Some(tess_path) = &self.tesseract_path {
            if let Some(parent) = tess_path.parent() {
                img.tesseract_cmd = tess_path.clone();
                let tessdata = parent.join("tessdata");
                if tessdata.exists() {
                    img.tessdata_dir = Some(tessdata);
                }
            }
        }
        
        let text = rusty_tesseract::image_to_string(&img, &self.args)
            .context("OCR recognition failed")?;
        
        let _ = std::fs::remove_file(temp_path);
        
        Ok(text.trim().to_string())
    }

    pub fn recognize_from_file(&self, path: &Path) -> Result<String> {
        if let OcrStatus::Ready = self.status {
        } else {
            anyhow::bail!("OCR 引擎未就绪");
        }
        
        let mut img = Image::from_path(path).context("Failed to load image")?;
        if let Some(tess_path) = &self.tesseract_path {
            if let Some(parent) = tess_path.parent() {
                img.tesseract_cmd = tess_path.clone();
                let tessdata = parent.join("tessdata");
                if tessdata.exists() {
                    img.tessdata_dir = Some(tessdata);
                }
            }
        }
        
        let text = rusty_tesseract::image_to_string(&img, &self.args)
            .context("OCR recognition failed")?;
        
        Ok(text.trim().to_string())
    }
    
    pub fn is_ready(&self) -> bool {
        matches!(self.status, OcrStatus::Ready)
    }
}
