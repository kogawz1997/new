const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { startScumConsoleAgent } = require('../src/services/scumConsoleAgent');

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const payload = await res.json().catch(() => null);
  return { res, payload };
}

test('scum console agent: exec backend executes command template', async () => {
  const runtime = startScumConsoleAgent({
    env: {
      SCUM_CONSOLE_AGENT_HOST: '127.0.0.1',
      SCUM_CONSOLE_AGENT_PORT: '3313',
      SCUM_CONSOLE_AGENT_TOKEN: 'exec-agent-token-123456',
      SCUM_CONSOLE_AGENT_BACKEND: 'exec',
      SCUM_CONSOLE_AGENT_EXEC_TEMPLATE: `node "${path.join(
        process.cwd(),
        'scripts',
        'agent-echo.js',
      )}" "{command}"`,
    },
  });

  try {
    await runtime.ready;
    const health = await fetchJson('http://127.0.0.1:3313/healthz');
    assert.equal(health.res.status, 200);
    assert.equal(health.payload.backend, 'exec');

    const preflight = await fetchJson('http://127.0.0.1:3313/preflight');
    assert.equal(preflight.res.status, 200);
    assert.equal(preflight.payload.ok, true);
    assert.equal(preflight.payload.ready, true);
    assert.equal(preflight.payload.result?.mode, 'config-exec');

    const execRes = await fetchJson('http://127.0.0.1:3313/execute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer exec-agent-token-123456',
      },
      body: JSON.stringify({
        command: '#SpawnItem 76561198000000001 Weapon_AK47 1',
      }),
    });
    assert.equal(execRes.res.status, 200);
    assert.equal(execRes.payload.ok, true);
    assert.match(execRes.payload.result.stdout, /AGENT-ECHO:/);
  } finally {
    await runtime.close();
  }
});

test('scum console agent: process backend autostarts child and writes command to stdin', async () => {
  const runtime = startScumConsoleAgent({
    env: {
      SCUM_CONSOLE_AGENT_HOST: '127.0.0.1',
      SCUM_CONSOLE_AGENT_PORT: '3314',
      SCUM_CONSOLE_AGENT_TOKEN: 'process-agent-token-123456',
      SCUM_CONSOLE_AGENT_BACKEND: 'process',
      SCUM_CONSOLE_AGENT_AUTOSTART: 'true',
      SCUM_CONSOLE_AGENT_SERVER_EXE: process.execPath,
      SCUM_CONSOLE_AGENT_SERVER_ARGS_JSON: JSON.stringify([
        path.join(process.cwd(), 'scripts', 'fake-console-child.js'),
      ]),
      SCUM_CONSOLE_AGENT_PROCESS_RESPONSE_WAIT_MS: '400',
    },
  });

  try {
    await runtime.ready;
    const preflight = await fetchJson('http://127.0.0.1:3314/preflight');
    assert.equal(preflight.res.status, 200);
    assert.equal(preflight.payload.ok, true);
    assert.equal(preflight.payload.result?.backend, 'process');

    const execPromise = fetchJson('http://127.0.0.1:3314/execute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer process-agent-token-123456',
      },
      body: JSON.stringify({
        command: '#SpawnItem 76561198000000001 Weapon_M1911 1',
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const healthDuring = await fetchJson('http://127.0.0.1:3314/healthz');
    assert.equal(healthDuring.res.status, 200);
    assert.equal(Number(healthDuring.payload.queueDepth || 0) >= 1, true);

    const execRes = await execPromise;
    assert.equal(execRes.res.status, 200);
    assert.equal(execRes.payload.ok, true);
    assert.equal(execRes.payload.result.backend, 'process');
    assert.match(execRes.payload.result.stdout, /ACK:#SpawnItem/);

    const health = await fetchJson('http://127.0.0.1:3314/healthz');
    assert.equal(health.res.status, 200);
    assert.equal(health.payload.managedServer.running, true);
    assert.ok(health.payload.managedServer.pid);
    assert.equal(Number(health.payload.queueDepth || 0), 0);
  } finally {
    await runtime.close();
  }
});

test('scum console agent: window-script preflight exposes actionable stderr details', async () => {
  const runtime = startScumConsoleAgent({
    env: {
      SCUM_CONSOLE_AGENT_HOST: '127.0.0.1',
      SCUM_CONSOLE_AGENT_PORT: '3315',
      SCUM_CONSOLE_AGENT_TOKEN: 'window-agent-token-123456',
      SCUM_CONSOLE_AGENT_BACKEND: 'exec',
      SCUM_CONSOLE_AGENT_EXEC_TEMPLATE: `powershell -NoProfile -ExecutionPolicy Bypass -File "${path.join(
        process.cwd(),
        'scripts',
        'send-scum-admin-command.ps1',
      )}" -WindowTitle "THIS_WINDOW_DOES_NOT_EXIST" -Command "{command}"`,
      SCUM_CONSOLE_AGENT_COMMAND_TIMEOUT_MS: '8000',
    },
  });

  try {
    await runtime.ready;
    const preflight = await fetchJson('http://127.0.0.1:3315/preflight');
    assert.equal(preflight.res.status, 500);
    assert.equal(preflight.payload.ok, false);
    assert.equal(preflight.payload.errorCode, 'AGENT_PREFLIGHT_FAILED');
    assert.match(String(preflight.payload.error || ''), /SCUM window not found/i);
    assert.match(
      String(preflight.payload.result?.detail?.stderr || ''),
      /THIS_WINDOW_DOES_NOT_EXIST/i,
    );
    assert.match(
      String(preflight.payload.result?.detail?.shellCommand || ''),
      /send-scum-admin-command\.ps1/i,
    );
  } finally {
    await runtime.close();
  }
});
