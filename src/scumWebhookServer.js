const crypto = require('node:crypto');
const http = require('node:http');
const {
  sendStatusOnline,
  sendPlayerJoinLeave,
  sendKillFeed,
  sendRestartAlert,
} = require('./services/scumEvents');

const WEBHOOK_MAX_BODY_BYTES = Math.max(
  2048,
  Number(process.env.SCUM_WEBHOOK_MAX_BODY_BYTES || 64 * 1024),
);
const WEBHOOK_REQUEST_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.SCUM_WEBHOOK_REQUEST_TIMEOUT_MS || 10_000),
);
const ALLOWED_TYPES = new Set(['status', 'join', 'leave', 'kill', 'restart']);

function secureEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let body = '';
    let done = false;

    req.on('data', (chunk) => {
      if (done) return;
      body += chunk;
      if (body.length > maxBytes) {
        done = true;
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });

    req.on('end', () => {
      if (done) return;
      done = true;
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON payload'));
      }
    });

    req.on('error', (error) => {
      if (done) return;
      done = true;
      reject(error);
    });
  });
}

function startScumServer(client) {
  const port = Number(process.env.SCUM_WEBHOOK_PORT || 3100);
  const secret = String(process.env.SCUM_WEBHOOK_SECRET || '').trim();

  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/scum-event') {
      res.writeHead(404);
      return res.end('Not found');
    }

    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    if (!contentType.includes('application/json')) {
      res.writeHead(415);
      return res.end('Unsupported Media Type');
    }

    req.setTimeout(WEBHOOK_REQUEST_TIMEOUT_MS, () => {
      res.writeHead(408);
      res.end('Request Timeout');
      req.destroy();
    });

    try {
      const data = await readJsonBody(req, WEBHOOK_MAX_BODY_BYTES);
      const eventType = String(data.type || '').trim().toLowerCase();
      if (!ALLOWED_TYPES.has(eventType)) {
        res.writeHead(400);
        return res.end('Invalid event type');
      }

      if (secret && !secureEqual(data.secret, secret)) {
        res.writeHead(403);
        return res.end('Forbidden');
      }

      const guildId = String(data.guildId || '').trim();
      if (!guildId) {
        res.writeHead(400);
        return res.end('Missing guildId');
      }

      const guild = client.guilds.cache.get(guildId);
      if (!guild) {
        res.writeHead(400);
        return res.end('Unknown guild');
      }

      if (eventType === 'status') {
        await sendStatusOnline(guild, {
          onlinePlayers: data.onlinePlayers,
          maxPlayers: data.maxPlayers,
          pingMs: data.pingMs,
          uptimeMinutes: data.uptimeMinutes,
        });
      } else if (eventType === 'join' || eventType === 'leave') {
        await sendPlayerJoinLeave(guild, {
          playerName: data.playerName,
          type: eventType,
        });
      } else if (eventType === 'kill') {
        await sendKillFeed(guild, {
          killer: data.killer,
          killerSteamId: data.killerSteamId,
          victim: data.victim,
          victimSteamId: data.victimSteamId,
          weapon: data.weapon,
          distance: data.distance,
          hitZone: data.hitZone,
        });
      } else if (eventType === 'restart') {
        await sendRestartAlert(guild, data.message || 'เซิร์ฟเวอร์กำลังรีสตาร์ท');
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true }));
    } catch (error) {
      const statusCode = error?.message === 'Payload too large'
        ? 413
        : error?.message === 'Invalid JSON payload'
          ? 400
          : 500;
      console.error('Error in SCUM webhook handler', error);
      res.writeHead(statusCode);
      return res.end(statusCode === 500 ? 'Internal error' : error.message);
    }
  });

  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(
        `SCUM webhook port ${port} is already in use. ` +
          `Change SCUM_WEBHOOK_PORT in .env (or stop the process using that port).`,
      );
      return;
    }
    console.error('SCUM webhook server error', err);
  });

  server.listen(port, () => {
    console.log(`SCUM webhook server listening on port ${port}`);
    if (!secret) {
      console.warn(
        '[scum-webhook] SCUM_WEBHOOK_SECRET is empty. Set a strong secret before production.',
      );
    }
  });

  return server;
}

module.exports = {
  startScumServer,
};
