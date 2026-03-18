/**
 * Browser-side event binding and startup wiring for the admin dashboard.
 * Extracted from the former dashboard monolith so binding/init code is isolated.
 */
const DASHBOARD_MESSAGES = Object.freeze({
  authRequired: 'ต้องเข้าสู่ระบบก่อน',
  ownerOnly: 'ต้องใช้สิทธิ์ owner',
  refreshing: 'กำลังรีเฟรช...',
  saving: 'กำลังบันทึก...',
  deleting: 'กำลังลบ...',
  exporting: 'กำลังส่งออก...',
  failed: 'ดำเนินการไม่สำเร็จ',
});

logoutBtn.addEventListener('click', async () => {
      try {
        await runWithButtonState(logoutBtn, 'กำลังออกจากระบบ...', async () => {
          await logout();
        });
      } catch (err) {
        toast(err.message);
      }
    });

    refreshBtn.addEventListener('click', async () => {
      if (!isAuthed) {
        return checkSession();
      }
      try {
        await runWithButtonState(refreshBtn, DASHBOARD_MESSAGES.refreshing, async () => {
          await refreshSnapshot({ forceCardsRefresh: true });
        });
        toast('รีเฟรชข้อมูลแล้ว');
      } catch (err) {
        setStatus('รีเฟรชไม่สำเร็จ', '#ff6b7b');
        toast(err.message);
      }
    });

    liveIntervalSelect.addEventListener('change', () => {
      liveIntervalMs = Math.max(1000, Number(liveIntervalSelect.value || 2000));
      if (!isAuthed) return;
      if (liveEnabled) {
        startLiveUpdates();
      }
      setConnectedStatus();
    });

    liveToggleBtn.addEventListener('click', () => {
      liveEnabled = !liveEnabled;
      updateLiveToggleUi();
      if (!isAuthed) return;
      if (liveEnabled) {
        startLiveUpdates();
        setStatus(
          `LIVE ${Math.round(liveIntervalMs / 1000)}s`,
          '#43dd86',
          'เชื่อมต่อ live updates แล้ว',
          'ok',
        );
        return;
      }
      stopLiveUpdates();
      setStatus('ปิดอัปเดตสดแล้ว', '#ffb84d', 'จะใช้การรีเฟรชแบบ manual/polling แทน', 'warn');
    });

    if (themeSelect) {
      themeSelect.addEventListener('change', () => {
        const selected = applyTheme(themeSelect.value, true);
        toast(`เปลี่ยนธีมเป็น ${selected === 'neon' ? 'Neon Cyber' : 'Military Tactical'}`);
      });
    }

    datasetSelect.addEventListener('change', renderSelectedDataset);
    [
      [auditWalletBtn, 'wallet'],
      [auditRewardBtn, 'reward'],
      [auditEventBtn, 'event'],
    ].forEach(([button, view]) => {
      if (!button) return;
      button.addEventListener('click', () => {
        currentAuditView = view;
        resetAuditPaging();
        renderAuditCenter();
      });
    });
    if (auditSearchInput) {
      auditSearchInput.addEventListener('input', () => {
        currentAuditQuery = String(auditSearchInput.value || '').trim();
        resetAuditPaging();
        renderAuditCenter();
      });
    }
    if (auditUserInput) {
      auditUserInput.addEventListener('input', () => {
        currentAuditUser = String(auditUserInput.value || '').trim();
        resetAuditPaging();
        renderAuditCenter();
      });
    }
    if (auditActorInput) {
      auditActorInput.addEventListener('input', () => {
        currentAuditActor = String(auditActorInput.value || '').trim();
        resetAuditPaging();
        renderAuditCenter();
      });
    }
    if (auditActorModeSelect) {
      auditActorModeSelect.addEventListener('change', () => {
        currentAuditActorMode = String(auditActorModeSelect.value || 'contains').trim().toLowerCase() === 'exact'
          ? 'exact'
          : 'contains';
        resetAuditPaging();
        renderAuditCenter();
      });
    }
    if (auditReasonInput) {
      auditReasonInput.addEventListener('input', () => {
        currentAuditReason = String(auditReasonInput.value || '').trim();
        resetAuditPaging();
        renderAuditCenter();
      });
    }
    if (auditReferenceInput) {
      auditReferenceInput.addEventListener('input', () => {
        currentAuditReference = String(auditReferenceInput.value || '').trim();
        resetAuditPaging();
        renderAuditCenter();
      });
    }
    if (auditReferenceModeSelect) {
      auditReferenceModeSelect.addEventListener('change', () => {
        currentAuditReferenceMode = String(auditReferenceModeSelect.value || 'contains').trim().toLowerCase() === 'exact'
          ? 'exact'
          : 'contains';
        resetAuditPaging();
        renderAuditCenter();
      });
    }
    if (auditStatusInput) {
      auditStatusInput.addEventListener('input', () => {
        currentAuditStatus = String(auditStatusInput.value || '').trim();
        resetAuditPaging();
        renderAuditCenter();
      });
    }
    if (auditStatusModeSelect) {
      auditStatusModeSelect.addEventListener('change', () => {
        currentAuditStatusMode = String(auditStatusModeSelect.value || 'contains').trim().toLowerCase() === 'exact'
          ? 'exact'
          : 'contains';
        resetAuditPaging();
        renderAuditCenter();
      });
    }
    if (auditDateFromInput) {
      auditDateFromInput.addEventListener('change', () => {
        currentAuditDateFrom = String(auditDateFromInput.value || '').trim();
        resetAuditPaging();
        renderAuditCenter();
      });
    }
    if (auditDateToInput) {
      auditDateToInput.addEventListener('change', () => {
        currentAuditDateTo = String(auditDateToInput.value || '').trim();
        resetAuditPaging();
        renderAuditCenter();
      });
    }
    if (auditSortBySelect) {
      auditSortBySelect.addEventListener('change', () => {
        currentAuditSortBy = String(auditSortBySelect.value || 'timestamp').trim() || 'timestamp';
        resetAuditPaging();
        renderAuditCenter();
      });
    }
    if (auditSortOrderSelect) {
      auditSortOrderSelect.addEventListener('change', () => {
        currentAuditSortOrder = String(auditSortOrderSelect.value || 'desc').trim().toLowerCase() === 'asc'
          ? 'asc'
          : 'desc';
        resetAuditPaging();
        renderAuditCenter();
      });
    }
    if (auditWindowSelect) {
      auditWindowSelect.addEventListener('change', () => {
        const raw = String(auditWindowSelect.value || 'all').trim().toLowerCase();
        const numeric = Number(raw);
        currentAuditWindowMs = raw === 'all' || !Number.isFinite(numeric) || numeric <= 0
          ? null
          : Math.max(60 * 1000, Math.trunc(numeric));
        resetAuditPaging();
        renderAuditCenter();
      });
    }
    if (auditPageSizeSelect) {
      auditPageSizeSelect.addEventListener('change', () => {
        currentAuditPageSize = Math.max(10, Number(auditPageSizeSelect.value || 50));
        resetAuditPaging();
        renderAuditCenter();
      });
    }
    if (auditPrevBtn) {
      auditPrevBtn.addEventListener('click', () => {
        if (currentAuditPrevCursor) {
          currentAuditCursor = currentAuditPrevCursor;
          currentAuditPage = Math.max(1, currentAuditPage - 1);
        } else {
          currentAuditPage = Math.max(1, currentAuditPage - 1);
          currentAuditCursor = null;
        }
        renderAuditCenter();
      });
    }
    if (auditNextBtn) {
      auditNextBtn.addEventListener('click', () => {
        if (currentAuditNextCursor) {
          currentAuditCursor = currentAuditNextCursor;
          currentAuditPage = Math.min(currentAuditTotalPages, currentAuditPage + 1);
        } else {
          currentAuditPage = Math.min(currentAuditTotalPages, currentAuditPage + 1);
          currentAuditCursor = null;
        }
        renderAuditCenter();
      });
    }
    if (auditExportCsvBtn) {
      auditExportCsvBtn.addEventListener('click', async () => {
        try {
          await exportAuditRows('csv');
        } catch (error) {
          toast(error.message || 'ส่งออก CSV ไม่สำเร็จ');
        }
      });
    }
    if (auditExportJsonBtn) {
      auditExportJsonBtn.addEventListener('click', async () => {
        try {
          await exportAuditRows('json');
        } catch (error) {
          toast(error.message || 'ส่งออก JSON ไม่สำเร็จ');
        }
      });
    }
    if (auditPresetSelect) {
      auditPresetSelect.addEventListener('change', () => {
        const selectedId = String(auditPresetSelect.value || '').trim();
        const preset = auditPresets.find((entry) => entry.id === selectedId);
        if (auditPresetNameInput) {
          auditPresetNameInput.value = preset?.name || '';
        }
        if (preset) {
          currentAuditPresetVisibility = preset.visibility;
          currentAuditPresetSharedRole = preset.sharedRole || 'mod';
        }
        updateAuditPresetSharingControls();
        if (auditPresetApplyBtn) {
          auditPresetApplyBtn.disabled = !selectedId;
        }
        if (auditPresetDeleteBtn) {
          auditPresetDeleteBtn.disabled = !preset || preset.canDelete === false;
        }
      });
    }
    if (auditPresetVisibilitySelect) {
      auditPresetVisibilitySelect.addEventListener('change', () => {
        currentAuditPresetVisibility = String(auditPresetVisibilitySelect.value || 'public').trim().toLowerCase() || 'public';
        if (currentAuditPresetVisibility !== 'role') {
          currentAuditPresetSharedRole = 'mod';
        }
        updateAuditPresetSharingControls();
      });
    }
    if (auditPresetSharedRoleSelect) {
      auditPresetSharedRoleSelect.addEventListener('change', () => {
        currentAuditPresetSharedRole = String(auditPresetSharedRoleSelect.value || 'mod').trim().toLowerCase() || 'mod';
      });
    }
    if (auditPresetApplyBtn) {
      auditPresetApplyBtn.addEventListener('click', () => {
        try {
          applyAuditPresetById(String(auditPresetSelect?.value || '').trim());
        } catch (error) {
          toast(error.message || 'ใช้ preset ไม่สำเร็จ');
        }
      });
    }
    if (auditPresetSaveBtn) {
      auditPresetSaveBtn.addEventListener('click', async () => {
        const draft = buildCurrentAuditPreset();
        if (!draft) {
          toast('กรุณาตั้งชื่อ preset ก่อนบันทึก');
          return;
        }
        try {
          await runWithButtonState(auditPresetSaveBtn, 'กำลังบันทึก preset...', async () => {
            const selectedId = String(auditPresetSelect?.value || currentAuditPresetId || '').trim();
            const selectedPreset = auditPresets.find((entry) => entry.id === selectedId);
            const res = await api('/admin/api/audit/presets', 'POST', {
              ...draft,
              id: selectedPreset && selectedPreset.canEdit === false ? undefined : (selectedId || undefined),
            });
            const saved = normalizeAuditPresetRecord(res?.data);
            currentAuditPresetId = String(saved?.id || '').trim();
            currentAuditPresetVisibility = saved?.visibility || currentAuditPresetVisibility;
            currentAuditPresetSharedRole = saved?.sharedRole || currentAuditPresetSharedRole;
            await refreshAuditPresetList(currentAuditPresetId);
            if (auditPresetNameInput) {
              auditPresetNameInput.value = saved?.name || draft.name;
            }
          });
          const savedName = String(auditPresetNameInput?.value || draft.name || '').trim();
          toast(`บันทึก preset แล้ว: ${savedName}`);
        } catch (error) {
          toast(error.message || 'บันทึก preset ไม่สำเร็จ');
        }
      });
    }
    if (auditPresetDeleteBtn) {
      auditPresetDeleteBtn.addEventListener('click', async () => {
        const selectedId = String(auditPresetSelect?.value || '').trim();
        const preset = auditPresets.find((entry) => entry.id === selectedId);
        if (!preset) {
          toast('ยังไม่ได้เลือก preset');
          return;
        }
        if (preset.canDelete === false) {
          toast('preset นี้ลบได้เฉพาะ owner');
          return;
        }
        if (!window.confirm(`ลบ preset "${preset.name}" ?`)) {
          return;
        }
        try {
          await runWithButtonState(auditPresetDeleteBtn, 'กำลังลบ preset...', async () => {
            await api('/admin/api/audit/presets/delete', 'POST', { id: selectedId });
            if (currentAuditPresetId === selectedId) {
              currentAuditPresetId = '';
            }
            await refreshAuditPresetList(currentAuditPresetId);
            if (auditPresetNameInput) {
              auditPresetNameInput.value = '';
            }
          });
          toast(`ลบ preset แล้ว: ${preset.name}`);
        } catch (error) {
          toast(error.message || 'ลบ preset ไม่สำเร็จ');
        }
      });
    }
    if (metricsWindowSelect) {
      metricsWindowSelect.addEventListener('change', () => {
        currentMetricsWindowMs = Math.max(
          60 * 1000,
          Number(metricsWindowSelect.value || 24 * 60 * 60 * 1000),
        );
        if (snapshot) {
          renderMetricsCharts();
        }
      });
    }
    if (metricsApplyWindowBtn) {
      metricsApplyWindowBtn.addEventListener('click', async () => {
        currentMetricsWindowMs = Math.max(
          60 * 1000,
          Number(metricsWindowSelect?.value || currentMetricsWindowMs),
        );
        if (!isAuthed) {
          toast(DASHBOARD_MESSAGES.authRequired);
          return;
        }
        try {
          await runWithButtonState(
            metricsApplyWindowBtn,
            'กำลังโหลด metrics...',
            async () => {
              await refreshObservabilitySnapshot({ silent: true });
            },
          );
          toast('อัปเดต metrics แล้ว');
        } catch (error) {
          toast(error.message || 'โหลด metrics ไม่สำเร็จ');
        }
      });
    }
    if (metricsExportCsvBtn) {
      metricsExportCsvBtn.addEventListener('click', async () => {
        try {
          await exportObservability('csv');
        } catch (error) {
          toast(error.message || 'ส่งออก metrics CSV ไม่สำเร็จ');
        }
      });
    }
    if (metricsExportJsonBtn) {
      metricsExportJsonBtn.addEventListener('click', async () => {
        try {
          await exportObservability('json');
        } catch (error) {
          toast(error.message || 'ส่งออก metrics JSON ไม่สำเร็จ');
        }
      });
    }
    window.addEventListener('resize', () => {
      if (!snapshot) return;
      renderMetricsCharts();
    });

    if (shopKindSelect) {
      shopKindSelect.addEventListener('change', () => {
        updateShopKindUi();
      });
    }

    if (shopGameItemSearchInput) {
      shopGameItemSearchInput.addEventListener('input', () => {
        scheduleGameItemCatalogFetch(shopGameItemSearchInput.value);
      });
      shopGameItemSearchInput.addEventListener('focus', () => {
        if (!shopGameItemList.innerHTML.trim()) {
          scheduleGameItemCatalogFetch(shopGameItemSearchInput.value);
        }
      });
    }

    if (shopCatalogSourceManifestBtn) {
      shopCatalogSourceManifestBtn.addEventListener('click', () => {
        setShopCatalogSource('manifest', { reload: true });
      });
    }

    if (shopCatalogSourceWeaponsBtn) {
      shopCatalogSourceWeaponsBtn.addEventListener('click', () => {
        setShopCatalogSource('weapons', { reload: true });
      });
    }

    if (shopCatalogSourceIconsBtn) {
      shopCatalogSourceIconsBtn.addEventListener('click', () => {
        setShopCatalogSource('icons', { reload: true });
      });
    }

    if (shopQuickAddBtn) {
      shopQuickAddBtn.addEventListener('click', async () => {
        if (!isAuthed) {
          toast(DASHBOARD_MESSAGES.authRequired);
          return;
        }
        try {
          await runWithButtonState(shopQuickAddBtn, 'กำลังเพิ่มสินค้า...', async () => {
            if (String(shopKindSelect?.value || 'item') !== 'item') {
              shopKindSelect.value = 'item';
              updateShopKindUi();
            }
            if (!Array.isArray(shopDeliveryItems) || shopDeliveryItems.length === 0) {
              throw new Error('ยังไม่ได้เลือกไอเทมจาก Wiki/รายการ');
            }
            if (!String(shopAddIdInput?.value || '').trim()) {
              const selected = String(shopDeliveryItems[0]?.gameItemId || '').trim();
              const suggested = makeSuggestedItemId(selected);
              if (suggested) {
                shopAddIdInput.value = suggested;
              }
            }
            if (!String(shopAddNameInput?.value || '').trim()) {
              const selected = String(shopDeliveryItems[0]?.gameItemId || '').trim();
              const qty = normalizeBundleQty(shopDeliveryItems[0]?.quantity || 1);
              if (selected) {
                shopAddNameInput.value = `${selected} x${qty}`;
              }
            }
            if (!String(new FormData(shopAddForm).get('price') || '').trim()) {
              throw new Error('กรุณาใส่ราคาสินค้าก่อนส่ง');
            }
            await submitForm(shopAddForm);
          });
        } catch (error) {
          setStatus('เพิ่มสินค้าไม่สำเร็จ', '#ff6b7b');
          toast(error.message || 'เพิ่มสินค้าไม่สำเร็จ');
        }
      });
    }

    if (shopQuantityInput) {
      shopQuantityInput.addEventListener('change', () => {
        if (!String(shopAddNameInput.value || '').trim()) return;
        if (!Array.isArray(shopDeliveryItems) || shopDeliveryItems.length !== 1) return;
        const selectedId = String(shopDeliveryItems[0]?.gameItemId || '').trim();
        const qty = normalizeBundleQty(shopQuantityInput.value || 1);
        if (selectedId && String(shopAddNameInput.value || '').startsWith(selectedId)) {
          shopAddNameInput.value = `${selectedId} x${qty}`;
        }
      });
    }

    copyJsonBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(rawView.textContent || '');
        toast('คัดลอก JSON แล้ว');
      } catch {
        toast('คัดลอก JSON ไม่สำเร็จ');
      }
    });

    if (snapshotExportBtn) {
      snapshotExportBtn.addEventListener('click', async () => {
        try {
          if (!isAuthed) {
            toast(DASHBOARD_MESSAGES.authRequired);
            return;
          }
          const { blob, filename } = await apiBlob('/admin/api/snapshot/export');
          downloadBlob(
            filename || `snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
            blob,
          );
          toast('ดาวน์โหลด snapshot แล้ว');
        } catch (error) {
          toast(error.message || 'ดาวน์โหลด snapshot ไม่สำเร็จ');
        }
      });
    }

    if (deliveryRuntimeRefreshBtn) {
      deliveryRuntimeRefreshBtn.addEventListener('click', async () => {
        if (!isAuthed) {
          toast(DASHBOARD_MESSAGES.authRequired);
          return;
        }
        try {
          await runWithButtonState(deliveryRuntimeRefreshBtn, DASHBOARD_MESSAGES.refreshing, async () => {
            await refreshDeliveryRuntime();
          });
          toast('รีเฟรช Delivery Runtime แล้ว');
        } catch (error) {
          toast(error.message || 'รีเฟรช Delivery Runtime ไม่สำเร็จ');
        }
      });
    }

    if (runtimeSupervisorRefreshBtn) {
      runtimeSupervisorRefreshBtn.addEventListener('click', async () => {
        if (!isAuthed) {
          toast(DASHBOARD_MESSAGES.authRequired);
          return;
        }
        try {
          await runWithButtonState(runtimeSupervisorRefreshBtn, DASHBOARD_MESSAGES.refreshing, async () => {
            await refreshRuntimeSupervisor();
          });
          toast('โหลด topology runtime แล้ว');
        } catch (error) {
          toast(error.message || 'โหลด topology runtime ไม่สำเร็จ');
        }
      });
    }

    if (backupRestoreStateRefreshBtn) {
      backupRestoreStateRefreshBtn.addEventListener('click', async () => {
        if (!isAuthed) {
          toast(DASHBOARD_MESSAGES.authRequired);
          return;
        }
        try {
          await runWithButtonState(backupRestoreStateRefreshBtn, DASHBOARD_MESSAGES.refreshing, async () => {
            await refreshBackupRestoreState();
          });
          toast('โหลดสถานะ restore แล้ว');
        } catch (error) {
          toast(error.message || 'โหลดสถานะ restore ไม่สำเร็จ');
        }
      });
    }

    if (authSecurityRefreshBtn) {
      authSecurityRefreshBtn.addEventListener('click', async () => {
        if (!isAuthed) {
          toast(DASHBOARD_MESSAGES.authRequired);
          return;
        }
        try {
          await runWithButtonState(authSecurityRefreshBtn, DASHBOARD_MESSAGES.refreshing, async () => {
            await refreshSnapshot({ silent: true, syncConfigInputs: false });
          });
          toast('โหลดข้อมูล auth แล้ว');
        } catch (error) {
          toast(error.message || 'โหลดข้อมูล auth ไม่สำเร็จ');
        }
      });
    }

    if (authFilterForm) {
      authFilterForm.addEventListener('submit', (event) => {
        event.preventDefault();
        currentAuthSearch = String(authSearchInput?.value || '').trim();
        currentAuthEventSeverity = String(authSeveritySelect?.value || '').trim().toLowerCase();
        currentAuthEventType = String(authEventTypeInput?.value || '').trim();
        currentAuthAnomalyOnly = String(authAnomalyOnlySelect?.value || '').trim().toLowerCase() === 'true';
        updateDashboardQueryParams({
          authQ: currentAuthSearch,
          authSeverity: currentAuthEventSeverity,
          authEventType: currentAuthEventType,
          authAnomalyOnly: currentAuthAnomalyOnly ? 'true' : '',
        });
        renderAuthSecurityCenter();
        toast('ใช้ auth filter แล้ว');
      });
    }

    if (authFilterResetBtn) {
      authFilterResetBtn.addEventListener('click', () => {
        resetAuthFilters();
        updateDashboardQueryParams({
          authQ: '',
          authSeverity: '',
          authEventType: '',
          authAnomalyOnly: '',
        });
        renderAuthSecurityCenter();
        toast('รีเซ็ต auth filter แล้ว');
      });
    }

    if (authSecurityExportCsvBtn) {
      authSecurityExportCsvBtn.addEventListener('click', async () => {
        if (!isAuthed) {
          toast(DASHBOARD_MESSAGES.authRequired);
          return;
        }
        try {
          await runWithButtonState(authSecurityExportCsvBtn, DASHBOARD_MESSAGES.exporting, async () => {
            const { blob, filename } = await apiBlob(buildAuthSecurityExportPath('csv'));
            downloadBlob(
              filename || `admin-security-events-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`,
              blob,
            );
          });
          toast('export security events เป็น CSV แล้ว');
        } catch (error) {
          toast(error.message || 'export security events ไม่สำเร็จ');
        }
      });
    }

    if (authSecurityExportJsonBtn) {
      authSecurityExportJsonBtn.addEventListener('click', async () => {
        if (!isAuthed) {
          toast(DASHBOARD_MESSAGES.authRequired);
          return;
        }
        try {
          await runWithButtonState(authSecurityExportJsonBtn, DASHBOARD_MESSAGES.exporting, async () => {
            const { blob, filename } = await apiBlob(buildAuthSecurityExportPath('json'));
            downloadBlob(
              filename || `admin-security-events-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
              blob,
            );
          });
          toast('export security events เป็น JSON แล้ว');
        } catch (error) {
          toast(error.message || 'export security events ไม่สำเร็จ');
        }
      });
    }

    if (authSessionRevokeForm) {
      authSessionRevokeForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!isAuthed) {
          toast(DASHBOARD_MESSAGES.authRequired);
          return;
        }
        if (!hasRoleAtLeast(currentUserRole, 'owner')) {
          toast(DASHBOARD_MESSAGES.ownerOnly);
          return;
        }
        const submitButton = getSubmitButton(authSessionRevokeForm, event);
        const payload = buildPayloadFromForm(authSessionRevokeForm);
        payload.current = String(payload.current || '').trim().toLowerCase() === 'true';
        const currentSessionId = getCurrentAdminSessionId();
        const revokesCurrent =
          payload.current === true
          || (!payload.sessionId && !payload.targetUser)
          || (payload.sessionId && payload.sessionId === currentSessionId)
          || (payload.targetUser && payload.targetUser === currentUserName);
        try {
          await runWithButtonState(submitButton, 'กำลัง revoke...', async () => {
            await api('/admin/api/auth/session/revoke', 'POST', payload);
          });
          if (revokesCurrent) {
            setAuthState(false);
            toast('revoke current session แล้ว กำลังกลับไปหน้า login');
            window.setTimeout(() => {
              window.location.replace('/admin/login');
            }, 150);
            return;
          }
          authSessionRevokeForm.reset();
          await refreshSnapshot({ silent: true, syncConfigInputs: false });
          toast('revoke session แล้ว');
        } catch (error) {
          toast(error.message || 'revoke session ไม่สำเร็จ');
        }
      });
    }

    if (authSessionTableWrap) {
      authSessionTableWrap.addEventListener('click', async (event) => {
        const button = event.target.closest('button[data-auth-session-revoke]');
        if (!button) return;
        if (!isAuthed) {
          toast(DASHBOARD_MESSAGES.authRequired);
          return;
        }
        if (!hasRoleAtLeast(currentUserRole, 'owner')) {
          toast(DASHBOARD_MESSAGES.ownerOnly);
          return;
        }
        const sessionId = String(button.getAttribute('data-auth-session-revoke') || '').trim();
        const isCurrent = String(button.getAttribute('data-auth-session-current') || '').trim() === 'true';
        if (!sessionId) {
          toast('ไม่พบ session ที่ต้องการ');
          return;
        }
        try {
          await runWithButtonState(button, 'กำลัง revoke...', async () => {
            await api('/admin/api/auth/session/revoke', 'POST', {
              sessionId,
              reason: isCurrent ? 'manual-revoke-current' : 'manual-revoke-session',
            });
          });
          if (isCurrent) {
            setAuthState(false);
            toast('revoke current session แล้ว กำลังกลับไปหน้า login');
            window.setTimeout(() => {
              window.location.replace('/admin/login');
            }, 150);
            return;
          }
          await refreshSnapshot({ silent: true, syncConfigInputs: false });
          toast(`revoke session แล้ว: ${sessionId}`);
        } catch (error) {
          toast(error.message || 'revoke session ไม่สำเร็จ');
        }
      });
    }

    if (controlPanelRefreshBtn) {
      controlPanelRefreshBtn.addEventListener('click', async () => {
        if (!isAuthed) {
          toast(DASHBOARD_MESSAGES.authRequired);
          return;
        }
        try {
          await runWithButtonState(controlPanelRefreshBtn, DASHBOARD_MESSAGES.refreshing, async () => {
            await refreshSnapshot({ silent: true, syncConfigInputs: true, forceCardsRefresh: true });
          });
          toast('โหลด Control Panel แล้ว');
        } catch (error) {
          toast(error.message || 'โหลด Control Panel ไม่สำเร็จ');
        }
      });
    }

    if (controlRestartNowBtn) {
      controlRestartNowBtn.addEventListener('click', async () => {
        if (!isAuthed) {
          toast(DASHBOARD_MESSAGES.authRequired);
          return;
        }
        if (!hasRoleAtLeast(currentUserRole, 'owner')) {
          toast(DASHBOARD_MESSAGES.ownerOnly);
          return;
        }
        const target = getSelectedControlRestartTarget();
        if (!target) {
          toast('เลือก service ที่ต้องการ restart ก่อน');
          return;
        }
        try {
          await runWithButtonState(controlRestartNowBtn, 'กำลัง restart...', async () => {
            await restartManagedServiceSelection(target, 'runtime service');
          });
          await refreshSnapshot({ silent: true, syncConfigInputs: true, forceCardsRefresh: true });
        } catch (error) {
          toast(error.message || 'restart service ไม่สำเร็จ');
        }
      });
    }

    document.querySelectorAll('[data-control-open-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        const tabKey = String(button.getAttribute('data-control-open-tab') || '').trim();
        if (tabKey) {
          activateTab(tabKey);
        }
      });
    });

    if (controlDiscordForm) {
      controlDiscordForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!isAuthed) {
          toast(DASHBOARD_MESSAGES.authRequired);
          return;
        }
        const submitButton = getSubmitButton(controlDiscordForm, event);
        const restartTarget = getSelectedControlRestartTarget();
        try {
          let envSaveResult = null;
          await runWithButtonState(submitButton, DASHBOARD_MESSAGES.saving, async () => {
            await api('/admin/api/config/patch', 'POST', {
              patch: buildControlDiscordPatch(),
            });
            if (hasRoleAtLeast(currentUserRole, 'owner')) {
              envSaveResult = await saveControlEnvPatch({
                root: {
                  DISCORD_GUILD_ID: String(cpGuildId?.value || '').trim(),
                },
              }, 'Discord / Access', {
                restartTarget,
                restartLabel: 'Discord / Access',
              });
            }
          });
          await refreshSnapshot({ silent: true, syncConfigInputs: true });
          toast(envSaveResult?.message || 'บันทึก Discord / Access แล้ว');
        } catch (error) {
          toast(error.message || 'บันทึก Discord / Access ไม่สำเร็จ');
        }
      });
    }

    if (controlCommandForm) {
      controlCommandForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!isAuthed) {
          toast(DASHBOARD_MESSAGES.authRequired);
          return;
        }
        const submitButton = getSubmitButton(controlCommandForm, event);
        try {
          await runWithButtonState(submitButton, DASHBOARD_MESSAGES.saving, async () => {
            await api('/admin/api/config/patch', 'POST', {
              patch: buildControlCommandPatch(),
            });
          });
          await refreshSnapshot({ silent: true, syncConfigInputs: true });
          toast('บันทึก command permissions แล้ว');
        } catch (error) {
          toast(error.message || 'บันทึก command permissions ไม่สำเร็จ');
        }
      });
    }

    if (controlDeliveryForm) {
      controlDeliveryForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!isAuthed) {
          toast(DASHBOARD_MESSAGES.authRequired);
          return;
        }
        const submitButton = getSubmitButton(controlDeliveryForm, event);
        try {
          await runWithButtonState(submitButton, DASHBOARD_MESSAGES.saving, async () => {
            await api('/admin/api/config/patch', 'POST', {
              patch: buildControlDeliveryPatch(),
            });
          });
          await refreshSnapshot({ silent: true, syncConfigInputs: true });
          toast('บันทึก Delivery Flow แล้ว');
        } catch (error) {
          toast(error.message || 'บันทึก Delivery Flow ไม่สำเร็จ');
        }
      });
    }

    if (controlEnvRuntimeForm) {
      controlEnvRuntimeForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!isAuthed) {
          toast(DASHBOARD_MESSAGES.authRequired);
          return;
        }
        if (!hasRoleAtLeast(currentUserRole, 'owner')) {
          toast(DASHBOARD_MESSAGES.ownerOnly);
          return;
        }
        const submitButton = getSubmitButton(controlEnvRuntimeForm, event);
        const restartTarget = getSelectedControlRestartTarget();
        try {
          let envSaveResult = null;
          await runWithButtonState(submitButton, DASHBOARD_MESSAGES.saving, async () => {
            envSaveResult = await saveControlEnvPatch(buildRuntimeEnvPatch(), 'Runtime Flags', {
              restartTarget,
              restartLabel: 'Runtime Flags',
            });
          });
          await refreshSnapshot({ silent: true, syncConfigInputs: true });
          toast(envSaveResult?.message || 'บันทึก Runtime Flags แล้ว');
        } catch (error) {
          toast(error.message || 'บันทึก Runtime Flags ไม่สำเร็จ');
        }
      });
    }

    if (controlRconAgentForm) {
      controlRconAgentForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!isAuthed) {
          toast(DASHBOARD_MESSAGES.authRequired);
          return;
        }
        if (!hasRoleAtLeast(currentUserRole, 'owner')) {
          toast(DASHBOARD_MESSAGES.ownerOnly);
          return;
        }
        const submitButton = getSubmitButton(controlRconAgentForm, event);
        const restartTarget = getSelectedControlRestartTarget();
        try {
          let envSaveResult = null;
          await runWithButtonState(submitButton, DASHBOARD_MESSAGES.saving, async () => {
            envSaveResult = await saveControlEnvPatch(buildRconAgentEnvPatch(), 'RCON / Agent', {
              restartTarget,
              restartLabel: 'RCON / Agent',
            });
          });
          await refreshSnapshot({ silent: true, syncConfigInputs: true });
          toast(envSaveResult?.message || 'บันทึก RCON / Agent แล้ว');
        } catch (error) {
          toast(error.message || 'บันทึก RCON / Agent ไม่สำเร็จ');
        }
      });
    }

    if (controlWatcherForm) {
      controlWatcherForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!isAuthed) {
          toast(DASHBOARD_MESSAGES.authRequired);
          return;
        }
        if (!hasRoleAtLeast(currentUserRole, 'owner')) {
          toast(DASHBOARD_MESSAGES.ownerOnly);
          return;
        }
        const submitButton = getSubmitButton(controlWatcherForm, event);
        const restartTarget = getSelectedControlRestartTarget();
        try {
          let envSaveResult = null;
          await runWithButtonState(submitButton, DASHBOARD_MESSAGES.saving, async () => {
            envSaveResult = await saveControlEnvPatch(buildWatcherPortalEnvPatch(), 'Watcher / Portal', {
              restartTarget,
              restartLabel: 'Watcher / Portal',
            });
          });
          await refreshSnapshot({ silent: true, syncConfigInputs: true });
          toast(envSaveResult?.message || 'บันทึก Watcher / Portal แล้ว');
        } catch (error) {
          toast(error.message || 'บันทึก Watcher / Portal ไม่สำเร็จ');
        }
      });
    }

    if (controlAdminUserForm) {
      controlAdminUserForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!isAuthed) {
          toast(DASHBOARD_MESSAGES.authRequired);
          return;
        }
        if (!hasRoleAtLeast(currentUserRole, 'owner')) {
          toast(DASHBOARD_MESSAGES.ownerOnly);
          return;
        }
        const submitButton = getSubmitButton(controlAdminUserForm, event);
        try {
          await runWithButtonState(submitButton, DASHBOARD_MESSAGES.saving, async () => {
            await api('/admin/api/auth/user', 'POST', {
              username: String(cpAdminUserName?.value || '').trim(),
              role: String(cpAdminUserRole?.value || 'mod').trim() || 'mod',
              isActive: String(cpAdminUserActive?.value || 'true') === 'true',
              password: String(cpAdminUserPassword?.value || '').trim(),
            });
          });
          if (cpAdminUserPassword) {
            cpAdminUserPassword.value = '';
          }
          await refreshSnapshot({ silent: true, syncConfigInputs: true });
          toast('บันทึก Admin User แล้ว');
        } catch (error) {
          toast(error.message || 'บันทึก Admin User ไม่สำเร็จ');
        }
      });
    }

    if (controlEnvCatalogWrap) {
      controlEnvCatalogWrap.addEventListener('click', async (event) => {
        const button = event.target.closest('button[data-control-env-save]');
        if (!button) return;
        if (!isAuthed) {
          toast(DASHBOARD_MESSAGES.authRequired);
          return;
        }
        if (!hasRoleAtLeast(currentUserRole, 'owner')) {
          toast(DASHBOARD_MESSAGES.ownerOnly);
          return;
        }
        const patch = buildControlEnvCatalogPatch();
        if (
          Object.keys(patch.root || {}).length === 0
          && Object.keys(patch.portal || {}).length === 0
        ) {
          toast('ยังไม่มี env key ที่เปลี่ยนแปลง');
          return;
        }
        const restartTarget = getSelectedControlRestartTarget();
        try {
          let envSaveResult = null;
          await runWithButtonState(button, DASHBOARD_MESSAGES.saving, async () => {
            envSaveResult = await saveControlEnvPatch(patch, 'env catalog', {
              restartTarget,
              restartLabel: 'env catalog',
            });
          });
          await refreshSnapshot({ silent: true, syncConfigInputs: true, forceCardsRefresh: true });
          toast(envSaveResult?.message || 'บันทึก env catalog แล้ว');
        } catch (error) {
          toast(error.message || 'บันทึก env catalog ไม่สำเร็จ');
        }
      });
    }

    if (stepUpConfirmBtn) {
      stepUpConfirmBtn.addEventListener('click', () => {
        submitStepUpModal();
      });
    }

    if (stepUpCancelBtn) {
      stepUpCancelBtn.addEventListener('click', () => {
        rejectPendingStepUp();
      });
    }

    if (stepUpOtpInput) {
      stepUpOtpInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          submitStepUpModal();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          rejectPendingStepUp();
        }
      });
    }

    if (stepUpModal) {
      stepUpModal.addEventListener('click', (event) => {
        if (event.target === stepUpModal) {
          rejectPendingStepUp();
        }
      });
    }

    if (deliveryCapabilityPresetRefreshBtn) {
      deliveryCapabilityPresetRefreshBtn.addEventListener('click', async () => {
        if (!isAuthed) {
          toast(DASHBOARD_MESSAGES.authRequired);
          return;
        }
        try {
          await runWithButtonState(deliveryCapabilityPresetRefreshBtn, DASHBOARD_MESSAGES.refreshing, async () => {
            await refreshDeliveryCapabilities();
          });
          toast('โหลด command catalog แล้ว');
        } catch (error) {
          toast(error.message || 'โหลด command catalog ไม่สำเร็จ');
        }
      });
    }

    if (deliveryCapabilitySelect) {
      deliveryCapabilitySelect.addEventListener('change', () => {
        const selected = findDeliveryCapabilityById(deliveryCapabilitySelect.value, 'builtin');
        if (!selected) return;
        if (deliveryCapabilityPresetSelect) {
          deliveryCapabilityPresetSelect.value = '';
        }
        applyDeliveryCapabilityToForms(selected);
      });
    }

    if (deliveryCapabilityPresetSelect) {
      deliveryCapabilityPresetSelect.addEventListener('change', () => {
        const selected = findDeliveryCapabilityById(deliveryCapabilityPresetSelect.value, 'preset');
        if (!selected) return;
        if (deliveryCapabilitySelect) {
          deliveryCapabilitySelect.value = '';
        }
        applyDeliveryCapabilityToForms(selected);
      });
    }

    if (deliveryCapabilityPresetManageSelect) {
      deliveryCapabilityPresetManageSelect.addEventListener('change', () => {
        const selected = findDeliveryCapabilityById(deliveryCapabilityPresetManageSelect.value, 'preset');
        if (!selected) {
          if (deliveryCapabilityPresetForm) {
            deliveryCapabilityPresetForm.reset();
          }
          return;
        }
        applyDeliveryCapabilityToForms(selected);
      });
    }

    if (deliveryCapabilityPresetDeleteBtn && deliveryCapabilityPresetManageSelect) {
      deliveryCapabilityPresetDeleteBtn.addEventListener('click', async () => {
        if (!isAuthed) {
          toast(DASHBOARD_MESSAGES.authRequired);
          return;
        }
        const presetId = String(deliveryCapabilityPresetManageSelect.value || '').trim();
        if (!presetId) {
          toast('กรุณาเลือก preset');
          return;
        }
        const selected = findDeliveryCapabilityById(presetId, 'preset');
        if (!selected) {
          toast('ไม่พบ preset ที่เลือก');
          return;
        }
        if (!window.confirm(`ลบ preset "${selected.name}" ?`)) {
          return;
        }
        try {
          await runWithButtonState(deliveryCapabilityPresetDeleteBtn, DASHBOARD_MESSAGES.deleting, async () => {
            await api('/admin/api/delivery/capability-preset/delete', 'POST', { presetId });
          });
          await refreshDeliveryCapabilities();
          if (deliveryCapabilityPresetForm) {
            deliveryCapabilityPresetForm.reset();
          }
          toast(`ลบ preset แล้ว: ${selected.name}`);
        } catch (error) {
          toast(error.message || 'ลบ preset ไม่สำเร็จ');
        }
      });
    }

    if (adminNotificationRefreshBtn) {
      adminNotificationRefreshBtn.addEventListener('click', async () => {
        if (!isAuthed) {
          toast(DASHBOARD_MESSAGES.authRequired);
          return;
        }
        try {
          await runWithButtonState(adminNotificationRefreshBtn, DASHBOARD_MESSAGES.refreshing, async () => {
            await refreshAdminNotifications();
          });
          toast('โหลด notification แล้ว');
        } catch (error) {
          toast(error.message || 'โหลด notification ไม่สำเร็จ');
        }
      });
    }

    if (adminNotificationAckBtn) {
      adminNotificationAckBtn.addEventListener('click', async () => {
        if (!isAuthed) {
          toast(DASHBOARD_MESSAGES.authRequired);
          return;
        }
        const selectedIds = getSelectedAdminNotificationIds();
        const ids = selectedIds.length > 0
          ? selectedIds
          : currentAdminNotifications
            .filter((row) => !row?.acknowledgedAt)
            .map((row) => String(row?.id || '').trim())
            .filter(Boolean);
        if (ids.length === 0) {
          toast('ไม่มี notification ที่ต้อง acknowledge');
          return;
        }
        try {
          await runWithButtonState(adminNotificationAckBtn, 'กำลัง acknowledge...', async () => {
            await api('/admin/api/notifications/ack', 'POST', { ids });
          });
          await refreshAdminNotifications();
          toast(`acknowledge แล้ว ${ids.length} รายการ`);
        } catch (error) {
          toast(error.message || 'acknowledge notification ไม่สำเร็จ');
        }
      });
    }

    if (adminNotificationClearBtn) {
      adminNotificationClearBtn.addEventListener('click', async () => {
        if (!isAuthed) {
          toast(DASHBOARD_MESSAGES.authRequired);
          return;
        }
        try {
          await runWithButtonState(adminNotificationClearBtn, 'กำลังล้าง...', async () => {
            await api('/admin/api/notifications/clear', 'POST', { acknowledgedOnly: true });
          });
          await refreshAdminNotifications();
          toast('ล้าง notification ที่ acknowledge แล้ว');
        } catch (error) {
          toast(error.message || 'ล้าง notification ไม่สำเร็จ');
        }
      });
    }

    if (deliveryQueueApplyFilterBtn) {
      deliveryQueueApplyFilterBtn.addEventListener('click', () => {
        currentDeliveryQueueErrorFilter = String(deliveryQueueErrorFilterInput?.value || '').trim();
        currentDeliveryQueueSearch = String(deliveryQueueSearchInput?.value || '').trim();
        renderDeliveryQueueTable(snapshot?.deliveryQueue || []);
      });
    }

    if (deliveryDeadApplyFilterBtn) {
      deliveryDeadApplyFilterBtn.addEventListener('click', () => {
        currentDeliveryDeadErrorFilter = String(deliveryDeadErrorFilterInput?.value || '').trim();
        currentDeliveryDeadSearch = String(deliveryDeadSearchInput?.value || '').trim();
        renderDeliveryDeadLetterTable(snapshot?.deliveryDeadLetters || []);
      });
    }

    if (deliveryQueueRetryManyBtn) {
      deliveryQueueRetryManyBtn.addEventListener('click', async () => {
        const codes = getSelectedDeliveryCodes(deliveryQueueTableWrap, 'data-delivery-select');
        if (codes.length === 0) {
          toast('เลือกคำสั่งซื้อที่ต้อง retry ก่อน');
          return;
        }
        try {
          await runWithButtonState(deliveryQueueRetryManyBtn, 'กำลัง retry ที่เลือก...', async () => {
            await api('/admin/api/delivery/retry-many', 'POST', { codes });
          });
          await refreshSnapshot({ silent: true, syncConfigInputs: false });
          toast(`ส่ง retry แล้ว ${codes.length} รายการ`);
        } catch (error) {
          toast(error.message || 'retry หลายรายการไม่สำเร็จ');
        }
      });
    }

    if (deliveryDeadRetryManyBtn) {
      deliveryDeadRetryManyBtn.addEventListener('click', async () => {
        const codes = getSelectedDeliveryCodes(deliveryDeadLetterTableWrap, 'data-delivery-dead-select');
        if (codes.length === 0) {
          toast('เลือก dead-letter ที่ต้อง requeue ก่อน');
          return;
        }
        try {
          await runWithButtonState(deliveryDeadRetryManyBtn, 'กำลัง requeue ที่เลือก...', async () => {
            await api('/admin/api/delivery/dead-letter/retry-many', 'POST', { codes });
          });
          await refreshSnapshot({ silent: true, syncConfigInputs: false });
          toast(`requeue แล้ว ${codes.length} รายการ`);
        } catch (error) {
          toast(error.message || 'requeue หลายรายการไม่สำเร็จ');
        }
      });
    }

    if (deliveryPreflightForm) {
      deliveryPreflightForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!isAuthed) {
          toast(DASHBOARD_MESSAGES.authRequired);
          return;
        }
        const submitButton = getSubmitButton(deliveryPreflightForm, event);
        const payload = buildPayloadFromForm(deliveryPreflightForm);
        try {
          await runWithButtonState(submitButton, 'กำลังตรวจ...', async () => {
            await runDeliveryPreflightRequest(payload);
          });
          toast('รัน preflight แล้ว');
        } catch (error) {
          if (deliveryPreflightView) {
            deliveryPreflightView.textContent = String(error.message || error);
          }
          toast(error.message || 'รัน preflight ไม่สำเร็จ');
        }
      });
    }

    if (deliveryPreviewForm) {
      deliveryPreviewForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!isAuthed) {
          toast(DASHBOARD_MESSAGES.authRequired);
          return;
        }
        const submitButton = getSubmitButton(deliveryPreviewForm, event);
        const payload = buildPayloadFromForm(deliveryPreviewForm);
        try {
          await runWithButtonState(submitButton, 'กำลังพรีวิว...', async () => {
            await previewDeliveryCommand(payload);
          });
          toast('พรีวิว delivery แล้ว');
        } catch (error) {
          if (deliveryPreviewView) {
            deliveryPreviewView.textContent = String(error.message || error);
          }
          toast(error.message || 'พรีวิว delivery ไม่สำเร็จ');
        }
      });
    }

    if (deliverySimulateForm) {
      deliverySimulateForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!isAuthed) {
          toast(DASHBOARD_MESSAGES.authRequired);
          return;
        }
        const submitButton = getSubmitButton(deliverySimulateForm, event);
        const payload = buildPayloadFromForm(deliverySimulateForm);
        try {
          await runWithButtonState(submitButton, 'กำลังจำลอง...', async () => {
            await simulateDelivery(payload);
          });
          toast('จำลอง delivery plan แล้ว');
        } catch (error) {
          if (deliverySimulateView) {
            deliverySimulateView.textContent = String(error.message || error);
          }
          toast(error.message || 'simulate delivery ไม่สำเร็จ');
        }
      });
    }

    if (deliveryCommandTemplateLoadBtn && deliveryCommandTemplateForm) {
      deliveryCommandTemplateLoadBtn.addEventListener('click', async () => {
        if (!isAuthed) {
          toast(DASHBOARD_MESSAGES.authRequired);
          return;
        }
        const payload = buildPayloadFromForm(deliveryCommandTemplateForm);
        try {
          await runWithButtonState(deliveryCommandTemplateLoadBtn, DASHBOARD_MESSAGES.refreshing, async () => {
            await loadDeliveryCommandTemplate(payload);
          });
          toast('โหลด command template แล้ว');
        } catch (error) {
          if (deliveryCommandTemplateView) {
            deliveryCommandTemplateView.textContent = String(error.message || error);
          }
          toast(error.message || 'โหลด command template ไม่สำเร็จ');
        }
      });
    }

    if (deliveryCommandTemplateDeleteBtn && deliveryCommandTemplateForm) {
      deliveryCommandTemplateDeleteBtn.addEventListener('click', async () => {
        if (!isAuthed) {
          toast(DASHBOARD_MESSAGES.authRequired);
          return;
        }
        const payload = buildPayloadFromForm(deliveryCommandTemplateForm);
        try {
          await runWithButtonState(deliveryCommandTemplateDeleteBtn, DASHBOARD_MESSAGES.deleting, async () => {
            const res = await api('/admin/api/delivery/command-template', 'POST', {
              ...payload,
              clear: true,
            });
            renderDeliveryCommandTemplate(res?.data || null);
          });
          await refreshAdminNotifications().catch(() => null);
          toast('ลบ command template override แล้ว');
        } catch (error) {
          if (deliveryCommandTemplateView) {
            deliveryCommandTemplateView.textContent = String(error.message || error);
          }
          toast(error.message || 'ลบ command template ไม่สำเร็จ');
        }
      });
    }

    if (deliveryCommandTemplateForm) {
      deliveryCommandTemplateForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!isAuthed) {
          toast(DASHBOARD_MESSAGES.authRequired);
          return;
        }
        const submitButton = getSubmitButton(deliveryCommandTemplateForm, event);
        const payload = buildPayloadFromForm(deliveryCommandTemplateForm);
        if (payload.commands) {
          payload.commands = String(payload.commands)
            .split(/\r?\n/)
            .map((row) => row.trim())
            .filter(Boolean);
        }
        try {
          await runWithButtonState(submitButton, DASHBOARD_MESSAGES.saving, async () => {
            const res = await api('/admin/api/delivery/command-template', 'POST', payload);
            renderDeliveryCommandTemplate(res?.data || null);
          });
          await refreshAdminNotifications().catch(() => null);
          toast('บันทึก command template แล้ว');
        } catch (error) {
          if (deliveryCommandTemplateView) {
            deliveryCommandTemplateView.textContent = String(error.message || error);
          }
          toast(error.message || 'บันทึก command template ไม่สำเร็จ');
        }
      });
    }

    if (deliveryTestSendForm) {
      deliveryTestSendForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!isAuthed) {
          toast(DASHBOARD_MESSAGES.authRequired);
          return;
        }
        const submitButton = getSubmitButton(deliveryTestSendForm, event);
        const payload = buildPayloadFromForm(deliveryTestSendForm);
        try {
          await runWithButtonState(submitButton, 'กำลังส่ง test item...', async () => {
            const res = await api('/admin/api/delivery/test-send', 'POST', payload);
            if (deliveryTestSendView) {
              deliveryTestSendView.textContent = JSON.stringify(res?.data || {}, null, 2);
            }
          });
          if (String(payload.purchaseCode || '').trim()) {
            await loadDeliveryDetail(String(payload.purchaseCode || '').trim(), {
              silent: true,
              preserveStatus: true,
            });
          }
          await refreshSnapshot({ silent: true, syncConfigInputs: false });
          toast('ส่ง test item แล้ว');
        } catch (error) {
          if (deliveryTestSendView) {
            deliveryTestSendView.textContent = String(error.message || error);
          }
          toast(error.message || 'ส่ง test item ไม่สำเร็จ');
        }
      });
    }

    if (deliveryCapabilityTestForm) {
      deliveryCapabilityTestForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!isAuthed) {
          toast(DASHBOARD_MESSAGES.authRequired);
          return;
        }
        const submitButton = getSubmitButton(deliveryCapabilityTestForm, event);
        const payload = buildPayloadFromForm(deliveryCapabilityTestForm);
        payload.dryRun = String(payload.dryRun || '').toLowerCase() === 'true';
        try {
          await runWithButtonState(submitButton, payload.dryRun ? 'กำลังตรวจ dry-run...' : 'กำลัง execute...', async () => {
            const res = await api('/admin/api/delivery/capability-test', 'POST', payload);
            renderDeliveryCapabilityResult(res?.data || null);
          });
          toast(payload.dryRun ? 'รัน capability dry run แล้ว' : 'รัน capability test แล้ว');
        } catch (error) {
          if (deliveryCapabilityView) {
            deliveryCapabilityView.textContent = String(error.message || error);
          }
          toast(error.message || 'รัน capability test ไม่สำเร็จ');
        }
      });
    }

    if (deliveryCapabilityPresetForm) {
      deliveryCapabilityPresetForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!isAuthed) {
          toast(DASHBOARD_MESSAGES.authRequired);
          return;
        }
        const submitButton = getSubmitButton(deliveryCapabilityPresetForm, event);
        const payload = buildPayloadFromForm(deliveryCapabilityPresetForm);
        if (payload.commands) {
          payload.commands = String(payload.commands)
            .split(/\r?\n/)
            .map((row) => row.trim())
            .filter(Boolean);
        }
        if (payload.tags) {
          payload.tags = String(payload.tags)
            .split(',')
            .map((row) => row.trim())
            .filter(Boolean);
        }
        try {
          await runWithButtonState(submitButton, 'กำลังบันทึก preset...', async () => {
            const res = await api('/admin/api/delivery/capability-preset', 'POST', payload);
            if (deliveryCapabilityPresetView) {
              deliveryCapabilityPresetView.textContent = JSON.stringify(res?.data || {}, null, 2);
            }
          });
          await refreshDeliveryCapabilities();
          const selectedId = String(deliveryCapabilityPresetManageSelect?.value || payload.id || '').trim();
          const selected = findDeliveryCapabilityById(selectedId, 'preset');
          if (selected) {
            applyDeliveryCapabilityToForms(selected);
          }
          toast('บันทึก capability preset แล้ว');
        } catch (error) {
          if (deliveryCapabilityPresetView) {
            deliveryCapabilityPresetView.textContent = String(error.message || error);
          }
          toast(error.message || 'บันทึก capability preset ไม่สำเร็จ');
        }
      });
    }

    if (deliveryOpsRefreshBtn) {
      deliveryOpsRefreshBtn.addEventListener('click', async () => {
        if (!isAuthed) {
          toast(DASHBOARD_MESSAGES.authRequired);
          return;
        }
        try {
          await runWithButtonState(
            deliveryOpsRefreshBtn,
            'กำลังรีเฟรชข้อมูล...',
            async () => {
              await refreshSnapshot({ silent: true, syncConfigInputs: false });
            },
          );
          toast('รีเฟรช Delivery Ops แล้ว');
        } catch (error) {
          toast(error.message || 'รีเฟรช Delivery Ops ไม่สำเร็จ');
        }
      });
    }

    if (platformRefreshBtn) {
      platformRefreshBtn.addEventListener('click', async () => {
        if (!isAuthed) {
          toast(DASHBOARD_MESSAGES.authRequired);
          return;
        }
        try {
          await runWithButtonState(platformRefreshBtn, DASHBOARD_MESSAGES.refreshing, async () => {
            await refreshSnapshot({ silent: true, syncConfigInputs: false, forceCardsRefresh: true });
            await refreshPlatformCenter({
              forceOverview: true,
              forceReconcile: true,
              fetchOpsState: true,
            });
          });
          toast('โหลด Platform Center แล้ว');
        } catch (error) {
          toast(error.message || 'โหลด Platform Center ไม่สำเร็จ');
        }
      });
    }

    if (platformRunMonitoringBtn) {
      platformRunMonitoringBtn.addEventListener('click', async () => {
        if (!isAuthed) {
          toast(DASHBOARD_MESSAGES.authRequired);
          return;
        }
        try {
          await runWithButtonState(platformRunMonitoringBtn, 'กำลังรัน...', async () => {
            const res = await api('/admin/api/platform/monitoring/run', 'POST', {});
            currentPlatformMonitoringReport = res?.data || null;
            await refreshSnapshot({ silent: true, syncConfigInputs: false });
            await refreshPlatformCenter({
              forceOverview: true,
              forceReconcile: true,
              fetchOpsState: true,
            });
          });
          toast('รัน platform monitoring แล้ว');
        } catch (error) {
          toast(error.message || 'รัน platform monitoring ไม่สำเร็จ');
        }
      });
    }

    if (platformRunReconcileBtn) {
      platformRunReconcileBtn.addEventListener('click', async () => {
        if (!isAuthed) {
          toast(DASHBOARD_MESSAGES.authRequired);
          return;
        }
        try {
          await runWithButtonState(platformRunReconcileBtn, 'กำลัง reconcile...', async () => {
            const res = await api('/admin/api/platform/reconcile');
            currentPlatformReconcile = res?.data || null;
            await refreshPlatformCenter({
              forceOverview: false,
              forceReconcile: false,
              fetchOpsState: true,
            });
          });
          toast('รัน delivery reconcile แล้ว');
        } catch (error) {
          toast(error.message || 'รัน delivery reconcile ไม่สำเร็จ');
        }
      });
    }

    document.querySelectorAll('form[data-endpoint]').forEach((form) => {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!isAuthed) {
          toast(DASHBOARD_MESSAGES.authRequired);
          return;
        }
        const submitButton = getSubmitButton(form, event);
        try {
          await runWithButtonState(submitButton, 'กำลังส่งคำสั่ง...', async () => {
            await submitForm(form);
          });
        } catch (err) {
          setStatus(DASHBOARD_MESSAGES.failed, '#ff6b7b');
          toast(err.message);
        }
      });
    });

    configLoadBtn.addEventListener('click', async () => {
      if (!isAuthed) {
        toast(DASHBOARD_MESSAGES.authRequired);
        return;
      }
      if (!snapshot) {
        await runWithButtonState(configLoadBtn, DASHBOARD_MESSAGES.refreshing, async () => {
          await refreshSnapshot();
        });
      }
      fillConfigEditorFromSnapshot();
      toast('โหลด config ปัจจุบันแล้ว');
    });

    configPatchBtn.addEventListener('click', async () => {
      if (!isAuthed) {
        toast(DASHBOARD_MESSAGES.authRequired);
        return;
      }
      try {
        await runWithButtonState(configPatchBtn, 'กำลัง patch...', async () => {
          const patch = parseConfigEditorValue();
          await api('/admin/api/config/patch', 'POST', { patch });
        });
        toast('บันทึก config patch แล้ว');
        await refreshSnapshot();
      } catch (err) {
        setStatus(DASHBOARD_MESSAGES.failed, '#ff6b7b');
        toast(err.message);
      }
    });

    simpleLoadBtn.addEventListener('click', async () => {
      if (!isAuthed) {
        toast(DASHBOARD_MESSAGES.authRequired);
        return;
      }
      await runWithButtonState(simpleLoadBtn, DASHBOARD_MESSAGES.refreshing, async () => {
        if (!snapshot) {
          await refreshSnapshot();
        } else {
          fillSimpleConfigFromSnapshot();
        }
      });
      toast('โหลดค่าตั้งค่าง่ายแล้ว');
    });

    simpleConfigForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!isAuthed) {
        toast(DASHBOARD_MESSAGES.authRequired);
        return;
      }
      const submitButton = getSubmitButton(simpleConfigForm, event);
      try {
        await runWithButtonState(submitButton, DASHBOARD_MESSAGES.saving, async () => {
          const patch = buildSimpleConfigPatch();
          if (Object.keys(patch).length === 0) {
            throw new Error('ยังไม่ได้แก้ค่าที่ต้องบันทึก');
          }
          await api('/admin/api/config/patch', 'POST', { patch });
        });
        toast('บันทึกตั้งค่าง่ายแล้ว');
        await refreshSnapshot();
      } catch (err) {
        setStatus(DASHBOARD_MESSAGES.failed, '#ff6b7b');
        toast(err.message);
      }
    });

    configEditorForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!isAuthed) {
        toast(DASHBOARD_MESSAGES.authRequired);
        return;
      }
      const submitButton = getSubmitButton(configEditorForm, event);
      try {
        await runWithButtonState(submitButton, DASHBOARD_MESSAGES.saving, async () => {
          const nextConfig = parseConfigEditorValue();
          await api('/admin/api/config/set', 'POST', { config: nextConfig });
        });
        toast('บันทึก config ทั้งชุดแล้ว');
        await refreshSnapshot();
      } catch (err) {
        setStatus(DASHBOARD_MESSAGES.failed, '#ff6b7b');
        toast(err.message);
      }
    });

    configResetBtn.addEventListener('click', async () => {
      if (!isAuthed) {
        toast(DASHBOARD_MESSAGES.authRequired);
        return;
      }
      if (!window.confirm('ยืนยันรีเซ็ตคอนฟิกทั้งหมดกลับค่าเริ่มต้น?')) {
        return;
      }
      try {
        await runWithButtonState(configResetBtn, DASHBOARD_MESSAGES.saving, async () => {
          await api('/admin/api/config/reset', 'POST', {});
        });
        toast('รีเซ็ต config แล้ว');
        await refreshSnapshot();
        fillConfigEditorFromSnapshot();
      } catch (err) {
        setStatus(DASHBOARD_MESSAGES.failed, '#ff6b7b');
        toast(err.message);
      }
    });

    for (const btn of tabButtons) {
      btn.addEventListener('click', () => {
        activateTab(btn.dataset.tab);
      });
    }

    overviewTabButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const tabKey = String(btn.dataset.overviewTab || '').trim();
        if (tabKey) {
          activateTab(tabKey);
        }
      });
    });

    if (tabSearchInput) {
      tabSearchInput.addEventListener('input', () => {
        applyTabFilter(tabSearchInput.value);
      });
    }

    applyTheme(loadPreferredTheme(), false);
    syncAuthFiltersFromQueryParams();
    renderAuditPresetOptions('');
    syncAuditControlsFromState();
    activateTab(getInitialActiveTabKey());
    applyTabFilter('');
    updateLiveToggleUi();
    setShopCatalogSource('manifest', { reload: false });
    updateShopKindUi();
    setAuthState(false);
    checkSession();
  




