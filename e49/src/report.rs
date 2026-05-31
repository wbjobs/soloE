use crate::conflict::{ConflictReport, ConflictSeverity, SymbolConflict};
use crate::error::Result;
use std::fs::File;
use std::io::Write;
use std::path::Path;

pub struct ReportGenerator;

impl ReportGenerator {
    pub fn new() -> Self {
        ReportGenerator
    }

    pub fn generate_json(&self, report: &ConflictReport, output_path: &Path) -> Result<()> {
        let json = serde_json::to_string_pretty(report)?;
        let mut file = File::create(output_path)?;
        file.write_all(json.as_bytes())?;
        Ok(())
    }

    pub fn generate_html(&self, report: &ConflictReport, output_path: &Path) -> Result<()> {
        let html = self.generate_html_content(report);
        let mut file = File::create(output_path)?;
        file.write_all(html.as_bytes())?;
        Ok(())
    }

    pub fn print_summary(&self, report: &ConflictReport) {
        println!("\n{}", "=".repeat(60));
        println!("符号冲突分析报告");
        println!("{}", "=".repeat(60));
        println!("目标文件: {}", report.target_binary.display());
        println!("生成时间: {}", report.generated_at);
        println!("分析库数: {}", report.total_libraries);
        println!("总符号数: {}", report.total_symbols);
        println!("冲突总数: {}", report.total_conflicts);

        if report.total_conflicts > 0 {
            let high = report.conflicts.iter()
                .filter(|c| matches!(c.severity, ConflictSeverity::High))
                .count();
            let medium = report.conflicts.iter()
                .filter(|c| matches!(c.severity, ConflictSeverity::Medium))
                .count();
            let low = report.conflicts.iter()
                .filter(|c| matches!(c.severity, ConflictSeverity::Low))
                .count();

            println!("\n冲突严重程度:");
            println!("  高风险: {}", high);
            println!("  中风险: {}", medium);
            println!("  低风险: {}", low);

            println!("\n冲突详情:");
            for conflict in &report.conflicts {
                self.print_conflict(conflict);
            }
        } else {
            println!("\n✓ 未发现符号冲突!");
        }
        println!("{}", "=".repeat(60));
    }

    fn print_conflict(&self, conflict: &SymbolConflict) {
        let severity_str = match conflict.severity {
            ConflictSeverity::High => "高",
            ConflictSeverity::Medium => "中",
            ConflictSeverity::Low => "低",
        };

        let type_str = match conflict.symbol_type {
            crate::symbol::SymbolType::Function => "函数",
            crate::symbol::SymbolType::GlobalVariable => "全局变量",
            crate::symbol::SymbolType::WeakFunction => "弱函数",
            crate::symbol::SymbolType::WeakVariable => "弱变量",
            crate::symbol::SymbolType::Other => "其他",
        };

        let version_tag = if conflict.has_versioned_symbols { " [版本化]" } else { "" };
        
        println!("\n[{}风险] {} ({}){}", severity_str, conflict.base_name, type_str, version_tag);
        
        println!("  涉及库:");
        for symbol in &conflict.conflicting_symbols {
            let bind_type = if symbol.is_weak { "STB_WEAK" } else { "STB_GLOBAL" };
            let ver_info = if let Some(ref v) = symbol.version {
                format!(" [{}]", v)
            } else {
                "".to_string()
            };
            println!("    - {} ({}{})", symbol.library_name, bind_type, ver_info);
        }

        println!("  建议:");
        for suggestion in &conflict.suggestions {
            println!("    {}. {}", suggestion.priority, suggestion.description);
            println!("       操作: {}", suggestion.action);
        }
    }

    fn generate_html_content(&self, report: &ConflictReport) -> String {
        format!(r#"<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>符号冲突分析报告</title>
    <style>
        {{}}
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{ font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 1200px; margin: 0 auto; padding: 20px; background-color: #f5f5f5; }}
        .header {{ background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px; margin-bottom: 30px; }}
        .header h1 {{ font-size: 28px; margin-bottom: 15px; }}
        .stats {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 20px; margin: 20px 0; }}
        .stat-card {{ background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); text-align: center; }}
        .stat-value {{ font-size: 32px; font-weight: bold; color: #667eea; }}
        .stat-label {{ color: #666; margin-top: 5px; }}
        .severity-breakdown {{ display: flex; gap: 20px; justify-content: center; }}
        .severity-high {{ color: #e74c3c; }}
        .severity-medium {{ color: #f39c12; }}
        .severity-low {{ color: #27ae60; }}
        .conflicts {{ margin-top: 30px; }}
        .conflict-card {{ background: white; border-radius: 8px; padding: 20px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); border-left: 4px solid; }}
        .conflict-high {{ border-left-color: #e74c3c; }}
        .conflict-medium {{ border-left-color: #f39c12; }}
        .conflict-low {{ border-left-color: #27ae60; }}
        .conflict-header {{ display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }}
        .conflict-name {{ font-size: 20px; font-weight: bold; }}
        .conflict-badge {{ padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: bold; color: white; }}
        .badge-high {{ background-color: #e74c3c; }}
        .badge-medium {{ background-color: #f39c12; }}
        .badge-low {{ background-color: #27ae60; }}
        .libraries {{ background: #f8f9fa; padding: 15px; border-radius: 6px; margin-bottom: 15px; }}
        .library-item {{ padding: 8px 0; border-bottom: 1px solid #eee; }}
        .library-item:last-child {{ border-bottom: none; }}
        .suggestions {{}}
        .suggestion {{ padding: 10px; background: #e8f4fd; border-radius: 6px; margin-bottom: 10px; }}
        .suggestion-priority {{ font-weight: bold; color: #2980b9; }}
        .no-conflicts {{ background: #d4edda; color: #155724; padding: 30px; border-radius: 8px; text-align: center; font-size: 18px; }}
        .footer {{ margin-top: 40px; text-align: center; color: #666; padding: 20px; }}
    </style>
</head>
<body>
    <div class="header">
        <h1>🔍 符号冲突分析报告</h1>
        <p><strong>目标文件:</strong> {}</p>
        <p><strong>生成时间:</strong> {}</p>
    </div>

    <div class="stats">
        <div class="stat-card">
            <div class="stat-value">{}</div>
            <div class="stat-label">分析库数</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">{}</div>
            <div class="stat-label">总符号数</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">{}</div>
            <div class="stat-label">冲突总数</div>
        </div>
    </div>

    {}

    <div class="footer">
        <p>由 symconflict 生成 | 跨平台动态库符号冲突分析工具</p>
    </div>
</body>
</html>"#,
            report.target_binary.display(),
            report.generated_at,
            report.total_libraries,
            report.total_symbols,
            report.total_conflicts,
            self.generate_conflicts_html(report)
        )
    }

    fn generate_conflicts_html(&self, report: &ConflictReport) -> String {
        if report.total_conflicts == 0 {
            return r#"
            <div class="no-conflicts">
                ✓ 未发现符号冲突! 所有符号定义一致。
            </div>
            "#.to_string();
        }

        let high = report.conflicts.iter()
            .filter(|c| matches!(c.severity, ConflictSeverity::High))
            .count();
        let medium = report.conflicts.iter()
            .filter(|c| matches!(c.severity, ConflictSeverity::Medium))
            .count();
        let low = report.conflicts.iter()
            .filter(|c| matches!(c.severity, ConflictSeverity::Low))
            .count();

        let severity_html = format!(r#"
        <div class="severity-breakdown">
            <div class="stat-card">
                <div class="stat-value severity-high">{}</div>
                <div class="stat-label">高风险</div>
            </div>
            <div class="stat-card">
                <div class="stat-value severity-medium">{}</div>
                <div class="stat-label">中风险</div>
            </div>
            <div class="stat-card">
                <div class="stat-value severity-low">{}</div>
                <div class="stat-label">低风险</div>
            </div>
        </div>
        "#, high, medium, low);

        let conflicts_html: Vec<String> = report.conflicts.iter()
            .map(|c| self.generate_conflict_html(c))
            .collect();

        format!(r#"
        {}
        <div class="conflicts">
            <h2 style="margin-bottom: 20px;">冲突详情</h2>
            {}
        </div>
        "#, severity_html, conflicts_html.join(""))
    }

    fn generate_conflict_html(&self, conflict: &SymbolConflict) -> String {
        let (badge_class, card_class) = match conflict.severity {
            ConflictSeverity::High => ("badge-high", "conflict-high"),
            ConflictSeverity::Medium => ("badge-medium", "conflict-medium"),
            ConflictSeverity::Low => ("badge-low", "conflict-low"),
        };

        let severity_str = match conflict.severity {
            ConflictSeverity::High => "高风险",
            ConflictSeverity::Medium => "中风险",
            ConflictSeverity::Low => "低风险",
        };

        let type_str = match conflict.symbol_type {
            crate::symbol::SymbolType::Function => "函数",
            crate::symbol::SymbolType::GlobalVariable => "全局变量",
            crate::symbol::SymbolType::WeakFunction => "弱函数",
            crate::symbol::SymbolType::WeakVariable => "弱变量",
            crate::symbol::SymbolType::Other => "其他",
        };

        let libraries_html: Vec<String> = conflict.conflicting_symbols.iter()
            .map(|s| format!(r#"
                <div class="library-item">
                    <strong>{}</strong> - {}
                </div>
            "#, s.library_name, if s.is_weak { "弱符号" } else { "强符号" }))
            .collect();

        let suggestions_html: Vec<String> = conflict.suggestions.iter()
            .map(|s| format!(r#"
                <div class="suggestion">
                    <span class="suggestion-priority">建议{}:</span>
                    <p><strong>{}</strong></p>
                    <p style="margin-top: 5px; color: #555;">{}</p>
                </div>
            "#, s.priority, s.description, s.action))
            .collect();

        format!(r#"
            <div class="conflict-card {}">
                <div class="conflict-header">
                    <div class="conflict-name">{} <span style="font-size: 14px; color: #666;">({})</span></div>
                    <span class="conflict-badge {}">{}</span>
                </div>
                <div class="libraries">
                    <strong style="display: block; margin-bottom: 10px;">涉及库:</strong>
                    {}
                </div>
                <div class="suggestions">
                    <strong style="display: block; margin-bottom: 10px;">解决方案建议:</strong>
                    {}
                </div>
            </div>
        "#, card_class, conflict.symbol_name, type_str, badge_class, severity_str, libraries_html.join(""), suggestions_html.join(""))
    }
}
