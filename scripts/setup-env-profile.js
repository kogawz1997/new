'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const PORTAL_DIR = path.join(ROOT_DIR, 'apps', 'web-portal-standalone');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const [rawKey, directValue] = token.split('=');
    const key = rawKey.slice(2);
    if (directValue != null) {
      out[key] = directValue;
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
      continue;
    }
    out[key] = 'true';
  }
  return out;
}

function readLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
}

function mergeEnvLines(baseLines, overlayLines) {
  const result = [];
  const keyIndex = new Map();

  function apply(lines) {
    for (const line of lines) {
      const match = /^([A-Z0-9_]+)=/.exec(line);
      if (!match) {
        result.push(line);
        continue;
      }
      const key = match[1];
      if (keyIndex.has(key)) {
        result[keyIndex.get(key)] = line;
      } else {
        keyIndex.set(key, result.length);
        result.push(line);
      }
    }
  }

  apply(baseLines);
  apply(overlayLines);
  return result.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function writeFileAtomic(targetPath, content, { force = false } = {}) {
  const exists = fs.existsSync(targetPath);
  if (!force && exists) {
    throw new Error(`Target already exists: ${targetPath}`);
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  if (force && exists) {
    const backupRoot = path.join(ROOT_DIR, 'data', 'env-profile-backups');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const relativeTarget = path.relative(ROOT_DIR, targetPath);
    const backupPath = path.join(backupRoot, stamp, relativeTarget);
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.copyFileSync(targetPath, backupPath);
    console.log(`[env-profile] backup ${targetPath} -> ${backupPath}`);
  }
  const tmpPath = `${targetPath}.tmp`;
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, targetPath);
}

function buildProfilePaths(baseDir, profile) {
  return {
    base: path.join(baseDir, '.env.example'),
    overlay: path.join(baseDir, `.env.${profile}.example`),
    target: path.join(baseDir, '.env'),
  };
}

function buildMergedProfile(baseDir, profile) {
  const paths = buildProfilePaths(baseDir, profile);
  const baseLines = readLines(paths.base);
  if (baseLines.length === 0) {
    throw new Error(`Missing base example env: ${paths.base}`);
  }
  const overlayLines = readLines(paths.overlay);
  return {
    ...paths,
    hasOverlay: overlayLines.length > 0,
    content: mergeEnvLines(baseLines, overlayLines),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const profile = String(args.profile || 'development').trim().toLowerCase();
  const write = args.write === 'true';
  const force = args.force === 'true';
  const allowed = new Set(['development', 'test', 'production']);
  if (!allowed.has(profile)) {
    throw new Error(`Unsupported profile "${profile}". Use development, test, or production.`);
  }

  const rootProfile = buildMergedProfile(ROOT_DIR, profile);
  const portalProfile = buildMergedProfile(PORTAL_DIR, profile);

  if (!write) {
    console.log(`[env-profile] profile=${profile}`);
    console.log(`[env-profile] root  : ${rootProfile.base}${rootProfile.hasOverlay ? ` + ${rootProfile.overlay}` : ''}`);
    console.log(`[env-profile] portal: ${portalProfile.base}${portalProfile.hasOverlay ? ` + ${portalProfile.overlay}` : ''}`);
    console.log('[env-profile] preview only (use --write to materialize .env files)');
    return;
  }

  writeFileAtomic(rootProfile.target, rootProfile.content, { force });
  writeFileAtomic(portalProfile.target, portalProfile.content, { force });
  console.log(`[env-profile] wrote ${rootProfile.target}`);
  console.log(`[env-profile] wrote ${portalProfile.target}`);
}

main();
