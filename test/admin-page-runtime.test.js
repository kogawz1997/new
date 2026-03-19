const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Writable } = require('node:stream');

const {
  createAdminPageRuntime,
} = require('../src/admin/runtime/adminPageRuntime');

function createResponse() {
  const chunks = [];
  const res = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  res.statusCode = 200;
  res.headers = {};
  res.body = '';
  res.writeHead = (statusCode, headers) => {
    res.statusCode = statusCode;
    res.headers = headers;
  };
  const originalEnd = res.end.bind(res);
  res.end = (chunk, encoding, callback) => {
    if (chunk) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), encoding || 'utf8'));
    }
    res.body = Buffer.concat(chunks).toString('utf8');
    return originalEnd(callback);
  };
  return res;
}

test('admin page runtime loads templates and serves dashboard assets', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-page-runtime-'));
  const assetsDir = path.join(root, 'assets');
  const scumItemsDir = path.join(root, 'scum-items');
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.mkdirSync(scumItemsDir, { recursive: true });
  fs.writeFileSync(path.join(root, 'dashboard.html'), '<h1>dashboard</h1>');
  fs.writeFileSync(path.join(root, 'owner-console.html'), '<h1>owner</h1>');
  fs.writeFileSync(path.join(root, 'tenant-console.html'), '<h1>tenant</h1>');
  fs.writeFileSync(path.join(root, 'login.html'), '<h1>login</h1>');
  fs.writeFileSync(path.join(assetsDir, 'dashboard.css'), 'body{color:red}');

  const runtime = createAdminPageRuntime({
    dashboardHtmlPath: path.join(root, 'dashboard.html'),
    ownerConsoleHtmlPath: path.join(root, 'owner-console.html'),
    tenantConsoleHtmlPath: path.join(root, 'tenant-console.html'),
    loginHtmlPath: path.join(root, 'login.html'),
    assetsDirPath: assetsDir,
    scumItemsDirPath: scumItemsDir,
    buildSecurityHeaders: (headers) => headers,
    sendText(res, statusCode, text) {
      res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(text);
    },
  });

  assert.equal(runtime.getDashboardHtml(), '<h1>dashboard</h1>');
  assert.equal(runtime.getOwnerConsoleHtml(), '<h1>owner</h1>');
  assert.equal(runtime.getTenantConsoleHtml(), '<h1>tenant</h1>');
  assert.equal(runtime.getLoginHtml(), '<h1>login</h1>');

  const res = createResponse();
  const served = await runtime.tryServeAdminStaticAsset(
    { method: 'GET' },
    res,
    '/admin/assets/dashboard.css',
  );

  assert.equal(served, true);
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers['Content-Type'] || ''), /text\/css/i);
  assert.equal(res.body, 'body{color:red}');
});
