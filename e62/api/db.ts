import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 数据库结构
interface DatabaseSchema {
  matrices: Array<{
    id: string;
    name: string;
    rows: number;
    cols: number;
    nnz: number;
    density: number;
    indptr: number[];
    indices: number[];
    data: number[];
    created_at: string;
  }>;
  history: Array<{
    id: string;
    matrix_a_id: string;
    matrix_b_id: string;
    result_id: string;
    engine: string;
    duration: number;
    memory_peak: number;
    created_at: string;
  }>;
}

const dbPath = path.join(__dirname, '..', 'data', 'db.json');
const adapter = new JSONFile<DatabaseSchema>(dbPath);
const defaultData: DatabaseSchema = { matrices: [], history: [] };
const db = new Low(adapter, defaultData);

// 初始化数据库
await db.read();
if (!db.data) {
  db.data = defaultData;
  await db.write();
}

export interface MatrixRecord {
  id: string;
  name: string;
  rows: number;
  cols: number;
  nnz: number;
  density: number;
  indptr: Uint32Array;
  indices: Uint32Array;
  data: Float64Array;
  created_at: string;
}

export interface HistoryRecord {
  id: string;
  matrix_a_id: string;
  matrix_b_id: string;
  result_id: string;
  engine: string;
  duration: number;
  memory_peak: number;
  created_at: string;
}

// 矩阵操作
export async function saveMatrix(matrix: Omit<MatrixRecord, 'created_at'>): Promise<void> {
  await db.read();

  db.data!.matrices.push({
    id: matrix.id,
    name: matrix.name,
    rows: matrix.rows,
    cols: matrix.cols,
    nnz: matrix.nnz,
    density: matrix.density,
    indptr: Array.from(matrix.indptr),
    indices: Array.from(matrix.indices),
    data: Array.from(matrix.data),
    created_at: new Date().toISOString(),
  });

  await db.write();
}

export async function getMatrix(id: string): Promise<MatrixRecord | null> {
  await db.read();
  const row = db.data!.matrices.find((m) => m.id === id);

  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    rows: row.rows,
    cols: row.cols,
    nnz: row.nnz,
    density: row.density,
    indptr: new Uint32Array(row.indptr),
    indices: new Uint32Array(row.indices),
    data: new Float64Array(row.data),
    created_at: row.created_at,
  };
}

export async function listMatrices(): Promise<Array<{
  id: string;
  name: string;
  rows: number;
  cols: number;
  nnz: number;
  density: number;
  created_at: string;
}>> {
  await db.read();
  return db.data!.matrices
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 50)
    .map((m) => ({
      id: m.id,
      name: m.name,
      rows: m.rows,
      cols: m.cols,
      nnz: m.nnz,
      density: m.density,
      created_at: m.created_at,
    }));
}

export async function deleteMatrix(id: string): Promise<void> {
  await db.read();
  db.data!.matrices = db.data!.matrices.filter((m) => m.id !== id);
  await db.write();
}

// 历史记录操作
export async function saveHistory(record: Omit<HistoryRecord, 'created_at'>): Promise<void> {
  await db.read();

  db.data!.history.push({
    id: record.id,
    matrix_a_id: record.matrix_a_id,
    matrix_b_id: record.matrix_b_id,
    result_id: record.result_id,
    engine: record.engine,
    duration: record.duration,
    memory_peak: record.memory_peak,
    created_at: new Date().toISOString(),
  });

  await db.write();
}

export async function listHistory(): Promise<Array<any>> {
  await db.read();

  const matrices = new Map(db.data!.matrices.map((m) => [m.id, m]));

  return db.data!.history
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 50)
    .map((h) => {
      const matrixA = matrices.get(h.matrix_a_id);
      const matrixB = matrices.get(h.matrix_b_id);
      const result = matrices.get(h.result_id);

      return {
        id: h.id,
        engine: h.engine,
        duration: h.duration,
        memory_peak: h.memory_peak,
        created_at: h.created_at,
        matrix_a_name: matrixA?.name || 'Unknown',
        matrix_a_rows: matrixA?.rows || 0,
        matrix_a_cols: matrixA?.cols || 0,
        matrix_a_nnz: matrixA?.nnz || 0,
        matrix_b_name: matrixB?.name || 'Unknown',
        matrix_b_rows: matrixB?.rows || 0,
        matrix_b_cols: matrixB?.cols || 0,
        matrix_b_nnz: matrixB?.nnz || 0,
        result_rows: result?.rows || 0,
        result_cols: result?.cols || 0,
        result_nnz: result?.nnz || 0,
      };
    });
}

export default db;
