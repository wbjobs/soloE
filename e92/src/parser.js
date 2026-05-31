const fs = require('fs');
const readline = require('readline');

class LogParser {
  constructor() {
    this.supportedServices = ['user-srv', 'order-srv', 'payment-srv'];
    this.spanIdCounter = 0;
  }

  parseLine(line) {
    try {
      const trimmed = line.trim();
      if (!trimmed) return null;
      
      let log;
      try {
        log = JSON.parse(trimmed);
      } catch (e) {
        return null;
      }

      if (log.scopeSpans && Array.isArray(log.scopeSpans)) {
        const results = [];
        for (const scopeSpan of log.scopeSpans) {
          if (scopeSpan.spans && Array.isArray(scopeSpan.spans)) {
            for (const span of scopeSpan.spans) {
              const otelLog = {
                ...log,
                ...span,
                scope: scopeSpan.scope,
                _isOtel: true
              };
              
              const traceId = this.extractTraceId(otelLog);
              if (!traceId) continue;

              const normalized = {
                traceId,
                spanId: this.extractSpanId(otelLog),
                parentSpanId: this.extractParentSpanId(otelLog),
                service: this.extractService(otelLog),
                timestamp: this.parseTimestamp(this.extractTimestamp(otelLog)),
                level: this.extractLevel(otelLog),
                message: span.name || this.extractMessage(otelLog),
                operation: span.name || this.extractOperation(otelLog),
                duration: this.extractDuration(otelLog),
                status: this.extractStatus(otelLog),
                kind: this.extractSpanKind(otelLog),
                attributes: { ...span.attributes, ...this.extractAttributes(otelLog) },
                raw: log
              };

              if (normalized.duration != null && (isNaN(normalized.duration) || normalized.duration < 0)) {
                normalized.duration = null;
              }

              results.push(normalized);
            }
          }
        }
        return results.length > 0 ? results : null;
      }

      const traceId = this.extractTraceId(log);
      if (!traceId) {
        return null;
      }

      const normalized = {
        traceId,
        spanId: this.extractSpanId(log),
        parentSpanId: this.extractParentSpanId(log),
        service: this.extractService(log),
        timestamp: this.parseTimestamp(this.extractTimestamp(log)),
        level: this.extractLevel(log),
        message: this.extractMessage(log),
        operation: this.extractOperation(log),
        duration: this.extractDuration(log),
        status: this.extractStatus(log),
        kind: this.extractSpanKind(log),
        attributes: this.extractAttributes(log),
        raw: log
      };

      if (normalized.duration != null && (isNaN(normalized.duration) || normalized.duration < 0)) {
        normalized.duration = null;
      }

      return normalized;
    } catch (e) {
      console.warn('Parse line warning:', e.message);
      return null;
    }
  }

  extractTraceId(log) {
    return log.traceId 
      || log.trace_id 
      || (log.resource && log.resource.attributes && log.resource.attributes['service.name']) && log.traceId
      || (log.scope && log.scope.name) && log.traceId
      || null;
  }

  extractSpanId(log) {
    let spanId = log.spanId 
      || log.span_id 
      || log.parentId
      || null;

    if (!spanId) {
      spanId = `auto-${Date.now()}-${this.spanIdCounter++}`;
    }

    return spanId;
  }

  extractParentSpanId(log) {
    return log.parentSpanId 
      || log.parent_span_id 
      || log.parentId
      || log.parent_spanId
      || null;
  }

  extractService(log) {
    return log.service 
      || log.serviceName 
      || log.service_name
      || (log.resource && log.resource.attributes && log.resource.attributes['service.name'])
      || (log.resource && log.resource.attributes && log.resource.attributes['service.name'])
      || (log.host && log.host.name)
      || 'unknown';
  }

  extractTimestamp(log) {
    return log.timestamp 
      || log.time 
      || log.ts
      || log.startTime
      || log.start_time
      || log.startTimeUnixNano
      || Date.now();
  }

  parseTimestamp(ts) {
    if (ts == null) return Date.now();

    if (typeof ts === 'number') {
      if (ts > 1e18) {
        return Math.floor(ts / 1e6);
      }
      if (ts > 1e15) {
        return Math.floor(ts / 1e3);
      }
      if (ts < 1e12) {
        return ts * 1000;
      }
      return ts;
    }

    if (typeof ts === 'string') {
      if (/^\d+$/.test(ts)) {
        const numTs = Number(ts);
        return this.parseTimestamp(numTs);
      }
      const parsed = Date.parse(ts);
      if (!isNaN(parsed)) {
        return parsed;
      }
    }

    return Date.now();
  }

  extractLevel(log) {
    return log.level 
      || log.severity 
      || log.severityText
      || (log.status && log.status.code === 2 ? 'error' : 'info')
      || 'info';
  }

  extractMessage(log) {
    return log.message 
      || log.msg 
      || log.body
      || (log.events && log.events[0] && log.events[0].name)
      || '';
  }

  extractOperation(log) {
    return log.operation 
      || log.method 
      || log.event
      || log.name
      || (log.http && log.http.method && log.http.route && `${log.http.method} ${log.http.route}`)
      || (log.http && log.http.method && log.http.url && `${log.http.method} ${log.http.url.split('?')[0]}`)
      || 'unknown';
  }

  extractDuration(log) {
    let duration = log.duration;
    
    if (duration == null) {
      duration = log.durationMs;
    }
    
    if (duration == null && log.endTime && log.startTime) {
      const end = this.parseTimestamp(log.endTime);
      const start = this.parseTimestamp(log.startTime);
      duration = end - start;
    }
    
    if (duration == null && log.endTimeUnixNano && log.startTimeUnixNano) {
      duration = (log.endTimeUnixNano - log.startTimeUnixNano) / 1e6;
    }

    if (typeof duration === 'string') {
      if (/^\d+(\.\d+)?$/.test(duration)) {
        duration = Number(duration);
      } else if (duration.endsWith('ms')) {
        duration = Number(duration.replace('ms', ''));
      } else if (duration.endsWith('s')) {
        duration = Number(duration.replace('s', '')) * 1000;
      } else if (duration.endsWith('μs') || duration.endsWith('us')) {
        duration = Number(duration.replace(/μs|us/g, '')) / 1000;
      } else if (duration.endsWith('ns')) {
        duration = Number(duration.replace('ns', '')) / 1e6;
      }
    }

    if (duration != null && !isNaN(duration) && isFinite(duration)) {
      return Math.max(0, Number(duration));
    }

    return null;
  }

  extractStatus(log) {
    if (log.status) {
      if (typeof log.status === 'string') {
        return log.status.toLowerCase();
      }
      if (log.status.code != null) {
        return log.status.code === 0 || log.status.code === 1 ? 'success' : 'error';
      }
      if (log.status.message) {
        return log.status.message.toLowerCase();
      }
    }
    
    if (log.success != null) {
      return log.success ? 'success' : 'error';
    }
    
    if (log.error || log.level === 'error' || log.severity === 'error') {
      return 'error';
    }
    
    return null;
  }

  extractSpanKind(log) {
    return log.kind 
      || log.spanKind 
      || log.span_kind
      || 'internal';
  }

  extractAttributes(log) {
    const attrs = {};
    
    if (log.attributes) {
      Object.assign(attrs, log.attributes);
    }
    
    if (log.http) {
      attrs.http = log.http;
    }
    
    if (log.db) {
      attrs.db = log.db;
    }
    
    if (log.messaging) {
      attrs.messaging = log.messaging;
    }
    
    return attrs;
  }

  async parseFile(filePath, onProgress) {
    const logs = [];
    let lineCount = 0;
    let parsedCount = 0;
    
    const fileStream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 });
    
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    for await (const line of rl) {
      lineCount++;
      const parsed = this.parseLine(line);
      if (parsed) {
        if (Array.isArray(parsed)) {
          logs.push(...parsed);
          parsedCount += parsed.length;
        } else {
          logs.push(parsed);
          parsedCount++;
        }
      }
      
      if (onProgress && lineCount % 10000 === 0) {
        onProgress({ lineCount, parsedCount });
      }
    }

    if (logs.length > 1) {
      this.ensureSpanLinks(logs);
    }

    return { logs, lineCount, parsedCount };
  }

  ensureSpanLinks(logs) {
    const spanMap = new Map();
    const rootSpans = [];

    for (const log of logs) {
      if (!spanMap.has(log.spanId)) {
        spanMap.set(log.spanId, log);
      }
    }

    for (const log of logs) {
      if (log.parentSpanId && spanMap.has(log.parentSpanId)) {
        const parent = spanMap.get(log.parentSpanId);
        if (!parent.children) {
          parent.children = [];
        }
        if (!parent.children.includes(log)) {
          parent.children.push(log);
        }
      } else if (!log.parentSpanId) {
        rootSpans.push(log);
      }
    }

    const tracesByTraceId = new Map();
    for (const log of logs) {
      if (!tracesByTraceId.has(log.traceId)) {
        tracesByTraceId.set(log.traceId, []);
      }
      tracesByTraceId.get(log.traceId).push(log);
    }

    for (const [traceId, traceLogs] of tracesByTraceId) {
      const sorted = [...traceLogs].sort((a, b) => a.timestamp - b.timestamp);
      
      for (let i = 1; i < sorted.length; i++) {
        const current = sorted[i];
        if (!current.parentSpanId) {
          for (let j = i - 1; j >= 0; j--) {
            const prev = sorted[j];
            if (current.timestamp >= prev.timestamp) {
              if (!current.parentSpanId) {
                current.parentSpanId = prev.spanId;
                break;
              }
            }
          }
        }
      }
    }
  }

  async parseMultipleFiles(filePaths, onProgress) {
    const allLogs = [];
    let totalLines = 0;
    let totalParsed = 0;

    for (let i = 0; i < filePaths.length; i++) {
      const filePath = filePaths[i];
      if (onProgress) {
        onProgress({ file: filePath, fileIndex: i, totalFiles: filePaths.length });
      }
      
      const result = await this.parseFile(filePath, (progress) => {
        if (onProgress) {
          onProgress({
            ...progress,
            file: filePath,
            fileIndex: i,
            totalFiles: filePaths.length
          });
        }
      });
      
      allLogs.push(...result.logs);
      totalLines += result.lineCount;
      totalParsed += result.parsedCount;
    }

    if (allLogs.length > 1) {
      this.ensureSpanLinks(allLogs);
    }

    return { logs: allLogs, totalLines, totalParsed };
  }

  parseString(content, onProgress) {
    const lines = content.split('\n');
    const logs = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const parsed = this.parseLine(line);
      if (parsed) {
        logs.push(parsed);
      }
      
      if (onProgress && i % 10000 === 0) {
        onProgress({ lineCount: i + 1, parsedCount: logs.length });
      }
    }

    if (logs.length > 1) {
      this.ensureSpanLinks(logs);
    }

    return { logs, lineCount: lines.length, parsedCount: logs.length };
  }

  parseChunk(chunk, buffer = '') {
    const lines = [];
    const combined = buffer + chunk;
    let lastNewLine = combined.lastIndexOf('\n');
    
    if (lastNewLine === -1) {
      return { lines: [], remaining: combined };
    }
    
    const toProcess = combined.substring(0, lastNewLine);
    const remaining = combined.substring(lastNewLine + 1);
    
    const splitLines = toProcess.split('\n');
    for (const line of splitLines) {
      if (line.trim()) {
        lines.push(line);
      }
    }
    
    return { lines, remaining };
  }
}

module.exports = LogParser;
