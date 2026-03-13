(() => {
  const adminTokenInput = document.getElementById('adminToken');
  const loadBtn = document.getElementById('loadBtn');
  const refreshBtn = document.getElementById('refreshBtn');
  const adminError = document.getElementById('adminError');
  const adminGrid = document.getElementById('adminGrid');
  const summaryText = document.getElementById('summaryText');

  const state = {
    token: '',
    sponsors: {},
    contributorsByKm: {}
  };

  function showError(message) {
    adminError.textContent = message;
    adminError.classList.remove('hidden');
  }

  function clearError() {
    adminError.textContent = '';
    adminError.classList.add('hidden');
  }

  async function parseJson(response) {
    const text = await response.text();
    if (!text) {
      return {};
    }

    try {
      return JSON.parse(text);
    } catch {
      return { error: text };
    }
  }

  async function adminFetch(path, options = {}) {
    if (!state.token) {
      throw new Error('Admin token is required.');
    }

    const headers = {
      'Content-Type': 'application/json',
      'x-admin-token': state.token,
      ...(options.headers || {})
    };

    const response = await fetch(path, { ...options, headers });
    const payload = await parseJson(response);

    if (!response.ok) {
      throw new Error(payload.error || 'Admin request failed.');
    }

    return payload;
  }

  function formatCurrency(amount) {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      return 'Not verified';
    }

    return `£${value.toLocaleString('en-GB')}`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function sponsorLabel(record) {
    if (record.sponsor_type === 'group') {
      return `Group: ${record.group_name || 'Unknown group'}`;
    }

    if (record.sponsor_type === 'sadaqah_jariyah') {
      const forName = record.for_name || 'Unknown';
      const fromName = record.from_name || 'Unknown';
      return `Sadaqah Jariyah for ${forName} (from ${fromName})`;
    }

    return `Individual: ${record.name || 'Unknown sponsor'}`;
  }

  function contributorRows(km, contributors) {
    if (!contributors.length) {
      return '<p class="text-sm text-dark/60">No contributors yet.</p>';
    }

    return `
      <div class="space-y-2">
        ${contributors
          .map((contributor) => {
            const isConfirmed = contributor.status === 'confirmed';
            const name = escapeHtml(contributor.name || 'Contributor');
            const email = escapeHtml(contributor.email || 'No email');
            const contributionCode = escapeHtml(contributor.contributionCode || '');
            const message = escapeHtml(contributor.message || '');
            const numericAmount = Number(contributor.amount || 0);
            return `
              <div class="rounded-xl border border-deepGreen/10 bg-white p-3">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <p class="text-sm font-semibold text-dark">${name}</p>
                  <span class="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${isConfirmed ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}">${isConfirmed ? 'Confirmed' : 'Pending'}</span>
                </div>
                <p class="mt-1 text-xs text-dark/65">${email} • ${contributionCode}</p>
                ${message ? `<p class="mt-1 text-xs italic text-dark/70">"${message}"</p>` : ''}
                <div class="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    max="10000"
                    step="0.01"
                    value="${numericAmount}"
                    data-contribution-amount="${contributionCode}"
                    class="w-32 rounded-lg border border-gray-300 px-2 py-1 text-sm"
                  />
                  <button
                    type="button"
                    data-contribution-toggle="${contributionCode}"
                    data-next-status="${isConfirmed ? 'pending' : 'confirmed'}"
                    class="rounded-full border border-deepGreen/20 px-3 py-1 text-xs font-semibold text-deepGreen transition hover:bg-deepGreen/5"
                  >
                    Mark ${isConfirmed ? 'Pending' : 'Confirmed'}
                  </button>
                  <button
                    type="button"
                    data-contribution-remove="${contributionCode}"
                    class="rounded-full border border-red-300 px-3 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-50"
                  >
                    Remove
                  </button>
                </div>
              </div>
            `;
          })
          .join('')}
      </div>
    `;
  }

  function render() {
    const kms = Object.keys(state.sponsors)
      .map(Number)
      .filter((km) => Number.isInteger(km))
      .sort((a, b) => a - b);

    const confirmedCount = kms.filter((km) => state.sponsors[km]?.status === 'confirmed').length;
    summaryText.textContent = `${kms.length} reserved • ${confirmedCount} confirmed`;

    if (!kms.length) {
      adminGrid.innerHTML = '<p class="rounded-xl border border-dashed border-deepGreen/25 bg-white p-5 text-sm text-dark/70">No reserved kilometres found.</p>';
      return;
    }

    adminGrid.innerHTML = kms
      .map((km) => {
        const sponsor = state.sponsors[km];
        const contributors = Array.isArray(state.contributorsByKm[km]) ? state.contributorsByKm[km] : [];
        const isConfirmed = sponsor.status === 'confirmed';
        const sponsorText = escapeHtml(sponsorLabel(sponsor));
        const sponsorEmail = escapeHtml(sponsor.email || 'No email');
        const verificationCode = escapeHtml(sponsor.verificationCode || '');
        const sponsorMessage = escapeHtml(sponsor.message || '');
        const verifiedAmount = Number(sponsor.verified_amount || 0);
        const primaryAmount = Number(sponsor.primary_amount || 0);

        return `
          <article class="rounded-2xl border border-deepGreen/10 bg-white p-5 shadow-sm">
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="text-xs font-semibold uppercase tracking-wide text-deepGreen/70">KM ${km}</p>
                <h3 class="mt-1 text-lg font-semibold text-deepGreen">${sponsorText}</h3>
                <p class="mt-1 text-xs text-dark/65">${sponsorEmail} • ${verificationCode}</p>
              </div>
              <span class="rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${isConfirmed ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}">
                ${isConfirmed ? 'Confirmed' : 'Pending'}
              </span>
            </div>

            ${sponsorMessage ? `<p class="mt-3 rounded-lg bg-cream px-3 py-2 text-sm italic text-dark/75">"${sponsorMessage}"</p>` : ''}

            <div class="mt-4 grid gap-3 sm:grid-cols-2">
              <div class="rounded-xl border border-deepGreen/10 bg-cream px-3 py-2">
                <p class="text-[11px] font-semibold uppercase tracking-wide text-deepGreen/70">Verified Amount</p>
                <p class="mt-1 text-sm font-semibold text-deepGreen">${formatCurrency(sponsor.verified_amount)}</p>
              </div>
              <div class="rounded-xl border border-deepGreen/10 bg-cream px-3 py-2">
                <p class="text-[11px] font-semibold uppercase tracking-wide text-deepGreen/70">Pledged Amount</p>
                <p class="mt-1 text-sm font-semibold text-deepGreen">£${primaryAmount.toLocaleString('en-GB')}</p>
              </div>
            </div>

            <div class="mt-4 flex flex-wrap items-center gap-2">
              <input
                type="number"
                min="0"
                max="10000"
                step="0.01"
                value="${verifiedAmount}"
                data-verify-amount="${km}"
                class="w-40 rounded-lg border border-gray-300 px-2.5 py-2 text-sm"
              />
              <button
                type="button"
                data-verify-km="${km}"
                class="rounded-full bg-deepGreen px-4 py-2 text-xs font-semibold text-cream transition hover:bg-[#0b3024]"
              >
                Save + Verify
              </button>
              ${!isConfirmed ? `
                <button
                  type="button"
                  data-unreserve-km="${km}"
                  class="rounded-full border border-red-300 px-4 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-50"
                >
                  Unreserve + Archive
                </button>
              ` : ''}
            </div>

            <div class="mt-4 rounded-xl border border-deepGreen/10 bg-gray-50 p-3">
              <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-deepGreen/70">Contributors</p>
              ${contributorRows(km, contributors)}
            </div>
          </article>
        `;
      })
      .join('');
  }

  async function loadData() {
    clearError();
    state.token = adminTokenInput.value.trim();
    if (!state.token) {
      showError('Please enter your admin token.');
      return;
    }

    sessionStorage.setItem('admin_token', state.token);

    try {
      const payload = await adminFetch('/api/admin', { method: 'GET' });
      state.sponsors = payload.sponsors || {};
      state.contributorsByKm = payload.contributorsByKm || {};
      render();
    } catch (error) {
      showError(error.message || 'Unable to load admin data.');
    }
  }

  async function updateSponsorVerification(km) {
    const amountInput = document.querySelector(`[data-verify-amount="${km}"]`);
    const verifiedAmount = Number(amountInput?.value);

    try {
      await adminFetch('/api/admin', {
        method: 'PATCH',
        body: JSON.stringify({
          action: 'verify_sponsor',
          km,
          verified_amount: verifiedAmount
        })
      });
      await loadData();
    } catch (error) {
      showError(error.message || 'Unable to verify sponsor.');
    }
  }

  async function archiveKm(km) {
    const ok = window.confirm(`Archive pending KM ${km} and reset it for a new sponsor?`);
    if (!ok) {
      return;
    }

    try {
      await adminFetch('/api/admin', {
        method: 'PATCH',
        body: JSON.stringify({
          action: 'unreserve_km',
          km,
          reason: 'Manual reset from admin portal'
        })
      });
      await loadData();
    } catch (error) {
      showError(error.message || 'Unable to archive KM.');
    }
  }

  async function toggleContributor(code, nextStatus) {
    const amountInput = document.querySelector(`[data-contribution-amount="${code}"]`);
    const amount = Number(amountInput?.value);

    try {
      await adminFetch('/api/admin', {
        method: 'PATCH',
        body: JSON.stringify({
          action: 'set_contributor_status',
          contribution_code: code,
          status: nextStatus,
          amount
        })
      });
      await loadData();
    } catch (error) {
      showError(error.message || 'Unable to update contributor.');
    }
  }

  async function removeContributor(code) {
    const ok = window.confirm('Archive and remove this contributor from the KM?');
    if (!ok) {
      return;
    }

    try {
      await adminFetch('/api/admin', {
        method: 'PATCH',
        body: JSON.stringify({
          action: 'remove_contributor',
          contribution_code: code,
          reason: 'Manual contributor reset from admin portal'
        })
      });
      await loadData();
    } catch (error) {
      showError(error.message || 'Unable to remove contributor.');
    }
  }

  loadBtn.addEventListener('click', loadData);
  refreshBtn.addEventListener('click', loadData);

  adminGrid.addEventListener('click', (event) => {
    const verifyBtn = event.target.closest('[data-verify-km]');
    if (verifyBtn) {
      updateSponsorVerification(Number(verifyBtn.dataset.verifyKm));
      return;
    }

    const unreserveBtn = event.target.closest('[data-unreserve-km]');
    if (unreserveBtn) {
      archiveKm(Number(unreserveBtn.dataset.unreserveKm));
      return;
    }

    const contributionBtn = event.target.closest('[data-contribution-toggle]');
    if (contributionBtn) {
      toggleContributor(
        contributionBtn.dataset.contributionToggle,
        contributionBtn.dataset.nextStatus === 'confirmed' ? 'confirmed' : 'pending'
      );
      return;
    }

    const removeContributorBtn = event.target.closest('[data-contribution-remove]');
    if (removeContributorBtn) {
      removeContributor(removeContributorBtn.dataset.contributionRemove);
    }
  });

  const savedToken = sessionStorage.getItem('admin_token') || '';
  if (savedToken) {
    adminTokenInput.value = savedToken;
    state.token = savedToken;
    loadData();
  }
})();
