const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const bindingsFile = path.resolve(__dirname, '..', 'src', 'admin', 'assets', 'dashboard-bindings.js');
const controlFile = path.resolve(__dirname, '..', 'src', 'admin', 'assets', 'dashboard-control.js');

test('admin dashboard bindings do not contain placeholder question-mark strings', () => {
  const text = fs.readFileSync(bindingsFile, 'utf8');
  assert.equal(/\?{4,}/.test(text), false);
  assert.match(text, /const DASHBOARD_MESSAGES = Object\.freeze\(/);
});

test('admin dashboard control renders env catalog editor helpers', () => {
  const text = fs.readFileSync(controlFile, 'utf8');
  assert.match(text, /function renderControlEnvCatalog\(/);
  assert.match(text, /function buildControlEnvCatalogPatch\(/);
  assert.match(text, /function saveControlEnvPatch\(/);
  assert.match(text, /data-control-env-save="true"/);
});
