import Database from 'better-sqlite3';
import { DetectionReport, DecodingLog } from './types';
import path from 'path';

const dbPath = path.join(__dirname, '..', 'detection_history.db');

export class DatabaseService {
  private db: Database.Database;

  constructor() {
    this.db = new Database(dbPath);
    console.log('Connected to SQLite database');
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS detection_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sessionId TEXT NOT NULL,
        peerId TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        jitterScore REAL NOT NULL,
        reorderScore REAL NOT NULL,
        overallSuspicion REAL NOT NULL,
        totalPackets INTEGER NOT NULL,
        reorderedPackets INTEGER NOT NULL,
        avgLatency REAL NOT NULL,
        jitter REAL NOT NULL,
        details TEXT
      );
      CREATE TABLE IF NOT EXISTS decoding_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sessionId TEXT NOT NULL,
        peerId TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        suspicionScore REAL NOT NULL,
        decodingSuccess INTEGER NOT NULL,
        decodingMethod TEXT NOT NULL,
        confidence REAL NOT NULL,
        bitCount INTEGER NOT NULL,
        byteCount INTEGER NOT NULL,
        encodingType TEXT NOT NULL,
        hexData TEXT,
        textData TEXT,
        rawBits TEXT,
        details TEXT
      )
    `);
  }

  saveReport(report: Omit<DetectionReport, 'id'>): number {
    const stmt = this.db.prepare(`
      INSERT INTO detection_reports (
        sessionId, peerId, timestamp, jitterScore, reorderScore,
        overallSuspicion, totalPackets, reorderedPackets, avgLatency, jitter, details
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      report.sessionId,
      report.peerId,
      report.timestamp,
      report.jitterScore,
      report.reorderScore,
      report.overallSuspicion,
      report.totalPackets,
      report.reorderedPackets,
      report.avgLatency,
      report.jitter,
      report.details
    );
    return Number(result.lastInsertRowid);
  }

  getReportsBySession(sessionId: string): DetectionReport[] {
    const stmt = this.db.prepare(
      'SELECT * FROM detection_reports WHERE sessionId = ? ORDER BY timestamp DESC'
    );
    return stmt.all(sessionId) as DetectionReport[];
  }

  getAllReports(limit: number = 100): DetectionReport[] {
    const stmt = this.db.prepare(
      'SELECT * FROM detection_reports ORDER BY timestamp DESC LIMIT ?'
    );
    return stmt.all(limit) as DetectionReport[];
  }

  getSuspiciousReports(threshold: number = 0.7, limit: number = 100): DetectionReport[] {
    const stmt = this.db.prepare(
      'SELECT * FROM detection_reports WHERE overallSuspicion >= ? ORDER BY overallSuspicion DESC LIMIT ?'
    );
    return stmt.all(threshold, limit) as DetectionReport[];
  }

  saveDecodingLog(log: Omit<DecodingLog, 'id'>): number {
    const stmt = this.db.prepare(`
      INSERT INTO decoding_logs (
        sessionId, peerId, timestamp, suspicionScore, decodingSuccess,
        decodingMethod, confidence, bitCount, byteCount, encodingType,
        hexData, textData, rawBits, details
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      log.sessionId,
      log.peerId,
      log.timestamp,
      log.suspicionScore,
      log.decodingSuccess ? 1 : 0,
      log.decodingMethod,
      log.confidence,
      log.bitCount,
      log.byteCount,
      log.encodingType,
      log.hexData,
      log.textData,
      log.rawBits,
      log.details
    );
    return Number(result.lastInsertRowid);
  }

  getDecodingLogsBySession(sessionId: string): DecodingLog[] {
    const stmt = this.db.prepare(
      'SELECT * FROM decoding_logs WHERE sessionId = ? ORDER BY timestamp DESC'
    );
    const rows = stmt.all(sessionId) as any[];
    return rows.map((row) => ({
      ...row,
      decodingSuccess: row.decodingSuccess === 1
    }));
  }

  getSuccessfulDecodings(limit: number = 50): DecodingLog[] {
    const stmt = this.db.prepare(
      'SELECT * FROM decoding_logs WHERE decodingSuccess = 1 ORDER BY confidence DESC LIMIT ?'
    );
    const rows = stmt.all(limit) as any[];
    return rows.map((row) => ({
      ...row,
      decodingSuccess: row.decodingSuccess === 1
    }));
  }

  close(): void {
    this.db.close();
  }
}
