const { prisma } = require('../prisma');

function normalizeDiscordId(value) {
  const id = String(value || '').trim();
  if (!/^\d{15,25}$/.test(id)) return null;
  return id;
}

function normalizeSteamId(value) {
  const id = String(value || '').trim();
  if (!id) return null;
  if (!/^\d{15,25}$/.test(id)) return null;
  return id;
}

function normalizeText(value) {
  const text = String(value || '').trim();
  return text || null;
}

async function upsertPlayerAccount(input = {}) {
  const discordId = normalizeDiscordId(input.discordId || input.userId);
  if (!discordId) {
    return { ok: false, reason: 'invalid-discord-id' };
  }

  const steamId = normalizeSteamId(input.steamId);
  try {
    const row = await prisma.playerAccount.upsert({
      where: { discordId },
      update: {
        username: normalizeText(input.username),
        displayName: normalizeText(input.displayName),
        avatarUrl: normalizeText(input.avatarUrl),
        steamId,
        isActive: input.isActive === false ? false : true,
      },
      create: {
        discordId,
        username: normalizeText(input.username),
        displayName: normalizeText(input.displayName),
        avatarUrl: normalizeText(input.avatarUrl),
        steamId,
        isActive: input.isActive === false ? false : true,
      },
    });
    return { ok: true, data: row };
  } catch (error) {
    if (error?.code === 'P2002') {
      return { ok: false, reason: 'steam-id-already-bound' };
    }
    throw error;
  }
}

async function bindPlayerSteamId(discordId, steamId) {
  const did = normalizeDiscordId(discordId);
  const sid = normalizeSteamId(steamId);
  if (!did || !sid) {
    return { ok: false, reason: 'invalid-input' };
  }
  return upsertPlayerAccount({
    discordId: did,
    steamId: sid,
    isActive: true,
  });
}

async function unbindPlayerSteamId(discordId) {
  const did = normalizeDiscordId(discordId);
  if (!did) return { ok: false, reason: 'invalid-discord-id' };

  const row = await prisma.playerAccount.upsert({
    where: { discordId: did },
    update: {
      steamId: null,
    },
    create: {
      discordId: did,
      steamId: null,
      isActive: true,
    },
  });
  return { ok: true, data: row };
}

async function getPlayerAccount(discordId) {
  const did = normalizeDiscordId(discordId);
  if (!did) return null;
  return prisma.playerAccount.findUnique({
    where: { discordId: did },
  });
}

async function listPlayerAccounts(limit = 100) {
  const take = Math.max(1, Math.min(1000, Math.trunc(Number(limit || 100))));
  return prisma.playerAccount.findMany({
    orderBy: { updatedAt: 'desc' },
    take,
  });
}

async function getPlayerDashboard(discordId) {
  const did = normalizeDiscordId(discordId);
  if (!did) {
    return { ok: false, reason: 'invalid-discord-id' };
  }

  const [account, wallet, stats, vip, links, recentPurchases] = await Promise.all([
    prisma.playerAccount.findUnique({ where: { discordId: did } }),
    prisma.userWallet.findUnique({ where: { userId: did } }),
    prisma.stats.findUnique({ where: { userId: did } }),
    prisma.vipMembership.findUnique({ where: { userId: did } }),
    prisma.link.findMany({ where: { userId: did }, take: 1 }),
    prisma.purchase.findMany({
      where: { userId: did },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  ]);

  const counters = {
    purchasesTotal: recentPurchases.length,
    purchasesDelivered: recentPurchases.filter((row) => row.status === 'delivered')
      .length,
    purchasesPending: recentPurchases.filter(
      (row) => row.status === 'pending' || row.status === 'delivering',
    ).length,
    purchasesFailed: recentPurchases.filter((row) => row.status === 'delivery_failed')
      .length,
  };

  return {
    ok: true,
    data: {
      discordId: did,
      account,
      steamLink: links[0] || null,
      wallet,
      stats,
      vip,
      counters,
      recentPurchases,
    },
  };
}

module.exports = {
  normalizeDiscordId,
  normalizeSteamId,
  upsertPlayerAccount,
  bindPlayerSteamId,
  unbindPlayerSteamId,
  getPlayerAccount,
  listPlayerAccounts,
  getPlayerDashboard,
};
