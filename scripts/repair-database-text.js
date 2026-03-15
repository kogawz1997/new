require('dotenv').config();

const { prisma } = require('../src/prisma');
const { looksLikeMojibake } = require('../src/utils/mojibake');
const { repairJsonText } = require('../src/utils/textRepair');

function quoteIdentifier(value) {
  return `"${String(value || '').replace(/"/g, '""')}"`;
}

function parseArgs(argv = process.argv.slice(2)) {
  return {
    write: argv.includes('--write'),
    limit: Math.max(
      1,
      Number.parseInt(
        String(argv.find((arg) => String(arg).startsWith('--limit=')) || '')
          .split('=')
          .slice(1)
          .join(''),
        10,
      ) || 25,
    ),
  };
}

async function getCurrentSchema() {
  const rows = await prisma.$queryRawUnsafe('SELECT current_schema() AS schema_name');
  return String(rows?.[0]?.schema_name || 'public');
}

async function listTextColumns(schemaName) {
  return prisma.$queryRawUnsafe(
    `
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = $1
        AND data_type IN ('text', 'character varying', 'character')
      ORDER BY table_name ASC, ordinal_position ASC
    `,
    schemaName,
  );
}

async function listPrimaryKeyColumns(schemaName) {
  const rows = await prisma.$queryRawUnsafe(
    `
      SELECT
        tc.table_name,
        kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      WHERE tc.table_schema = $1
        AND tc.constraint_type = 'PRIMARY KEY'
      ORDER BY tc.table_name ASC, kcu.ordinal_position ASC
    `,
    schemaName,
  );

  const byTable = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const tableName = String(row?.table_name || '').trim();
    const columnName = String(row?.column_name || '').trim();
    if (!tableName || !columnName) continue;
    if (!byTable.has(tableName)) {
      byTable.set(tableName, []);
    }
    byTable.get(tableName).push(columnName);
  }
  return byTable;
}

function buildTableGroups(columns = []) {
  const byTable = new Map();
  for (const row of Array.isArray(columns) ? columns : []) {
    const tableName = String(row?.table_name || '').trim();
    const columnName = String(row?.column_name || '').trim();
    if (!tableName || !columnName) continue;
    if (!byTable.has(tableName)) {
      byTable.set(tableName, []);
    }
    byTable.get(tableName).push(columnName);
  }
  return byTable;
}

function shouldAttemptRepair(value) {
  const text = String(value || '');
  if (!text) return false;
  if (looksLikeMojibake(text)) return true;
  return /[\u0080-\u009F]/.test(text);
}

function repairTextValue(value) {
  const text = String(value || '');
  if (!shouldAttemptRepair(text)) {
    return { changed: false, value: text, strategy: null };
  }
  return repairJsonText(text);
}

async function inspectTable(tableName, pkColumns, textColumns, options) {
  const selectColumns = [...pkColumns, ...textColumns]
    .map((columnName) => quoteIdentifier(columnName))
    .join(', ');
  const sql = `SELECT ${selectColumns} FROM ${quoteIdentifier(tableName)}`;
  const rows = await prisma.$queryRawUnsafe(sql);

  const changes = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const pkValues = pkColumns.map((columnName) => row[columnName]);
    if (pkValues.some((value) => value == null)) continue;

    const repairedColumns = [];
    for (const columnName of textColumns) {
      const original = row[columnName];
      if (typeof original !== 'string' || !shouldAttemptRepair(original)) continue;
      const repaired = repairTextValue(original);
      if (!repaired.changed || repaired.value === original) continue;
      repairedColumns.push({
        column: columnName,
        before: original,
        after: repaired.value,
        strategy: repaired.strategy,
      });
    }

    if (repairedColumns.length === 0) continue;
    changes.push({
      table: tableName,
      primaryKey: Object.fromEntries(pkColumns.map((columnName, index) => [columnName, pkValues[index]])),
      columns: repairedColumns,
    });
  }

  if (options.write) {
    for (const change of changes) {
      const setClauses = change.columns
        .map((entry, index) => `${quoteIdentifier(entry.column)} = $${index + 1}`)
        .join(', ');
      const whereClauses = pkColumns
        .map((columnName, index) => `${quoteIdentifier(columnName)} = $${change.columns.length + index + 1}`)
        .join(' AND ');
      const values = [
        ...change.columns.map((entry) => entry.after),
        ...pkColumns.map((columnName) => change.primaryKey[columnName]),
      ];
      await prisma.$executeRawUnsafe(
        `UPDATE ${quoteIdentifier(tableName)} SET ${setClauses} WHERE ${whereClauses}`,
        ...values,
      );
    }
  }

  return changes;
}

async function main() {
  const options = parseArgs();
  const schemaName = await getCurrentSchema();
  const textColumns = await listTextColumns(schemaName);
  const primaryKeys = await listPrimaryKeyColumns(schemaName);
  const byTable = buildTableGroups(textColumns);

  const skippedTables = [];
  const findings = [];

  for (const [tableName, columns] of byTable.entries()) {
    const pkColumns = primaryKeys.get(tableName) || [];
    if (pkColumns.length === 0) {
      skippedTables.push({ table: tableName, reason: 'missing-primary-key' });
      continue;
    }
    const tableFindings = await inspectTable(tableName, pkColumns, columns, options);
    findings.push(...tableFindings);
  }

  const byTableSummary = findings.reduce((acc, entry) => {
    const current = acc[entry.table] || { rows: 0, columns: 0 };
    current.rows += 1;
    current.columns += entry.columns.length;
    acc[entry.table] = current;
    return acc;
  }, {});

  console.log(
    JSON.stringify(
      {
        write: options.write,
        schema: schemaName,
        tablesScanned: byTable.size,
        skippedTables,
        findings: findings.length,
        byTable: byTableSummary,
        sample: findings.slice(0, options.limit),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => null);
  });
