const test = require('node:test');
const assert = require('node:assert/strict');

const {
  setLink,
  unlinkByUserId,
  flushLinkStoreWrites,
} = require('../src/store/linkStore');
const {
  getPlayerAccount,
  getPlayerDashboard,
  upsertPlayerAccount,
} = require('../src/store/playerAccountStore');
const { prisma } = require('../src/prisma');

function randomDigits(length) {
  let out = '';
  while (out.length < length) {
    out += String(Math.floor(Math.random() * 10));
  }
  return out.slice(0, length);
}

test('link store syncs steam binding into player account and dashboard', async () => {
  const discordId = randomDigits(18);
  const steamId = randomDigits(17);
  try {
    const upserted = await upsertPlayerAccount({
      discordId,
      username: 'tester',
      displayName: 'Tester',
      isActive: true,
    });
    assert.equal(upserted.ok, true);

    const linked = setLink({
      steamId,
      userId: discordId,
      inGameName: 'TesterInGame',
    });
    assert.equal(linked.ok, true);
    await flushLinkStoreWrites();

    const account = await getPlayerAccount(discordId);
    assert.ok(account);
    assert.equal(account.steamId, steamId);

    const dashboard = await getPlayerDashboard(discordId);
    assert.equal(dashboard.ok, true);
    assert.equal(String(dashboard.data?.steamLink?.steamId || ''), steamId);

    unlinkByUserId(discordId);
    await flushLinkStoreWrites();
    const accountAfterUnlink = await getPlayerAccount(discordId);
    assert.ok(accountAfterUnlink);
    assert.equal(accountAfterUnlink.steamId, null);
  } finally {
    await prisma.link.deleteMany({ where: { userId: discordId } });
    await prisma.playerAccount.deleteMany({ where: { discordId } });
  }
});
