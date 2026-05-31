use crate::error::Result;
use crate::symbol::{Symbol, SymbolType};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum ConflictSeverity {
    High,
    Medium,
    Low,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum BindingStrategy {
    Static,
    Dynamic,
    Lazy,
    Now,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ConflictSuggestion {
    pub priority: usize,
    pub description: String,
    pub action: String,
    pub selected_library: Option<PathBuf>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SymbolConflict {
    pub base_name: String,
    pub symbol_name: String,
    pub symbol_type: SymbolType,
    pub severity: ConflictSeverity,
    pub conflicting_symbols: Vec<Symbol>,
    pub suggestions: Vec<ConflictSuggestion>,
    pub has_versioned_symbols: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ConflictReport {
    pub total_libraries: usize,
    pub total_symbols: usize,
    pub total_conflicts: usize,
    pub conflicts: Vec<SymbolConflict>,
    pub generated_at: String,
    pub target_binary: PathBuf,
}

pub struct ConflictDetector {
    load_orders: HashMap<PathBuf, usize>,
    ignore_version: bool,
}

impl ConflictDetector {
    pub fn new() -> Self {
        ConflictDetector {
            load_orders: HashMap::new(),
            ignore_version: true,
        }
    }

    pub fn set_load_orders(&mut self, load_orders: HashMap<PathBuf, usize>) {
        self.load_orders = load_orders;
    }

    pub fn set_ignore_version(&mut self, ignore: bool) {
        self.ignore_version = ignore;
    }

    fn get_symbol_key(&self, symbol: &Symbol) -> String {
        if self.ignore_version {
            self.strip_version(&symbol.name)
        } else {
            symbol.name.clone()
        }
    }

    fn strip_version(&self, name: &str) -> String {
        if let Some(pos) = name.find('@') {
            name[..pos].to_string()
        } else {
            name.to_string()
        }
    }

    fn has_versioned_symbol(&self, symbols: &[Symbol]) -> bool {
        symbols.iter().any(|s| s.name.contains('@'))
    }

    pub fn detect_conflicts(&self, all_symbols: &[Symbol]) -> Result<Vec<SymbolConflict>> {
        let mut symbol_map: HashMap<String, Vec<Symbol>> = HashMap::new();

        for symbol in all_symbols {
            if symbol.is_global || symbol.is_weak {
                let key = self.get_symbol_key(symbol);
                symbol_map.entry(key).or_default().push(symbol.clone());
            }
        }

        let mut conflicts = Vec::new();

        for (base_name, symbols) in symbol_map {
            if symbols.len() > 1 {
                let unique_libs: std::collections::HashSet<_> = 
                    symbols.iter().map(|s| s.library.clone()).collect();
                
                if unique_libs.len() > 1 {
                    if !self.is_true_conflict(&symbols) {
                        continue;
                    }
                    
                    let conflict = self.analyze_conflict(base_name, symbols)?;
                    conflicts.push(conflict);
                }
            }
        }

        conflicts.sort_by(|a, b| {
            let severity_order = |s: &ConflictSeverity| match s {
                ConflictSeverity::High => 0,
                ConflictSeverity::Medium => 1,
                ConflictSeverity::Low => 2,
            };
            severity_order(&a.severity).cmp(&severity_order(&b.severity))
        });

        Ok(conflicts)
    }

    fn is_true_conflict(&self, symbols: &[Symbol]) -> bool {
        let non_weak_count = symbols.iter().filter(|s| !s.is_weak).count();

        if non_weak_count == 0 {
            return true;
        }

        if non_weak_count == 1 {
            return false;
        }

        let unique_versions: std::collections::HashSet<_> = symbols
            .iter()
            .filter(|s| !s.is_weak)
            .map(|s| s.version.as_ref().unwrap_or(&"".to_string()))
            .collect();

        if unique_versions.len() > 1 {
            return true;
        }

        true
    }

    fn analyze_conflict(&self, base_name: String, symbols: Vec<Symbol>) -> Result<SymbolConflict> {
        let symbol_type = symbols[0].symbol_type.clone();
        let symbol_name = symbols[0].name.clone();
        let has_versioned = self.has_versioned_symbol(&symbols);
        
        let severity = self.calculate_severity(&symbols, &symbol_type);
        let suggestions = self.generate_suggestions(&symbols, &symbol_type, has_versioned)?;

        Ok(SymbolConflict {
            base_name,
            symbol_name,
            symbol_type,
            severity,
            conflicting_symbols: symbols,
            suggestions,
            has_versioned_symbols: has_versioned,
        })
    }

    fn calculate_severity(&self, symbols: &[Symbol], symbol_type: &SymbolType) -> ConflictSeverity {
        let non_weak_count = symbols.iter().filter(|s| !s.is_weak).count();
        let unique_libs: std::collections::HashSet<_> = 
            symbols.iter().map(|s| s.library.clone()).collect();
        
        match symbol_type {
            SymbolType::GlobalVariable => {
                if non_weak_count > 1 && unique_libs.len() > 1 {
                    ConflictSeverity::High
                } else if non_weak_count == 1 {
                    ConflictSeverity::Low
                } else {
                    ConflictSeverity::Medium
                }
            }
            SymbolType::Function => {
                if non_weak_count > 1 && unique_libs.len() > 1 {
                    ConflictSeverity::Medium
                } else if non_weak_count == 1 {
                    ConflictSeverity::Low
                } else {
                    ConflictSeverity::Low
                }
            }
            SymbolType::WeakVariable => {
                if unique_libs.len() > 1 {
                    ConflictSeverity::Medium
                } else {
                    ConflictSeverity::Low
                }
            }
            SymbolType::WeakFunction => ConflictSeverity::Low,
            SymbolType::Other => ConflictSeverity::Low,
        }
    }

    fn generate_suggestions(&self, symbols: &[Symbol], symbol_type: &SymbolType, has_versioned: bool) -> Result<Vec<ConflictSuggestion>> {
        let mut suggestions = Vec::new();

        let non_weak_symbols: Vec<_> = symbols.iter().filter(|s| !s.is_weak).collect();
        
        if !non_weak_symbols.is_empty() {
            let mut sorted_by_load: Vec<_> = non_weak_symbols
                .iter()
                .map(|s| {
                    let order = self.load_orders.get(&s.library).copied().unwrap_or(usize::MAX);
                    (s, order)
                })
                .collect();
            sorted_by_load.sort_by_key(|&(_, order)| order);

            if let Some(&(first_symbol, load_order)) = sorted_by_load.first() {
                suggestions.push(ConflictSuggestion {
                    priority: 1,
                    description: "动态链接器符号解析：按加载顺序和绑定类型".to_string(),
                    action: if *load_order != usize::MAX {
                        format!("非弱符号将被优先使用，{} 最先加载", first_symbol.library_name)
                    } else {
                        format!("存在 {} 个非弱符号定义，加载顺序决定哪个被使用", non_weak_symbols.len())
                    },
                    selected_library: if *load_order != usize::MAX {
                        Some(first_symbol.library.clone())
                    } else {
                        None
                    },
                });
            }
        } else {
            suggestions.push(ConflictSuggestion {
                priority: 1,
                description: "所有符号都是弱符号（STB_WEAK）".to_string(),
                action: "链接器将选择任意一个定义，通常是最先加载的。这是正常行为，通常不会导致问题。".to_string(),
                selected_library: None,
            });
        }

        if has_versioned {
            suggestions.push(ConflictSuggestion {
                priority: 2,
                description: "检测到版本化符号（GNU版本脚本）".to_string(),
                action: "版本化符号可避免冲突。符号@VERSION表示特定版本，@@VERSION表示默认版本。冲突可能是不同库提供了相同基名但不同版本的符号。".to_string(),
                selected_library: None,
            });
        }

        match symbol_type {
            SymbolType::GlobalVariable => {
                if non_weak_symbols.len() > 1 {
                    suggestions.push(ConflictSuggestion {
                        priority: 3,
                        description: "⚠️ 高风险：多个非弱全局变量定义（STB_GLOBAL STT_OBJECT）".to_string(),
                        action: "这会导致严重问题！运行时所有库将共享同一个变量实例（来自最先加载的库），可能导致数据损坏和未定义行为。建议：1) 使用static关键字限制作用域；2) 使用命名空间；3) 使用RTLD_DEEPBIND（谨慎使用）。".to_string(),
                        selected_library: None,
                    });
                }
            }
            SymbolType::WeakVariable => {
                suggestions.push(ConflictSuggestion {
                    priority: 3,
                    description: "弱变量冲突（STB_WEAK STT_OBJECT）".to_string(),
                    action: "弱变量在链接时如果存在非弱定义会被覆盖。如果只有弱定义，行为取决于链接器。建议检查是否有库应该提供非弱定义。".to_string(),
                    selected_library: None,
                });
            }
            SymbolType::Function => {
                if non_weak_symbols.len() > 1 {
                    suggestions.push(ConflictSuggestion {
                        priority: 3,
                        description: "多个非弱函数定义（STB_GLOBAL STT_FUNC）".to_string(),
                        action: "运行时只会调用最先加载的库中的函数。如果函数签名或行为不同，可能导致崩溃或错误结果。建议使用版本脚本控制符号导出或重命名冲突函数。".to_string(),
                        selected_library: None,
                    });
                }
            }
            SymbolType::WeakFunction => {
                suggestions.push(ConflictSuggestion {
                    priority: 3,
                    description: "弱函数冲突（STB_WEAK STT_FUNC）".to_string(),
                    action: "这是插件模式的常见设计。主程序提供弱默认实现，插件可以提供强实现覆盖它。如果都是弱实现，请确认这是预期行为。".to_string(),
                    selected_library: None,
                });
            }
            _ => {}
        }

        Ok(suggestions)
    }
}
