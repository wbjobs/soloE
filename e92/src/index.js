const LogParser = require('./parser');
const TraceAnalyzer = require('./traceAnalyzer');
const FlameGraphGenerator = require('./flameGraph');
const PlantUMLGenerator = require('./plantUMLGenerator');

class LogAnalyzer {
  constructor() {
    this.parser = new LogParser();
    this.analyzer = new TraceAnalyzer();
    this.generator = new FlameGraphGenerator();
    this.plantUML = new PlantUMLGenerator();
  }

  async analyzeFiles(filePaths, options = {}) {
    const result = await this.parser.parseMultipleFiles(filePaths);
    const logs = result.logs;
    let traces = this.analyzer.analyzeAll(logs);
    
    if (options.traceId) {
      traces = traces.filter(t => t.traceId === options.traceId);
    }

    const serviceStats = this.analyzer.calculateServiceStats(traces);

    return {
      totalLogs: logs.length,
      totalTraces: traces.length,
      traces,
      serviceStats
    };
  }

  async generateFlameGraph(filePaths, outputPath, options = {}) {
    const result = await this.analyzeFiles(filePaths, options);
    const html = this.generator.generateMultiTraceHTML(result.traces);
    this.generator.saveToFile(html, outputPath);
    return outputPath;
  }

  async compareTraces(filePaths, traceId1, traceId2, outputPath) {
    const result = await this.analyzeFiles(filePaths);
    
    const t1 = result.traces.find(t => t.traceId === traceId1);
    const t2 = result.traces.find(t => t.traceId === traceId2);

    if (!t1 || !t2) {
      throw new Error('未找到指定的 traceId');
    }

    const comparison = this.analyzer.compareTraces(t1, t2);
    
    if (outputPath) {
      const html = this.generator.generateMultiTraceHTML([t1, t2]);
      this.generator.saveToFile(html, outputPath);
    }

    return comparison;
  }

  detectAnomalies(trace, options = {}) {
    return this.analyzer.detectAnomalies(trace, options);
  }

  generateOptimizationSuggestions(anomalyResult, serviceStats) {
    return this.analyzer.generateOptimizationSuggestions(anomalyResult, serviceStats);
  }

  async generateSequenceDiagram(filePaths, outputPath, options = {}) {
    const result = await this.analyzeFiles(filePaths, options);
    const plantUML = this.plantUML.generateAllTracesDiagram(result.traces, options);
    this.plantUML.saveToFile(plantUML, outputPath);
    return { plantUML, outputPath };
  }
}

module.exports = {
  LogAnalyzer,
  LogParser,
  TraceAnalyzer,
  FlameGraphGenerator,
  PlantUMLGenerator
};
