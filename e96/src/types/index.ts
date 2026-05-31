export interface MySQLConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export interface PostgreSQLConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export interface TableConfig {
  sourceTable: string;
  targetTable: string;
  primaryKey: string;
  columns?: string[];
  batchSize?: number;
}

export interface MigrationConfig {
  source: MySQLConfig;
  target: PostgreSQLConfig;
  tables: TableConfig[];
  concurrency?: number;
  rateLimit?: number;
  checkpointPath?: string;
  validate?: boolean;
}

export interface ColumnInfo {
  name: string;
  type: string;
  dataType: string;
  isNullable: boolean;
  defaultValue: string | null;
  maxLength?: number;
  numericPrecision?: number;
  numericScale?: number;
}

export interface TableSchema {
  tableName: string;
  columns: ColumnInfo[];
  primaryKey: string[];
  rowCount: number;
}

export interface Checkpoint {
  tableName: string;
  lastPrimaryKey: string | number | null;
  migratedRows: number;
  failedRows: number;
  validatedRows: number;
  validationFailedRows: number;
  status: 'pending' | 'migrating' | 'migrated' | 'validating' | 'completed' | 'failed';
  startTime: number;
  endTime?: number;
}

export interface MigrationProgress {
  tableName: string;
  totalRows: number;
  migratedRows: number;
  failedRows: number;
  validatedRows: number;
  validationFailedRows: number;
  status: string;
  elapsedTime: number;
  estimatedRemainingTime: number;
  rowsPerSecond: number;
}

export interface RowValidationResult {
  primaryKey: string | number;
  sourceMd5: string;
  targetMd5: string;
  match: boolean;
  differences?: string[];
}

export interface MigrationStats {
  totalTables: number;
  completedTables: number;
  totalRows: number;
  totalMigratedRows: number;
  totalFailedRows: number;
  totalValidatedRows: number;
  totalValidationFailedRows: number;
  startTime: number;
  elapsedTime: number;
  tables: MigrationProgress[];
}

export interface DeltaChange {
  id: string;
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  tableName: string;
  primaryKey: string | number;
  timestamp: number;
  data?: any;
  oldData?: any;
}

export interface DeltaSyncConfig {
  sourceTable: string;
  targetTable: string;
  primaryKey: string;
  timestampColumn?: string;
  versionColumn?: string;
  pollInterval?: number;
  lastSyncTime?: number;
}

export interface DeltaSyncStatus {
  tableName: string;
  lastSyncTime: number;
  processedChanges: number;
  pendingChanges: number;
  errors: number;
  isRunning: boolean;
}

export interface RepairSQL {
  id: string;
  tableName: string;
  primaryKey: string | number;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  sql: string;
  sourceData?: any;
  targetData?: any;
  differences?: string[];
  confirmed: boolean;
  executed: boolean;
  success?: boolean;
}

export interface RepairSession {
  id: string;
  tableName: string;
  createdAt: number;
  repairs: RepairSQL[];
  totalRepairs: number;
  confirmedRepairs: number;
  executedRepairs: number;
  successRepairs: number;
}

export interface SLAMetric {
  name: string;
  value: number;
  unit: string;
  target?: number;
  status: 'pass' | 'warning' | 'fail';
}

export interface SLAReport {
  reportId: string;
  generatedAt: number;
  period: {
    startTime: number;
    endTime: number;
  };
  summary: {
    totalTables: number;
    totalRows: number;
    totalMigratedRows: number;
    totalFailedRows: number;
    totalValidatedRows: number;
    totalValidationFailedRows: number;
  };
  metrics: SLAMetric[];
  tableMetrics: Array<{
    tableName: string;
    totalRows: number;
    migratedRows: number;
    failedRows: number;
    avgRowsPerSecond: number;
    failureRate: number;
    validationRate: number;
    elapsedTime: number;
  }>;
  issues: Array<{
    type: string;
    severity: 'high' | 'medium' | 'low';
    message: string;
    tableName?: string;
  }>;
  recommendations: string[];
}
