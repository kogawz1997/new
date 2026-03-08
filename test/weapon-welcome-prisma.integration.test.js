const test = require('node:test');
const assert = require('node:assert/strict');

const {
  recordWeaponKill,
  flushWeaponStatsStoreWrites,
} = require('../src/store/weaponStatsStore');
const {
  claim,
  revokeClaim,
  flushWelcomePackStoreWrites,
} = require('../src/store/welcomePackStore');
const { prisma } = require('../src/prisma');

function uniqueText(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

test('weaponStats and welcomePack stores write through to prisma', async () => {
  const weapon = uniqueText('weapon');
  const userId = uniqueText('welcome-user');

  try {
    recordWeaponKill({
      weapon,
      distance: 87,
      killer: 'killer-a',
    });
    recordWeaponKill({
      weapon,
      distance: 120,
      killer: 'killer-b',
    });
    await flushWeaponStatsStoreWrites();

    let row = await prisma.weaponStat.findUnique({ where: { weapon } });
    assert.ok(row);
    assert.equal(row.kills, 2);
    assert.equal(Number(row.longestDistance), 120);
    assert.equal(row.recordHolder, 'killer-b');

    const firstClaim = claim(userId);
    const secondClaim = claim(userId);
    assert.equal(firstClaim, true);
    assert.equal(secondClaim, false);
    await flushWelcomePackStoreWrites();

    let claimRow = await prisma.welcomeClaim.findUnique({
      where: { userId },
    });
    assert.ok(claimRow);

    const revoked = revokeClaim(userId);
    assert.equal(revoked, true);
    await flushWelcomePackStoreWrites();

    claimRow = await prisma.welcomeClaim.findUnique({
      where: { userId },
    });
    assert.equal(claimRow, null);
  } finally {
    await prisma.weaponStat.deleteMany({ where: { weapon } });
    await prisma.welcomeClaim.deleteMany({ where: { userId } });
  }
});
