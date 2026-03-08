const {
  addCoins,
  removeCoins,
  setCoins,
  getWallet,
} = require('../store/memoryStore');

function normalizeAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

function normalizeText(value) {
  const text = String(value || '').trim();
  return text || null;
}

async function creditCoins(params = {}) {
  const userId = String(params.userId || '').trim();
  const amount = normalizeAmount(params.amount);
  if (!userId || amount <= 0) {
    return { ok: false, reason: 'invalid-input' };
  }

  const balance = await addCoins(userId, amount, {
    reason: params.reason || 'credit',
    reference: normalizeText(params.reference),
    actor: normalizeText(params.actor) || 'system',
    meta: params.meta && typeof params.meta === 'object' ? params.meta : null,
  });
  return {
    ok: true,
    userId,
    amount,
    balance,
  };
}

async function debitCoins(params = {}) {
  const userId = String(params.userId || '').trim();
  const amount = normalizeAmount(params.amount);
  if (!userId || amount <= 0) {
    return { ok: false, reason: 'invalid-input' };
  }

  const wallet = await getWallet(userId);
  if (wallet.balance < amount) {
    return {
      ok: false,
      reason: 'insufficient-balance',
      userId,
      amount,
      balance: wallet.balance,
    };
  }

  const balance = await removeCoins(userId, amount, {
    reason: params.reason || 'debit',
    reference: normalizeText(params.reference),
    actor: normalizeText(params.actor) || 'system',
    meta: params.meta && typeof params.meta === 'object' ? params.meta : null,
  });
  return {
    ok: true,
    userId,
    amount,
    balance,
  };
}

async function setCoinsExact(params = {}) {
  const userId = String(params.userId || '').trim();
  const amount = normalizeAmount(params.amount);
  if (!userId) {
    return { ok: false, reason: 'invalid-input' };
  }

  const balance = await setCoins(userId, amount, {
    reason: params.reason || 'set',
    reference: normalizeText(params.reference),
    actor: normalizeText(params.actor) || 'system',
    meta: params.meta && typeof params.meta === 'object' ? params.meta : null,
  });
  return {
    ok: true,
    userId,
    amount,
    balance,
  };
}

async function transferCoins(params = {}) {
  const fromUserId = String(params.fromUserId || '').trim();
  const toUserId = String(params.toUserId || '').trim();
  const amount = normalizeAmount(params.amount);
  if (!fromUserId || !toUserId || fromUserId === toUserId || amount <= 0) {
    return { ok: false, reason: 'invalid-input' };
  }

  const outResult = await debitCoins({
    userId: fromUserId,
    amount,
    reason: params.outReason || 'transfer_out',
    actor: params.actor,
    reference: params.reference,
    meta: {
      source: params.source || 'transfer',
      toUserId,
      ...(params.meta && typeof params.meta === 'object' ? params.meta : {}),
    },
  });
  if (!outResult.ok) return outResult;

  try {
    const inResult = await creditCoins({
      userId: toUserId,
      amount,
      reason: params.inReason || 'transfer_in',
      actor: params.actor,
      reference: params.reference,
      meta: {
        source: params.source || 'transfer',
        fromUserId,
        ...(params.meta && typeof params.meta === 'object' ? params.meta : {}),
      },
    });
    if (!inResult.ok) {
      throw new Error(inResult.reason || 'credit-failed');
    }
    return {
      ok: true,
      amount,
      fromUserId,
      toUserId,
      fromBalance: outResult.balance,
      toBalance: inResult.balance,
    };
  } catch (error) {
    await creditCoins({
      userId: fromUserId,
      amount,
      reason: 'transfer_rollback',
      actor: params.actor || 'system',
      reference: params.reference,
      meta: {
        source: params.source || 'transfer',
        toUserId,
        rollbackReason: String(error?.message || error),
      },
    }).catch(() => null);
    return {
      ok: false,
      reason: 'transfer-failed',
      error: String(error?.message || error),
    };
  }
}

module.exports = {
  creditCoins,
  debitCoins,
  setCoinsExact,
  transferCoins,
};
