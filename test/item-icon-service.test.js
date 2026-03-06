const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../src/services/itemIconService.js');

function freshItemIconService() {
  delete require.cache[modulePath];
  return require(modulePath);
}

function withEnv(overrides, fn) {
  const backup = {
    SCUM_ITEMS_BASE_URL: process.env.SCUM_ITEMS_BASE_URL,
    SCUM_ITEMS_INDEX_PATH: process.env.SCUM_ITEMS_INDEX_PATH,
    SCUM_ITEMS_DIR_PATH: process.env.SCUM_ITEMS_DIR_PATH,
  };

  for (const [key, value] of Object.entries(overrides)) {
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(backup)) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    delete require.cache[modulePath];
  }
}

test('item icon resolver loads from index and resolves aliases', () =>
  withEnv({}, () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'item-icon-index-'));
    const indexPath = path.join(tempRoot, 'index.json');
    const indexData = {
      repository: {
        base_url: 'https://cdn.example.local/scum-items',
      },
      items: [
        {
          name: 'Weapon_AK47',
          filename: 'Weapon_AK47.webp',
        },
        {
          name: 'Cal_9mm',
          filename: 'Cal_9mm.webp',
        },
      ],
    };
    fs.writeFileSync(indexPath, JSON.stringify(indexData), 'utf8');

    process.env.SCUM_ITEMS_INDEX_PATH = indexPath;
    process.env.SCUM_ITEMS_DIR_PATH = tempRoot;
    delete process.env.SCUM_ITEMS_BASE_URL;

    const service = freshItemIconService();
    const url = service.resolveItemIconUrl('Weapon_AK47');
    assert.equal(url, 'https://cdn.example.local/scum-items/Weapon_AK47.webp');

    const aliasUrl = service.resolveItemIconUrl({
      id: 'vip-ak',
      gameItemId: 'BP_WEAPON_AK47_C',
    });
    assert.equal(aliasUrl, 'https://cdn.example.local/scum-items/Weapon_AK47.webp');

    const directUrl = service.resolveItemIconUrl({
      id: 'anything',
      iconUrl: 'https://override/icon.png',
    });
    assert.equal(directUrl, 'https://override/icon.png');

    const catalog = service.listItemIconCatalog('9mm', 10);
    assert.equal(catalog.length, 1);
    assert.equal(catalog[0].id, 'Cal_9mm');

    const meta = service.getItemIconResolverMeta();
    assert.equal(meta.source, indexPath);
    assert.ok(meta.total >= 2);
  }));

test('item icon resolver falls back to directory scan when index missing', () =>
  withEnv({}, () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'item-icon-dir-'));
    const filename = 'Weapon_M9.webp';
    fs.writeFileSync(path.join(tempRoot, filename), 'not-an-image-but-ok', 'utf8');

    process.env.SCUM_ITEMS_INDEX_PATH = path.join(tempRoot, 'not-found.json');
    process.env.SCUM_ITEMS_DIR_PATH = tempRoot;
    process.env.SCUM_ITEMS_BASE_URL = 'https://files.example/icons';

    const service = freshItemIconService();
    const url = service.resolveItemIconUrl('M9');
    assert.equal(url, 'https://files.example/icons/Weapon_M9.webp');

    const catalog = service.listItemIconCatalog('', 5);
    assert.equal(catalog.length, 1);
    assert.equal(catalog[0].filename, filename);

    const meta = service.getItemIconResolverMeta();
    assert.equal(meta.source, tempRoot);
    assert.ok(meta.total >= 1);
  }));
