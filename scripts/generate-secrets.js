const crypto = require('node:crypto');

function makeSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function makeBase32Secret(bytes = 20) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const raw = crypto.randomBytes(bytes);
  let bits = '';
  for (const byte of raw) {
    bits += byte.toString(2).padStart(8, '0');
  }
  let out = '';
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0');
    out += alphabet[Number.parseInt(chunk, 2)];
  }
  return out;
}

function main() {
  const values = {
    SCUM_WEBHOOK_SECRET: makeSecret(32),
    ADMIN_WEB_PASSWORD: makeSecret(24),
    ADMIN_WEB_TOKEN: makeSecret(32),
    ADMIN_WEB_2FA_SECRET: makeBase32Secret(20),
    SCUM_CONSOLE_AGENT_TOKEN: makeSecret(24),
    RCON_PASSWORD: makeSecret(24),
  };

  console.log('# Copy to .env (rotate old values immediately)');
  for (const [key, value] of Object.entries(values)) {
    console.log(`${key}=${value}`);
  }
}

main();
