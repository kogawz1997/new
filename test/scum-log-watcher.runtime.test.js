const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const watcherModulePath = path.join(__dirname, '..', 'scum-log-watcher.js');
const { tailFile } = require('../scum-log-watcher');

const WATCHER_ENV_KEYS = [
  'SCUM_LOG_PATH',
  'SCUM_WATCHER_ENABLED',
];
const originalWatcherEnv = new Map(
  WATCHER_ENV_KEYS.map((key) => [
    key,
    Object.prototype.hasOwnProperty.call(process.env, key)
      ? process.env[key]
      : undefined,
  ]),
);

function restoreWatcherEnv() {
  for (const [key, value] of originalWatcherEnv.entries()) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function loadWatcherRuntime() {
  delete require.cache[watcherModulePath];
  return require(watcherModulePath);
}

test.afterEach(() => {
  restoreWatcherEnv();
  delete require.cache[watcherModulePath];
});

async function waitFor(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('timed out waiting for condition');
}

test('tailFile stays alive when log file is missing at startup and resumes when file appears', async (t) => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'scum-watcher-'));
  const logPath = path.join(tempDir, 'SCUM.log');
  const lines = [];
  let exitCalled = false;
  const originalExit = process.exit;

  process.exit = () => {
    exitCalled = true;
    throw new Error('process.exit should not be called');
  };

  const stop = tailFile(logPath, (line) => {
    lines.push(line);
  });

  t.after(async () => {
    process.exit = originalExit;
    try {
      stop();
    } catch {}
    await fsp.rm(tempDir, { recursive: true, force: true });
  });

  assert.equal(typeof stop, 'function');
  assert.equal(typeof stop.sync, 'function');
  assert.equal(exitCalled, false);

  await fsp.writeFile(logPath, 'existing line\n', 'utf8');
  await stop.sync();
  assert.deepEqual(lines, []);

  await fsp.appendFile(logPath, 'fresh line\n', 'utf8');
  await stop.sync();
  await waitFor(() => lines.includes('fresh line'));
  assert.equal(exitCalled, false);
});

test('watcher health reports disabled when SCUM_WATCHER_ENABLED=false', () => {
  process.env.SCUM_LOG_PATH = 'D:\\SCUMServer\\SCUM.log';
  process.env.SCUM_WATCHER_ENABLED = 'false';
  const watcher = loadWatcherRuntime();

  const payload = watcher.getWatcherHealthPayload();

  assert.equal(watcher.resolveWatcherEnabled(), false);
  assert.equal(payload.status, 'disabled');
  assert.equal(payload.reason, 'watcher-disabled');
  assert.equal(payload.ready, null);
  assert.equal(payload.watch.fileExists, false);
});
