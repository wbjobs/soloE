use crate::elf::{is_elf_file, ElfParser};
use crate::error::{Result, SymConflictError};
use crate::platform::{find_tool, run_command, Platform};
use regex::Regex;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum SymbolType {
    Function,
    GlobalVariable,
    WeakFunction,
    WeakVariable,
    Other,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Symbol {
    pub name: String,
    pub symbol_type: SymbolType,
    pub library: PathBuf,
    pub library_name: String,
    pub address: String,
    pub is_global: bool,
    pub is_weak: bool,
    pub version: Option<String>,
}

pub struct SymbolExtractor {
    platform: Platform,
    use_native_elf: bool,
}

impl SymbolExtractor {
    pub fn new() -> Self {
        SymbolExtractor {
            platform: Platform::current(),
            use_native_elf: true,
        }
    }

    pub fn with_native_elf(mut self, enable: bool) -> Self {
        self.use_native_elf = enable;
        self
    }

    pub fn extract_symbols(&self, library_path: &Path) -> Result<Vec<Symbol>> {
        if !library_path.exists() {
            return Err(SymConflictError::InvalidFile(format!(
                "File not found: {}",
                library_path.display()
            )));
        }

        match self.platform {
            Platform::Linux => {
                if self.use_native_elf && is_elf_file(library_path) {
                    match ElfParser::new(library_path) {
                        Ok(parser) => {
                            log::info!("Using native ELF parser for {}", library_path.display());
                            return parser.extract_dynamic_symbols(library_path);
                        }
                        Err(e) => {
                            log::warn!("Native ELF parsing failed: {}, falling back to nm", e);
                        }
                    }
                }
                self.extract_nm_symbols_with_versions(library_path)
            }
            Platform::MacOS => self.extract_nm_symbols_with_versions(library_path),
            Platform::Windows => self.extract_dumpbin_symbols(library_path),
        }
    }

    fn extract_nm_symbols_with_versions(&self, library_path: &Path) -> Result<Vec<Symbol>> {
        let nm = find_tool("nm")?;

        let args = vec!["-D", "-C", "--with-symbol-versions", library_path.to_str().unwrap()];

        let output = match run_command(&nm, &args) {
            Ok(out) => out,
            Err(_) => {
                log::warn!("nm --with-symbol-versions failed, trying basic mode");
                run_command(&nm, &["-D", "-C", library_path.to_str().unwrap()])?
            }
        };

        let re = Regex::new(r"([0-9a-fA-F]+)?\s+([a-zA-Z])\s+(.+)")?;
        let version_re = Regex::new(r"(.+?)(@[@\w\d\.]+)$")?;

        let mut symbols = Vec::new();
        let lib_name = library_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        for line in output.lines() {
            if let Some(cap) = re.captures(line) {
                let address = cap.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
                let symbol_char = cap[2].chars().next().unwrap();
                let raw_name = cap[3].trim().to_string();

                let (name, version) = if let Some(vcap) = version_re.captures(&raw_name) {
                    (vcap[1].to_string(), Some(vcap[2].to_string()))
                } else {
                    (raw_name, None)
                };

                let (is_global, is_weak, symbol_type) = self.classify_nm_symbol(symbol_char);

                if !name.is_empty() && !name.starts_with("__cxa") && !name.starts_with("__gxx") {
                    let full_name = if let Some(ref ver) = version {
                        format!("{}{}", name, ver)
                    } else {
                        name.clone()
                    };

                    symbols.push(Symbol {
                        name: full_name,
                        symbol_type,
                        library: library_path.to_path_buf(),
                        library_name: lib_name.clone(),
                        address,
                        is_global,
                        is_weak,
                        version,
                    });
                }
            }
        }

        if symbols.is_empty() {
            log::warn!("No symbols extracted with nm, trying readelf fallback");
            if let Ok(readelf_symbols) = self.extract_readelf_symbols(library_path) {
                if !readelf_symbols.is_empty() {
                    return Ok(readelf_symbols);
                }
            }
        }

        Ok(symbols)
    }

    fn extract_readelf_symbols(&self, library_path: &Path) -> Result<Vec<Symbol>> {
        let readelf = match find_tool("readelf") {
            Ok(path) => path,
            Err(_) => return Ok(Vec::new()),
        };

        let output = run_command(&readelf, &["-s", "-W", library_path.to_str().unwrap()])?;
        let mut symbols = Vec::new();
        let lib_name = library_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        let re = Regex::new(r"\s+\d+:\s+([0-9a-fA-F]+)\s+\d+\s+([A-Za-z]+)\s+([A-Za-z]+)\s+[A-Za-z]+\s+\d+\s+(.+)")?;

        for line in output.lines() {
            if let Some(cap) = re.captures(line) {
                let address = cap[1].to_string();
                let bind_type = &cap[2].to_uppercase();
                let symbol_type_str = &cap[3].to_uppercase();
                let name = cap[4].trim().to_string();

                if name.is_empty() || name.starts_with("__cxa") || name.starts_with("__gxx") {
                    continue;
                }

                let is_weak = bind_type == "WEAK";
                let is_global = bind_type == "GLOBAL" || bind_type == "WEAK";

                let symbol_type = match symbol_type_str.as_str() {
                    "FUNC" => {
                        if is_weak {
                            SymbolType::WeakFunction
                        } else {
                            SymbolType::Function
                        }
                    }
                    "OBJECT" | "NOTYPE" => {
                        if is_weak {
                            SymbolType::WeakVariable
                        } else {
                            SymbolType::GlobalVariable
                        }
                    }
                    _ => SymbolType::Other,
                };

                symbols.push(Symbol {
                    name,
                    symbol_type,
                    library: library_path.to_path_buf(),
                    library_name: lib_name.clone(),
                    address,
                    is_global,
                    is_weak,
                    version: None,
                });
            }
        }

        Ok(symbols)
    }

    fn classify_nm_symbol(&self, c: char) -> (bool, bool, SymbolType) {
        match c {
            'T' => (true, false, SymbolType::Function),
            't' => (false, false, SymbolType::Function),
            'D' => (true, false, SymbolType::GlobalVariable),
            'd' => (false, false, SymbolType::GlobalVariable),
            'B' => (true, false, SymbolType::GlobalVariable),
            'b' => (false, false, SymbolType::GlobalVariable),
            'R' => (true, false, SymbolType::GlobalVariable),
            'r' => (false, false, SymbolType::GlobalVariable),
            'W' => (true, true, SymbolType::WeakFunction),
            'w' => (false, true, SymbolType::WeakFunction),
            'V' => (true, true, SymbolType::WeakVariable),
            'v' => (false, true, SymbolType::WeakVariable),
            'U' => (false, false, SymbolType::Other),
            _ => (false, false, SymbolType::Other),
        }
    }

    fn extract_dumpbin_symbols(&self, library_path: &Path) -> Result<Vec<Symbol>> {
        let dumpbin = find_tool("dumpbin")?;
        let output = run_command(&dumpbin, &["/exports", library_path.to_str().unwrap()])?;

        let re = Regex::new(r"\s+(\d+)\s+([0-9A-Fa-f]+)\s+([0-9A-Fa-f]+)\s+(\S+)")?;
        let mut symbols = Vec::new();

        let lib_name = library_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        for cap in re.captures_iter(&output) {
            let address = cap[3].to_string();
            let name = cap[4].trim().to_string();

            if !name.is_empty() {
                symbols.push(Symbol {
                    name: name.clone(),
                    symbol_type: if name.contains('@') || name.starts_with('?') {
                        SymbolType::Function
                    } else {
                        SymbolType::Function
                    },
                    library: library_path.to_path_buf(),
                    library_name: lib_name.clone(),
                    address,
                    is_global: true,
                    is_weak: false,
                    version: None,
                });
            }
        }

        Ok(symbols)
    }
}
