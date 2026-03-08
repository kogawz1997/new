const KNOWN_PURCHASE_STATUSES = new Set([
  'pending',
  'delivering',
  'delivered',
  'delivery_failed',
  'refunded',
]);

const STATUS_TRANSITIONS = {
  pending: new Set(['delivering', 'delivered', 'delivery_failed', 'refunded']),
  delivering: new Set(['pending', 'delivered', 'delivery_failed', 'refunded']),
  delivery_failed: new Set(['pending', 'delivering', 'refunded']),
  delivered: new Set([]),
  refunded: new Set([]),
};

function normalizePurchaseStatus(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function isKnownPurchaseStatus(value) {
  return KNOWN_PURCHASE_STATUSES.has(normalizePurchaseStatus(value));
}

function listKnownPurchaseStatuses() {
  return Array.from(KNOWN_PURCHASE_STATUSES.values());
}

function listAllowedPurchaseTransitions(fromStatus) {
  const from = normalizePurchaseStatus(fromStatus);
  return Array.from(STATUS_TRANSITIONS[from] || []);
}

function validatePurchaseStatusTransition(fromStatus, toStatus, options = {}) {
  const from = normalizePurchaseStatus(fromStatus);
  const to = normalizePurchaseStatus(toStatus);
  const force = options.force === true;

  if (!to) {
    return { ok: false, reason: 'empty-target-status', from, to };
  }

  if (!isKnownPurchaseStatus(to)) {
    return { ok: false, reason: 'unknown-target-status', from, to };
  }

  if (!from) {
    return { ok: true, from, to, reason: 'no-current-status' };
  }

  if (!isKnownPurchaseStatus(from)) {
    if (force) {
      return { ok: true, from, to, reason: 'forced-from-unknown' };
    }
    return { ok: false, reason: 'unknown-current-status', from, to };
  }

  if (from === to) {
    return { ok: true, from, to, reason: 'same-status' };
  }

  const allowed = STATUS_TRANSITIONS[from] || new Set();
  if (allowed.has(to)) {
    return { ok: true, from, to, reason: 'transition-allowed' };
  }

  if (force) {
    return { ok: true, from, to, reason: 'forced-transition' };
  }

  return {
    ok: false,
    reason: 'transition-not-allowed',
    from,
    to,
    allowed: Array.from(allowed),
  };
}

module.exports = {
  normalizePurchaseStatus,
  isKnownPurchaseStatus,
  listKnownPurchaseStatuses,
  listAllowedPurchaseTransitions,
  validatePurchaseStatusTransition,
};
