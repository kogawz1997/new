'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { getFilePath } = require('./_persist');

const BASE_DIR = getFilePath(path.join('evidence', 'delivery'));
const MAX_EVENTS = Math.max(
  50,
  Math.min(500, Math.trunc(Number(process.env.DELIVERY_EVIDENCE_MAX_EVENTS || 200) || 200)),
);

function ensureBaseDir() {
  fs.mkdirSync(BASE_DIR, { recursive: true });
}

function sanitizePurchaseCode(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function getEvidenceFilePath(purchaseCode) {
  const safeCode = sanitizePurchaseCode(purchaseCode);
  if (!safeCode) return null;
  ensureBaseDir();
  return path.join(BASE_DIR, `${safeCode}.json`);
}

function loadEvidence(purchaseCode) {
  const filePath = getEvidenceFilePath(purchaseCode);
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function saveEvidence(filePath, payload) {
  ensureBaseDir();
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function normalizeExecution(execution = {}) {
  return {
    executionMode: String(execution.executionMode || '').trim() || null,
    backend: String(execution.backend || '').trim() || null,
    commandPath: String(execution.commandPath || '').trim() || null,
    retryCount: Number.isFinite(Number(execution.retryCount))
      ? Math.max(0, Math.trunc(Number(execution.retryCount)))
      : null,
  };
}

function appendDeliveryEvidenceEvent(purchaseCode, payload = {}) {
  const filePath = getEvidenceFilePath(purchaseCode);
  if (!filePath) return null;
  const current = loadEvidence(purchaseCode) || {
    purchaseCode: String(purchaseCode || '').trim() || null,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    status: null,
    execution: normalizeExecution(payload.execution),
    events: [],
    latestOutputs: [],
    latestCommandSummary: null,
    preview: null,
  };
  const event = {
    at: String(payload.at || new Date().toISOString()),
    level: String(payload.level || 'info').trim() || 'info',
    action: String(payload.action || 'event').trim() || 'event',
    message: String(payload.message || '').trim() || null,
    meta: payload.meta && typeof payload.meta === 'object' ? payload.meta : null,
  };
  current.updatedAt = event.at;
  current.status = String(payload.status || current.status || '').trim() || null;
  current.execution = normalizeExecution({
    ...current.execution,
    ...(payload.execution && typeof payload.execution === 'object' ? payload.execution : null),
  });
  current.latestOutputs = Array.isArray(payload.latestOutputs)
    ? payload.latestOutputs
    : Array.isArray(current.latestOutputs)
      ? current.latestOutputs
      : [];
  current.latestCommandSummary =
    payload.latestCommandSummary != null
      ? payload.latestCommandSummary
      : current.latestCommandSummary || null;
  current.preview = payload.preview != null ? payload.preview : current.preview || null;
  current.events.push(event);
  if (current.events.length > MAX_EVENTS) {
    current.events.splice(0, current.events.length - MAX_EVENTS);
  }
  saveEvidence(filePath, current);
  return {
    ...current,
    filePath,
  };
}

function getDeliveryEvidence(purchaseCode) {
  const evidence = loadEvidence(purchaseCode);
  const filePath = getEvidenceFilePath(purchaseCode);
  if (!evidence || !filePath) return null;
  return {
    ...evidence,
    filePath,
  };
}

module.exports = {
  appendDeliveryEvidenceEvent,
  getDeliveryEvidence,
  getEvidenceFilePath,
};
