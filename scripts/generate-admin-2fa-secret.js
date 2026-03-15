const crypto = require('node:crypto');

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

function getArgValue(flagName, fallback = '') {
  const index = process.argv.indexOf(flagName);
  if (index < 0) return fallback;
  return String(process.argv[index + 1] || '').trim() || fallback;
}

function main() {
  const issuer = getArgValue('--issuer', 'SCUM Admin Web');
  const account = getArgValue('--account', 'owner');
  const secret = makeBase32Secret(20);
  const uri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${encodeURIComponent(secret)}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30&algorithm=SHA1`;

  console.log('# Admin web TOTP secret');
  console.log(`ADMIN_WEB_2FA_SECRET=${secret}`);
  console.log('');
  console.log('# Scan this URI with your authenticator app');
  console.log(uri);
  console.log('');
  console.log('# Suggested env');
  console.log('ADMIN_WEB_2FA_ENABLED=true');
  console.log(`ADMIN_WEB_2FA_SECRET=${secret}`);
}

main();
