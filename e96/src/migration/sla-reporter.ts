import * as crypto from 'crypto';
import * as fs from 'fs-extra';
import { SLAReport, SLAMetric, MigrationProgress, Checkpoint, MigrationConfig } from '../types';

export class SLAReporter {
  private config: MigrationConfig;
  private tableMetrics: Map<string, {
    rowsPerSecond: number[];
    startTime: number;
    endTime?: number;
    totalRows: number;
    migratedRows: number;
    failedRows: number;
    validatedRows: number;
    validationFailedRows: number;
  }> = new Map();

  constructor(config: MigrationConfig) {
    this.config = config;
  }

  recordProgress(progress: MigrationProgress): void {
    let metrics = this.tableMetrics.get(progress.tableName);
    if (!metrics) {
      metrics = {
        rowsPerSecond: [],
        startTime: Date.now(),
        totalRows: progress.totalRows,
        migratedRows: 0,
        failedRows: 0,
        validatedRows: 0,
        validationFailedRows: 0
      };
      this.tableMetrics.set(progress.tableName, metrics);
    }

    metrics.rowsPerSecond.push(progress.rowsPerSecond);
    metrics.migratedRows = progress.migratedRows;
    metrics.failedRows = progress.failedRows;
    metrics.validatedRows = progress.validatedRows;
    metrics.validationFailedRows = progress.validationFailedRows;

    if (progress.status === 'completed' || progress.status === 'migrated') {
      metrics.endTime = Date.now();
    }
  }

  recordCheckpoint(checkpoint: Checkpoint): void {
    let metrics = this.tableMetrics.get(checkpoint.tableName);
    if (!metrics) {
      metrics = {
        rowsPerSecond: [],
        startTime: checkpoint.startTime,
        totalRows: 0,
        migratedRows: checkpoint.migratedRows,
        failedRows: checkpoint.failedRows,
        validatedRows: checkpoint.validatedRows,
        validationFailedRows: checkpoint.validationFailedRows
      };
      this.tableMetrics.set(checkpoint.tableName, metrics);
    }
    if (checkpoint.endTime) {
      metrics.endTime = checkpoint.endTime;
    }
  }

  calculateMetric(
    name: string,
    value: number,
    unit: string,
    target?: number,
    warningThreshold?: number,
    failThreshold?: number
  ): SLAMetric {
    let status: 'pass' | 'warning' | 'fail' = 'pass';
    
    if (failThreshold !== undefined && value <= failThreshold) {
      status = 'fail';
    } else if (warningThreshold !== undefined && value <= warningThreshold) {
      status = 'warning';
    } else if (target !== undefined && value < target) {
      status = 'warning';
    }

    return { name, value, unit, target, status };
  }

  generateReport(): SLAReport {
    const startTime = Math.min(...Array.from(this.tableMetrics.values()).map(m => m.startTime));
    const endTime = Date.now();
    
    const allMetrics = Array.from(this.tableMetrics.entries());
    const totalRows = allMetrics.reduce((sum, [_, m]) => sum + m.totalRows, 0);
    const totalMigratedRows = allMetrics.reduce((sum, [_, m]) => sum + m.migratedRows, 0);
    const totalFailedRows = allMetrics.reduce((sum, [_, m]) => sum + m.failedRows, 0);
    const totalValidatedRows = allMetrics.reduce((sum, [_, m]) => sum + m.validatedRows, 0);
    const totalValidationFailedRows = allMetrics.reduce((sum, [_, m]) => sum + m.validationFailedRows, 0);

    const totalElapsedTime = endTime - startTime;
    const avgRowsPerSecond = totalElapsedTime > 0 ? (totalMigratedRows * 1000) / totalElapsedTime : 0;

    const migrationSuccessRate = totalMigratedRows > 0 
      ? ((totalMigratedRows - totalFailedRows) / totalMigratedRows) * 100 
      : 100;
    
    const validationSuccessRate = totalValidatedRows > 0 
      ? ((totalValidatedRows - totalValidationFailedRows) / totalValidatedRows) * 100 
      : 100;

    const completedTables = allMetrics.filter(([_, m]) => m.endTime !== undefined).length;
    const tableCompletionRate = (completedTables / allMetrics.length) * 100;

    const metrics: SLAMetric[] = [
      this.calculateMetric('平均迁移速度', avgRowsPerSecond, '行/秒', 500, 200, 50),
      this.calculateMetric('迁移成功率', migrationSuccessRate, '%', 99.9, 99, 95),
      this.calculateMetric('校验成功率', validationSuccessRate, '%', 99.99, 99.9, 99),
      this.calculateMetric('表完成率', tableCompletionRate, '%', 100, 95, 80),
      this.calculateMetric('总迁移行数', totalMigratedRows, '行'),
      this.calculateMetric('总失败行数', totalFailedRows, '行'),
      this.calculateMetric('总校验行数', totalValidatedRows, '行'),
      this.calculateMetric('校验失败行数', totalValidationFailedRows, '行'),
      this.calculateMetric('总耗时', totalElapsedTime / 1000, '秒')
    ];

    const tableMetrics = allMetrics.map(([tableName, m]) => {
      const elapsed = (m.endTime || Date.now()) - m.startTime;
      const avgRps = m.rowsPerSecond.length > 0
        ? m.rowsPerSecond.reduce((a, b) => a + b, 0) / m.rowsPerSecond.length
        : 0;
      const failureRate = m.migratedRows > 0 ? (m.failedRows / m.migratedRows) * 100 : 0;
      const validationRate = m.validatedRows > 0 
        ? ((m.validatedRows - m.validationFailedRows) / m.validatedRows) * 100 
        : 100;

      return {
        tableName,
        totalRows: m.totalRows,
        migratedRows: m.migratedRows,
        failedRows: m.failedRows,
        avgRowsPerSecond: avgRps,
        failureRate,
        validationRate,
        elapsedTime: elapsed
      };
    });

    const issues: Array<{ type: string; severity: 'high' | 'medium' | 'low'; message: string; tableName?: string }> = [];
    
    if (totalFailedRows > 0) {
      issues.push({
        type: 'migration_failure',
        severity: 'high',
        message: `存在 ${totalFailedRows} 行迁移失败`,
      });
    }
    
    if (totalValidationFailedRows > 0) {
      issues.push({
        type: 'validation_failure',
        severity: 'high',
        message: `存在 ${totalValidationFailedRows} 行数据校验不通过`,
      });
    }

    for (const [tableName, m] of allMetrics) {
      if (m.failedRows > 0) {
        issues.push({
          type: 'table_migration_failure',
          severity: 'medium',
          message: `表 ${tableName} 有 ${m.failedRows} 行迁移失败`,
          tableName
        });
      }
      if (m.validationFailedRows > 0) {
        issues.push({
          type: 'table_validation_failure',
          severity: 'medium',
          message: `表 ${tableName} 有 ${m.validationFailedRows} 行校验失败`,
          tableName
        });
      }
    }

    const recommendations: string[] = [];
    
    if (migrationSuccessRate < 99.9) {
      recommendations.push('建议检查迁移失败的行，查看具体错误原因后重试');
    }
    if (validationSuccessRate < 99.99) {
      recommendations.push('建议使用数据修复功能修复校验不通过的数据');
    }
    if (avgRowsPerSecond < 200) {
      recommendations.push('迁移速度较慢，建议：1) 增加 batchSize 2) 检查网络带宽 3) 优化数据库配置');
    }
    if (completedTables < allMetrics.length) {
      recommendations.push(`还有 ${allMetrics.length - completedTables} 个表未完成，请等待或检查是否有错误`);
    }

    return {
      reportId: crypto.randomUUID(),
      generatedAt: endTime,
      period: { startTime, endTime },
      summary: {
        totalTables: allMetrics.length,
        totalRows,
        totalMigratedRows,
        totalFailedRows,
        totalValidatedRows,
        totalValidationFailedRows
      },
      metrics,
      tableMetrics,
      issues,
      recommendations
    };
  }

  formatReport(report: SLAReport): string {
    let output = `\n${'='.repeat(60)}\n`;
    output += `           数据迁移 SLA 报告\n`;
    output += `${'='.repeat(60)}\n\n`;
    
    output += `报告ID: ${report.reportId}\n`;
    output += `生成时间: ${new Date(report.generatedAt).toLocaleString()}\n`;
    output += `统计周期: ${new Date(report.period.startTime).toLocaleString()} - ${new Date(report.period.endTime).toLocaleString()}\n\n`;
    
    output += `${'━'.repeat(60)}\n`;
    output += `【总体概览】\n`;
    output += `${'━'.repeat(60)}\n\n`;
    
    output += `  总表数: ${report.summary.totalTables}\n`;
    output += `  总行数: ${report.summary.totalRows.toLocaleString()}\n`;
    output += `  已迁移: ${report.summary.totalMigratedRows.toLocaleString()}\n`;
    output += `  迁移失败: ${report.summary.totalFailedRows.toLocaleString()}\n`;
    output += `  已校验: ${report.summary.totalValidatedRows.toLocaleString()}\n`;
    output += `  校验失败: ${report.summary.totalValidationFailedRows.toLocaleString()}\n\n`;
    
    output += `${'━'.repeat(60)}\n`;
    output += `【SLA 指标】\n`;
    output += `${'━'.repeat(60)}\n\n`;
    
    for (const metric of report.metrics) {
      const statusIcon = metric.status === 'pass' ? '✓' : metric.status === 'warning' ? '⚠' : '✗';
      const statusColor = metric.status === 'pass' ? 'GREEN' : metric.status === 'warning' ? 'YELLOW' : 'RED';
      const targetStr = metric.target !== undefined ? ` (目标: ${metric.target}${metric.unit})` : '';
      output += `  ${statusIcon} ${metric.name}: ${metric.value.toFixed(2)}${metric.unit}${targetStr} [${statusColor}]\n`;
    }
    
    output += `\n${'━'.repeat(60)}\n`;
    output += `【单表指标】\n`;
    output += `${'━'.repeat(60)}\n\n`;
    
    for (const tm of report.tableMetrics) {
      output += `  表名: ${tm.tableName}\n`;
      output += `    进度: ${tm.migratedRows.toLocaleString()}/${tm.totalRows.toLocaleString()} 行\n`;
      output += `    平均速度: ${tm.avgRowsPerSecond.toFixed(2)} 行/秒\n`;
      output += `    失败率: ${tm.failureRate.toFixed(4)}%\n`;
      output += `    校验通过率: ${tm.validationRate.toFixed(4)}%\n`;
      output += `    耗时: ${(tm.elapsedTime / 1000).toFixed(2)} 秒\n\n`;
    }
    
    if (report.issues.length > 0) {
      output += `${'━'.repeat(60)}\n`;
      output += `【问题列表】\n`;
      output += `${'━'.repeat(60)}\n\n`;
      
      for (const issue of report.issues) {
        const severityIcon = issue.severity === 'high' ? '🔴' : issue.severity === 'medium' ? '🟡' : '🟢';
        output += `  ${severityIcon} [${issue.severity.toUpperCase()}] ${issue.message}\n`;
      }
      output += '\n';
    }
    
    if (report.recommendations.length > 0) {
      output += `${'━'.repeat(60)}\n`;
      output += `【优化建议】\n`;
      output += `${'━'.repeat(60)}\n\n`;
      
      for (let i = 0; i < report.recommendations.length; i++) {
        output += `  ${i + 1}. ${report.recommendations[i]}\n`;
      }
      output += '\n';
    }
    
    output += `${'='.repeat(60)}\n`;
    
    return output;
  }

  async saveReport(report: SLAReport, filePath: string): Promise<void> {
    await fs.writeJson(filePath, report, { spaces: 2 });
    
    const textReport = this.formatReport(report);
    await fs.writeFile(filePath.replace('.json', '.txt'), textReport, 'utf-8');
  }
}
