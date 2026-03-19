const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildTopKillerEmbed,
} = require('../src/services/leaderboardPanels');
const {
  replaceStats,
  flushStatsStoreWrites,
} = require('../src/store/statsStore');
const {
  replaceLinks,
  flushLinkStoreWrites,
} = require('../src/store/linkStore');

function createFakeMember(displayName, tag, avatarUrl) {
  const user = {
    username: tag.split('#')[0],
    tag,
    displayAvatarURL: () => avatarUrl,
  };
  return {
    displayName,
    user,
    displayAvatarURL: () => avatarUrl,
  };
}

test('top killer leaderboard cards use linked in-game name and discord avatar', async (t) => {
  const nowSeed = Date.now();
  const userId = `leaderboard-card-${nowSeed}`;
  const secondUserId = `leaderboard-card-${nowSeed + 1}`;
  const thirdUserId = `leaderboard-card-${nowSeed + 2}`;
  const fourthUserId = `leaderboard-card-${nowSeed + 3}`;

  replaceStats([
    { userId, kills: 120, deaths: 40, playtimeMinutes: 600 },
    { userId: secondUserId, kills: 90, deaths: 45, playtimeMinutes: 500 },
    { userId: thirdUserId, kills: 80, deaths: 50, playtimeMinutes: 400 },
    { userId: fourthUserId, kills: 70, deaths: 60, playtimeMinutes: 300 },
  ]);
  replaceLinks([
    {
      steamId: '76561198000000001',
      userId,
      inGameName: 'APEX',
    },
  ]);
  await Promise.all([
    flushStatsStoreWrites(),
    flushLinkStoreWrites(),
  ]);

  t.after(async () => {
    replaceStats([]);
    replaceLinks([]);
    await Promise.all([
      flushStatsStoreWrites(),
      flushLinkStoreWrites(),
    ]);
  });

  const firstMember = createFakeMember(
    'Discord Apex',
    'discord-apex#0001',
    'https://cdn.example.com/apex.png',
  );
  const secondMember = createFakeMember(
    'Discord Two',
    'discord-two#0001',
    'https://cdn.example.com/two.png',
  );
  const thirdMember = createFakeMember(
    'Discord Three',
    'discord-three#0001',
    'https://cdn.example.com/three.png',
  );
  const fourthMember = createFakeMember(
    'Discord Four',
    'discord-four#0001',
    'https://cdn.example.com/four.png',
  );
  const guild = {
    members: {
      cache: new Map([
        [userId, firstMember],
        [secondUserId, secondMember],
        [thirdUserId, thirdMember],
        [fourthUserId, fourthMember],
      ]),
    },
  };
  const client = {
    guilds: {
      cache: new Map([['guild-1', guild]]),
    },
    users: {
      cache: new Map([
        [userId, firstMember.user],
        [secondUserId, secondMember.user],
        [thirdUserId, thirdMember.user],
        [fourthUserId, fourthMember.user],
      ]),
    },
  };

  const embeds = buildTopKillerEmbed(client, 'guild-1');

  assert.ok(Array.isArray(embeds));
  assert.equal(embeds.length >= 2, true);

  const firstEmbed = embeds[0].toJSON();
  assert.equal(String(firstEmbed.thumbnail?.url || ''), 'https://cdn.example.com/apex.png');
  assert.match(String(firstEmbed.description || ''), /APEX/);
  assert.match(String(firstEmbed.description || ''), new RegExp(`<@${userId}>`));
  assert.equal(String(firstEmbed.author?.name || ''), '🥇 Rank 1');

  const summaryEmbed = embeds[embeds.length - 1].toJSON();
  assert.match(String(summaryEmbed.title || ''), /More/i);
  assert.match(String(summaryEmbed.description || ''), /Discord Four/);
});
