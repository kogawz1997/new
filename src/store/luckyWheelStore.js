const { loadJson, saveJsonDebounced } = require('./_persist');

const STORE_FILENAME = 'lucky-wheel.json';
const MAX_HISTORY_PER_USER = 80;

const wheelState = {
  users: {},
};

function normalizeUserId(userId) {
  const id = String(userId || '').trim();
  return id || null;
}

function normalizeTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeRewardEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim() || 'unknown';
  const label = String(raw.label || '').trim() || id;
  const type = String(raw.type || 'coins').trim().toLowerCase();
  const amount = Number(raw.amount);
  const quantity = Number(raw.quantity);
  const itemId = String(raw.itemId || '').trim() || null;
  const gameItemId = String(raw.gameItemId || '').trim() || null;
  const iconUrl = String(raw.iconUrl || '').trim() || null;
  return {
    id,
    label,
    type: type || 'coins',
    amount: Number.isFinite(amount) ? Math.max(0, Math.trunc(amount)) : 0,
    quantity: Number.isFinite(quantity) ? Math.max(0, Math.trunc(quantity)) : 0,
    itemId,
    gameItemId,
    iconUrl,
    at: normalizeTimestamp(raw.at) || new Date().toISOString(),
  };
}

function normalizeUserState(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      lastSpinAt: null,
      totalSpins: 0,
      history: [],
    };
  }

  const totalSpinsRaw = Number(raw.totalSpins);
  const totalSpins = Number.isFinite(totalSpinsRaw)
    ? Math.max(0, Math.trunc(totalSpinsRaw))
    : 0;
  const history = Array.isArray(raw.history)
    ? raw.history
        .map((entry) => normalizeRewardEntry(entry))
        .filter(Boolean)
        .slice(0, MAX_HISTORY_PER_USER)
    : [];

  return {
    lastSpinAt: normalizeTimestamp(raw.lastSpinAt),
    totalSpins,
    history,
  };
}

function ensureUserState(userId, createIfMissing = true) {
  const id = normalizeUserId(userId);
  if (!id) return null;
  const current = wheelState.users[id];
  if (current) return current;
  if (!createIfMissing) return null;
  const next = normalizeUserState(null);
  wheelState.users[id] = next;
  return next;
}

const scheduleSave = saveJsonDebounced(STORE_FILENAME, () => wheelState);

function getUserWheelState(userId, limit = 20) {
  const id = normalizeUserId(userId);
  if (!id) return null;
  const entry = ensureUserState(id, false) || normalizeUserState(null);
  const take = Math.max(1, Math.min(100, Math.trunc(Number(limit || 20))));
  return {
    userId: id,
    lastSpinAt: entry.lastSpinAt,
    totalSpins: entry.totalSpins,
    history: entry.history.slice(0, take),
  };
}

function canSpinWheel(userId, cooldownMs, nowMs = Date.now()) {
  const id = normalizeUserId(userId);
  if (!id) return { ok: false, reason: 'invalid-user-id', remainingMs: 0 };

  const cooldown = Math.max(0, Math.trunc(Number(cooldownMs || 0)));
  if (cooldown <= 0) {
    return { ok: true, remainingMs: 0, lastSpinAt: null, nextSpinAt: null };
  }

  const entry = ensureUserState(id, false);
  if (!entry?.lastSpinAt) {
    return { ok: true, remainingMs: 0, lastSpinAt: null, nextSpinAt: null };
  }

  const lastSpinMs = new Date(entry.lastSpinAt).getTime();
  if (Number.isNaN(lastSpinMs)) {
    return { ok: true, remainingMs: 0, lastSpinAt: null, nextSpinAt: null };
  }

  const diff = Math.max(0, nowMs - lastSpinMs);
  if (diff >= cooldown) {
    return {
      ok: true,
      remainingMs: 0,
      lastSpinAt: entry.lastSpinAt,
      nextSpinAt: new Date(lastSpinMs + cooldown).toISOString(),
    };
  }

  const remainingMs = cooldown - diff;
  return {
    ok: false,
    reason: 'cooldown',
    remainingMs,
    lastSpinAt: entry.lastSpinAt,
    nextSpinAt: new Date(lastSpinMs + cooldown).toISOString(),
  };
}

function recordWheelSpin(userId, rewardEntry) {
  const id = normalizeUserId(userId);
  if (!id) return { ok: false, reason: 'invalid-user-id' };

  const reward = normalizeRewardEntry(rewardEntry);
  if (!reward) return { ok: false, reason: 'invalid-reward-entry' };

  const entry = ensureUserState(id, true);
  entry.lastSpinAt = reward.at;
  entry.totalSpins = Math.max(0, Number(entry.totalSpins || 0)) + 1;
  entry.history.unshift(reward);
  if (entry.history.length > MAX_HISTORY_PER_USER) {
    entry.history.length = MAX_HISTORY_PER_USER;
  }
  scheduleSave();

  return {
    ok: true,
    data: {
      userId: id,
      lastSpinAt: entry.lastSpinAt,
      totalSpins: entry.totalSpins,
      reward,
    },
  };
}

function loadPersistedState() {
  const persisted = loadJson(STORE_FILENAME, null);
  if (!persisted || typeof persisted !== 'object') return;
  const users = persisted.users && typeof persisted.users === 'object'
    ? persisted.users
    : {};
  for (const [userId, raw] of Object.entries(users)) {
    const id = normalizeUserId(userId);
    if (!id) continue;
    wheelState.users[id] = normalizeUserState(raw);
  }
}

loadPersistedState();

module.exports = {
  getUserWheelState,
  canSpinWheel,
  recordWheelSpin,
};
