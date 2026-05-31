class TraceAnalyzer {
  constructor() {}

  groupByTraceId(logs) {
    const traces = new Map();
    
    for (const log of logs) {
      if (!traces.has(log.traceId)) {
        traces.set(log.traceId, []);
      }
      traces.get(log.traceId).push(log);
    }

    const result = [];
    for (const [traceId, traceLogs] of traces) {
      const sorted = traceLogs.sort((a, b) => a.timestamp - b.timestamp);
      result.push({
        traceId,
        logs: sorted,
        startTime: sorted[0].timestamp,
        endTime: sorted[sorted.length - 1].timestamp
      });
    }

    return result.sort((a, b) => a.startTime - b.startTime);
  }

  buildSpans(traceLogs) {
    const spanMap = new Map();
    const spans = [];

    for (const log of traceLogs) {
      const spanId = log.spanId;
      
      if (!spanMap.has(spanId)) {
        spanMap.set(spanId, {
          spanId,
          parentSpanId: log.parentSpanId,
          traceId: log.traceId,
          service: log.service,
          operation: log.operation,
          start: log.timestamp,
          end: log.timestamp,
          duration: null,
          logs: [],
          status: log.status,
          level: log.level,
          kind: log.kind
        });
      }
      
      const span = spanMap.get(spanId);
      span.logs.push(log);
      
      if (log.timestamp < span.start) {
        span.start = log.timestamp;
      }
      if (log.timestamp > span.end) {
        span.end = log.timestamp;
      }
      
      if (log.duration != null && !isNaN(log.duration) && isFinite(log.duration)) {
        if (span.duration == null || log.duration > span.duration) {
          span.duration = Number(log.duration);
        }
      }
      
      if (log.status === 'error') {
        span.status = 'error';
      }
      if (log.level === 'error') {
        span.level = 'error';
      }
    }

    for (const span of spanMap.values()) {
      if (span.duration == null || isNaN(span.duration) || !isFinite(span.duration) || span.duration < 0) {
        const calculatedDuration = span.end - span.start;
        span.duration = Math.max(0, calculatedDuration);
      }
      
      if (span.duration === 0 && span.logs.length > 1) {
        span.duration = 1;
      }
      
      spans.push(span);
    }

    return this.buildSpanTree(spans);
  }

  buildSpanTree(spans) {
    const spanMap = new Map();
    const roots = [];

    for (const span of spans) {
      span.children = [];
      spanMap.set(span.spanId, span);
    }

    for (const span of spans) {
      if (span.parentSpanId && spanMap.has(span.parentSpanId)) {
        const parent = spanMap.get(span.parentSpanId);
        if (parent.spanId !== span.spanId) {
          parent.children.push(span);
        } else {
          roots.push(span);
        }
      } else {
        roots.push(span);
      }
    }

    const sortRecursive = (node) => {
      node.children.sort((a, b) => a.start - b.start);
      for (const child of node.children) {
        sortRecursive(child);
      }
    };

    for (const root of roots) {
      sortRecursive(root);
    }

    const fixDurationsRecursive = (node, parentEnd) => {
      if (node.children.length > 0) {
        let maxChildEnd = node.start;
        
        for (const child of node.children) {
          fixDurationsRecursive(child, node.end);
          if (child.end > maxChildEnd) {
            maxChildEnd = child.end;
          }
        }
        
        if (node.end < maxChildEnd) {
          node.end = maxChildEnd;
          const newDuration = node.end - node.start;
          if (node.duration == null || node.duration < newDuration) {
            node.duration = Math.max(0, newDuration);
          }
        }
      }
    };

    for (const root of roots) {
      fixDurationsRecursive(root, root.end);
    }

    return roots;
  }

  analyzeTrace(traceData) {
    const spans = this.buildSpans(traceData.logs);
    const totalDuration = traceData.endTime - traceData.startTime;

    const services = new Set();
    for (const log of traceData.logs) {
      services.add(log.service);
    }

    const errors = traceData.logs.filter(l => 
      l.level === 'error' || l.status === 'error'
    );

    return {
      traceId: traceData.traceId,
      startTime: traceData.startTime,
      endTime: traceData.endTime,
      totalDuration: Math.max(0, totalDuration),
      services: Array.from(services),
      spanCount: traceData.logs.length,
      errorCount: errors.length,
      spans,
      logs: traceData.logs
    };
  }

  analyzeAll(logs) {
    if (!logs || logs.length === 0) {
      return [];
    }
    
    const traces = this.groupByTraceId(logs);
    return traces.map(trace => this.analyzeTrace(trace));
  }

  calculateServiceStats(analyzedTraces) {
    const serviceStats = new Map();

    for (const trace of analyzedTraces) {
      const processSpans = (spans) => {
        for (const span of spans) {
          if (!serviceStats.has(span.service)) {
            serviceStats.set(span.service, {
              service: span.service,
              totalCalls: 0,
              totalDuration: 0,
              avgDuration: 0,
              errors: 0,
              minDuration: Infinity,
              maxDuration: 0
            });
          }
          const stats = serviceStats.get(span.service);
          stats.totalCalls++;
          
          const duration = Number(span.duration) || 0;
          stats.totalDuration += duration;
          
          if (duration < stats.minDuration) {
            stats.minDuration = duration;
          }
          if (duration > stats.maxDuration) {
            stats.maxDuration = duration;
          }
          
          if (span.status === 'error') {
            stats.errors++;
          }
          if (span.children.length > 0) {
            processSpans(span.children);
          }
        }
      };
      processSpans(trace.spans);
    }

    for (const stats of serviceStats.values()) {
      stats.avgDuration = stats.totalCalls > 0 
        ? Math.round(stats.totalDuration / stats.totalCalls) 
        : 0;
      if (stats.minDuration === Infinity) {
        stats.minDuration = 0;
      }
    }

    return Array.from(serviceStats.values());
  }

  compareTraces(trace1, trace2) {
    const getFlattenSpans = (spans, prefix = '') => {
      const result = [];
      for (const span of spans) {
        const key = `${prefix}${span.service}:${span.operation}`;
        result.push({
          key,
          span,
          service: span.service,
          operation: span.operation,
          duration: Number(span.duration) || 0
        });
        if (span.children.length > 0) {
          result.push(...getFlattenSpans(span.children, key + ' > '));
        }
      }
      return result;
    };

    const spans1 = getFlattenSpans(trace1.spans);
    const spans2 = getFlattenSpans(trace2.spans);

    const map1 = new Map(spans1.map(s => [s.key, s]));
    const map2 = new Map(spans2.map(s => [s.key, s]));

    const allKeys = new Set([...map1.keys(), ...map2.keys()]);
    const comparison = [];

    for (const key of allKeys) {
      const s1 = map1.get(key);
      const s2 = map2.get(key);
      
      const d1 = s1 ? s1.duration : 0;
      const d2 = s2 ? s2.duration : 0;
      const diff = d2 - d1;
      const diffPercent = d1 > 0 ? ((diff / d1) * 100) : (d2 > 0 ? 100 : 0);

      comparison.push({
        key,
        service: s1?.service || s2?.service,
        operation: s1?.operation || s2?.operation,
        duration1: d1,
        duration2: d2,
        diff,
        diffPercent: Number(diffPercent.toFixed(2)),
        inTrace1: !!s1,
        inTrace2: !!s2
      });
    }

    return {
      trace1: {
        traceId: trace1.traceId,
        totalDuration: Number(trace1.totalDuration) || 0,
        spanCount: trace1.spanCount
      },
      trace2: {
        traceId: trace2.traceId,
        totalDuration: Number(trace2.totalDuration) || 0,
        spanCount: trace2.spanCount
      },
      totalDiff: (Number(trace2.totalDuration) || 0) - (Number(trace1.totalDuration) || 0),
      totalDiffPercent: trace1.totalDuration > 0 
        ? (((Number(trace2.totalDuration) || 0) - (Number(trace1.totalDuration) || 0)) / trace1.totalDuration * 100).toFixed(2)
        : '0',
      details: comparison.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
    };
  }

  detectAnomalies(analyzedTrace, options = {}) {
    const threshold = options.threshold || 500;
    const anomalies = [];
    const warnings = [];

    const processSpan = (span, depth = 0, parent = null) => {
      const duration = Number(span.duration) || 0;
      const isSlow = duration > threshold;
      const hasError = span.status === 'error' || span.level === 'error';

      if (isSlow) {
        anomalies.push({
          spanId: span.spanId,
          service: span.service,
          operation: span.operation,
          duration,
          threshold,
          depth,
          parentSpanId: parent?.spanId,
          parentService: parent?.service,
          hasError,
          severity: duration > threshold * 3 ? 'critical' : duration > threshold * 2 ? 'high' : 'medium'
        });
      }

      if (hasError && !isSlow) {
        warnings.push({
          spanId: span.spanId,
          service: span.service,
          operation: span.operation,
          duration,
          depth,
          type: 'error'
        });
      }

      for (const child of span.children) {
        processSpan(child, depth + 1, span);
      }
    };

    for (const span of analyzedTrace.spans) {
      processSpan(span);
    }

    return {
      traceId: analyzedTrace.traceId,
      totalDuration: Number(analyzedTrace.totalDuration) || 0,
      threshold,
      anomalies,
      warnings,
      anomalyCount: anomalies.length,
      warningCount: warnings.length
    };
  }

  generateOptimizationSuggestions(anomalyResult, serviceStats = []) {
    const suggestions = [];
    const { anomalies, warnings } = anomalyResult;

    const servicePatterns = {
      'payment-srv': {
        keywords: ['pay', 'payment', 'charge', 'refund', 'gateway', 'third', '第三方', '支付', '网关'],
        suggestions: [
          '调用第三方支付网关较慢，建议检查网络延迟或考虑使用异步回调',
          '支付接口响应慢，建议优化支付流程或增加缓存',
          '考虑实现支付超时重试机制'
        ]
      },
      'order-srv': {
        keywords: ['order', 'create', 'submit', 'confirm', '订单', '创建', '提交'],
        suggestions: [
          '订单创建流程较慢，建议检查数据库查询性能',
          '考虑优化订单表索引或分库分表',
          '订单提交涉及多服务调用，建议并行化处理'
        ]
      },
      'user-srv': {
        keywords: ['user', 'login', 'auth', 'query', '用户', '登录', '查询'],
        suggestions: [
          '用户查询接口慢，建议增加 Redis 缓存',
          '登录验证耗时较长，考虑优化密码哈希算法或使用缓存',
          '用户信息查询建议优化 SQL 或增加适当索引'
        ]
      },
      'unknown': {
        keywords: [],
        suggestions: [
          '该节点耗时较长，建议检查具体业务逻辑',
          '考虑对该接口进行性能剖析',
          '检查是否存在资源竞争或锁等待'
        ]
      }
    };

    for (const anomaly of anomalies) {
      const pattern = servicePatterns[anomaly.service] || servicePatterns['unknown'];
      let matchedSuggestion = pattern.suggestions[0];

      const opLower = anomaly.operation.toLowerCase();
      for (let i = 0; i < pattern.keywords.length; i++) {
        if (opLower.includes(pattern.keywords[i].toLowerCase())) {
          matchedSuggestion = pattern.suggestions[Math.min(i, pattern.suggestions.length - 1)];
          break;
        }
      }

      suggestions.push({
        spanId: anomaly.spanId,
        service: anomaly.service,
        operation: anomaly.operation,
        duration: anomaly.duration,
        severity: anomaly.severity,
        type: 'performance',
        title: `${anomaly.service} > ${anomaly.operation} 耗时 ${anomaly.duration.toFixed(0)}ms 超过阈值`,
        suggestion: matchedSuggestion,
        action: anomaly.severity === 'critical' ? '立即优化' : anomaly.severity === 'high' ? '优先优化' : '建议优化'
      });
    }

    for (const warning of warnings) {
      suggestions.push({
        spanId: warning.spanId,
        service: warning.service,
        operation: warning.operation,
        duration: warning.duration,
        severity: 'high',
        type: 'error',
        title: `${warning.service} > ${warning.operation} 存在错误`,
        suggestion: '建议检查错误日志，修复异常问题',
        action: '需要修复'
      });
    }

    const totalDuration = anomalyResult.totalDuration;
    if (totalDuration > 2000) {
      suggestions.unshift({
        type: 'overall',
        severity: totalDuration > 5000 ? 'critical' : 'high',
        title: `整个调用链耗时 ${totalDuration.toFixed(0)}ms，整体性能较差`,
        suggestion: '建议从整体架构层面优化，考虑并行调用或缓存策略',
        action: totalDuration > 5000 ? '立即优化' : '优先优化'
      });
    }

    return suggestions.sort((a, b) => {
      const severityOrder = { critical: 0, high: 1, medium: 2 };
      return (severityOrder[a.severity] || 3) - (severityOrder[b.severity] || 3);
    });
  }
}

module.exports = TraceAnalyzer;
