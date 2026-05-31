import { mapMySQLToPostgreSQLType, generatePostgreSQLDDL, convertMySQLValueToPostgreSQL } from '../src/migration/schema';
import { ColumnInfo, TableSchema } from '../src/types';

console.log('=== 测试 DDL 转换 ===\n');

const testColumns: ColumnInfo[] = [
  { name: 'id', type: 'int', dataType: 'int', isNullable: false, defaultValue: null, numericPrecision: 11 },
  { name: 'name', type: 'varchar(255)', dataType: 'varchar', isNullable: false, defaultValue: null, maxLength: 255 },
  { name: 'email', type: 'varchar(255)', dataType: 'varchar', isNullable: true, defaultValue: null, maxLength: 255 },
  { name: 'age', type: 'tinyint', dataType: 'tinyint', isNullable: true, defaultValue: '0' },
  { name: 'is_active', type: 'tinyint(1)', dataType: 'tinyint', isNullable: false, defaultValue: '1' },
  { name: 'balance', type: 'decimal(10,2)', dataType: 'decimal', isNullable: false, defaultValue: '0.00', numericPrecision: 10, numericScale: 2 },
  { name: 'bio', type: 'text', dataType: 'text', isNullable: true, defaultValue: null },
  { name: 'birth_year', type: 'year', dataType: 'year', isNullable: true, defaultValue: null },
  { name: 'created_at', type: 'datetime', dataType: 'datetime', isNullable: false, defaultValue: 'CURRENT_TIMESTAMP' },
  { name: 'updated_at', type: 'timestamp', dataType: 'timestamp', isNullable: true, defaultValue: null },
  { name: 'login_time', type: 'time', dataType: 'time', isNullable: true, defaultValue: null },
  { name: 'birth_date', type: 'date', dataType: 'date', isNullable: true, defaultValue: null },
  { name: 'metadata', type: 'json', dataType: 'json', isNullable: true, defaultValue: null }
];

console.log('1. 测试数据类型映射:');
testColumns.forEach(col => {
  const pgType = mapMySQLToPostgreSQLType(col.dataType, col);
  console.log(`   ${col.name}: ${col.type} -> ${pgType}`);
});

console.log('\n2. 测试 DDL 生成:');
const testSchema: TableSchema = {
  tableName: 'users',
  columns: testColumns,
  primaryKey: ['id'],
  rowCount: 1000
};

const ddl = generatePostgreSQLDDL(testSchema);
console.log(ddl);

console.log('\n3. 测试数据值转换 (datetime/timestamp/year/date/time):');
const testRow = {
  id: 1,
  name: '张三',
  email: 'zhangsan@example.com',
  age: 25,
  is_active: 1,
  balance: 99.99,
  bio: '这是一段简介',
  birth_year: '2024',
  created_at: new Date('2024-01-01 10:00:00'),
  updated_at: '0000-00-00 00:00:00',
  login_time: '14:30:00',
  birth_date: '1990-05-15',
  metadata: '{"key": "value"}'
};

const converted = convertMySQLValueToPostgreSQL(testRow, testColumns);
console.log('原始值:', JSON.stringify(testRow, null, 2));
console.log('转换后:', JSON.stringify(converted, null, 2));

console.log('\n   验证转换结果:');
console.log(`   - birth_year (year): ${converted.birth_year} (类型: ${typeof converted.birth_year})`);
console.log(`   - created_at (datetime): ${converted.created_at}`);
console.log(`   - updated_at (零日期): ${converted.updated_at} (应为 null)`);
console.log(`   - birth_date (date): ${converted.birth_date}`);

console.log('\n4. 测试 MD5 计算 (分块 hash):');
import { DataValidator } from '../src/migration/validator';
import { MySQLClient } from '../src/db/mysql';
import { PostgreSQLClient } from '../src/db/postgresql';

const validator = new DataValidator(
  {} as MySQLClient,
  {} as PostgreSQLClient
);

const columns = ['id', 'name', 'email', 'age', 'is_active'];
const row1 = { id: 1, name: '张三', email: 'a@b.com', age: 20, is_active: 1 };
const row2 = { id: 1, name: '张三', email: 'a@b.com', age: 20, is_active: 1 };
const row3 = { id: 2, name: '李四', email: 'b@c.com', age: 25, is_active: 0 };

const md5_1 = validator.calculateRowMd5(row1, columns);
const md5_2 = validator.calculateRowMd5(row2, columns);
const md5_3 = validator.calculateRowMd5(row3, columns);

console.log(`   Row1 MD5: ${md5_1}`);
console.log(`   Row2 MD5: ${md5_2}`);
console.log(`   Row3 MD5: ${md5_3}`);
console.log(`   Row1 == Row2: ${md5_1 === md5_2}`);
console.log(`   Row1 != Row3: ${md5_1 !== md5_3}`);

console.log('\n5. 测试分块 hash 计算:');
const chunk1 = [row1, row2];
const chunk2 = [row1, row2];
const chunk3 = [row1, row3];

const chunkMd5_1 = validator.calculateChunkMd5(chunk1, columns);
const chunkMd5_2 = validator.calculateChunkMd5(chunk2, columns);
const chunkMd5_3 = validator.calculateChunkMd5(chunk3, columns);

console.log(`   Chunk1 MD5: ${chunkMd5_1}`);
console.log(`   Chunk2 MD5: ${chunkMd5_2}`);
console.log(`   Chunk3 MD5: ${chunkMd5_3}`);
console.log(`   Chunk1 == Chunk2: ${chunkMd5_1 === chunkMd5_2}`);
console.log(`   Chunk1 != Chunk3: ${chunkMd5_1 !== chunkMd5_3}`);

console.log('\n=== 所有测试完成 ===');
