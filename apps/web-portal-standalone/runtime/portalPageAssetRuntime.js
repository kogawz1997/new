'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');

function getIconContentType(ext) {
  const normalized = String(ext || '').toLowerCase();
  if (normalized === '.png') return 'image/png';
  if (normalized === '.jpg' || normalized === '.jpeg') return 'image/jpeg';
  return 'image/webp';
}

function getPortalAssetContentType(ext) {
  const normalized = String(ext || '').toLowerCase();
  if (normalized === '.css') return 'text/css; charset=utf-8';
  if (normalized === '.js') return 'application/javascript; charset=utf-8';
  return 'application/octet-stream';
}

function createPortalPageAssetRuntime(options = {}) {
  const {
    isProduction,
    loginHtmlPath,
    playerHtmlPath,
    legacyPlayerHtmlPath,
    landingHtmlPath,
    trialHtmlPath,
    showcaseHtmlPath,
    publicAssetsDirPath,
    docsDirPath,
    scumItemsDirPath,
    faviconSvg,
    sendJson,
    sendHtml,
    buildSecurityHeaders,
    escapeHtml,
  } = options;
  const resolvedLegacyPlayerHtmlPath = legacyPlayerHtmlPath || playerHtmlPath;
  const resolvedPublicAssetsDirPath = publicAssetsDirPath || path.join(path.dirname(playerHtmlPath), 'assets');

  let cachedLoginHtml = null;
  let cachedPlayerHtml = null;
  let cachedLegacyPlayerHtml = null;
  let cachedLandingHtml = null;
  let cachedTrialHtml = null;
  let cachedShowcaseHtml = null;
  let cachedLoginHtmlMtimeMs = 0;
  let cachedPlayerHtmlMtimeMs = 0;
  let cachedLegacyPlayerHtmlMtimeMs = 0;
  let cachedLandingHtmlMtimeMs = 0;
  let cachedTrialHtmlMtimeMs = 0;
  let cachedShowcaseHtmlMtimeMs = 0;

  function getFileMtimeMs(filePath) {
    try {
      const stat = fs.statSync(filePath);
      return Number(stat.mtimeMs || 0);
    } catch {
      return 0;
    }
  }

  function loadHtmlTemplate(filePath) {
    return fs.readFileSync(filePath, 'utf8');
  }

  function sendFavicon(res) {
    res.writeHead(
      200,
      buildSecurityHeaders({
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=86400',
      }),
    );
    res.end(faviconSvg);
  }

  async function tryServeStaticScumIcon(req, res, pathname) {
    if (String(req.method || '').toUpperCase() !== 'GET') return false;
    const prefixes = ['/assets/scum-items/', '/player/assets/scum-items/'];
    const matchedPrefix = prefixes.find((prefix) => String(pathname || '').startsWith(prefix));
    if (!matchedPrefix) return false;

    let relativeName = '';
    try {
      relativeName = decodeURIComponent(String(pathname || '').slice(matchedPrefix.length));
    } catch {
      return false;
    }
    if (!relativeName || relativeName.includes('/') || relativeName.includes('\\')) {
      return false;
    }
    if (relativeName.includes('..')) {
      return false;
    }

    const ext = path.extname(relativeName).toLowerCase();
    if (!new Set(['.webp', '.png', '.jpg', '.jpeg']).has(ext)) {
      return false;
    }

    const absPath = path.resolve(scumItemsDirPath, relativeName);
    if (!absPath.startsWith(scumItemsDirPath)) {
      return false;
    }

    try {
      const stat = await fs.promises.stat(absPath);
      if (!stat.isFile()) {
        sendJson(res, 404, { ok: false, error: 'Not found' });
        return true;
      }
      res.writeHead(
        200,
        buildSecurityHeaders({
          'Content-Type': getIconContentType(ext),
          'Cache-Control': 'public, max-age=86400',
        }),
      );
      await pipeline(fs.createReadStream(absPath), res);
      return true;
    } catch {
      sendJson(res, 404, { ok: false, error: 'Not found' });
      return true;
    }
  }

  async function tryServePortalStaticAsset(req, res, pathname) {
    if (String(req.method || '').toUpperCase() !== 'GET') return false;
    const prefix = '/player/assets/ui/';
    if (!String(pathname || '').startsWith(prefix)) return false;

    let relativeName = '';
    try {
      relativeName = decodeURIComponent(String(pathname || '').slice(prefix.length));
    } catch {
      return false;
    }
    if (!relativeName || relativeName.includes('..')) {
      sendJson(res, 404, { ok: false, error: 'Not found' });
      return true;
    }

    const ext = path.extname(relativeName).toLowerCase();
    if (ext !== '.css' && ext !== '.js') {
      sendJson(res, 404, { ok: false, error: 'Not found' });
      return true;
    }

    const absPath = path.resolve(resolvedPublicAssetsDirPath, relativeName);
    if (!absPath.startsWith(resolvedPublicAssetsDirPath)) {
      sendJson(res, 404, { ok: false, error: 'Not found' });
      return true;
    }

    try {
      const stat = await fs.promises.stat(absPath);
      if (!stat.isFile()) {
        sendJson(res, 404, { ok: false, error: 'Not found' });
        return true;
      }
      res.writeHead(
        200,
        buildSecurityHeaders({
          'Content-Type': getPortalAssetContentType(ext),
          'Cache-Control': 'public, max-age=300',
        }),
      );
      await pipeline(fs.createReadStream(absPath), res);
      return true;
    } catch {
      sendJson(res, 404, { ok: false, error: 'Not found' });
      return true;
    }
  }

  function getPlayerHtml() {
    const mtimeMs = getFileMtimeMs(playerHtmlPath);
    if (!cachedPlayerHtml || !isProduction || mtimeMs > cachedPlayerHtmlMtimeMs) {
      cachedPlayerHtml = loadHtmlTemplate(playerHtmlPath);
      cachedPlayerHtmlMtimeMs = mtimeMs;
    }
    return cachedPlayerHtml;
  }

  function getLegacyPlayerHtml() {
    const mtimeMs = getFileMtimeMs(resolvedLegacyPlayerHtmlPath);
    if (!cachedLegacyPlayerHtml || !isProduction || mtimeMs > cachedLegacyPlayerHtmlMtimeMs) {
      cachedLegacyPlayerHtml = loadHtmlTemplate(resolvedLegacyPlayerHtmlPath);
      cachedLegacyPlayerHtmlMtimeMs = mtimeMs;
    }
    return cachedLegacyPlayerHtml;
  }

  function getLandingHtml() {
    const mtimeMs = getFileMtimeMs(landingHtmlPath);
    if (!cachedLandingHtml || !isProduction || mtimeMs > cachedLandingHtmlMtimeMs) {
      cachedLandingHtml = loadHtmlTemplate(landingHtmlPath);
      cachedLandingHtmlMtimeMs = mtimeMs;
    }
    return cachedLandingHtml;
  }

  function getTrialHtml() {
    const mtimeMs = getFileMtimeMs(trialHtmlPath);
    if (!cachedTrialHtml || !isProduction || mtimeMs > cachedTrialHtmlMtimeMs) {
      cachedTrialHtml = loadHtmlTemplate(trialHtmlPath);
      cachedTrialHtmlMtimeMs = mtimeMs;
    }
    return cachedTrialHtml;
  }

  function getShowcaseHtml() {
    const mtimeMs = getFileMtimeMs(showcaseHtmlPath);
    if (!cachedShowcaseHtml || !isProduction || mtimeMs > cachedShowcaseHtmlMtimeMs) {
      cachedShowcaseHtml = loadHtmlTemplate(showcaseHtmlPath);
      cachedShowcaseHtmlMtimeMs = mtimeMs;
    }
    return cachedShowcaseHtml;
  }

  function renderMarkdownDocument(title, markdown) {
    return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body{margin:0;background:linear-gradient(155deg,#071018,#0c151e 48%,#142231);color:#edf3fb;font-family:ui-sans-serif,system-ui,sans-serif}
    .shell{width:min(980px,calc(100% - 24px));margin:0 auto;padding:22px 0 42px}
    .card{background:rgba(17,28,38,.94);border:1px solid rgba(171,194,219,.16);border-radius:24px;padding:22px;box-shadow:0 24px 72px rgba(0,0,0,.34)}
    a{color:#94d0ff}
    h1{margin:0 0 16px;font-size:32px}
    p{color:#a6b8cb}
    pre{white-space:pre-wrap;line-height:1.7;font-size:14px;color:#d8e3ef}
  </style>
</head>
<body>
  <div class="shell">
    <div class="card">
      <p><a href="/landing">กลับหน้า Landing</a></p>
      <h1>${escapeHtml(title)}</h1>
      <pre>${escapeHtml(markdown)}</pre>
    </div>
  </div>
</body>
</html>`;
  }

  function tryServePublicDoc(pathname, res) {
    if (!String(pathname || '').startsWith('/docs/')) return false;
    const relative = String(pathname || '').slice('/docs/'.length);
    if (!relative || !relative.toLowerCase().endsWith('.md')) return false;
    const absolute = path.resolve(docsDirPath, relative);
    if (!absolute.startsWith(docsDirPath)) return false;
    if (!fs.existsSync(absolute)) return false;
    const markdown = fs.readFileSync(absolute, 'utf8');
    sendHtml(res, 200, renderMarkdownDocument(path.basename(relative), markdown));
    return true;
  }

  function renderLoginPage(message) {
    const mtimeMs = getFileMtimeMs(loginHtmlPath);
    if (!cachedLoginHtml || !isProduction || mtimeMs > cachedLoginHtmlMtimeMs) {
      cachedLoginHtml = loadHtmlTemplate(loginHtmlPath);
      cachedLoginHtmlMtimeMs = mtimeMs;
    }
    const safe = escapeHtml(String(message || ''));
    return cachedLoginHtml.replace('__ERROR_MESSAGE__', safe);
  }

  return {
    sendFavicon,
    tryServePortalStaticAsset,
    tryServeStaticScumIcon,
    getPlayerHtml,
    getLegacyPlayerHtml,
    getLandingHtml,
    getTrialHtml,
    getShowcaseHtml,
    tryServePublicDoc,
    renderLoginPage,
  };
}

module.exports = {
  createPortalPageAssetRuntime,
};
