(function () {
  'use strict';

  const state = {
    activeTab: 'home',
    me: null,
    dashboard: null,
    serverInfo: null,
    walletLedger: null,
    shopItems: [],
    cart: null,
    orders: [],
    redeemHistory: [],
    profile: null,
    steamLink: null,
    steamHistory: [],
    notifications: [],
    filters: {
      shopQuery: '',
      shopKind: 'all',
    },
  };

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function api(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const headers = {
      Accept: 'application/json',
      ...(options.headers || {}),
    };
    let body = options.body;
    if (body && !(body instanceof FormData) && typeof body !== 'string') {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    const response = await fetch(path, {
      method,
      headers,
      body,
      credentials: 'same-origin',
    });
    if (response.status === 401) {
      window.location.href = '/player/login';
      throw new Error('Unauthorized');
    }
    const text = await response.text();
    let parsed = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { ok: response.ok, error: text || response.statusText };
    }
    if (!response.ok || parsed.ok === false) {
      const message = parsed?.data?.message || parsed.error || response.statusText || 'Request failed';
      throw new Error(message);
    }
    return parsed.data;
  }

  function formatNumber(value, fallback = '-') {
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString('en-US') : fallback;
  }

  function formatDateTime(value, fallback = '-') {
    const text = String(value || '').trim();
    if (!text) return fallback;
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) return text;
    return parsed.toLocaleString('th-TH', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  }

  function toneFromStatus(value) {
    const text = String(value || '').trim().toLowerCase();
    if (['active', 'linked', 'delivered', 'success', 'ready', 'online', 'claimable'].includes(text)) return 'success';
    if (['warning', 'warn', 'pending', 'delivering', 'review', 'queued'].includes(text)) return 'warning';
    if (['error', 'failed', 'delivery_failed', 'inactive', 'offline', 'unlinked'].includes(text)) return 'danger';
    return 'info';
  }

  function pill(label, tone) {
    const resolvedTone = tone || toneFromStatus(label);
    return `<span class="pill pill-${escapeHtml(resolvedTone)}">${escapeHtml(label || '-')}</span>`;
  }

  function ensureToastStack() {
    let stack = document.getElementById('playerToastStack');
    if (stack) return stack;
    stack = document.createElement('div');
    stack.id = 'playerToastStack';
    stack.className = 'toast-stack';
    document.body.appendChild(stack);
    return stack;
  }

  function showToast(message, tone = 'info') {
    const stack = ensureToastStack();
    const toast = document.createElement('article');
    toast.className = `toast toast-${tone}`;
    toast.innerHTML = `<strong>${escapeHtml(String(message || 'Done'))}</strong>`;
    stack.appendChild(toast);
    window.setTimeout(() => {
      toast.classList.add('toast-exit');
      window.setTimeout(() => toast.remove(), 240);
    }, 2800);
  }

  function setStatus(title, detail, tags, tone) {
    $('statusTitle').textContent = title;
    $('statusDetail').textContent = detail;
    $('statusBanner').className = `status-banner status-${tone || 'info'}`;
    $('statusTags').innerHTML = (Array.isArray(tags) ? tags : []).map((tag) => pill(tag)).join('');
  }

  function setButtonBusy(button, busy, pendingLabel) {
    if (!button) return;
    if (!button.dataset.idleLabel) {
      button.dataset.idleLabel = button.textContent || '';
    }
    button.disabled = Boolean(busy);
    button.textContent = busy ? String(pendingLabel || 'Working...') : button.dataset.idleLabel;
  }

  function renderStats(container, cards) {
    container.innerHTML = (Array.isArray(cards) ? cards : []).map((card) => [
      '<article class="stat-card">',
      `<span class="kicker">${escapeHtml(card.kicker || '')}</span>`,
      `<strong>${escapeHtml(card.value || '-')}</strong>`,
      `<div>${escapeHtml(card.title || '')}</div>`,
      card.detail ? `<p class="muted">${escapeHtml(card.detail)}</p>` : '',
      Array.isArray(card.tags) && card.tags.length ? `<div class="tag-row">${card.tags.map((tag) => pill(tag)).join('')}</div>` : '',
      '</article>',
    ].join('')).join('') || '<div class="empty-state">No summary available.</div>';
  }

  function renderTable(container, columns, rows, emptyText) {
    if (!rows.length) {
      container.innerHTML = `<div class="empty-state">${escapeHtml(emptyText || 'No data yet.')}</div>`;
      return;
    }
    container.innerHTML = [
      '<div class="table-shell"><table><thead><tr>',
      columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join(''),
      '</tr></thead><tbody>',
      rows.map((row) => [
        '<tr>',
        columns.map((column) => `<td>${column.render(row)}</td>`).join(''),
        '</tr>',
      ].join('')).join(''),
      '</tbody></table></div>',
    ].join('');
  }

  function activateTab(tabKey) {
    state.activeTab = tabKey;
    Array.from(document.querySelectorAll('.nav-btn')).forEach((button) => {
      button.classList.toggle('active', button.dataset.tab === tabKey);
    });
    Array.from(document.querySelectorAll('.tab-panel')).forEach((panel) => {
      panel.classList.toggle('active', panel.id === `tab-${tabKey}`);
    });
  }

  function filteredShopItems() {
    const query = String(state.filters.shopQuery || '').trim().toLowerCase();
    const kind = String(state.filters.shopKind || 'all').trim().toLowerCase();
    return state.shopItems.filter((row) => {
      const rowKind = String(row.kind || 'item').trim().toLowerCase();
      if (kind !== 'all' && rowKind !== kind) return false;
      if (!query) return true;
      return [row.id, row.name, row.description, row.gameItemId]
        .map((value) => String(value || '').toLowerCase())
        .join(' ')
        .includes(query);
    });
  }

  function itemArtwork(row) {
    const src = String(row.iconUrl || row.itemIconUrl || '').trim();
    if (src) {
      return `<img src="${escapeHtml(src)}" alt="${escapeHtml(row.name || row.id || 'Item')}">`;
    }
    return '<span class="metric-value">?</span>';
  }

  function renderHome() {
    const dashboard = state.dashboard || {};
    const steamLinked = Boolean(state.steamLink?.linked);
    const latestOrder = dashboard.latestOrder || state.orders[0] || null;
    const serverInfo = state.serverInfo?.serverInfo || {};
    const status = state.serverInfo?.status || {};
    const notifications = Array.isArray(state.notifications) ? state.notifications.slice(0, 5) : [];

    $('profileAvatar').src = state.me?.avatarUrl || state.profile?.avatarUrl || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="%230d141b"/><circle cx="48" cy="34" r="18" fill="%237b91a8"/><rect x="20" y="58" width="56" height="24" rx="12" fill="%237b91a8"/></svg>';
    $('profileName').textContent = state.profile?.displayName || state.me?.user || 'Player';
    $('profileMeta').textContent = state.profile?.discordId || state.me?.discordId || 'Discord account';
    $('profileQuickMeta').innerHTML = [
      pill(steamLinked ? 'Steam linked' : 'Steam required', steamLinked ? 'success' : 'warning'),
      pill(state.profile?.accountStatus || 'active'),
      pill(state.me?.authMethod || 'session', 'info'),
    ].join('');

    $('homeWalletBalance').textContent = formatNumber(dashboard.wallet?.balance || state.walletLedger?.wallet?.balance, '0');
    $('homeLatestOrder').textContent = latestOrder?.itemName || latestOrder?.code || 'No recent order';
    $('homeLatestOrderDetail').innerHTML = latestOrder
      ? `${pill(latestOrder.statusText || latestOrder.status || 'pending')} <span class="muted">${escapeHtml(formatDateTime(latestOrder.createdAt))}</span>`
      : '<span class="muted">No recent purchases yet.</span>';

    $('claimDailyBtn').disabled = !dashboard.missionsSummary?.dailyClaimable;
    $('claimWeeklyBtn').disabled = !dashboard.missionsSummary?.weeklyClaimable;

    renderStats($('homeOverviewStats'), [
      {
        kicker: 'Steam',
        value: steamLinked ? 'Ready' : 'Required',
        title: 'Steam link status',
        detail: steamLinked ? 'Safe to buy in-game items from this portal.' : 'Link SteamID before buying items that deliver into the game.',
      },
      {
        kicker: 'Orders',
        value: formatNumber(state.orders.length, '0'),
        title: 'Visible purchase records',
        detail: 'Recent order history tied to this Discord account.',
      },
      {
        kicker: 'Claims',
        value: dashboard.missionsSummary?.dailyClaimable || dashboard.missionsSummary?.weeklyClaimable ? 'Open' : 'Cooldown',
        title: 'Daily and weekly rewards',
        detail: dashboard.missionsSummary?.dailyClaimable
          ? 'Daily reward can be claimed now.'
          : dashboard.missionsSummary?.weeklyClaimable
            ? 'Weekly reward can be claimed now.'
            : 'Reward claim is currently on cooldown.',
      },
      {
        kicker: 'Server',
        value: formatNumber(status.onlinePlayers, '0'),
        title: 'Players online',
        detail: `${formatNumber(serverInfo.maxPlayers, '0')} total slots configured.`,
      },
    ]);

    renderStats($('homeServerStats'), [
      {
        kicker: 'Server',
        value: serverInfo.name || 'SCUM Server',
        title: 'Current server name',
        detail: serverInfo.description || 'Operational status from the player portal.',
      },
      {
        kicker: 'Online',
        value: formatNumber(status.onlinePlayers, '0'),
        title: 'Current population',
        detail: `${formatNumber(serverInfo.maxPlayers, '0')} max slots`,
      },
      {
        kicker: 'Economy',
        value: formatNumber(state.serverInfo?.economy?.dailyReward, '0'),
        title: `Daily reward (${state.serverInfo?.economy?.currencySymbol || 'Coins'})`,
        detail: 'Shown exactly as configured by the tenant economy surface.',
      },
      {
        kicker: 'Announcements',
        value: formatNumber((dashboard.announcements || []).length, '0'),
        title: 'Portal notices',
        detail: 'Latest notices and raid-time summaries pulled into the player surface.',
      },
    ]);

    $('homeNotifications').innerHTML = notifications.length
      ? notifications.map((item) => [
          '<article class="feed-item">',
          `<div class="feed-meta">${pill(item.severity || 'info')} ${item.type ? `<span class="code">${escapeHtml(item.type)}</span>` : ''}</div>`,
          `<strong>${escapeHtml(item.title || item.message || item.detail || 'Notification')}</strong>`,
          item.detail ? `<div class="muted">${escapeHtml(item.detail)}</div>` : '',
          `<div class="feed-meta"><span>${escapeHtml(formatDateTime(item.createdAt || item.at))}</span></div>`,
          '</article>',
        ].join('')).join('')
      : '<div class="empty-state">No player notifications right now.</div>';
  }

  function renderWallet() {
    const wallet = state.walletLedger?.wallet || {};
    const dashboard = state.dashboard || {};
    renderStats($('walletSummaryStats'), [
      {
        kicker: 'Balance',
        value: formatNumber(wallet.balance, '0'),
        title: 'Current wallet balance',
        detail: 'Latest stored balance for this player account.',
      },
      {
        kicker: 'Daily',
        value: dashboard.missionsSummary?.dailyClaimable ? 'Claimable' : 'Cooldown',
        title: 'Daily reward',
        detail: dashboard.missionsSummary?.dailyRemainingMs ? `${formatNumber(Math.round(dashboard.missionsSummary.dailyRemainingMs / 1000 / 60), '0')} min remaining` : 'Ready or no cooldown currently active.',
      },
      {
        kicker: 'Weekly',
        value: dashboard.missionsSummary?.weeklyClaimable ? 'Claimable' : 'Cooldown',
        title: 'Weekly reward',
        detail: dashboard.missionsSummary?.weeklyRemainingMs ? `${formatNumber(Math.round(dashboard.missionsSummary.weeklyRemainingMs / 1000 / 60 / 60), '0')} hr remaining` : 'Ready or no cooldown currently active.',
      },
    ]);

    renderTable(
      $('walletLedgerTable'),
      [
        { label: 'Time', render: (row) => `<span class="code">${escapeHtml(formatDateTime(row.createdAt))}</span>` },
        { label: 'Delta', render: (row) => escapeHtml(formatNumber(row.delta, '0')) },
        { label: 'Balance After', render: (row) => escapeHtml(formatNumber(row.balanceAfter, '0')) },
        { label: 'Reason', render: (row) => escapeHtml(row.reasonLabel || row.reason || '-') },
        { label: 'Reference', render: (row) => `<span class="code">${escapeHtml(row.reference || '-')}</span>` },
      ],
      Array.isArray(state.walletLedger?.items) ? state.walletLedger.items : [],
      'No wallet ledger entries yet.'
    );
  }

  function renderShop() {
    const items = filteredShopItems();
    $('shopGrid').innerHTML = items.length
      ? items.map((item) => [
          '<article class="shop-card">',
          `<div class="shop-thumb">${itemArtwork(item)}</div>`,
          `<div class="meta">${pill(item.kind || 'item', item.kind === 'vip' ? 'info' : 'neutral')} ${item.requiresSteamLink ? pill('Steam required', 'warning') : ''}</div>`,
          `<h3>${escapeHtml(item.name || item.id || '-')}</h3>`,
          `<div class="muted">${escapeHtml(item.description || 'No description available.')}</div>`,
          `<strong class="shop-price">${escapeHtml(formatNumber(item.price, '0'))}</strong>`,
          `<div class="button-row">`,
          `<button class="button" type="button" data-add-cart="${escapeHtml(item.id)}">Add to cart</button>`,
          `<button class="button button-primary" type="button" data-buy-now="${escapeHtml(item.id)}">Buy now</button>`,
          `</div>`,
          '</article>',
        ].join('')).join('')
      : '<div class="empty-state">No items match this filter.</div>';

    Array.from(document.querySelectorAll('[data-add-cart]')).forEach((button) => {
      button.addEventListener('click', async () => {
        const itemId = button.dataset.addCart || '';
        await runAction(button, async () => {
          await api('/player/api/cart/add', {
            method: 'POST',
            body: { itemId, quantity: 1 },
          });
          showToast('Item added to cart.', 'success');
          await refreshAll();
        });
      });
    });

    Array.from(document.querySelectorAll('[data-buy-now]')).forEach((button) => {
      button.addEventListener('click', async () => {
        const itemId = button.dataset.buyNow || '';
        await runAction(button, async () => {
          await api('/player/api/shop/buy', {
            method: 'POST',
            body: { itemId },
          });
          showToast('Purchase created successfully.', 'success');
          await refreshAll();
          activateTab('orders');
        });
      });
    });

    const cartRows = Array.isArray(state.cart?.rows) ? state.cart.rows : [];
    renderStats($('cartSummary'), [
      {
        kicker: 'Items',
        value: formatNumber(state.cart?.totalUnits, '0'),
        title: 'Units in cart',
      },
      {
        kicker: 'Total',
        value: formatNumber(state.cart?.totalPrice, '0'),
        title: 'Coins required',
      },
      {
        kicker: 'Missing',
        value: formatNumber((state.cart?.missingItemIds || []).length, '0'),
        title: 'Unavailable refs',
      },
    ]);

    $('cartRows').innerHTML = cartRows.length
      ? cartRows.map((row) => [
          '<article class="feed-item">',
          `<strong>${escapeHtml(row.item?.name || row.itemId || '-')}</strong>`,
          `<div class="feed-meta"><span>${escapeHtml(formatNumber(row.quantity, '1'))} units</span><span>${escapeHtml(formatNumber(row.lineTotal, '0'))} coins</span></div>`,
          `<div class="button-row"><button class="button" type="button" data-remove-cart="${escapeHtml(row.itemId)}" data-remove-quantity="${escapeHtml(row.quantity)}">Remove</button></div>`,
          '</article>',
        ].join('')).join('')
      : '<div class="empty-state">Your cart is empty.</div>';

    Array.from(document.querySelectorAll('[data-remove-cart]')).forEach((button) => {
      button.addEventListener('click', async () => {
        await runAction(button, async () => {
          await api('/player/api/cart/remove', {
            method: 'POST',
            body: {
              itemId: button.dataset.removeCart,
              quantity: Number(button.dataset.removeQuantity || 1),
            },
          });
          showToast('Item removed from cart.', 'info');
          await refreshAll();
        });
      });
    });
  }

  function renderOrders() {
    const pending = state.orders.filter((row) => ['pending', 'delivering'].includes(String(row.status || '').toLowerCase())).length;
    const delivered = state.orders.filter((row) => String(row.status || '').toLowerCase() === 'delivered').length;
    const failed = state.orders.filter((row) => String(row.status || '').toLowerCase() === 'delivery_failed').length;

    renderStats($('ordersSummaryStats'), [
      {
        kicker: 'Orders',
        value: formatNumber(state.orders.length, '0'),
        title: 'Visible order records',
      },
      {
        kicker: 'Pending',
        value: formatNumber(pending, '0'),
        title: 'Awaiting completion',
      },
      {
        kicker: 'Delivered',
        value: formatNumber(delivered, '0'),
        title: 'Successfully completed',
      },
      {
        kicker: 'Failed',
        value: formatNumber(failed, '0'),
        title: 'Needs support or retry',
      },
    ]);

    $('ordersFeed').innerHTML = state.orders.length
      ? state.orders.map((row) => [
          '<article class="order-card">',
          `<div class="feed-meta">${pill(row.statusText || row.status || 'pending')} <span class="code">${escapeHtml(row.purchaseCode || row.code || '-')}</span></div>`,
          `<strong>${escapeHtml(row.itemName || row.itemId || 'Purchase')}</strong>`,
          `<div class="muted">${escapeHtml(formatDateTime(row.createdAt))}</div>`,
          Array.isArray(row.history) && row.history.length
            ? `<div class="order-timeline">${row.history.slice(0, 3).map((entry) => pill(entry.status || entry.toStatus || 'update', 'info')).join('')}</div>`
            : '<div class="muted">No timeline yet.</div>',
          '</article>',
        ].join('')).join('')
      : '<div class="empty-state">No purchase history yet.</div>';
  }

  function renderRedeem() {
    renderTable(
      $('redeemHistoryTable'),
      [
        { label: 'Code', render: (row) => `<span class="code">${escapeHtml(row.code || '-')}</span>` },
        { label: 'Type', render: (row) => escapeHtml(row.type || '-') },
        { label: 'Amount', render: (row) => escapeHtml(formatNumber(row.amount, '-')) },
        { label: 'Used At', render: (row) => `<span class="code">${escapeHtml(formatDateTime(row.usedAt))}</span>` },
      ],
      state.redeemHistory,
      'No redeem history yet.'
    );
  }

  function renderProfile() {
    renderTable(
      $('profileTable'),
      [
        { label: 'Field', render: (row) => `<strong>${escapeHtml(row.label)}</strong>` },
        { label: 'Value', render: (row) => escapeHtml(row.value || '-') },
      ],
      [
        { label: 'Display Name', value: state.profile?.displayName || state.profile?.username || state.me?.user || '-' },
        { label: 'Discord ID', value: state.profile?.discordId || state.me?.discordId || '-' },
        { label: 'Account Status', value: state.profile?.accountStatus || 'active' },
        { label: 'Created At', value: formatDateTime(state.profile?.createdAt) },
        { label: 'Updated At', value: formatDateTime(state.profile?.updatedAt) },
      ],
      'No profile data.'
    );

    $('steamLinkMeta').innerHTML = [
      '<article class="feed-item">',
      `<div class="feed-meta">${pill(state.steamLink?.linked ? 'linked' : 'unlinked', state.steamLink?.linked ? 'success' : 'warning')}</div>`,
      `<strong>${escapeHtml(state.steamLink?.steamId || 'No SteamID linked')}</strong>`,
      `<div class="muted">${escapeHtml(state.steamLink?.inGameName || 'No in-game name recorded')}</div>`,
      `<div class="feed-meta"><span>${escapeHtml(formatDateTime(state.steamLink?.linkedAt))}</span></div>`,
      '</article>',
    ].join('');

    renderTable(
      $('steamHistoryTable'),
      [
        { label: 'Action', render: (row) => escapeHtml(row.action || '-') },
        { label: 'SteamID', render: (row) => `<span class="code">${escapeHtml(row.steamId || '-')}</span>` },
        { label: 'In-game Name', render: (row) => escapeHtml(row.inGameName || '-') },
        { label: 'At', render: (row) => `<span class="code">${escapeHtml(formatDateTime(row.at))}</span>` },
      ],
      state.steamHistory,
      'No Steam link history yet.'
    );
  }

  function renderAll() {
    const latestOrder = state.dashboard?.latestOrder || state.orders[0] || null;
    const pendingOrders = state.orders.filter((row) => ['pending', 'delivering'].includes(String(row.status || '').toLowerCase())).length;
    setStatus(
      state.me?.user ? `Signed in as ${state.me.user}` : 'Player portal ready',
      'This portal is optimized for wallet, purchase, redeem, profile, and Steam-link journeys.',
      [
        `wallet ${formatNumber(state.walletLedger?.wallet?.balance, '0')}`,
        `orders ${formatNumber(state.orders.length, '0')}`,
        latestOrder ? `latest ${latestOrder.status || 'pending'}` : 'latest -',
        `pending ${formatNumber(pendingOrders, '0')}`,
      ],
      pendingOrders > 0 ? 'warning' : 'info'
    );
    renderHome();
    renderWallet();
    renderShop();
    renderOrders();
    renderRedeem();
    renderProfile();
  }

  async function refreshAll() {
    setButtonBusy($('refreshBtn'), true, 'Refreshing...');
    try {
      const [
        me,
        dashboard,
        serverInfo,
        walletLedger,
        shopList,
        cart,
        purchaseList,
        redeemHistory,
        profile,
        steamLink,
        steamHistory,
        notifications,
      ] = await Promise.all([
        api('/player/api/me'),
        api('/player/api/dashboard'),
        api('/player/api/server/info'),
        api('/player/api/wallet/ledger?limit=20'),
        api('/player/api/shop/list?limit=80'),
        api('/player/api/cart'),
        api('/player/api/purchase/list?limit=25&includeHistory=1'),
        api('/player/api/redeem/history?limit=20'),
        api('/player/api/profile'),
        api('/player/api/linksteam/me'),
        api('/player/api/linksteam/history'),
        api('/player/api/notifications?limit=10'),
      ]);

      state.me = me;
      state.dashboard = dashboard;
      state.serverInfo = serverInfo;
      state.walletLedger = walletLedger;
      state.shopItems = Array.isArray(shopList?.items) ? shopList.items : [];
      state.cart = cart || {};
      state.orders = Array.isArray(purchaseList?.items) ? purchaseList.items : [];
      state.redeemHistory = Array.isArray(redeemHistory?.items) ? redeemHistory.items : [];
      state.profile = profile || {};
      state.steamLink = steamLink || {};
      state.steamHistory = Array.isArray(steamHistory?.items) ? steamHistory.items : [];
      state.notifications = Array.isArray(notifications?.items) ? notifications.items : [];
      renderAll();
    } catch (error) {
      setStatus('Portal load failed', String(error.message || error), ['retry available'], 'danger');
    } finally {
      setButtonBusy($('refreshBtn'), false);
    }
  }

  async function runAction(button, work) {
    setButtonBusy(button, true, 'Working...');
    try {
      await work();
    } catch (error) {
      setStatus('Action failed', String(error.message || error), ['review required'], 'danger');
    } finally {
      setButtonBusy(button, false);
    }
  }

  async function claimReward(kind) {
    const button = kind === 'weekly' ? $('claimWeeklyBtn') : $('claimDailyBtn');
    const endpoint = kind === 'weekly' ? '/player/api/weekly/claim' : '/player/api/daily/claim';
    await runAction(button, async () => {
      await api(endpoint, { method: 'POST', body: {} });
      showToast(kind === 'weekly' ? 'Weekly reward claimed.' : 'Daily reward claimed.', 'success');
      await refreshAll();
      activateTab('wallet');
    });
  }

  async function logout() {
    await runAction($('logoutBtn'), async () => {
      await api('/player/api/logout', { method: 'POST', body: {} });
      window.location.href = '/player/login';
    });
  }

  async function clearCart() {
    await runAction($('cartClearBtn'), async () => {
      await api('/player/api/cart/clear', { method: 'POST', body: {} });
      showToast('Cart cleared.', 'info');
      await refreshAll();
    });
  }

  async function checkoutCart() {
    await runAction($('cartCheckoutBtn'), async () => {
      await api('/player/api/cart/checkout', { method: 'POST', body: {} });
      showToast('Checkout completed.', 'success');
      await refreshAll();
      activateTab('orders');
    });
  }

  async function redeemCode(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const code = String(form.elements.code.value || '').trim();
    if (!code) {
      setStatus('Redeem code is empty', 'Enter a redeem code before submitting.', ['redeem'], 'danger');
      return;
    }
    await runAction(button, async () => {
      await api('/player/api/redeem', {
        method: 'POST',
        body: { code },
      });
      form.reset();
      showToast('Redeem code applied.', 'success');
      await refreshAll();
    });
  }

  async function linkSteam(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const steamId = String(form.elements.steamId.value || '').trim();
    if (!steamId) {
      setStatus('SteamID is required', 'Enter a numeric SteamID before linking.', ['steam'], 'danger');
      return;
    }
    await runAction(button, async () => {
      await api('/player/api/linksteam/set', {
        method: 'POST',
        body: { steamId },
      });
      showToast('Steam link updated.', 'success');
      await refreshAll();
    });
  }

  async function unlinkSteam() {
    await runAction($('unlinkSteamBtn'), async () => {
      await api('/player/api/linksteam/unset', {
        method: 'POST',
        body: {},
      });
      await refreshAll();
    });
  }

  $('refreshBtn').addEventListener('click', refreshAll);
  $('logoutBtn').addEventListener('click', logout);
  $('claimDailyBtn').addEventListener('click', () => claimReward('daily'));
  $('claimWeeklyBtn').addEventListener('click', () => claimReward('weekly'));
  $('cartClearBtn').addEventListener('click', clearCart);
  $('cartCheckoutBtn').addEventListener('click', checkoutCart);
  $('redeemForm').addEventListener('submit', redeemCode);
  $('steamLinkForm').addEventListener('submit', linkSteam);
  $('unlinkSteamBtn').addEventListener('click', unlinkSteam);
  $('shopSearchInput').addEventListener('input', (event) => {
    state.filters.shopQuery = event.target.value || '';
    renderShop();
  });
  $('shopKindSelect').addEventListener('change', (event) => {
    state.filters.shopKind = event.target.value || 'all';
    renderShop();
  });
  Array.from(document.querySelectorAll('.nav-btn')).forEach((button) => {
    button.addEventListener('click', () => activateTab(button.dataset.tab));
  });

  refreshAll();
})();
