const http = require('http');
const { sendStatusOnline, sendPlayerJoinLeave, sendKillFeed, sendRestartAlert } = require('./services/scumEvents');

// เซิร์ฟเวอร์เล็ก ๆ สำหรับรับ webhook จาก SCUM (หรือสคริปต์ภายนอก)
// ส่ง JSON มาที่ POST /scum-event พร้อม body:
// { type: 'status'|'join'|'leave'|'kill'|'restart', ... }

function startScumServer(client) {
  const port = Number(process.env.SCUM_WEBHOOK_PORT || 3100);
  const secret = process.env.SCUM_WEBHOOK_SECRET || null;

  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/scum-event') {
      res.writeHead(404);
      return res.end('Not found');
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });

    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');

        if (secret && data.secret !== secret) {
          res.writeHead(403);
          return res.end('Forbidden');
        }

        const guildId = data.guildId;
        const guild = client.guilds.cache.get(guildId);

        if (!guild) {
          res.writeHead(400);
          return res.end('Unknown guild');
        }

        if (data.type === 'status') {
          await sendStatusOnline(guild, {
            onlinePlayers: data.onlinePlayers,
            maxPlayers: data.maxPlayers,
            pingMs: data.pingMs,
            uptimeMinutes: data.uptimeMinutes,
          });
        } else if (data.type === 'join' || data.type === 'leave') {
          await sendPlayerJoinLeave(guild, {
            playerName: data.playerName,
            type: data.type,
          });
        } else if (data.type === 'kill') {
          await sendKillFeed(guild, {
            killer: data.killer,
            killerSteamId: data.killerSteamId,
            victim: data.victim,
            victimSteamId: data.victimSteamId,
            weapon: data.weapon,
            distance: data.distance,
            hitZone: data.hitZone,
          });
        } else if (data.type === 'restart') {
          await sendRestartAlert(guild, data.message || 'เซิร์ฟเวอร์กำลังรีสตาร์ท');
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        console.error('Error in SCUM webhook handler', err);
        res.writeHead(500);
        res.end('Internal error');
      }
    });
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
  });

  return server;
}

module.exports = {
  startScumServer,
};
