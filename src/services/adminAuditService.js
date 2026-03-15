const crypto = require('node:crypto');

const { resolveDatabaseRuntime } = require('../utils/dbEngine');

const REWARD_REASON_TOKENS = Object.freeze([
  'daily',
  'weekly',
  'redeem',
  'welcome',
  'wheel',
  'event_reward',
  'reward',
  'claim',
]);

const ADMIN_ROLE_LEVEL = Object.freeze({
  mod: 1,
  admin: 2,
  owner: 3,
});

const PRESET_VISIBILITY_VALUES = new Set(['private', 'public', 'role']);
let ensureAdminAuditPresetSchemaPromise = null;

function normalizeAdminRole(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'owner' || raw === 'admin') return raw;
  return 'mod';
}

function hasRoleAtLeast(role, minRole) {
  return (ADMIN_ROLE_LEVEL[normalizeAdminRole(role)] || 0)
    >= (ADMIN_ROLE_LEVEL[normalizeAdminRole(minRole)] || 0);
}

function createPresetError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizePresetVisibility(value) {
  const raw = String(value || '').trim().toLowerCase();
  return PRESET_VISIBILITY_VALUES.has(raw) ? raw : 'public';
}

function normalizePresetSharedRole(value, fallbackRole = 'mod') {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return normalizeAdminRole(fallbackRole);
  return normalizeAdminRole(raw);
}

function normalizeAuditView(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'reward') return 'reward';
  if (raw === 'event') return 'event';
  return 'wallet';
}

function normalizeAuditFilterText(value) {
  return String(value || '').trim();
}

function normalizeAuditMatchMode(value) {
  return String(value || '').trim().toLowerCase() === 'exact'
    ? 'exact'
    : 'contains';
}

function normalizeAuditWindowMs(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || raw === 'all') return null;
  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.max(60 * 1000, Math.trunc(numeric));
}

function normalizeAuditDateInput(value, { endOfDay = false } = {}) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const normalized = dateOnly
    ? `${raw}${endOfDay ? 'T23:59:59.999' : 'T00:00:00.000'}`
    : raw;
  const ts = new Date(normalized).getTime();
  return Number.isFinite(ts) ? ts : null;
}

function normalizeAuditTimestamp(value) {
  if (!value) return 0;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function stringifyAuditValue(value) {
  if (value == null) return '';
  if (Array.isArray(value)) {
    return value.map((entry) => stringifyAuditValue(entry)).join(', ');
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function getAuditWindowLabel(windowMs) {
  if (!windowMs) return 'ทุกช่วงเวลา';
  if (windowMs === 24 * 60 * 60 * 1000) return '24 ชั่วโมงล่าสุด';
  if (windowMs === 7 * 24 * 60 * 60 * 1000) return '7 วันล่าสุด';
  if (windowMs === 30 * 24 * 60 * 60 * 1000) return '30 วันล่าสุด';
  return `${Math.round(windowMs / (60 * 60 * 1000))} ชั่วโมงล่าสุด`;
}

function toCsvValue(value) {
  return `"${stringifyAuditValue(value).replace(/"/g, '""')}"`;
}

function encodeAuditCursor(index) {
  return Buffer.from(
    JSON.stringify({ index: Math.max(0, Math.trunc(Number(index) || 0)) }),
    'utf8',
  ).toString('base64url');
}

function decodeAuditCursor(cursor) {
  const raw = String(cursor || '').trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    const index = Number(parsed?.index);
    return Number.isFinite(index) && index >= 0 ? Math.trunc(index) : null;
  } catch {
    return null;
  }
}

function combineWhere(...parts) {
  const normalized = parts.filter((part) => part && Object.keys(part).length > 0);
  if (normalized.length === 0) return {};
  if (normalized.length === 1) return normalized[0];
  return { AND: normalized };
}

function buildCreatedAtWhere(windowMs, dateFrom, dateTo) {
  let fromTs = dateFrom;
  if (windowMs) {
    const windowStart = Date.now() - windowMs;
    fromTs = fromTs ? Math.max(fromTs, windowStart) : windowStart;
  }
  if (!fromTs && !dateTo) return null;
  const createdAt = {};
  if (fromTs) createdAt.gte = new Date(fromTs);
  if (dateTo) createdAt.lte = new Date(dateTo);
  return { createdAt };
}

function buildStringFilter(field, value, mode = 'contains') {
  const normalized = normalizeAuditFilterText(value);
  if (!normalized) return null;
  return {
    [field]: mode === 'exact'
      ? normalized
      : { contains: normalized },
  };
}

function buildOrFilter(field, value, mode = 'contains') {
  const normalized = normalizeAuditFilterText(value);
  if (!normalized) return null;
  if (mode === 'exact') {
    return { [field]: normalized };
  }
  return { [field]: { contains: normalized } };
}

function buildWalletQueryFilter(query) {
  const normalized = normalizeAuditFilterText(query);
  if (!normalized) return null;
  return {
    OR: [
      buildOrFilter('userId', normalized),
      buildOrFilter('reason', normalized),
      buildOrFilter('reference', normalized),
      buildOrFilter('actor', normalized),
      buildOrFilter('metaJson', normalized),
    ].filter(Boolean),
  };
}

function buildWalletReasonFilter(reason) {
  const normalized = normalizeAuditFilterText(reason);
  if (!normalized) return null;
  return {
    OR: [
      buildOrFilter('reason', normalized),
      buildOrFilter('reference', normalized),
      buildOrFilter('actor', normalized),
    ].filter(Boolean),
  };
}

function buildRewardOnlyWhere() {
  return {
    OR: REWARD_REASON_TOKENS.map((token) => ({
      reason: { contains: token },
    })),
  };
}

function buildWalletLedgerWhere(options = {}, { rewardOnly = false } = {}) {
  const query = normalizeAuditFilterText(options.query);
  const userId = normalizeAuditFilterText(options.userId);
  const reason = normalizeAuditFilterText(options.reason);
  const status = normalizeAuditFilterText(options.status);
  const actor = normalizeAuditFilterText(options.actor);
  const actorMode = normalizeAuditMatchMode(options.actorMode);
  const reference = normalizeAuditFilterText(options.reference);
  const referenceMode = normalizeAuditMatchMode(options.referenceMode);
  const windowMs = normalizeAuditWindowMs(options.windowMs);
  const dateFrom = normalizeAuditDateInput(options.dateFrom);
  const dateTo = normalizeAuditDateInput(options.dateTo, { endOfDay: true });

  if (status) {
    return { id: -1 };
  }

  return combineWhere(
    buildCreatedAtWhere(windowMs, dateFrom, dateTo),
    rewardOnly ? buildRewardOnlyWhere() : null,
    buildWalletQueryFilter(query),
    buildStringFilter('userId', userId),
    buildWalletReasonFilter(reason),
    buildStringFilter('actor', actor, actorMode),
    buildStringFilter('reference', reference, referenceMode),
  );
}

function buildEventQueryFilter(query) {
  const normalized = normalizeAuditFilterText(query);
  if (!normalized) return null;
  return {
    OR: [
      buildOrFilter('name', normalized),
      buildOrFilter('reward', normalized),
      buildOrFilter('status', normalized),
      Number.isFinite(Number(normalized)) ? { id: Math.trunc(Number(normalized)) } : null,
      { participants: { some: buildOrFilter('userId', normalized) } },
    ].filter(Boolean),
  };
}

function buildEventReasonFilter(reason) {
  const normalized = normalizeAuditFilterText(reason);
  if (!normalized) return null;
  return {
    OR: [buildOrFilter('reward', normalized), buildOrFilter('name', normalized)].filter(Boolean),
  };
}

function buildEventStatusFilter(status, mode = 'contains') {
  const normalized = normalizeAuditFilterText(status);
  if (!normalized) return null;
  return buildStringFilter('status', normalized, mode);
}

function buildEventReferenceFilter(reference, mode = 'contains') {
  const normalized = normalizeAuditFilterText(reference);
  if (!normalized) return null;
  const numericId = Number(normalized);
  return {
    OR: [
      buildOrFilter('reward', normalized, mode),
      buildOrFilter('name', normalized, mode),
      Number.isFinite(numericId) ? { id: Math.trunc(numericId) } : null,
    ].filter(Boolean),
  };
}

function buildEventWhere(options = {}) {
  const query = normalizeAuditFilterText(options.query);
  const userId = normalizeAuditFilterText(options.userId);
  const reason = normalizeAuditFilterText(options.reason);
  const status = normalizeAuditFilterText(options.status);
  const statusMode = normalizeAuditMatchMode(options.statusMode);
  const actor = normalizeAuditFilterText(options.actor);
  const reference = normalizeAuditFilterText(options.reference);
  const referenceMode = normalizeAuditMatchMode(options.referenceMode);
  const windowMs = normalizeAuditWindowMs(options.windowMs);
  const dateFrom = normalizeAuditDateInput(options.dateFrom);
  const dateTo = normalizeAuditDateInput(options.dateTo, { endOfDay: true });

  if (actor) {
    return { id: -1 };
  }

  return combineWhere(
    buildCreatedAtWhere(windowMs, dateFrom, dateTo),
    buildEventQueryFilter(query),
    userId ? { participants: { some: buildOrFilter('userId', userId) } } : null,
    buildEventReasonFilter(reason),
    buildEventStatusFilter(status, statusMode),
    buildEventReferenceFilter(reference, referenceMode),
  );
}

const AUDIT_SORT_FIELDS = Object.freeze({
  wallet: ['timestamp', 'userId', 'delta', 'balanceAfter', 'reason', 'reference', 'actor', 'status'],
  reward: ['timestamp', 'userId', 'delta', 'balanceAfter', 'reason', 'reference', 'actor', 'status'],
  event: ['timestamp', 'id', 'name', 'status', 'reward', 'participantsCount'],
});

function normalizeAuditSortBy(view, value) {
  const raw = String(value || '').trim();
  const allowed = AUDIT_SORT_FIELDS[view] || AUDIT_SORT_FIELDS.wallet;
  if (allowed.includes(raw)) return raw;
  return 'timestamp';
}

function normalizeAuditSortOrder(value) {
  return String(value || '').trim().toLowerCase() === 'asc' ? 'asc' : 'desc';
}

function getAuditSortValue(view, row, sortBy) {
  switch (sortBy) {
    case 'timestamp':
      return normalizeAuditTimestamp(view === 'event' ? row?.createdAt || row?.time : row?.createdAt || row?.claimedAt || row?.statusUpdatedAt);
    case 'userId':
      return String(row?.userId || '');
    case 'delta':
      return Number(row?.delta || 0);
    case 'balanceAfter':
      return Number(row?.balanceAfter || 0);
    case 'reason':
      return String(row?.reason || '');
    case 'reference':
      return String(row?.reference || row?.purchaseCode || row?.code || row?.itemId || row?.id || '');
    case 'actor':
      return String(row?.actor || row?.createdBy || row?.updatedBy || row?.hostId || row?.staffId || row?.moderator || '');
    case 'status':
      return String(row?.status || '');
    case 'id':
      return Number(row?.id || 0);
    case 'name':
      return String(row?.name || '');
    case 'reward':
      return String(row?.reward || '');
    case 'participantsCount':
      return Number(row?.participantsCount || 0);
    default:
      return normalizeAuditTimestamp(row?.createdAt || row?.time);
  }
}

function compareAuditSortValues(left, right) {
  if (typeof left === 'number' || typeof right === 'number') {
    return Number(left || 0) - Number(right || 0);
  }
  return String(left || '').localeCompare(String(right || ''), 'th');
}

function sortAuditRows(rows, view, sortBy = 'timestamp', sortOrder = 'desc') {
  const direction = sortOrder === 'asc' ? 1 : -1;
  return [...(Array.isArray(rows) ? rows : [])]
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const primary = compareAuditSortValues(
        getAuditSortValue(view, a.row, sortBy),
        getAuditSortValue(view, b.row, sortBy),
      );
      if (primary !== 0) return primary * direction;
      return a.index - b.index;
    })
    .map((entry) => entry.row);
}

function mapWalletAuditRow(row) {
  return {
    เวลา: row?.createdAt || '-',
    ผู้ใช้: row?.userId || '-',
    เปลี่ยนแปลง: Number(row?.delta || 0),
    ก่อนหน้า: Number(row?.balanceBefore || 0),
    หลังทำรายการ: Number(row?.balanceAfter || 0),
    เหตุผล: row?.reason || '-',
    อ้างอิง: row?.reference || '-',
    ผู้กระทำ: row?.actor || '-',
  };
}

function mapRewardAuditRow(row) {
  return {
    เวลา: row?.createdAt || '-',
    ผู้ใช้: row?.userId || '-',
    รางวัล: row?.reason || '-',
    จำนวน: Number(row?.delta || 0),
    ยอดหลังรับ: Number(row?.balanceAfter || 0),
    อ้างอิง: row?.reference || '-',
    ผู้กระทำ: row?.actor || '-',
  };
}

function mapEventAuditRow(row) {
  return {
    ID: Number(row?.id || 0),
    ชื่อกิจกรรม: row?.name || '-',
    เวลา: row?.time || '-',
    สถานะ: row?.status || '-',
    ของรางวัล: row?.reward || '-',
    ผู้เข้าร่วม: Number(row?.participantsCount || 0),
    รายชื่อผู้เข้าร่วม: Array.isArray(row?.participants)
      ? row.participants.join(', ') || '-'
      : '-',
  };
}

function buildPaginationState({ total, pageSize, requestedPage, cursor, exportAll }) {
  const cursorIndex = decodeAuditCursor(cursor);
  const usingCursor = cursorIndex != null && !exportAll;
  const totalPages = exportAll ? 1 : Math.max(1, Math.ceil(total / pageSize));
  const startIndex = exportAll
    ? 0
    : usingCursor
      ? Math.max(0, Math.min(cursorIndex, Math.max(0, total - 1)))
      : Math.max(0, Math.min((requestedPage - 1) * pageSize, Math.max(0, total - 1)));
  const normalizedStartIndex = total === 0 ? 0 : startIndex;
  const page = exportAll ? 1 : Math.max(1, Math.floor(normalizedStartIndex / pageSize) + 1);
  const nextIndex = normalizedStartIndex + pageSize;
  const prevIndex = Math.max(0, normalizedStartIndex - pageSize);
  return {
    totalPages,
    usingCursor,
    normalizedStartIndex,
    page,
    nextCursor: !exportAll && nextIndex < total ? encodeAuditCursor(nextIndex) : null,
    prevCursor: !exportAll && normalizedStartIndex > 0 ? encodeAuditCursor(prevIndex) : null,
    hasPrev: !exportAll && normalizedStartIndex > 0,
    hasNext: !exportAll && nextIndex < total,
    cursor: usingCursor ? encodeAuditCursor(normalizedStartIndex) : null,
  };
}

function buildWalletOrderBy(sortBy, sortOrder) {
  const direction = sortOrder === 'asc' ? 'asc' : 'desc';
  const fieldMap = {
    timestamp: 'createdAt',
    userId: 'userId',
    delta: 'delta',
    balanceAfter: 'balanceAfter',
    reason: 'reason',
    reference: 'reference',
    actor: 'actor',
  };
  const field = fieldMap[sortBy] || 'createdAt';
  return [{ [field]: direction }, { id: direction }];
}

function buildEventOrderBy(sortBy, sortOrder) {
  const direction = sortOrder === 'asc' ? 'asc' : 'desc';
  const fieldMap = {
    timestamp: 'createdAt',
    id: 'id',
    name: 'name',
    status: 'status',
    reward: 'reward',
  };
  const field = fieldMap[sortBy];
  if (!field) return null;
  return [{ [field]: direction }, { id: direction }];
}

function normalizeEventRow(row) {
  const participants = (Array.isArray(row?.participants) ? row.participants : [])
    .map((entry) => String(entry?.userId || '').trim())
    .filter(Boolean);
  return {
    id: Number(row?.id || 0),
    name: String(row?.name || ''),
    time: String(row?.time || ''),
    reward: String(row?.reward || ''),
    status: String(row?.status || ''),
    createdAt: row?.createdAt || null,
    participants,
    participantsCount: participants.length,
  };
}

async function buildWalletCards(prisma, where, windowMs) {
  const [total, creditsAgg, debitsAgg] = await Promise.all([
    prisma.walletLedger.count({ where }),
    prisma.walletLedger.aggregate({
      where: combineWhere(where, { delta: { gt: 0 } }),
      _sum: { delta: true },
    }),
    prisma.walletLedger.aggregate({
      where: combineWhere(where, { delta: { lt: 0 } }),
      _sum: { delta: true },
    }),
  ]);

  return [
    ['รายการที่ตรงเงื่อนไข', total],
    ['เครดิตรวม', Number(creditsAgg?._sum?.delta || 0)],
    ['เดบิตรวม', Math.abs(Number(debitsAgg?._sum?.delta || 0))],
    ['ช่วงเวลา', getAuditWindowLabel(windowMs)],
  ];
}

async function buildRewardCards(prisma, where, windowMs) {
  const [total, creditsAgg, reasons] = await Promise.all([
    prisma.walletLedger.count({ where }),
    prisma.walletLedger.aggregate({
      where: combineWhere(where, { delta: { gt: 0 } }),
      _sum: { delta: true },
    }),
    prisma.walletLedger.findMany({
      where,
      select: { reason: true },
      distinct: ['reason'],
    }),
  ]);

  return [
    ['reward ledger ที่ตรงเงื่อนไข', total],
    ['เครดิต reward รวม', Number(creditsAgg?._sum?.delta || 0)],
    ['ประเภทรางวัล', reasons.filter((row) => String(row?.reason || '').trim()).length],
    ['ช่วงเวลา', getAuditWindowLabel(windowMs)],
  ];
}

async function buildEventCards(prisma, eventWhere, rewardWhere, windowMs) {
  const [total, active, rewardRows] = await Promise.all([
    prisma.guildEvent.count({ where: eventWhere }),
    prisma.guildEvent.count({ where: combineWhere(eventWhere, { status: { not: 'ended' } }) }),
    prisma.walletLedger.findMany({
      where: combineWhere(rewardWhere, buildRewardOnlyWhere()),
      select: { reason: true },
    }),
  ]);
  const eventRewardCount = rewardRows.filter((row) => String(row?.reason || '') === 'event_reward').length;

  return [
    ['กิจกรรมที่ตรงเงื่อนไข', total],
    ['กิจกรรมที่ยังเปิดอยู่', active],
    ['event_reward ใน ledger', eventRewardCount],
    ['ช่วงเวลา', getAuditWindowLabel(windowMs)],
  ];
}

async function buildWalletLikeDataset(prisma, view, options, { rewardOnly = false } = {}) {
  const where = buildWalletLedgerWhere(options, { rewardOnly });
  const sortBy = normalizeAuditSortBy(view, options.sortBy);
  const sortOrder = normalizeAuditSortOrder(options.sortOrder);
  const pageSize = Math.max(
    1,
    Math.min(
      500,
      Number.isFinite(Number(options.pageSize))
        ? Math.trunc(Number(options.pageSize))
        : Number.isFinite(Number(options.limit))
          ? Math.trunc(Number(options.limit))
          : 50,
    ),
  );
  const requestedPage = Math.max(
    1,
    Number.isFinite(Number(options.page)) ? Math.trunc(Number(options.page)) : 1,
  );
  const exportAll = options.exportAll === true;
  const total = await prisma.walletLedger.count({ where });
  const paging = buildPaginationState({
    total,
    pageSize,
    requestedPage,
    cursor: options.cursor,
    exportAll,
  });
  const rows = await prisma.walletLedger.findMany({
    where,
    orderBy: buildWalletOrderBy(sortBy, sortOrder),
    ...(exportAll ? {} : { skip: paging.normalizedStartIndex, take: pageSize }),
  });
  const cards = view === 'reward'
    ? await buildRewardCards(prisma, where, normalizeAuditWindowMs(options.windowMs))
    : await buildWalletCards(prisma, where, normalizeAuditWindowMs(options.windowMs));

  return {
    view,
    total,
    returned: rows.length,
    page: paging.page,
    pageSize,
    totalPages: paging.totalPages,
    sortBy,
    sortOrder,
    paginationMode: paging.usingCursor ? 'cursor' : 'page',
    cursor: paging.cursor,
    nextCursor: paging.nextCursor,
    prevCursor: paging.prevCursor,
    hasPrev: paging.hasPrev,
    hasNext: paging.hasNext,
    cards,
    rows,
    tableRows: view === 'reward' ? rows.map(mapRewardAuditRow) : rows.map(mapWalletAuditRow),
  };
}

async function buildEventDataset(prisma, options) {
  const view = 'event';
  const where = buildEventWhere(options);
  const rewardWhere = buildWalletLedgerWhere(options, { rewardOnly: true });
  const sortBy = normalizeAuditSortBy(view, options.sortBy);
  const sortOrder = normalizeAuditSortOrder(options.sortOrder);
  const pageSize = Math.max(
    1,
    Math.min(
      500,
      Number.isFinite(Number(options.pageSize))
        ? Math.trunc(Number(options.pageSize))
        : Number.isFinite(Number(options.limit))
          ? Math.trunc(Number(options.limit))
          : 50,
    ),
  );
  const requestedPage = Math.max(
    1,
    Number.isFinite(Number(options.page)) ? Math.trunc(Number(options.page)) : 1,
  );
  const exportAll = options.exportAll === true;
  const total = await prisma.guildEvent.count({ where });
  const paging = buildPaginationState({
    total,
    pageSize,
    requestedPage,
    cursor: options.cursor,
    exportAll,
  });

  const shouldSortInMemory = sortBy === 'participantsCount';
  const baseQuery = {
    where,
    include: {
      participants: { select: { userId: true } },
    },
  };

  let rows;
  if (shouldSortInMemory) {
    const allRows = await prisma.guildEvent.findMany(baseQuery);
    const sorted = sortAuditRows(allRows.map(normalizeEventRow), view, sortBy, sortOrder);
    rows = exportAll
      ? sorted
      : sorted.slice(paging.normalizedStartIndex, paging.normalizedStartIndex + pageSize);
  } else {
    const dbRows = await prisma.guildEvent.findMany({
      ...baseQuery,
      orderBy: buildEventOrderBy(sortBy, sortOrder) || [{ createdAt: sortOrder }, { id: sortOrder }],
      ...(exportAll ? {} : { skip: paging.normalizedStartIndex, take: pageSize }),
    });
    rows = dbRows.map(normalizeEventRow);
  }

  return {
    view,
    total,
    returned: rows.length,
    page: paging.page,
    pageSize,
    totalPages: paging.totalPages,
    sortBy,
    sortOrder,
    paginationMode: paging.usingCursor ? 'cursor' : 'page',
    cursor: paging.cursor,
    nextCursor: paging.nextCursor,
    prevCursor: paging.prevCursor,
    hasPrev: paging.hasPrev,
    hasNext: paging.hasNext,
    cards: await buildEventCards(prisma, where, rewardWhere, normalizeAuditWindowMs(options.windowMs)),
    rows,
    tableRows: rows.map(mapEventAuditRow),
  };
}

async function buildAuditDataset(options = {}) {
  const { prisma } = options;
  if (!prisma || typeof prisma.walletLedger?.findMany !== 'function') {
    throw new Error('prisma dependency is required');
  }

  const view = normalizeAuditView(options.view);
  const query = normalizeAuditFilterText(options.query);
  const userId = normalizeAuditFilterText(options.userId);
  const reason = normalizeAuditFilterText(options.reason);
  const status = normalizeAuditFilterText(options.status);
  const statusMode = normalizeAuditMatchMode(options.statusMode);
  const actor = normalizeAuditFilterText(options.actor);
  const actorMode = normalizeAuditMatchMode(options.actorMode);
  const reference = normalizeAuditFilterText(options.reference);
  const referenceMode = normalizeAuditMatchMode(options.referenceMode);
  const windowMs = normalizeAuditWindowMs(options.windowMs);
  const dateFrom = normalizeAuditDateInput(options.dateFrom);
  const dateTo = normalizeAuditDateInput(options.dateTo, { endOfDay: true });
  const sortBy = normalizeAuditSortBy(view, options.sortBy);
  const sortOrder = normalizeAuditSortOrder(options.sortOrder);

  const data = view === 'event'
    ? await buildEventDataset(prisma, options)
    : await buildWalletLikeDataset(prisma, view, options, { rewardOnly: view === 'reward' });

  return {
    ...data,
    filters: {
      query,
      userId,
      reason,
      status,
      statusMode,
      actor,
      actorMode,
      reference,
      referenceMode,
      windowMs,
      dateFrom: dateFrom ? new Date(dateFrom).toISOString() : null,
      dateTo: dateTo ? new Date(dateTo).toISOString() : null,
      windowLabel: getAuditWindowLabel(windowMs),
      sortBy,
      sortOrder,
    },
  };
}

function buildAuditExportPayload(data = {}) {
  return {
    generatedAt: new Date().toISOString(),
    view: data.view || 'wallet',
    total: Number(data.total || 0),
    returned: Number(data.returned || 0),
    sortBy: String(data.sortBy || 'timestamp'),
    sortOrder: String(data.sortOrder || 'desc'),
    filters: data.filters || {},
    rows: Array.isArray(data.rows) ? data.rows : [],
  };
}

function buildAuditCsv(data = {}) {
  const rows = Array.isArray(data.tableRows) ? data.tableRows : [];
  if (rows.length === 0) return '"ไม่มีข้อมูล"\r\n';
  const keys = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row || {}).forEach((key) => set.add(key));
      return set;
    }, new Set()),
  );
  return [
    keys.map((key) => toCsvValue(key)).join(','),
    ...rows.map((row) => keys.map((key) => toCsvValue(row?.[key])).join(',')),
  ].join('\r\n') + '\r\n';
}

function normalizePresetString(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeAuditPresetPayload(payload = {}, context = {}) {
  const name = String(payload.name || '').trim();
  if (!name) {
    throw createPresetError('preset name is required', 400);
  }
  const view = normalizeAuditView(payload.view);
  const sortBy = normalizeAuditSortBy(view, payload.sortBy);
  const actorRole = normalizeAdminRole(context.actorRole);
  const visibility = normalizePresetVisibility(payload.visibility);
  const sharedRole = visibility === 'role'
    ? normalizePresetSharedRole(payload.sharedRole, actorRole)
    : null;
  if (visibility === 'role' && !hasRoleAtLeast(actorRole, sharedRole)) {
    throw createPresetError('cannot share preset above current role', 403);
  }
  return {
    name,
    view,
    visibility,
    sharedRole,
    query: normalizePresetString(payload.query),
    userId: normalizePresetString(payload.userId),
    actor: normalizePresetString(payload.actor),
    actorMode: normalizeAuditMatchMode(payload.actorMode),
    reason: normalizePresetString(payload.reason),
    reference: normalizePresetString(payload.reference),
    referenceMode: normalizeAuditMatchMode(payload.referenceMode),
    status: normalizePresetString(payload.status),
    statusMode: normalizeAuditMatchMode(payload.statusMode),
    dateFrom: normalizePresetString(payload.dateFrom),
    dateTo: normalizePresetString(payload.dateTo),
    sortBy,
    sortOrder: normalizeAuditSortOrder(payload.sortOrder),
    windowMs: normalizeAuditWindowMs(payload.windowMs),
    pageSize: Math.max(
      10,
      Math.min(500, Number.isFinite(Number(payload.pageSize)) ? Math.trunc(Number(payload.pageSize)) : 50),
    ),
  };
}

function mapAuditPresetRow(row, auth = {}) {
  const createdByUser = String(row?.createdByUser || '').trim();
  const updatedByUser = String(row?.updatedByUser || '').trim();
  const visibility = normalizePresetVisibility(row?.visibility);
  const sharedRole = visibility === 'role'
    ? normalizePresetSharedRole(row?.sharedRole, 'mod')
    : '';
  const authUser = String(auth.user || '').trim();
  const authRole = normalizeAdminRole(auth.role);
  const isOwner = Boolean(authUser) && authUser.toLowerCase() === createdByUser.toLowerCase();
  const canView = authRole === 'owner'
    || visibility === 'public'
    || isOwner
    || (visibility === 'role' && hasRoleAtLeast(authRole, sharedRole || 'mod'));
  const canManage = isOwner || authRole === 'owner';
  return {
    id: String(row?.id || ''),
    name: String(row?.name || ''),
    view: normalizeAuditView(row?.view),
    visibility,
    sharedRole,
    query: String(row?.query || ''),
    userId: String(row?.userId || ''),
    actor: String(row?.actor || ''),
    actorMode: normalizeAuditMatchMode(row?.actorMode),
    reason: String(row?.reason || ''),
    reference: String(row?.reference || ''),
    referenceMode: normalizeAuditMatchMode(row?.referenceMode),
    status: String(row?.status || ''),
    statusMode: normalizeAuditMatchMode(row?.statusMode),
    dateFrom: String(row?.dateFrom || ''),
    dateTo: String(row?.dateTo || ''),
    sortBy: String(row?.sortBy || 'timestamp'),
    sortOrder: normalizeAuditSortOrder(row?.sortOrder),
    windowMs: row?.windowMs == null ? null : Math.max(60 * 1000, Number(row.windowMs) || 0),
    pageSize: Math.max(10, Number(row?.pageSize || 50)),
    createdBy: String(row?.createdBy || ''),
    createdByUser,
    updatedBy: String(row?.updatedBy || ''),
    updatedByUser,
    createdAt: row?.createdAt ? new Date(row.createdAt).toISOString() : null,
    updatedAt: row?.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    isOwner,
    canView,
    canEdit: canManage,
    canDelete: canManage,
  };
}

async function ensureAdminAuditPresetSchema(prisma) {
  if (!prisma || typeof prisma.$executeRawUnsafe !== 'function' || typeof prisma.$queryRawUnsafe !== 'function') {
    throw new Error('prisma dependency is required');
  }
  if (ensureAdminAuditPresetSchemaPromise) {
    return ensureAdminAuditPresetSchemaPromise;
  }
  ensureAdminAuditPresetSchemaPromise = (async () => {
    const runtime = resolveDatabaseRuntime();
    if (runtime.engine === 'postgresql') {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "AdminAuditPreset" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "name" TEXT NOT NULL,
          "view" TEXT NOT NULL DEFAULT 'wallet',
          "visibility" TEXT NOT NULL DEFAULT 'public',
          "sharedRole" TEXT,
          "query" TEXT,
          "userId" TEXT,
          "actor" TEXT,
          "actorMode" TEXT NOT NULL DEFAULT 'contains',
          "reason" TEXT,
          "reference" TEXT,
          "referenceMode" TEXT NOT NULL DEFAULT 'contains',
          "status" TEXT,
          "statusMode" TEXT NOT NULL DEFAULT 'contains',
          "dateFrom" TEXT,
          "dateTo" TEXT,
          "sortBy" TEXT NOT NULL DEFAULT 'timestamp',
          "sortOrder" TEXT NOT NULL DEFAULT 'desc',
          "windowMs" INTEGER,
          "pageSize" INTEGER NOT NULL DEFAULT 50,
          "createdBy" TEXT,
          "createdByUser" TEXT,
          "updatedBy" TEXT,
          "updatedByUser" TEXT,
          "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
    } else {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "AdminAuditPreset" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "name" TEXT NOT NULL,
          "view" TEXT NOT NULL DEFAULT 'wallet',
          "visibility" TEXT NOT NULL DEFAULT 'public',
          "sharedRole" TEXT,
          "query" TEXT,
          "userId" TEXT,
          "actor" TEXT,
          "actorMode" TEXT NOT NULL DEFAULT 'contains',
          "reason" TEXT,
          "reference" TEXT,
          "referenceMode" TEXT NOT NULL DEFAULT 'contains',
          "status" TEXT,
          "statusMode" TEXT NOT NULL DEFAULT 'contains',
          "dateFrom" TEXT,
          "dateTo" TEXT,
          "sortBy" TEXT NOT NULL DEFAULT 'timestamp',
          "sortOrder" TEXT NOT NULL DEFAULT 'desc',
          "windowMs" INTEGER,
          "pageSize" INTEGER NOT NULL DEFAULT 50,
          "createdBy" TEXT,
          "createdByUser" TEXT,
          "updatedBy" TEXT,
          "updatedByUser" TEXT,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
    }
    const columns = runtime.engine === 'postgresql'
      ? await prisma.$queryRaw`
        SELECT column_name AS name
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'AdminAuditPreset'
      `
      : await prisma.$queryRawUnsafe(`PRAGMA table_info("AdminAuditPreset")`);
    const columnNames = new Set((Array.isArray(columns) ? columns : []).map((row) => String(row?.name || '')));
    const alterStatements = [];
    if (!columnNames.has('visibility')) {
      alterStatements.push(`ALTER TABLE "AdminAuditPreset" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'public'`);
    }
    if (!columnNames.has('sharedRole')) {
      alterStatements.push(`ALTER TABLE "AdminAuditPreset" ADD COLUMN "sharedRole" TEXT`);
    }
    if (!columnNames.has('createdByUser')) {
      alterStatements.push(`ALTER TABLE "AdminAuditPreset" ADD COLUMN "createdByUser" TEXT`);
    }
    if (!columnNames.has('updatedByUser')) {
      alterStatements.push(`ALTER TABLE "AdminAuditPreset" ADD COLUMN "updatedByUser" TEXT`);
    }
    for (const statement of alterStatements) {
      await prisma.$executeRawUnsafe(statement);
    }
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "AdminAuditPreset_updatedAt_idx" ON "AdminAuditPreset"("updatedAt")`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "AdminAuditPreset_name_idx" ON "AdminAuditPreset"("name")`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "AdminAuditPreset_visibility_idx" ON "AdminAuditPreset"("visibility")`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "AdminAuditPreset_sharedRole_idx" ON "AdminAuditPreset"("sharedRole")`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "AdminAuditPreset_createdByUser_idx" ON "AdminAuditPreset"("createdByUser")`,
    );
  })().catch((error) => {
    ensureAdminAuditPresetSchemaPromise = null;
    throw error;
  });
  return ensureAdminAuditPresetSchemaPromise;
}

async function listAuditPresets(options = {}) {
  const { prisma, authUser = '', authRole = '' } = options;
  if (!prisma || typeof prisma.adminAuditPreset?.findMany !== 'function') {
    throw new Error('prisma dependency is required');
  }
  await ensureAdminAuditPresetSchema(prisma);
  const rows = await prisma.adminAuditPreset.findMany({
    orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
  });
  const auth = { user: authUser, role: authRole };
  return rows
    .map((row) => mapAuditPresetRow(row, auth))
    .filter((row) => {
      if (!String(auth.user || '').trim() && !String(auth.role || '').trim()) return true;
      return row.canView;
    });
}

async function saveAuditPreset(options = {}) {
  const {
    prisma,
    actor = 'unknown',
    payload = {},
    id = null,
    authUser = '',
    authRole = 'mod',
  } = options;
  if (!prisma || typeof prisma.adminAuditPreset?.upsert !== 'function') {
    throw new Error('prisma dependency is required');
  }
  await ensureAdminAuditPresetSchema(prisma);
  const normalized = normalizeAuditPresetPayload(payload, { actorRole: authRole });
  const presetId = String(id || payload.id || crypto.randomUUID()).trim();
  if (!presetId) {
    throw createPresetError('preset id is required', 400);
  }
  const existing = await prisma.adminAuditPreset.findUnique({
    where: { id: presetId },
  });
  if (existing) {
    const existingMapped = mapAuditPresetRow(existing, {
      user: authUser,
      role: authRole,
    });
    if (!existingMapped.canEdit) {
      throw createPresetError('forbidden to edit this preset', 403);
    }
  }
  const resolvedAuthUser = String(authUser || '').trim() || null;
  const row = await prisma.adminAuditPreset.upsert({
    where: { id: presetId },
    update: {
      ...normalized,
      updatedBy: String(actor || 'unknown'),
      updatedByUser: resolvedAuthUser,
    },
    create: {
      id: presetId,
      ...normalized,
      createdBy: String(actor || 'unknown'),
      createdByUser: resolvedAuthUser,
      updatedBy: String(actor || 'unknown'),
      updatedByUser: resolvedAuthUser,
    },
  });
  return mapAuditPresetRow(row, {
    user: authUser,
    role: authRole,
  });
}

async function deleteAuditPreset(options = {}) {
  const {
    prisma,
    id,
    authUser = '',
    authRole = 'mod',
  } = options;
  if (!prisma || typeof prisma.adminAuditPreset?.deleteMany !== 'function') {
    throw new Error('prisma dependency is required');
  }
  await ensureAdminAuditPresetSchema(prisma);
  const presetId = String(id || '').trim();
  if (!presetId) {
    throw createPresetError('preset id is required', 400);
  }
  const existing = await prisma.adminAuditPreset.findUnique({
    where: { id: presetId },
  });
  if (!existing) return false;
  const existingMapped = mapAuditPresetRow(existing, {
    user: authUser,
    role: authRole,
  });
  if (!existingMapped.canDelete) {
    throw createPresetError('forbidden to delete this preset', 403);
  }
  const result = await prisma.adminAuditPreset.deleteMany({
    where: { id: presetId },
  });
  return result.count > 0;
}

module.exports = {
  buildAuditDataset,
  buildAuditExportPayload,
  buildAuditCsv,
  ensureAdminAuditPresetSchema,
  listAuditPresets,
  saveAuditPreset,
  deleteAuditPreset,
};
