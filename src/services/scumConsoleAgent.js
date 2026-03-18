'use strict';

const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { executeCommandTemplate, validateCommandTemplate } = require('../utils/commandTemplate');

function asNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envFlag(value, fallback = false) {
  if (value == null || String(value).trim() === '') return fallback;
  const text = String(value).trim().toLowerCase();
  return text === '1' || text === 'true' || text === 'yes' || text === 'on';
}

function trimText(value, maxLen = 1200) {
  const text = String(value || '').trim();
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}...`;
}

function parseJsonArray(value) {
  const text = String(value || '').trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.map((entry) => String(entry)) : [];
  } catch {
    return [];
  }
}

function createAgentError(code, message, meta = null) {
  const error = new Error(message);
  error.agentCode = String(code || 'AGENT_ERROR');
  error.meta = meta && typeof meta === 'object' ? meta : null;
  return error;
}

const MANAGED_SERVER_RESTART_WINDOW_MS = 60 * 1000;
const MANAGED_SERVER_RESTART_MAX_ATTEMPTS = 3;

function collectAgentDetailText(message, meta = null) {
  const parts = [String(message || '').trim()];
  if (meta && typeof meta === 'object') {
    parts.push(
      String(meta.stderr || '').trim(),
      String(meta.stdout || '').trim(),
      String(meta.shellCommand || '').trim(),
    );
    const detail = meta.detail && typeof meta.detail === 'object' ? meta.detail : null;
    if (detail) {
      parts.push(
        String(detail.stderr || '').trim(),
        String(detail.stdout || '').trim(),
        String(detail.message || '').trim(),
      );
    }
  }
  return parts.filter(Boolean).join(' | ');
}

function classifyAgentIssue(codeInput, messageInput, meta = null, options = {}) {
  const code = String(codeInput || 'AGENT_ERROR').trim().toUpperCase() || 'AGENT_ERROR';
  const message = trimText(messageInput || 'Agent error', 300);
  const detailText = collectAgentDetailText(message, meta).toLowerCase();
  const autoRestartEnabled = options.autoRestartEnabled === true;
  const restartPending = options.restartPending === true;

  const classification = {
    code,
    message,
    category: 'unknown',
    reason: 'unknown',
    retryable: true,
    operatorActionRequired: true,
    autoRecoverable: false,
  };

  if (
    /AGENT_TOKEN_MISSING|AGENT_EXEC_TEMPLATE_MISSING|AGENT_BACKEND_UNSUPPORTED|AGENT_SERVER_START_FAILED/.test(
      code,
    )
    || detailText.includes('server_exe is required')
  ) {
    classification.category = 'config';
    classification.reason = 'config-missing';
    classification.retryable = false;
  } else if (/UNAUTHORIZED|AUTH/i.test(code)) {
    classification.category = 'auth';
    classification.reason = 'auth-failed';
    classification.retryable = false;
  } else if (/TIMEOUT/.test(code)) {
    classification.category = 'timeout';
    classification.reason = 'command-timeout';
    classification.retryable = true;
    classification.operatorActionRequired = false;
  } else if (
    /UNREACHABLE/.test(code)
    || /econnrefused|econnreset|ehostunreach|enotfound|request failed/.test(detailText)
  ) {
    classification.category = 'network';
    classification.reason = 'agent-unreachable';
    classification.retryable = true;
    classification.operatorActionRequired = false;
  } else if (/AGENT_MANAGED_SERVER_CRASH_LOOP/.test(code)) {
    classification.category = 'managed-process';
    classification.reason = 'managed-server-crash-loop';
    classification.retryable = true;
    classification.operatorActionRequired = true;
    classification.autoRecoverable = false;
  } else if (/AGENT_MANAGED_SERVER_RESTARTING/.test(code) || restartPending) {
    classification.category = 'managed-process';
    classification.reason = 'managed-server-restarting';
    classification.retryable = true;
    classification.operatorActionRequired = false;
    classification.autoRecoverable = true;
  } else if (/AGENT_MANAGED_SERVER|AGENT_MANAGED_STDIN_UNAVAILABLE/.test(code)) {
    classification.category = 'managed-process';
    classification.reason = 'managed-server-stopped';
    classification.retryable = true;
    classification.operatorActionRequired = autoRestartEnabled !== true;
    classification.autoRecoverable = autoRestartEnabled;
  } else if (
    detailText.includes('scum window not found')
    || detailText.includes('main window handle')
  ) {
    classification.category = 'client-window';
    classification.reason = 'window-not-found';
    classification.retryable = true;
  } else if (detailText.includes('foreground') || detailText.includes('focus')) {
    classification.category = 'client-focus';
    classification.reason = 'window-focus-failed';
    classification.retryable = true;
  } else if (detailText.includes('resolution') || detailText.includes('viewport')) {
    classification.category = 'client-window';
    classification.reason = 'window-resolution-failed';
    classification.retryable = true;
  } else if (detailText.includes('windows session') || detailText.includes('interactive desktop')) {
    classification.category = 'windows-session';
    classification.reason = 'session-unavailable';
    classification.retryable = true;
  } else if (
    detailText.includes('command is required')
    || detailText.includes('only scum admin commands starting with #')
  ) {
    classification.category = 'command-validation';
    classification.reason = 'command-rejected';
    classification.retryable = false;
  }

  return classification;
}

function buildAgentRecovery(classification, options = {}) {
  if (!classification) return null;

  const recovery = {
    action: 'inspect-agent',
    hint: 'Inspect the console agent state before retrying.',
    retryable: classification.retryable === true,
    operatorActionRequired: classification.operatorActionRequired === true,
    autoRecoverable: classification.autoRecoverable === true,
    restartScheduledAt: options.restartScheduledAt || null,
  };

  if (classification.category === 'config') {
    recovery.action = 'fix-config';
    recovery.hint = 'Fix the console-agent configuration and rerun preflight before retrying.';
  } else if (classification.category === 'auth') {
    recovery.action = 'fix-auth';
    recovery.hint = 'Align the console-agent token/auth settings and rerun preflight.';
  } else if (classification.category === 'timeout') {
    recovery.action = 'retry-after-client-check';
    recovery.hint = 'Check SCUM client responsiveness and command timeout settings, then retry.';
  } else if (classification.category === 'network') {
    recovery.action = 'check-agent-reachability';
    recovery.hint = 'Check the console-agent service endpoint and local networking, then retry.';
  } else if (classification.reason === 'managed-server-restarting') {
    recovery.action = 'wait-for-restart';
    recovery.hint = options.restartScheduledAt
      ? `Wait for the managed server restart scheduled at ${options.restartScheduledAt}, then rerun preflight.`
      : 'Wait for the managed server restart to complete, then rerun preflight.';
  } else if (classification.reason === 'managed-server-crash-loop') {
    recovery.action = 'investigate-managed-server-crash';
    recovery.hint = 'Investigate repeated managed-server exits before attempting another delivery.';
  } else if (classification.category === 'managed-process') {
    recovery.action = classification.autoRecoverable ? 'wait-for-restart' : 'restart-managed-server';
    recovery.hint = classification.autoRecoverable
      ? 'Wait for the managed server to recover, then rerun preflight.'
      : 'Restart the managed server and rerun preflight.';
  } else if (classification.category === 'client-window') {
    recovery.action = 'restore-scum-window';
    recovery.hint = 'Restore the SCUM client window/title binding and rerun preflight.';
  } else if (classification.category === 'client-focus') {
    recovery.action = 'restore-window-focus';
    recovery.hint = 'Bring the SCUM window to the foreground and keep the session unlocked before retrying.';
  } else if (classification.category === 'windows-session') {
    recovery.action = 'unlock-session';
    recovery.hint = 'Unlock the Windows session and keep the interactive desktop available before retrying.';
  } else if (classification.category === 'command-validation') {
    recovery.action = 'fix-command';
    recovery.hint = 'Fix the command/template input before retrying.';
  }

  return recovery;
}

function summarizeExecFailure(error, fallbackCode = 'AGENT_EXEC_FAILED') {
  const stderr = trimText(error?.stderr || '', 600);
  const stdout = trimText(error?.stdout || '', 600);
  const detail = {
    shellCommand: String(error?.displayCommand || '').trim() || null,
    stderr: stderr || null,
    stdout: stdout || null,
    exitCode:
      Number.isFinite(Number(error?.exitCode)) ? Number(error.exitCode) : null,
    signal: String(error?.signal || '').trim() || null,
  };
  const message =
    stderr
    || stdout
    || trimText(error?.message || 'Command failed', 300);
  return createAgentError(
    fallbackCode,
    message,
    detail,
  );
}

function normalizeHost(value, fallback = '127.0.0.1') {
  const text = String(value || '').trim();
  return text || fallback;
}

function normalizeBaseUrl(value, host, port) {
  const text = String(value || '').trim();
  if (text) return text.replace(/\/+$/, '');
  return `http://${host}:${port}`;
}

function getAgentSettings(env = process.env) {
  const host = normalizeHost(env.SCUM_CONSOLE_AGENT_HOST, '127.0.0.1');
  const port = Math.max(1, Math.trunc(asNumber(env.SCUM_CONSOLE_AGENT_PORT, 3213)));
  const backend = String(env.SCUM_CONSOLE_AGENT_BACKEND || 'exec').trim().toLowerCase() || 'exec';
  const token = String(env.SCUM_CONSOLE_AGENT_TOKEN || '').trim();
  const commandTimeoutMs = Math.max(
    1000,
    Math.trunc(asNumber(env.SCUM_CONSOLE_AGENT_COMMAND_TIMEOUT_MS, 15000)),
  );
  const allowNonHashCommands = envFlag(
    env.SCUM_CONSOLE_AGENT_ALLOW_NON_HASH,
    false,
  );

  const serverExe = String(env.SCUM_CONSOLE_AGENT_SERVER_EXE || '').trim();
  const serverArgs = parseJsonArray(env.SCUM_CONSOLE_AGENT_SERVER_ARGS_JSON);
  const serverWorkdir = String(env.SCUM_CONSOLE_AGENT_SERVER_WORKDIR || '').trim();
  const autoStartServer = envFlag(env.SCUM_CONSOLE_AGENT_AUTOSTART, false);
  const processResponseWaitMs = Math.max(
    50,
    Math.trunc(asNumber(env.SCUM_CONSOLE_AGENT_PROCESS_RESPONSE_WAIT_MS, 200)),
  );

  return {
    host,
    port,
    baseUrl: normalizeBaseUrl(env.SCUM_CONSOLE_AGENT_BASE_URL, host, port),
    token,
    backend,
    execTemplate: String(env.SCUM_CONSOLE_AGENT_EXEC_TEMPLATE || '').trim(),
    commandTimeoutMs,
    allowNonHashCommands,
    serverExe,
    serverArgs,
    serverWorkdir,
    autoStartServer,
    processResponseWaitMs,
  };
}

function createJsonResponder(res) {
  return (statusCode, payload) => {
    const body = JSON.stringify(payload);
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  };
}

function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error('request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error(`invalid json: ${error.message}`));
      }
    });
    req.on('error', reject);
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createOutputBuffer(maxEntries = 80) {
  const buffer = [];
  return {
    push(chunk) {
      const text = String(chunk || '');
      const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      for (const line of lines) {
        buffer.push(line);
      }
      if (buffer.length > maxEntries) {
        buffer.splice(0, buffer.length - maxEntries);
      }
    },
    list() {
      return buffer.slice();
    },
    tail(limit = 8) {
      return buffer.slice(Math.max(0, buffer.length - limit));
    },
    clear() {
      buffer.length = 0;
    },
  };
}

function startScumConsoleAgent(options = {}) {
  const env = options.env || process.env;
  const settings = getAgentSettings(env);
  const name = String(options.name || 'scum-console-agent').trim() || 'scum-console-agent';

  let managedChild = null;
  let managedChildExit = null;
  let managedStartPromise = null;
  let managedRestartTimer = null;
  let managedRestartScheduledAt = null;
  let managedRestartPendingReason = null;
  let managedRestartCount = 0;
  let managedRestartLastAt = null;
  let managedRestartLastReason = null;
  let managedRestartSuppressedAt = null;
  let managedRestartSuppressedReason = null;
  const managedRestartAttemptTimestamps = [];
  let managedStopRequested = false;
  let shuttingDown = false;
  let lastCommandAt = null;
  let lastSuccessAt = null;
  let lastError = null;
  let lastErrorCode = null;
  let lastErrorMeta = null;
  let lastPreflightAt = null;
  let lastPreflight = null;
  let startedAt = new Date().toISOString();
  let executeCount = 0;
  let activeExecutionCount = 0;
  let queuedExecutionCount = 0;
  let executionQueue = Promise.resolve();
  const recentStdout = createOutputBuffer(120);
  const recentStderr = createOutputBuffer(120);
  const recentExecutions = [];

  function pushExecution(entry) {
    recentExecutions.push({
      at: new Date().toISOString(),
      ...entry,
    });
    if (recentExecutions.length > 25) {
      recentExecutions.splice(0, recentExecutions.length - 25);
    }
  }

  function getQueueDepth() {
    return Math.max(0, queuedExecutionCount);
  }

  function getManagedRestartEnabled() {
    return settings.backend === 'process' && settings.autoStartServer;
  }

  function pruneManagedRestartAttempts(now = Date.now()) {
    while (
      managedRestartAttemptTimestamps.length > 0
      && now - managedRestartAttemptTimestamps[0] > MANAGED_SERVER_RESTART_WINDOW_MS
    ) {
      managedRestartAttemptTimestamps.shift();
    }
  }

  function clearManagedRestartSchedule() {
    if (managedRestartTimer) {
      clearTimeout(managedRestartTimer);
      managedRestartTimer = null;
    }
    managedRestartScheduledAt = null;
    managedRestartPendingReason = null;
  }

  function getManagedRestartState() {
    return {
      enabled: getManagedRestartEnabled(),
      pending: Boolean(managedRestartTimer),
      pendingAt: managedRestartScheduledAt,
      pendingReason: managedRestartPendingReason,
      restartCount: managedRestartCount,
      lastRestartAt: managedRestartLastAt,
      lastRestartReason: managedRestartLastReason,
      suppressedAt: managedRestartSuppressedAt,
      suppressedReason: managedRestartSuppressedReason,
    };
  }

  function isWindowScriptTemplate(template) {
    return /send-scum-admin-command\.ps1/i.test(String(template || ''));
  }

  function getCurrentAgentIssue() {
    const restartState = getManagedRestartState();
    if (restartState.suppressedAt) {
      return {
        code: 'AGENT_MANAGED_SERVER_CRASH_LOOP',
        message:
          managedRestartSuppressedReason
          || 'Managed SCUM server exited repeatedly; automatic restart is suppressed',
        meta: {
          restart: restartState,
          lastExit: managedChildExit,
        },
      };
    }
    if (restartState.pending && !managedChild) {
      return {
        code: 'AGENT_MANAGED_SERVER_RESTARTING',
        message: 'Managed SCUM server restart is scheduled',
        meta: {
          restart: restartState,
          lastExit: managedChildExit,
        },
      };
    }
    if (lastErrorCode || lastError) {
      return {
        code: lastErrorCode || 'AGENT_EXEC_FAILED',
        message: lastError || 'Agent reported an error',
        meta: lastErrorMeta,
      };
    }
    return null;
  }

  function buildCurrentAgentDiagnostic() {
    const issue = getCurrentAgentIssue();
    if (!issue) {
      return {
        classification: null,
        recovery: null,
      };
    }

    const restartState = getManagedRestartState();
    const classification = classifyAgentIssue(
      issue.code,
      issue.message,
      issue.meta,
      {
        autoRestartEnabled: restartState.enabled,
        restartPending: restartState.pending,
      },
    );

    return {
      classification,
      recovery: buildAgentRecovery(classification, {
        restartScheduledAt: restartState.pendingAt,
      }),
    };
  }

  function getAgentStatus() {
    if (!settings.token) {
      return { status: 'error', ready: false, code: 'AGENT_TOKEN_MISSING', message: 'SCUM_CONSOLE_AGENT_TOKEN is not set' };
    }
    if (settings.backend === 'exec' && !settings.execTemplate) {
      return { status: 'error', ready: false, code: 'AGENT_EXEC_TEMPLATE_MISSING', message: 'SCUM_CONSOLE_AGENT_EXEC_TEMPLATE is not set' };
    }
    if (settings.backend === 'process' && settings.autoStartServer && !managedChild) {
      const issue = getCurrentAgentIssue();
      return {
        status: 'degraded',
        ready: false,
        code: issue?.code || 'AGENT_MANAGED_SERVER_STOPPED',
        message: issue?.message || 'Managed SCUM server is not running',
      };
    }
    if (lastErrorCode || lastError) {
      const issue = getCurrentAgentIssue();
      return {
        status: 'degraded',
        ready: false,
        code: issue?.code || lastErrorCode || 'AGENT_EXEC_FAILED',
        message: issue?.message || lastError || 'Agent reported an error',
      };
    }
    return { status: 'ready', ready: true, code: 'READY', message: 'Agent ready' };
  }

  function buildExecInvocation(command, options = {}) {
    if (!settings.execTemplate) {
      throw createAgentError(
        'AGENT_EXEC_TEMPLATE_MISSING',
        'SCUM_CONSOLE_AGENT_EXEC_TEMPLATE is not set',
      );
    }
    validateCommandTemplate(settings.execTemplate);
    return {
      template: settings.execTemplate,
      vars: { command },
      extraArgs:
        options.checkOnly && isWindowScriptTemplate(settings.execTemplate)
          ? ['-CheckOnly']
          : [],
    };
  }

  function getManagedServerState() {
    return {
      running: Boolean(managedChild && !managedChild.killed),
      pid: managedChild?.pid || null,
      exit: managedChildExit,
      exe: settings.serverExe || null,
      workdir: settings.serverWorkdir || null,
      args: settings.serverArgs,
      stdoutTail: recentStdout.tail(),
      stderrTail: recentStderr.tail(),
      restart: getManagedRestartState(),
    };
  }

  function attachManagedChild(child) {
    managedChild = child;
    managedChildExit = null;
    managedStopRequested = false;
    managedRestartSuppressedAt = null;
    managedRestartSuppressedReason = null;
    recentStdout.clear();
    recentStderr.clear();
    child.stdout?.on('data', (chunk) => {
      recentStdout.push(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      recentStderr.push(chunk);
    });
    child.on('exit', (code, signal) => {
      const stopRequested = managedStopRequested;
      managedChildExit = { code, signal, at: new Date().toISOString() };
      managedChild = null;
      managedStartPromise = null;
      if (shuttingDown) return;
      if (stopRequested) {
        managedStopRequested = false;
        return;
      }
      lastError = `Managed SCUM server exited (code=${code ?? 'null'} signal=${signal || 'none'})`;
      lastErrorCode = 'AGENT_MANAGED_SERVER_STOPPED';
      lastErrorMeta = {
        code,
        signal,
        exit: managedChildExit,
        restart: getManagedRestartState(),
      };
      if (getManagedRestartEnabled()) {
        scheduleManagedServerRestart('managed-server-exit');
      }
    });
  }

  function scheduleManagedServerRestart(reason = 'managed-server-exit') {
    if (!getManagedRestartEnabled()) return false;
    if (shuttingDown || managedStopRequested) return false;
    if (managedChild && !managedChild.killed) return false;
    if (managedRestartTimer || managedStartPromise) return true;

    const now = Date.now();
    pruneManagedRestartAttempts(now);
    if (managedRestartAttemptTimestamps.length >= MANAGED_SERVER_RESTART_MAX_ATTEMPTS) {
      managedRestartSuppressedAt = new Date().toISOString();
      managedRestartSuppressedReason =
        'Managed SCUM server exited repeatedly; automatic restart is suppressed';
      lastError = managedRestartSuppressedReason;
      lastErrorCode = 'AGENT_MANAGED_SERVER_CRASH_LOOP';
      lastErrorMeta = {
        reason,
        exit: managedChildExit,
        restart: getManagedRestartState(),
      };
      clearManagedRestartSchedule();
      return false;
    }

    const backoffMs = Math.max(250, settings.processResponseWaitMs);
    managedRestartScheduledAt = new Date(now + backoffMs).toISOString();
    managedRestartPendingReason = reason;
    managedRestartTimer = setTimeout(() => {
      managedRestartTimer = null;
      managedRestartScheduledAt = null;
      managedRestartPendingReason = null;
      managedRestartAttemptTimestamps.push(Date.now());
      managedRestartCount += 1;
      managedRestartLastAt = new Date().toISOString();
      managedRestartLastReason = reason;
      void ensureManagedServerStarted().catch((error) => {
        lastError = error.message;
        lastErrorCode = String(error.agentCode || error.code || 'AGENT_SERVER_START_FAILED');
        lastErrorMeta = error.meta || null;
        if (getManagedRestartEnabled()) {
          scheduleManagedServerRestart('managed-server-restart-failed');
        }
      });
    }, backoffMs);
    return true;
  }

  function ensureCommandAllowed(command) {
    const trimmed = String(command || '').trim();
    if (!trimmed) {
      throw new Error('command is required');
    }
    if (!settings.allowNonHashCommands && !trimmed.startsWith('#')) {
      throw new Error(
        'agent only allows SCUM admin commands starting with # by default',
      );
    }
    return trimmed;
  }

  async function ensureManagedServerStarted() {
    if (managedChild && !managedChild.killed) {
      return managedChild;
    }
    if (managedStartPromise) {
      return managedStartPromise;
    }
    if (!settings.serverExe) {
      throw new Error('SCUM_CONSOLE_AGENT_SERVER_EXE is required for process backend');
    }

    managedStopRequested = false;
    const startingFromPendingRestart = Boolean(managedRestartScheduledAt);
    const pendingRestartReason = managedRestartPendingReason;
    clearManagedRestartSchedule();
    if (startingFromPendingRestart) {
      managedRestartAttemptTimestamps.push(Date.now());
      pruneManagedRestartAttempts();
      managedRestartCount += 1;
      managedRestartLastAt = new Date().toISOString();
      managedRestartLastReason = pendingRestartReason || 'managed-server-restart';
    }
    managedStartPromise = (async () => {
      const child = spawn(settings.serverExe, settings.serverArgs, {
        cwd: settings.serverWorkdir || path.dirname(settings.serverExe),
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      });
      attachManagedChild(child);
      await wait(settings.processResponseWaitMs);
      return child;
    })();

    try {
      const child = await managedStartPromise;
      lastError = null;
      lastErrorCode = null;
      lastErrorMeta = null;
      return child;
    } finally {
      managedStartPromise = null;
    }
  }

  async function executeWithExecBackend(command) {
    const invocation = buildExecInvocation(command);
    const result = await executeCommandTemplate(
      invocation.template,
      invocation.vars,
      {
        extraArgs: invocation.extraArgs,
        timeoutMs: settings.commandTimeoutMs,
        windowsHide: true,
        cwd: process.cwd(),
      },
    );
    return {
      backend: 'exec',
      accepted: true,
      shellCommand: result.displayCommand,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  async function executeWithProcessBackend(command) {
    const child = await ensureManagedServerStarted();
    if (!child.stdin || child.stdin.destroyed || !child.stdin.writable) {
      throw createAgentError(
        'AGENT_MANAGED_STDIN_UNAVAILABLE',
        'managed server stdin is not writable',
      );
    }
    child.stdin.write(`${command}\n`);
    await wait(settings.processResponseWaitMs);
    return {
      backend: 'process',
      accepted: true,
      pid: child.pid,
      stdout: trimText(recentStdout.tail().join('\n')),
      stderr: trimText(recentStderr.tail().join('\n')),
    };
  }

  async function runPreflight() {
    lastPreflightAt = new Date().toISOString();

    if (!settings.token) {
      throw createAgentError('AGENT_TOKEN_MISSING', 'SCUM_CONSOLE_AGENT_TOKEN is not set');
    }

    if (settings.backend === 'exec') {
      if (!settings.execTemplate) {
        throw createAgentError(
          'AGENT_EXEC_TEMPLATE_MISSING',
          'SCUM_CONSOLE_AGENT_EXEC_TEMPLATE is not set',
        );
      }

      if (isWindowScriptTemplate(settings.execTemplate)) {
        const invocation = buildExecInvocation('#Announce PREFLIGHT', {
          checkOnly: true,
        });
        let result;
        try {
          result = await executeCommandTemplate(
            invocation.template,
            invocation.vars,
            {
              extraArgs: invocation.extraArgs,
              timeoutMs: settings.commandTimeoutMs,
              windowsHide: true,
              cwd: process.cwd(),
            },
          );
        } catch (error) {
          throw summarizeExecFailure(error, 'AGENT_PREFLIGHT_FAILED');
        }
        let parsed = null;
        try {
          parsed = result.stdout ? JSON.parse(result.stdout) : null;
        } catch {}
        lastPreflight = {
          ok: true,
          backend: 'exec',
          check: 'window',
          shellCommand: result.displayCommand,
          stdout: trimText(result.stdout),
          stderr: trimText(result.stderr),
          detail: parsed,
          classification: null,
          recovery: null,
        };
        lastError = null;
        lastErrorCode = null;
        lastErrorMeta = null;
        return lastPreflight;
      }

      lastPreflight = {
        ok: true,
        backend: 'exec',
        check: 'config',
        mode: 'config-exec',
        shellCommand: null,
        detail: {
          templateConfigured: true,
          windowAware: false,
        },
        classification: null,
        recovery: null,
      };
      lastError = null;
      lastErrorCode = null;
      lastErrorMeta = null;
      return lastPreflight;
    }

    if (settings.backend === 'process') {
      const running = Boolean(managedChild && !managedChild.killed);
      if (!running && settings.autoStartServer) {
        await ensureManagedServerStarted();
      }
      const currentRunning = Boolean(managedChild && !managedChild.killed);
      if (!currentRunning) {
        throw createAgentError(
          'AGENT_MANAGED_SERVER_STOPPED',
          'Managed SCUM server is not running',
        );
      }
      lastPreflight = {
        ok: true,
        backend: 'process',
        check: 'managed-server',
        detail: getManagedServerState(),
        classification: null,
        recovery: null,
      };
      lastError = null;
      lastErrorCode = null;
      lastErrorMeta = null;
      return lastPreflight;
    }

    throw createAgentError('AGENT_BACKEND_UNSUPPORTED', `Unsupported backend: ${settings.backend}`);
  }

  // Commands are serialized to preserve in-game ordering and to make queue depth/health
  // reflect the real backlog seen by operators.
  async function executeCommand(command) {
    const normalizedCommand = ensureCommandAllowed(command);
    const executeOnce = async () => {
      activeExecutionCount += 1;
      lastCommandAt = new Date().toISOString();
      executeCount += 1;

      try {
        let result;
        if (settings.backend === 'process') {
          result = await executeWithProcessBackend(normalizedCommand);
        } else {
          try {
            result = await executeWithExecBackend(normalizedCommand);
          } catch (error) {
            throw summarizeExecFailure(error, 'AGENT_EXEC_FAILED');
          }
        }

        lastSuccessAt = new Date().toISOString();
        lastError = null;
        lastErrorCode = null;

        pushExecution({
          ok: true,
          backend: settings.backend,
          command: normalizedCommand,
          stdout: trimText(result.stdout, 250),
          stderr: trimText(result.stderr, 250),
        });
        return result;
      } catch (error) {
        lastError = error.message;
        lastErrorCode = String(error.agentCode || error.code || 'AGENT_EXEC_FAILED');
        lastErrorMeta = error.meta || null;
        throw error;
      } finally {
        activeExecutionCount = Math.max(0, activeExecutionCount - 1);
        queuedExecutionCount = Math.max(0, queuedExecutionCount - 1);
      }
    };

    queuedExecutionCount += 1;
    const nextExecution = executionQueue.then(executeOnce);
    executionQueue = nextExecution.catch(() => {});
    return nextExecution;
  }

  function stopManagedServer() {
    if (!managedChild || managedChild.killed) return false;
    managedStopRequested = true;
    clearManagedRestartSchedule();
    managedChild.kill();
    return true;
  }

  if (settings.backend === 'process' && settings.autoStartServer) {
    void ensureManagedServerStarted().catch((error) => {
      lastError = error.message;
      lastErrorCode = String(error.agentCode || error.code || 'AGENT_SERVER_START_FAILED');
      lastErrorMeta = error.meta || null;
      console.error(`[${name}] failed to autostart managed server:`, error.message);
    });
  }

  const server = http.createServer(async (req, res) => {
    const reply = createJsonResponder(res);
    const url = new URL(req.url || '/', `http://${settings.host}:${settings.port}`);

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/healthz')) {
      const status = getAgentStatus();
      const diagnostic = buildCurrentAgentDiagnostic();
      return reply(200, {
        ok: true,
        service: name,
        backend: settings.backend,
        status: status.status,
        ready: status.ready,
        statusCode: status.code,
        statusMessage: status.message,
        now: new Date().toISOString(),
        startedAt,
        lastCommandAt,
        lastSuccessAt,
        lastError,
        lastErrorCode,
        lastErrorDetail: lastErrorMeta,
        lastPreflightAt,
        lastPreflight,
        classification: diagnostic.classification,
        recovery: diagnostic.recovery,
        activeExecutionCount,
        recentExecutions: recentExecutions.slice(-10),
        executeCount,
        queueDepth: getQueueDepth(),
        managedServer: getManagedServerState(),
      });
    }

    if (req.method === 'GET' && url.pathname === '/preflight') {
      try {
        const result = await runPreflight();
        const status = getAgentStatus();
        const diagnostic = buildCurrentAgentDiagnostic();
        return reply(200, {
          ok: true,
          ready: status.ready,
          status: status.status,
          statusCode: status.code,
          statusMessage: status.message,
          classification: diagnostic.classification,
          recovery: diagnostic.recovery,
          result,
        });
      } catch (error) {
        lastError = error.message;
        lastErrorCode = String(error.agentCode || error.code || 'AGENT_PREFLIGHT_FAILED');
        lastErrorMeta = error.meta || null;
        const classification = classifyAgentIssue(
          lastErrorCode,
          error.message,
          error.meta || null,
          {
            autoRestartEnabled: getManagedRestartEnabled(),
            restartPending: Boolean(getManagedRestartState().pending),
          },
        );
        const recovery = buildAgentRecovery(classification, {
          restartScheduledAt: getManagedRestartState().pendingAt,
        });
        lastPreflight = {
          ok: false,
          backend: settings.backend,
          error: error.message,
          errorCode: lastErrorCode,
          detail: error.meta || null,
          classification,
          recovery,
        };
        return reply(500, {
          ok: false,
          ready: false,
          error: error.message,
          errorCode: lastErrorCode,
          classification,
          recovery,
          result: lastPreflight,
        });
      }
    }

    if (req.method !== 'POST') {
      return reply(405, { ok: false, error: 'method-not-allowed' });
    }

    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
      || String(req.headers['x-agent-token'] || '').trim();
    if (!settings.token || token !== settings.token) {
      return reply(401, { ok: false, error: 'unauthorized' });
    }

    let body = {};
    try {
      body = await parseRequestBody(req);
    } catch (error) {
      return reply(400, { ok: false, error: error.message });
    }

    if (url.pathname === '/execute') {
      try {
        const result = await executeCommand(body.command);
        return reply(200, { ok: true, result });
      } catch (error) {
        lastError = error.message;
        lastErrorCode = String(error.agentCode || error.code || 'AGENT_EXEC_FAILED');
        lastErrorMeta = error.meta || null;
        const classification = classifyAgentIssue(
          lastErrorCode,
          error.message,
          error.meta || null,
          {
            autoRestartEnabled: getManagedRestartEnabled(),
            restartPending: Boolean(getManagedRestartState().pending),
          },
        );
        const recovery = buildAgentRecovery(classification, {
          restartScheduledAt: getManagedRestartState().pendingAt,
        });
        pushExecution({
          ok: false,
          backend: settings.backend,
          command: String(body.command || '').trim(),
          error: error.message,
          errorCode: lastErrorCode,
          classification,
        });
        return reply(500, {
          ok: false,
          error: error.message,
          errorCode: lastErrorCode,
          classification,
          recovery,
        });
      }
    }

    if (url.pathname === '/server/start') {
      try {
        if (settings.backend !== 'process') {
          throw new Error('server start is only supported for process backend');
        }
        managedStopRequested = false;
        managedRestartSuppressedAt = null;
        managedRestartSuppressedReason = null;
        const child = await ensureManagedServerStarted();
        return reply(200, {
          ok: true,
          started: true,
          pid: child.pid,
        });
      } catch (error) {
        lastError = error.message;
        lastErrorCode = String(error.agentCode || error.code || 'AGENT_SERVER_START_FAILED');
        lastErrorMeta = error.meta || null;
        const classification = classifyAgentIssue(
          lastErrorCode,
          error.message,
          error.meta || null,
          {
            autoRestartEnabled: getManagedRestartEnabled(),
            restartPending: Boolean(getManagedRestartState().pending),
          },
        );
        const recovery = buildAgentRecovery(classification, {
          restartScheduledAt: getManagedRestartState().pendingAt,
        });
        return reply(500, {
          ok: false,
          error: error.message,
          errorCode: lastErrorCode,
          classification,
          recovery,
        });
      }
    }

    if (url.pathname === '/server/stop') {
      const stopped = stopManagedServer();
      return reply(200, { ok: true, stopped });
    }

    return reply(404, { ok: false, error: 'not-found' });
  });

  server.on('error', (error) => {
    lastError = error.message;
    lastErrorCode = String(error.code || 'AGENT_SERVER_ERROR');
    lastErrorMeta = null;
    console.error(`[${name}] server error:`, error.message);
  });

  const ready = new Promise((resolve) => {
    server.listen(settings.port, settings.host, () => {
      console.log(`[${name}] listening at http://${settings.host}:${settings.port}`);
      console.log(`[${name}] backend=${settings.backend}`);
      resolve();
    });
  });

  return {
    settings,
    server,
    ready,
    async close() {
      shuttingDown = true;
      clearManagedRestartSchedule();
      managedStopRequested = true;
      if (managedChild && !managedChild.killed) {
        managedChild.kill();
      }
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

module.exports = {
  getAgentSettings,
  startScumConsoleAgent,
};
