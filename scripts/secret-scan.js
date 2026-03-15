'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const SAFE_ENV_EXAMPLES = new Set([
  '.env.example',
  '.env.development.example',
  '.env.production.example',
  '.env.test.example',
  'apps/web-portal-standalone/.env.example',
  'apps/web-portal-standalone/.env.development.example',
  'apps/web-portal-standalone/.env.production.example',
  'apps/web-portal-standalone/.env.test.example',
]);
const IGNORED_DIRS = new Set([
  '.git',
  '.github',
  '.vs',
  '_compare',
  'coverage',
  'data',
  'logs',
  'node_modules',
]);
const CONTENT_SCAN_IGNORED_DIRS = new Set([
  'docs',
  'test',
]);
const BLOCKED_FILENAME_PATTERNS = [
  /^\.env(?:\..+)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.backup[^/\\]*$/i,
];
const SECRET_ENV_PATTERN =
  /(^|\n)\s*(DISCORD_TOKEN|ADMIN_WEB_PASSWORD|ADMIN_WEB_TOKEN|SCUM_WEBHOOK_SECRET|SCUM_CONSOLE_AGENT_TOKEN|RCON_PASSWORD|ADMIN_WEB_2FA_SECRET|WEB_PORTAL_DISCORD_CLIENT_SECRET|ADMIN_WEB_SSO_DISCORD_CLIENT_SECRET)\s*=\s*["']?(?!ROTATE_|CHANGE|CHANGEME|YOUR_|EXAMPLE|PLACEHOLDER|XXX|PUT_A_|REPLACE_)([^\r\n"']{8,})/i;
const CONTENT_PATTERNS = [
  {
    id: 'private-key',
    message: 'private key material',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  },
  {
    id: 'github-token',
    message: 'GitHub token pattern',
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/,
  },
  {
    id: 'github-pat',
    message: 'GitHub fine-grained PAT pattern',
    pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  },
  {
    id: 'slack-token',
    message: 'Slack token pattern',
    pattern: /\bxox(?:a|b|p|r|s)-[A-Za-z0-9-]{10,}\b/,
  },
  {
    id: 'discord-bot-token',
    message: 'Discord bot token pattern',
    pattern: /\b[A-Za-z\d_-]{23,28}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{20,40}\b/,
  },
  {
    id: 'high-risk-env-assignment',
    message: 'high-risk secret env assignment',
    pattern: SECRET_ENV_PATTERN,
  },
];

function parseArgs(argv = []) {
  return {
    staged: argv.includes('--staged'),
    help: argv.includes('--help') || argv.includes('-h'),
  };
}

function normalizeRelPath(filePath) {
  const relative = path.isAbsolute(filePath)
    ? path.relative(ROOT_DIR, filePath)
    : filePath;
  return relative.replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function isTextLikelyBinary(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 2048));
  return sample.includes(0);
}

function isIgnoredPath(relPath) {
  const normalized = normalizeRelPath(relPath);
  const parts = normalized.split('/').filter(Boolean);
  return parts.some((part) => IGNORED_DIRS.has(part));
}

function shouldSkipContentScan(relPath) {
  const normalized = normalizeRelPath(relPath);
  const parts = normalized.split('/').filter(Boolean);
  if (parts.some((part) => CONTENT_SCAN_IGNORED_DIRS.has(part))) return true;
  if (normalized.toLowerCase().endsWith('.md')) return true;
  return false;
}

function isSafeEnvExample(relPath) {
  return SAFE_ENV_EXAMPLES.has(normalizeRelPath(relPath));
}

function isBlockedFilename(relPath) {
  const normalized = normalizeRelPath(relPath);
  const basename = path.posix.basename(normalized);
  if (isSafeEnvExample(normalized)) return false;
  return BLOCKED_FILENAME_PATTERNS.some((pattern) => pattern.test(basename));
}

function runGit(args) {
  return execFileSync('git', args, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function listRepoFiles(options = {}) {
  const output = options.staged
    ? runGit(['diff', '--cached', '--name-only', '--diff-filter=ACMRTUXB'])
    : runGit(['ls-files']);
  return output
    .split(/\r?\n/)
    .map((line) => normalizeRelPath(line))
    .filter(Boolean)
    .filter((filePath) => !isIgnoredPath(filePath));
}

function scanFilePath(relPath) {
  const findings = [];
  if (isBlockedFilename(relPath)) {
    findings.push({
      type: 'filename',
      file: normalizeRelPath(relPath),
      reason: 'blocked sensitive filename pattern',
    });
  }
  return findings;
}

function scanFileContents(relPath, content) {
  const findings = [];
  if (isSafeEnvExample(relPath) || shouldSkipContentScan(relPath)) return findings;
  for (const entry of CONTENT_PATTERNS) {
    if (!entry.pattern.test(content)) continue;
    findings.push({
      type: 'content',
      file: normalizeRelPath(relPath),
      reason: entry.message,
      patternId: entry.id,
    });
  }
  return findings;
}

function scanFiles(filePaths = []) {
  const findings = [];
  for (const relPath of filePaths) {
    const normalized = normalizeRelPath(relPath);
    const absolute = path.resolve(ROOT_DIR, normalized);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;
    findings.push(...scanFilePath(normalized));
    const buffer = fs.readFileSync(absolute);
    if (isTextLikelyBinary(buffer)) continue;
    const content = buffer.toString('utf8');
    findings.push(...scanFileContents(normalized, content));
  }
  return findings;
}

function formatFinding(finding) {
  return `- ${finding.file}: ${finding.reason}`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/secret-scan.js [--staged]');
    process.exit(0);
  }

  let files = [];
  try {
    files = listRepoFiles({ staged: args.staged });
  } catch (error) {
    console.error('[secret-scan] failed to list git files:', error.message);
    process.exit(1);
  }

  const findings = scanFiles(files);
  if (findings.length === 0) {
    console.log(`[secret-scan] OK (${args.staged ? 'staged files' : 'repo scan'})`);
    return;
  }

  console.error('[secret-scan] FAIL');
  for (const finding of findings) {
    console.error(formatFinding(finding));
  }
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = {
  BLOCKED_FILENAME_PATTERNS,
  CONTENT_PATTERNS,
  ROOT_DIR,
  SAFE_ENV_EXAMPLES,
  formatFinding,
  isBlockedFilename,
  isSafeEnvExample,
  listRepoFiles,
  normalizeRelPath,
  scanFileContents,
  scanFilePath,
  scanFiles,
};
