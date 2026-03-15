const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const config = require('../src/config');
const {
  setLink,
  unlinkByUserId,
  flushLinkStoreWrites,
} = require('../src/store/linkStore');

const botPath = path.resolve(__dirname, '../src/bot.js');

function freshBotModule() {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousBotHealthPort = process.env.BOT_HEALTH_PORT;
  const previousDiscordGuildId = process.env.DISCORD_GUILD_ID;
  const previousDiscordClientId = process.env.DISCORD_CLIENT_ID;
  process.env.NODE_ENV = 'test';
  process.env.BOT_HEALTH_PORT = '0';
  process.env.DISCORD_GUILD_ID = '123456789012345678';
  process.env.DISCORD_CLIENT_ID = '123456789012345678';
  delete require.cache[botPath];
  const loaded = require(botPath);
  if (previousNodeEnv == null) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = previousNodeEnv;
  }
  if (previousBotHealthPort == null) {
    delete process.env.BOT_HEALTH_PORT;
  } else {
    process.env.BOT_HEALTH_PORT = previousBotHealthPort;
  }
  if (previousDiscordGuildId == null) {
    delete process.env.DISCORD_GUILD_ID;
  } else {
    process.env.DISCORD_GUILD_ID = previousDiscordGuildId;
  }
  if (previousDiscordClientId == null) {
    delete process.env.DISCORD_CLIENT_ID;
  } else {
    process.env.DISCORD_CLIENT_ID = previousDiscordClientId;
  }
  return loaded;
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

test('interaction e2e: disabled slash command is blocked by runtime config', async () => {
  process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || 'test-token';
  config.updateConfigPatch({
    commands: {
      disabled: ['mock-disabled'],
    },
  });
  const { handleInteractionCreate } = freshBotModule();
  const { interaction, calls } = createMockInteraction();

  try {
    interaction.isChatInputCommand = () => true;
    interaction.commandName = 'mock-disabled';
    interaction.client.commands.set('mock-disabled', {
      execute: async () => {
        throw new Error('should not execute when disabled');
      },
    });

    await handleInteractionCreate(interaction);

    assert.equal(calls.reply.length, 1);
    assert.match(String(calls.reply[0]?.content || ''), /ปิดใช้งานชั่วคราว/i);
  } finally {
    config.updateConfigPatch({
      commands: {
        disabled: [],
      },
    });
  }
});
