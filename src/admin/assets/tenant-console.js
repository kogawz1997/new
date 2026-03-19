(function () {
  'use strict';

  const {
    api,
    connectLiveStream,
    escapeHtml,
    formatDateTime,
    formatNumber,
    makePill,
    renderList,
    renderStats,
    renderTable,
    setBusy,
    showToast,
    wireCommandPalette,
  } = window.ConsoleSurface;

  const state = {
    me: null,
    overview: null,
    reconcile: null,
    quota: null,
    tenantConfig: null,
    dashboardCards: null,
    shopItems: [],
    queueItems: [],
    deadLetters: [],
    players: [],
    notifications: [],
    deliveryRuntime: null,
    purchaseStatusCatalog: { knownStatuses: [], allowedTransitions: [] },
    purchaseLookup: {
      userId: '',
      status: '',
      items: [],
    },
    deliveryLabResult: null,
    audit: null,
    auditFilters: {
      view: 'wallet',
      userId: '',
      query: '',
      windowMs: '604800000',
    },
    liveEvents: [],
  };

  let liveConnection = null;
  let refreshTimer = null;
  let intervalHandle = null;

  function getTenantId() {
    return encodeURIComponent(String(state.me?.tenantId || '').trim());
  }

  async function safeApi(path, fallback) {
    try {
      return await api(path);
    } catch {
      return fallback;
    }
  }

  function listFromPayload(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.items)) return payload.items;
    if (Array.isArray(payload?.data)) return payload.data;
    return [];
  }

  function stringifyJson(value) {
    if (!value || (typeof value === 'object' && Object.keys(value).length === 0)) {
      return '';
    }
    return `${JSON.stringify(value, null, 2)}\n`;
  }

  function buildAuditQueryString(filters = {}, extra = {}) {
    const params = new URLSearchParams();
    const merged = { ...filters, ...extra };
    Object.entries(merged).forEach(([key, value]) => {
      const normalized = String(value ?? '').trim();
      if (!normalized) return;
      params.set(key, normalized);
    });
    return params.toString();
  }

  function formatAuditCell(key, value) {
    if (value == null || value === '') return '-';
    if (Array.isArray(value)) return value.join(', ') || '-';
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }
    if (/(?:At|time|date)$/i.test(String(key || ''))) {
      return formatDateTime(value);
    }
    return String(value);
  }

  function setBanner(title, detail, tags, tone) {
    const banner = document.getElementById('tenantStatusBanner');
    const tagWrap = document.getElementById('tenantStatusTags');
    document.getElementById('tenantStatusTitle').textContent = title;
    document.getElementById('tenantStatusDetail').textContent = detail;
    banner.className = `status-banner banner-${tone || 'info'}`;
    tagWrap.innerHTML = (Array.isArray(tags) ? tags : []).map((tag) => makePill(tag)).join('');
  }

  function fillConfigForm() {
    const form = document.getElementById('tenantConfigForm');
    if (!form) return;
    form.elements.featureFlags.value = stringifyJson(state.tenantConfig?.featureFlags);
    form.elements.configPatch.value = stringifyJson(state.tenantConfig?.configPatch);
    form.elements.portalEnvPatch.value = stringifyJson(state.tenantConfig?.portalEnvPatch);
  }

  function renderOverview() {
    const analytics = state.overview?.analytics || {};
    const delivery = analytics.delivery || {};
    const quota = state.quota?.quotas || {};
    renderStats(document.getElementById('tenantOverviewStats'), [
      {
        kicker: 'Tenant',
        value: state.tenantConfig?.name || state.me?.tenantId || '-',
        title: 'Scoped tenant identity',
        detail: 'Every action on this surface stays bound to the signed-in tenant scope.',
        tags: [
          `role ${state.me?.role || '-'}`,
          state.me?.tenantId || 'tenant scoped',
        ],
      },
      {
        kicker: 'Commerce',
        value: formatNumber(state.dashboardCards?.metrics?.purchaseCount, formatNumber(delivery.purchaseCount30d, '0')),
        title: 'Visible purchase workload',
        detail: 'Recent tenant purchase and delivery pressure.',
        tags: [
          `queue ${formatNumber(state.queueItems.length, '0')}`,
          `dead ${formatNumber(state.deadLetters.length, '0')}`,
          `success ${formatNumber(delivery.successRate, '0')}%`,
        ],
      },
      {
        kicker: 'Players',
        value: formatNumber(state.players.length, '0'),
        title: 'Known player accounts',
        detail: 'Use for support, Steam-link follow-up, and transaction tracing.',
        tags: [
          `catalog ${formatNumber(state.shopItems.length, '0')}`,
          `alerts ${formatNumber(state.notifications.length, '0')}`,
        ],
      },
      {
        kicker: 'Quota',
        value: quota?.apiKeys ? `${formatNumber(quota.apiKeys.used, '0')}/${formatNumber(quota.apiKeys.limit, 'unlimited')}` : '-',
        title: 'Tenant quota posture',
        detail: 'API keys, webhooks, runtimes, and related scoped platform allowances.',
        tags: [
          quota?.webhooks ? `hooks ${formatNumber(quota.webhooks.used, '0')}/${formatNumber(quota.webhooks.limit, 'unlimited')}` : 'hooks -',
          quota?.agentRuntimes ? `runtimes ${formatNumber(quota.agentRuntimes.used, '0')}/${formatNumber(quota.agentRuntimes.limit, 'unlimited')}` : 'runtimes -',
        ],
      },
    ]);
  }

  function renderInsights() {
    const reconcile = state.reconcile || {};
    const summary = reconcile.summary || {};
    const analytics = state.overview?.analytics || {};
    const delivery = analytics.delivery || {};

    renderStats(document.getElementById('tenantInsightStats'), [
      {
        kicker: 'Reconcile',
        value: formatNumber(summary.anomalies, '0'),
        title: 'Active anomalies',
        detail: 'Tenant-only reconcile findings for purchase, queue, dead-letter, and audit posture.',
        tags: [
          `abuse ${formatNumber(summary.abuseFindings, '0')}`,
          `queue ${formatNumber(summary.queueJobs, '0')}`,
        ],
      },
      {
        kicker: 'Delivery',
        value: `${formatNumber(delivery.successRate, '0')}%`,
        title: 'Recent delivery success',
        detail: 'Tenant analytics success signal across scoped purchases.',
        tags: [
          `30d ${formatNumber(delivery.purchaseCount30d, '0')} purchases`,
          `dead ${formatNumber(summary.deadLetters, '0')}`,
        ],
      },
      {
        kicker: 'Quota',
        value: state.quota?.quotas?.webhooks
          ? `${formatNumber(state.quota.quotas.webhooks.used, '0')}/${formatNumber(state.quota.quotas.webhooks.limit, 'unlimited')}`
          : '-',
        title: 'Webhook quota posture',
        detail: 'Useful when integrations, alerts, or external feeds are nearing tenant allowance.',
      },
      {
        kicker: 'Window',
        value: summary.windowMs ? `${formatNumber(Math.round(Number(summary.windowMs || 0) / 60000), '0')}m` : '-',
        title: 'Current reconcile window',
        detail: 'Scoped abuse heuristics and anomaly grouping are window-bound.',
      },
    ]);

    const findingRows = [
      ...(Array.isArray(reconcile.anomalies) ? reconcile.anomalies : []).map((item) => ({
        tone: item.severity === 'error' ? 'danger' : 'warning',
        title: item.type || 'anomaly',
        detail: `${item.code || '-'} | ${item.detail || ''}`.trim(),
        at: reconcile.generatedAt,
      })),
      ...(Array.isArray(reconcile.abuseFindings) ? reconcile.abuseFindings : []).map((item) => ({
        tone: 'warning',
        title: item.type || 'abuse-finding',
        detail: `${item.userId || item.itemId || '-'} | count=${item.count || '-'} threshold=${item.threshold || '-'}`,
        at: reconcile.generatedAt,
      })),
    ].slice(0, 12);

    renderList(
      document.getElementById('tenantReconcileFeed'),
      findingRows,
      (item) => [
        `<article class="timeline-item ${escapeHtml(item.tone || 'info')}">`,
        `<div class="feed-meta">${makePill(item.title || 'finding')} <span class="code">${escapeHtml(formatDateTime(item.at))}</span></div>`,
        `<strong>${escapeHtml(item.title || 'Finding')}</strong>`,
        item.detail ? `<div class="muted">${escapeHtml(item.detail)}</div>` : '',
        '</article>',
      ].join(''),
      'No reconcile anomalies or abuse signals for this tenant right now.'
    );

    document.getElementById('tenantInsightCards').innerHTML = [
      {
        title: 'Queue Health',
        text: `Queue jobs: ${formatNumber(summary.queueJobs, '0')}. Dead letters: ${formatNumber(summary.deadLetters, '0')}. Use Delivery Recovery for direct intervention.`,
      },
      {
        title: 'Audit Posture',
        text: `Delivered-without-audit and stuck-without-runtime-state are treated as tenant attention items so operators can react before players escalate.`,
      },
      {
        title: 'Quota Context',
        text: `API key, webhook, and agent-runtime quota posture stays visible on this surface without exposing platform-wide tenancy data.`,
      },
    ].map((card) => [
      '<article class="kv-card">',
      `<h3>${escapeHtml(card.title)}</h3>`,
      `<p>${escapeHtml(card.text)}</p>`,
      '</article>',
    ].join('')).join('');
  }

  function renderTables() {
    renderTable(document.getElementById('tenantShopTable'), {
      emptyText: 'No shop items in this tenant.',
      columns: [
        {
          label: 'Item',
          render: (row) => [
            `<strong>${escapeHtml(row.name || row.id || '-')}</strong>`,
            `<div class="muted code">${escapeHtml(row.id || '-')}</div>`,
          ].join(''),
        },
        {
          label: 'Kind',
          render: (row) => makePill(row.kind || 'item', row.kind === 'vip' ? 'info' : 'neutral'),
        },
        {
          label: 'Price',
          render: (row) => formatNumber(row.price, '0'),
        },
        {
          label: 'Delivery',
          render: (row) => escapeHtml(row.deliveryProfile || row.gameItemId || '-'),
        },
      ],
      rows: state.shopItems.slice(0, 24),
    });

    renderTable(document.getElementById('tenantQueueTable'), {
      emptyText: 'Delivery queue is empty.',
      columns: [
        {
          label: 'Purchase',
          render: (row) => [
            `<strong class="code">${escapeHtml(row.purchaseCode || row.code || '-')}</strong>`,
            row.userId ? `<div class="muted">${escapeHtml(row.userId)}</div>` : '',
          ].join(''),
        },
        {
          label: 'Status',
          render: (row) => makePill(row.status || 'queued'),
        },
        {
          label: 'Attempts',
          render: (row) => formatNumber(row.attempts, '0'),
        },
        {
          label: 'Updated',
          render: (row) => `<span class="code">${escapeHtml(formatDateTime(row.updatedAt || row.createdAt))}</span>`,
        },
      ],
      rows: state.queueItems.slice(0, 20),
    });

    renderTable(document.getElementById('tenantDeadLetterTable'), {
      emptyText: 'No dead-letter entries.',
      columns: [
        {
          label: 'Purchase',
          render: (row) => `<strong class="code">${escapeHtml(row.purchaseCode || row.code || '-')}</strong>`,
        },
        {
          label: 'Reason',
          render: (row) => escapeHtml(row.reason || row.errorCode || '-'),
        },
        {
          label: 'Attempts',
          render: (row) => formatNumber(row.attempts, '0'),
        },
        {
          label: 'Updated',
          render: (row) => `<span class="code">${escapeHtml(formatDateTime(row.updatedAt || row.createdAt))}</span>`,
        },
      ],
      rows: state.deadLetters.slice(0, 20),
    });

    renderTable(document.getElementById('tenantPlayersTable'), {
      emptyText: 'No player accounts found.',
      columns: [
        {
          label: 'Player',
          render: (row) => [
            `<strong>${escapeHtml(row.displayName || row.username || row.user || row.discordId || '-')}</strong>`,
            `<div class="muted code">${escapeHtml(row.discordId || row.userId || '-')}</div>`,
          ].join(''),
        },
        {
          label: 'Steam',
          render: (row) => escapeHtml(row.steamId || row.inGameName || '-'),
        },
        {
          label: 'Status',
          render: (row) => makePill(row.isActive === false ? 'inactive' : 'active'),
        },
        {
          label: 'Updated',
          render: (row) => `<span class="code">${escapeHtml(formatDateTime(row.updatedAt || row.createdAt))}</span>`,
        },
      ],
      rows: state.players.slice(0, 20),
    });
  }

  function renderPurchaseStatusOptions() {
    const knownStatuses = Array.isArray(state.purchaseStatusCatalog?.knownStatuses)
      ? state.purchaseStatusCatalog.knownStatuses
      : [];
    const filterSelect = document.getElementById('tenantPurchaseFilterStatus');
    const targetSelect = document.getElementById('tenantPurchaseTargetStatus');
    if (filterSelect) {
      const current = String(filterSelect.value || state.purchaseLookup.status || '').trim();
      filterSelect.innerHTML = [
        '<option value="">All statuses</option>',
        ...knownStatuses.map((status) => {
          const normalized = String(status || '').trim();
          const selected = normalized && normalized === current ? ' selected' : '';
          return `<option value="${escapeHtml(normalized)}"${selected}>${escapeHtml(normalized)}</option>`;
        }),
      ].join('');
      if (current) filterSelect.value = current;
    }
    if (targetSelect) {
      const current = String(targetSelect.value || '').trim();
      targetSelect.innerHTML = [
        '<option value="">Choose a status</option>',
        ...knownStatuses.map((status) => {
          const normalized = String(status || '').trim();
          const selected = normalized && normalized === current ? ' selected' : '';
          return `<option value="${escapeHtml(normalized)}"${selected}>${escapeHtml(normalized)}</option>`;
        }),
      ].join('');
      if (current) targetSelect.value = current;
    }
  }

  function renderPurchaseInspector() {
    renderPurchaseStatusOptions();
    const lookupForm = document.getElementById('tenantPurchaseLookupForm');
    if (lookupForm) {
      lookupForm.elements.userId.value = state.purchaseLookup.userId || '';
      lookupForm.elements.status.value = state.purchaseLookup.status || '';
    }
    renderTable(document.getElementById('tenantPurchaseTable'), {
      emptyText: state.purchaseLookup.userId
        ? 'No purchases found for this player and filter.'
        : 'Load purchases for a player to review transaction state.',
      columns: [
        {
          label: 'Purchase',
          render: (row) => [
            `<strong class="code">${escapeHtml(row.code || row.purchaseCode || '-')}</strong>`,
            `<div class="muted">${escapeHtml(row.itemName || row.itemId || row.productName || '-')}</div>`,
          ].join(''),
        },
        {
          label: 'Status',
          render: (row) => makePill(row.statusText || row.status || 'unknown'),
        },
        {
          label: 'Player',
          render: (row) => [
            `<div>${escapeHtml(row.userId || row.discordId || state.purchaseLookup.userId || '-')}</div>`,
            row.username ? `<div class="muted">${escapeHtml(row.username)}</div>` : '',
          ].join(''),
        },
        {
          label: 'Amount',
          render: (row) => escapeHtml(formatNumber(row.totalPrice || row.price || row.amount, '-')),
        },
        {
          label: 'Created',
          render: (row) => `<span class="code">${escapeHtml(formatDateTime(row.createdAt || row.updatedAt))}</span>`,
        },
      ],
      rows: Array.isArray(state.purchaseLookup.items) ? state.purchaseLookup.items : [],
    });
  }

  function renderNotifications() {
    renderList(
      document.getElementById('tenantNotificationFeed'),
      state.notifications,
      (item) => [
        '<article class="feed-item">',
        `<div class="feed-meta">${makePill(item.severity || 'info')} ${item.type ? `<span class="code">${escapeHtml(item.type)}</span>` : ''}</div>`,
        `<strong>${escapeHtml(item.title || item.detail || item.message || 'Notification')}</strong>`,
        item.detail ? `<div class="muted">${escapeHtml(item.detail)}</div>` : '',
        `<div class="feed-meta"><span>${escapeHtml(formatDateTime(item.createdAt || item.at))}</span></div>`,
        '</article>',
      ].join(''),
      'No active notifications for this tenant.'
    );
  }

  function renderDeliveryLab() {
    const result = state.deliveryLabResult;
    const raw = document.getElementById('tenantDeliveryLabRaw');
    if (!result) {
      renderStats(document.getElementById('tenantDeliveryLabStats'), []);
      renderList(
        document.getElementById('tenantDeliveryLabFeed'),
        [],
        () => '',
        'Run a preview, preflight, simulate, or test-send request to inspect delivery behavior.'
      );
      if (raw) {
        raw.textContent = 'Run a lab action to inspect checks, timeline, and raw payload.';
      }
      return;
    }

    const data = result.data || {};
    const checks = Array.isArray(data.checks) ? data.checks : [];
    const warnings = Array.isArray(data.warnings) ? data.warnings : [];
    const timeline = Array.isArray(data.timeline) ? data.timeline : [];
    const commands = Array.isArray(data.commands) ? data.commands : [];
    const outputs = Array.isArray(data.outputs) ? data.outputs : [];
    const feedItems = [
      ...checks.map((item) => ({
        title: item.label || item.id || 'check',
        detail: item.detail || item.reason || '',
        tone: item.ok === false ? 'danger' : item.ready === false ? 'warning' : 'success',
        tag: 'check',
      })),
      ...warnings.map((item) => ({
        title: 'warning',
        detail: String(item || ''),
        tone: 'warning',
        tag: 'warning',
      })),
      ...timeline.map((item) => ({
        title: item.label || item.step || item.type || 'timeline',
        detail: item.detail || item.message || item.status || '',
        tone: String(item.status || '').toLowerCase() === 'failed' ? 'danger' : 'info',
        tag: 'timeline',
      })),
    ].slice(0, 12);

    renderStats(document.getElementById('tenantDeliveryLabStats'), [
      {
        kicker: 'Action',
        value: result.action || '-',
        title: 'Lab mode',
        detail: result.action === 'test-send'
          ? 'Live command execution path.'
          : 'Safe validation path.',
      },
      {
        kicker: 'Checks',
        value: formatNumber(checks.length, '0'),
        title: 'Preflight / validation checks',
        detail: 'Present for preflight and similar report-like responses.',
      },
      {
        kicker: 'Commands',
        value: formatNumber(commands.length || outputs.length, '0'),
        title: 'Commands or outputs',
        detail: 'Preview returns commands, test-send returns outputs.',
      },
      {
        kicker: 'Warnings',
        value: formatNumber(warnings.length, '0'),
        title: 'Warnings',
        detail: timeline.length > 0
          ? `${formatNumber(timeline.length, '0')} timeline entries`
          : 'No timeline returned.',
      },
    ]);

    renderList(
      document.getElementById('tenantDeliveryLabFeed'),
      feedItems,
      (item) => [
        `<article class="timeline-item ${escapeHtml(item.tone || 'info')}">`,
        `<div class="feed-meta">${makePill(item.tag || 'detail')} ${item.tone ? makePill(item.tone) : ''}</div>`,
        `<strong>${escapeHtml(item.title || 'Result')}</strong>`,
        item.detail ? `<div class="muted">${escapeHtml(item.detail)}</div>` : '',
        '</article>',
      ].join(''),
      'No structured checks, warnings, or timeline entries were returned.'
    );

    if (raw) {
      raw.textContent = JSON.stringify(data, null, 2);
    }
  }

  function renderAudit() {
    const dataset = state.audit || {};
    const filters = state.auditFilters || {};
    const form = document.getElementById('tenantAuditQueryForm');
    if (form) {
      form.elements.view.value = filters.view || 'wallet';
      form.elements.userId.value = filters.userId || '';
      form.elements.query.value = filters.query || '';
      form.elements.windowMs.value = filters.windowMs == null ? '' : String(filters.windowMs);
    }

    renderStats(
      document.getElementById('tenantAuditStats'),
      (Array.isArray(dataset.cards) ? dataset.cards : []).map(([label, value]) => ({
        kicker: String(dataset.view || 'audit').toUpperCase(),
        value: String(value ?? '-'),
        title: String(label || 'Audit summary'),
        detail: `Returned ${formatNumber(dataset.returned, '0')} of ${formatNumber(dataset.total, '0')} rows.`,
      }))
    );

    const rows = Array.isArray(dataset.tableRows) ? dataset.tableRows : [];
    const keys = rows.length > 0 ? Object.keys(rows[0]).slice(0, 6) : [];
    renderTable(
      document.getElementById('tenantAuditTable'),
      keys.map((key) => ({
        label: key,
        render: (row) => `<span class="${/(?:id|code|reference)/i.test(key) ? 'code' : ''}">${escapeHtml(formatAuditCell(key, row?.[key]))}</span>`,
      })),
      rows,
      'No audit rows matched the current tenant-scoped filters.'
    );
  }

  function renderPresets() {
    document.getElementById('tenantPresetCards').innerHTML = [
      {
        title: 'Catalog + Economy',
        text: 'Use the detailed legacy workspace for large catalog edits, price tuning, and scoped economy operations.',
        action: '<a class="ghost-link" href="/admin/legacy?tab=economy">Open economy tools</a>',
      },
      {
        title: 'Delivery Capability Presets',
        text: 'Delivery capability presets, command catalogs, and runtime overrides remain available in the delivery workbench.',
        action: '<a class="ghost-link" href="/admin/legacy?tab=delivery">Open delivery tools</a>',
      },
      {
        title: 'Player Support',
        text: 'Use deeper player tools for manual investigation, account review, and support workflows.',
        action: '<a class="ghost-link" href="/admin/legacy?tab=players">Open player tools</a>',
      },
    ].map((card) => [
      '<article class="panel-card">',
      `<h3>${escapeHtml(card.title)}</h3>`,
      `<p>${escapeHtml(card.text)}</p>`,
      card.action,
      '</article>',
    ].join('')).join('');
  }

  function buildActivityItems() {
    const queued = state.queueItems.slice(0, 4).map((item) => ({
      tone: 'warning',
      type: 'queue',
      title: item.purchaseCode || item.code || 'Queue job',
      detail: item.status || 'queued',
      at: item.updatedAt || item.createdAt,
    }));
    const dead = state.deadLetters.slice(0, 4).map((item) => ({
      tone: 'danger',
      type: 'dead-letter',
      title: item.purchaseCode || item.code || 'Dead letter',
      detail: item.reason || item.errorCode || '',
      at: item.updatedAt || item.createdAt,
    }));
    const alerts = state.notifications.slice(0, 4).map((item) => ({
      tone: item.severity === 'error' ? 'danger' : item.severity || 'warning',
      type: item.type || 'alert',
      title: item.title || item.detail || 'Tenant alert',
      detail: item.detail || item.message || '',
      at: item.createdAt || item.at,
    }));

    return [...state.liveEvents, ...alerts, ...dead, ...queued]
      .sort((left, right) => new Date(right.at || 0).getTime() - new Date(left.at || 0).getTime())
      .slice(0, 14);
  }

  function renderActivity() {
    renderList(
      document.getElementById('tenantActivityFeed'),
      buildActivityItems(),
      (item) => [
        `<article class="timeline-item ${escapeHtml(item.tone || 'info')}">`,
        `<div class="feed-meta">${makePill(item.type || 'event')} <span class="code">${escapeHtml(formatDateTime(item.at))}</span></div>`,
        `<strong>${escapeHtml(item.title || 'Activity')}</strong>`,
        item.detail ? `<div class="muted">${escapeHtml(item.detail)}</div>` : '',
        '</article>',
      ].join(''),
      'Waiting for tenant activity.'
    );
  }

  function renderAll() {
    const queueDepth = state.queueItems.length;
    const deadCount = state.deadLetters.length;
    const runtimeStatus = String(state.deliveryRuntime?.mode || state.deliveryRuntime?.status || 'ready');
    document.getElementById('tenantScopeText').textContent =
      `Tenant ID: ${state.me?.tenantId || '-'} | role: ${state.me?.role || '-'} | user: ${state.me?.user || '-'}`;
    setBanner(
      state.tenantConfig?.name || `Tenant ${state.me?.tenantId || ''}`,
      'Tenant-facing operations stay isolated from owner-only platform controls and recovery workflows.',
      [
        `queue ${formatNumber(queueDepth, '0')}`,
        `dead ${formatNumber(deadCount, '0')}`,
        `anomalies ${formatNumber(state.reconcile?.summary?.anomalies, '0')}`,
        `delivery ${runtimeStatus}`,
      ],
      queueDepth > 0 || deadCount > 0 || Number(state.reconcile?.summary?.anomalies || 0) > 0 ? 'warning' : 'success'
    );
    fillConfigForm();
    renderOverview();
    renderInsights();
    renderTables();
    renderNotifications();
    renderDeliveryLab();
    renderPresets();
    renderActivity();
    renderPurchaseInspector();
    renderAudit();
  }

  function scheduleRefresh(delayMs = 1200) {
    if (refreshTimer) {
      window.clearTimeout(refreshTimer);
    }
    refreshTimer = window.setTimeout(() => {
      refreshTimer = null;
      refreshSurface({ silent: true });
    }, delayMs);
  }

  function pushLiveEvent(type, payload) {
    const title = payload?.payload?.summary
      || payload?.payload?.detail
      || payload?.payload?.message
      || payload?.payload?.type
      || type;
    const detail = payload?.payload?.reason
      || payload?.payload?.status
      || payload?.payload?.code
      || '';
    state.liveEvents.unshift({
      type,
      title,
      detail,
      tone: type.includes('dead-letter')
        ? 'danger'
        : type.includes('delivery') || type.includes('ops-alert') || type.includes('restart')
          ? 'warning'
          : type === 'connected'
            ? 'success'
            : 'info',
      at: payload?.at || new Date().toISOString(),
    });
    state.liveEvents = state.liveEvents.slice(0, 20);
    renderActivity();
  }

  function connectLive() {
    if (liveConnection) return;
    liveConnection = connectLiveStream({
      events: [
        'connected',
        'heartbeat',
        'delivery-queue',
        'delivery-dead-letter',
        'ops-alert',
        'platform-event',
        'admin-action',
      ],
      onEvent(type, payload) {
        pushLiveEvent(type, payload);
        if (type !== 'heartbeat') {
          scheduleRefresh(900);
        }
      },
      onOpen() {
        pushLiveEvent('connected', {
          at: new Date().toISOString(),
          payload: { summary: 'Tenant live stream connected' },
        });
      },
      onError() {
        pushLiveEvent('ops-alert', {
          at: new Date().toISOString(),
          payload: { summary: 'Live stream interrupted, falling back to refresh.' },
        });
      },
    });
  }

  async function refreshSurface(options = {}) {
    const refreshButton = document.getElementById('tenantRefreshBtn');
    if (!options.silent) {
      setBusy(refreshButton, true, 'Refreshing...');
    }
    try {
      const me = await api('/admin/api/me');
      if (!me?.tenantId) {
        window.location.href = '/owner';
        return;
      }
      state.me = me;
      const tenantId = getTenantId();
      const [
        overview,
        reconcile,
        quota,
        tenantConfig,
        dashboardCards,
        shopItems,
        queueItems,
        deadLetters,
        players,
        notifications,
        deliveryRuntime,
        purchaseStatusCatalog,
        audit,
      ] = await Promise.all([
        safeApi(`/admin/api/platform/overview?tenantId=${tenantId}`, {}),
        safeApi(`/admin/api/platform/reconcile?tenantId=${tenantId}&windowMs=3600000&pendingOverdueMs=1200000`, {}),
        safeApi(`/admin/api/platform/quota?tenantId=${tenantId}`, {}),
        safeApi(`/admin/api/platform/tenant-config?tenantId=${tenantId}`, {}),
        safeApi(`/admin/api/dashboard/cards?tenantId=${tenantId}`, null),
        safeApi(`/admin/api/shop/list?tenantId=${tenantId}&limit=24`, { items: [] }),
        safeApi(`/admin/api/delivery/queue?tenantId=${tenantId}&limit=20`, { items: [] }),
        safeApi(`/admin/api/delivery/dead-letter?tenantId=${tenantId}&limit=20`, { items: [] }),
        safeApi(`/admin/api/player/accounts?tenantId=${tenantId}&limit=20`, { items: [] }),
        safeApi('/admin/api/notifications?acknowledged=false&limit=10', { items: [] }),
        safeApi('/admin/api/delivery/runtime', {}),
        safeApi('/admin/api/purchase/statuses', { knownStatuses: [], allowedTransitions: [] }),
        safeApi(`/admin/api/audit/query?${buildAuditQueryString({
          tenantId: state.me?.tenantId || me?.tenantId || '',
          view: state.auditFilters.view,
          userId: state.auditFilters.userId,
          q: state.auditFilters.query,
          windowMs: state.auditFilters.windowMs,
          pageSize: 8,
        })}`, { cards: [], tableRows: [] }),
      ]);

      state.overview = overview || {};
      state.reconcile = reconcile || {};
      state.quota = quota || {};
      state.tenantConfig = tenantConfig || me.tenantConfig || {};
      state.dashboardCards = dashboardCards;
      state.shopItems = listFromPayload(shopItems);
      state.queueItems = listFromPayload(queueItems);
      state.deadLetters = listFromPayload(deadLetters);
      state.players = listFromPayload(players);
      state.notifications = listFromPayload(notifications);
      state.deliveryRuntime = deliveryRuntime || {};
      state.purchaseStatusCatalog = purchaseStatusCatalog || { knownStatuses: [], allowedTransitions: [] };
      state.audit = audit || { cards: [], tableRows: [] };
      renderAll();
      connectLive();
    } catch (error) {
      setBanner(
        'Tenant console failed to load',
        String(error.message || error),
        ['retry available'],
        'danger'
      );
    } finally {
      if (!options.silent) {
        setBusy(refreshButton, false);
      }
    }
  }

  function parseOptionalJson(raw, fieldLabel) {
    const text = String(raw || '').trim();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`${fieldLabel} must be valid JSON`);
    }
  }

  async function handleTenantConfigSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    try {
      const featureFlags = parseOptionalJson(form.elements.featureFlags.value, 'Feature Flags');
      const configPatch = parseOptionalJson(form.elements.configPatch.value, 'Config Patch');
      const portalEnvPatch = parseOptionalJson(form.elements.portalEnvPatch.value, 'Portal Env Patch');
      if (!featureFlags && !configPatch && !portalEnvPatch) {
        throw new Error('Provide at least one JSON patch before saving');
      }
      if (!window.confirm('Save tenant configuration changes for this tenant?')) {
        return;
      }
      setBusy(button, true, 'Saving...');
      await api('/admin/api/platform/tenant-config', {
        method: 'POST',
        body: {
          tenantId: state.me.tenantId,
          featureFlags,
          configPatch,
          portalEnvPatch,
        },
      });
      showToast('Tenant configuration saved.', 'success');
      await refreshSurface();
    } catch (error) {
      setBanner('Tenant config update failed', String(error.message || error), ['config'], 'danger');
    } finally {
      setBusy(button, false);
    }
  }

  async function handleWalletSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const action = String(form.elements.action.value || '').trim();
    const userId = String(form.elements.userId.value || '').trim();
    const amount = Number(form.elements.amount.value);
    if (!userId || !Number.isFinite(amount)) {
      setBanner('Wallet action is incomplete', 'Provide a Discord user ID and a numeric amount.', ['wallet'], 'danger');
      return;
    }
    const endpoint = action === 'set'
      ? '/admin/api/wallet/set'
      : action === 'remove'
        ? '/admin/api/wallet/remove'
        : '/admin/api/wallet/add';
    if (!window.confirm(`Confirm ${action} for user ${userId}?`)) return;
    const button = form.querySelector('button[type="submit"]');
    try {
      setBusy(button, true, 'Applying...');
      await api(endpoint, {
        method: 'POST',
        body: action === 'set'
          ? { userId, balance: Math.trunc(amount) }
          : { userId, amount: Math.trunc(amount) },
      });
      form.reset();
      showToast('Wallet action applied.', 'success');
      await refreshSurface();
    } catch (error) {
      setBanner('Wallet action failed', String(error.message || error), ['wallet'], 'danger');
    } finally {
      setBusy(button, false);
    }
  }

  async function handleDeliverySubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const code = String(form.elements.code.value || '').trim();
    const action = String(form.elements.action.value || '').trim();
    if (!code) {
      setBanner('Delivery action is incomplete', 'Provide a purchase code before running a recovery action.', ['delivery'], 'danger');
      return;
    }
    const endpoint = action === 'dead-letter-retry'
      ? '/admin/api/delivery/dead-letter/retry'
      : action === 'cancel'
        ? '/admin/api/delivery/cancel'
        : '/admin/api/delivery/retry';
    if (!window.confirm(`Run ${action} for ${code}?`)) return;
    const button = form.querySelector('button[type="submit"]');
    try {
      setBusy(button, true, 'Running...');
      await api(endpoint, {
        method: 'POST',
        body: { code },
      });
      form.reset();
      showToast('Delivery recovery action completed.', 'success');
      await refreshSurface();
    } catch (error) {
      setBanner('Delivery action failed', String(error.message || error), ['delivery'], 'danger');
    } finally {
      setBusy(button, false);
    }
  }

  async function handleShopCreateSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const kind = String(form.elements.kind.value || 'item').trim();
    const payload = {
      tenantId: state.me?.tenantId,
      kind,
      id: String(form.elements.id.value || '').trim(),
      name: String(form.elements.name.value || '').trim(),
      price: Math.trunc(Number(form.elements.price.value || 0)),
      description: String(form.elements.description.value || '').trim(),
      gameItemId: String(form.elements.gameItemId.value || '').trim(),
      quantity: Math.max(1, Math.trunc(Number(form.elements.quantity.value || 1) || 1)),
      iconUrl: String(form.elements.iconUrl.value || '').trim(),
    };
    if (!payload.id || !payload.name || !Number.isFinite(payload.price)) {
      setBanner('Catalog entry is incomplete', 'Provide kind, item ID, display name, and a numeric price before saving.', ['catalog'], 'danger');
      return;
    }
    if (kind === 'item' && !payload.gameItemId) {
      setBanner('Game Item ID required', 'Item catalog entries need a SCUM game item id so delivery can be resolved.', ['catalog'], 'danger');
      return;
    }
    if (!window.confirm(`Add catalog entry ${payload.id}?`)) return;
    try {
      setBusy(button, true, 'Saving...');
      await api('/admin/api/shop/add', {
        method: 'POST',
        body: payload,
      });
      form.reset();
      form.elements.kind.value = 'item';
      form.elements.quantity.value = '1';
      showToast('Catalog entry created.', 'success');
      await refreshSurface();
    } catch (error) {
      setBanner('Catalog create failed', String(error.message || error), ['catalog'], 'danger');
    } finally {
      setBusy(button, false);
    }
  }

  async function handleShopPriceSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const idOrName = String(form.elements.idOrName.value || '').trim();
    const price = Math.trunc(Number(form.elements.price.value || 0));
    if (!idOrName || !Number.isFinite(price)) {
      setBanner('Price update is incomplete', 'Provide a catalog id/name and a numeric price.', ['catalog'], 'danger');
      return;
    }
    if (!window.confirm(`Update price for ${idOrName}?`)) return;
    try {
      setBusy(button, true, 'Updating...');
      await api('/admin/api/shop/price', {
        method: 'POST',
        body: {
          tenantId: state.me?.tenantId,
          idOrName,
          price,
        },
      });
      form.reset();
      showToast('Catalog price updated.', 'success');
      await refreshSurface();
    } catch (error) {
      setBanner('Price update failed', String(error.message || error), ['catalog'], 'danger');
    } finally {
      setBusy(button, false);
    }
  }

  async function handleShopDeleteSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const idOrName = String(form.elements.idOrName.value || '').trim();
    if (!idOrName) {
      setBanner('Delete target missing', 'Provide the catalog id or name to remove.', ['catalog'], 'danger');
      return;
    }
    if (!window.confirm(`Delete catalog entry ${idOrName}?`)) return;
    try {
      setBusy(button, true, 'Deleting...');
      await api('/admin/api/shop/delete', {
        method: 'POST',
        body: {
          tenantId: state.me?.tenantId,
          idOrName,
        },
      });
      form.reset();
      showToast('Catalog entry removed.', 'success');
      await refreshSurface();
    } catch (error) {
      setBanner('Catalog delete failed', String(error.message || error), ['catalog'], 'danger');
    } finally {
      setBusy(button, false);
    }
  }

  async function loadPurchases(userId, status, options = {}) {
    const { button = null, showSuccess = false } = options;
    if (!userId) {
      setBanner('Purchase lookup is incomplete', 'Provide a Discord user ID before loading purchase history.', ['purchase'], 'danger');
      return false;
    }
    try {
      if (button) {
        setBusy(button, true, 'Loading...');
      }
      const tenantId = getTenantId();
      const encodedUser = encodeURIComponent(userId);
      const encodedStatus = status ? `&status=${encodeURIComponent(status)}` : '';
      const purchases = await api(`/admin/api/purchase/list?tenantId=${tenantId}&userId=${encodedUser}&limit=20${encodedStatus}`);
      state.purchaseLookup = {
        userId,
        status,
        items: listFromPayload(purchases),
      };
      renderPurchaseInspector();
      if (showSuccess) {
        showToast('Purchase list loaded.', 'success');
      }
      return true;
    } catch (error) {
      state.purchaseLookup = { userId, status, items: [] };
      renderPurchaseInspector();
      setBanner('Purchase lookup failed', String(error.message || error), ['purchase'], 'danger');
      return false;
    } finally {
      if (button) {
        setBusy(button, false);
      }
    }
  }

  async function handlePurchaseLookupSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const userId = String(form.elements.userId.value || '').trim();
    const status = String(form.elements.status.value || '').trim();
    await loadPurchases(userId, status, { button, showSuccess: true });
  }

  async function handlePurchaseStatusSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const code = String(form.elements.code.value || '').trim();
    const status = String(form.elements.status.value || '').trim();
    const reason = String(form.elements.reason.value || '').trim() || 'tenant-console-manual-update';
    if (!code || !status) {
      setBanner('Status update is incomplete', 'Provide both purchase code and target status before applying a change.', ['purchase'], 'danger');
      return;
    }
    if (!window.confirm(`Set ${code} to ${status}?`)) return;
    try {
      setBusy(button, true, 'Applying...');
      await api('/admin/api/purchase/status', {
        method: 'POST',
        body: {
          tenantId: state.me?.tenantId,
          code,
          status,
          reason,
        },
      });
      showToast('Purchase status updated.', 'success');
      if (state.purchaseLookup.userId) {
        await loadPurchases(state.purchaseLookup.userId, state.purchaseLookup.status || '', { showSuccess: false });
      } else {
        await refreshSurface();
      }
    } catch (error) {
      setBanner('Status update failed', String(error.message || error), ['purchase'], 'danger');
    } finally {
      setBusy(button, false);
    }
  }

  async function handleSteamLinkSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const action = String(form.elements.action.value || 'set').trim();
    const userId = String(form.elements.userId.value || '').trim();
    const steamId = String(form.elements.steamId.value || '').trim();
    const inGameName = String(form.elements.inGameName.value || '').trim();
    if (!userId) {
      setBanner('Steam link action is incomplete', 'Provide a Discord user ID before running support link actions.', ['support'], 'danger');
      return;
    }
    if (action === 'set' && !steamId) {
      setBanner('Steam ID required', 'Set action requires a Steam ID.', ['support'], 'danger');
      return;
    }
    if (!window.confirm(`Run ${action} steam link support action for ${userId}?`)) return;
    try {
      setBusy(button, true, 'Applying...');
      await api(action === 'remove' ? '/admin/api/link/remove' : '/admin/api/link/set', {
        method: 'POST',
        body: action === 'remove'
          ? { userId, steamId }
          : { userId, steamId, inGameName },
      });
      form.reset();
      form.elements.action.value = 'set';
      showToast('Steam link support action completed.', 'success');
      await refreshSurface();
    } catch (error) {
      setBanner('Steam link support failed', String(error.message || error), ['support'], 'danger');
    } finally {
      setBusy(button, false);
    }
  }

  async function handleVipSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const action = String(form.elements.action.value || 'set').trim();
    const userId = String(form.elements.userId.value || '').trim();
    const planId = String(form.elements.planId.value || '').trim();
    const durationDays = Math.trunc(Number(form.elements.durationDays.value || 0));
    if (!userId) {
      setBanner('VIP action is incomplete', 'Provide a Discord user ID before updating VIP state.', ['support'], 'danger');
      return;
    }
    if (action === 'set' && (!planId || !Number.isFinite(durationDays) || durationDays <= 0)) {
      setBanner('VIP grant is incomplete', 'Grant action requires both plan id and duration days.', ['support'], 'danger');
      return;
    }
    if (!window.confirm(`Run ${action} VIP action for ${userId}?`)) return;
    try {
      setBusy(button, true, 'Applying...');
      await api(action === 'remove' ? '/admin/api/vip/remove' : '/admin/api/vip/set', {
        method: 'POST',
        body: action === 'remove'
          ? { userId }
          : { userId, planId, durationDays },
      });
      form.reset();
      form.elements.action.value = 'set';
      form.elements.durationDays.value = '30';
      showToast('VIP action completed.', 'success');
      await refreshSurface();
    } catch (error) {
      setBanner('VIP action failed', String(error.message || error), ['support'], 'danger');
    } finally {
      setBusy(button, false);
    }
  }

  async function handleRedeemSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const action = String(form.elements.action.value || 'add').trim();
    const code = String(form.elements.code.value || '').trim();
    const type = String(form.elements.type.value || 'coins').trim();
    const amountText = String(form.elements.amount.value || '').trim();
    const itemId = String(form.elements.itemId.value || '').trim();
    if (!code) {
      setBanner('Redeem action is incomplete', 'Provide the redeem code before applying support changes.', ['support'], 'danger');
      return;
    }
    if (action === 'add') {
      if (!type) {
        setBanner('Redeem type required', 'Choose a redeem code type before creating the code.', ['support'], 'danger');
        return;
      }
      if (type === 'coins' && !amountText) {
        setBanner('Redeem amount required', 'Coin redeem codes require an amount.', ['support'], 'danger');
        return;
      }
      if (type === 'item' && !itemId) {
        setBanner('Redeem item required', 'Item redeem codes require an item id.', ['support'], 'danger');
        return;
      }
    }
    if (!window.confirm(`Run redeem action ${action} for ${code}?`)) return;
    try {
      setBusy(button, true, 'Applying...');
      const endpoint = action === 'delete'
        ? '/admin/api/redeem/delete'
        : action === 'reset-usage'
          ? '/admin/api/redeem/reset-usage'
          : '/admin/api/redeem/add';
      const body = action === 'add'
        ? {
            code,
            type,
            amount: amountText ? Math.trunc(Number(amountText)) : null,
            itemId,
          }
        : { code };
      await api(endpoint, {
        method: 'POST',
        body,
      });
      form.reset();
      form.elements.action.value = 'add';
      form.elements.type.value = 'coins';
      showToast('Redeem support action completed.', 'success');
    } catch (error) {
      setBanner('Redeem support action failed', String(error.message || error), ['support'], 'danger');
    } finally {
      setBusy(button, false);
    }
  }

  async function handleDeliveryLabSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const action = String(form.elements.action.value || 'preview').trim();
    const itemId = String(form.elements.itemId.value || '').trim();
    const gameItemId = String(form.elements.gameItemId.value || '').trim();
    const purchaseCode = String(form.elements.purchaseCode.value || '').trim();
    const userId = String(form.elements.userId.value || '').trim();
    const payload = {
      tenantId: state.me?.tenantId,
      itemId,
      gameItemId,
      itemName: String(form.elements.itemName.value || '').trim(),
      quantity: String(form.elements.quantity.value || '').trim(),
      purchaseCode,
      userId,
      steamId: String(form.elements.steamId.value || '').trim(),
      inGameName: String(form.elements.inGameName.value || '').trim(),
      teleportMode: String(form.elements.teleportMode.value || '').trim(),
      teleportTarget: String(form.elements.teleportTarget.value || '').trim(),
      returnTarget: String(form.elements.returnTarget.value || '').trim(),
    };
    const endpointMap = {
      preview: '/admin/api/delivery/preview',
      preflight: '/admin/api/delivery/preflight',
      simulate: '/admin/api/delivery/simulate',
      'test-send': '/admin/api/delivery/test-send',
    };
    if (action === 'preview' || action === 'simulate' || action === 'test-send') {
      if (!itemId && !gameItemId) {
        setBanner('Delivery lab is incomplete', 'Preview, simulate, and test-send require item id or game item id.', ['delivery-lab'], 'danger');
        return;
      }
    }
    if (action === 'preflight' && !itemId && !gameItemId && !purchaseCode) {
      setBanner('Delivery lab is incomplete', 'Preflight requires purchase code or item/game item context.', ['delivery-lab'], 'danger');
      return;
    }
    if (action === 'test-send' && !window.confirm('Run live test-send against the delivery runtime?')) {
      return;
    }
    try {
      setBusy(button, true, action === 'test-send' ? 'Sending...' : 'Running...');
      const data = await api(endpointMap[action], {
        method: 'POST',
        body: payload,
      });
      state.deliveryLabResult = { action, data };
      renderDeliveryLab();
      showToast(`Delivery lab ${action} completed.`, action === 'test-send' ? 'warning' : 'success');
    } catch (error) {
      state.deliveryLabResult = { action, data: { error: String(error.message || error) } };
      renderDeliveryLab();
      setBanner('Delivery lab failed', String(error.message || error), ['delivery-lab'], 'danger');
    } finally {
      setBusy(button, false);
    }
  }

  async function loadAuditView(filters = {}, options = {}) {
    const merged = {
      ...state.auditFilters,
      ...filters,
    };
    state.auditFilters = {
      view: merged.view || 'wallet',
      userId: merged.userId || '',
      query: merged.query || '',
      windowMs: merged.windowMs == null ? '' : String(merged.windowMs),
    };
    const queryString = buildAuditQueryString({
      tenantId: state.me?.tenantId || '',
      view: state.auditFilters.view,
      userId: state.auditFilters.userId,
      q: state.auditFilters.query,
      windowMs: state.auditFilters.windowMs,
      pageSize: 8,
    });
    const button = options.button || null;
    try {
      if (button) setBusy(button, true, 'Loading...');
      state.audit = await api(`/admin/api/audit/query?${queryString}`);
      renderAudit();
      if (options.toast === true) {
        showToast('Tenant audit view loaded.', 'success');
      }
      return true;
    } catch (error) {
      state.audit = { cards: [], tableRows: [] };
      renderAudit();
      setBanner('Tenant audit query failed', String(error.message || error), ['audit'], 'danger');
      return false;
    } finally {
      if (button) setBusy(button, false);
    }
  }

  async function handleAuditQuerySubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    await loadAuditView({
      view: String(form.elements.view.value || 'wallet').trim(),
      userId: String(form.elements.userId.value || '').trim(),
      query: String(form.elements.query.value || '').trim(),
      windowMs: String(form.elements.windowMs.value || '').trim(),
    }, { button, toast: true });
  }

  function exportAudit(format) {
    const queryString = buildAuditQueryString({
      tenantId: state.me?.tenantId || '',
      view: state.auditFilters.view,
      userId: state.auditFilters.userId,
      q: state.auditFilters.query,
      windowMs: state.auditFilters.windowMs,
      format,
    });
    window.open(`/admin/api/audit/export?${queryString}`, '_blank', 'noopener,noreferrer');
  }

  async function acknowledgeAlerts() {
    const button = document.getElementById('tenantAckAlertsBtn');
    const ids = state.notifications.map((item) => item.id).filter(Boolean);
    if (ids.length === 0) {
      showToast('No alerts to acknowledge.', 'info');
      return;
    }
    if (!window.confirm('Acknowledge current tenant notifications?')) {
      return;
    }
    setBusy(button, true, 'Acknowledging...');
    try {
      await api('/admin/api/notifications/ack', {
        method: 'POST',
        body: { ids },
      });
      showToast('Tenant alerts acknowledged.', 'success');
      await refreshSurface();
    } catch (error) {
      setBanner('Acknowledge alerts failed', String(error.message || error), ['alerts'], 'danger');
    } finally {
      setBusy(button, false);
    }
  }

  const palette = wireCommandPalette({
    openButtonId: 'tenantPaletteBtn',
    closeButtonId: 'tenantPaletteCloseBtn',
    panelId: 'tenantPalette',
    searchId: 'tenantPaletteSearch',
    listId: 'tenantPaletteList',
    emptyId: 'tenantPaletteEmpty',
    getActions() {
      return [
        {
          label: 'Jump to Overview',
          meta: 'Tenant sections',
          run: () => document.getElementById('overview')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
        },
        {
          label: 'Jump to Runtime + Alerts',
          meta: 'Tenant sections',
          run: () => document.getElementById('operations')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
        },
        {
          label: 'Jump to Insights',
          meta: 'Tenant sections',
          run: () => document.getElementById('insights')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
        },
        {
          label: 'Jump to Commerce + Delivery',
          meta: 'Tenant sections',
          run: () => document.getElementById('commerce')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
        },
        {
          label: 'Jump to Delivery Lab',
          meta: 'Tenant sections',
          run: () => document.getElementById('sandbox')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
        },
        {
          label: 'Jump to Catalog Tools',
          meta: 'Tenant sections',
          run: () => document.getElementById('catalog-tools')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
        },
        {
          label: 'Jump to Transactions',
          meta: 'Tenant sections',
          run: () => document.getElementById('transactions')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
        },
        {
          label: 'Jump to Support Tools',
          meta: 'Tenant sections',
          run: () => document.getElementById('support-tools')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
        },
        {
          label: 'Jump to Tenant Config',
          meta: 'Tenant sections',
          run: () => document.getElementById('config')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
        },
        {
          label: 'Jump to Audit Trail',
          meta: 'Tenant sections',
          run: () => document.getElementById('audit')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
        },
        {
          label: 'Refresh Tenant Console',
          meta: 'Tenant action',
          run: () => refreshSurface(),
        },
        {
          label: 'Acknowledge Alerts',
          meta: 'Tenant action',
          run: acknowledgeAlerts,
        },
        {
          label: 'Open Delivery Workbench',
          meta: 'Legacy workbench',
          run: () => { window.location.href = '/admin/legacy?tab=delivery'; },
        },
        {
          label: 'Focus Delivery Lab',
          meta: 'Tenant action',
          run: () => document.getElementById('tenantDeliveryLabForm')?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
        },
        {
          label: 'Focus Audit Query',
          meta: 'Tenant action',
          run: () => document.getElementById('tenantAuditQueryForm')?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
        },
        {
          label: 'Open Economy Tools',
          meta: 'Legacy workbench',
          run: () => { window.location.href = '/admin/legacy?tab=economy'; },
        },
        {
          label: 'Open Player Tools',
          meta: 'Legacy workbench',
          run: () => { window.location.href = '/admin/legacy?tab=players'; },
        },
      ];
    },
  });

  document.getElementById('tenantRefreshBtn').addEventListener('click', () => refreshSurface());
  document.getElementById('tenantAckAlertsBtn').addEventListener('click', acknowledgeAlerts);
  document.getElementById('tenantConfigForm').addEventListener('submit', handleTenantConfigSubmit);
  document.getElementById('tenantWalletForm').addEventListener('submit', handleWalletSubmit);
  document.getElementById('tenantDeliveryForm').addEventListener('submit', handleDeliverySubmit);
  document.getElementById('tenantShopCreateForm').addEventListener('submit', handleShopCreateSubmit);
  document.getElementById('tenantShopPriceForm').addEventListener('submit', handleShopPriceSubmit);
  document.getElementById('tenantShopDeleteForm').addEventListener('submit', handleShopDeleteSubmit);
  document.getElementById('tenantPurchaseLookupForm').addEventListener('submit', handlePurchaseLookupSubmit);
  document.getElementById('tenantPurchaseStatusForm').addEventListener('submit', handlePurchaseStatusSubmit);
  document.getElementById('tenantSteamLinkForm').addEventListener('submit', handleSteamLinkSubmit);
  document.getElementById('tenantVipForm').addEventListener('submit', handleVipSubmit);
  document.getElementById('tenantRedeemForm').addEventListener('submit', handleRedeemSubmit);
  document.getElementById('tenantDeliveryLabForm').addEventListener('submit', handleDeliveryLabSubmit);
  document.getElementById('tenantAuditQueryForm').addEventListener('submit', handleAuditQuerySubmit);
  document.getElementById('tenantAuditExportJsonBtn').addEventListener('click', () => exportAudit('json'));
  document.getElementById('tenantAuditExportCsvBtn').addEventListener('click', () => exportAudit('csv'));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      refreshSurface({ silent: true });
      palette.refresh();
    }
  });

  intervalHandle = window.setInterval(() => {
    if (!document.hidden) {
      refreshSurface({ silent: true });
    }
  }, 45000);

  window.addEventListener('beforeunload', () => {
    if (liveConnection) {
      liveConnection.close();
    }
    if (intervalHandle) {
      window.clearInterval(intervalHandle);
    }
  });

  refreshSurface();
})();
