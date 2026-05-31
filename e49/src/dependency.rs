use crate::error::{Result, SymConflictError};
use crate::platform::{find_tool, run_command, Platform};
use regex::Regex;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LibraryInfo {
    pub path: PathBuf,
    pub name: String,
    pub dependencies: Vec<PathBuf>,
    pub load_order: usize,
}

pub struct DependencyResolver {
    platform: Platform,
    visited: Mutex<HashSet<PathBuf>>,
    libraries: Mutex<Vec<LibraryInfo>>,
    load_order: Mutex<usize>,
}

impl DependencyResolver {
    pub fn new() -> Self {
        DependencyResolver {
            platform: Platform::current(),
            visited: Mutex::new(HashSet::new()),
            libraries: Mutex::new(Vec::new()),
            load_order: Mutex::new(0),
        }
    }

    pub fn resolve(&self, binary_path: &Path) -> Result<Vec<LibraryInfo>> {
        if !binary_path.exists() {
            return Err(SymConflictError::InvalidFile(format!(
                "File not found: {}",
                binary_path.display()
            )));
        }

        let canonical_path = binary_path.canonicalize()?;
        self.resolve_recursive(&canonical_path)?;

        let libraries = self.libraries.lock().unwrap();
        Ok(libraries.clone())
    }

    fn resolve_recursive(&self, path: &Path) -> Result<()> {
        let path = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
        
        {
            let mut visited = self.visited.lock().unwrap();
            if visited.contains(&path) {
                return Ok(());
            }
            visited.insert(path.clone());
        }

        let dependencies = self.get_direct_dependencies(&path)?;
        
        let mut load_order = self.load_order.lock().unwrap();
        *load_order += 1;
        let current_load_order = *load_order;
        drop(load_order);

        let lib_info = LibraryInfo {
            path: path.clone(),
            name: path.file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default(),
            dependencies: dependencies.clone(),
            load_order: current_load_order,
        };

        {
            let mut libraries = self.libraries.lock().unwrap();
            libraries.push(lib_info);
        }

        for dep in dependencies {
            let dep_path = self.find_library(&dep)?;
            if dep_path.exists() {
                self.resolve_recursive(&dep_path)?;
            }
        }

        Ok(())
    }

    fn get_direct_dependencies(&self, path: &Path) -> Result<Vec<PathBuf>> {
        match self.platform {
            Platform::Linux => self.get_ldd_dependencies(path),
            Platform::MacOS => self.get_otool_dependencies(path),
            Platform::Windows => self.get_dumpbin_dependencies(path),
        }
    }

    fn get_ldd_dependencies(&self, path: &Path) -> Result<Vec<PathBuf>> {
        let ldd = find_tool("ldd")?;
        let output = run_command(&ldd, &[path.to_str().unwrap()])?;
        
        let re = Regex::new(r"\s*(\S+)\s*=>\s*(\S+)\s*\(0x[0-9a-f]+\)")?;
        let mut deps = Vec::new();

        for cap in re.captures_iter(&output) {
            let dep_path = PathBuf::from(&cap[2]);
            if dep_path.exists() {
                deps.push(dep_path);
            }
        }

        Ok(deps)
    }

    fn get_otool_dependencies(&self, path: &Path) -> Result<Vec<PathBuf>> {
        let otool = find_tool("otool")?;
        let output = run_command(&otool, &["-L", path.to_str().unwrap()])?;
        
        let re = Regex::new(r"\s+(\S+)\s+\(")?;
        let mut deps = Vec::new();

        for cap in re.captures_iter(&output) {
            let dep_path = PathBuf::from(&cap[1]);
            if dep_path.exists() && !dep_path.starts_with("/usr/lib/") && !dep_path.starts_with("/System/") {
                deps.push(dep_path);
            }
        }

        Ok(deps)
    }

    fn get_dumpbin_dependencies(&self, path: &Path) -> Result<Vec<PathBuf>> {
        let dumpbin = find_tool("dumpbin")?;
        let output = run_command(&dumpbin, &["/dependents", path.to_str().unwrap()])?;
        
        let re = Regex::new(r"([A-Za-z0-9_.-]+\.dll)")?;
        let mut deps = Vec::new();

        for cap in re.captures_iter(&output) {
            deps.push(PathBuf::from(&cap[1]));
        }

        Ok(deps)
    }

    fn find_library(&self, lib_name: &Path) -> Result<PathBuf> {
        if lib_name.is_absolute() && lib_name.exists() {
            return Ok(lib_name.to_path_buf());
        }

        if let Some(filename) = lib_name.file_name() {
            let search_paths = self.get_library_search_paths();
            for path in search_paths {
                let full_path = PathBuf::from(path).join(filename);
                if full_path.exists() {
                    return Ok(full_path);
                }
            }
        }

        Ok(lib_name.to_path_buf())
    }

    fn get_library_search_paths(&self) -> Vec<PathBuf> {
        let mut paths = Vec::new();

        if let Ok(ld_path) = std::env::var("LD_LIBRARY_PATH") {
            paths.extend(std::env::split_paths(&ld_path));
        }

        if let Ok(path) = std::env::var("PATH") {
            paths.extend(std::env::split_paths(&path));
        }

        paths.push(PathBuf::from("."));

        paths
    }
}
