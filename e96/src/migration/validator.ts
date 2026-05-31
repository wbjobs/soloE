import * as crypto from 'crypto';
import * as fs from 'fs-extra';
import { MySQLClient } from '../db/mysql';
import { PostgreSQLClient } from '../db/postgresql';
import { Checkpoint, RowValidationResult, TableConfig, TableSchema } from '../types';

interface ChunkValidationResult {
  chunkId: number;
  minPk: string | number;
  maxPk: string | number;
  sourceMd5: string;
  targetMd5: string;
  match: boolean;
  rowCount: number;
  mismatches: RowValidationResult[];
}

export class DataValidator {
  private mysqlClient: MySQLClient;
  private pgClient: PostgreSQLClient;
  private onProgress?: (progress: any) => void;
  private chunkSize: number = 10000;

  constructor(
    mysqlClient: MySQLClient,
    pgClient: PostgreSQLClient,
    onProgress?: (progress: any) => void
  ) {
    this.mysqlClient = mysqlClient;
    this.pgClient = pgClient;
    this.onProgress = onProgress;
  }

  calculateRowMd5(row: any, columns: string[]): string {
    const sortedColumns = [...columns].sort();
    const sortedValues = sortedColumns.map(col => {
      const value = row[col];
      if (value === null || value === undefined) {
        return 'NULL';
      }
      if (value instanceof Buffer) {
        return value.toString('base64');
      }
      if (value instanceof Date) {
        return value.toISOString();
      }
      return String(value);
    }).join('|');

    return crypto.createHash('md5').update(sortedValues).digest('hex');
  }

  calculateChunkMd5(rows: any[], columns: string[]): string {
    const hash = crypto.createHash('md5');
    const sortedColumns = [...columns].sort();
    
    for (const row of rows) {
      const sortedValues = sortedColumns.map(col => {
        const value = row[col];
        if (value === null || value === undefined) {
          return 'NULL';
        }
        if (value instanceof Buffer) {
          return value.toString('base64');
        }
        if (value instanceof Date) {
          return value.toISOString();
        }
        return String(value);
      }).join('|');
      hash.update(sortedValues + '\n');
    }

    return hash.digest('hex');
  }

  async validateChunk(
    tableConfig: TableConfig,
    columns: string[],
    minPk: string | number,
    maxPk: string | number
  ): Promise<ChunkValidationResult> {
    const [sourceRows, targetRows] = await Promise.all([
      this.mysqlClient.getRowsByPkRange(
        tableConfig.sourceTable,
        tableConfig.primaryKey,
        minPk,
        maxPk,
        tableConfig.columns
      ),
      this.pgClient.getRowsByPkRange(
        tableConfig.targetTable,
        tableConfig.primaryKey,
        minPk,
        maxPk,
        tableConfig.columns
      )
    ]);

    const sourceMd5 = this.calculateChunkMd5(sourceRows, columns);
    const targetMd5 = this.calculateChunkMd5(targetRows, columns);

    const match = sourceMd5 === targetMd5 && sourceRows.length === targetRows.length;
    const mismatches: RowValidationResult[] = [];

    if (!match) {
      const targetMap = new Map<string | number, any>();
      for (const targetRow of targetRows) {
        const pk = targetRow[tableConfig.primaryKey];
        targetMap.set(pk, targetRow);
      }

      for (const sourceRow of sourceRows) {
        const pk = sourceRow[tableConfig.primaryKey];
        const targetRow = targetMap.get(pk);

        if (!targetRow) {
          mismatches.push({
            primaryKey: pk,
            sourceMd5: this.calculateRowMd5(sourceRow, columns),
            targetMd5: 'MISSING',
            match: false,
            differences: ['Row missing in target']
          });
          continue;
        }

        const sourceRowMd5 = this.calculateRowMd5(sourceRow, columns);
        const targetRowMd5 = this.calculateRowMd5(targetRow, columns);

        if (sourceRowMd5 !== targetRowMd5) {
          const differences: string[] = [];
          for (const col of columns) {
            const sourceVal = sourceRow[col];
            const targetVal = targetRow[col];
            
            const sourceStr = sourceVal === null || sourceVal === undefined ? 'NULL' : String(sourceVal);
            const targetStr = targetVal === null || targetVal === undefined ? 'NULL' : String(targetVal);
            
            if (sourceStr !== targetStr) {
              differences.push(`${col}: source="${sourceStr}" target="${targetStr}"`);
            }
          }
          mismatches.push({
            primaryKey: pk,
            sourceMd5: sourceRowMd5,
            targetMd5: targetRowMd5,
            match: false,
            differences
          });
        }

        targetMap.delete(pk);
      }

      for (const [pk, targetRow] of targetMap) {
        mismatches.push({
          primaryKey: pk,
          sourceMd5: 'MISSING',
          targetMd5: this.calculateRowMd5(targetRow, columns),
          match: false,
          differences: ['Row missing in source']
        });
      }
    }

    return {
      chunkId: 0,
      minPk,
      maxPk,
      sourceMd5,
      targetMd5,
      match,
      rowCount: sourceRows.length,
      mismatches
    };
  }

  async validateTable(
    tableConfig: TableConfig,
    schema: TableSchema,
    checkpoint: Checkpoint
  ): Promise<RowValidationResult[]> {
    const batchSize = tableConfig.batchSize || 1000;
    const columns = schema.columns.map(c => c.name);
    let validatedRows = checkpoint.validatedRows;
    let validationFailedRows = checkpoint.validationFailedRows;
    const allMismatches: RowValidationResult[] = [];
    const startTime = Date.now();

    checkpoint.status = 'validating';
    this.emitProgress(tableConfig.sourceTable, schema.rowCount, validatedRows, validationFailedRows, 'validating', startTime);

    try {
      const { min, max } = await this.mysqlClient.getMinMaxPk(tableConfig.sourceTable, tableConfig.primaryKey);
      
      if (min === null || max === null) {
        console.log(`Table ${tableConfig.sourceTable} is empty, skipping validation...`);
        checkpoint.status = 'completed';
        checkpoint.endTime = Date.now();
        return [];
      }

      const chunkSize = this.chunkSize;
      let currentMinPk = min;
      let chunkCount = 0;
      let lastProgressEmit = Date.now();
      const progressEmitInterval = 1000;

      while (true) {
        const chunkEnd = this.calculateChunkEnd(currentMinPk, max, chunkSize);
        
        const chunkResult = await this.validateChunk(
          tableConfig,
          columns,
          currentMinPk,
          chunkEnd
        );

        validatedRows += chunkResult.rowCount;
        
        if (!chunkResult.match) {
          validationFailedRows += chunkResult.mismatches.length;
          allMismatches.push(...chunkResult.mismatches);
          
          if (chunkResult.mismatches.length > 0) {
            const mismatchFile = `./mismatches-${tableConfig.sourceTable}-chunk-${chunkCount}.json`;
            await fs.writeJson(mismatchFile, chunkResult.mismatches, { spaces: 2 });
            console.log(`Found ${chunkResult.mismatches.length} mismatches in chunk ${chunkCount}, saved to ${mismatchFile}`);
          }
        }

        checkpoint.validatedRows = validatedRows;
        checkpoint.validationFailedRows = validationFailedRows;
        chunkCount++;

        const now = Date.now();
        if (now - lastProgressEmit >= progressEmitInterval) {
          this.emitProgress(tableConfig.sourceTable, schema.rowCount, validatedRows, validationFailedRows, 'validating', startTime);
          lastProgressEmit = now;
        }

        if (this.isPkGreaterOrEqual(chunkEnd, max)) {
          break;
        }

        currentMinPk = this.getNextPk(chunkEnd);
      }

      checkpoint.status = 'completed';
      checkpoint.endTime = Date.now();
      this.emitProgress(tableConfig.sourceTable, schema.rowCount, validatedRows, validationFailedRows, 'completed', startTime);

      return allMismatches;
    } catch (error) {
      console.error(`Validation failed for table ${tableConfig.sourceTable}: ${error}`);
      checkpoint.status = 'failed';
      checkpoint.endTime = Date.now();
      throw error;
    }
  }

  private calculateChunkEnd(currentMin: string | number, max: string | number, chunkSize: number): string | number {
    if (typeof currentMin === 'number' && typeof max === 'number') {
      return Math.min(currentMin + chunkSize - 1, max);
    }
    return max;
  }

  private isPkGreaterOrEqual(a: string | number, b: string | number): boolean {
    if (typeof a === 'number' && typeof b === 'number') {
      return a >= b;
    }
    return String(a) >= String(b);
  }

  private getNextPk(pk: string | number): string | number {
    if (typeof pk === 'number') {
      return pk + 1;
    }
    return pk + '\0';
  }

  private emitProgress(
    tableName: string,
    totalRows: number,
    validatedRows: number,
    validationFailedRows: number,
    status: string,
    startTime: number
  ): void {
    if (!this.onProgress) return;

    const elapsedTime = Date.now() - startTime;
    const rowsPerSecond = elapsedTime > 0 ? (validatedRows * 1000) / elapsedTime : 0;
    const remainingRows = totalRows - validatedRows;
    const estimatedRemainingTime = rowsPerSecond > 0 ? (remainingRows / rowsPerSecond) * 1000 : 0;

    this.onProgress({
      tableName,
      totalRows,
      migratedRows: totalRows,
      failedRows: 0,
      validatedRows,
      validationFailedRows,
      status,
      elapsedTime,
      estimatedRemainingTime,
      rowsPerSecond
    });
  }
}
