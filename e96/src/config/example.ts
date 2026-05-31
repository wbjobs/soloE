import { MigrationConfig } from '../types';

export const exampleConfig: MigrationConfig = {
  source: {
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: 'your_mysql_password',
    database: 'source_database'
  },
  target: {
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: 'your_postgres_password',
    database: 'target_database'
  },
  tables: [
    {
      sourceTable: 'users',
      targetTable: 'users',
      primaryKey: 'id',
      batchSize: 1000
    },
    {
      sourceTable: 'orders',
      targetTable: 'orders',
      primaryKey: 'id',
      batchSize: 500
    }
  ],
  concurrency: 2,
  rateLimit: 1000,
  checkpointPath: './checkpoint.json',
  validate: true
};
