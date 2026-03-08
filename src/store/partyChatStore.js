const crypto = require('node:crypto');
const { loadJson, saveJsonDebounced } = require('./_persist');

const STORE_FILENAME = 'party-chat.json';
const MAX_GROUPS = 300;
const MAX_MESSAGES_PER_GROUP = 300;
const MAX_MESSAGE_LENGTH = 280;

const partyChatState = {
  groups: {},
};

function normalizePartyKey(value) {
  const key = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]/g, '');
  if (!key) return null;
  if (key.length > 80) return key.slice(0, 80);
  return key;
}

function normalizeMessageText(value) {
  const text = String(value || '')
    .replace(/\u0000/g, '')
    .replace(/\r/g, '')
    .trim();
  if (!text) return null;
  if (text.length > MAX_MESSAGE_LENGTH) {
    return text.slice(0, MAX_MESSAGE_LENGTH);
  }
  return text;
}

function normalizeMessageEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim() || `msg_${Date.now()}`;
  const partyKey = normalizePartyKey(raw.partyKey);
  const userId = String(raw.userId || '').trim();
  const displayName = String(raw.displayName || '').trim() || userId || 'Unknown';
  const message = normalizeMessageText(raw.message || raw.text);
  const createdAt = raw.createdAt
    ? new Date(raw.createdAt).toISOString()
    : new Date().toISOString();
  if (!partyKey || !userId || !message) return null;
  return {
    id,
    partyKey,
    userId,
    displayName,
    message,
    createdAt,
  };
}

function ensureGroup(partyKey, createIfMissing = true) {
  const key = normalizePartyKey(partyKey);
  if (!key) return null;
  const existing = partyChatState.groups[key];
  if (existing && Array.isArray(existing.messages)) return existing;
  if (!createIfMissing) return null;
  const next = { messages: [] };
  partyChatState.groups[key] = next;
  return next;
}

function trimGroups() {
  const entries = Object.entries(partyChatState.groups);
  if (entries.length <= MAX_GROUPS) return;
  entries.sort((a, b) => {
    const aLast = a[1]?.messages?.[a[1].messages.length - 1]?.createdAt || '';
    const bLast = b[1]?.messages?.[b[1].messages.length - 1]?.createdAt || '';
    return aLast.localeCompare(bLast);
  });
  while (entries.length > MAX_GROUPS) {
    const removed = entries.shift();
    if (removed) delete partyChatState.groups[removed[0]];
  }
}

const scheduleSave = saveJsonDebounced(STORE_FILENAME, () => partyChatState);

function listPartyMessages(partyKey, limit = 80) {
  const group = ensureGroup(partyKey, false);
  if (!group) return [];
  const max = Math.max(1, Math.min(200, Math.trunc(Number(limit || 80))));
  const rows = Array.isArray(group.messages) ? group.messages : [];
  return rows.slice(Math.max(0, rows.length - max)).map((row) => ({ ...row }));
}

function addPartyMessage(partyKey, payload = {}) {
  const key = normalizePartyKey(partyKey);
  if (!key) return { ok: false, reason: 'invalid-party-key' };

  const row = normalizeMessageEntry({
    id:
      typeof crypto.randomUUID === 'function'
        ? `pm_${crypto.randomUUID()}`
        : `pm_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`,
    partyKey: key,
    userId: payload.userId,
    displayName: payload.displayName,
    message: payload.message,
    createdAt: new Date().toISOString(),
  });
  if (!row) return { ok: false, reason: 'invalid-message' };

  const group = ensureGroup(key, true);
  group.messages.push(row);
  if (group.messages.length > MAX_MESSAGES_PER_GROUP) {
    group.messages = group.messages.slice(
      group.messages.length - MAX_MESSAGES_PER_GROUP,
    );
  }
  trimGroups();
  scheduleSave();
  return { ok: true, data: { ...row } };
}

function clearPartyMessages(partyKey) {
  const key = normalizePartyKey(partyKey);
  if (!key) return false;
  const existing = ensureGroup(key, false);
  if (!existing) return false;
  delete partyChatState.groups[key];
  scheduleSave();
  return true;
}

function loadPersistedState() {
  const persisted = loadJson(STORE_FILENAME, null);
  if (!persisted || typeof persisted !== 'object') return;
  const groups = persisted.groups && typeof persisted.groups === 'object'
    ? persisted.groups
    : {};
  for (const [partyKey, value] of Object.entries(groups)) {
    const key = normalizePartyKey(partyKey);
    if (!key) continue;
    const messages = Array.isArray(value?.messages)
      ? value.messages
          .map((row) => normalizeMessageEntry({ ...row, partyKey: key }))
          .filter(Boolean)
          .slice(-MAX_MESSAGES_PER_GROUP)
      : [];
    if (messages.length > 0) {
      partyChatState.groups[key] = { messages };
    }
  }
  trimGroups();
}

loadPersistedState();

module.exports = {
  normalizePartyKey,
  listPartyMessages,
  addPartyMessage,
  clearPartyMessages,
};

