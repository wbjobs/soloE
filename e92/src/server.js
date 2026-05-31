const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const LogParser = require('./parser');
const TraceAnalyzer = require('./traceAnalyzer');
const FlameGraphGenerator = require('./flameGraph');
const PlantUMLGenerator = require('./plantUMLGenerator');

const app = express();
const port = process.env.PORT || 3000;

const uploadDir = path.join(os.tmpdir(), 'log-analyzer-uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 500 * 1024 * 1024
  }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '50mb' }));

const cleanupOldFiles = () => {
  const now = Date.now();
  const maxAge = 60 * 60 * 1000;
  
  try {
    const files = fs.readdirSync(uploadDir);
    for (const file of files) {
      const filePath = path.join(uploadDir, file);
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > maxAge) {
        fs.unlinkSync(filePath);
      }
    }
  } catch (e) {
    console.warn('清理临时文件失败:', e.message);
  }
};

setInterval(cleanupOldFiles, 30 * 60 * 1000);

async function parseLogFileStream(filePath, onProgress) {
  const parser = new LogParser();
  const logs = [];
  let lineCount = 0;
  let parsedCount = 0;

  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 });
    let buffer = '';

    stream.on('data', (chunk) => {
      buffer += chunk.toString('utf-8');
      
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.substring(0, newlineIndex);
        buffer = buffer.substring(newlineIndex + 1);
        
        lineCount++;
        const parsed = parser.parseLine(line);
        if (parsed) {
          logs.push(parsed);
          parsedCount++;
        }
        
        if (onProgress && lineCount % 50000 === 0) {
          onProgress({ lineCount, parsedCount });
        }
      }
    });

    stream.on('end', () => {
      if (buffer.trim()) {
        lineCount++;
        const parsed = parser.parseLine(buffer);
        if (parsed) {
          logs.push(parsed);
          parsedCount++;
        }
      }

      if (logs.length > 1) {
        parser.ensureSpanLinks(logs);
      }

      resolve({ logs, lineCount, parsedCount });
    });

    stream.on('error', reject);
  });
}

async function analyzeLogsFromFiles(filePaths, onProgress) {
  const allLogs = [];
  let totalLines = 0;
  let totalParsed = 0;

  for (let i = 0; i < filePaths.length; i++) {
    const filePath = filePaths[i];
    
    if (onProgress) {
      onProgress({
        type: 'file',
        fileIndex: i,
        totalFiles: filePaths.length,
        fileName: path.basename(filePath)
      });
    }

    const result = await parseLogFileStream(filePath, (progress) => {
      if (onProgress) {
        onProgress({
          type: 'progress',
          fileIndex: i,
          totalFiles: filePaths.length,
          fileName: path.basename(filePath),
          ...progress
        });
      }
    });

    allLogs.push(...result.logs);
    totalLines += result.lineCount;
    totalParsed += result.parsedCount;
  }

  const analyzer = new TraceAnalyzer();
  const traces = analyzer.analyzeAll(allLogs);
  const serviceStats = analyzer.calculateServiceStats(traces);

  return {
    totalLogs: allLogs.length,
    totalLines,
    totalParsed,
    totalTraces: traces.length,
    traces,
    serviceStats
  };
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/api/analyze', upload.array('logs', 20), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: '请上传至少一个日志文件' });
    }

    const filePaths = req.files.map(f => f.path);
    
    const result = await analyzeLogsFromFiles(filePaths);

    const tracesSummary = result.traces.map(t => ({
      traceId: t.traceId,
      startTime: t.startTime,
      endTime: t.endTime,
      totalDuration: t.totalDuration,
      services: t.services,
      spanCount: t.spanCount,
      errorCount: t.errorCount
    }));

    res.json({
      success: true,
      totalLogs: result.totalLogs,
      totalLines: result.totalLines,
      totalParsed: result.totalParsed,
      totalTraces: result.totalTraces,
      traces: tracesSummary,
      serviceStats: result.serviceStats
    });

  } catch (error) {
    console.error('分析失败:', error);
    res.status(500).json({ error: '分析失败: ' + error.message });
  } finally {
    if (req.files) {
      req.files.forEach(f => {
        try {
          fs.unlinkSync(f.path);
        } catch (e) {}
      });
    }
  }
});

app.post('/api/analyze-stream', upload.array('logs', 20), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: '请上传至少一个日志文件' });
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    const filePaths = req.files.map(f => f.path);
    const result = await analyzeLogsFromFiles(filePaths, (progress) => {
      res.write(`data: ${JSON.stringify(progress)}\n\n`);
    });

    const tracesSummary = result.traces.map(t => ({
      traceId: t.traceId,
      startTime: t.startTime,
      endTime: t.endTime,
      totalDuration: t.totalDuration,
      services: t.services,
      spanCount: t.spanCount,
      errorCount: t.errorCount
    }));

    res.write(`data: ${JSON.stringify({
      type: 'complete',
      totalLogs: result.totalLogs,
      totalLines: result.totalLines,
      totalParsed: result.totalParsed,
      totalTraces: result.totalTraces,
      traces: tracesSummary,
      serviceStats: result.serviceStats
    })}\n\n`);
    
    res.end();

  } catch (error) {
    console.error('流式分析失败:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: '分析失败: ' + error.message });
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
      res.end();
    }
  } finally {
    if (req.files) {
      req.files.forEach(f => {
        try {
          fs.unlinkSync(f.path);
        } catch (e) {}
      });
    }
  }
});

app.post('/api/flamegraph', upload.array('logs', 20), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: '请上传至少一个日志文件' });
    }

    const filePaths = req.files.map(f => f.path);
    const result = await analyzeLogsFromFiles(filePaths);
    
    let traces = result.traces;
    const traceId = req.body.traceId;
    if (traceId) {
      traces = traces.filter(t => t.traceId === traceId);
      if (traces.length === 0) {
        return res.status(404).json({ error: '未找到指定的 traceId' });
      }
    }

    const generator = new FlameGraphGenerator();
    const html = generator.generateMultiTraceHTML(traces);

    res.setHeader('Content-Type', 'text/html');
    res.send(html);

  } catch (error) {
    console.error('生成火焰图失败:', error);
    res.status(500).json({ error: '生成火焰图失败: ' + error.message });
  } finally {
    if (req.files) {
      req.files.forEach(f => {
        try {
          fs.unlinkSync(f.path);
        } catch (e) {}
      });
    }
  }
});

app.post('/api/compare', upload.array('logs', 20), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: '请上传至少一个日志文件' });
    }

    const trace1 = req.body.trace1;
    const trace2 = req.body.trace2;

    if (!trace1 || !trace2) {
      return res.status(400).json({ error: '请指定要对比的两个 traceId' });
    }

    const filePaths = req.files.map(f => f.path);
    const result = await analyzeLogsFromFiles(filePaths);

    const t1 = result.traces.find(t => t.traceId === trace1);
    const t2 = result.traces.find(t => t.traceId === trace2);

    if (!t1) {
      return res.status(404).json({ error: `未找到 trace1: ${trace1}` });
    }
    if (!t2) {
      return res.status(404).json({ error: `未找到 trace2: ${trace2}` });
    }

    const analyzer = new TraceAnalyzer();
    const comparison = analyzer.compareTraces(t1, t2);

    res.json({
      success: true,
      comparison
    });

  } catch (error) {
    console.error('对比失败:', error);
    res.status(500).json({ error: '对比失败: ' + error.message });
  } finally {
    if (req.files) {
      req.files.forEach(f => {
        try {
          fs.unlinkSync(f.path);
        } catch (e) {}
      });
    }
  }
});

app.post('/api/chunk-upload', upload.single('chunk'), (req, res) => {
  try {
    const { chunkIndex, totalChunks, uploadId, fileName } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ error: '缺少分片数据' });
    }

    const chunkDir = path.join(uploadDir, `chunk-${uploadId}`);
    if (!fs.existsSync(chunkDir)) {
      fs.mkdirSync(chunkDir, { recursive: true });
    }

    const chunkPath = path.join(chunkDir, `chunk-${chunkIndex}`);
    fs.renameSync(req.file.path, chunkPath);

    const expectedChunks = Array.from({ length: Number(totalChunks) }, (_, i) => i);
    const existingChunks = fs.readdirSync(chunkDir)
      .filter(f => f.startsWith('chunk-'))
      .map(f => Number(f.replace('chunk-', '')))
      .sort((a, b) => a - b);

    const isComplete = existingChunks.length === Number(totalChunks) &&
      expectedChunks.every((c, i) => existingChunks[i] === c);

    if (isComplete) {
      const mergedPath = path.join(uploadDir, `${uploadId}-${fileName}`);
      const writeStream = fs.createWriteStream(mergedPath);
      
      for (let i = 0; i < Number(totalChunks); i++) {
        const chunkPath = path.join(chunkDir, `chunk-${i}`);
        const chunkData = fs.readFileSync(chunkPath);
        writeStream.write(chunkData);
        fs.unlinkSync(chunkPath);
      }
      
      writeStream.end();
      fs.rmdirSync(chunkDir, { recursive: true });

      res.json({
        success: true,
        complete: true,
        filePath: mergedPath
      });
    } else {
      res.json({
        success: true,
        complete: false,
        receivedChunks: existingChunks.length,
        totalChunks: Number(totalChunks)
      });
    }

  } catch (error) {
    console.error('分片上传失败:', error);
    res.status(500).json({ error: '分片上传失败: ' + error.message });
  }
});

app.post('/api/analyze-chunks', async (req, res) => {
  try {
    const { filePaths } = req.body;
    
    if (!filePaths || filePaths.length === 0) {
      return res.status(400).json({ error: '缺少文件路径' });
    }

    const validPaths = filePaths.filter(p => {
      const fullPath = path.join(uploadDir, path.basename(p));
      return fs.existsSync(fullPath);
    }).map(p => path.join(uploadDir, path.basename(p)));

    if (validPaths.length === 0) {
      return res.status(400).json({ error: '没有找到有效的文件' });
    }

    const result = await analyzeLogsFromFiles(validPaths);

    const tracesSummary = result.traces.map(t => ({
      traceId: t.traceId,
      startTime: t.startTime,
      endTime: t.endTime,
      totalDuration: t.totalDuration,
      services: t.services,
      spanCount: t.spanCount,
      errorCount: t.errorCount
    }));

    res.json({
      success: true,
      totalLogs: result.totalLogs,
      totalLines: result.totalLines,
      totalParsed: result.totalParsed,
      totalTraces: result.totalTraces,
      traces: tracesSummary,
      serviceStats: result.serviceStats
    });

  } catch (error) {
    console.error('分析分片文件失败:', error);
    res.status(500).json({ error: '分析失败: ' + error.message });
  }
});

app.post('/api/anomaly', upload.array('logs', 20), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: '请上传至少一个日志文件' });
    }

    const filePaths = req.files.map(f => f.path);
    const threshold = req.body.threshold ? parseInt(req.body.threshold) : 500;
    
    const result = await analyzeLogsFromFiles(filePaths);
    
    const analyzer = new TraceAnalyzer();
    const anomalyResults = [];
    const allSuggestions = [];

    for (const trace of result.traces) {
      const anomalyResult = analyzer.detectAnomalies(trace, { threshold });
      const suggestions = analyzer.generateOptimizationSuggestions(anomalyResult, result.serviceStats);
      
      if (anomalyResult.anomalyCount > 0 || anomalyResult.warningCount > 0) {
        anomalyResults.push(anomalyResult);
        allSuggestions.push(...suggestions);
      }
    }

    res.json({
      success: true,
      threshold,
      totalAnomalies: anomalyResults.reduce((sum, a) => sum + a.anomalyCount, 0),
      totalWarnings: anomalyResults.reduce((sum, a) => sum + a.warningCount, 0),
      anomalyResults,
      suggestions: allSuggestions.sort((a, b) => {
        const severityOrder = { critical: 0, high: 1, medium: 2 };
        return (severityOrder[a.severity] || 3) - (severityOrder[b.severity] || 3);
      })
    });

  } catch (error) {
    console.error('异常检测失败:', error);
    res.status(500).json({ error: '异常检测失败: ' + error.message });
  } finally {
    if (req.files) {
      req.files.forEach(f => {
        try { fs.unlinkSync(f.path); } catch (e) {}
      });
    }
  }
});

app.post('/api/plantuml', upload.array('logs', 20), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: '请上传至少一个日志文件' });
    }

    const filePaths = req.files.map(f => f.path);
    const traceId = req.body.traceId;
    
    const result = await analyzeLogsFromFiles(filePaths);
    
    let traces = result.traces;
    if (traceId) {
      traces = traces.filter(t => t.traceId === traceId);
      if (traces.length === 0) {
        return res.status(404).json({ error: '未找到指定的 traceId' });
      }
    }

    const generator = new PlantUMLGenerator();
    const plantUML = generator.generateAllTracesDiagram(traces, {
      showDuration: req.body.showDuration !== false,
      showErrors: req.body.showErrors !== false,
      highlightSlow: req.body.highlightSlow !== false,
      slowThreshold: parseInt(req.body.slowThreshold) || 500
    });

    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="sequence-${Date.now()}.puml"`);
    res.send(plantUML);

  } catch (error) {
    console.error('生成 PlantUML 失败:', error);
    res.status(500).json({ error: '生成 PlantUML 失败: ' + error.message });
  } finally {
    if (req.files) {
      req.files.forEach(f => {
        try { fs.unlinkSync(f.path); } catch (e) {}
      });
    }
  }
});

app.listen(port, () => {
  console.log(`🚀 日志分析 Web 服务已启动`);
  console.log(`📍 访问地址: http://localhost:${port}`);
  console.log();
  console.log('功能说明:');
  console.log('  • 支持大文件分片上传');
  console.log('  • 后端流式解析日志');
  console.log('  • 自动识别调用链（traceId）');
  console.log('  • 查看火焰图可视化');
  console.log('  • 对比两条调用链的性能差异');
  console.log('  • 异常检测和优化建议');
  console.log('  • 导出 PlantUML 时序图');
  console.log();
  console.log('支持的日志格式:');
  console.log('  • 标准 JSON 日志格式');
  console.log('  • OpenTelemetry 格式');
  console.log('  • 服务: user-srv, order-srv, payment-srv');
});

module.exports = app;
