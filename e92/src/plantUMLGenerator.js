const fs = require('fs');

class PlantUMLGenerator {
  constructor() {
    this.serviceColors = {
      'user-srv': '#LightSkyBlue',
      'order-srv': '#LightGreen',
      'payment-srv': '#LightGoldenRodYellow',
      'unknown': '#LightGray'
    };
  }

  generateSequenceDiagram(analyzedTrace, options = {}) {
    const { showDuration = true, showErrors = true, highlightSlow = true, slowThreshold = 500 } = options;
    
    const participants = this.extractParticipants(analyzedTrace);
    const interactions = this.extractInteractions(analyzedTrace, { showDuration, showErrors, highlightSlow, slowThreshold });

    let plantUML = `@startuml
' 调用链时序图 - ${analyzedTrace.traceId}
skinparam sequence {
    ArrowColor #333333
    ActorBorderColor #333333
    BoxBorderColor #333333
    LifeLineBorderColor #333333
    ParticipantBorderColor #333333
    BoxFontName Arial
    ParticipantFontName Arial
}

title 调用链时序图\nTrace ID: ${analyzedTrace.traceId}\n总耗时: ${analyzedTrace.totalDuration.toFixed(0)}ms

`;

    participants.forEach(p => {
      const color = this.serviceColors[p] || this.serviceColors['unknown'];
      plantUML += `participant "${p}" as ${this.toParticipantId(p)} ${color}\n`;
    });

    plantUML += `
' 调用流程\n`;
    plantUML += interactions.join('\n');

    plantUML += `
@enduml
`;

    return plantUML;
  }

  toParticipantId(serviceName) {
    return serviceName.replace(/[^a-zA-Z0-9]/g, '_');
  }

  extractParticipants(analyzedTrace) {
    const services = new Set();
    
    const collectServices = (spans) => {
      for (const span of spans) {
        services.add(span.service);
        if (span.children && span.children.length > 0) {
          collectServices(span.children);
        }
      }
    };

    collectServices(analyzedTrace.spans);

    return Array.from(services);
  }

  extractInteractions(analyzedTrace, options) {
    const { showDuration, showErrors, highlightSlow, slowThreshold } = options;
    const interactions = [];
    const spanMap = new Map();

    const collectSpans = (spans, parentId = null) => {
      for (const span of spans) {
        spanMap.set(span.spanId, { ...span, parentId });
        if (span.children && span.children.length > 0) {
          collectSpans(span.children, span.spanId);
        }
      }
    };

    collectSpans(analyzedTrace.spans);

    const sortedSpans = Array.from(spanMap.values()).sort((a, b) => a.start - b.start);

    for (const span of sortedSpans) {
      const fromId = span.parentId 
        ? spanMap.get(span.parentId) 
        : null;
      
      const from = fromId ? fromId.service : span.service;
      const to = span.service;
      const duration = Number(span.duration) || 0;
      const isSlow = duration > slowThreshold;
      const hasError = span.status === 'error' || span.level === 'error';
      
      let arrow = '->';
      let note = '';

      if (showDuration || showErrors) {
        const parts = [];
        if (showDuration) {
          parts.push(`${duration.toFixed(0)}ms`);
        }
        if (showErrors && hasError) {
          parts.push('ERROR');
        }
        if (parts.length > 0) {
          note = ` : ${parts.join(' | ')}`;
        }
      }

      let line = '';
      let decorator = '';

      if (highlightSlow && isSlow) {
        decorator = '[#FF6B6B]';
      } else if (hasError) {
        decorator = '[#FF0000]';
      }

      if (fromId && from !== to) {
        const fromPart = this.toParticipantId(from);
        const toPart = this.toParticipantId(to);
        line = `${fromPart} ${arrow}${decorator} ${toPart}${note}`;
        interactions.push(line);
      } else if (!fromId) {
        const participant = this.toParticipantId(to);
        line = `activate ${participant}`;
        interactions.push(line);
        if (note) {
          interactions.push(`note over ${participant}${note}`);
        }
        interactions.push(`deactivate ${participant}`);
      }

      if (hasError) {
        interactions.push(`note right of ${this.toParticipantId(to)} #FFE4E1: ${span.operation} - 发生错误`);
      } else if (isSlow && highlightSlow) {
        interactions.push(`note right of ${this.toParticipantId(to)} #FFF0F0: ${span.operation} - 耗时较长 (${duration.toFixed(0)}ms)`);
      }
    }

    return interactions;
  }

  generateAllTracesDiagram(analyzedTraces, options = {}) {
    if (!analyzedTraces || analyzedTraces.length === 0) {
      return `@startuml
title 无数据
note right: 没有可用的调用链数据
@enduml
`;
    }

    if (analyzedTraces.length === 1) {
      return this.generateSequenceDiagram(analyzedTraces[0], options);
    }

    const diagrams = analyzedTraces.map(trace => this.generateSequenceDiagram(trace, options));

    const diagramContent = diagrams.map(d => d.replace('@startuml\n', '').replace('@enduml\n', '')).join('\nnewpage\n');
    return `@startuml
title 多条调用链对比
' 多个时序图使用 newpage 分隔

${diagramContent}@enduml
`;
  }

  saveToFile(plantUML, filePath) {
    try {
      fs.writeFileSync(filePath, plantUML, 'utf-8');
      return true;
    } catch (error) {
      console.error('保存 PlantUML 文件失败:', error);
      return false;
    }
  }

  generateMarkdownLink(plantUML) {
    const encoded = this.encodePlantUML(plantUML);
    return `![时序图](http://www.plantuml.com/plantuml/svg/${encoded})`;
  }

  encodePlantUML(text) {
    const utf8 = unescape(encodeURIComponent(text));
    return this.encode64(utf8);
  }

  encode64(data) {
    const encodings = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let encoded = '';
    let byte1, byte2, byte3;
    let i = 0;

    while (i < data.length) {
      byte1 = data.charCodeAt(i++);
      byte2 = i < data.length ? data.charCodeAt(i++) : NaN;
      byte3 = i < data.length ? data.charCodeAt(i++) : NaN;

      const enc1 = byte1 >> 2;
      const enc2 = ((byte1 & 3) << 4) | (byte2 >> 4);
      const enc3 = isNaN(byte2) ? 64 : (((byte2 & 15) << 2) | (byte3 >> 6));
      const enc4 = isNaN(byte3) ? 64 : byte3 & 63;

      if (isNaN(byte2)) enc3 = enc4 = 64;
      else if (isNaN(byte3)) enc4 = 64;

      encoded = encoded
        .concat(encodings.charAt(enc1))
        .concat(encodings.charAt(enc2))
        .concat(encodings.charAt(enc3))
        .concat(encodings.charAt(enc4));
    }

    return encoded;
  }
}

module.exports = PlantUMLGenerator;
