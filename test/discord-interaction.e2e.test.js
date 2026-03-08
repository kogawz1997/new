const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  setLink,
  unlinkByUserId,
  flushLinkStoreWrites,
} = require('../src/store/linkStore');

const botPath = path.resolve(__dirname, '../src/bot.js');

function freshBotModule() {
  delete require.cache[botPath];
  return require(botPath);
}

function randomSteamId() {
  const suffix = String(Math.floor(Math.random() * 1e10)).padStart(10, '0');
  return `7656119${suffix}`;
}

function createMockInteraction() {
  const calls = {
    reply: [],
    followUp: [],
    editReply: [],
    deferReply: [],
    showModal: [],
  };

  const interaction = {
    replied: false,
    deferred: false,
    customId: '',
    commandName: '',
    guildId: null,
    user: {
      id: 'u-e2e',
      username: 'tester',
      tag: 'tester#0001',
    },
    member: null,
    guild: null,
    client: {
      commands: new Map(),
    },
    fields: {
      getTextInputValue: () => '',
    },
    isRepliable: () => true,
    isModalSubmit: () => false,
    isButton: () => false,
    isChatInputCommand: () => false,
    reply: async (payload) => {
      calls.reply.push(payload);
      interaction.replied = true;
      return payload;
    },
    followUp: async (payload) => {
      calls.followUp.push(payload);
      return payload;
    },
    editReply: async (payload) => {
      calls.editReply.push(payload);
      return payload;
    },
    deferReply: async (payload) => {
      calls.deferReply.push(payload);
      interaction.deferred = true;
      return payload;
    },
    showModal: async (payload) => {
      calls.showModal.push(payload);
      return payload;
    },
  };

  return { interaction, calls };
}

test('interaction e2e: button verify-open shows modal with expected customId', async () => {
  process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || 'test-token';
  const { handleInteractionCreate } = freshBotModule();
  const { interaction, calls } = createMockInteraction();

  interaction.isButton = () => true;
  interaction.customId = 'panel-verify-open';

  await handleInteractionCreate(interaction);

  assert.equal(calls.showModal.length, 1);
  const modal = calls.showModal[0];
  assert.equal(typeof modal?.toJSON, 'function');
  const json = modal.toJSON();
  assert.equal(json.custom_id, 'panel-verify-modal');
});

test('interaction e2e: modal verify rejects invalid steam id', async () => {
  process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || 'test-token';
  const { handleInteractionCreate } = freshBotModule();
  const { interaction, calls } = createMockInteraction();

  interaction.isModalSubmit = () => true;
  interaction.customId = 'panel-verify-modal';
  interaction.fields.getTextInputValue = () => 'invalid-steam-id';

  await handleInteractionCreate(interaction);

  assert.equal(calls.reply.length, 1);
  assert.match(String(calls.reply[0]?.content || ''), /SteamID.+ไม่ถูกต้อง/i);
});

test('interaction e2e: modal verify rejects steam relink for already linked user', async () => {
  process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || 'test-token';
  const { handleInteractionCreate } = freshBotModule();
  const { interaction, calls } = createMockInteraction();
  const userId = 'u-e2e-lock';
  const firstSteamId = randomSteamId();
  const nextSteamId = randomSteamId();

  try {
    unlinkByUserId(userId);
    await flushLinkStoreWrites();

    setLink({
      steamId: firstSteamId,
      userId,
      inGameName: null,
    });
    await flushLinkStoreWrites();

    interaction.user.id = userId;
    interaction.isModalSubmit = () => true;
    interaction.customId = 'panel-verify-modal';
    interaction.fields.getTextInputValue = () => nextSteamId;

    await handleInteractionCreate(interaction);

    assert.equal(calls.reply.length, 1);
    assert.match(String(calls.reply[0]?.content || ''), /ติดต่อแอดมิน/i);
  } finally {
    unlinkByUserId(userId);
    await flushLinkStoreWrites();
  }
});

test('interaction e2e: slash command dispatch executes command and replies', async () => {
  process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || 'test-token';
  const { handleInteractionCreate } = freshBotModule();
  const { interaction, calls } = createMockInteraction();

  let executed = false;
  interaction.isChatInputCommand = () => true;
  interaction.commandName = 'mock-e2e';
  interaction.client.commands.set('mock-e2e', {
    execute: async (ctx) => {
      executed = true;
      await ctx.reply({ content: 'slash-ok' });
    },
  });

  await handleInteractionCreate(interaction);

  assert.equal(executed, true);
  assert.equal(calls.reply.length, 1);
  assert.equal(calls.reply[0]?.content, 'slash-ok');
});
