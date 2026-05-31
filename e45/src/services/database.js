const Database = require('better-sqlite3');
const crypto = require('crypto');

class GitDatabase {
  constructor(dbPath) {
    this.db = new Database(dbPath);
    this.initTables();
  }

  initTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS repos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT UNIQUE NOT NULL,
        last_analyzed DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS commits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_id INTEGER,
        hash TEXT UNIQUE NOT NULL,
        message TEXT,
        author_name TEXT,
        author_email TEXT,
        date TEXT,
        body TEXT,
        diff_files INTEGER DEFAULT 0,
        diff_insertions INTEGER DEFAULT 0,
        diff_deletions INTEGER DEFAULT 0,
        diff_lines INTEGER DEFAULT 0,
        FOREIGN KEY (repo_id) REFERENCES repos(id)
      );

      CREATE INDEX IF NOT EXISTS idx_commits_repo ON commits(repo_id);
      CREATE INDEX IF NOT EXISTS idx_commits_date ON commits(date);
    `);
  }

  getRepoId(path) {
    const row = this.db.prepare('SELECT id FROM repos WHERE path = ?').get(path);
    return row ? row.id : null;
  }

  saveCommits(repoPath, commits) {
    const tx = this.db.transaction((commits) => {
      let repoId = this.getRepoId(repoPath);
      
      if (!repoId) {
        const result = this.db.prepare('INSERT INTO repos (path) VALUES (?)').run(repoPath);
        repoId = result.lastInsertRowid;
      } else {
        this.db.prepare('DELETE FROM commits WHERE repo_id = ?').run(repoId);
        this.db.prepare('UPDATE repos SET last_analyzed = CURRENT_TIMESTAMP WHERE id = ?').run(repoId);
      }

      const insert = this.db.prepare(`
        INSERT INTO commits (
          repo_id, hash, message, author_name, author_email, date, body,
          diff_files, diff_insertions, diff_deletions, diff_lines
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const commit of commits) {
        insert.run(
          repoId,
          commit.hash,
          commit.message,
          commit.author_name,
          commit.author_email,
          commit.date,
          commit.body,
          commit.diff.files,
          commit.diff.insertions,
          commit.diff.deletions,
          commit.diff.lines
        );
      }
    });

    tx(commits);
  }

  getCommits(repoPath) {
    const repoId = this.getRepoId(repoPath);
    if (!repoId) return [];

    const rows = this.db.prepare(`
      SELECT 
        hash, message, author_name, author_email, date, body,
        diff_files as 'diff.files',
        diff_insertions as 'diff.insertions',
        diff_deletions as 'diff.deletions',
        diff_lines as 'diff.lines'
      FROM commits 
      WHERE repo_id = ? 
      ORDER BY date DESC
    `).all(repoId);

    return rows.map(row => ({
      ...row,
      diff: {
        files: row['diff.files'],
        insertions: row['diff.insertions'],
        deletions: row['diff.deletions'],
        lines: row['diff.lines']
      }
    }));
  }

  clearCommits(repoPath) {
    const repoId = this.getRepoId(repoPath);
    if (repoId) {
      this.db.prepare('DELETE FROM commits WHERE repo_id = ?').run(repoId);
    }
  }

  close() {
    this.db.close();
  }
}

module.exports = GitDatabase;
