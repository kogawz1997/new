const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_BASE_URL = 'https://vbothost.github.io/scum_items/';
const DEFAULT_INDEX_PATH = path.resolve(process.cwd(), 'scum_items-main', 'index.json');
const DEFAULT_ITEMS_DIR = path.resolve(process.cwd(), 'scum_items-main');

let cached = null;
let warnedMissingIndex = false;

function normalizeKey(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^.*\//, '')
    .replace(/\.(webp|png|jpg|jpeg)$/i, '')
    .replace(/[\u2000-\u206f\u2e00-\u2e7f'"`~!@#$%^&*()+={}\[\]|:;,.<>?]/g, ' ')
    .replace(/[-\s]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function withTrailingSlash(value) {
  const base = String(value || '').trim() || DEFAULT_BASE_URL;
  return base.endsWith('/') ? base : `${base}/`;
}

function pushVariant(variants, value) {
  const normalized = normalizeKey(value);
  if (!normalized) return;
  variants.push(normalized);

  // SCUM blueprint names often carry "_C" suffix (e.g. BP_WEAPON_AK47_C).
  const withoutClassSuffix = normalized.replace(/_c\d*$/i, '');
  if (withoutClassSuffix && withoutClassSuffix !== normalized) {
    variants.push(withoutClassSuffix);
  }
}

function buildVariants(rawValue) {
  const text = String(rawValue || '').trim();
  if (!text) return [];

  const direct = normalizeKey(text);
  const variants = [];
  pushVariant(variants, direct);

  if (text.includes(':')) {
    const tail = text.split(':').pop();
    pushVariant(variants, tail);
  }

  if (text.includes('/')) {
    const tail = text.split('/').pop();
    pushVariant(variants, tail);
  }

  if (direct.startsWith('bp_')) {
    pushVariant(variants, direct.replace(/^bp_+/, ''));
  }

  if (direct.startsWith('item_')) {
    pushVariant(variants, direct.replace(/^item_+/, ''));
  }

  if (direct.startsWith('weapon_')) {
    pushVariant(variants, direct.replace(/^weapon_+/, ''));
  } else {
    pushVariant(variants, `weapon_${direct}`);
  }

  if (direct.startsWith('ammo_')) {
    pushVariant(variants, direct.replace(/^ammo_+/, ''));
  } else {
    pushVariant(variants, `ammo_${direct}`);
  }

  pushVariant(variants, direct.replace(/_/g, ''));
  return unique(variants);
}

function addToLookup(lookup, key, url) {
  if (!key || !url) return;
  if (!lookup.has(key)) {
    lookup.set(key, url);
  }
}

function loadFromIndexFile(indexPath, fallbackBaseUrl) {
  if (!fs.existsSync(indexPath)) return null;
  let parsed = null;
  try {
    const raw = fs.readFileSync(indexPath, 'utf8');
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const baseFromFile = withTrailingSlash(
    parsed?.repository?.base_url || fallbackBaseUrl,
  );
  const lookup = new Map();
  const catalog = [];
  const catalogSeen = new Set();
  const items = Array.isArray(parsed?.items) ? parsed.items : [];

  for (const item of items) {
    const filename = String(item?.filename || '').trim();
    const name = String(item?.name || '').trim();
    const url =
      String(item?.url || '').trim() || (filename ? `${baseFromFile}${filename}` : '');
    if (!url) continue;

    addToLookup(lookup, normalizeKey(filename), url);
    addToLookup(lookup, normalizeKey(name), url);
    for (const key of buildVariants(filename)) {
      addToLookup(lookup, key, url);
    }
    for (const key of buildVariants(name)) {
      addToLookup(lookup, key, url);
    }

    const catalogId = String(name || filename || '')
      .replace(/\.(webp|png|jpg|jpeg)$/i, '')
      .trim();
    if (catalogId) {
      const dedupeKey = catalogId.toLowerCase();
      if (!catalogSeen.has(dedupeKey)) {
        catalogSeen.add(dedupeKey);
        catalog.push({
          id: catalogId,
          name: catalogId,
          filename,
          url,
        });
      }
    }
  }

  return {
    lookup,
    catalog,
    baseUrl: baseFromFile,
    source: indexPath,
    total: lookup.size,
  };
}

function loadFromDirectory(dirPath, fallbackBaseUrl) {
  if (!fs.existsSync(dirPath)) return null;
  const baseUrl = withTrailingSlash(fallbackBaseUrl);
  const lookup = new Map();
  const catalog = [];
  const files = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of files) {
    if (!entry.isFile()) continue;
    if (!/\.(webp|png|jpg|jpeg)$/i.test(entry.name)) continue;
    const url = `${baseUrl}${entry.name}`;
    addToLookup(lookup, normalizeKey(entry.name), url);
    for (const key of buildVariants(entry.name)) {
      addToLookup(lookup, key, url);
    }

    const itemId = String(entry.name).replace(/\.(webp|png|jpg|jpeg)$/i, '');
    catalog.push({
      id: itemId,
      name: itemId,
      filename: entry.name,
      url,
    });
  }

  return {
    lookup,
    catalog,
    baseUrl,
    source: dirPath,
    total: lookup.size,
  };
}

function ensureLoaded() {
  if (cached) return cached;

  const configuredBase = withTrailingSlash(process.env.SCUM_ITEMS_BASE_URL);
  const configuredIndexPath =
    String(process.env.SCUM_ITEMS_INDEX_PATH || '').trim() || DEFAULT_INDEX_PATH;
  const configuredDirPath =
    String(process.env.SCUM_ITEMS_DIR_PATH || '').trim() || DEFAULT_ITEMS_DIR;

  const byIndex = loadFromIndexFile(configuredIndexPath, configuredBase);
  if (byIndex) {
    cached = byIndex;
    return cached;
  }

  const byDir = loadFromDirectory(configuredDirPath, configuredBase);
  if (byDir) {
    cached = byDir;
    return cached;
  }

  if (!warnedMissingIndex) {
    warnedMissingIndex = true;
    console.warn(
      '[item-icon] no icon index found. set SCUM_ITEMS_INDEX_PATH or SCUM_ITEMS_DIR_PATH',
    );
  }

  cached = {
    lookup: new Map(),
    catalog: [],
    baseUrl: configuredBase,
    source: 'none',
    total: 0,
  };
  return cached;
}

function resolveItemIconUrl(item) {
  const state = ensureLoaded();
  if (!state.lookup || state.lookup.size === 0) return null;

  if (item && typeof item === 'object' && item.iconUrl) {
    const direct = String(item.iconUrl || '').trim();
    if (direct) return direct;
  }

  const values = [];
  if (typeof item === 'string') {
    values.push(item);
  } else if (item && typeof item === 'object') {
    values.push(item.id, item.name, item.gameItemId);
  }

  for (const value of values) {
    for (const key of buildVariants(value)) {
      const found = state.lookup.get(key);
      if (found) return found;
    }
  }

  return null;
}

function listItemIconCatalog(query = '', limit = 200) {
  const state = ensureLoaded();
  const all = Array.isArray(state.catalog) ? state.catalog : [];
  if (all.length === 0) return [];

  const q = String(query || '').trim().toLowerCase();
  const max = Math.max(1, Math.min(1000, Number(limit || 200)));
  const picked = q
    ? all.filter((item) => {
        const hay = `${item.id || ''} ${item.name || ''} ${item.filename || ''}`.toLowerCase();
        return hay.includes(q);
      })
    : all;

  return picked.slice(0, max).map((item) => ({
    id: item.id,
    name: item.name || item.id,
    filename: item.filename || null,
    iconUrl: item.url,
  }));
}

function getItemIconResolverMeta() {
  const state = ensureLoaded();
  return {
    source: state.source,
    total: state.total,
    baseUrl: state.baseUrl,
  };
}

module.exports = {
  normalizeItemIconKey: normalizeKey,
  resolveItemIconUrl,
  listItemIconCatalog,
  getItemIconResolverMeta,
};
