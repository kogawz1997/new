require('dotenv').config();

const { prisma } = require('../src/prisma');
const { getVipPlan } = require('../src/services/vipService');
const {
  getMembership,
  setMembership,
  removeMembership,
  flushVipStoreWrites,
} = require('../src/store/vipStore');
const { setPurchaseStatusByCode } = require('../src/store/memoryStore');

function nowIso() {
  return new Date().toISOString();
}

async function collectStuckVipPurchases() {
  const [purchases, queueJobs, deadLetters, shopItems] = await Promise.all([
    prisma.purchase.findMany({
      where: {
        status: {
          in: ['pending', 'delivering'],
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    }),
    prisma.deliveryQueueJob.findMany({
      select: {
        purchaseCode: true,
      },
    }),
    prisma.deliveryDeadLetter.findMany({
      select: {
        purchaseCode: true,
      },
    }),
    prisma.shopItem.findMany({
      select: {
        id: true,
        kind: true,
      },
    }),
  ]);

  const queuedCodes = new Set(queueJobs.map((row) => String(row.purchaseCode || '')));
  const deadLetterCodes = new Set(deadLetters.map((row) => String(row.purchaseCode || '')));
  const vipItemIds = new Set(
    shopItems
      .filter((row) => String(row.kind || '').trim().toLowerCase() === 'vip')
      .map((row) => String(row.id || '').trim())
      .filter(Boolean),
  );

  return purchases.filter((purchase) => {
    const code = String(purchase.code || '').trim();
    if (!code) return false;
    if (!vipItemIds.has(String(purchase.itemId || '').trim())) return false;
    if (queuedCodes.has(code) || deadLetterCodes.has(code)) return false;
    return true;
  });
}

async function repairPurchase(purchase) {
  const userId = String(purchase.userId || '').trim();
  const itemId = String(purchase.itemId || '').trim();
  const code = String(purchase.code || '').trim();
  const plan = getVipPlan(itemId);
  if (!userId || !itemId || !code || !plan) {
    return {
      code,
      userId,
      itemId,
      ok: false,
      reason: 'vip-plan-not-found',
    };
  }

  const previousMembership = getMembership(userId);
  const now = new Date();
  const membershipBaseAt =
    previousMembership?.expiresAt instanceof Date
    && previousMembership.expiresAt.getTime() > now.getTime()
      ? previousMembership.expiresAt
      : now;
  const expiresAt = new Date(
    membershipBaseAt.getTime() + Number(plan.durationDays || 0) * 24 * 60 * 60 * 1000,
  );
  const nextMembership = setMembership(userId, plan.id, expiresAt);
  if (!nextMembership) {
    return {
      code,
      userId,
      itemId,
      ok: false,
      reason: 'vip-membership-write-failed',
    };
  }

  try {
    const updatedPurchase = await setPurchaseStatusByCode(code, 'delivered', {
      actor: 'repair-vip-purchases',
      reason: 'vip-activation-repair',
      meta: {
        repairedAt: nowIso(),
        planId: plan.id,
        durationDays: Number(plan.durationDays || 0),
      },
    });
    return {
      code,
      userId,
      itemId,
      ok: true,
      status: updatedPurchase?.status || 'delivered',
      expiresAt: nextMembership.expiresAt instanceof Date
        ? nextMembership.expiresAt.toISOString()
        : null,
    };
  } catch (error) {
    if (previousMembership?.expiresAt instanceof Date) {
      setMembership(userId, previousMembership.planId, previousMembership.expiresAt);
    } else {
      removeMembership(userId);
    }
    return {
      code,
      userId,
      itemId,
      ok: false,
      reason: String(error?.message || error),
    };
  }
}

async function main() {
  const write = process.argv.includes('--write');
  const stuckPurchases = await collectStuckVipPurchases();
  if (!write) {
    console.log(JSON.stringify({
      write,
      count: stuckPurchases.length,
      items: stuckPurchases.map((row) => ({
        code: row.code,
        userId: row.userId,
        itemId: row.itemId,
        status: row.status,
        createdAt: row.createdAt,
      })),
    }, null, 2));
    await prisma.$disconnect();
    return;
  }

  const results = [];
  for (const purchase of stuckPurchases) {
    results.push(await repairPurchase(purchase));
  }

  await flushVipStoreWrites();
  await prisma.$disconnect();

  console.log(JSON.stringify({
    write,
    total: results.length,
    repaired: results.filter((row) => row.ok).length,
    failed: results.filter((row) => !row.ok).length,
    results,
  }, null, 2));
}

main().catch(async (error) => {
  console.error(error);
  try {
    await prisma.$disconnect();
  } catch {}
  process.exit(1);
});
