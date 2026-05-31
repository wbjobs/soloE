import * as fs from 'fs-extra';
import pLimit from 'p-limit';
import { pipeline, Readable, Writable, Transform } from 'stream';
import { promisify } from 'util';
import { MySQLClient } from '../db/mysql';
import { PostgreSQLClient } from '../db/postgresql';
import { Checkpoint, MigrationConfig, TableConfig, TableSchema } from '../types';
import { convertMySQLValueToPostgreSQL } from './schema';

const pipelineAsync = promisify(pipeline);

export class DataMigrator {
  private mysqlClient: MySQLClient;
  private pgClient: PostgreSQLClient;
  private config: MigrationConfig;
  private checkpoints: Map<string, Checkpoint> = new Map();
  private onProgress?: (progress: any) => void;
  private rateLimit: number;
  private lastRequestTime: number = 0;

  constructor(
    mysqlClient: MySQLClient,
    pgClient: PostgreSQLClient,
    config: MigrationConfig,
    onProgress?: (progress: any) => void
  ) {
    this.mysqlClient = mysqlClient;
    this.pgClient = pgClient;
    this.config = config;
    this.onProgress = onProgress;
    this.rateLimit = config.rateLimit || 1000;
  }

  async loadCheckpoints(): Promise<void> {
    const checkpointPath = this.config.checkpointPath || './checkpoint.json';
    try {
      if (await fs.pathExists(checkpointPath)) {
        const data = await fs.readJson(checkpointPath);
        this.checkpoints = new Map(Object.entries(data));
      }
    } catch (error) {
      console.warn(`Failed to load checkpoints: ${error}`);
    }
  }

  async saveCheckpoint(tableName: string, checkpoint: Checkpoint): Promise<void> {
    this.checkpoints.set(tableName, checkpoint);
    const checkpointPath = this.config.checkpointPath || './checkpoint.json';
    try {
      const data: Record<string, Checkpoint> = {};
      this.checkpoints.forEach((value, key) => {
        data[key] = value;
      });
      await fs.writeJson(checkpointPath, data, { spaces: 2 });
    } catch (error) {
      console.warn(`Failed to save checkpoint: ${error}`);
    }
  }

  private async rateLimitWait(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    const minInterval = 1000 / this.rateLimit;
    if (elapsed < minInterval) {
      await new Promise(resolve => setTimeout(resolve, minInterval - elapsed));
    }
    this.lastRequestTime = Date.now();
  }

  private getOrCreateCheckpoint(tableName: string): Checkpoint {
    if (this.checkpoints.has(tableName)) {
      return this.checkpoints.get(tableName)!;
    }
    return {
      tableName,
      lastPrimaryKey: null,
      migratedRows: 0,
      failedRows: 0,
      validatedRows: 0,
      validationFailedRows: 0,
      status: 'pending',
      startTime: Date.now()
    };
  }

  async migrateTable(tableConfig: TableConfig, schema: TableSchema): Promise<Checkpoint> {
    const checkpoint = this.getOrCreateCheckpoint(tableConfig.sourceTable);
    
    if (checkpoint.status === 'completed' || checkpoint.status === 'migrated') {
      console.log(`Table ${tableConfig.sourceTable} already migrated, skipping...`);
      return checkpoint;
    }

    checkpoint.status = 'migrating';
    checkpoint.startTime = checkpoint.startTime || Date.now();
    await this.saveCheckpoint(tableConfig.sourceTable, checkpoint);

    const batchSize = tableConfig.batchSize || 1000;
    let lastPk = checkpoint.lastPrimaryKey;
    let migratedRows = checkpoint.migratedRows;
    let failedRows = checkpoint.failedRows;
    const columns = schema.columns.map(c => c.name);
    let lastProgressEmit = Date.now();
    const progressEmitInterval = 1000;

    this.emitProgress(tableConfig.sourceTable, schema.rowCount, migratedRows, failedRows, 'migrating', checkpoint.startTime);

    try {
      const { min, max } = await this.mysqlClient.getMinMaxPk(tableConfig.sourceTable, tableConfig.primaryKey);
      
      if (min === null || max === null) {
        console.log(`Table ${tableConfig.sourceTable} is empty, skipping...`);
        checkpoint.status = 'migrated';
        checkpoint.endTime = Date.now();
        await this.saveCheckpoint(tableConfig.sourceTable, checkpoint);
        return checkpoint;
      }

      let currentPk = lastPk !== null ? lastPk : (typeof min === 'number' ? min - 1 : String.fromCharCode(min.charCodeAt(0) - 1));
      let batchCount = 0;

      while (true) {
        await this.rateLimitWait();

        let rows: any[];
        try {
          rows = await this.mysqlClient.getRowsBatch(
            tableConfig.sourceTable,
            tableConfig.primaryKey,
            currentPk,
            batchSize,
            tableConfig.columns
          );
        } catch (error) {
          console.error(`Error fetching rows from MySQL: ${error}`);
          checkpoint.status = 'failed';
          checkpoint.endTime = Date.now();
          await this.saveCheckpoint(tableConfig.sourceTable, checkpoint);
          throw error;
        }

        if (rows.length === 0) {
          break;
        }

        const convertedRows = rows.map(row => convertMySQLValueToPostgreSQL(row, schema.columns));

        try {
          await this.pgClient.insertBatch(
            tableConfig.targetTable,
            columns,
            convertedRows
          );
          
          migratedRows += rows.length;
          currentPk = rows[rows.length - 1][tableConfig.primaryKey];
          batchCount++;

          checkpoint.lastPrimaryKey = currentPk;
          checkpoint.migratedRows = migratedRows;

          if (batchCount % 10 === 0) {
            await this.saveCheckpoint(tableConfig.sourceTable, checkpoint);
          }

          const now = Date.now();
          if (now - lastProgressEmit >= progressEmitInterval) {
            this.emitProgress(tableConfig.sourceTable, schema.rowCount, migratedRows, failedRows, 'migrating', checkpoint.startTime);
            lastProgressEmit = now;
          }
        } catch (error) {
          console.error(`Error inserting rows into PostgreSQL: ${error}`);
          failedRows += rows.length;
          checkpoint.failedRows = failedRows;
          await this.saveCheckpoint(tableConfig.sourceTable, checkpoint);
        }
      }

      checkpoint.status = 'migrated';
      checkpoint.endTime = Date.now();
      await this.saveCheckpoint(tableConfig.sourceTable, checkpoint);
      this.emitProgress(tableConfig.sourceTable, schema.rowCount, migratedRows, failedRows, 'migrated', checkpoint.startTime);

      return checkpoint;
    } catch (error) {
      checkpoint.status = 'failed';
      checkpoint.endTime = Date.now();
      await this.saveCheckpoint(tableConfig.sourceTable, checkpoint);
      throw error;
    }
  }

  async migrateTableStreaming(tableConfig: TableConfig, schema: TableSchema): Promise<Checkpoint> {
    const checkpoint = this.getOrCreateCheckpoint(tableConfig.sourceTable);
    
    if (checkpoint.status === 'completed' || checkpoint.status === 'migrated') {
      console.log(`Table ${tableConfig.sourceTable} already migrated, skipping...`);
      return checkpoint;
    }

    checkpoint.status = 'migrating';
    checkpoint.startTime = checkpoint.startTime || Date.now();
    await this.saveCheckpoint(tableConfig.sourceTable, checkpoint);

    const batchSize = tableConfig.batchSize || 1000;
    let migratedRows = checkpoint.migratedRows;
    let failedRows = checkpoint.failedRows;
    let lastPk = checkpoint.lastPrimaryKey;
    const columns = schema.columns.map(c => c.name);
    let lastProgressEmit = Date.now();
    const progressEmitInterval = 1000;

    this.emitProgress(tableConfig.sourceTable, schema.rowCount, migratedRows, failedRows, 'migrating', checkpoint.startTime);

    try {
      const sourceStream = this.mysqlClient.streamRows(
        tableConfig.sourceTable,
        tableConfig.primaryKey,
        lastPk,
        batchSize,
        tableConfig.columns
      );

      const convertTransform = new Transform({
        objectMode: true,
        transform: (row: any, encoding: BufferEncoding, callback: (error?: Error | null, data?: any) => void) => {
          try {
            const converted = convertMySQLValueToPostgreSQL(row, schema.columns);
            callback(null, converted);
          } catch (error) {
            callback(error as Error);
          }
        }
      });

      let batchBuffer: any[] = [];
      let lastRowPk: any = null;

      const writeTransform = new Writable({
        objectMode: true,
        highWaterMark: batchSize * 2,
        write: async (row: any, encoding: BufferEncoding, callback: (error?: Error | null) => void) => {
          batchBuffer.push(row);
          lastRowPk = row[tableConfig.primaryKey];

          if (batchBuffer.length >= batchSize) {
            try {
              await this.pgClient.insertBatch(tableConfig.targetTable, columns, batchBuffer);
              migratedRows += batchBuffer.length;
              lastPk = lastRowPk;
              checkpoint.lastPrimaryKey = lastPk;
              checkpoint.migratedRows = migratedRows;
              
              batchBuffer = [];
              
              const now = Date.now();
              if (now - lastProgressEmit >= progressEmitInterval) {
                await this.saveCheckpoint(tableConfig.sourceTable, checkpoint);
                this.emitProgress(tableConfig.sourceTable, schema.rowCount, migratedRows, failedRows, 'migrating', checkpoint.startTime);
                lastProgressEmit = now;
              }
              
              callback();
            } catch (error) {
              failedRows += batchBuffer.length;
              checkpoint.failedRows = failedRows;
              await this.saveCheckpoint(tableConfig.sourceTable, checkpoint);
              callback(error as Error);
            }
          } else {
            callback();
          }
        },
        final: async (callback: (error?: Error | null) => void) => {
          if (batchBuffer.length > 0) {
            try {
              await this.pgClient.insertBatch(tableConfig.targetTable, columns, batchBuffer);
              migratedRows += batchBuffer.length;
              checkpoint.lastPrimaryKey = lastRowPk;
              checkpoint.migratedRows = migratedRows;
              await this.saveCheckpoint(tableConfig.sourceTable, checkpoint);
              this.emitProgress(tableConfig.sourceTable, schema.rowCount, migratedRows, failedRows, 'migrating', checkpoint.startTime);
              callback();
            } catch (error) {
              failedRows += batchBuffer.length;
              checkpoint.failedRows = failedRows;
              await this.saveCheckpoint(tableConfig.sourceTable, checkpoint);
              callback(error as Error);
            }
          } else {
            callback();
          }
        }
      });

      await pipelineAsync(sourceStream, convertTransform, writeTransform);

      checkpoint.status = 'migrated';
      checkpoint.endTime = Date.now();
      await this.saveCheckpoint(tableConfig.sourceTable, checkpoint);
      this.emitProgress(tableConfig.sourceTable, schema.rowCount, migratedRows, failedRows, 'migrated', checkpoint.startTime);

      return checkpoint;
    } catch (error) {
      console.error(`Streaming migration failed: ${error}`);
      checkpoint.status = 'failed';
      checkpoint.endTime = Date.now();
      await this.saveCheckpoint(tableConfig.sourceTable, checkpoint);
      throw error;
    }
  }

  async migrateAll(): Promise<void> {
    const concurrency = this.config.concurrency || 1;
    const limit = pLimit(concurrency);

    const tableSchemas = await Promise.all(
      this.config.tables.map(async table => {
        const schema = await this.mysqlClient.getTableSchema(table.sourceTable);
        return { table, schema };
      })
    );

    const migrationPromises = tableSchemas.map(({ table, schema }) =>
      limit(async () => {
        console.log(`Starting migration for table: ${table.sourceTable}`);
        await this.migrateTable(table, schema);
        console.log(`Completed migration for table: ${table.sourceTable}`);
      })
    );

    await Promise.all(migrationPromises);
  }

  private emitProgress(
    tableName: string,
    totalRows: number,
    migratedRows: number,
    failedRows: number,
    status: string,
    startTime: number
  ): void {
    if (!this.onProgress) return;

    const elapsedTime = Date.now() - startTime;
    const rowsPerSecond = elapsedTime > 0 ? (migratedRows * 1000) / elapsedTime : 0;
    const remainingRows = totalRows - migratedRows;
    const estimatedRemainingTime = rowsPerSecond > 0 ? (remainingRows / rowsPerSecond) * 1000 : 0;

    this.onProgress({
      tableName,
      totalRows,
      migratedRows,
      failedRows,
      validatedRows: 0,
      validationFailedRows: 0,
      status,
      elapsedTime,
      estimatedRemainingTime,
      rowsPerSecond
    });
  }
}
