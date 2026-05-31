import { Pool, PoolClient, QueryResult } from 'pg';
import { Readable, Writable } from 'stream';
import { PostgreSQLConfig, ColumnInfo, TableSchema } from '../types';

export class PostgreSQLClient {
  private pool: Pool;
  private config: PostgreSQLConfig;

  constructor(config: PostgreSQLConfig) {
    this.config = config;
    this.pool = new Pool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      max: 20
    });
  }

  async getConnection(): Promise<PoolClient> {
    return this.pool.connect();
  }

  async query(sql: string, params?: any[]): Promise<any[]> {
    const result = await this.pool.query(sql, params);
    return result.rows;
  }

  async execute(sql: string, params?: any[]): Promise<number> {
    const result = await this.pool.query(sql, params);
    return result.rowCount || 0;
  }

  async getTableSchema(tableName: string): Promise<TableSchema | null> {
    const columnsSql = `
      SELECT 
        column_name as "name",
        data_type as "dataType",
        udt_name as "type",
        is_nullable as "isNullable",
        column_default as "defaultValue",
        character_maximum_length as "maxLength",
        numeric_precision as "numericPrecision",
        numeric_scale as "numericScale"
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position
    `;

    const pkSql = `
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
      WHERE tc.table_schema = 'public' 
        AND tc.table_name = $1 
        AND tc.constraint_type = 'PRIMARY KEY'
      ORDER BY kcu.ordinal_position
    `;

    const countSql = `SELECT COUNT(*) as count FROM "${tableName}"`;

    try {
      const [columns, pkRows, countRows] = await Promise.all([
        this.query(columnsSql, [tableName]),
        this.query(pkSql, [tableName]),
        this.query(countSql)
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

      const primaryKey = pkRows.map((row: any) => row.column_name);
      const rowCount = parseInt(countRows[0].count, 10);

      return {
        tableName,
        columns: columnInfo,
        primaryKey,
        rowCount
      };
    } catch (error) {
      return null;
    }
  }

  async getRowsByPkRange(
    tableName: string,
    primaryKey: string,
    minPk: string | number,
    maxPk: string | number,
    columns?: string[]
  ): Promise<any[]> {
    const cols = columns ? columns.map(c => `"${c}"`).join(', ') : '*';
    const sql = `SELECT ${cols} FROM "${tableName}" WHERE "${primaryKey}" >= $1 AND "${primaryKey}" <= $2 ORDER BY "${primaryKey}" ASC`;
    return this.query(sql, [minPk, maxPk]);
  }

  async getRowsByPk(tableName: string, primaryKey: string, pkValues: (string | number)[], columns?: string[]): Promise<any[]> {
    const cols = columns ? columns.map(c => `"${c}"`).join(', ') : '*';
    const placeholders = pkValues.map((_, i) => `$${i + 1}`).join(',');
    const sql = `SELECT ${cols} FROM "${tableName}" WHERE "${primaryKey}" IN (${placeholders}) ORDER BY "${primaryKey}" ASC`;
    return this.query(sql, pkValues);
  }

  async insertBatch(tableName: string, columns: string[], rows: any[]): Promise<number> {
    if (rows.length === 0) return 0;

    const columnList = columns.map(c => `"${c}"`).join(', ');
    const valuePlaceholders = rows.map((_, rowIndex) => {
      return `(${columns.map((_, colIndex) => `$${rowIndex * columns.length + colIndex + 1}`).join(', ')})`;
    }).join(', ');

    const values: any[] = [];
    rows.forEach(row => {
      columns.forEach(col => {
        values.push(row[col]);
      });
    });

    const sql = `INSERT INTO "${tableName}" (${columnList}) VALUES ${valuePlaceholders} ON CONFLICT DO NOTHING`;
    return this.execute(sql, values);
  }

  createCopyStream(tableName: string, columns: string[]): Writable {
    const columnList = columns.map(c => `"${c}"`).join(', ');
    let buffer: any[] = [];
    const flushSize = 1000;
    let isFlushing = false;
    let hasEnded = false;

    const flush = async (): Promise<void> => {
      if (buffer.length === 0 || isFlushing) return;
      isFlushing = true;
      const batch = buffer.splice(0, Math.min(flushSize, buffer.length));

      try {
        const valuePlaceholders = batch.map((_, rowIndex) => {
          return `(${columns.map((_, colIndex) => `$${rowIndex * columns.length + colIndex + 1}`).join(', ')})`;
        }).join(', ');

        const values: any[] = [];
        batch.forEach(row => {
          columns.forEach(col => {
            values.push(row[col]);
          });
        });

        const sql = `INSERT INTO "${tableName}" (${columnList}) VALUES ${valuePlaceholders} ON CONFLICT DO NOTHING`;
        await this.execute(sql, values);
      } catch (error) {
        console.error(`Error in copy stream: ${error}`);
        throw error;
      } finally {
        isFlushing = false;
      }
    };

    const stream = new Writable({
      objectMode: true,
      highWaterMark: 2000,
      async write(row: any, encoding: BufferEncoding, callback: (error?: Error | null) => void) {
        buffer.push(row);
        if (buffer.length >= flushSize) {
          try {
            await flush();
            callback();
          } catch (error) {
            callback(error as Error);
          }
        } else {
          callback();
        }
      },
      async final(callback: (error?: Error | null) => void) {
        hasEnded = true;
        while (buffer.length > 0) {
          try {
            await flush();
          } catch (error) {
            callback(error as Error);
            return;
          }
        }
        callback();
      }
    });

    return stream;
  }

  async createTable(tableName: string, ddl: string): Promise<void> {
    await this.execute(ddl);
  }

  async tableExists(tableName: string): Promise<boolean> {
    const sql = `
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = $1
      ) as exists
    `;
    const result = await this.query(sql, [tableName]);
    return result[0].exists;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
