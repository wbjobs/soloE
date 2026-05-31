import mysql, { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { Readable } from 'stream';
import { MySQLConfig, ColumnInfo, TableSchema } from '../types';

export class MySQLClient {
  private pool: Pool;
  private config: MySQLConfig;

  constructor(config: MySQLConfig) {
    this.config = config;
    this.pool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      connectionLimit: 20,
      waitForConnections: true,
      queueLimit: 0
    });
  }

  async getConnection(): Promise<PoolConnection> {
    return this.pool.getConnection();
  }

  async query<T = RowDataPacket[]>(sql: string, params?: any[]): Promise<T> {
    const [rows] = await this.pool.execute(sql, params);
    return rows as T;
  }

  async getTableSchema(tableName: string): Promise<TableSchema> {
    const columnsSql = `
      SELECT 
        COLUMN_NAME as name,
        DATA_TYPE as dataType,
        COLUMN_TYPE as type,
        IS_NULLABLE as isNullable,
        COLUMN_DEFAULT as defaultValue,
        CHARACTER_MAXIMUM_LENGTH as maxLength,
        NUMERIC_PRECISION as numericPrecision,
        NUMERIC_SCALE as numericScale
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION
    `;

    const pkSql = `
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY'
      ORDER BY ORDINAL_POSITION
    `;

    const countSql = `SELECT COUNT(*) as count FROM ??`;

    const [columns, pkRows, countRows] = await Promise.all([
      this.query<RowDataPacket[]>(columnsSql, [this.config.database, tableName]),
      this.query<RowDataPacket[]>(pkSql, [this.config.database, tableName]),
      this.query<RowDataPacket[]>(countSql, [tableName])
    ]);

    const columnInfo: ColumnInfo[] = columns.map((col: any) => ({
      name: col.name,
      type: col.type,
      dataType: col.dataType,
      isNullable: col.isNullable === 'YES',
      defaultValue: col.defaultValue,
      maxLength: col.maxLength,
      numericPrecision: col.numericPrecision,
      numericScale: col.numericScale
    }));

    const primaryKey = pkRows.map((row: any) => row.COLUMN_NAME);
    const rowCount = (countRows[0] as any).count as number;

    return {
      tableName,
      columns: columnInfo,
      primaryKey,
      rowCount
    };
  }

  async getRowsBatch(
    tableName: string,
    primaryKey: string,
    lastPk: string | number | null,
    batchSize: number,
    columns?: string[]
  ): Promise<any[]> {
    const cols = columns ? columns.map(c => `??`).join(', ') : '*';
    const whereClause = lastPk !== null ? 'WHERE ?? > ?' : '';
    const sql = `SELECT ${cols} FROM ?? ${whereClause} ORDER BY ?? ASC LIMIT ?`;
    const params: any[] = columns ? [...columns, tableName] : [tableName];
    if (lastPk !== null) {
      params.push(primaryKey, lastPk);
    }
    params.push(primaryKey, batchSize);
    return this.query(sql, params);
  }

  async getRowsByPkRange(
    tableName: string,
    primaryKey: string,
    minPk: string | number,
    maxPk: string | number,
    columns?: string[]
  ): Promise<any[]> {
    const cols = columns ? columns.map(c => `??`).join(', ') : '*';
    const sql = `SELECT ${cols} FROM ?? WHERE ?? >= ? AND ?? <= ? ORDER BY ?? ASC`;
    const params: any[] = columns ? [...columns, tableName] : [tableName];
    params.push(primaryKey, minPk, primaryKey, maxPk, primaryKey);
    return this.query(sql, params);
  }

  async getMinMaxPk(tableName: string, primaryKey: string): Promise<{ min: string | number | null; max: string | number | null }> {
    const sql = `SELECT MIN(??) as minPk, MAX(??) as maxPk FROM ??`;
    const result = await this.query<RowDataPacket[]>(sql, [primaryKey, primaryKey, tableName]);
    const row = result[0] as any;
    return { min: row.minPk, max: row.maxPk };
  }

  streamRows(
    tableName: string,
    primaryKey: string,
    lastPk: string | number | null,
    batchSize: number,
    columns?: string[]
  ): Readable {
    let currentLastPk = lastPk;
    let isReading = false;
    let hasMore = true;
    const pool = this.pool;

    const stream = new Readable({
      objectMode: true,
      highWaterMark: batchSize * 2,
      async read() {
        if (isReading || !hasMore) return;
        isReading = true;

        try {
          const cols = columns ? columns.map(c => `??`).join(', ') : '*';
          const whereClause = currentLastPk !== null ? 'WHERE ?? > ?' : '';
          const sql = `SELECT ${cols} FROM ?? ${whereClause} ORDER BY ?? ASC LIMIT ?`;
          const params: any[] = columns ? [...columns, tableName] : [tableName];
          if (currentLastPk !== null) {
            params.push(primaryKey, currentLastPk);
          }
          params.push(primaryKey, batchSize);

          const [rows] = await pool.execute(sql, params);
          const rowArray = rows as any[];

          if (rowArray.length === 0) {
            hasMore = false;
            this.push(null);
            return;
          }

          currentLastPk = rowArray[rowArray.length - 1][primaryKey];

          for (const row of rowArray) {
            if (!this.push(row)) {
              break;
            }
          }

          if (rowArray.length < batchSize) {
            hasMore = false;
            this.push(null);
          }
        } catch (error) {
          this.emit('error', error);
        } finally {
          isReading = false;
        }
      }
    });

    return stream;
  }

  async getRowsByPk(tableName: string, primaryKey: string, pkValues: (string | number)[], columns?: string[]): Promise<any[]> {
    const cols = columns ? columns.map(c => `??`).join(', ') : '*';
    const placeholders = pkValues.map(() => '?').join(',');
    const sql = `SELECT ${cols} FROM ?? WHERE ?? IN (${placeholders}) ORDER BY ?? ASC`;
    const params: any[] = columns ? [...columns, tableName, primaryKey] : [tableName, primaryKey];
    params.push(...pkValues, primaryKey);
    return this.query(sql, params);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
