import { ColumnInfo, TableSchema } from '../types';

const typeMapping: Record<string, string> = {
  'tinyint': 'smallint',
  'smallint': 'smallint',
  'mediumint': 'integer',
  'int': 'integer',
  'integer': 'integer',
  'bigint': 'bigint',
  'float': 'real',
  'double': 'double precision',
  'double precision': 'double precision',
  'decimal': 'numeric',
  'numeric': 'numeric',
  'char': 'character',
  'varchar': 'character varying',
  'tinytext': 'text',
  'text': 'text',
  'mediumtext': 'text',
  'longtext': 'text',
  'binary': 'bytea',
  'varbinary': 'bytea',
  'blob': 'bytea',
  'tinyblob': 'bytea',
  'mediumblob': 'bytea',
  'longblob': 'bytea',
  'enum': 'text',
  'set': 'text',
  'date': 'date',
  'time': 'time without time zone',
  'datetime': 'timestamp without time zone',
  'timestamp': 'timestamp without time zone',
  'year': 'integer',
  'bool': 'boolean',
  'boolean': 'boolean',
  'json': 'jsonb',
  'jsonb': 'jsonb',
  'bit': 'bit',
  'bit varying': 'bit varying',
  'point': 'point',
  'line': 'line',
  'lseg': 'lseg',
  'box': 'box',
  'circle': 'circle',
  'polygon': 'polygon',
  'geometry': 'geometry',
  'linestring': 'geometry',
  'multipoint': 'geometry',
  'multilinestring': 'geometry',
  'multipolygon': 'geometry',
  'geometrycollection': 'geometry'
};

export function mapMySQLToPostgreSQLType(mysqlType: string, column: ColumnInfo): string {
  const baseType = mysqlType.toLowerCase().split('(')[0].trim();
  
  if (baseType === 'varchar' || baseType === 'char' || baseType === 'character varying' || baseType === 'char') {
    if (column.maxLength) {
      const pgType = typeMapping[baseType] || 'text';
      if (pgType === 'character varying' || pgType === 'character') {
        return `${pgType}(${column.maxLength})`;
      }
    }
  }

  if (baseType === 'decimal' || baseType === 'numeric') {
    if (column.numericPrecision !== undefined && column.numericScale !== undefined) {
      return `numeric(${column.numericPrecision}, ${column.numericScale})`;
    }
  }

  if (baseType === 'bit') {
    if (column.numericPrecision !== undefined) {
      return `bit(${column.numericPrecision})`;
    }
  }

  return typeMapping[baseType] || 'text';
}

export function generatePostgreSQLDDL(schema: TableSchema): string {
  const columnDefs = schema.columns.map(col => {
    const pgType = mapMySQLToPostgreSQLType(col.dataType, col);
    const nullable = col.isNullable ? '' : ' NOT NULL';
    const defaultVal = col.defaultValue ? ` DEFAULT ${col.defaultValue}` : '';
    return `"${col.name}" ${pgType}${nullable}${defaultVal}`;
  });

  let ddl = `CREATE TABLE IF NOT EXISTS "${schema.tableName}" (\n  ${columnDefs.join(',\n  ')}`;

  if (schema.primaryKey.length > 0) {
    const pkCols = schema.primaryKey.map(k => `"${k}"`).join(', ');
    ddl += `,\n  PRIMARY KEY (${pkCols})`;
  }

  ddl += '\n);';

  return ddl;
}

export function convertMySQLValueToPostgreSQL(row: any, columns: ColumnInfo[]): any {
  const converted: any = {};
  
  for (const col of columns) {
    const value = row[col.name];
    if (value === null || value === undefined) {
      converted[col.name] = null;
      continue;
    }

    const baseType = col.dataType.toLowerCase();
    
    if (baseType === 'tinyint' && (value === 0 || value === 1)) {
      converted[col.name] = value === 1;
    } else if (baseType === 'bit') {
      if (typeof value === 'number') {
        converted[col.name] = `B'${value.toString(2)}'`;
      } else {
        converted[col.name] = value;
      }
    } else if (baseType === 'json' || baseType === 'jsonb') {
      if (typeof value === 'string') {
        try {
          converted[col.name] = JSON.parse(value);
        } catch {
          converted[col.name] = value;
        }
      } else {
        converted[col.name] = value;
      }
    } else if (baseType === 'datetime' || baseType === 'timestamp') {
      if (value instanceof Date) {
        converted[col.name] = value.toISOString().replace('T', ' ').replace('Z', '');
      } else if (typeof value === 'string') {
        if (value === '0000-00-00 00:00:00' || value.startsWith('0000-00-00')) {
          converted[col.name] = null;
        } else {
          try {
            const date = new Date(value);
            if (!isNaN(date.getTime())) {
              converted[col.name] = date.toISOString().replace('T', ' ').replace('Z', '');
            } else {
              converted[col.name] = value;
            }
          } catch {
            converted[col.name] = value;
          }
        }
      } else {
        converted[col.name] = value;
      }
    } else if (baseType === 'date') {
      if (typeof value === 'string') {
        if (value === '0000-00-00' || value.startsWith('0000-00-00')) {
          converted[col.name] = null;
        } else {
          try {
            const date = new Date(value);
            if (!isNaN(date.getTime())) {
              converted[col.name] = date.toISOString().split('T')[0];
            } else {
              converted[col.name] = value;
            }
          } catch {
            converted[col.name] = value;
          }
        }
      } else if (value instanceof Date) {
        converted[col.name] = value.toISOString().split('T')[0];
      } else {
        converted[col.name] = value;
      }
    } else if (baseType === 'time') {
      if (typeof value === 'string') {
        converted[col.name] = value;
      } else if (value instanceof Date) {
        converted[col.name] = value.toTimeString().split(' ')[0];
      } else {
        converted[col.name] = value;
      }
    } else if (baseType === 'year') {
      if (typeof value === 'number') {
        converted[col.name] = value;
      } else if (typeof value === 'string') {
        const year = parseInt(value, 10);
        converted[col.name] = isNaN(year) ? null : year;
      } else if (value instanceof Date) {
        converted[col.name] = value.getFullYear();
      } else {
        converted[col.name] = value;
      }
    } else if (value instanceof Buffer) {
      converted[col.name] = value;
    } else {
      converted[col.name] = value;
    }
  }

  return converted;
}
