'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..', '..', '..');
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('[web-portal-standalone] missing Prisma args');
  console.error('Usage: node scripts/prisma-root.js <prisma args>');
  process.exit(1);
}

const result = process.platform === 'win32'
  ? spawnSync(
      'cmd.exe',
      [
        '/d',
        '/s',
        '/c',
        `npx prisma ${args.map((arg) => String(arg).replace(/([\\^&|<>])/g, '^$1')).join(' ')}`,
      ],
      {
        cwd: rootDir,
        stdio: 'inherit',
        env: process.env,
      },
    )
  : spawnSync(
      'npx',
      ['prisma', ...args],
      {
        cwd: rootDir,
        stdio: 'inherit',
        env: process.env,
      },
    );

if (result.error) {
  console.error('[web-portal-standalone] failed to run Prisma:', result.error.message);
  process.exit(1);
}

process.exit(result.status == null ? 1 : result.status);
