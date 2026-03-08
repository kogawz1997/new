const test = require('node:test');
const assert = require('node:assert/strict');

const { getWallet } = require('../src/store/memoryStore');
const { setCode, deleteCode } = require('../src/store/redeemStore');
const {
  redeemCodeForUser,
  createBountyForUser,
  cancelBountyForUser,
  listActiveBountiesForUser,
  requestRentBikeForUser,
} = require('../src/services/playerOpsService');

function randomDigits(length) {
  let out = '';
  while (out.length < length) {
    out += String(Math.floor(Math.random() * 10));
  }
  return out.slice(0, length);
}

test('playerOps service: redeem + bounty + rentbike input guard', async () => {
  const userId = randomDigits(18);
  const code = `T${Date.now()}${Math.floor(Math.random() * 1000)}`.toUpperCase();

  try {
    const seed = setCode(code, {
      type: 'coins',
      amount: 321,
    });
    assert.equal(seed.ok, true);

    const beforeWallet = await getWallet(userId);
    const redeemed = await redeemCodeForUser({
      userId,
      code,
      actor: `test:${userId}`,
      source: 'player-ops-test',
    });
    assert.equal(redeemed.ok, true);
    assert.equal(redeemed.type, 'coins');
    assert.equal(redeemed.amount, 321);

    const afterWallet = await getWallet(userId);
    assert.equal(afterWallet.balance, beforeWallet.balance + 321);

    const redeemedAgain = await redeemCodeForUser({
      userId,
      code,
      actor: `test:${userId}`,
      source: 'player-ops-test',
    });
    assert.equal(redeemedAgain.ok, false);
    assert.equal(redeemedAgain.reason, 'code-already-used');

    const bountyCreated = createBountyForUser({
      createdBy: userId,
      targetName: 'TargetPlayer',
      amount: 777,
    });
    assert.equal(bountyCreated.ok, true);
    assert.ok(bountyCreated.bounty?.id);

    const activeRows = listActiveBountiesForUser();
    assert.ok(
      activeRows.some((row) => Number(row.id) === Number(bountyCreated.bounty.id)),
    );

    const bountyCancelled = cancelBountyForUser({
      id: bountyCreated.bounty.id,
      requesterId: userId,
      isStaff: false,
    });
    assert.equal(bountyCancelled.ok, true);
    assert.equal(String(bountyCancelled.bounty.status), 'cancelled');

    const invalidRent = await requestRentBikeForUser({
      discordUserId: '',
    });
    assert.equal(invalidRent.ok, false);
    assert.equal(invalidRent.reason, 'invalid-user-id');
  } finally {
    deleteCode(code);
  }
});
