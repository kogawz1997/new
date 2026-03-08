const { loadJson, saveJsonDebounced } = require('./_persist');
const { prisma } = require('../prisma');

const carts = new Map(); // userId -> { items: Map<itemId, quantity>, updatedAt }

let mutationVersion = 0;
let dbWriteQueue = Promise.resolve();
let initPromise = null;

function normalizeUserId(value) {
  return String(value || '').trim();
}

function normalizeItemId(value) {
  return String(value || '').trim();
}

function normalizeQuantity(value, fallback = 1, min = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.trunc(n));
}

function normalizeIsoDate(value, fallback = new Date()) {
  const date = value ? new Date(value) : fallback;
  if (Number.isNaN(date.getTime())) return new Date();
  return date;
}

function toSerializableCart(userId, cart) {
  return {
    userId,
    updatedAt: cart.updatedAt || new Date().toISOString(),
    items: Array.from(cart.items.entries()).map(([itemId, quantity]) => ({
      itemId,
      quantity: normalizeQuantity(quantity, 1, 1),
    })),
  };
}

function fromSerializableCart(row) {
  if (!row || typeof row !== 'object') return null;
  const userId = normalizeUserId(row.userId);
  if (!userId) return null;

  const items = new Map();
  for (const item of Array.isArray(row.items) ? row.items : []) {
    const itemId = normalizeItemId(item?.itemId);
    if (!itemId) continue;
    items.set(itemId, normalizeQuantity(item?.quantity, 1, 1));
  }

  return {
    userId,
    cart: {
      items,
      updatedAt: normalizeIsoDate(row.updatedAt).toISOString(),
    },
  };
}

const scheduleSave = saveJsonDebounced('carts.json', () => ({
  carts: Array.from(carts.entries()).map(([userId, cart]) =>
    toSerializableCart(userId, cart),
  ),
}));

function queueDbWrite(work, label) {
  dbWriteQueue = dbWriteQueue
    .then(async () => {
      await work();
    })
    .catch((error) => {
      console.error(`[cartStore] prisma ${label} failed:`, error.message);
    });
  return dbWriteQueue;
}

async function hydrateFromPrisma() {
  const startVersion = mutationVersion;
  try {
    const rows = await prisma.cartEntry.findMany({
      orderBy: [{ updatedAt: 'desc' }],
    });

    if (rows.length === 0) {
      if (carts.size > 0) {
        await queueDbWrite(
          async () => {
            for (const [userId, cart] of carts.entries()) {
              for (const [itemId, quantity] of cart.items.entries()) {
                await prisma.cartEntry.upsert({
                  where: {
                    userId_itemId: {
                      userId,
                      itemId,
                    },
                  },
                  update: {
                    quantity,
                    updatedAt: normalizeIsoDate(cart.updatedAt),
                  },
                  create: {
                    userId,
                    itemId,
                    quantity,
                    updatedAt: normalizeIsoDate(cart.updatedAt),
                  },
                });
              }
            }
          },
          'backfill',
        );
      }
      return;
    }

    const hydrated = new Map();
    for (const row of rows) {
      const userId = normalizeUserId(row.userId);
      const itemId = normalizeItemId(row.itemId);
      const quantity = normalizeQuantity(row.quantity, 1, 1);
      if (!userId || !itemId) continue;

      let cart = hydrated.get(userId);
      if (!cart) {
        cart = {
          items: new Map(),
          updatedAt: normalizeIsoDate(row.updatedAt).toISOString(),
        };
        hydrated.set(userId, cart);
      }
      cart.items.set(itemId, quantity);

      const rowUpdatedAt = normalizeIsoDate(row.updatedAt).toISOString();
      if (rowUpdatedAt > cart.updatedAt) {
        cart.updatedAt = rowUpdatedAt;
      }
    }

    if (startVersion === mutationVersion) {
      carts.clear();
      for (const [userId, cart] of hydrated.entries()) {
        carts.set(userId, cart);
      }
      scheduleSave();
      return;
    }

    for (const [userId, cart] of hydrated.entries()) {
      if (!carts.has(userId)) {
        carts.set(userId, cart);
        continue;
      }
      const current = carts.get(userId);
      for (const [itemId, qty] of cart.items.entries()) {
        if (!current.items.has(itemId)) {
          current.items.set(itemId, qty);
        }
      }
      if (cart.updatedAt > current.updatedAt) {
        current.updatedAt = cart.updatedAt;
      }
    }
    scheduleSave();
  } catch (error) {
    console.error('[cartStore] failed to hydrate from prisma:', error.message);
  }
}

function loadLegacySnapshot() {
  const persisted = loadJson('carts.json', null);
  if (!persisted?.carts || !Array.isArray(persisted.carts)) return;

  for (const row of persisted.carts) {
    const parsed = fromSerializableCart(row);
    if (!parsed) continue;
    carts.set(parsed.userId, parsed.cart);
  }
}

function initCartStore() {
  if (!initPromise) {
    loadLegacySnapshot();
    initPromise = hydrateFromPrisma();
  }
  return initPromise;
}

function flushCartStoreWrites() {
  return dbWriteQueue;
}

function getOrCreateCart(userId) {
  const key = normalizeUserId(userId);
  if (!key) return null;

  let cart = carts.get(key);
  if (!cart) {
    cart = {
      items: new Map(),
      updatedAt: new Date().toISOString(),
    };
    carts.set(key, cart);
  }
  return cart;
}

function touchCart(cart) {
  if (!cart) return;
  cart.updatedAt = new Date().toISOString();
}

function listCartItems(userId) {
  const key = normalizeUserId(userId);
  if (!key) return [];
  const cart = carts.get(key);
  if (!cart) return [];
  return Array.from(cart.items.entries()).map(([itemId, quantity]) => ({
    itemId,
    quantity: normalizeQuantity(quantity, 1, 1),
  }));
}

function getCartUnits(userId) {
  return listCartItems(userId).reduce((sum, row) => sum + row.quantity, 0);
}

function addCartItem(userId, itemId, quantity = 1) {
  const key = normalizeUserId(userId);
  const itemKey = normalizeItemId(itemId);
  if (!key || !itemKey) return null;

  mutationVersion += 1;
  const cart = getOrCreateCart(key);
  const nextQty = normalizeQuantity(quantity, 1, 1);
  const prev = normalizeQuantity(cart.items.get(itemKey) || 0, 0, 0);
  const updatedQty = Math.max(1, prev + nextQty);
  cart.items.set(itemKey, updatedQty);
  touchCart(cart);
  scheduleSave();

  const updatedAt = normalizeIsoDate(cart.updatedAt);
  queueDbWrite(
    async () => {
      await prisma.cartEntry.upsert({
        where: {
          userId_itemId: {
            userId: key,
            itemId: itemKey,
          },
        },
        update: {
          quantity: updatedQty,
          updatedAt,
        },
        create: {
          userId: key,
          itemId: itemKey,
          quantity: updatedQty,
          updatedAt,
        },
      });
    },
    'add-item',
  );

  return {
    itemId: itemKey,
    quantity: updatedQty,
    units: getCartUnits(key),
  };
}

function removeCartItem(userId, itemId, quantity = 1) {
  const key = normalizeUserId(userId);
  const itemKey = normalizeItemId(itemId);
  if (!key || !itemKey) return null;

  const cart = carts.get(key);
  if (!cart || !cart.items.has(itemKey)) return null;

  mutationVersion += 1;
  const dec = normalizeQuantity(quantity, 1, 1);
  const current = normalizeQuantity(cart.items.get(itemKey) || 0, 0, 0);
  const next = current - dec;
  if (next <= 0) {
    cart.items.delete(itemKey);
  } else {
    cart.items.set(itemKey, next);
  }

  if (cart.items.size === 0) {
    carts.delete(key);
  } else {
    touchCart(cart);
  }
  scheduleSave();

  if (next <= 0) {
    queueDbWrite(
      async () => {
        await prisma.cartEntry.deleteMany({
          where: {
            userId: key,
            itemId: itemKey,
          },
        });
      },
      'remove-item-delete',
    );
  } else {
    const updatedAt = normalizeIsoDate(cart.updatedAt);
    queueDbWrite(
      async () => {
        await prisma.cartEntry.upsert({
          where: {
            userId_itemId: {
              userId: key,
              itemId: itemKey,
            },
          },
          update: {
            quantity: next,
            updatedAt,
          },
          create: {
            userId: key,
            itemId: itemKey,
            quantity: next,
            updatedAt,
          },
        });
      },
      'remove-item-upsert',
    );
  }

  return {
    itemId: itemKey,
    quantity: next > 0 ? next : 0,
    units: getCartUnits(key),
  };
}

function clearCart(userId) {
  const key = normalizeUserId(userId);
  if (!key) return false;

  const existed = carts.delete(key);
  if (!existed) return false;

  mutationVersion += 1;
  scheduleSave();
  queueDbWrite(
    async () => {
      await prisma.cartEntry.deleteMany({
        where: {
          userId: key,
        },
      });
    },
    'clear-cart',
  );
  return true;
}

function listAllCarts() {
  return Array.from(carts.entries()).map(([userId, cart]) =>
    toSerializableCart(userId, cart),
  );
}

function replaceCarts(nextCarts = []) {
  mutationVersion += 1;
  carts.clear();
  for (const row of Array.isArray(nextCarts) ? nextCarts : []) {
    const parsed = fromSerializableCart(row);
    if (!parsed) continue;
    carts.set(parsed.userId, parsed.cart);
  }
  scheduleSave();

  queueDbWrite(
    async () => {
      await prisma.cartEntry.deleteMany({});
      for (const [userId, cart] of carts.entries()) {
        const updatedAt = normalizeIsoDate(cart.updatedAt);
        for (const [itemId, quantity] of cart.items.entries()) {
          await prisma.cartEntry.create({
            data: {
              userId,
              itemId,
              quantity: normalizeQuantity(quantity, 1, 1),
              updatedAt,
            },
          });
        }
      }
    },
    'replace-carts',
  );

  return carts.size;
}

initCartStore();

module.exports = {
  addCartItem,
  removeCartItem,
  clearCart,
  listCartItems,
  getCartUnits,
  listAllCarts,
  replaceCarts,
  initCartStore,
  flushCartStoreWrites,
};
