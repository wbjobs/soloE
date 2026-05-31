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

export interface Config {
  tables: { source: string; target: string; primaryKey: string }[];
  concurrency: number;
  rateLimit: number;
  validate: boolean;
}
