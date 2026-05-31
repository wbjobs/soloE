const simpleGit = require('simple-git');

class GitService {
  async getCommits(repoPath) {
    try {
      const git = simpleGit(repoPath);
      const isRepo = await git.checkIsRepo();
      if (!isRepo) {
        throw new Error('选择的路径不是有效的Git仓库');
      }

      const log = await git.log([
        '--all',
        '--numstat',
        '--date=iso-strict',
        '--encoding=UTF-8',
        '--no-notes'
      ]);
      
      return log.all.map(commit => ({
        hash: this.sanitizeString(commit.hash),
        message: this.sanitizeString(commit.message),
        author_name: this.sanitizeString(commit.author_name),
        author_email: this.sanitizeString(commit.author_email),
        date: this.sanitizeString(commit.date),
        body: this.sanitizeString(commit.body),
        diff: this.parseDiff(commit.diff)
      }));
    } catch (error) {
      throw new Error(`读取Git仓库失败: ${error.message}`);
    }
  }

  sanitizeString(str) {
    if (typeof str !== 'string') {
      return '';
    }
    
    let result = str;
    
    result = result.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    
    result = result.replace(/\uFFFD/g, '');
    
    result = result.normalize('NFC');
    
    return result.trim();
  }

  parseDiff(diff) {
    if (!diff) return { files: 0, insertions: 0, deletions: 0, lines: 0 };
    
    let files = 0;
    let insertions = 0;
    let deletions = 0;

    if (diff.files) {
      files = diff.files.length;
      diff.files.forEach(file => {
        if (file.changes) {
          insertions += file.insertions || 0;
          deletions += file.deletions || 0;
        }
      });
    }

    return {
      files,
      insertions,
      deletions,
      lines: insertions + deletions
    };
  }
}

module.exports = GitService;
