'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
require('dotenv').config();
const {
  normalizeProvider,
  resolveDatabaseRuntime,
} = require('../src/utils/dbEngine');

const PROJECT_ROOT = process.cwd();
const SOURCE_SCHEMA_PATH = path.join(PROJECT_ROOT, 'prisma', 'schema.prisma');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'artifacts', 'prisma');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function parseCliArgs(argv = process.argv.slice(2)) {
  const args = [];
  let provider = '';
  for (let i = 0; i < argv.length; i += 1) {
    const part = String(argv[i] || '').trim();
    if (!part) continue;
    if (part === '--provider' && i + 1 < argv.length) {
      provider = String(argv[i + 1] || '').trim();
      i += 1;
      continue;
    }
    if (part.startsWith('--provider=')) {
      provider = part.split('=').slice(1).join('=').trim();
      continue;
    }
    args.push(part);
  }
  return { provider, args };
}

function resolveProvider(requestedProvider = '') {
  const runtime = resolveDatabaseRuntime({
    provider: requestedProvider,
    projectRoot: PROJECT_ROOT,
  });
  const provider = normalizeProvider(
    requestedProvider || runtime.provider || runtime.engine,
    runtime.engine === 'unsupported' ? 'sqlite' : runtime.engine,
  );
  if (!['sqlite', 'postgresql', 'mysql'].includes(provider)) {
    throw new Error(`Unsupported Prisma provider: ${provider}`);
  }
  return provider;
}

function renderSchemaForProvider(provider, options = {}) {
  const sourcePath = options.sourcePath || SOURCE_SCHEMA_PATH;
  const outputDir = options.outputDir || (provider === 'sqlite' ? path.dirname(sourcePath) : OUTPUT_DIR);
  const source = fs.readFileSync(sourcePath, 'utf8');
  const rendered = source.replace(
    /datasource\s+db\s*\{([\s\S]*?)provider\s*=\s*"[^"]+"/m,
    (match) => match.replace(/provider\s*=\s*"[^"]+"/, `provider = "${provider}"`),
  );
  ensureDir(outputDir);
  const outputPath = path.join(outputDir, `schema.${provider}.prisma`);
  fs.writeFileSync(outputPath, rendered, 'utf8');
  return {
    provider,
    sourcePath,
    outputPath,
  };
}

function runPrisma(args = [], options = {}) {
  const provider = resolveProvider(options.provider);
  const rendered = renderSchemaForProvider(provider, options);
  const prismaArgs = [...args];
  if (!prismaArgs.includes('--schema')) {
    prismaArgs.push('--schema', rendered.outputPath);
  }
  const command = 'npx';
  const useShell = process.platform === 'win32';
  const result = spawnSync(command, ['prisma', ...prismaArgs], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    shell: useShell,
    env: process.env,
  });
  if (result.error) {
    console.error(`[prisma-with-provider] failed to start Prisma CLI: ${result.error.message}`);
  }
  return {
    ...rendered,
    command,
    prismaArgs,
    status: Number.isInteger(result.status) ? result.status : 1,
  };
}

function main() {
  const { provider, args } = parseCliArgs();
  if (args.length === 0) {
    console.error('Usage: node scripts/prisma-with-provider.js [--provider sqlite|postgresql|mysql] <prisma args...>');
    process.exit(1);
  }
  const result = runPrisma(args, { provider });
  process.exit(result.status);
}

if (require.main === module) {
  main();
}

module.exports = {
  OUTPUT_DIR,
  SOURCE_SCHEMA_PATH,
  parseCliArgs,
  renderSchemaForProvider,
  resolveProvider,
  runPrisma,
};
