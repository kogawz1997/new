'use strict';

const fs = require('node:fs');
const path = require('node:path');

function encodeEnvValue(value) {
  const text = String(value ?? '');
  if (text === '') return '""';
  if (/^[A-Za-z0-9_./:@,+?=&%-]+$/.test(text)) {
    return text;
  }
  return `"${text
    .replaceAll('\\', '\\\\')
    .replaceAll('\r', '\\r')
    .replaceAll('\n', '\\n')
    .replaceAll('"', '\\"')}"`;
}

function parseEnvLine(line) {
  const match = /^([A-Z0-9_]+)\s*=/.exec(String(line || ''));
  if (!match) return null;
  return {
    key: match[1],
  };
}

function updateEnvFile(filePath, patch = {}) {
  const lines = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
    : [];
  const keyIndex = new Map();

  lines.forEach((line, index) => {
    const parsed = parseEnvLine(line);
    if (parsed?.key) {
      keyIndex.set(parsed.key, index);
    }
  });

  const changedKeys = [];
  for (const [key, rawValue] of Object.entries(patch || {})) {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) continue;
    const nextLine = `${normalizedKey}=${encodeEnvValue(rawValue)}`;
    if (keyIndex.has(normalizedKey)) {
      const index = keyIndex.get(normalizedKey);
      if (String(lines[index] || '') !== nextLine) {
        lines[index] = nextLine;
        changedKeys.push(normalizedKey);
      }
      continue;
    }
    lines.push(nextLine);
    keyIndex.set(normalizedKey, lines.length - 1);
    changedKeys.push(normalizedKey);
  }

  const content = `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, filePath);
  return {
    changedKeys,
  };
}

module.exports = {
  encodeEnvValue,
  updateEnvFile,
};
