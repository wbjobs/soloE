import { MySQLClient } from '../db/mysql';
import { PostgreSQLClient } from '../db/postgresql';
import { generatePostgreSQLDDL } from '../migration/schema';
import { DataMigrator } from '../migration/migrator';
import { DataValidator } from '../migration/validator';
import { DeltaSync } from '../migration/delta-sync';
import { DataRepair } from '../migration/repair';
import { SLAReporter } from '../migration/sla-reporter';
import { 
  MigrationConfig, 
  MigrationProgress, 
  MigrationStats, 
  DeltaChange,
  DeltaSyncStatus,
  RepairSession,
  SLAReport
} from '../types';

export interface MigrationCallbacks {
  onSchemaMigrate?: (tableName: string) => void;
  onProgress?: (progress: MigrationProgress) => void;
  onStats?: (stats: MigrationStats) => void;
  onComplete?: () => void;
  onError?: (error: Error) => void;
  onDeltaChange?: (change: DeltaChange) => void;
  onDeltaStatus?: (status: DeltaSyncStatus) => void;
  onSLAReport?: (report: SLAReport) => void;
}

export class MigrationCoordinator {
  private mysqlClient: MySQLClient;
  private pgClient: PostgreSQLClient;
  private config: MigrationConfig;
  private callbacks: MigrationCallbacks;
  private progressMap: Map<string, MigrationProgress> = new Map();
  private startTime: number = 0;
  private deltaSync: DeltaSync | null = null;
  private dataRepair: DataRepair | null = null;
  private slaReporter: SLAReporter | null = null;
  private migrator: DataMigrator | null = null;

  constructor(config: MigrationConfig, callbacks: MigrationCallbacks = {}) {
    this.mysqlClient = new MySQLClient(config.source);
    this.pgClient = new PostgreSQLClient(config.target);
    this.config = config;
    this.callbacks = callbacks;
    this.slaReporter = new SLAReporter(config);
  }

  async migrateSchemas(): Promise<void> {
    for (const tableConfig of this.config.tables) {
      console.log(`Migrating schema for table: ${tableConfig.sourceTable}`);
      
      const schema = await this.mysqlClient.getTableSchema(tableConfig.sourceTable);
      const ddl = generatePostgreSQLDDL({ ...schema, tableName: tableConfig.targetTable });
      
      const tableExists = await this.pgClient.tableExists(tableConfig.targetTable);
      if (!tableExists) {
        await this.pgClient.createTable(tableConfig.targetTable, ddl);
        console.log(`Created table: ${tableConfig.targetTable}`);
      } else {
        console.log(`Table already exists: ${tableConfig.targetTable}`);
      }
      
      if (this.callbacks.onSchemaMigrate) {
        this.callbacks.onSchemaMigrate(tableConfig.sourceTable);
      }
    }
  }

  async migrateData(): Promise<void> {
    this.startTime = Date.now();
    
    const onProgress = (progress: MigrationProgress) => {
      this.progressMap.set(progress.tableName, progress);
      if (this.slaReporter) {
        this.slaReporter.recordProgress(progress);
      }
      if (this.callbacks.onProgress) {
        this.callbacks.onProgress(progress);
      }
      this.emitStats();
    };

    this.migrator = new DataMigrator(this.mysqlClient, this.pgClient, this.config, onProgress);
    await this.migrator.loadCheckpoints();
    await this.migrator.migrateAll();

    if (this.config.validate) {
      const validator = new DataValidator(this.mysqlClient, this.pgClient, onProgress);
      
      for (const tableConfig of this.config.tables) {
        const checkpoint = this.migrator['checkpoints'].get(tableConfig.sourceTable);
        if (checkpoint && checkpoint.status === 'migrated') {
          const schema = await this.mysqlClient.getTableSchema(tableConfig.sourceTable);
          await validator.validateTable(tableConfig, schema, checkpoint);
          if (this.slaReporter) {
            this.slaReporter.recordCheckpoint(checkpoint);
          }
        }
      }
    }

    this.generateSLAReport();

    if (this.callbacks.onComplete) {
      this.callbacks.onComplete();
    }
  }

  startDeltaSync(timestampColumn?: string, versionColumn?: string): void {
    if (this.deltaSync) {
      console.log('Delta sync already running');
      return;
    }

    this.deltaSync = new DeltaSync(
      this.mysqlClient,
      this.pgClient,
      this.callbacks.onDeltaChange,
      this.callbacks.onDeltaStatus
    );

    for (const tableConfig of this.config.tables) {
      this.deltaSync.addTable(tableConfig, timestampColumn, versionColumn);
    }

    this.deltaSync.start();
    console.log('Delta sync started');
  }

  stopDeltaSync(): void {
    if (this.deltaSync) {
      this.deltaSync.stop();
      this.deltaSync = null;
      console.log('Delta sync stopped');
    }
  }

  getDeltaSyncStatuses(): DeltaSyncStatus[] {
    return this.deltaSync ? this.deltaSync.getAllStatuses() : [];
  }

  async createRepairSession(
    tableName: string,
    mismatches: any[],
    sourceRows: Map<string | number, any>,
    targetRows: Map<string | number, any>
  ): Promise<RepairSession> {
    if (!this.dataRepair) {
      this.dataRepair = new DataRepair(this.pgClient);
    }

    const schema = await this.mysqlClient.getTableSchema(tableName);
    const tableConfig = this.config.tables.find(t => t.sourceTable === tableName);
    if (!tableConfig) {
      throw new Error(`Table ${tableName} not found in config`);
    }

    return this.dataRepair.createRepairSession(
      tableConfig.targetTable,
      schema,
      mismatches,
      sourceRows,
      targetRows,
      tableConfig.primaryKey
    );
  }

  async confirmAndExecuteRepairs(sessionId: string, interactive: boolean = false): Promise<{ success: number; failed: number }> {
    if (!this.dataRepair) {
      throw new Error('No repair session active');
    }

    if (interactive) {
      await this.dataRepair.interactiveConfirm(sessionId);
    } else {
      this.dataRepair.confirmAll(sessionId, true);
    }

    const result = await this.dataRepair.executeAll(sessionId);
    const report = this.dataRepair.generateReport(sessionId);
    console.log(report);

    return result;
  }

  getRepairSession(sessionId: string): RepairSession | undefined {
    return this.dataRepair?.getSession(sessionId);
  }

  saveRepairSession(sessionId: string, filePath: string): Promise<void> {
    if (!this.dataRepair) {
      throw new Error('No repair session active');
    }
    return this.dataRepair.saveSession(sessionId, filePath);
  }

  generateSLAReport(): SLAReport | null {
    if (!this.slaReporter) return null;

    const report = this.slaReporter.generateReport();
    const formattedReport = this.slaReporter.formatReport(report);
    console.log(formattedReport);

    if (this.callbacks.onSLAReport) {
      this.callbacks.onSLAReport(report);
    }

    return report;
  }

  async saveSLAReport(filePath: string): Promise<void> {
    if (!this.slaReporter) return;
    const report = this.slaReporter.generateReport();
    await this.slaReporter.saveReport(report, filePath);
    console.log(`SLA report saved to ${filePath}`);
  }

  private emitStats(): void {
    if (!this.callbacks.onStats) return;

    const tables = Array.from(this.progressMap.values());
    const totalRows = tables.reduce((sum, t) => sum + t.totalRows, 0);
    const totalMigratedRows = tables.reduce((sum, t) => sum + t.migratedRows, 0);
    const totalFailedRows = tables.reduce((sum, t) => sum + t.failedRows, 0);
    const totalValidatedRows = tables.reduce((sum, t) => sum + t.validatedRows, 0);
    const totalValidationFailedRows = tables.reduce((sum, t) => sum + t.validationFailedRows, 0);
    const completedTables = tables.filter(t => t.status === 'completed').length;

    const stats: MigrationStats = {
      totalTables: this.config.tables.length,
      completedTables,
      totalRows,
      totalMigratedRows,
      totalFailedRows,
      totalValidatedRows,
      totalValidationFailedRows,
      startTime: this.startTime,
      elapsedTime: Date.now() - this.startTime,
      tables
    };

    this.callbacks.onStats(stats);
  }

  getMigrator(): DataMigrator | null {
    return this.migrator;
  }

  getMySQLClient(): MySQLClient {
    return this.mysqlClient;
  }

  getPostgreSQLClient(): PostgreSQLClient {
    return this.pgClient;
  }

  async close(): Promise<void> {
    this.stopDeltaSync();
    await this.mysqlClient.close();
    await this.pgClient.close();
  }
}
