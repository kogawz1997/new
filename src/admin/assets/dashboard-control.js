/**
 * Dashboard control-panel UI helpers split out of the former dashboard monolith so runtime
 * configuration, env patching, and restart flows are easier to review.
 */    function getControlPanelEnvEntry(scope, key) {
      return controlPanelSettings?.env?.[scope]?.[key] || null;
    }

    function getControlPanelEnvValue(scope, key, fallback = '') {
      const entry = getControlPanelEnvEntry(scope, key);
      if (!entry) return fallback;
      return entry.value ?? fallback;
    }

    function setSelectBooleanValue(element, value) {
      if (!element) return;
      element.value = value ? 'true' : 'false';
    }

    function fillControlPanelConfigFromSnapshot() {
      if (!snapshot?.config) return;
      const cfg = snapshot.config;
      if (cpChannelCommands) cpChannelCommands.value = String(cfg.channels?.commandsChannel || '');
      if (cpChannelAdminLog) cpChannelAdminLog.value = String(cfg.channels?.adminLog || '');
      if (cpChannelShopLog) cpChannelShopLog.value = String(cfg.channels?.shopLog || '');
      if (cpChannelEvidence) cpChannelEvidence.value = String(cfg.channels?.evidence || '');
      if (cpChannelInServer) cpChannelInServer.value = String(cfg.channels?.inServer || '');
      if (cpRoleOwner) cpRoleOwner.value = String(cfg.roles?.owner || '');
      if (cpRoleAdmin) cpRoleAdmin.value = String(cfg.roles?.admin || '');
      if (cpRoleModerator) cpRoleModerator.value = String(cfg.roles?.moderator || '');
      if (cpRoleHelper) cpRoleHelper.value = String(cfg.roles?.helper || '');
      if (cpRoleVip) cpRoleVip.value = String(cfg.roles?.vip || '');
      if (cpRoleVerified) cpRoleVerified.value = String(cfg.roles?.verified || '');

      const delivery = cfg.delivery?.auto || {};
      setSelectBooleanValue(cpDeliveryEnabled, delivery.enabled !== false);
      if (cpDeliveryMode) cpDeliveryMode.value = String(delivery.executionMode || 'rcon');
      if (cpDeliveryVerifyMode) cpDeliveryVerifyMode.value = String(delivery.verifyMode || '');
      if (cpDeliveryQueueInterval) cpDeliveryQueueInterval.value = delivery.queueIntervalMs ?? '';
      if (cpDeliveryMaxRetries) cpDeliveryMaxRetries.value = delivery.maxRetries ?? '';
      if (cpDeliveryRetryDelay) cpDeliveryRetryDelay.value = delivery.retryDelayMs ?? '';
      if (cpDeliveryRetryBackoff) cpDeliveryRetryBackoff.value = delivery.retryBackoff ?? '';
      if (cpDeliveryCommandTimeout) cpDeliveryCommandTimeout.value = delivery.commandTimeoutMs ?? '';
      if (cpDeliveryMagazineStackCount) cpDeliveryMagazineStackCount.value = delivery.magazineStackCount ?? '';
      if (cpDeliveryTeleportMode) cpDeliveryTeleportMode.value = String(delivery.agentTeleportMode || '');
      if (cpDeliveryTeleportTarget) cpDeliveryTeleportTarget.value = String(delivery.agentTeleportTarget || '');
      if (cpDeliveryReturnTarget) cpDeliveryReturnTarget.value = String(delivery.agentReturnTarget || '');
      if (cpDeliveryPreCommands) {
        cpDeliveryPreCommands.value = Array.isArray(delivery.agentPreCommands)
          ? delivery.agentPreCommands.join('\n')
          : '';
      }
      if (cpDeliveryPostCommands) {
        cpDeliveryPostCommands.value = Array.isArray(delivery.agentPostCommands)
          ? delivery.agentPostCommands.join('\n')
          : '';
      }
    }

    function renderControlPanelCommandRegistry() {
      if (!controlCommandWrap) return;
      const commands = Array.isArray(controlPanelSettings?.commands)
        ? controlPanelSettings.commands
        : [];
      if (commands.length === 0) {
        controlCommandWrap.innerHTML = '<div style="padding:12px; color:#9eb0d9;">ยังไม่พบ command registry</div>';
        return;
      }
      const rows = commands.map((entry) => `
        <tr>
          <td><label><input type="checkbox" data-command-disable value="${escapeHtml(entry.name)}" ${entry.disabled ? 'checked' : ''}> ${escapeHtml(entry.name)}</label></td>
          <td>${escapeHtml(entry.description || '-')}</td>
          <td>
            <select data-command-role="${escapeHtml(entry.name)}">
              <option value="public" ${String(entry.requiredRole || 'public') === 'public' ? 'selected' : ''}>public</option>
              <option value="mod" ${String(entry.requiredRole || '') === 'mod' ? 'selected' : ''}>mod</option>
              <option value="admin" ${String(entry.requiredRole || '') === 'admin' ? 'selected' : ''}>admin</option>
              <option value="owner" ${String(entry.requiredRole || '') === 'owner' ? 'selected' : ''}>owner</option>
            </select>
          </td>
          <td>${entry.disabled ? '<span class="badge-text danger">disabled</span>' : '<span class="badge-text ok">enabled</span>'}</td>
        </tr>
      `).join('');
      controlCommandWrap.innerHTML = `
        <table>
          <thead>
            <tr>
              <th>Command</th>
              <th>Description</th>
              <th>Required Role</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      `;
    }

    function renderManagedServices() {
      const services = Array.isArray(controlPanelSettings?.managedServices)
        ? controlPanelSettings.managedServices
        : [];
      if (controlRestartTargetSelect) {
        const currentValue = String(controlRestartTargetSelect.value || '').trim();
        const options = [
          '<option value="">ไม่ restart อัตโนมัติ</option>',
          '<option value="all">all runtime services</option>',
          ...services.map((entry) =>
            `<option value="${escapeHtml(entry.key)}">${escapeHtml(entry.label)} (${escapeHtml(entry.pm2Name)})</option>`),
        ];
        controlRestartTargetSelect.innerHTML = options.join('');
        if (
          currentValue
          && (
            currentValue === 'all'
            || services.some((entry) => entry.key === currentValue)
          )
        ) {
          controlRestartTargetSelect.value = currentValue;
        }
      }

      const rows = services.map((entry) => ({
        key: entry.key,
        label: entry.label,
        pm2: entry.pm2Name,
        description: entry.description || '-',
      }));
      renderRowsToContainer(controlManagedServicesWrap, rows, 'ยังไม่พบ managed services');
    }

    function renderControlAdminUsers() {
      const rows = Array.isArray(controlPanelSettings?.adminUsers)
        ? controlPanelSettings.adminUsers.map((entry) => ({
          username: entry.username,
          role: entry.role,
          isActive: entry.isActive,
          createdAt: entry.createdAt || '-',
          updatedAt: entry.updatedAt || '-',
        }))
        : [];
      renderRowsToContainer(controlAdminUsersWrap, rows, 'เฉพาะ owner จะเห็นรายชื่อแอดมิน');
    }

    function getControlPanelEnvCatalogRows() {
      const scopes = ['root', 'portal'];
      const rows = [];
      for (const scope of scopes) {
        const catalog = Array.isArray(controlPanelSettings?.envCatalog?.[scope])
          ? controlPanelSettings.envCatalog[scope]
          : [];
        for (const field of catalog) {
          const entry = getControlPanelEnvEntry(scope, field.key) || {};
          rows.push({
            scope,
            key: String(field.key || '').trim(),
            type: field.type || entry.type || 'text',
            policy: field.policy || entry.policy || 'admin-editable',
            applyMode: field.applyMode || entry.applyMode || 'restart-required',
            editable: field.editable !== false && entry.editable !== false,
            secret: field.secret === true || entry.secret === true,
            description: field.description || entry.description || '',
            configured: entry.configured === true,
            value: entry.value,
          });
        }
      }
      return rows;
    }

    function formatControlPanelEnvValue(row) {
      if (!row) return '';
      if (row.secret) return '';
      if (row.type === 'boolean') {
        return row.value ? 'true' : 'false';
      }
      if (row.value == null) return '';
      return String(row.value);
    }

    function buildControlEnvCatalogInput(row) {
      const inputId = `control-env-${row.scope}-${row.key}`;
      const commonAttrs =
        `id="${escapeHtml(inputId)}" data-control-env-input="true" data-file="${escapeHtml(row.scope)}" `
        + `data-key="${escapeHtml(row.key)}" data-type="${escapeHtml(row.type)}"`;
      const disabled = row.editable ? '' : ' disabled';
      if (row.type === 'boolean') {
        const currentValue = String(formatControlPanelEnvValue(row) || 'false').toLowerCase() === 'true';
        return `
          <select ${commonAttrs}${disabled}>
            <option value="false" ${currentValue ? '' : 'selected'}>false</option>
            <option value="true" ${currentValue ? 'selected' : ''}>true</option>
          </select>
        `;
      }
      if (row.secret) {
        return `
          <input
            ${commonAttrs}
            type="password"
            value=""
            ${disabled}
            placeholder="${row.configured ? 'configured (leave blank to keep)' : 'set secret'}"
          >
        `;
      }
      const inputType = row.type === 'number' ? 'number' : 'text';
      return `
        <input
          ${commonAttrs}
          type="${inputType}"
          value="${escapeHtml(formatControlPanelEnvValue(row))}"
          ${disabled}
          placeholder="${row.configured ? '' : 'unset'}"
        >
      `;
    }

    function renderControlEnvCatalog() {
      if (!controlEnvCatalogWrap) return;
      const rows = getControlPanelEnvCatalogRows();
      if (rows.length === 0) {
        controlEnvCatalogWrap.innerHTML = `
          <div style="padding:12px; color:#9eb0d9;">
            Env catalog แสดงเฉพาะ admin ที่ไม่ถูก tenant-scope เพื่อป้องกันการแก้ runtime ข้าม tenant
          </div>
        `;
        return;
      }

      const configuredCount = rows.filter((row) => row.configured).length;
      const editableCount = rows.filter((row) => row.editable).length;
      const runtimeOnlyCount = rows.filter((row) => row.policy === 'runtime-only').length;
      const reloadSafeCount = rows.filter((row) => row.applyMode === 'reload-safe').length;
      const rootCount = rows.filter((row) => row.scope === 'root').length;
      const portalCount = rows.filter((row) => row.scope === 'portal').length;
      const tableRows = rows.map((row) => `
        <tr>
          <td>${escapeHtml(row.scope)}</td>
          <td><code>${escapeHtml(row.key)}</code></td>
          <td>${buildControlEnvCatalogInput(row)}</td>
          <td>${escapeHtml(row.type)}</td>
          <td>${escapeHtml(row.policy)}</td>
          <td>${escapeHtml(row.applyMode)}</td>
          <td>${row.configured ? '<span class="badge-text ok">configured</span>' : '<span class="badge-text danger">unset</span>'}</td>
          <td>${row.editable ? '<span class="badge-text ok">editable</span>' : '<span class="badge-text danger">read-only</span>'}</td>
          <td>${escapeHtml(row.description || '-')}</td>
        </tr>
      `).join('');
      const rootFile = String(controlPanelSettings?.files?.root || '-');
      const portalFile = String(controlPanelSettings?.files?.portal || '-');

      controlEnvCatalogWrap.innerHTML = `
        <div class="summary" style="margin-bottom:12px;">
          <div class="metric"><div class="k">env keys</div><div class="v">${rows.length}</div></div>
          <div class="metric"><div class="k">configured</div><div class="v">${configuredCount}</div></div>
          <div class="metric"><div class="k">editable</div><div class="v">${editableCount}</div></div>
          <div class="metric"><div class="k">runtime-only</div><div class="v">${runtimeOnlyCount}</div></div>
          <div class="metric"><div class="k">reload-safe</div><div class="v">${reloadSafeCount}</div></div>
          <div class="metric"><div class="k">files</div><div class="v">root ${rootCount} / portal ${portalCount}</div></div>
        </div>
        <div style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom:12px; color:#9eb0d9;">
          <div><strong>root</strong>: ${escapeHtml(rootFile)}</div>
          <div><strong>portal</strong>: ${escapeHtml(portalFile)}</div>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px;">
          <button type="button" class="ghost" data-control-env-save="true">Apply env catalog edits</button>
          <span style="color:#9eb0d9; align-self:center;">
            คีย์ที่เป็น <code>runtime-only</code> จะถูกแสดงเป็น read-only และคีย์ secret เว้นว่างไว้ได้เพื่อคงค่าเดิม
          </span>
        </div>
        <table>
          <thead>
            <tr>
              <th>File</th>
              <th>Key</th>
              <th>Value</th>
              <th>Type</th>
              <th>Policy</th>
              <th>Apply</th>
              <th>State</th>
              <th>Access</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      `;
    }

    function buildControlEnvCatalogPatch() {
      const patch = {
        root: {},
        portal: {},
      };
      const inputs = Array.from(document.querySelectorAll('[data-control-env-input="true"]'));
      for (const input of inputs) {
        if (input.disabled) continue;
        const fileKey = String(input.getAttribute('data-file') || '').trim();
        const envKey = String(input.getAttribute('data-key') || '').trim();
        const type = String(input.getAttribute('data-type') || 'text').trim();
        if (!fileKey || !envKey || !(fileKey in patch)) continue;
        const entry = getControlPanelEnvEntry(fileKey, envKey);
        if (!entry) continue;

        let nextValue = String(input.value || '');
        if (type === 'boolean') {
          nextValue = String(input.value || 'false').trim().toLowerCase() === 'true' ? 'true' : 'false';
        } else {
          nextValue = String(input.value || '').trim();
        }

        if (entry.secret) {
          if (!nextValue) continue;
          patch[fileKey][envKey] = nextValue;
          continue;
        }

        const currentValue = formatControlPanelEnvValue({
          ...entry,
          type,
        });
        if (nextValue === currentValue) continue;
        patch[fileKey][envKey] = nextValue;
      }
      return patch;
    }

    function renderControlPanelSummary() {
      if (!controlPanelSummary) return;
      const commandCount = Array.isArray(controlPanelSettings?.commands)
        ? controlPanelSettings.commands.length
        : 0;
      const disabledCount = Array.isArray(controlPanelSettings?.commandConfig?.disabled)
        ? controlPanelSettings.commandConfig.disabled.length
        : 0;
      const adminCount = Array.isArray(controlPanelSettings?.adminUsers)
        ? controlPanelSettings.adminUsers.length
        : 0;
      const mode = String(snapshot?.config?.delivery?.auto?.executionMode || 'rcon');
      const runtimeMode = String(getControlPanelEnvValue('root', 'DELIVERY_EXECUTION_MODE', mode) || mode);
      controlPanelSummary.innerHTML = `
        <div class="metric"><div class="k">commands</div><div class="v">${commandCount}</div></div>
        <div class="metric"><div class="k">disabled</div><div class="v">${disabledCount}</div></div>
        <div class="metric"><div class="k">admins</div><div class="v">${adminCount}</div></div>
        <div class="metric"><div class="k">delivery</div><div class="v">${escapeHtml(mode)}</div></div>
        <div class="metric"><div class="k">runtime override</div><div class="v">${escapeHtml(runtimeMode)}</div></div>
        <div class="metric"><div class="k">reload</div><div class="v">${controlPanelSettings?.reloadRequired ? 'required for env changes' : 'not required'}</div></div>
      `;
    }

    function fillControlPanelEnvFromSettings() {
      if (!controlPanelSettings) return;
      if (cpGuildId) cpGuildId.value = String(getControlPanelEnvValue('root', 'DISCORD_GUILD_ID', ''));
      setSelectBooleanValue(cpFeatureAdminWeb, Boolean(getControlPanelEnvValue('root', 'BOT_ENABLE_ADMIN_WEB', false)));
      setSelectBooleanValue(cpFeatureDeliveryWorker, Boolean(getControlPanelEnvValue('root', 'BOT_ENABLE_DELIVERY_WORKER', false)));
      setSelectBooleanValue(cpFeatureWorkerDelivery, Boolean(getControlPanelEnvValue('root', 'WORKER_ENABLE_DELIVERY', false)));
      setSelectBooleanValue(cpFeatureRentBikeService, Boolean(getControlPanelEnvValue('root', 'BOT_ENABLE_RENTBIKE_SERVICE', false)));
      setSelectBooleanValue(cpFeatureWorkerRentBike, Boolean(getControlPanelEnvValue('root', 'WORKER_ENABLE_RENTBIKE', false)));
      setSelectBooleanValue(cpFeatureWebhook, Boolean(getControlPanelEnvValue('root', 'BOT_ENABLE_SCUM_WEBHOOK', false)));
      if (cpRuntimeDeliveryExecutionMode) cpRuntimeDeliveryExecutionMode.value = String(getControlPanelEnvValue('root', 'DELIVERY_EXECUTION_MODE', 'rcon'));
      if (cpRconHost) cpRconHost.value = String(getControlPanelEnvValue('root', 'RCON_HOST', ''));
      if (cpRconPort) cpRconPort.value = getControlPanelEnvValue('root', 'RCON_PORT', '');
      if (cpRconProtocol) cpRconProtocol.value = String(getControlPanelEnvValue('root', 'RCON_PROTOCOL', ''));
      if (cpRconTemplate) cpRconTemplate.value = String(getControlPanelEnvValue('root', 'RCON_EXEC_TEMPLATE', ''));
      if (cpRconPassword) cpRconPassword.value = '';
      if (cpAgentBaseUrl) cpAgentBaseUrl.value = String(getControlPanelEnvValue('root', 'SCUM_CONSOLE_AGENT_BASE_URL', ''));
      if (cpAgentHost) cpAgentHost.value = String(getControlPanelEnvValue('root', 'SCUM_CONSOLE_AGENT_HOST', ''));
      if (cpAgentPort) cpAgentPort.value = getControlPanelEnvValue('root', 'SCUM_CONSOLE_AGENT_PORT', '');
      if (cpAgentBackend) cpAgentBackend.value = String(getControlPanelEnvValue('root', 'SCUM_CONSOLE_AGENT_BACKEND', ''));
      if (cpAgentTemplate) cpAgentTemplate.value = String(getControlPanelEnvValue('root', 'SCUM_CONSOLE_AGENT_EXEC_TEMPLATE', ''));
      if (cpAgentToken) cpAgentToken.value = '';
      if (cpWebhookUrl) cpWebhookUrl.value = String(getControlPanelEnvValue('root', 'SCUM_WEBHOOK_URL', ''));
      if (cpWebhookPort) cpWebhookPort.value = getControlPanelEnvValue('root', 'SCUM_WEBHOOK_PORT', '');
      if (cpLogPath) cpLogPath.value = String(getControlPanelEnvValue('root', 'SCUM_LOG_PATH', ''));
      if (cpPortalBaseUrl) cpPortalBaseUrl.value = String(getControlPanelEnvValue('portal', 'WEB_PORTAL_BASE_URL', ''));
      setSelectBooleanValue(cpPortalOpenAccess, Boolean(getControlPanelEnvValue('portal', 'WEB_PORTAL_PLAYER_OPEN_ACCESS', false)));
      setSelectBooleanValue(cpPortalRequireGuild, Boolean(getControlPanelEnvValue('portal', 'WEB_PORTAL_REQUIRE_GUILD_MEMBER', false)));
      if (cpPortalMapUrl) cpPortalMapUrl.value = String(getControlPanelEnvValue('portal', 'WEB_PORTAL_MAP_EXTERNAL_URL', ''));
      renderControlPanelCommandRegistry();
      renderManagedServices();
      renderControlEnvCatalog();
      renderControlAdminUsers();
      renderControlPanelSummary();
    }

    async function refreshControlPanel(options = {}) {
      if (!isAuthed || !hasRoleAtLeast(currentUserRole, 'admin')) return;
      const { silent = true } = options;
      const res = await api('/admin/api/control-panel/settings');
      controlPanelSettings = res.data || null;
      fillControlPanelEnvFromSettings();
      fillControlPanelConfigFromSnapshot();
      if (!silent) {
        toast('รีโหลด Control Panel แล้ว');
      }
    }

    function getSelectedControlRestartTarget() {
      return String(controlRestartTargetSelect?.value || '').trim();
    }

    async function restartManagedServiceSelection(
      target,
      contextLabel = 'runtime service',
      options = {},
    ) {
      const { silent = false } = options;
      const normalizedTarget = String(target || '').trim();
      if (!normalizedTarget) return null;
      const res = await api('/admin/api/runtime/restart-service', 'POST', {
        services: [normalizedTarget],
      });
      const restartedLabels = Array.isArray(res.data?.services)
        ? res.data.services.map((entry) => entry.label || entry.key).filter(Boolean)
        : [];
      if (!silent) {
        toast(
          restartedLabels.length > 0
            ? `${contextLabel}: restart แล้ว (${restartedLabels.join(', ')})`
            : `${contextLabel}: restart แล้ว`,
        );
      }
      return res.data || null;
    }

    function buildControlEnvApplyMessage(contextLabel, envResult = {}, restartResult = null) {
      const summary = envResult?.applySummary || {};
      const totalChanged = Number(summary.totalChanged || 0);
      if (totalChanged <= 0) {
        return `${contextLabel}: no env changes`;
      }
      const parts = [`${contextLabel}: saved ${totalChanged} env key${totalChanged === 1 ? '' : 's'}`];
      if (summary.hotReloadOnly) {
        parts.push('hot reload only');
      } else if (summary.restartRequired) {
        const restartedLabels = Array.isArray(restartResult?.services)
          ? restartResult.services.map((entry) => entry.label || entry.key).filter(Boolean)
          : [];
        if (restartedLabels.length > 0) {
          parts.push(`restarted ${restartedLabels.join(', ')}`);
        } else if (
          Array.isArray(summary.suggestedRestartTargets)
          && summary.suggestedRestartTargets.length > 0
        ) {
          parts.push(`restart suggested: ${summary.suggestedRestartTargets.join(', ')}`);
        } else {
          parts.push('restart required');
        }
      }
      return parts.join(' | ');
    }

    async function saveControlEnvPatch(patch, contextLabel, options = {}) {
      const {
        restartTarget = '',
        restartLabel = contextLabel,
      } = options;
      const envResult = await api('/admin/api/control-panel/env', 'POST', patch);
      let restartResult = null;
      if (envResult?.data?.reloadRequired && String(restartTarget || '').trim()) {
        restartResult = await restartManagedServiceSelection(restartTarget, restartLabel, {
          silent: true,
        });
      }
      return {
        envResult: envResult?.data || {},
        restartResult,
        message: buildControlEnvApplyMessage(contextLabel, envResult?.data || {}, restartResult),
      };
    }

    function buildControlDiscordPatch() {
      return {
        channels: {
          commandsChannel: String(cpChannelCommands?.value || '').trim(),
          adminLog: String(cpChannelAdminLog?.value || '').trim(),
          shopLog: String(cpChannelShopLog?.value || '').trim(),
          evidence: String(cpChannelEvidence?.value || '').trim(),
          inServer: String(cpChannelInServer?.value || '').trim(),
        },
        roles: {
          owner: String(cpRoleOwner?.value || '').trim(),
          admin: String(cpRoleAdmin?.value || '').trim(),
          moderator: String(cpRoleModerator?.value || '').trim(),
          helper: String(cpRoleHelper?.value || '').trim(),
          vip: String(cpRoleVip?.value || '').trim(),
          verified: String(cpRoleVerified?.value || '').trim(),
        },
      };
    }

    function buildControlDeliveryPatch() {
      return {
        delivery: {
          auto: {
            enabled: String(cpDeliveryEnabled?.value || 'true') === 'true',
            executionMode: String(cpDeliveryMode?.value || 'rcon').trim() || 'rcon',
            verifyMode: String(cpDeliveryVerifyMode?.value || '').trim(),
            queueIntervalMs: parseNullableInt(cpDeliveryQueueInterval?.value),
            maxRetries: parseNullableInt(cpDeliveryMaxRetries?.value),
            retryDelayMs: parseNullableInt(cpDeliveryRetryDelay?.value),
            retryBackoff: parseNullableInt(cpDeliveryRetryBackoff?.value),
            commandTimeoutMs: parseNullableInt(cpDeliveryCommandTimeout?.value),
            magazineStackCount: parseNullableInt(cpDeliveryMagazineStackCount?.value),
            agentTeleportMode: String(cpDeliveryTeleportMode?.value || '').trim(),
            agentTeleportTarget: String(cpDeliveryTeleportTarget?.value || '').trim(),
            agentReturnTarget: String(cpDeliveryReturnTarget?.value || '').trim(),
            agentPreCommands: splitLines(cpDeliveryPreCommands?.value || ''),
            agentPostCommands: splitLines(cpDeliveryPostCommands?.value || ''),
          },
        },
      };
    }

    function buildControlCommandPatch() {
      const disabled = Array.from(
        document.querySelectorAll('#controlCommandWrap input[data-command-disable]:checked'),
      ).map((entry) => String(entry.value || '').trim()).filter(Boolean);
      const permissions = {
        ...(controlPanelSettings?.commandConfig?.permissions || {}),
      };
      Array.from(document.querySelectorAll('#controlCommandWrap select[data-command-role]'))
        .forEach((entry) => {
          const name = String(entry.getAttribute('data-command-role') || '').trim();
          if (!name) return;
          permissions[name] = String(entry.value || 'public').trim() || 'public';
        });
      return {
        commands: {
          disabled,
          permissions,
        },
      };
    }

    function buildRuntimeEnvPatch() {
      return {
        root: {
          DISCORD_GUILD_ID: String(cpGuildId?.value || '').trim(),
          BOT_ENABLE_ADMIN_WEB: String(cpFeatureAdminWeb?.value || 'false') === 'true',
          BOT_ENABLE_DELIVERY_WORKER: String(cpFeatureDeliveryWorker?.value || 'false') === 'true',
          WORKER_ENABLE_DELIVERY: String(cpFeatureWorkerDelivery?.value || 'false') === 'true',
          BOT_ENABLE_RENTBIKE_SERVICE: String(cpFeatureRentBikeService?.value || 'false') === 'true',
          WORKER_ENABLE_RENTBIKE: String(cpFeatureWorkerRentBike?.value || 'false') === 'true',
          BOT_ENABLE_SCUM_WEBHOOK: String(cpFeatureWebhook?.value || 'false') === 'true',
          DELIVERY_EXECUTION_MODE: String(cpRuntimeDeliveryExecutionMode?.value || 'rcon').trim() || 'rcon',
        },
      };
    }

    function buildRconAgentEnvPatch() {
      return {
        root: {
          RCON_HOST: String(cpRconHost?.value || '').trim(),
          RCON_PORT: String(cpRconPort?.value || '').trim(),
          RCON_PROTOCOL: String(cpRconProtocol?.value || '').trim(),
          RCON_EXEC_TEMPLATE: String(cpRconTemplate?.value || '').trim(),
          RCON_PASSWORD: String(cpRconPassword?.value || '').trim(),
          SCUM_CONSOLE_AGENT_BASE_URL: String(cpAgentBaseUrl?.value || '').trim(),
          SCUM_CONSOLE_AGENT_HOST: String(cpAgentHost?.value || '').trim(),
          SCUM_CONSOLE_AGENT_PORT: String(cpAgentPort?.value || '').trim(),
          SCUM_CONSOLE_AGENT_BACKEND: String(cpAgentBackend?.value || '').trim(),
          SCUM_CONSOLE_AGENT_EXEC_TEMPLATE: String(cpAgentTemplate?.value || '').trim(),
          SCUM_CONSOLE_AGENT_TOKEN: String(cpAgentToken?.value || '').trim(),
        },
      };
    }

    function buildWatcherPortalEnvPatch() {
      return {
        root: {
          SCUM_WEBHOOK_URL: String(cpWebhookUrl?.value || '').trim(),
          SCUM_WEBHOOK_PORT: String(cpWebhookPort?.value || '').trim(),
          SCUM_LOG_PATH: String(cpLogPath?.value || '').trim(),
        },
        portal: {
          WEB_PORTAL_BASE_URL: String(cpPortalBaseUrl?.value || '').trim(),
          WEB_PORTAL_PLAYER_OPEN_ACCESS: String(cpPortalOpenAccess?.value || 'false') === 'true',
          WEB_PORTAL_REQUIRE_GUILD_MEMBER: String(cpPortalRequireGuild?.value || 'false') === 'true',
          WEB_PORTAL_MAP_EXTERNAL_URL: String(cpPortalMapUrl?.value || '').trim(),
        },
      };
    }


