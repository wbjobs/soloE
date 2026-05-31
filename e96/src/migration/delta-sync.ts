import * as crypto from 'crypto';
import { MySQLClient } from '../db/mysql';
import { PostgreSQLClient } from '../db/postgresql';
import { DeltaChange, DeltaSyncConfig, DeltaSyncStatus, TableConfig } from '../types';
import { convertMySQLValueToPostgreSQL } from './schema';

export class DeltaSync {
  private mysqlClient: MySQLClient;
  private pgClient: PostgreSQLClient;
  private syncConfigs: Map<string, DeltaSyncConfig> = new Map();
  private syncStatuses: Map<string, DeltaSyncStatus> = new Map();
  private isRunning: boolean = false;
  private onChange?: (change: DeltaChange) => void;
  private onStatus?: (status: DeltaSyncStatus) => void;

  constructor(
    mysqlClient: MySQLClient,
    pgClient: PostgreSQLClient,
    onChange?: (change: DeltaChange) => void,
    onStatus?: (status: DeltaSyncStatus) => void
  ) {
    this.mysqlClient = mysqlClient;
    this.pgClient = pgClient;
    this.onChange = onChange;
    this.onStatus = onStatus;
  }

  addTable(tableConfig: TableConfig, timestampColumn?: string, versionColumn?: string): void {
    const config: DeltaSyncConfig = {
      sourceTable: tableConfig.sourceTable,
      targetTable: tableConfig.targetTable,
      primaryKey: tableConfig.primaryKey,
      timestampColumn,
      versionColumn,
      pollInterval: 5000,
      lastSyncTime: 0
    };
    this.syncConfigs.set(tableConfig.sourceTable, config);
    
    const status: DeltaSyncStatus = {
      tableName: tableConfig.sourceTable,
      lastSyncTime: 0,
      processedChanges: 0,
      pendingChanges: 0,
      errors: 0,
      isRunning: false
    };
    this.syncStatuses.set(tableConfig.sourceTable, status);
  }

  async detectChanges(config: DeltaSyncConfig): Promise<DeltaChange[]> {
    const changes: DeltaChange[] = [];
    
    try {
      if (config.timestampColumn) {
        const sinceTime = new Date(config.lastSyncTime || 0).toISOString().slice(0, 19).replace('T', ' ');
        
        const sql = `
          SELECT * FROM ?? 
          WHERE ?? > ? 
          ORDER BY ?? ASC
        `;
        
        const rows = await this.mysqlClient.query(sql, [
          config.sourceTable,
          config.timestampColumn,
          sinceTime,
          config.primaryKey
        ]);
        
        for (const row of rows as any[]) {
          const pk = row[config.primaryKey];
          
          const targetRow = await this.pgClient.query(
            `SELECT * FROM "${config.targetTable}" WHERE "${config.primaryKey}" = $1`,
            [pk]
          );
          
          let changeType: 'INSERT' | 'UPDATE';
          let oldData: any = undefined;
          
          if (targetRow.length === 0) {
            changeType = 'INSERT';
          } else {
            changeType = 'UPDATE';
            oldData = targetRow[0];
          }
          
          const change: DeltaChange = {
            id: crypto.randomUUID(),
            type: changeType,
            tableName: config.sourceTable,
            primaryKey: pk,
            timestamp: Date.now(),
            data: row,
            oldData
          };
          
          changes.push(change);
        }
      } else {
        const pkRanges = await this.getPkRanges(config.sourceTable, config.primaryKey);
        
        for (const range of pkRanges) {
          const [sourceRows, targetRows] = await Promise.all([
            this.mysqlClient.getRowsByPkRange(
              config.sourceTable,
              config.primaryKey,
              range.min,
              range.max
            ),
            this.pgClient.getRowsByPkRange(
              config.targetTable,
              config.primaryKey,
              range.min,
              range.max
            )
          ]);
          
          const sourceMap = new Map<string | number, any>();
          const targetMap = new Map<string | number, any>();
          
          for (const row of sourceRows) {
            sourceMap.set(row[config.primaryKey], row);
          }
          for (const row of targetRows) {
            targetMap.set(row[config.primaryKey], row);
          }
          
          for (const [pk, sourceRow] of sourceMap) {
            const targetRow = targetMap.get(pk);
            if (!targetRow) {
              changes.push({
                id: crypto.randomUUID(),
                type: 'INSERT',
                tableName: config.sourceTable,
                primaryKey: pk,
                timestamp: Date.now(),
                data: sourceRow
              });
            } else {
              const sourceMd5 = this.calculateRowHash(sourceRow);
              const targetMd5 = this.calculateRowHash(targetRow);
              if (sourceMd5 !== targetMd5) {
                changes.push({
                  id: crypto.randomUUID(),
                  type: 'UPDATE',
                  tableName: config.sourceTable,
                  primaryKey: pk,
                  timestamp: Date.now(),
                  data: sourceRow,
                  oldData: targetRow
                });
              }
            }
            targetMap.delete(pk);
          }
          
          for (const [pk, targetRow] of targetMap) {
            changes.push({
              id: crypto.randomUUID(),
              type: 'DELETE',
              tableName: config.sourceTable,
              primaryKey: pk,
              timestamp: Date.now(),
              oldData: targetRow
            });
          }
        }
      }
      
      return changes;
    } catch (error) {
      console.error(`Error detecting changes for ${config.sourceTable}:`, error);
      return [];
    }
  }

  private async getPkRanges(tableName: string, primaryKey: string): Promise<Array<{ min: number; max: number }>> {
    const { min, max } = await this.mysqlClient.getMinMaxPk(tableName, primaryKey);
    if (min === null || max === null) return [];
    
    const ranges: Array<{ min: number; max: number }> = [];
    const chunkSize = 10000;
    let current = Number(min);
    const maxNum = Number(max);
    
    while (current <= maxNum) {
      ranges.push({
        min: current,
        max: Math.min(current + chunkSize - 1, maxNum)
      });
      current += chunkSize;
    }
    
    return ranges;
  }

  private calculateRowHash(row: any): string {
    const keys = Object.keys(row).sort();
    const values = keys.map(k => {
      const v = row[k];
      if (v === null || v === undefined) return 'NULL';
      if (v instanceof Buffer) return v.toString('base64');
      if (v instanceof Date) return v.toISOString();
      return String(v);
    }).join('|');
    return crypto.createHash('md5').update(values).digest('hex');
  }

  async applyChange(change: DeltaChange, config: DeltaSyncConfig): Promise<boolean> {
    try {
      const schema = await this.mysqlClient.getTableSchema(config.sourceTable);
      const columns = schema.columns.map(c => c.name);
      
      if (change.type === 'INSERT' && change.data) {
        const converted = convertMySQLValueToPostgreSQL(change.data, schema.columns);
        const colNames = columns.map(c => `"${c}"`).join(', ');
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
        const values = columns.map(c => converted[c]);
        
        await this.pgClient.execute(
          `INSERT INTO "${config.targetTable}" (${colNames}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
          values
        );
      } else if (change.type === 'UPDATE' && change.data) {
        const converted = convertMySQLValueToPostgreSQL(change.data, schema.columns);
        const setClauses = columns
          .filter(c => c !== config.primaryKey)
          .map((c, i) => `"${c}" = $${i + 2}`)
          .join(', ');
        const values = [change.primaryKey, ...columns.filter(c => c !== config.primaryKey).map(c => converted[c])];
        
        await this.pgClient.execute(
          `UPDATE "${config.targetTable}" SET ${setClauses} WHERE "${config.primaryKey}" = $1`,
          values
        );
      } else if (change.type === 'DELETE') {
        await this.pgClient.execute(
          `DELETE FROM "${config.targetTable}" WHERE "${config.primaryKey}" = $1`,
          [change.primaryKey]
        );
      }
      
      return true;
    } catch (error) {
      console.error(`Error applying change ${change.id}:`, error);
      return false;
    }
  }

  async syncTable(config: DeltaSyncConfig): Promise<void> {
    const status = this.syncStatuses.get(config.sourceTable)!;
    status.isRunning = true;
    this.emitStatus(status);
    
    try {
      const changes = await this.detectChanges(config);
      status.pendingChanges = changes.length;
      this.emitStatus(status);
      
      for (const change of changes) {
        if (this.onChange) {
          this.onChange(change);
        }
        
        const success = await this.applyChange(change, config);
        if (success) {
          status.processedChanges++;
        } else {
          status.errors++;
        }
        
        status.lastSyncTime = change.timestamp;
        config.lastSyncTime = change.timestamp;
        this.emitStatus(status);
      }
      
      status.pendingChanges = 0;
    } catch (error) {
      console.error(`Error syncing table ${config.sourceTable}:`, error);
      status.errors++;
    } finally {
      status.isRunning = false;
      this.emitStatus(status);
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    
    console.log('Starting delta sync...');
    
    while (this.isRunning) {
      const syncPromises: Promise<void>[] = [];
      
      for (const config of this.syncConfigs.values()) {
        syncPromises.push(this.syncTable(config));
      }
      
      await Promise.all(syncPromises);
      
      const minInterval = Math.min(...Array.from(this.syncConfigs.values()).map(c => c.pollInterval || 5000));
      await new Promise(resolve => setTimeout(resolve, minInterval));
    }
  }

  stop(): void {
    this.isRunning = false;
    console.log('Delta sync stopped.');
  }

  getStatus(tableName: string): DeltaSyncStatus | undefined {
    return this.syncStatuses.get(tableName);
  }

  getAllStatuses(): DeltaSyncStatus[] {
    return Array.from(this.syncStatuses.values());
  }

  private emitStatus(status: DeltaSyncStatus): void {
    if (this.onStatus) {
      this.onStatus(status);
    }
  }
}
