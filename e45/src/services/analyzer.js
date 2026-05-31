class Analyzer {
  constructor() {
    this.commitTypes = {
      feat: { pattern: /^feat(\(.*\))?:/i, label: '新功能', color: '#52c41a' },
      fix: { pattern: /^fix(\(.*\))?:/i, label: 'Bug修复', color: '#f5222d' },
      docs: { pattern: /^docs(\(.*\))?:/i, label: '文档', color: '#1890ff' },
      style: { pattern: /^style(\(.*\))?:/i, label: '样式', color: '#faad14' },
      refactor: { pattern: /^refactor(\(.*\))?:/i, label: '重构', color: '#722ed1' },
      test: { pattern: /^test(\(.*\))?:/i, label: '测试', color: '#13c2c2' },
      chore: { pattern: /^chore(\(.*\))?:/i, label: '构建/工具', color: '#fa8c16' },
      perf: { pattern: /^perf(\(.*\))?:/i, label: '性能优化', color: '#eb2f96' },
      ci: { pattern: /^ci(\(.*\))?:/i, label: 'CI/CD', color: '#2f54eb' },
      revert: { pattern: /^revert(\(.*\))?:/i, label: '回退', color: '#8c8c8c' }
    };
  }

  classifyCommits(commits) {
    const result = {};
    Object.keys(this.commitTypes).forEach(key => {
      result[key] = { count: 0, label: this.commitTypes[key].label, color: this.commitTypes[key].color };
    });
    result.other = { count: 0, label: '其他', color: '#8c8c8c' };

    commits.forEach(commit => {
      let matched = false;
      const message = this.safeString(commit.message);
      for (const [type, config] of Object.entries(this.commitTypes)) {
        if (config.pattern.test(message)) {
          result[type].count++;
          matched = true;
          break;
        }
      }
      if (!matched) {
        result.other.count++;
      }
    });

    return Object.entries(result)
      .filter(([_, data]) => data.count > 0)
      .map(([type, data]) => ({ type, ...data }));
  }

  safeString(str) {
    if (typeof str !== 'string') {
      return '';
    }
    try {
      return str.normalize('NFC').replace(/\0/g, '');
    } catch {
      return String(str || '');
    }
  }

  generateHeatmapData(commits) {
    const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const hours = Array.from({ length: 24 }, (_, i) => i);
    
    const heatmap = {};
    days.forEach(day => {
      heatmap[day] = {};
      hours.forEach(hour => {
        heatmap[day][hour] = 0;
      });
    });

    commits.forEach(commit => {
      const date = new Date(commit.date);
      const day = days[date.getDay()];
      const hour = date.getHours();
      heatmap[day][hour]++;
    });

    const result = [];
    days.forEach(day => {
      hours.forEach(hour => {
        result.push({
          day,
          hour,
          value: heatmap[day][hour]
        });
      });
    });

    return result;
  }

  detectAnomalies(commits) {
    const anomalies = [];

    commits.forEach(commit => {
      try {
        const date = new Date(commit.date);
        if (isNaN(date.getTime())) {
          return;
        }
        
        const hour = date.getHours();
        
        if (hour >= 3 && hour <= 5) {
          anomalies.push({
            type: 'late_night',
            message: '凌晨提交',
            description: `在${hour}点提交代码`,
            commit: this.sanitizeCommit(commit),
            severity: 'warning'
          });
        }

        if (commit.diff && commit.diff.lines > 500) {
          anomalies.push({
            type: 'large_commit',
            message: '超大提交',
            description: `单次提交变更${commit.diff.lines}行代码`,
            commit: this.sanitizeCommit(commit),
            severity: 'warning'
          });
        }
      } catch (e) {
      }
    });

    const hourlyCommits = {};
    commits.forEach(commit => {
      try {
        const date = new Date(commit.date);
        if (isNaN(date.getTime())) {
          return;
        }
        const hourKey = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()} ${date.getHours()}`;
        if (!hourlyCommits[hourKey]) {
          hourlyCommits[hourKey] = [];
        }
        hourlyCommits[hourKey].push(commit);
      } catch (e) {
      }
    });

    Object.entries(hourlyCommits).forEach(([hourKey, commitsInHour]) => {
      if (commitsInHour.length >= 10) {
        anomalies.push({
          type: 'batch_commits',
          message: '批量提交',
          description: `在${hourKey}时进行了${commitsInHour.length}次提交`,
          commits: commitsInHour.map(c => this.sanitizeCommit(c)),
          severity: 'info'
        });
      }
    });

    return anomalies;
  }

  sanitizeCommit(commit) {
    return {
      hash: this.safeString(commit.hash),
      message: this.safeString(commit.message),
      author_name: this.safeString(commit.author_name),
      author_email: this.safeString(commit.author_email),
      date: this.safeString(commit.date)
    };
  }

  generateTimelineData(commits) {
    const monthlyData = {};
    
    commits.forEach(commit => {
      const date = new Date(commit.date);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
      if (!monthlyData[key]) {
        monthlyData[key] = {
          date: key,
          commits: 0,
          insertions: 0,
          deletions: 0
        };
      }
      
      monthlyData[key].commits++;
      monthlyData[key].insertions += commit.diff.insertions || 0;
      monthlyData[key].deletions += commit.diff.deletions || 0;
    });

    return Object.values(monthlyData).sort((a, b) => a.date.localeCompare(b.date));
  }

  getContributors(commits) {
    const contributors = {};
    
    commits.forEach(commit => {
      const email = commit.author_email;
      if (!contributors[email]) {
        contributors[email] = {
          name: commit.author_name,
          email: commit.author_email,
          commits: 0,
          insertions: 0,
          deletions: 0
        };
      }
      
      contributors[email].commits++;
      contributors[email].insertions += commit.diff.insertions || 0;
      contributors[email].deletions += commit.diff.deletions || 0;
    });

    return Object.values(contributors)
      .sort((a, b) => b.commits - a.commits)
      .slice(0, 10);
  }

  levenshteinDistance(str1, str2) {
    const s1 = this.safeString(str1);
    const s2 = this.safeString(str2);
    
    if (s1.length === 0) return s2.length;
    if (s2.length === 0) return s1.length;

    const matrix = [];

    for (let i = 0; i <= s2.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= s1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= s2.length; i++) {
      for (let j = 1; j <= s1.length; j++) {
        if (s2.charAt(i - 1) === s1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[s2.length][s1.length];
  }

  calculateSimilarity(str1, str2) {
    const s1 = this.safeString(str1).toLowerCase();
    const s2 = this.safeString(str2).toLowerCase();
    
    if (s1.length === 0 && s2.length === 0) return 1.0;
    if (s1.length === 0 || s2.length === 0) return 0.0;

    const distance = this.levenshteinDistance(s1, s2);
    const maxLength = Math.max(s1.length, s2.length);
    
    return 1 - (distance / maxLength);
  }

  extractKeywords(message) {
    const msg = this.safeString(message).toLowerCase();
    const keywords = new Set();
    
    const issuePattern = /#(\d+)/g;
    let match;
    while ((match = issuePattern.exec(msg)) !== null) {
      keywords.add(`issue:${match[1]}`);
    }

    const words = msg.split(/[^a-z0-9\u4e00-\u9fa5]+/).filter(w => w.length > 2);
    words.forEach(word => keywords.add(word));

    return Array.from(keywords);
  }

  calculateCommitSimilarity(commit1, commit2) {
    const messageSimilarity = this.calculateSimilarity(commit1.message, commit2.message);
    
    const keywords1 = this.extractKeywords(commit1.message);
    const keywords2 = this.extractKeywords(commit2.message);
    const commonKeywords = keywords1.filter(k => keywords2.includes(k));
    const keywordSimilarity = keywords1.length > 0 || keywords2.length > 0 
      ? (2 * commonKeywords.length) / (keywords1.length + keywords2.length)
      : 0;
    
    const authorSimilarity = commit1.author_email === commit2.author_email ? 0.3 : 0;
    
    const date1 = new Date(commit1.date).getTime();
    const date2 = new Date(commit2.date).getTime();
    const hoursDiff = Math.abs(date1 - date2) / (1000 * 60 * 60);
    const timeSimilarity = Math.max(0, 1 - (hoursDiff / 72));
    
    const finalScore = (messageSimilarity * 0.4) + 
                       (keywordSimilarity * 0.35) + 
                       authorSimilarity + 
                       (timeSimilarity * 0.25);
    
    return {
      score: Math.min(1, Math.max(0, finalScore)),
      messageSimilarity,
      keywordSimilarity,
      authorSimilarity,
      timeSimilarity,
      commonKeywords
    };
  }

  findRelatedCommits(commits, threshold = 0.4) {
    const relationships = [];
    const maxCommits = Math.min(commits.length, 100);
    const sampleCommits = commits.slice(0, maxCommits);

    for (let i = 0; i < sampleCommits.length; i++) {
      for (let j = i + 1; j < sampleCommits.length; j++) {
        const similarity = this.calculateCommitSimilarity(sampleCommits[i], sampleCommits[j]);
        
        if (similarity.score >= threshold) {
          relationships.push({
            source: sampleCommits[i].hash,
            target: sampleCommits[j].hash,
            similarity: similarity.score,
            details: similarity
          });
        }
      }
    }

    return relationships;
  }

  groupRelatedCommits(commits, relationships, threshold = 0.5) {
    const groups = [];
    const visited = new Set();

    const buildGraph = () => {
      const graph = {};
      commits.forEach(c => graph[c.hash] = []);
      
      relationships.forEach(rel => {
        if (rel.similarity >= threshold) {
          graph[rel.source].push(rel.target);
          graph[rel.target].push(rel.source);
        }
      });
      return graph;
    };

    const graph = buildGraph();

    for (const commit of commits) {
      if (visited.has(commit.hash)) continue;

      const group = [];
      const stack = [commit.hash];
      
      while (stack.length > 0) {
        const hash = stack.pop();
        if (visited.has(hash)) continue;
        
        visited.add(hash);
        const commitInGroup = commits.find(c => c.hash === hash);
        if (commitInGroup) {
          group.push(commitInGroup);
        }
        
        const neighbors = graph[hash] || [];
        neighbors.forEach(neighbor => {
          if (!visited.has(neighbor)) {
            stack.push(neighbor);
          }
        });
      }

      if (group.length >= 2) {
        const avgSimilarity = this.calculateGroupAvgSimilarity(group, relationships);
        groups.push({
          id: groups.length + 1,
          commits: group,
          size: group.length,
          avgSimilarity,
          dominantType: this.findDominantType(group),
          suggestedLabel: this.generateGroupLabel(group)
        });
      }
    }

    return groups.sort((a, b) => b.size - a.size);
  }

  calculateGroupAvgSimilarity(group, relationships) {
    const hashes = new Set(group.map(c => c.hash));
    const groupRels = relationships.filter(r => 
      hashes.has(r.source) && hashes.has(r.target)
    );
    
    if (groupRels.length === 0) return 0;
    return groupRels.reduce((sum, r) => sum + r.similarity, 0) / groupRels.length;
  }

  findDominantType(commits) {
    const typeCount = {};
    commits.forEach(c => {
      for (const [type, config] of Object.entries(this.commitTypes)) {
        if (config.pattern.test(c.message)) {
          typeCount[type] = (typeCount[type] || 0) + 1;
          break;
        }
      }
    });
    
    const entries = Object.entries(typeCount);
    if (entries.length === 0) return 'mixed';
    return entries.sort((a, b) => b[1] - a[1])[0][0];
  }

  generateGroupLabel(commits) {
    const allKeywords = new Set();
    commits.forEach(c => {
      this.extractKeywords(c.message).forEach(k => allKeywords.add(k));
    });
    
    const keywords = Array.from(allKeywords).slice(0, 3);
    return keywords.length > 0 ? keywords.join(', ') : '关联提交组';
  }

  analyzeCommitRelationships(commits) {
    const relationships = this.findRelatedCommits(commits, 0.35);
    const groups = this.groupRelatedCommits(commits, relationships, 0.4);
    
    const nodes = commits.slice(0, 100).map(commit => {
      let type = 'other';
      for (const [t, config] of Object.entries(this.commitTypes)) {
        if (config.pattern.test(commit.message)) {
          type = t;
          break;
        }
      }
      return {
        id: commit.hash,
        message: commit.message,
        author: commit.author_name,
        date: commit.date,
        type,
        shortHash: commit.hash.substring(0, 7)
      };
    });

    return {
      nodes,
      links: relationships,
      groups,
      totalRelationships: relationships.length
    };
  }
}

module.exports = Analyzer;
