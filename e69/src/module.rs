use crate::config::{Priority, ResourceLimits};
use crate::error::{Result, SchedulerError};
use dashmap::DashMap;
use std::path::Path;
use std::sync::Arc;
use wasmtime::{Engine, Module};
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct WasiModule {
    pub id: String,
    pub name: String,
    pub module: Arc<Module>,
    pub priority: Priority,
    pub limits: ResourceLimits,
    pub loaded_at: std::time::Instant,
}

pub struct ModuleManager {
    engine: Arc<Engine>,
    modules: DashMap<String, WasiModule>,
}

impl ModuleManager {
    pub fn new(engine: Arc<Engine>) -> Self {
        Self {
            engine,
            modules: DashMap::new(),
        }
    }

    pub fn load_module<P: AsRef<Path>>(
        &self,
        name: String,
        path: P,
        priority: Priority,
        limits: Option<ResourceLimits>,
    ) -> Result<String> {
        if self.modules.iter().any(|m| m.name == name) {
            return Err(SchedulerError::ModuleAlreadyExists(name));
        }

        let module = Module::from_file(&self.engine, path)?;
        let id = Uuid::new_v4().to_string();

        let wasi_module = WasiModule {
            id: id.clone(),
            name,
            module: Arc::new(module),
            priority,
            limits: limits.unwrap_or_default(),
            loaded_at: std::time::Instant::now(),
        };

        self.modules.insert(id.clone(), wasi_module);
        Ok(id)
    }

    pub fn unload_module(&self, module_id: &str) -> Result<()> {
        if self.modules.remove(module_id).is_none() {
            return Err(SchedulerError::ModuleNotFound(module_id.to_string()));
        }
        Ok(())
    }

    pub fn get_module(&self, module_id: &str) -> Result<WasiModule> {
        self.modules
            .get(module_id)
            .map(|m| m.clone())
            .ok_or_else(|| SchedulerError::ModuleNotFound(module_id.to_string()))
    }

    pub fn list_modules(&self) -> Vec<(String, String, Priority)> {
        self.modules
            .iter()
            .map(|m| (m.id.clone(), m.name.clone(), m.priority))
            .collect()
    }

    pub fn module_count(&self) -> usize {
        self.modules.len()
    }
}
