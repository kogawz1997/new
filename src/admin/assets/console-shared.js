(function () {
  'use strict';

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
      window.location.href = '/admin/login';
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
      throw new Error(parsed.error || response.statusText || 'Request failed');
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

  function formatStatusTone(value) {
    const text = String(value || '').trim().toLowerCase();
    if (!text) return 'neutral';
    if (['active', 'ready', 'ok', 'healthy', 'delivered', 'success', 'connected', 'owner', 'enabled'].includes(text)) {
      return 'success';
    }
    if (['warn', 'warning', 'trialing', 'degraded', 'pending', 'delivering', 'stale', 'queued', 'review'].includes(text)) {
      return 'warning';
    }
    if (['error', 'failed', 'offline', 'inactive', 'suspended', 'delivery_failed', 'danger'].includes(text)) {
      return 'danger';
    }
    return 'info';
  }

  function makePill(label, tone) {
    const resolvedTone = tone || formatStatusTone(label);
    return `<span class="pill pill-${escapeHtml(resolvedTone)}">${escapeHtml(label || '-')}</span>`;
  }

  function renderStats(container, cards) {
    if (!container) return;
    const rows = Array.isArray(cards) ? cards.filter(Boolean) : [];
    container.innerHTML = rows.length
      ? rows.map((card) => [
          '<article class="stat-card">',
          `<span class="stat-kicker">${escapeHtml(card.kicker || '')}</span>`,
          `<strong class="stat-value">${escapeHtml(card.value || '-')}</strong>`,
          `<h3 class="stat-title">${escapeHtml(card.title || '')}</h3>`,
          card.detail ? `<p class="stat-detail">${escapeHtml(card.detail)}</p>` : '',
          Array.isArray(card.tags) && card.tags.length
            ? `<div class="tag-row">${card.tags.map((tag) => makePill(tag)).join('')}</div>`
            : '',
          '</article>',
        ].join('')).join('')
      : '<div class="empty-state">No summary available.</div>';
  }

  function renderTable(container, options = {}) {
    if (!container) return;
    const columns = Array.isArray(options.columns) ? options.columns : [];
    const rows = Array.isArray(options.rows) ? options.rows : [];
    if (!columns.length || !rows.length) {
      container.innerHTML = `<div class="empty-state">${escapeHtml(options.emptyText || 'No data found.')}</div>`;
      return;
    }
    container.innerHTML = [
      '<div class="table-shell"><table>',
      '<thead><tr>',
      columns.map((column) => `<th>${escapeHtml(column.label || '')}</th>`).join(''),
      '</tr></thead>',
      '<tbody>',
      rows.map((row) => [
        '<tr>',
        columns.map((column) => {
          const raw = typeof column.render === 'function' ? column.render(row) : row?.[column.key];
          return `<td>${raw == null ? '' : raw}</td>`;
        }).join(''),
        '</tr>',
      ].join('')).join(''),
      '</tbody></table></div>',
    ].join('');
  }

  function renderList(container, items, renderer, emptyText) {
    if (!container) return;
    const rows = Array.isArray(items) ? items : [];
    container.innerHTML = rows.length
      ? rows.map((item) => renderer(item)).join('')
      : `<div class="empty-state">${escapeHtml(emptyText || 'No entries yet.')}</div>`;
  }

  function setText(id, text) {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = String(text || '');
    }
  }

  function setBusy(button, busy, pendingLabel) {
    if (!button) return;
    if (!button.dataset.idleLabel) {
      button.dataset.idleLabel = button.textContent || '';
    }
    button.disabled = Boolean(busy);
    button.textContent = busy ? String(pendingLabel || 'Working...') : button.dataset.idleLabel;
  }

  function ensureToastStack() {
    let stack = document.getElementById('consoleToastStack');
    if (stack) return stack;
    stack = document.createElement('div');
    stack.id = 'consoleToastStack';
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
      window.setTimeout(() => {
        toast.remove();
      }, 240);
    }, 2800);
  }

  function wireCommandPalette(options = {}) {
    const {
      openButtonId,
      panelId,
      searchId,
      listId,
      emptyId,
      closeButtonId,
      getActions,
    } = options;
    const panel = document.getElementById(panelId);
    const searchInput = document.getElementById(searchId);
    const list = document.getElementById(listId);
    const empty = document.getElementById(emptyId);
    const openButton = openButtonId ? document.getElementById(openButtonId) : null;
    const closeButton = closeButtonId ? document.getElementById(closeButtonId) : null;
    if (!panel || !searchInput || !list || typeof getActions !== 'function') {
      return {
        open() {},
        close() {},
        refresh() {},
      };
    }

    let actions = [];
    let activeIndex = 0;

    function render() {
      const query = String(searchInput.value || '').trim().toLowerCase();
      const filtered = actions.filter((item) => {
        if (!query) return true;
        return `${item.label || ''} ${item.meta || ''}`.toLowerCase().includes(query);
      });
      activeIndex = Math.min(activeIndex, Math.max(filtered.length - 1, 0));
      list.innerHTML = filtered.map((item, index) => [
        `<button type="button" class="palette-item${index === activeIndex ? ' active' : ''}" data-index="${index}">`,
        `<span class="palette-title">${escapeHtml(item.label || 'Action')}</span>`,
        item.meta ? `<span class="palette-meta">${escapeHtml(item.meta)}</span>` : '',
        '</button>',
      ].join('')).join('');
      empty.hidden = filtered.length > 0;
      Array.from(list.querySelectorAll('.palette-item')).forEach((button) => {
        button.addEventListener('click', () => {
          const index = Number(button.dataset.index || 0);
          filtered[index]?.run?.();
          close();
        });
      });
      return filtered;
    }

    function refresh() {
      actions = getActions().filter(Boolean);
      return render();
    }

    function open() {
      refresh();
      panel.hidden = false;
      document.body.classList.add('palette-open');
      window.setTimeout(() => {
        searchInput.focus();
        searchInput.select();
      }, 0);
    }

    function close() {
      panel.hidden = true;
      document.body.classList.remove('palette-open');
      searchInput.value = '';
    }

    searchInput.addEventListener('input', () => {
      activeIndex = 0;
      render();
    });

    searchInput.addEventListener('keydown', (event) => {
      const filtered = render();
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        activeIndex = Math.min(activeIndex + 1, Math.max(filtered.length - 1, 0));
        render();
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        activeIndex = Math.max(activeIndex - 1, 0);
        render();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        filtered[activeIndex]?.run?.();
        close();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    });

    panel.addEventListener('click', (event) => {
      if (event.target === panel) {
        close();
      }
    });

    if (openButton) openButton.addEventListener('click', open);
    if (closeButton) closeButton.addEventListener('click', close);

    document.addEventListener('keydown', (event) => {
      const target = event.target;
      const typing = target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (panel.hidden) {
          open();
        } else {
          close();
        }
        return;
      }
      if (!typing && event.key === '/') {
        event.preventDefault();
        open();
        return;
      }
      if (event.key === 'Escape' && !panel.hidden) {
        event.preventDefault();
        close();
      }
    });

    refresh();
    return { open, close, refresh };
  }

  function connectLiveStream(options = {}) {
    const {
      url = '/admin/api/live',
      events = [],
      onEvent,
      onOpen,
      onError,
    } = options;
    if (typeof window.EventSource !== 'function') {
      return { close() {} };
    }
    const source = new EventSource(url);
    source.addEventListener('open', () => {
      if (typeof onOpen === 'function') onOpen();
    });
    events.forEach((name) => {
      source.addEventListener(name, (event) => {
        let payload = null;
        try {
          payload = event?.data ? JSON.parse(event.data) : null;
        } catch {
          payload = { raw: event.data };
        }
        if (typeof onEvent === 'function') {
          onEvent(name, payload);
        }
      });
    });
    source.onerror = () => {
      if (typeof onError === 'function') onError();
    };
    return {
      close() {
        source.close();
      },
    };
  }

  window.ConsoleSurface = {
    api,
    connectLiveStream,
    escapeHtml,
    formatDateTime,
    formatNumber,
    formatStatusTone,
    makePill,
    renderList,
    renderStats,
    renderTable,
    setBusy,
    setText,
    showToast,
    wireCommandPalette,
  };
})();
