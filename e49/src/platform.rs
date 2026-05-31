use crate::error::{Result, SymConflictError};
use std::path::Path;
use which::which;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    Linux,
    MacOS,
    Windows,
}

impl Platform {
    pub fn current() -> Self {
        if cfg!(target_os = "linux") {
            Platform::Linux
        } else if cfg!(target_os = "macos") {
            Platform::MacOS
        } else if cfg!(target_os = "windows") {
            Platform::Windows
        } else {
            panic!("Unsupported platform");
        }
    }

    pub fn dependency_tool(&self) -> &'static str {
        match self {
            Platform::Linux => "ldd",
            Platform::MacOS => "otool",
            Platform::Windows => "dumpbin",
        }
    }

    pub fn symbol_tool(&self) -> &'static str {
        match self {
            Platform::Linux => "nm",
            Platform::MacOS => "nm",
            Platform::Windows => "dumpbin",
        }
    }

    pub fn library_extensions(&self) -> &'static [&'static str] {
        match self {
            Platform::Linux => &[".so"],
            Platform::MacOS => &[".dylib", ".so"],
            Platform::Windows => &[".dll"],
        }
    }
}

pub fn find_tool(tool_name: &str) -> Result<String> {
    match which(tool_name) {
        Ok(path) => Ok(path.to_string_lossy().to_string()),
        Err(_) => {
            if cfg!(target_os = "windows") && tool_name == "dumpbin" {
                find_dumpbin()
            } else {
                Err(SymConflictError::ToolNotFound(tool_name.to_string()))
            }
        }
    }
}

fn find_dumpbin() -> Result<String> {
    let vs_where = r"C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe";
    if Path::new(vs_where).exists() {
        use std::process::Command;
        let output = Command::new(vs_where)
            .args(&["-latest", "-products", "*", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-property", "installationPath"])
            .output()?;
        
        if output.status.success() {
            let vs_path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let dumpbin_path = format!(r"{}\VC\Tools\MSVC\*\bin\Hostx64\x64\dumpbin.exe", vs_path);
            
            if let Ok(entries) = glob::glob(&dumpbin_path) {
                for entry in entries.flatten() {
                    if entry.exists() {
                        return Ok(entry.to_string_lossy().to_string());
                    }
                }
            }
        }
    }
    
    if let Ok(path) = which("llvm-nm") {
        return Ok(path.to_string_lossy().to_string());
    }
    
    Err(SymConflictError::ToolNotFound("dumpbin/llvm-nm".to_string()))
}

pub fn run_command(cmd: &str, args: &[&str]) -> Result<String> {
    use std::process::Command;
    
    let output = Command::new(cmd)
        .args(args)
        .output()?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(SymConflictError::CommandExecution(stderr));
    }
    
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}
