import * as crypto from 'crypto';
import * as fs from 'fs-extra';
import * as readline from 'readline';
import { PostgreSQLClient } from '../db/postgresql';
import { RepairSQL, RepairSession, RowValidationResult, TableSchema } from '../types';

export class DataRepair {
  private pgClient: PostgreSQLClient;
  private sessions: Map<string, RepairSession> = new Map();

  constructor(pgClient: PostgreSQLClient) {
    this.pgClient = pgClient;
  }

  generateRepairSQL(
    tableName: string,
    schema: TableSchema,
    sourceRow: any | null,
    targetRow: any | null,
    primaryKey: string,
    differences?: string[]
  ): RepairSQL {
    const pkValue = sourceRow ? sourceRow[primaryKey] : targetRow![primaryKey];
    const columns = schema.columns.map(c => c.name);

    let operation: 'INSERT' | 'UPDATE' | 'DELETE';
    let sql: string;
    let sqlParams: any[];

    if (sourceRow && !targetRow) {
      operation = 'INSERT';
      const colNames = columns.map(c => `"${c}"`).join(', ');
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
      sql = `INSERT INTO "${tableName}" (${colNames}) VALUES (${placeholders})`;
      sqlParams = columns.map(c => sourceRow[c]);
    } else if (!sourceRow && targetRow) {
      operation = 'DELETE';
      sql = `DELETE FROM "${tableName}" WHERE "${primaryKey}" = $1`;
      sqlParams = [pkValue];
    } else {
      operation = 'UPDATE';
      const nonPkColumns = columns.filter(c => c !== primaryKey);
      const setClauses = nonPkColumns.map((c, i) => `"${c}" = $${i + 2}`).join(', ');
      sql = `UPDATE "${tableName}" SET ${setClauses} WHERE "${primaryKey}" = $1`;
      sqlParams = [pkValue, ...nonPkColumns.map(c => sourceRow![c])];
    }

    return {
      id: crypto.randomUUID(),
      tableName,
      primaryKey: pkValue,
      operation,
      sql,
      sourceData: sourceRow,
      targetData: targetRow,
      differences,
      confirmed: false,
      executed: false
    };
  }

  async createRepairSession(
    tableName: string,
    schema: TableSchema,
    mismatches: RowValidationResult[],
    sourceRows: Map<string | number, any>,
    targetRows: Map<string | number, any>,
    primaryKey: string
  ): Promise<RepairSession> {
    const repairs: RepairSQL[] = [];

    for (const mismatch of mismatches) {
      const sourceRow = sourceRows.get(mismatch.primaryKey) || null;
      const targetRow = targetRows.get(mismatch.primaryKey) || null;

      const repair = this.generateRepairSQL(
        tableName,
        schema,
        sourceRow,
        targetRow,
        primaryKey,
        mismatch.differences
      );
      repairs.push(repair);
    }

    const session: RepairSession = {
      id: crypto.randomUUID(),
      tableName,
      createdAt: Date.now(),
      repairs,
      totalRepairs: repairs.length,
      confirmedRepairs: 0,
      executedRepairs: 0,
      successRepairs: 0
    };

    this.sessions.set(session.id, session);
    return session;
  }

  confirmRepair(sessionId: string, repairId: string, confirmed: boolean = true): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const repair = session.repairs.find(r => r.id === repairId);
    if (!repair) throw new Error(`Repair ${repairId} not found`);

    repair.confirmed = confirmed;
    session.confirmedRepairs = session.repairs.filter(r => r.confirmed).length;
  }

  confirmAll(sessionId: string, confirmed: boolean = true): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    session.repairs.forEach(r => r.confirmed = confirmed);
    session.confirmedRepairs = confirmed ? session.totalRepairs : 0;
  }

  async executeRepair(sessionId: string, repairId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const repair = session.repairs.find(r => r.id === repairId);
    if (!repair) throw new Error(`Repair ${repairId} not found`);

    if (!repair.confirmed) {
      throw new Error(`Repair ${repairId} not confirmed`);
    }

    if (repair.executed) {
      return repair.success || false;
    }

    try {
      await this.pgClient.execute(repair.sql);
      repair.executed = true;
      repair.success = true;
      session.executedRepairs++;
      session.successRepairs++;
      return true;
    } catch (error) {
      console.error(`Error executing repair ${repairId}:`, error);
      repair.executed = true;
      repair.success = false;
      session.executedRepairs++;
      return false;
    }
  }

  async executeAll(sessionId: string): Promise<{ success: number; failed: number }> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    let success = 0;
    let failed = 0;

    for (const repair of session.repairs) {
      if (repair.confirmed && !repair.executed) {
        const result = await this.executeRepair(sessionId, repair.id);
        if (result) {
          success++;
        } else {
          failed++;
        }
      }
    }

    return { success, failed };
  }

  async interactiveConfirm(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    console.log(`\n=== 数据修复确认 (表: ${session.tableName}) ===`);
    console.log(`共 ${session.totalRepairs} 条修复待确认\n`);

    for (let i = 0; i < session.repairs.length; i++) {
      const repair = session.repairs[i];
      console.log(`\n[${i + 1}/${session.totalRepairs}] 操作: ${repair.operation}`);
      console.log(`  主键: ${repair.primaryKey}`);
      if (repair.differences) {
        console.log(`  差异:`);
        repair.differences.forEach(d => console.log(`    - ${d}`));
      }
      console.log(`  SQL: ${repair.sql}`);

      const answer = await new Promise<string>(resolve => {
        rl.question('  确认执行此修复? (y/n/a=全部/q=退出): ', resolve);
      });

      if (answer.toLowerCase() === 'y') {
        repair.confirmed = true;
      } else if (answer.toLowerCase() === 'a') {
        this.confirmAll(sessionId, true);
        console.log('已确认全部修复');
        break;
      } else if (answer.toLowerCase() === 'q') {
        console.log('已退出确认流程');
        break;
      }
    }

    session.confirmedRepairs = session.repairs.filter(r => r.confirmed).length;
    console.log(`\n已确认 ${session.confirmedRepairs}/${session.totalRepairs} 条修复`);
    rl.close();
  }

  saveSession(sessionId: string, filePath: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    return fs.writeJson(filePath, session, { spaces: 2 });
  }

  async loadSession(filePath: string): Promise<RepairSession> {
    const session = await fs.readJson(filePath);
    this.sessions.set(session.id, session);
    return session;
  }

  getSession(sessionId: string): RepairSession | undefined {
    return this.sessions.get(sessionId);
  }

  generateReport(sessionId: string): string {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const confirmedCount = session.repairs.filter(r => r.confirmed).length;
    const executedCount = session.repairs.filter(r => r.executed).length;
    const successCount = session.repairs.filter(r => r.success).length;
    const insertCount = session.repairs.filter(r => r.operation === 'INSERT').length;
    const updateCount = session.repairs.filter(r => r.operation === 'UPDATE').length;
    const deleteCount = session.repairs.filter(r => r.operation === 'DELETE').length;

    let report = `\n=== 数据修复报告 ===\n`;
    report += `会话ID: ${session.id}\n`;
    report += `表名: ${session.tableName}\n`;
    report += `创建时间: ${new Date(session.createdAt).toLocaleString()}\n\n`;
    report += `总计修复: ${session.totalRepairs}\n`;
    report += `  - INSERT: ${insertCount}\n`;
    report += `  - UPDATE: ${updateCount}\n`;
    report += `  - DELETE: ${deleteCount}\n\n`;
    report += `已确认: ${confirmedCount}\n`;
    report += `已执行: ${executedCount}\n`;
    report += `执行成功: ${successCount}\n`;
    report += `执行失败: ${executedCount - successCount}\n`;

    if (executedCount > 0) {
      report += `\n=== 执行详情 ===\n`;
      session.repairs.filter(r => r.executed).forEach(r => {
        report += `[${r.success ? '✓' : '✗'}] ${r.operation} ${r.primaryKey}\n`;
      });
    }

    return report;
  }
}
