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
    observability: null,
    reconcile: null,
    opsState: null,
    tenants: [],
    subscriptions: [],
    licenses: [],
    apiKeys: [],
    webhooks: [],
    agents: [],
    notifications: [],
    securityEvents: [],
    runtimeSupervisor: null,
    dashboardCards: null,
    requestLogs: { metrics: {}, items: [] },
    roleMatrix: { summary: {}, permissions: [] },
    controlPanelSettings: null,
    restoreState: null,
    backupFiles: [],
    restorePreview: null,
    sessions: [],
    users: [],
    audit: null,
    auditFilters: {
      view: 'wallet',
      userId: '',
      query: '',
      windowMs: '604800000',
    },
    assetResult: null,
    liveEvents: [],
  };

  let liveConnection = null;
  let refreshTimer = null;
  let intervalHandle = null;

  const OBSERVABILITY_SERIES_META = [
    { key: 'deliveryQueueLength', title: 'Delivery Queue', mode: 'integer' },
    { key: 'deliveryFailRate', title: 'Delivery Fail Rate', mode: 'percent' },
    { key: 'deliveryDeadLetters', title: 'Dead Letters', mode: 'integer' },
    { key: 'webhookErrorRate', title: 'Webhook Errors', mode: 'percent' },
    { key: 'loginFailures', title: 'Login Failures', mode: 'integer' },
    { key: 'adminRequestErrors', title: 'Request Errors', mode: 'integer' },
    { key: 'runtimeDegraded', title: 'Degraded Runtime', mode: 'integer' },
  ];

  function normalizeRuntimeRows(snapshot) {
    const services = snapshot?.services;
    if (Array.isArray(services)) return services;
    if (services && typeof services === 'object') {
      return Object.entries(services).map(([name, row]) => ({
        name,
        ...(row && typeof row === 'object' ? row : {}),
      }));
    }
    return [];
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

  function parseOptionalJson(raw, label) {
    const text = String(raw || '').trim();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`${label} must be valid JSON`);
    }
  }

  function maskTail(value, keep = 8) {
    const text = String(value || '').trim();
    if (!text) return '-';
    if (text.length <= keep) return text;
    return `...${text.slice(-keep)}`;
  }

  function makeClientId(prefix) {
    const safePrefix = String(prefix || 'asset').trim().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'asset';
    return `${safePrefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  }

  function getControlEnvEntry(scope, key) {
    return state.controlPanelSettings?.env?.[scope]?.[key] || null;
  }

  function getControlEnvValue(scope, key, fallback = '') {
    const entry = getControlEnvEntry(scope, key);
    if (!entry) return fallback;
    if (entry.type === 'boolean') {
      return entry.value === true ? 'true' : 'false';
    }
    if (entry.value == null) return fallback;
    return String(entry.value);
  }

  function formatMetricValue(value, mode = 'integer') {
    const number = Number(value);
    if (!Number.isFinite(number)) return '-';
    if (mode === 'percent') return `${(number * 100).toFixed(2)}%`;
    return formatNumber(number, '0');
  }

  function buildSparkBars(points = [], tone = 'info') {
    const values = (Array.isArray(points) ? points : [])
      .map((point) => Number(point?.value || 0))
      .filter((value) => Number.isFinite(value));
    if (values.length === 0) {
      return '<div class="empty-state">No series yet.</div>';
    }
    const max = Math.max(...values, 1);
    return `<div class="sparkline">${
      values.slice(-12).map((value) => {
        const height = Math.max(12, Math.round((value / max) * 72));
        return `<span class="spark-bar ${escapeHtml(tone)}" style="height:${height}px"></span>`;
      }).join('')
    }</div>`;
  }

  function renderSeriesCards() {
    const wrap = document.getElementById('ownerSeriesCards');
    if (!wrap) return;
    const timeSeries = state.observability?.timeSeries || {};
    wrap.innerHTML = OBSERVABILITY_SERIES_META.map((meta) => {
      const points = Array.isArray(timeSeries?.[meta.key]) ? timeSeries[meta.key] : [];
      const latest = points.length > 0 ? points[points.length - 1].value : 0;
      const tone =
        meta.key === 'deliveryFailRate' || meta.key === 'webhookErrorRate'
          ? 'warning'
          : meta.key === 'runtimeDegraded' || meta.key === 'adminRequestErrors'
            ? 'danger'
            : 'info';
      return [
        '<article class="series-card">',
        `<span class="section-kicker">${escapeHtml(meta.key)}</span>`,
        `<h4>${escapeHtml(meta.title)}</h4>`,
        `<strong class="series-value">${escapeHtml(formatMetricValue(latest, meta.mode))}</strong>`,
        buildSparkBars(points, tone),
        `<div class="series-meta">${makePill(`${points.length} points`, 'neutral')}</div>`,
        '</article>',
      ].join('');
    }).join('');
  }

  function describeUserAgent(userAgent) {
    const text = String(userAgent || '').trim();
    if (!text) return 'Unknown device';
    const lowered = text.toLowerCase();
    const browser =
      lowered.includes('edg/') ? 'Edge'
        : lowered.includes('chrome/') ? 'Chrome'
          : lowered.includes('firefox/') ? 'Firefox'
            : lowered.includes('safari/') ? 'Safari'
              : lowered.includes('discordbot') ? 'Discord Bot'
                : 'Browser';
    const platform =
      lowered.includes('windows') ? 'Windows'
        : lowered.includes('android') ? 'Android'
          : lowered.includes('iphone') || lowered.includes('ipad') || lowered.includes('ios') ? 'iOS'
            : lowered.includes('mac os') || lowered.includes('macintosh') ? 'macOS'
              : lowered.includes('linux') ? 'Linux'
                : 'Unknown OS';
    return `${browser} on ${platform}`;
  }

  function buildDeviceRows(requests = []) {
    const map = new Map();
    for (const row of Array.isArray(requests) ? requests : []) {
      const user = String(row?.user || 'unknown').trim() || 'unknown';
      const ip = String(row?.ip || 'unknown').trim() || 'unknown';
      const userAgent = String(row?.userAgent || '').trim();
      const key = `${user}|${ip}|${userAgent}`;
      const entry = map.get(key) || {
        user,
        role: String(row?.role || '').trim() || '-',
        ip,
        userAgent,
        deviceLabel: describeUserAgent(userAgent),
        hits: 0,
        lastSeenAt: row?.at || null,
      };
      entry.hits += 1;
      if (!entry.lastSeenAt || new Date(row?.at || 0) > new Date(entry.lastSeenAt || 0)) {
        entry.lastSeenAt = row?.at || entry.lastSeenAt;
      }
      map.set(key, entry);
    }
    return Array.from(map.values())
      .sort((left, right) => new Date(right.lastSeenAt || 0) - new Date(left.lastSeenAt || 0))
      .slice(0, 16);
  }

  function formatAuditCell(key, value) {
    if (value == null || value === '') return '-';
    if (Array.isArray(value)) {
      return value.join(', ') || '-';
    }
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

  function setBanner(title, detail, tags, tone) {
    const banner = document.getElementById('ownerStatusBanner');
    const tagWrap = document.getElementById('ownerStatusTags');
    document.getElementById('ownerStatusTitle').textContent = title;
    document.getElementById('ownerStatusDetail').textContent = detail;
    banner.className = `status-banner banner-${tone || 'info'}`;
    tagWrap.innerHTML = (Array.isArray(tags) ? tags : []).map((tag) => makePill(tag)).join('');
  }

  function buildIncidentItems() {
    const requestItems = Array.isArray(state.requestLogs?.items)
      ? state.requestLogs.items.map((item) => ({
          source: 'requests',
          severity: item.statusCode >= 500 ? 'danger' : 'warning',
          title: `${item.method || 'REQ'} ${item.path || item.routeGroup || 'request'}`,
          detail: `${item.statusCode || '-'} ${item.error || item.summary || item.requestId || ''}`.trim(),
          time: item.at || item.createdAt,
        }))
      : [];
    const notificationItems = state.notifications.map((item) => ({
      source: 'alerts',
      severity: item.severity || 'warning',
      title: item.title || item.type || 'Notification',
      detail: item.detail || item.message || '',
      time: item.createdAt || item.at,
    }));
    const securityItems = state.securityEvents.map((item) => ({
      source: 'security',
      severity: item.severity || 'info',
      title: item.type || 'Security event',
      detail: item.detail || item.reason || '',
      time: item.createdAt || item.at,
    }));

    return [...notificationItems, ...securityItems, ...requestItems]
      .sort((left, right) => new Date(right.time || 0).getTime() - new Date(left.time || 0).getTime())
      .slice(0, 12);
  }

  function renderOverview() {
    const analytics = state.overview?.analytics || {};
    const tenants = analytics.tenants || {};
    const delivery = analytics.delivery || {};
    const subscriptions = analytics.subscriptions || {};
    const runtimeRows = normalizeRuntimeRows(state.runtimeSupervisor);
    const readyServices = runtimeRows.filter((row) => String(row.status || '').toLowerCase() === 'ready').length;
    const degradedServices = runtimeRows.filter((row) => {
      const status = String(row.status || '').toLowerCase();
      return status && status !== 'ready';
    }).length;
    const requestErrors = Array.isArray(state.requestLogs?.items) ? state.requestLogs.items.length : 0;

    renderStats(document.getElementById('ownerOverviewStats'), [
      {
        kicker: 'Tenants',
        value: formatNumber(tenants.total || state.tenants.length, '0'),
        title: 'Active platform tenants',
        detail: 'Includes trialing and reseller entries visible from the owner scope.',
        tags: [
          `active ${formatNumber(tenants.active, '0')}`,
          `trial ${formatNumber(tenants.trialing, '0')}`,
          `reseller ${formatNumber(tenants.reseller, '0')}`,
        ],
      },
      {
        kicker: 'Delivery',
        value: `${formatNumber(delivery.successRate, '0')}%`,
        title: '30-day delivery success',
        detail: 'Platform-wide purchase-to-delivery signal.',
        tags: [
          `purchases ${formatNumber(delivery.purchaseCount30d, '0')}`,
          `queue ${formatNumber(delivery.queueJobs, '0')}`,
          `dead ${formatNumber(delivery.deadLetters, '0')}`,
        ],
      },
      {
        kicker: 'Runtime',
        value: `${formatNumber(readyServices, '0')}/${formatNumber(runtimeRows.length, '0')}`,
        title: 'Managed services ready',
        detail: 'Bot, worker, watcher, admin web, and auxiliary services.',
        tags: [
          `degraded ${formatNumber(degradedServices, '0')}`,
          `agents ${formatNumber(state.agents.length, '0')}`,
        ],
      },
      {
        kicker: 'Incidents',
        value: formatNumber(state.notifications.length + requestErrors, '0'),
        title: 'Open owner attention items',
        detail: 'Aggregates notifications and latest request anomalies.',
        tags: [
          `alerts ${formatNumber(state.notifications.length, '0')}`,
          `request errors ${formatNumber(requestErrors, '0')}`,
          `subs ${formatNumber(subscriptions.active, '0')}`,
        ],
      },
    ]);
  }

  function renderTenantTable() {
    renderTable(document.getElementById('ownerTenantTable'), {
      emptyText: 'No tenants found.',
      columns: [
        {
          label: 'Tenant',
          render: (row) => [
            `<strong>${escapeHtml(row.name || row.slug || row.id || '-')}</strong>`,
            `<div class="muted code">${escapeHtml(row.id || '-')}</div>`,
          ].join(''),
        },
        {
          label: 'Status',
          render: (row) => makePill(row.status || 'unknown'),
        },
        {
          label: 'Type',
          render: (row) => escapeHtml(row.type || row.plan || '-'),
        },
        {
          label: 'Owner',
          render: (row) => [
            `<div>${escapeHtml(row.ownerName || '-')}</div>`,
            row.ownerEmail ? `<div class="muted">${escapeHtml(row.ownerEmail)}</div>` : '',
          ].join(''),
        },
        {
          label: 'Updated',
          render: (row) => `<span class="code">${escapeHtml(formatDateTime(row.updatedAt || row.createdAt))}</span>`,
        },
      ],
      rows: state.tenants.slice(0, 20),
    });
  }

  function renderFleetAssets() {
    const tenantSelects = Array.from(document.querySelectorAll('.owner-tenant-select'));
    tenantSelects.forEach((select) => {
      const current = String(select.value || '').trim();
      select.innerHTML = [
        '<option value="">Choose tenant</option>',
        ...state.tenants.map((row) => {
          const tenantId = String(row.id || '').trim();
          const label = row.name || row.slug || tenantId || '-';
          const selected = tenantId && tenantId === current ? ' selected' : '';
          return `<option value="${escapeHtml(tenantId)}"${selected}>${escapeHtml(label)} (${escapeHtml(tenantId)})</option>`;
        }),
      ].join('');
      if (current && state.tenants.some((row) => String(row.id || '').trim() === current)) {
        select.value = current;
      }
    });

    renderTable(document.getElementById('ownerSubscriptionTable'), {
      emptyText: 'No subscriptions found.',
      columns: [
        {
          label: 'Tenant',
          render: (row) => [
            `<strong>${escapeHtml(row.tenantName || row.tenantId || '-')}</strong>`,
            row.tenantId ? `<div class="muted code">${escapeHtml(row.tenantId)}</div>` : '',
          ].join(''),
        },
        {
          label: 'Plan',
          render: (row) => escapeHtml(row.planId || row.planName || '-'),
        },
        {
          label: 'Status',
          render: (row) => makePill(row.status || 'unknown'),
        },
        {
          label: 'Billing',
          render: (row) => escapeHtml(row.billingCycle || row.currency || '-'),
        },
        {
          label: 'Renews',
          render: (row) => `<span class="code">${escapeHtml(formatDateTime(row.renewsAt || row.startedAt))}</span>`,
        },
      ],
      rows: state.subscriptions.slice(0, 12),
    });

    renderTable(document.getElementById('ownerLicenseTable'), {
      emptyText: 'No licenses found.',
      columns: [
        {
          label: 'Tenant',
          render: (row) => [
            `<strong>${escapeHtml(row.tenantName || row.tenantId || '-')}</strong>`,
            row.tenantId ? `<div class="muted code">${escapeHtml(row.tenantId)}</div>` : '',
          ].join(''),
        },
        {
          label: 'License',
          render: (row) => `<span class="code">${escapeHtml(maskTail(row.licenseKey || row.id || '-'))}</span>`,
        },
        {
          label: 'Status',
          render: (row) => makePill(row.status || 'unknown'),
        },
        {
          label: 'Seats',
          render: (row) => formatNumber(row.seats, '-'),
        },
        {
          label: 'Expires',
          render: (row) => `<span class="code">${escapeHtml(formatDateTime(row.expiresAt || row.updatedAt))}</span>`,
        },
      ],
      rows: state.licenses.slice(0, 12),
    });

    renderTable(document.getElementById('ownerApiKeyTable'), {
      emptyText: 'No API keys found.',
      columns: [
        {
          label: 'Tenant',
          render: (row) => [
            `<strong>${escapeHtml(row.tenantName || row.tenantId || '-')}</strong>`,
            row.tenantId ? `<div class="muted code">${escapeHtml(row.tenantId)}</div>` : '',
          ].join(''),
        },
        {
          label: 'Key',
          render: (row) => [
            `<strong>${escapeHtml(row.name || row.id || 'API key')}</strong>`,
            `<div class="muted code">${escapeHtml(maskTail(row.key || row.id || row.name || '-'))}</div>`,
          ].join(''),
        },
        {
          label: 'Status',
          render: (row) => makePill(row.status || 'unknown'),
        },
        {
          label: 'Scopes',
          render: (row) => escapeHtml(Array.isArray(row.scopes) ? row.scopes.join(', ') : '-'),
        },
      ],
      rows: state.apiKeys.slice(0, 12),
    });

    renderTable(document.getElementById('ownerWebhookTable'), {
      emptyText: 'No webhook endpoints found.',
      columns: [
        {
          label: 'Tenant',
          render: (row) => [
            `<strong>${escapeHtml(row.tenantName || row.tenantId || '-')}</strong>`,
            row.tenantId ? `<div class="muted code">${escapeHtml(row.tenantId)}</div>` : '',
          ].join(''),
        },
        {
          label: 'Endpoint',
          render: (row) => [
            `<strong>${escapeHtml(row.name || row.id || 'Webhook')}</strong>`,
            row.url ? `<div class="muted">${escapeHtml(row.url)}</div>` : '',
          ].join(''),
        },
        {
          label: 'Event',
          render: (row) => escapeHtml(row.eventType || row.type || '-'),
        },
        {
          label: 'Status',
          render: (row) => makePill(row.status || 'unknown'),
        },
      ],
      rows: state.webhooks.slice(0, 12),
    });

    const resultWrap = document.getElementById('ownerAssetResult');
    const result = state.assetResult;
    if (!resultWrap) return;
    if (!result) {
      resultWrap.innerHTML = '<div class="empty-state">Create an asset or run a webhook test to see the latest owner action result here.</div>';
      return;
    }
    const tags = [
      result.kind || 'asset',
      result.tenantId || 'tenant -',
      result.createdAt ? `at ${formatDateTime(result.createdAt)}` : 'ready',
    ];
    resultWrap.innerHTML = [
      '<article class="panel-card">',
      `<h3>${escapeHtml(result.title || 'Owner asset result')}</h3>`,
      result.detail ? `<p>${escapeHtml(result.detail)}</p>` : '',
      `<div class="tag-row">${tags.map((tag) => makePill(tag, 'info')).join('')}</div>`,
      '</article>',
      ...(Array.isArray(result.rows) && result.rows.length
        ? result.rows.map((row) => [
            '<article class="feed-item">',
            `<strong>${escapeHtml(row.label || 'Value')}</strong>`,
            `<div class="muted ${row.code ? 'code' : ''}">${escapeHtml(row.value || '-')}</div>`,
            '</article>',
          ].join(''))
        : ['<div class="empty-state">No result details.</div>']),
    ].join('');
  }

  function renderRuntimeTables() {
    renderTable(document.getElementById('ownerRuntimeTable'), {
      emptyText: 'No runtime services reported.',
      columns: [
        {
          label: 'Service',
          render: (row) => [
            `<strong>${escapeHtml(row.label || row.name || row.service || '-')}</strong>`,
            row.required === true ? '<div class="muted">required runtime</div>' : '',
          ].join(''),
        },
        {
          label: 'Status',
          render: (row) => makePill(row.status || 'unknown'),
        },
        {
          label: 'Detail',
          render: (row) => escapeHtml(row.detail || row.reason || row.summary || '-'),
        },
        {
          label: 'Updated',
          render: (row) => `<span class="code">${escapeHtml(formatDateTime(row.updatedAt || row.checkedAt || row.lastSeenAt))}</span>`,
        },
      ],
      rows: normalizeRuntimeRows(state.runtimeSupervisor),
    });

    renderTable(document.getElementById('ownerAgentsTable'), {
      emptyText: 'No agent runtimes reported yet.',
      columns: [
        {
          label: 'Runtime',
          render: (row) => [
            `<strong>${escapeHtml(row.runtimeKey || row.name || '-')}</strong>`,
            `<div class="muted code">${escapeHtml(row.channel || '-')}</div>`,
          ].join(''),
        },
        {
          label: 'Status',
          render: (row) => makePill(row.status || 'unknown'),
        },
        {
          label: 'Version',
          render: (row) => escapeHtml(row.version || '-'),
        },
        {
          label: 'Last Seen',
          render: (row) => `<span class="code">${escapeHtml(formatDateTime(row.lastSeenAt))}</span>`,
        },
      ],
      rows: state.agents.slice(0, 20),
    });
  }

  function renderObservability() {
    const data = state.observability || {};
    const delivery = data.delivery || {};
    const login = data.adminLogin || {};
    const webhook = data.webhook || {};
    const requestLog = data.requestLog || {};
    const runtimeCounts = state.runtimeSupervisor?.counts || data.runtimeSupervisor?.counts || {};
    const reconcile = state.reconcile || {};

    renderStats(document.getElementById('ownerObservabilityStats'), [
      {
        kicker: 'Delivery',
        value: formatMetricValue(delivery.queueLength, 'integer'),
        title: 'Queue depth',
        detail: 'Current queue depth across delivery execution paths.',
        tags: [
          `fail ${formatMetricValue(delivery.failRate, 'percent')}`,
          `dead ${formatMetricValue(data.deliveryRuntime?.deadLetterCount, 'integer')}`,
        ],
      },
      {
        kicker: 'Webhook',
        value: formatMetricValue(webhook.errorRate, 'percent'),
        title: 'Webhook error rate',
        detail: 'Recent SCUM webhook delivery error ratio.',
        tags: [
          `attempts ${formatMetricValue(webhook.attempts, 'integer')}`,
          `errors ${formatMetricValue(webhook.errors, 'integer')}`,
        ],
      },
      {
        kicker: 'Security',
        value: formatMetricValue(login.failures, 'integer'),
        title: 'Login failures',
        detail: 'Admin login failure pressure in the current observation window.',
        tags: [
          `hot IPs ${formatMetricValue(Array.isArray(login.hotIps) ? login.hotIps.length : 0, 'integer')}`,
          `window ${formatMetricValue(Math.round(Number(login.windowMs || 0) / 60000), 'integer')} min`,
        ],
      },
      {
        kicker: 'Requests',
        value: formatMetricValue(requestLog.errors, 'integer'),
        title: 'Admin request errors',
        detail: 'Recent request-log anomaly count.',
        tags: [
          `5xx ${formatMetricValue(requestLog.serverErrors, 'integer')}`,
          `401 ${formatMetricValue(requestLog.unauthorized, 'integer')}`,
        ],
      },
      {
        kicker: 'Runtime',
        value: formatMetricValue(Number(runtimeCounts.degraded || 0) + Number(runtimeCounts.offline || 0), 'integer'),
        title: 'Degraded or offline services',
        detail: 'Managed runtime supervision state.',
        tags: [
          `degraded ${formatMetricValue(runtimeCounts.degraded, 'integer')}`,
          `offline ${formatMetricValue(runtimeCounts.offline, 'integer')}`,
        ],
      },
      {
        kicker: 'Reconcile',
        value: formatMetricValue(reconcile.summary?.anomalies, 'integer'),
        title: 'Platform anomalies',
        detail: 'Latest delivery reconcile findings and abuse heuristics.',
        tags: [
          `abuse ${formatMetricValue(reconcile.summary?.abuseFindings, 'integer')}`,
          `window ${formatMetricValue(Math.round(Number(reconcile.summary?.windowMs || 0) / 60000), 'integer')} min`,
        ],
      },
    ]);

    renderSeriesCards();

    const reconcileItems = [
      ...(Array.isArray(reconcile.anomalies) ? reconcile.anomalies : []).map((item) => ({
        tone: item.severity === 'error' ? 'danger' : 'warning',
        title: item.type || 'anomaly',
        detail: `${item.code || '-'} | ${item.detail || ''}`.trim(),
        at: state.opsState?.lastReconcileAt || state.opsState?.updatedAt || state.observability?.generatedAt,
      })),
      ...(Array.isArray(reconcile.abuseFindings) ? reconcile.abuseFindings : []).map((item) => ({
        tone: 'warning',
        title: item.type || 'abuse-finding',
        detail: `${item.userId || item.itemId || '-'} | count=${item.count || '-'} threshold=${item.threshold || '-'}`,
        at: state.opsState?.lastReconcileAt || state.opsState?.updatedAt || state.observability?.generatedAt,
      })),
    ].slice(0, 12);

    renderList(
      document.getElementById('ownerReconcileFeed'),
      reconcileItems,
      (item) => [
        `<article class="timeline-item ${escapeHtml(item.tone || 'info')}">`,
        `<div class="feed-meta">${makePill(item.title || 'finding')} <span class="code">${escapeHtml(formatDateTime(item.at))}</span></div>`,
        `<strong>${escapeHtml(item.title || 'Finding')}</strong>`,
        item.detail ? `<div class="muted">${escapeHtml(item.detail)}</div>` : '',
        '</article>',
      ].join(''),
      'No reconcile anomalies or abuse signals right now.'
    );

    renderStats(document.getElementById('ownerOpsStateStats'), [
      {
        kicker: 'Monitoring',
        value: state.opsState?.lastMonitoringAt ? 'recent' : 'idle',
        title: 'Last monitoring cycle',
        detail: state.opsState?.lastMonitoringAt
          ? formatDateTime(state.opsState.lastMonitoringAt)
          : 'No monitoring cycle recorded yet.',
      },
      {
        kicker: 'Backup',
        value: state.opsState?.lastAutoBackupAt ? 'created' : 'pending',
        title: 'Last auto backup',
        detail: state.opsState?.lastAutoBackupAt
          ? formatDateTime(state.opsState.lastAutoBackupAt)
          : 'No automatic backup recorded yet.',
      },
      {
        kicker: 'Reconcile',
        value: state.opsState?.lastReconcileAt ? 'run' : 'pending',
        title: 'Last reconcile cycle',
        detail: state.opsState?.lastReconcileAt
          ? formatDateTime(state.opsState.lastReconcileAt)
          : 'Reconcile has not run yet in ops state.',
      },
      {
        kicker: 'Alerts',
        value: formatMetricValue(Object.keys(state.opsState?.lastAlertAtByKey || {}).length, 'integer'),
        title: 'Tracked alert keys',
        detail: 'Cooldown state retained by the platform monitoring service.',
      },
    ]);

    renderTable(document.getElementById('ownerObservabilityRequestTable'), {
      emptyText: 'No recent requests in observability snapshot.',
      columns: [
        {
          label: 'Request',
          render: (row) => [
            `<strong>${escapeHtml(row.method || 'GET')} ${escapeHtml(row.path || '-')}</strong>`,
            row.requestId ? `<div class="muted code">${escapeHtml(row.requestId)}</div>` : '',
          ].join(''),
        },
        {
          label: 'Status',
          render: (row) => makePill(String(row.statusCode || '-'), Number(row.statusCode || 0) >= 500 ? 'danger' : Number(row.statusCode || 0) >= 400 ? 'warning' : 'success'),
        },
        {
          label: 'Latency',
          render: (row) => `${formatMetricValue(row.latencyMs, 'integer')} ms`,
        },
        {
          label: 'Actor',
          render: (row) => [
            `<div>${escapeHtml(row.user || row.authMode || 'anonymous')}</div>`,
            `<div class="muted">${escapeHtml(row.ip || '-')}</div>`,
          ].join(''),
        },
        {
          label: 'Time',
          render: (row) => `<span class="code">${escapeHtml(formatDateTime(row.at))}</span>`,
        },
      ],
      rows: Array.isArray(data.recentRequests) ? data.recentRequests.slice(0, 12) : [],
    });
  }

  function renderNotifications() {
    renderList(
      document.getElementById('ownerNotificationFeed'),
      buildIncidentItems(),
      (item) => [
        '<article class="feed-item">',
        `<div class="feed-meta">${makePill(item.severity || 'info')} <span class="code">${escapeHtml(item.source || 'ops')}</span></div>`,
        `<strong>${escapeHtml(item.title || 'Incident')}</strong>`,
        item.detail ? `<div class="muted">${escapeHtml(item.detail)}</div>` : '',
        `<div class="feed-meta"><span>${escapeHtml(formatDateTime(item.time))}</span></div>`,
        '</article>',
      ].join(''),
      'No open incidents.'
    );
  }

  function renderRequestFeed() {
    renderList(
      document.getElementById('ownerRequestFeed'),
      Array.isArray(state.requestLogs?.items) ? state.requestLogs.items.slice(0, 8) : [],
      (item) => [
        '<article class="feed-item">',
        `<div class="feed-meta">${makePill(item.statusCode >= 500 ? 'error' : 'warning')} <span class="code">${escapeHtml(item.method || 'GET')}</span></div>`,
        `<strong>${escapeHtml(item.path || item.routeGroup || item.requestId || 'request')}</strong>`,
        `<div class="muted">${escapeHtml(`${item.statusCode || '-'} ${item.error || item.summary || ''}`.trim())}</div>`,
        `<div class="feed-meta"><span>${escapeHtml(formatDateTime(item.at || item.createdAt))}</span></div>`,
        '</article>',
      ].join(''),
      'No recent request anomalies.'
    );
  }

  function renderSecurity() {
    renderList(
      document.getElementById('ownerSecurityFeed'),
      state.securityEvents,
      (item) => [
        '<article class="feed-item">',
        `<div class="feed-meta">${makePill(item.severity || 'info')} ${item.type ? `<span class="code">${escapeHtml(item.type)}</span>` : ''}</div>`,
        `<strong>${escapeHtml(item.detail || item.reason || 'Security event')}</strong>`,
        `<div class="muted">${escapeHtml(item.actor || item.targetUser || 'system')}</div>`,
        `<div class="feed-meta"><span>${escapeHtml(formatDateTime(item.createdAt || item.at))}</span></div>`,
        '</article>',
      ].join(''),
      'No recent security events.'
    );

    const summary = state.roleMatrix?.summary || {};
    const permissions = Array.isArray(state.roleMatrix?.permissions) ? state.roleMatrix.permissions.length : 0;
    document.getElementById('ownerPolicyCards').innerHTML = [
      {
        title: 'Role Matrix',
        text: `Visible permission entries: ${formatNumber(permissions, '0')}. Use the owner surface for role posture, elevated access review, and security-sensitive controls.`,
      },
      {
        title: 'Tenant Separation',
        text: 'Tenant-scoped admins are redirected into /tenant. Owner-only views keep platform security and governance outside the tenant workflow.',
      },
      {
        title: 'Session + Step-up',
        text: `Role matrix summary loaded. Step-up and session policy stay behind guarded security routes in the legacy workbench.`,
      },
    ].map((card) => [
      '<article class="panel-card">',
      `<h3>${escapeHtml(card.title)}</h3>`,
      `<p>${escapeHtml(card.text)}</p>`,
      summary.roles ? `<div class="tag-row">${Object.keys(summary.roles).slice(0, 4).map((role) => makePill(role, 'info')).join('')}</div>` : '',
      '</article>',
    ].join('')).join('');

    renderTable(document.getElementById('ownerDeviceTable'), {
      emptyText: 'No recent request footprints available.',
      columns: [
        {
          label: 'Actor',
          render: (row) => [
            `<strong>${escapeHtml(row.user || '-')}</strong>`,
            `<div class="muted">${escapeHtml(row.role || '-')}</div>`,
          ].join(''),
        },
        {
          label: 'Device',
          render: (row) => [
            `<div>${escapeHtml(row.deviceLabel || 'Unknown device')}</div>`,
            row.userAgent ? `<div class="muted">${escapeHtml(row.userAgent)}</div>` : '',
          ].join(''),
        },
        {
          label: 'IP',
          render: (row) => `<span class="code">${escapeHtml(row.ip || '-')}</span>`,
        },
        {
          label: 'Seen',
          render: (row) => [
            `<div>${escapeHtml(formatDateTime(row.lastSeenAt))}</div>`,
            `<div class="muted">${escapeHtml(formatMetricValue(row.hits, 'integer'))} hits</div>`,
          ].join(''),
        },
      ],
      rows: buildDeviceRows(state.observability?.recentRequests || []),
    });

    renderTable(document.getElementById('ownerPermissionTable'), {
      emptyText: 'No permission matrix entries found.',
      columns: [
        {
          label: 'Path',
          render: (row) => `<span class="code">${escapeHtml(row.path || '-')}</span>`,
        },
        {
          label: 'Permission',
          render: (row) => escapeHtml(row.permission || '-'),
        },
        {
          label: 'Role',
          render: (row) => makePill(row.minRole || 'mod', row.minRole === 'owner' ? 'danger' : row.minRole === 'admin' ? 'warning' : 'info'),
        },
        {
          label: 'Flags',
          render: (row) => [
            makePill(row.category || 'general', 'neutral'),
            row.stepUp ? makePill('step-up', 'warning') : '',
          ].filter(Boolean).join(' '),
        },
      ],
      rows: Array.isArray(state.roleMatrix?.permissions) ? state.roleMatrix.permissions.slice(0, 24) : [],
    });
  }

  function renderAccessCenter() {
    renderTable(document.getElementById('ownerSessionsTable'), {
      emptyText: 'No admin sessions reported.',
      columns: [
        {
          label: 'Session',
          render: (row) => [
            `<strong>${escapeHtml(row.username || row.user || row.actor || '-')}</strong>`,
            `<div class="muted code">${escapeHtml(row.id || row.sessionId || '-')}</div>`,
          ].join(''),
        },
        {
          label: 'Role',
          render: (row) => makePill(row.role || 'unknown'),
        },
        {
          label: 'Tenant',
          render: (row) => escapeHtml(row.tenantId || 'global'),
        },
        {
          label: 'Updated',
          render: (row) => `<span class="code">${escapeHtml(formatDateTime(row.updatedAt || row.lastSeenAt || row.createdAt))}</span>`,
        },
      ],
      rows: state.sessions.slice(0, 16),
    });

    renderTable(document.getElementById('ownerUsersTable'), {
      emptyText: 'No admin users found.',
      columns: [
        {
          label: 'User',
          render: (row) => [
            `<strong>${escapeHtml(row.username || row.user || '-')}</strong>`,
            row.id ? `<div class="muted code">${escapeHtml(row.id)}</div>` : '',
          ].join(''),
        },
        {
          label: 'Role',
          render: (row) => makePill(row.role || 'unknown'),
        },
        {
          label: 'Tenant',
          render: (row) => escapeHtml(row.tenantId || 'global'),
        },
        {
          label: 'Status',
          render: (row) => makePill(row.isActive === false ? 'inactive' : 'active'),
        },
      ],
      rows: state.users.slice(0, 16),
    });
  }

  function renderAudit() {
    const dataset = state.audit || {};
    const filters = state.auditFilters || {};
    const form = document.getElementById('ownerAuditQueryForm');
    if (form) {
      form.elements.view.value = filters.view || 'wallet';
      form.elements.userId.value = filters.userId || '';
      form.elements.query.value = filters.query || '';
      form.elements.windowMs.value = filters.windowMs == null ? '' : String(filters.windowMs);
    }

    renderStats(
      document.getElementById('ownerAuditStats'),
      (Array.isArray(dataset.cards) ? dataset.cards : []).map(([label, value]) => ({
        kicker: String(dataset.view || 'audit').toUpperCase(),
        value: String(value ?? '-'),
        title: String(label || 'Audit summary'),
        detail: `Returned ${formatMetricValue(dataset.returned, 'integer')} of ${formatMetricValue(dataset.total, 'integer')} rows.`,
      }))
    );

    const rows = Array.isArray(dataset.tableRows) ? dataset.tableRows : [];
    const keys = rows.length > 0 ? Object.keys(rows[0]).slice(0, 6) : [];
    renderTable(document.getElementById('ownerAuditTable'), {
      emptyText: 'No audit rows matched the current filters.',
      columns: keys.map((key) => ({
        label: key,
        render: (row) => `<span class="${/(?:id|code|reference)/i.test(key) ? 'code' : ''}">${escapeHtml(formatAuditCell(key, row?.[key]))}</span>`,
      })),
      rows,
    });
  }

  function renderRecovery() {
    const restore = state.restoreState || {};
    const warnings = Array.isArray(restore.warnings) ? restore.warnings.length : 0;
    renderStats(document.getElementById('ownerRestoreStateStats'), [
      {
        kicker: 'Restore',
        value: restore.status || 'idle',
        title: 'Current restore state',
        detail: restore.lastError || 'No active restore incident.',
        tags: [
          `rollback ${restore.rollbackStatus || 'none'}`,
          `warnings ${formatNumber(warnings, '0')}`,
        ],
      },
      {
        kicker: 'Backup',
        value: restore.backup || 'none',
        title: 'Target backup',
        detail: restore.startedAt ? `Started ${formatDateTime(restore.startedAt)}` : 'No restore currently running.',
      },
      {
        kicker: 'Preview',
        value: restore.previewBackup || state.restorePreview?.backup || 'none',
        title: 'Latest preview source',
        detail: restore.previewExpiresAt
          ? `Preview expires ${formatDateTime(restore.previewExpiresAt)}`
          : 'Run a dry-run preview before using the full recovery workbench.',
      },
      {
        kicker: 'Verification',
        value: restore.verification?.ready === true ? 'ready' : 'pending',
        title: 'Latest verification state',
        detail: restore.verification?.checkedAt
          ? `Checked ${formatDateTime(restore.verification.checkedAt)}`
          : 'Verification has not run in this restore cycle yet.',
      },
    ]);

    renderTable(document.getElementById('ownerBackupTable'), {
      emptyText: 'No backup files found.',
      columns: [
        {
          label: 'Backup',
          render: (row) => [
            `<strong>${escapeHtml(row.id || row.file || '-')}</strong>`,
            `<div class="muted code">${escapeHtml(row.file || '-')}</div>`,
          ].join(''),
        },
        {
          label: 'Size',
          render: (row) => `${formatNumber(Math.round(Number(row.sizeBytes || 0) / 1024), '0')} KB`,
        },
        {
          label: 'Updated',
          render: (row) => `<span class="code">${escapeHtml(formatDateTime(row.updatedAt || row.createdAt))}</span>`,
        },
      ],
      rows: state.backupFiles.slice(0, 18),
    });

    const backupSelect = document.getElementById('ownerBackupSelect');
    if (backupSelect) {
      const current = String(backupSelect.value || '').trim();
      const options = [
        '<option value="">Choose a backup</option>',
        ...state.backupFiles.map((row) => {
          const file = String(row.file || row.id || '').trim();
          const selected = file && file === current ? ' selected' : '';
          return `<option value="${escapeHtml(file)}"${selected}>${escapeHtml(file)} | ${escapeHtml(formatDateTime(row.updatedAt || row.createdAt))}</option>`;
        }),
      ];
      backupSelect.innerHTML = options.join('');
      if (current && state.backupFiles.some((row) => String(row.file || row.id || '').trim() === current)) {
        backupSelect.value = current;
      }
    }

    const previewWrap = document.getElementById('ownerBackupPreviewResult');
    const preview = state.restorePreview;
    if (!previewWrap) return;
    if (!preview) {
      previewWrap.innerHTML = '<div class="empty-state">Run a dry-run restore preview to inspect counts, warnings, and verification checks.</div>';
      return;
    }

    const warningItems = Array.isArray(preview.warnings) ? preview.warnings : [];
    const verificationChecks = Array.isArray(preview.verificationPlan?.checks) ? preview.verificationPlan.checks : [];
    previewWrap.innerHTML = [
      '<article class="panel-card">',
      `<h3>${escapeHtml(preview.backup || 'Restore preview')}</h3>`,
      `<p>${escapeHtml(preview.note || 'Dry-run preview generated from the selected backup.')}</p>`,
      `<div class="tag-row">${[
        `schema ${preview.schemaVersion || '-'}`,
        preview.compatibilityMode || 'current',
        preview.previewExpiresAt ? `expires ${formatDateTime(preview.previewExpiresAt)}` : 'preview ready',
      ].map((tag) => makePill(tag, 'info')).join('')}</div>`,
      '</article>',
      '<article class="panel-card">',
      '<h3>Preview Counts</h3>',
      `<div class="tag-row">${[
        `target ${formatNumber(Object.keys(preview.counts || {}).length, '0')} groups`,
        `current ${formatNumber(Object.keys(preview.currentCounts || {}).length, '0')} groups`,
        `warnings ${formatNumber(warningItems.length, '0')}`,
      ].map((tag) => makePill(tag)).join('')}</div>`,
      warningItems.length
        ? `<div class="list-feed">${warningItems.slice(0, 6).map((item) => `<article class="feed-item"><strong>${escapeHtml(item)}</strong></article>`).join('')}</div>`
        : '<div class="empty-state">No preview warnings.</div>',
      '</article>',
      '<article class="panel-card">',
      '<h3>Verification Plan</h3>',
      verificationChecks.length
        ? `<div class="list-feed">${verificationChecks.slice(0, 8).map((item) => [
            '<article class="feed-item">',
            `<strong>${escapeHtml(item.label || item.id || 'check')}</strong>`,
            item.detail ? `<div class="muted">${escapeHtml(item.detail)}</div>` : '',
            '</article>',
          ].join('')).join('')}</div>`
        : '<div class="empty-state">No verification plan entries were returned.</div>',
      '<div class="button-row"><a class="ghost-link" href="/admin/legacy?tab=danger">Use legacy recovery workbench for actual restore</a></div>',
      '</article>',
    ].join('');
  }

  function fillOwnerConfigForms() {
    const runtimeForm = document.getElementById('ownerRuntimeFlagsForm');
    if (runtimeForm) {
      runtimeForm.elements.DISCORD_GUILD_ID.value = getControlEnvValue('root', 'DISCORD_GUILD_ID', '');
      runtimeForm.elements.DELIVERY_EXECUTION_MODE.value = getControlEnvValue('root', 'DELIVERY_EXECUTION_MODE', 'rcon') || 'rcon';
      runtimeForm.elements.BOT_ENABLE_ADMIN_WEB.value = getControlEnvValue('root', 'BOT_ENABLE_ADMIN_WEB', 'true') || 'true';
      runtimeForm.elements.BOT_ENABLE_DELIVERY_WORKER.value = getControlEnvValue('root', 'BOT_ENABLE_DELIVERY_WORKER', 'false') || 'false';
      runtimeForm.elements.WORKER_ENABLE_DELIVERY.value = getControlEnvValue('root', 'WORKER_ENABLE_DELIVERY', 'true') || 'true';
      runtimeForm.elements.BOT_ENABLE_SCUM_WEBHOOK.value = getControlEnvValue('root', 'BOT_ENABLE_SCUM_WEBHOOK', 'true') || 'true';
      runtimeForm.elements.SCUM_WATCHER_ENABLED.value = getControlEnvValue('root', 'SCUM_WATCHER_ENABLED', 'true') || 'true';
    }

    const portalForm = document.getElementById('ownerPortalAccessForm');
    if (portalForm) {
      portalForm.elements.WEB_PORTAL_BASE_URL.value = getControlEnvValue('portal', 'WEB_PORTAL_BASE_URL', '');
      portalForm.elements.WEB_PORTAL_PLAYER_OPEN_ACCESS.value = getControlEnvValue('portal', 'WEB_PORTAL_PLAYER_OPEN_ACCESS', 'false') || 'false';
      portalForm.elements.WEB_PORTAL_REQUIRE_GUILD_MEMBER.value = getControlEnvValue('portal', 'WEB_PORTAL_REQUIRE_GUILD_MEMBER', 'true') || 'true';
      portalForm.elements.ADMIN_WEB_2FA_ENABLED.value = getControlEnvValue('root', 'ADMIN_WEB_2FA_ENABLED', 'true') || 'true';
      portalForm.elements.ADMIN_WEB_STEP_UP_ENABLED.value = getControlEnvValue('root', 'ADMIN_WEB_STEP_UP_ENABLED', 'true') || 'true';
      portalForm.elements.WEB_PORTAL_SECURE_COOKIE.value = getControlEnvValue('portal', 'WEB_PORTAL_SECURE_COOKIE', 'true') || 'true';
      portalForm.elements.ADMIN_WEB_ALLOWED_ORIGINS.value = getControlEnvValue('root', 'ADMIN_WEB_ALLOWED_ORIGINS', '');
    }

    const rconForm = document.getElementById('ownerRconAgentForm');
    if (rconForm) {
      rconForm.elements.RCON_HOST.value = getControlEnvValue('root', 'RCON_HOST', '');
      rconForm.elements.RCON_PORT.value = getControlEnvValue('root', 'RCON_PORT', '');
      rconForm.elements.RCON_PROTOCOL.value = getControlEnvValue('root', 'RCON_PROTOCOL', '');
      rconForm.elements.SCUM_CONSOLE_AGENT_BASE_URL.value = getControlEnvValue('root', 'SCUM_CONSOLE_AGENT_BASE_URL', '');
      rconForm.elements.SCUM_CONSOLE_AGENT_REQUIRED.value = getControlEnvValue('root', 'SCUM_CONSOLE_AGENT_REQUIRED', 'false') || 'false';
      rconForm.elements.RCON_PASSWORD.value = '';
      rconForm.elements.SCUM_CONSOLE_AGENT_TOKEN.value = '';
    }

    const securityForm = document.getElementById('ownerSecurityPolicyForm');
    if (securityForm) {
      securityForm.elements.ADMIN_WEB_SESSION_TTL_HOURS.value = getControlEnvValue('root', 'ADMIN_WEB_SESSION_TTL_HOURS', '');
      securityForm.elements.ADMIN_WEB_SESSION_IDLE_MINUTES.value = getControlEnvValue('root', 'ADMIN_WEB_SESSION_IDLE_MINUTES', '');
      securityForm.elements.ADMIN_WEB_SESSION_MAX_PER_USER.value = getControlEnvValue('root', 'ADMIN_WEB_SESSION_MAX_PER_USER', '');
      securityForm.elements.ADMIN_WEB_LOGIN_WINDOW_MS.value = getControlEnvValue('root', 'ADMIN_WEB_LOGIN_WINDOW_MS', '');
      securityForm.elements.ADMIN_WEB_LOGIN_MAX_ATTEMPTS.value = getControlEnvValue('root', 'ADMIN_WEB_LOGIN_MAX_ATTEMPTS', '');
      securityForm.elements.ADMIN_WEB_LOGIN_SPIKE_WINDOW_MS.value = getControlEnvValue('root', 'ADMIN_WEB_LOGIN_SPIKE_WINDOW_MS', '');
      securityForm.elements.ADMIN_WEB_LOGIN_SPIKE_THRESHOLD.value = getControlEnvValue('root', 'ADMIN_WEB_LOGIN_SPIKE_THRESHOLD', '');
      securityForm.elements.ADMIN_WEB_LOGIN_SPIKE_IP_THRESHOLD.value = getControlEnvValue('root', 'ADMIN_WEB_LOGIN_SPIKE_IP_THRESHOLD', '');
      securityForm.elements.ADMIN_WEB_LOGIN_SPIKE_ALERT_COOLDOWN_MS.value = getControlEnvValue('root', 'ADMIN_WEB_LOGIN_SPIKE_ALERT_COOLDOWN_MS', '');
    }

    const monitoringForm = document.getElementById('ownerMonitoringPolicyForm');
    if (monitoringForm) {
      monitoringForm.elements.DELIVERY_QUEUE_ALERT_THRESHOLD.value = getControlEnvValue('root', 'DELIVERY_QUEUE_ALERT_THRESHOLD', '');
      monitoringForm.elements.DELIVERY_FAIL_RATE_ALERT_THRESHOLD.value = getControlEnvValue('root', 'DELIVERY_FAIL_RATE_ALERT_THRESHOLD', '');
      monitoringForm.elements.SCUM_QUEUE_ALERT_THRESHOLD.value = getControlEnvValue('root', 'SCUM_QUEUE_ALERT_THRESHOLD', '');
      monitoringForm.elements.SCUM_ALERT_COOLDOWN_MS.value = getControlEnvValue('root', 'SCUM_ALERT_COOLDOWN_MS', '');
      monitoringForm.elements.SCUM_WEBHOOK_ERROR_ALERT_THRESHOLD.value = getControlEnvValue('root', 'SCUM_WEBHOOK_ERROR_ALERT_THRESHOLD', '');
      monitoringForm.elements.SCUM_WEBHOOK_ERROR_ALERT_MIN_ATTEMPTS.value = getControlEnvValue('root', 'SCUM_WEBHOOK_ERROR_ALERT_MIN_ATTEMPTS', '');
      monitoringForm.elements.SCUM_WEBHOOK_ERROR_ALERT_WINDOW_MS.value = getControlEnvValue('root', 'SCUM_WEBHOOK_ERROR_ALERT_WINDOW_MS', '');
    }
  }

  async function saveControlEnvPatch(patch, contextLabel) {
    const response = await api('/admin/api/control-panel/env', {
      method: 'POST',
      body: patch,
    });
    const reloadRequired = response?.reloadRequired === true;
    const restartTarget = String(document.getElementById('ownerRestartTarget')?.value || '').trim();
    let restarted = false;
    if (reloadRequired && restartTarget) {
      const services = restartTarget === 'all'
        ? (Array.isArray(state.controlPanelSettings?.managedServices)
          ? state.controlPanelSettings.managedServices.map((row) => row.key).filter(Boolean)
          : [])
        : [restartTarget];
      if (services.length > 0) {
        await api('/admin/api/runtime/restart-service', {
          method: 'POST',
          body: services.length === 1 ? { service: services[0] } : { services },
        });
        restarted = true;
      }
    }
    showToast(
      reloadRequired
        ? `${contextLabel} saved${restarted ? ' and restarted selected runtime' : ' (restart still required)'}.`
        : `${contextLabel} saved.`,
      'success'
    );
  }

  function renderControlCenter() {
    const settings = state.controlPanelSettings || {};
    const rootCatalog = Array.isArray(settings.envCatalog?.root) ? settings.envCatalog.root : [];
    const portalCatalog = Array.isArray(settings.envCatalog?.portal) ? settings.envCatalog.portal : [];
    const managedServices = Array.isArray(settings.managedServices) ? settings.managedServices : [];
    const commands = Array.isArray(settings.commands) ? settings.commands : [];
    const editableCount = [...rootCatalog, ...portalCatalog].filter((row) => row.editable !== false).length;
    const reloadSafeCount = [...rootCatalog, ...portalCatalog].filter((row) => row.applyMode === 'reload-safe').length;

    renderStats(document.getElementById('ownerControlSummaryStats'), [
      {
        kicker: 'Env Catalog',
        value: formatNumber(rootCatalog.length + portalCatalog.length, '0'),
        title: 'Editable env keys',
        detail: `${formatNumber(editableCount, '0')} keys writable from the owner scope.`,
      },
      {
        kicker: 'Reload Safe',
        value: formatNumber(reloadSafeCount, '0'),
        title: 'Hot-reload capable keys',
        detail: 'Fields marked reload-safe can avoid full runtime restarts.',
      },
      {
        kicker: 'Runtime',
        value: formatNumber(managedServices.length, '0'),
        title: 'Managed services',
        detail: 'Services available for guarded restart from this surface.',
      },
      {
        kicker: 'Commands',
        value: formatNumber(commands.length, '0'),
        title: 'Registered slash commands',
        detail: `${formatNumber(commands.filter((row) => row.disabled).length, '0')} disabled entries in current config.`,
      },
    ]);

    renderTable(document.getElementById('ownerManagedServiceTable'), {
      emptyText: 'No managed services found.',
      columns: [
        {
          label: 'Service',
          render: (row) => [
            `<strong>${escapeHtml(row.label || row.key || '-')}</strong>`,
            row.pm2Name ? `<div class="muted code">${escapeHtml(row.pm2Name)}</div>` : '',
          ].join(''),
        },
        {
          label: 'Key',
          render: (row) => `<span class="code">${escapeHtml(row.key || '-')}</span>`,
        },
        {
          label: 'Required',
          render: (row) => makePill(row.required === false ? 'optional' : 'required', row.required === false ? 'info' : 'success'),
        },
      ],
      rows: managedServices,
    });

    const restartTarget = document.getElementById('ownerRestartTarget');
    if (restartTarget) {
      const current = String(restartTarget.value || '').trim();
      restartTarget.innerHTML = [
        '<option value="">Select a runtime service</option>',
        '<option value="all">All managed services</option>',
        ...managedServices.map((row) => {
          const key = String(row.key || '').trim();
          const selected = key && key === current ? ' selected' : '';
          return `<option value="${escapeHtml(key)}"${selected}>${escapeHtml(row.label || key)} (${escapeHtml(row.pm2Name || key)})</option>`;
        }),
      ].join('');
      if (current && (current === 'all' || managedServices.some((row) => row.key === current))) {
        restartTarget.value = current;
      }
    }

    fillOwnerConfigForms();
  }

  function renderLiveFeed() {
    renderList(
      document.getElementById('ownerLiveFeed'),
      state.liveEvents.slice(0, 16),
      (item) => [
        `<article class="timeline-item ${escapeHtml(item.tone || 'info')}">`,
        `<div class="feed-meta">${makePill(item.type || 'event')} <span class="code">${escapeHtml(formatDateTime(item.at))}</span></div>`,
        `<strong>${escapeHtml(item.title || 'Live event')}</strong>`,
        item.detail ? `<div class="muted">${escapeHtml(item.detail)}</div>` : '',
        '</article>',
      ].join(''),
      'Waiting for live events.'
    );
  }

  function renderGovernance() {
    const settings = state.controlPanelSettings || {};
    const envCatalogCount =
      (Array.isArray(settings.envCatalog?.root) ? settings.envCatalog.root.length : 0)
      + (Array.isArray(settings.envCatalog?.portal) ? settings.envCatalog.portal.length : 0);
    document.getElementById('ownerGovernanceCards').innerHTML = [
      {
        title: 'Global Configuration',
        text: `Environment editing, runtime flags, and policy changes remain owner-only. Current control catalog exposes ${formatNumber(envCatalogCount, '0')} env keys across root and portal scopes.`,
        action: '<a class="ghost-link" href="/admin/legacy?tab=control">Open global config</a>',
      },
      {
        title: 'Recovery and Rollback',
        text: `Backup, restore preview, and rollback remain high-friction workflows with explicit confirmation. Known backups: ${formatNumber(state.backupFiles.length, '0')}.`,
        action: '<a class="ghost-link" href="/admin/legacy?tab=danger">Open recovery area</a>',
      },
      {
        title: 'Tenant Lifecycle',
        text: `Provision tenants, subscriptions, API keys, webhooks, and licensing from the platform workbench. Current fleet footprint: ${formatNumber(state.tenants.length, '0')} tenants, ${formatNumber(state.subscriptions.length, '0')} subscriptions.`,
        action: '<a class="ghost-link" href="/admin/legacy?tab=platform">Open platform center</a>',
      },
      {
        title: 'Security Audit',
        text: `Review role matrix, request anomalies, session posture, and security events from the security center. Active sessions visible here: ${formatNumber(state.sessions.length, '0')}.`,
        action: '<a class="ghost-link" href="/admin/legacy?tab=auth">Open security center</a>',
      },
    ].map((card) => [
      '<article class="panel-card">',
      `<h3>${escapeHtml(card.title)}</h3>`,
      `<p>${escapeHtml(card.text)}</p>`,
      card.action,
      '</article>',
    ].join('')).join('');
  }

  function renderAll() {
    const runtimeRows = normalizeRuntimeRows(state.runtimeSupervisor);
    const degraded = runtimeRows.filter((row) => {
      const status = String(row.status || '').trim().toLowerCase();
      return status && status !== 'ready';
    }).length;
    const unresolvedCount = state.notifications.length;
    setBanner(
      state.me?.user ? `Signed in as ${state.me.user}` : 'Owner console ready',
      'Platform-wide operations are isolated from tenant-facing work. Use this surface for global health, security, and governance.',
      [
        `role ${state.me?.role || '-'}`,
        `tenants ${formatNumber(state.tenants.length, '0')}`,
        `alerts ${formatNumber(unresolvedCount, '0')}`,
        `degraded ${formatNumber(degraded, '0')}`,
      ],
      degraded > 0 || unresolvedCount > 0 ? 'warning' : 'success'
    );
    renderOverview();
    renderTenantTable();
    renderFleetAssets();
    renderRuntimeTables();
    renderObservability();
    renderNotifications();
    renderRequestFeed();
    renderSecurity();
    renderAccessCenter();
    renderAudit();
    renderLiveFeed();
    renderRecovery();
    renderControlCenter();
    renderGovernance();
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
      || payload?.payload?.runtimeKey
      || '';
    state.liveEvents.unshift({
      type,
      title,
      detail,
      tone: type.includes('dead-letter') || type.includes('ops-alert')
        ? 'danger'
        : type.includes('delivery') || type.includes('restart')
          ? 'warning'
          : type === 'connected'
            ? 'success'
            : 'info',
      at: payload?.at || new Date().toISOString(),
    });
    state.liveEvents = state.liveEvents.slice(0, 24);
    renderLiveFeed();
  }

  function connectLive() {
    if (liveConnection) return;
    liveConnection = connectLiveStream({
      events: [
        'connected',
        'heartbeat',
        'admin-action',
        'platform-event',
        'scum-status',
        'scum-player',
        'scum-kill',
        'scum-restart',
        'delivery-queue',
        'delivery-dead-letter',
        'ops-alert',
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
          payload: { summary: 'Owner live stream connected' },
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
    const refreshButton = document.getElementById('ownerRefreshBtn');
    if (!options.silent) {
      setBusy(refreshButton, true, 'Refreshing...');
    }
    try {
      const me = await api('/admin/api/me');
      if (me?.tenantId) {
        window.location.href = '/tenant';
        return;
      }

      const [
        overview,
        observability,
        reconcile,
        opsState,
        tenants,
        subscriptions,
        licenses,
        apiKeys,
        webhooks,
        agents,
        notifications,
        securityEvents,
        runtimeSupervisor,
        dashboardCards,
        requestLogs,
        roleMatrix,
        controlPanelSettings,
        restoreState,
        backupFiles,
        sessions,
        users,
        audit,
      ] = await Promise.all([
        safeApi('/admin/api/platform/overview', {}),
        safeApi('/admin/api/observability?windowMs=21600000', {}),
        safeApi('/admin/api/platform/reconcile?windowMs=3600000&pendingOverdueMs=1200000', {}),
        safeApi('/admin/api/platform/ops-state', {}),
        safeApi('/admin/api/platform/tenants?limit=20', []),
        safeApi('/admin/api/platform/subscriptions?limit=12', []),
        safeApi('/admin/api/platform/licenses?limit=12', []),
        safeApi('/admin/api/platform/apikeys?limit=12', []),
        safeApi('/admin/api/platform/webhooks?limit=12', []),
        safeApi('/admin/api/platform/agents?limit=20', []),
        safeApi('/admin/api/notifications?acknowledged=false&limit=10', { items: [] }),
        safeApi('/admin/api/auth/security-events?limit=10', []),
        safeApi('/admin/api/runtime/supervisor', null),
        safeApi('/admin/api/dashboard/cards', null),
        safeApi('/admin/api/observability/requests?limit=8&onlyErrors=true', { metrics: {}, items: [] }),
        safeApi('/admin/api/auth/role-matrix', { summary: {}, permissions: [] }),
        safeApi('/admin/api/control-panel/settings', {}),
        safeApi('/admin/api/backup/restore/status', {}),
        safeApi('/admin/api/backup/list', []),
        safeApi('/admin/api/auth/sessions', []),
        safeApi('/admin/api/auth/users', []),
        safeApi(`/admin/api/audit/query?${buildAuditQueryString({
          view: state.auditFilters.view,
          userId: state.auditFilters.userId,
          q: state.auditFilters.query,
          windowMs: state.auditFilters.windowMs,
          pageSize: 8,
        })}`, { cards: [], tableRows: [] }),
      ]);

      state.me = me;
      state.overview = overview || {};
      state.observability = observability || {};
      state.reconcile = reconcile || {};
      state.opsState = opsState || {};
      state.tenants = Array.isArray(tenants) ? tenants : [];
      state.subscriptions = Array.isArray(subscriptions) ? subscriptions : [];
      state.licenses = Array.isArray(licenses) ? licenses : [];
      state.apiKeys = Array.isArray(apiKeys) ? apiKeys : [];
      state.webhooks = Array.isArray(webhooks) ? webhooks : [];
      state.agents = Array.isArray(agents) ? agents : [];
      state.notifications = Array.isArray(notifications?.items) ? notifications.items : [];
      state.securityEvents = Array.isArray(securityEvents) ? securityEvents : [];
      state.runtimeSupervisor = runtimeSupervisor;
      state.dashboardCards = dashboardCards;
      state.requestLogs = requestLogs || { metrics: {}, items: [] };
      state.roleMatrix = roleMatrix || { summary: {}, permissions: [] };
      state.controlPanelSettings = controlPanelSettings || {};
      state.restoreState = restoreState || {};
      state.backupFiles = Array.isArray(backupFiles) ? backupFiles : [];
      state.sessions = Array.isArray(sessions) ? sessions : [];
      state.users = Array.isArray(users) ? users : [];
      state.audit = audit || { cards: [], tableRows: [] };
      renderAll();
      connectLive();
    } catch (error) {
      setBanner(
        'Owner console failed to load',
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

  async function runMonitoring() {
    const button = document.getElementById('ownerMonitoringBtn');
    setBusy(button, true, 'Running...');
    try {
      await api('/admin/api/platform/monitoring/run', {
        method: 'POST',
        body: {},
      });
      showToast('Platform monitoring cycle completed.', 'success');
      await refreshSurface();
    } catch (error) {
      setBanner('Monitoring run failed', String(error.message || error), ['monitoring'], 'danger');
    } finally {
      setBusy(button, false);
    }
  }

  async function clearAlerts() {
    const button = document.getElementById('ownerClearAlertsBtn');
    if (!window.confirm('Clear current admin notifications?')) {
      return;
    }
    setBusy(button, true, 'Clearing...');
    try {
      await api('/admin/api/notifications/clear', {
        method: 'POST',
        body: {},
      });
      showToast('Owner notifications cleared.', 'success');
      await refreshSurface();
    } catch (error) {
      setBanner('Clear alerts failed', String(error.message || error), ['alerts'], 'danger');
    } finally {
      setBusy(button, false);
    }
  }

  async function handleRestartSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const target = String(form.elements.service.value || '').trim();
    if (!target) {
      setBanner('Restart target missing', 'Choose a managed service before restarting runtime.', ['runtime'], 'danger');
      return;
    }
    const managedServices = Array.isArray(state.controlPanelSettings?.managedServices)
      ? state.controlPanelSettings.managedServices
      : [];
    const services = target === 'all'
      ? managedServices.map((row) => row.key).filter(Boolean)
      : [target];
    if (services.length === 0) {
      setBanner('Restart target invalid', 'No managed service keys were resolved from the current control panel settings.', ['runtime'], 'danger');
      return;
    }
    if (!window.confirm(`Restart ${target === 'all' ? 'all managed services' : target}?`)) return;
    try {
      setBusy(button, true, 'Restarting...');
      await api('/admin/api/runtime/restart-service', {
        method: 'POST',
        body: services.length === 1 ? { service: services[0] } : { services },
      });
      showToast('Runtime restart request completed.', 'success');
      await refreshSurface();
    } catch (error) {
      setBanner('Runtime restart failed', String(error.message || error), ['runtime'], 'danger');
    } finally {
      setBusy(button, false);
    }
  }

  async function handleBackupCreateSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const note = String(form.elements.note.value || '').trim();
    const includeSnapshot = String(form.elements.includeSnapshot.value || 'true') !== 'false';
    if (!window.confirm('Create a new platform backup now?')) return;
    try {
      setBusy(button, true, 'Creating...');
      await api('/admin/api/backup/create', {
        method: 'POST',
        body: {
          note: note || null,
          includeSnapshot,
        },
      });
      form.reset();
      showToast('Backup created successfully.', 'success');
      await refreshSurface();
    } catch (error) {
      setBanner('Backup creation failed', String(error.message || error), ['backup'], 'danger');
    } finally {
      setBusy(button, false);
    }
  }

  async function handleBackupPreviewSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const backup = String(form.elements.backup.value || '').trim();
    if (!backup) {
      setBanner('Backup preview is incomplete', 'Choose a backup file before running a dry-run preview.', ['backup'], 'danger');
      return;
    }
    try {
      setBusy(button, true, 'Previewing...');
      const preview = await api('/admin/api/backup/restore', {
        method: 'POST',
        body: {
          backup,
          dryRun: true,
        },
      });
      state.restorePreview = preview || null;
      renderRecovery();
      showToast('Dry-run restore preview completed.', 'success');
    } catch (error) {
      state.restorePreview = null;
      renderRecovery();
      setBanner('Restore preview failed', String(error.message || error), ['backup'], 'danger');
    } finally {
      setBusy(button, false);
    }
  }

  async function handleTenantCreateSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const payload = {
      id: String(form.elements.id.value || '').trim(),
      slug: String(form.elements.slug.value || '').trim(),
      name: String(form.elements.name.value || '').trim(),
      type: String(form.elements.type.value || '').trim(),
      status: String(form.elements.status.value || '').trim(),
      locale: String(form.elements.locale.value || '').trim(),
      ownerName: String(form.elements.ownerName.value || '').trim(),
      ownerEmail: String(form.elements.ownerEmail.value || '').trim(),
      parentTenantId: String(form.elements.parentTenantId.value || '').trim() || null,
      metadata: null,
    };
    if (!payload.id || !payload.slug || !payload.name || !payload.type || !payload.status || !payload.locale || !payload.ownerName || !payload.ownerEmail) {
      setBanner('Tenant creation is incomplete', 'Fill all required tenant identity and owner fields before creating the tenant record.', ['tenant'], 'danger');
      return;
    }
    try {
      payload.metadata = parseOptionalJson(form.elements.metadata.value, 'Metadata');
      if (!window.confirm(`Create tenant ${payload.slug}?`)) return;
      setBusy(button, true, 'Creating...');
      await api('/admin/api/platform/tenant', {
        method: 'POST',
        body: payload,
      });
      form.reset();
      showToast('Tenant record created successfully.', 'success');
      await refreshSurface();
    } catch (error) {
      setBanner('Tenant creation failed', String(error.message || error), ['tenant'], 'danger');
    } finally {
      setBusy(button, false);
    }
  }

  async function handleSubscriptionSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const tenantId = String(form.elements.tenantId.value || '').trim();
    const planId = String(form.elements.planId.value || '').trim();
    if (!tenantId || !planId) {
      setBanner('Subscription form is incomplete', 'Choose a tenant and provide a plan id before creating a subscription.', ['subscription'], 'danger');
      return;
    }
    try {
      if (!window.confirm(`Create subscription for ${tenantId}?`)) return;
      setBusy(button, true, 'Creating...');
      const result = await api('/admin/api/platform/subscription', {
        method: 'POST',
        body: {
          id: makeClientId('sub'),
          tenantId,
          planId,
          billingCycle: String(form.elements.billingCycle.value || 'monthly').trim(),
          status: String(form.elements.status.value || 'active').trim(),
          currency: String(form.elements.currency.value || 'THB').trim(),
          amountCents: Number(form.elements.amountCents.value || 0),
          intervalDays: form.elements.intervalDays.value ? Number(form.elements.intervalDays.value) : null,
          startedAt: String(form.elements.startedAt.value || '').trim() || null,
          renewsAt: String(form.elements.renewsAt.value || '').trim() || null,
          externalRef: String(form.elements.externalRef.value || '').trim() || null,
        },
      });
      state.assetResult = {
        kind: 'subscription',
        title: 'Subscription created',
        detail: 'The tenant subscription record was created successfully.',
        tenantId,
        createdAt: new Date().toISOString(),
        rows: [
          { label: 'Subscription ID', value: result.id || '-', code: true },
          { label: 'Plan ID', value: result.planId || planId, code: true },
          { label: 'Status', value: result.status || '-', code: false },
          { label: 'Renews At', value: formatDateTime(result.renewsAt), code: false },
        ],
      };
      form.reset();
      form.elements.billingCycle.value = 'monthly';
      form.elements.status.value = 'active';
      showToast('Subscription created.', 'success');
      await refreshSurface();
    } catch (error) {
      setBanner('Subscription create failed', String(error.message || error), ['subscription'], 'danger');
    } finally {
      setBusy(button, false);
    }
  }

  async function handleLicenseSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const tenantId = String(form.elements.tenantId.value || '').trim();
    if (!tenantId) {
      setBanner('License form is incomplete', 'Choose a tenant before issuing a license.', ['license'], 'danger');
      return;
    }
    try {
      if (!window.confirm(`Issue license for ${tenantId}?`)) return;
      setBusy(button, true, 'Issuing...');
      const result = await api('/admin/api/platform/license', {
        method: 'POST',
        body: {
          id: makeClientId('license'),
          tenantId,
          licenseKey: String(form.elements.licenseKey.value || '').trim(),
          status: String(form.elements.status.value || 'active').trim(),
          seats: Number(form.elements.seats.value || 1),
          issuedAt: String(form.elements.issuedAt.value || '').trim() || null,
          expiresAt: String(form.elements.expiresAt.value || '').trim() || null,
          legalDocVersion: String(form.elements.legalDocVersion.value || 'v1').trim(),
        },
      });
      state.assetResult = {
        kind: 'license',
        title: 'License issued',
        detail: 'The tenant license record was created successfully.',
        tenantId,
        createdAt: new Date().toISOString(),
        rows: [
          { label: 'License ID', value: result.id || '-', code: true },
          { label: 'License Key', value: result.licenseKey || '-', code: true },
          { label: 'Seats', value: String(result.seats || '-'), code: false },
          { label: 'Expires At', value: formatDateTime(result.expiresAt), code: false },
        ],
      };
      form.reset();
      form.elements.status.value = 'active';
      form.elements.seats.value = '1';
      showToast('License issued.', 'success');
      await refreshSurface();
    } catch (error) {
      setBanner('License issue failed', String(error.message || error), ['license'], 'danger');
    } finally {
      setBusy(button, false);
    }
  }

  async function handleApiKeySubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const tenantId = String(form.elements.tenantId.value || '').trim();
    const name = String(form.elements.name.value || '').trim();
    if (!tenantId || !name) {
      setBanner('API key form is incomplete', 'Choose a tenant and provide a key name before creating an API key.', ['apikey'], 'danger');
      return;
    }
    try {
      if (!window.confirm(`Create API key for ${tenantId}?`)) return;
      setBusy(button, true, 'Creating...');
      const result = await api('/admin/api/platform/apikey', {
        method: 'POST',
        body: {
          id: makeClientId('apikey'),
          tenantId,
          name,
          status: String(form.elements.status.value || 'active').trim(),
          scopes: String(form.elements.scopes.value || '').split(',').map((entry) => entry.trim()).filter(Boolean),
        },
      });
      state.assetResult = {
        kind: 'api-key',
        title: 'API key created',
        detail: 'Store the raw key now. It will not be shown again by the listing endpoint.',
        tenantId,
        createdAt: new Date().toISOString(),
        rows: [
          { label: 'API Key ID', value: result.apiKey?.id || result.id || '-', code: true },
          { label: 'Raw Key', value: result.rawKey || '-', code: true },
          { label: 'Scopes', value: Array.isArray(result.apiKey?.scopes) ? result.apiKey.scopes.join(', ') : String(form.elements.scopes.value || '').trim() || '-', code: false },
        ],
      };
      form.reset();
      form.elements.status.value = 'active';
      showToast('API key created.', 'success');
      await refreshSurface();
    } catch (error) {
      setBanner('API key create failed', String(error.message || error), ['apikey'], 'danger');
    } finally {
      setBusy(button, false);
    }
  }

  async function handleWebhookSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const tenantId = String(form.elements.tenantId.value || '').trim();
    const name = String(form.elements.name.value || '').trim();
    const targetUrl = String(form.elements.targetUrl.value || '').trim();
    if (!tenantId || !name || !targetUrl) {
      setBanner('Webhook form is incomplete', 'Choose a tenant and provide both name and target URL before creating a webhook.', ['webhook'], 'danger');
      return;
    }
    try {
      if (!window.confirm(`Create webhook for ${tenantId}?`)) return;
      setBusy(button, true, 'Creating...');
      const result = await api('/admin/api/platform/webhook', {
        method: 'POST',
        body: {
          id: makeClientId('hook'),
          tenantId,
          name,
          eventType: String(form.elements.eventType.value || '*').trim() || '*',
          targetUrl,
          secretValue: String(form.elements.secretValue.value || '').trim(),
          enabled: String(form.elements.enabled.value || 'true') === 'true',
        },
      });
      state.assetResult = {
        kind: 'webhook',
        title: 'Webhook created',
        detail: 'Store the webhook secret now if one was returned in full.',
        tenantId,
        createdAt: new Date().toISOString(),
        rows: [
          { label: 'Webhook ID', value: result.id || '-', code: true },
          { label: 'Target URL', value: result.targetUrl || targetUrl, code: false },
          { label: 'Event Type', value: result.eventType || String(form.elements.eventType.value || '*').trim(), code: false },
          { label: 'Secret', value: result.secretValue || String(form.elements.secretValue.value || '').trim() || '(generated and hidden)', code: true },
        ],
      };
      form.reset();
      form.elements.enabled.value = 'true';
      showToast('Webhook created.', 'success');
      await refreshSurface();
    } catch (error) {
      setBanner('Webhook create failed', String(error.message || error), ['webhook'], 'danger');
    } finally {
      setBusy(button, false);
    }
  }

  async function handleWebhookTestSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const tenantId = String(form.elements.tenantId.value || '').trim();
    if (!tenantId) {
      setBanner('Webhook test is incomplete', 'Choose a tenant before dispatching a webhook test event.', ['webhook'], 'danger');
      return;
    }
    try {
      if (!window.confirm(`Dispatch webhook test for ${tenantId}?`)) return;
      setBusy(button, true, 'Dispatching...');
      const payloadText = String(form.elements.payload.value || '').trim();
      const result = await api('/admin/api/platform/webhook/test', {
        method: 'POST',
        body: {
          tenantId,
          eventType: String(form.elements.eventType.value || 'platform.admin.test').trim() || 'platform.admin.test',
          payload: payloadText ? parseOptionalJson(payloadText, 'Webhook payload') : null,
        },
      });
      state.assetResult = {
        kind: 'webhook-test',
        title: 'Webhook test dispatched',
        detail: 'The platform dispatched a test webhook event for the selected tenant.',
        tenantId,
        createdAt: new Date().toISOString(),
        rows: [
          { label: 'Event Type', value: result.eventType || '-', code: false },
          { label: 'Result Count', value: String(Array.isArray(result.results) ? result.results.length : 0), code: false },
          { label: 'Dispatch Summary', value: Array.isArray(result.results) ? result.results.map((entry) => `${entry.name || entry.id || 'hook'}:${entry.ok === false ? 'fail' : 'ok'}`).join(', ') : '-', code: false },
        ],
      };
      showToast('Webhook test dispatched.', 'success');
      renderFleetAssets();
    } catch (error) {
      setBanner('Webhook test failed', String(error.message || error), ['webhook'], 'danger');
    } finally {
      setBusy(button, false);
    }
  }

  async function handleRuntimeFlagsSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    try {
      if (!window.confirm('Save runtime flag changes?')) return;
      setBusy(button, true, 'Saving...');
      await saveControlEnvPatch({
        root: {
          DISCORD_GUILD_ID: String(form.elements.DISCORD_GUILD_ID.value || '').trim(),
          DELIVERY_EXECUTION_MODE: String(form.elements.DELIVERY_EXECUTION_MODE.value || 'rcon').trim(),
          BOT_ENABLE_ADMIN_WEB: String(form.elements.BOT_ENABLE_ADMIN_WEB.value || 'true') === 'true',
          BOT_ENABLE_DELIVERY_WORKER: String(form.elements.BOT_ENABLE_DELIVERY_WORKER.value || 'false') === 'true',
          WORKER_ENABLE_DELIVERY: String(form.elements.WORKER_ENABLE_DELIVERY.value || 'true') === 'true',
          BOT_ENABLE_SCUM_WEBHOOK: String(form.elements.BOT_ENABLE_SCUM_WEBHOOK.value || 'true') === 'true',
          SCUM_WATCHER_ENABLED: String(form.elements.SCUM_WATCHER_ENABLED.value || 'true') === 'true',
        },
      }, 'Runtime Flags');
      await refreshSurface();
    } catch (error) {
      setBanner('Runtime flag save failed', String(error.message || error), ['config'], 'danger');
    } finally {
      setBusy(button, false);
    }
  }

  async function handlePortalAccessSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    try {
      if (!window.confirm('Save portal and access policy changes?')) return;
      setBusy(button, true, 'Saving...');
      await saveControlEnvPatch({
        root: {
          ADMIN_WEB_2FA_ENABLED: String(form.elements.ADMIN_WEB_2FA_ENABLED.value || 'true') === 'true',
          ADMIN_WEB_STEP_UP_ENABLED: String(form.elements.ADMIN_WEB_STEP_UP_ENABLED.value || 'true') === 'true',
          ADMIN_WEB_ALLOWED_ORIGINS: String(form.elements.ADMIN_WEB_ALLOWED_ORIGINS.value || '').trim(),
        },
        portal: {
          WEB_PORTAL_BASE_URL: String(form.elements.WEB_PORTAL_BASE_URL.value || '').trim(),
          WEB_PORTAL_PLAYER_OPEN_ACCESS: String(form.elements.WEB_PORTAL_PLAYER_OPEN_ACCESS.value || 'false') === 'true',
          WEB_PORTAL_REQUIRE_GUILD_MEMBER: String(form.elements.WEB_PORTAL_REQUIRE_GUILD_MEMBER.value || 'true') === 'true',
          WEB_PORTAL_SECURE_COOKIE: String(form.elements.WEB_PORTAL_SECURE_COOKIE.value || 'true') === 'true',
        },
      }, 'Portal + Access');
      await refreshSurface();
    } catch (error) {
      setBanner('Portal/access save failed', String(error.message || error), ['config'], 'danger');
    } finally {
      setBusy(button, false);
    }
  }

  async function handleRconAgentSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    try {
      if (!window.confirm('Save RCON and console-agent changes?')) return;
      setBusy(button, true, 'Saving...');
      await saveControlEnvPatch({
        root: {
          RCON_HOST: String(form.elements.RCON_HOST.value || '').trim(),
          RCON_PORT: String(form.elements.RCON_PORT.value || '').trim(),
          RCON_PROTOCOL: String(form.elements.RCON_PROTOCOL.value || '').trim(),
          RCON_PASSWORD: String(form.elements.RCON_PASSWORD.value || '').trim(),
          SCUM_CONSOLE_AGENT_BASE_URL: String(form.elements.SCUM_CONSOLE_AGENT_BASE_URL.value || '').trim(),
          SCUM_CONSOLE_AGENT_TOKEN: String(form.elements.SCUM_CONSOLE_AGENT_TOKEN.value || '').trim(),
          SCUM_CONSOLE_AGENT_REQUIRED: String(form.elements.SCUM_CONSOLE_AGENT_REQUIRED.value || 'false') === 'true',
        },
      }, 'RCON + Agent');
      await refreshSurface();
    } catch (error) {
      setBanner('RCON/agent save failed', String(error.message || error), ['config'], 'danger');
    } finally {
      setBusy(button, false);
    }
  }

  async function handleSecurityPolicySubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    try {
      if (!window.confirm('Save admin session and login policy changes?')) return;
      setBusy(button, true, 'Saving...');
      await saveControlEnvPatch({
        root: {
          ADMIN_WEB_SESSION_TTL_HOURS: String(form.elements.ADMIN_WEB_SESSION_TTL_HOURS.value || '').trim(),
          ADMIN_WEB_SESSION_IDLE_MINUTES: String(form.elements.ADMIN_WEB_SESSION_IDLE_MINUTES.value || '').trim(),
          ADMIN_WEB_SESSION_MAX_PER_USER: String(form.elements.ADMIN_WEB_SESSION_MAX_PER_USER.value || '').trim(),
          ADMIN_WEB_LOGIN_WINDOW_MS: String(form.elements.ADMIN_WEB_LOGIN_WINDOW_MS.value || '').trim(),
          ADMIN_WEB_LOGIN_MAX_ATTEMPTS: String(form.elements.ADMIN_WEB_LOGIN_MAX_ATTEMPTS.value || '').trim(),
          ADMIN_WEB_LOGIN_SPIKE_WINDOW_MS: String(form.elements.ADMIN_WEB_LOGIN_SPIKE_WINDOW_MS.value || '').trim(),
          ADMIN_WEB_LOGIN_SPIKE_THRESHOLD: String(form.elements.ADMIN_WEB_LOGIN_SPIKE_THRESHOLD.value || '').trim(),
          ADMIN_WEB_LOGIN_SPIKE_IP_THRESHOLD: String(form.elements.ADMIN_WEB_LOGIN_SPIKE_IP_THRESHOLD.value || '').trim(),
          ADMIN_WEB_LOGIN_SPIKE_ALERT_COOLDOWN_MS: String(form.elements.ADMIN_WEB_LOGIN_SPIKE_ALERT_COOLDOWN_MS.value || '').trim(),
        },
      }, 'Session + Login Policy');
      await refreshSurface();
    } catch (error) {
      setBanner('Security policy save failed', String(error.message || error), ['security'], 'danger');
    } finally {
      setBusy(button, false);
    }
  }

  async function handleMonitoringPolicySubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    try {
      if (!window.confirm('Save monitoring and alert threshold changes?')) return;
      setBusy(button, true, 'Saving...');
      await saveControlEnvPatch({
        root: {
          DELIVERY_QUEUE_ALERT_THRESHOLD: String(form.elements.DELIVERY_QUEUE_ALERT_THRESHOLD.value || '').trim(),
          DELIVERY_FAIL_RATE_ALERT_THRESHOLD: String(form.elements.DELIVERY_FAIL_RATE_ALERT_THRESHOLD.value || '').trim(),
          SCUM_QUEUE_ALERT_THRESHOLD: String(form.elements.SCUM_QUEUE_ALERT_THRESHOLD.value || '').trim(),
          SCUM_ALERT_COOLDOWN_MS: String(form.elements.SCUM_ALERT_COOLDOWN_MS.value || '').trim(),
          SCUM_WEBHOOK_ERROR_ALERT_THRESHOLD: String(form.elements.SCUM_WEBHOOK_ERROR_ALERT_THRESHOLD.value || '').trim(),
          SCUM_WEBHOOK_ERROR_ALERT_MIN_ATTEMPTS: String(form.elements.SCUM_WEBHOOK_ERROR_ALERT_MIN_ATTEMPTS.value || '').trim(),
          SCUM_WEBHOOK_ERROR_ALERT_WINDOW_MS: String(form.elements.SCUM_WEBHOOK_ERROR_ALERT_WINDOW_MS.value || '').trim(),
        },
      }, 'Monitoring + Alert Policy');
      await refreshSurface();
    } catch (error) {
      setBanner('Monitoring policy save failed', String(error.message || error), ['monitoring'], 'danger');
    } finally {
      setBusy(button, false);
    }
  }

  async function handleSessionRevokeSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const sessionId = String(form.elements.sessionId.value || '').trim();
    const targetUser = String(form.elements.targetUser.value || '').trim();
    const reason = String(form.elements.reason.value || '').trim() || 'manual-revoke';
    const current = String(form.elements.current.value || 'false') === 'true';
    if (!sessionId && !targetUser && !current) {
      setBanner('Session revoke target missing', 'Provide a session id, target user, or choose current session revoke.', ['security'], 'danger');
      return;
    }
    if (!window.confirm('Revoke the selected session scope?')) return;
    try {
      setBusy(button, true, 'Revoking...');
      await api('/admin/api/auth/session/revoke', {
        method: 'POST',
        body: { sessionId, targetUser, reason, current },
      });
      form.reset();
      form.elements.current.value = 'false';
      showToast('Session revoke completed.', 'success');
      await refreshSurface();
    } catch (error) {
      setBanner('Session revoke failed', String(error.message || error), ['security'], 'danger');
    } finally {
      setBusy(button, false);
    }
  }

  async function handleAdminUserSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const username = String(form.elements.username.value || '').trim();
    const role = String(form.elements.role.value || 'mod').trim();
    const tenantId = String(form.elements.tenantId.value || '').trim();
    const password = String(form.elements.password.value || '').trim();
    const isActive = String(form.elements.isActive.value || 'true') === 'true';
    if (!username) {
      setBanner('Admin user form is incomplete', 'Username is required before saving an admin user.', ['rbac'], 'danger');
      return;
    }
    if (!window.confirm(`Save admin user ${username}?`)) return;
    try {
      setBusy(button, true, 'Saving...');
      await api('/admin/api/auth/user', {
        method: 'POST',
        body: {
          username,
          role,
          tenantId: tenantId || null,
          password,
          isActive,
        },
      });
      form.reset();
      form.elements.role.value = 'mod';
      form.elements.isActive.value = 'true';
      showToast('Admin user saved.', 'success');
      await refreshSurface();
    } catch (error) {
      setBanner('Admin user save failed', String(error.message || error), ['rbac'], 'danger');
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
        showToast('Audit view loaded.', 'success');
      }
      return true;
    } catch (error) {
      state.audit = { cards: [], tableRows: [] };
      renderAudit();
      setBanner('Audit query failed', String(error.message || error), ['audit'], 'danger');
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
      view: state.auditFilters.view,
      userId: state.auditFilters.userId,
      q: state.auditFilters.query,
      windowMs: state.auditFilters.windowMs,
      format,
    });
    window.open(`/admin/api/audit/export?${queryString}`, '_blank', 'noopener,noreferrer');
  }

  const palette = wireCommandPalette({
    openButtonId: 'ownerPaletteBtn',
    closeButtonId: 'ownerPaletteCloseBtn',
    panelId: 'ownerPalette',
    searchId: 'ownerPaletteSearch',
    listId: 'ownerPaletteList',
    emptyId: 'ownerPaletteEmpty',
    getActions() {
      return [
        {
          label: 'Jump to Overview',
          meta: 'Owner sections',
          run: () => document.getElementById('overview')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
        },
        {
          label: 'Jump to Tenant Fleet',
          meta: 'Owner sections',
          run: () => document.getElementById('fleet')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
        },
        {
          label: 'Jump to Fleet Assets',
          meta: 'Owner sections',
          run: () => document.getElementById('fleet-assets')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
        },
        {
          label: 'Jump to Runtime Control',
          meta: 'Owner sections',
          run: () => document.getElementById('runtime')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
        },
        {
          label: 'Jump to Observability',
          meta: 'Owner sections',
          run: () => document.getElementById('observability')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
        },
        {
          label: 'Jump to Security + Audit',
          meta: 'Owner sections',
          run: () => document.getElementById('security')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
        },
        {
          label: 'Jump to Access Center',
          meta: 'Owner sections',
          run: () => document.getElementById('access')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
        },
        {
          label: 'Jump to Recovery',
          meta: 'Owner sections',
          run: () => document.getElementById('recovery')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
        },
        {
          label: 'Jump to Audit Trail',
          meta: 'Owner sections',
          run: () => document.getElementById('audit')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
        },
        {
          label: 'Jump to Control Center',
          meta: 'Owner sections',
          run: () => document.getElementById('control')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
        },
        {
          label: 'Focus Runtime Flags',
          meta: 'Owner action',
          run: () => document.getElementById('ownerRuntimeFlagsForm')?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
        },
        {
          label: 'Focus Asset Provisioning',
          meta: 'Owner action',
          run: () => document.getElementById('ownerSubscriptionForm')?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
        },
        {
          label: 'Focus Backup Preview',
          meta: 'Owner action',
          run: () => document.getElementById('ownerBackupPreviewForm')?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
        },
        {
          label: 'Focus Session Control',
          meta: 'Owner action',
          run: () => document.getElementById('ownerSessionRevokeForm')?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
        },
        {
          label: 'Focus Audit Query',
          meta: 'Owner action',
          run: () => document.getElementById('ownerAuditQueryForm')?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
        },
        {
          label: 'Run Monitoring Cycle',
          meta: 'Owner action',
          run: runMonitoring,
        },
        {
          label: 'Clear Current Alerts',
          meta: 'Owner action',
          run: clearAlerts,
        },
        {
          label: 'Open Global Config',
          meta: 'Legacy workbench',
          run: () => { window.location.href = '/admin/legacy?tab=control'; },
        },
        {
          label: 'Open Recovery Area',
          meta: 'Legacy workbench',
          run: () => { window.location.href = '/admin/legacy?tab=danger'; },
        },
        {
          label: 'Open Platform Center',
          meta: 'Legacy workbench',
          run: () => { window.location.href = '/admin/legacy?tab=platform'; },
        },
        {
          label: 'Refresh Owner Console',
          meta: 'Owner action',
          run: () => refreshSurface(),
        },
      ];
    },
  });

  document.getElementById('ownerRefreshBtn').addEventListener('click', () => refreshSurface());
  document.getElementById('ownerMonitoringBtn').addEventListener('click', runMonitoring);
  document.getElementById('ownerClearAlertsBtn').addEventListener('click', clearAlerts);
  document.getElementById('ownerSubscriptionForm').addEventListener('submit', handleSubscriptionSubmit);
  document.getElementById('ownerLicenseForm').addEventListener('submit', handleLicenseSubmit);
  document.getElementById('ownerApiKeyForm').addEventListener('submit', handleApiKeySubmit);
  document.getElementById('ownerWebhookForm').addEventListener('submit', handleWebhookSubmit);
  document.getElementById('ownerWebhookTestForm').addEventListener('submit', handleWebhookTestSubmit);
  document.getElementById('ownerRestartForm').addEventListener('submit', handleRestartSubmit);
  document.getElementById('ownerRuntimeFlagsForm').addEventListener('submit', handleRuntimeFlagsSubmit);
  document.getElementById('ownerPortalAccessForm').addEventListener('submit', handlePortalAccessSubmit);
  document.getElementById('ownerRconAgentForm').addEventListener('submit', handleRconAgentSubmit);
  document.getElementById('ownerSecurityPolicyForm').addEventListener('submit', handleSecurityPolicySubmit);
  document.getElementById('ownerMonitoringPolicyForm').addEventListener('submit', handleMonitoringPolicySubmit);
  document.getElementById('ownerSessionRevokeForm').addEventListener('submit', handleSessionRevokeSubmit);
  document.getElementById('ownerAdminUserForm').addEventListener('submit', handleAdminUserSubmit);
  document.getElementById('ownerAuditQueryForm').addEventListener('submit', handleAuditQuerySubmit);
  document.getElementById('ownerAuditExportJsonBtn').addEventListener('click', () => exportAudit('json'));
  document.getElementById('ownerAuditExportCsvBtn').addEventListener('click', () => exportAudit('csv'));
  document.getElementById('ownerBackupCreateForm').addEventListener('submit', handleBackupCreateSubmit);
  document.getElementById('ownerBackupPreviewForm').addEventListener('submit', handleBackupPreviewSubmit);
  document.getElementById('ownerTenantCreateForm').addEventListener('submit', handleTenantCreateSubmit);
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
