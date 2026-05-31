#!/usr/bin/env node

const { Command } = require('commander');
const LogParser = require('./parser');
const TraceAnalyzer = require('./traceAnalyzer');
const FlameGraphGenerator = require('./flameGraph');
const PlantUMLGenerator = require('./plantUMLGenerator');

const program = new Command();

program
  .name('log-analyzer')
  .description('分布式系统日志分析工具')
  .version('1.2.0');

program
  .command('analyze')
  .description('分析日志文件并生成火焰图')
  .option('-f, --file <path>', '日志文件路径（支持多个文件，用逗号分隔）')
  .option('-o, --output <path>', '输出 HTML 文件路径', 'flame.html')
  .option('-t, --trace <traceId>', '只分析指定的 traceId')
  .action(async (options) => {
    try {
      const files = options.file.split(',').map(f => f.trim());
      
      console.log(`📂 正在解析日志文件: ${files.join(', ')}`);
      
      const parser = new LogParser();
      const result = await parser.parseMultipleFiles(files);
      const logs = result.logs;
      
      console.log(`✅ 解析完成，共找到 ${logs.length} 条日志`);
      
      const analyzer = new TraceAnalyzer();
      let traces = analyzer.analyzeAll(logs);
      
      if (options.trace) {
        traces = traces.filter(t => t.traceId === options.trace);
        if (traces.length === 0) {
          console.log(`❌ 未找到 traceId: ${options.trace}`);
          process.exit(1);
        }
      }
      
      console.log(`🔍 识别到 ${traces.length} 条调用链`);
      
      traces.forEach((trace, i) => {
        console.log(`  ${i + 1}. ${trace.traceId} - ${trace.totalDuration}ms - ${trace.services.join(', ')}`);
      });
      
      const generator = new FlameGraphGenerator();
      const html = generator.generateMultiTraceHTML(traces);
      generator.saveToFile(html, options.output);
      
      console.log(`🎉 火焰图已生成: ${options.output}`);
      console.log(`💡 用浏览器打开 ${options.output} 查看分析结果`);
      
    } catch (error) {
      console.error('❌ 分析失败:', error.message);
      process.exit(1);
    }
  });

program
  .command('list')
  .description('列出所有调用链')
  .option('-f, --file <path>', '日志文件路径（支持多个文件，用逗号分隔）')
  .action(async (options) => {
    try {
      const files = options.file.split(',').map(f => f.trim());
      
      const parser = new LogParser();
      const result = await parser.parseMultipleFiles(files);
      const logs = result.logs;
      
      const analyzer = new TraceAnalyzer();
      const traces = analyzer.analyzeAll(logs);
      
      console.log(`\n📊 找到 ${traces.length} 条调用链:\n`);
      
      traces
        .sort((a, b) => b.totalDuration - a.totalDuration)
        .forEach((trace, i) => {
          const errorInfo = trace.errorCount > 0 ? ` [${trace.errorCount} errors]` : '';
          console.log(`${String(i + 1).padStart(2)}. ${trace.traceId}`);
          console.log(`    耗时: ${trace.totalDuration}ms | 服务: ${trace.services.join(', ')} | 跨度: ${trace.spanCount}${errorInfo}`);
          console.log(`    开始: ${new Date(trace.startTime).toLocaleString()}`);
          console.log();
        });
      
    } catch (error) {
      console.error('❌ 分析失败:', error.message);
      process.exit(1);
    }
  });

program
  .command('compare')
  .description('对比两条调用链')
  .option('-f, --file <path>', '日志文件路径')
  .option('-t1, --trace1 <traceId>', '调用链 1 的 traceId')
  .option('-t2, --trace2 <traceId>', '调用链 2 的 traceId')
  .option('-o, --output <path>', '输出 HTML 文件路径', 'comparison.html')
  .action(async (options) => {
    try {
      const files = options.file.split(',').map(f => f.trim());
      
      const parser = new LogParser();
      const result = await parser.parseMultipleFiles(files);
      const logs = result.logs;
      
      const analyzer = new TraceAnalyzer();
      const traces = analyzer.analyzeAll(logs);
      
      const t1 = traces.find(t => t.traceId === options.trace1);
      const t2 = traces.find(t => t.traceId === options.trace2);
      
      if (!t1) {
        console.error(`❌ 未找到 trace1: ${options.trace1}`);
        process.exit(1);
      }
      if (!t2) {
        console.error(`❌ 未找到 trace2: ${options.trace2}`);
        process.exit(1);
      }
      
      const comparison = analyzer.compareTraces(t1, t2);
      
      console.log('\n⚖️  调用链对比结果:');
      console.log(`  Trace 1: ${comparison.trace1.traceId} - ${comparison.trace1.totalDuration}ms`);
      console.log(`  Trace 2: ${comparison.trace2.traceId} - ${comparison.trace2.totalDuration}ms`);
      console.log(`  差异: ${comparison.totalDiff > 0 ? '+' : ''}${comparison.totalDiff}ms (${comparison.totalDiff > 0 ? '+' : ''}${comparison.totalDiffPercent}%)`);
      console.log('\n  各阶段差异:');
      
      comparison.details.slice(0, 10).forEach(d => {
        const sign = d.diff > 0 ? '+' : '';
        console.log(`    ${d.key.substring(0, 50).padEnd(52)} ${d.duration1.toFixed(0).padStart(6)}ms → ${d.duration2.toFixed(0).padStart(6)}ms (${sign}${d.diff.toFixed(0)}ms, ${sign}${d.diffPercent}%)`);
      });
      
      const generator = new FlameGraphGenerator();
      const html = generator.generateMultiTraceHTML([t1, t2]);
      generator.saveToFile(html, options.output);
      
      console.log(`\n🎉 对比报告已生成: ${options.output}`);
      
    } catch (error) {
      console.error('❌ 对比失败:', error.message);
      process.exit(1);
    }
  });

program
  .command('stats')
  .description('显示服务统计信息')
  .option('-f, --file <path>', '日志文件路径')
  .action(async (options) => {
    try {
      const files = options.file.split(',').map(f => f.trim());
      
      const parser = new LogParser();
      const result = await parser.parseMultipleFiles(files);
      const logs = result.logs;
      
      const analyzer = new TraceAnalyzer();
      const traces = analyzer.analyzeAll(logs);
      const stats = analyzer.calculateServiceStats(traces);
      
      console.log('\n📈 服务统计:');
      console.log('─'.repeat(80));
      console.log('服务'.padEnd(16) + '调用次数'.padStart(10) + '总耗时(ms)'.padStart(14) + '平均耗时(ms)'.padStart(14) + '错误数'.padStart(10));
      console.log('─'.repeat(80));
      
      stats.forEach(s => {
        console.log(
          s.service.padEnd(16) +
          String(s.totalCalls).padStart(10) +
          String(s.totalDuration.toFixed(0)).padStart(14) +
          String(s.avgDuration.toFixed(0)).padStart(14) +
          String(s.errors).padStart(10)
        );
      });
      console.log();
      
    } catch (error) {
      console.error('❌ 统计失败:', error.message);
      process.exit(1);
    }
  });

program
  .command('anomaly')
  .description('检测异常节点并生成优化建议')
  .option('-f, --file <path>', '日志文件路径')
  .option('-t, --trace <traceId>', '只分析指定的 traceId')
  .option('--threshold <ms>', '异常阈值（毫秒）', '500')
  .action(async (options) => {
    try {
      const files = options.file.split(',').map(f => f.trim());
      const threshold = parseInt(options.threshold);
      
      const parser = new LogParser();
      const result = await parser.parseMultipleFiles(files);
      const logs = result.logs;
      
      const analyzer = new TraceAnalyzer();
      const traces = analyzer.analyzeAll(logs);
      const serviceStats = analyzer.calculateServiceStats(traces);
      
      let targetTraces = traces;
      if (options.trace) {
        targetTraces = traces.filter(t => t.traceId === options.trace);
        if (targetTraces.length === 0) {
          console.error(`❌ 未找到 traceId: ${options.trace}`);
          process.exit(1);
        }
      }
      
      console.log(`\n🔍 异常检测 (阈值: ${threshold}ms)\n`);
      
      let totalAnomalies = 0;
      let totalSuggestions = [];
      
      for (const trace of targetTraces) {
        const anomalyResult = analyzer.detectAnomalies(trace, { threshold });
        const suggestions = analyzer.generateOptimizationSuggestions(anomalyResult, serviceStats);
        
        totalAnomalies += anomalyResult.anomalyCount;
        totalSuggestions.push(...suggestions);
        
        if (anomalyResult.anomalies.length > 0 || anomalyResult.warnings.length > 0) {
          console.log(`📌 Trace: ${trace.traceId} (总耗时: ${trace.totalDuration.toFixed(0)}ms)`);
          
          anomalyResult.anomalies.forEach(anomaly => {
            const severityBadge = anomaly.severity === 'critical' ? '🔴' : anomaly.severity === 'high' ? '🟠' : '🟡';
            console.log(`  ${severityBadge}  ${anomaly.service} > ${anomaly.operation}: ${anomaly.duration.toFixed(0)}ms`);
          });
          
          anomalyResult.warnings.forEach(warning => {
            console.log(`  ⚠️   ${warning.service} > ${warning.operation}: 存在错误`);
          });
          
          console.log();
        }
      }
      
      if (totalSuggestions.length > 0) {
        console.log('\n💡 优化建议:\n');
        console.log('─'.repeat(80));
        
        const severityLabels = { critical: '立即优化', high: '优先优化', medium: '建议优化' };
        const severityEmoji = { critical: '🔴', high: '🟠', medium: '🟡' };
        
        totalSuggestions.forEach((s, i) => {
          const severity = s.severity || 'medium';
          console.log(`\n${i + 1}. ${severityEmoji[severity] || '⚪'} ${s.title}`);
          console.log(`   ${severityLabels[severity] || '建议优化'}: ${s.suggestion}`);
          if (s.operation) {
            console.log(`   节点: ${s.service} > ${s.operation}`);
          }
        });
      } else {
        console.log('\n✅ 没有发现异常，所有节点耗时均在正常范围内！');
      }
      
      console.log();
      
    } catch (error) {
      console.error('❌ 异常检测失败:', error.message);
      process.exit(1);
    }
  });

program
  .command('plantuml')
  .description('导出调用链为 PlantUML 时序图')
  .option('-f, --file <path>', '日志文件路径')
  .option('-t, --trace <traceId>', '只导出指定的 traceId')
  .option('-o, --output <path>', '输出 PlantUML 文件路径', 'sequence.puml')
  .option('--no-duration', '不显示耗时')
  .option('--no-error', '不显示错误标记')
  .option('--no-highlight', '不高亮慢节点')
  .action(async (options) => {
    try {
      const files = options.file.split(',').map(f => f.trim());
      
      const parser = new LogParser();
      const result = await parser.parseMultipleFiles(files);
      const logs = result.logs;
      
      const analyzer = new TraceAnalyzer();
      let traces = analyzer.analyzeAll(logs);
      
      if (options.trace) {
        traces = traces.filter(t => t.traceId === options.trace);
        if (traces.length === 0) {
          console.error(`❌ 未找到 traceId: ${options.trace}`);
          process.exit(1);
        }
      }
      
      const generator = new PlantUMLGenerator();
      const plantUML = generator.generateAllTracesDiagram(traces, {
        showDuration: options.duration !== false,
        showErrors: options.error !== false,
        highlightSlow: options.highlight !== false,
        slowThreshold: 500
      });
      
      generator.saveToFile(plantUML, options.output);
      
      console.log(`\n🎉 PlantUML 时序图已生成: ${options.output}`);
      console.log(`💡 可在 https://www.planttext.com/ 或使用 PlantUML 工具渲染`);
      console.log(`   或直接访问: http://www.plantuml.com/plantuml/uml/ 在线预览`);
      console.log();
      
    } catch (error) {
      console.error('❌ 生成 PlantUML 失败:', error.message);
      process.exit(1);
    }
  });

program.parse();
