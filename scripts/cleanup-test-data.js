require('dotenv').config();

const fs = require('node:fs');
const { prisma } = require('../src/prisma');
const { getEvidenceFilePath } = require('../src/store/deliveryEvidenceStore');

const TEST_ITEM_PREFIXES = [
  'agent-test-',
  'agent-live-',
];
const TEST_ADMIN_USERNAMES = new Set([
  'admin_test',
  'admin_delivery_test',
  'admin_platform_test',
  'admin_trace_test',
  'platform_owner_test',
  'mod_user',
  'owner_user',
  'owner_live',
  'owner_ticket',
  'owner_control',
  'owner_stepup',
]);
const TEST_ADMIN_USERNAME_PATTERNS = [
  /^(admin|mod|owner)_[0-9]+$/,
];
const DEFAULT_USER_PREFIXES = [
  'admin-',
  'u-e2e',
];
const DEFAULT_USER_IDS = [];

function startsWithAny(value, prefixes) {
  const text = String(value || '');
  return prefixes.some((prefix) => text.startsWith(prefix));
}

function isTestAdminUsername(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  if (TEST_ADMIN_USERNAMES.has(text)) return true;
  return TEST_ADMIN_USERNAME_PATTERNS.some((pattern) => pattern.test(text));
}

async function collectTargets() {
  const [shopItems, purchases, adminWebUsers] = await Promise.all([
    prisma.shopItem.findMany(),
    prisma.purchase.findMany(),
    prisma
      .$queryRawUnsafe('SELECT username FROM admin_web_users')
      .catch(() => []),
  ]);

  const userPrefixes = process.argv
    .filter((arg) => String(arg).startsWith('--user-prefix='))
    .map((arg) => String(arg).split('=').slice(1).join('='))
    .filter(Boolean);
  const userIds = process.argv
    .filter((arg) => String(arg).startsWith('--user-id='))
    .map((arg) => String(arg).split('=').slice(1).join('='))
    .filter(Boolean);
  const effectiveUserPrefixes = userPrefixes.length > 0 ? userPrefixes : DEFAULT_USER_PREFIXES;
  const effectiveUserIds = userIds.length > 0 ? userIds : DEFAULT_USER_IDS;

  const targetItemIds = shopItems
    .map((row) => row.id)
    .filter((id) => startsWithAny(id, TEST_ITEM_PREFIXES));

  const targetPurchaseCodes = purchases
    .filter((row) =>
      startsWithAny(row.itemId, TEST_ITEM_PREFIXES)
      || startsWithAny(row.userId, effectiveUserPrefixes)
      || effectiveUserIds.includes(String(row.userId || ''))
    )
    .map((row) => row.code);

  const targetUserIds = [
    ...new Set(
      purchases
        .filter((row) => targetPurchaseCodes.includes(row.code))
        .map((row) => String(row.userId || '').trim())
        .filter(Boolean),
    ),
  ];
  const targetAdminUsernames = (Array.isArray(adminWebUsers) ? adminWebUsers : [])
    .map((row) => String(row?.username || '').trim())
    .filter((username) => isTestAdminUsername(username));

  return {
    userPrefixes: effectiveUserPrefixes,
    userIds: effectiveUserIds,
    targetItemIds,
    targetPurchaseCodes,
    targetUserIds,
    targetAdminUsernames,
  };
}

async function main() {
  const write = process.argv.includes('--write');
  const targets = await collectTargets();

  const summary = {
    itemPrefixes: TEST_ITEM_PREFIXES,
    userPrefixes: targets.userPrefixes,
    userIds: targets.userIds,
    itemCount: targets.targetItemIds.length,
    purchaseCount: targets.targetPurchaseCodes.length,
    userCount: targets.targetUserIds.length,
    adminUserCount: targets.targetAdminUsernames.length,
    itemIds: targets.targetItemIds,
    purchaseCodes: targets.targetPurchaseCodes,
    userIdsMatched: targets.targetUserIds,
    adminUsernames: targets.targetAdminUsernames,
    write,
  };

  if (!write) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  await prisma.$transaction(async (tx) => {
    if (targets.targetPurchaseCodes.length > 0) {
      await tx.deliveryQueueJob.deleteMany({
        where: { purchaseCode: { in: targets.targetPurchaseCodes } },
      });
      await tx.deliveryDeadLetter.deleteMany({
        where: { purchaseCode: { in: targets.targetPurchaseCodes } },
      });
      await tx.deliveryAudit.deleteMany({
        where: { purchaseCode: { in: targets.targetPurchaseCodes } },
      });
      await tx.purchase.deleteMany({
        where: { code: { in: targets.targetPurchaseCodes } },
      });
      for (const purchaseCode of targets.targetPurchaseCodes) {
        const evidencePath = getEvidenceFilePath(purchaseCode);
        if (evidencePath && fs.existsSync(evidencePath)) {
          fs.unlinkSync(evidencePath);
        }
      }
    }

    if (targets.targetItemIds.length > 0) {
      await tx.shopItem.deleteMany({
        where: { id: { in: targets.targetItemIds } },
      });
    }

    if (targets.targetUserIds.length > 0) {
      await tx.walletLedger.deleteMany({
        where: { userId: { in: targets.targetUserIds } },
      }).catch(() => null);
      await tx.userWallet.deleteMany({
        where: { userId: { in: targets.targetUserIds } },
      }).catch(() => null);
      await tx.vipMembership.deleteMany({
        where: { userId: { in: targets.targetUserIds } },
      }).catch(() => null);
      await tx.link.deleteMany({
        where: { userId: { in: targets.targetUserIds } },
      }).catch(() => null);
      await tx.playerAccount.deleteMany({
        where: { discordId: { in: targets.targetUserIds } },
      }).catch(() => null);
    }

    for (const username of targets.targetAdminUsernames) {
      await tx.$executeRaw`
        DELETE FROM admin_web_users
        WHERE username = ${username}
      `;
    }
  });

  console.log(
    JSON.stringify(
      {
        ...summary,
        cleaned: true,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
