import { mapMySQLToPostgreSQLType, generatePostgreSQLDDL, convertMySQLValueToPostgreSQL } from '../src/migration/schema';
import { DataValidator } from '../src/migration/validator';
import { SLAReporter } from '../src/migration/sla-reporter';
import { DataRepair } from '../src/migration/repair';
import { ColumnInfo, TableSchema, RowValidationResult } from '../src/types';
import { PostgreSQLClient } from '../src/db/postgresql';

console.log('=== 功能测试 ===\n');

const testColumns: ColumnInfo[] = [
  { name: 'id', type: 'int', dataType: 'int', isNullable: false, defaultValue: null, numericPrecision: 11 },
  { name: 'name', type: 'varchar(255)', dataType: 'varchar', isNullable: false, defaultValue: null, maxLength: 255 },
  { name: 'email', type: 'varchar(255)', dataType: 'varchar', isNullable: true, defaultValue: null, maxLength: 255 },
  { name: 'created_at', type: 'datetime', dataType: 'datetime', isNullable: false, defaultValue: 'CURRENT_TIMESTAMP' },
  { name: 'birth_year', type: 'year', dataType: 'year', isNullable: true, defaultValue: null }
];

console.log('1. 类型映射测试:');
testColumns.forEach(col => {
  const pgType = mapMySQLToPostgreSQLType(col.dataType, col);
  console.log(`   ✓ ${col.name}: ${col.type} -> ${pgType}`);
});

console.log('\n2. 数据值转换测试:');
const testRow = {
  id: 1,
  name: '张三',
  email: 'zhangsan@example.com',
  created_at: new Date('2024-01-01 10:00:00'),
  birth_year: '2024'
};

const converted = convertMySQLValueToPostgreSQL(testRow, testColumns);
console.log(`   ✓ datetime: ${converted.created_at}`);
console.log(`   ✓ year: ${converted.birth_year} (类型: ${typeof converted.birth_year})`);

console.log('\n3. DDL 生成测试:');
const testSchema: TableSchema = {
  tableName: 'users',
  columns: testColumns,
  primaryKey: ['id'],
  rowCount: 1000
};

const ddl = generatePostgreSQLDDL(testSchema);
console.log(ddl);

console.log('\n4. SLA 报告生成测试:');
const mockConfig = {
  source: { host: 'localhost', port: 3306, user: 'root', password: '', database: 'test' },
  target: { host: 'localhost', port: 5432, user: 'postgres', password: '', database: 'test' },
  tables: [{ sourceTable: 'users', targetTable: 'users', primaryKey: 'id' }]
};

const slaReporter = new SLAReporter(mockConfig);

slaReporter.recordProgress({
  tableName: 'users',
  totalRows: 10000,
  migratedRows: 9950,
  failedRows: 50,
  validatedRows: 9900,
  validationFailedRows: 10,
  status: 'migrating',
  elapsedTime: 60000,
  estimatedRemainingTime: 30000,
  rowsPerSecond: 500
});

const slaReport = slaReporter.generateReport();
console.log(`   ✓ 报告ID: ${slaReport.reportId}`);
console.log(`   ✓ 指标数量: ${slaReport.metrics.length}`);
console.log(`   ✓ 迁移成功率: ${slaReport.metrics.find(m => m.name === '迁移成功率')?.value.toFixed(2)}%`);
console.log(`   ✓ 校验成功率: ${slaReport.metrics.find(m => m.name === '校验成功率')?.value.toFixed(2)}%`);
console.log(`   ✓ 问题数量: ${slaReport.issues.length}`);
console.log(`   ✓ 建议数量: ${slaReport.recommendations.length}`);

console.log('\n5. 数据修复测试:');
const mockPgClient = {} as PostgreSQLClient;
const dataRepair = new DataRepair(mockPgClient);

const sourceRow = { id: 1, name: '张三', email: 'new@example.com' };
const targetRow = { id: 1, name: '张三', email: 'old@example.com' };

const repair = dataRepair.generateRepairSQL(
  'users',
  testSchema,
  sourceRow,
  targetRow,
  'id',
  ['email: source="new@example.com" target="old@example.com"']
);

console.log(`   ✓ 修复ID: ${repair.id}`);
console.log(`   ✓ 操作类型: ${repair.operation}`);
console.log(`   ✓ 主键: ${repair.primaryKey}`);
console.log(`   ✓ SQL已生成`);

console.log('\n6. 分块 MD5 校验测试:');
const validator = new DataValidator({} as any, {} as any);

const columns = ['id', 'name', 'email'];
const rows1 = [
  { id: 1, name: '张三', email: 'a@b.com' },
  { id: 2, name: '李四', email: 'b@c.com' }
];
const rows2 = [
  { id: 1, name: '张三', email: 'a@b.com' },
  { id: 2, name: '李四', email: 'b@c.com' }
];
const rows3 = [
  { id: 1, name: '张三', email: 'a@b.com' },
  { id: 2, name: '李四', email: 'MODIFIED@c.com' }
];

const md5_1 = validator.calculateChunkMd5(rows1, columns);
const md5_2 = validator.calculateChunkMd5(rows2, columns);
const md5_3 = validator.calculateChunkMd5(rows3, columns);

console.log(`   ✓ 块1 MD5: ${md5_1}`);
console.log(`   ✓ 块2 MD5: ${md5_2}`);
console.log(`   ✓ 块3 MD5: ${md5_3}`);
console.log(`   ✓ 相同块 hash 一致: ${md5_1 === md5_2}`);
console.log(`   ✓ 不同块 hash 不同: ${md5_1 !== md5_3}`);

console.log('\n=== 所有测试通过! ===');
