'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const migrationFile = path.resolve(
  process.cwd(),
  'prisma',
  'migrations',
  '20260315070000_platform_foundation',
  'migration.sql',
);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: false,
    env: process.env,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

function main() {
  console.log('[platform-schema-upgrade] applying platform foundation SQL');
  run(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
    'prisma',
    'db',
    'execute',
    '--schema',
    'prisma/schema.prisma',
    '--file',
    migrationFile,
  ]);
  console.log('[platform-schema-upgrade] platform foundation SQL applied');
}

main();
