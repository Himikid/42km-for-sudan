(() => {
  const totalKilometres = 42;

  const demoClaimedKmData = {};

  const claimedKmData = { ...demoClaimedKmData };
  const reservedKmData = new Map();
  const kmTiles = new Map();
  const backendClaimedKms = new Set();

  const kmGrid = document.getElementById('kmGrid');
  const progressText = document.getElementById('progressText');
  const progressBar = document.getElementById('progressBar');

  const modal = document.getElementById('modal');
  const modalBackdrop = document.getElementById('modalBackdrop');
  const closeModalBtn = document.getElementById('closeModal');
  const modalTitle = document.getElementById('modalTitle');
  const modalContent = document.getElementById('modalContent');
  const justGivingUrl = 'https://www.justgiving.com/fundraising/ibrahimjaved-6994f535e1c202f790972e93';
  const liveContributionsByKm = new Map();
  let initialKmHandled = false;

  function getKmStatus(km) {
    if (claimedKmData[km]) {
      return 'claimed';
    }

    if (reservedKmData.has(km)) {
      return 'reserved';
    }

    return 'available';
  }

  function sponsoredCount() {
    return Object.keys(claimedKmData).length + reservedKmData.size;
  }

  function progressPercentage() {
    return (sponsoredCount() / totalKilometres) * 100;
  }

  function renderProgress() {
    const sponsored = sponsoredCount();
    progressText.textContent = `${sponsored} / ${totalKilometres} kilometres sponsored`;
    progressBar.style.width = `${progressPercentage()}%`;
  }

  function formatPounds(amount) {
    return `£${Number(amount).toLocaleString('en-GB')}`;
  }

  function renderAmountText(amount) {
    const normalized = Number(amount);
    if (!Number.isFinite(normalized) || normalized <= 0) {
      return '';
    }

    return formatPounds(normalized);
  }

  function getKmShareUrl(km) {
    const shareUrl = new URL(window.location.href);
    shareUrl.searchParams.set('km', String(km));
    shareUrl.hash = 'kilometres';
    return shareUrl.toString();
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function normalizeSponsorType(value) {
    if (value === 'group' || value === 'sadaqah_jariyah') {
      return value;
    }
    return 'individual';
  }

  function normalizeSponsorAmount(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    return Math.round(parsed * 100) / 100;
  }

  function getSponsorMeta(data) {
    const sponsorType = normalizeSponsorType(data?.sponsor_type);

    if (sponsorType === 'group') {
      return {
        sponsorType,
        heading: 'Group Sponsor',
        nameLine: data?.group_name || 'Group name'
      };
    }

    if (sponsorType === 'sadaqah_jariyah') {
      return {
        sponsorType,
        heading: 'Sadaqah Jariyah',
        nameLine: data?.for_name || 'Pending'
      };
    }

    return {
      sponsorType: 'individual',
      heading: 'Primary Sponsor',
      nameLine: data?.name || data?.primarySponsor || 'Sponsor name'
    };
  }

  function normalizeSupporters(supporters) {
    if (!Array.isArray(supporters)) {
      return [];
    }

    return supporters.map((entry) => {
      if (typeof entry === 'string') {
        return { name: entry, amount: 20, status: 'confirmed', message: '' };
      }

      return {
        name: entry?.name || 'Supporter',
        amount: Number(entry?.amount ?? 20),
        status: entry?.status || 'confirmed',
        message: entry?.message || ''
      };
    });
  }

  function getContributionSummary(source, meta, km) {
    const primaryPledgedAmount = Number(source?.primary_amount ?? 85);
    const primaryStatus = source?.status === 'confirmed' ? 'confirmed' : 'pending';
    const primaryAmount = primaryStatus === 'confirmed'
      ? Number(source?.verified_amount ?? primaryPledgedAmount)
      : 0;
    const primaryLabel = meta.sponsorType === 'group'
      ? (source?.group_name || 'Group Sponsor')
      : meta.sponsorType === 'sadaqah_jariyah'
        ? (source?.from_name || 'Sadaqah Jariyah')
        : (source?.name || source?.primarySponsor || 'Primary Sponsor');

    const supporterEntries = normalizeSupporters(source?.supporters);
    const liveEntries = normalizeSupporters(liveContributionsByKm.get(km) || []);
    const contributors = [
      {
        role: 'Primary Sponsor',
        name: primaryLabel,
        amount: primaryAmount,
        pledgedAmount: primaryPledgedAmount,
        status: primaryStatus
      },
      ...supporterEntries.map((entry) => ({
        role: 'Contributor',
        name: entry.name,
        amount: Number(entry.amount),
        status: entry.status || 'confirmed',
        message: entry.message || ''
      })),
      ...liveEntries.map((entry) => ({
        role: 'Contributor',
        name: entry.name,
        amount: Number(entry.amount),
        status: entry.status || 'pending',
        message: entry.message || ''
      }))
    ];

    const verifiedTotal = contributors.reduce(
      (sum, item) => sum + (item.status === 'confirmed' ? Number(item.amount || 0) : 0),
      0
    );
    return { contributors, verifiedTotal, supporterCount: supporterEntries.length + liveEntries.length };
  }

  function getKmSource(km, status) {
    return status === 'claimed' ? claimedKmData[km] : reservedKmData.get(km);
  }

  function openTileDetailModal(km) {
    const status = getKmStatus(km);
    modalTitle.textContent = `KM ${km}`;

    if (status === 'available') {
      modalContent.innerHTML = `
        <div class="space-y-4">
          <p class="text-sm uppercase tracking-wide text-deepGreen/70">Status</p>
          <p class="text-lg font-semibold text-dark">Available to reserve</p>
          <p class="text-sm text-dark/75">This kilometre is currently open for sponsorship.</p>
          <button
            type="button"
            data-detail-action="sponsor"
            data-km="${km}"
            class="inline-flex w-full items-center justify-center rounded-full bg-deepGreen px-6 py-3 text-sm font-semibold text-cream transition hover:bg-[#0b3024] sm:text-base"
          >
            Sponsor this KM
          </button>
        </div>
      `;
      openModal();
      return;
    }

    const source = getKmSource(km, status);
    if (!source) {
      return;
    }

    const meta = getSponsorMeta({
      ...source,
      name: source.name || source.primarySponsor
    });
    const shareText = buildSponsorShareText(km, source);
    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
    const sponsorType = meta.sponsorType;
    const summary = getContributionSummary(source, meta, km);
    const amount = Number(summary.verifiedTotal);
    const amountText = renderAmountText(amount);
    const message = source.message ? escapeHtml(source.message) : '';
    const fromName = source.from_name ? escapeHtml(source.from_name) : '';
    const detailHeading = sponsorType === 'sadaqah_jariyah' ? 'Sadaqah Jariyah' : meta.heading;
    const detailName = escapeHtml(meta.nameLine);
    const tileClasses = `km-tile text-left ${status === 'claimed' ? 'km-claimed' : 'km-reserved'} ${sponsorType === 'sadaqah_jariyah' ? 'km-sadaqah' : ''}`;
    const badgeTone = sponsorType === 'sadaqah_jariyah'
      ? 'border-gold/60 bg-gold/15 text-[#7a5c12]'
      : 'border-deepGreen/20 bg-deepGreen/10 text-deepGreen';

    modalContent.innerHTML = `
      <div class="space-y-4">
        <div class="inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${badgeTone}">
          ${status === 'claimed' ? 'Donation Confirmed' : 'Donation Pending'}
        </div>

        <article class="${tileClasses}" style="height:auto; min-height:210px;">
          <div>
            <p class="text-sm font-semibold opacity-90">KM ${km}</p>
            <p class="mt-5 text-xs font-medium uppercase tracking-wider opacity-75">${escapeHtml(detailHeading)}</p>
            <p class="mt-1 text-lg font-semibold leading-snug">${sponsorType === 'sadaqah_jariyah' ? `for ${detailName}` : detailName}</p>
            ${message ? `<p class="mt-3 max-h-12 overflow-hidden text-sm italic leading-6 opacity-90">"${message}"</p>` : ''}
          </div>
          ${amountText ? `<p class="text-base font-semibold opacity-95">${amountText}</p>` : ''}
        </article>

        <div class="grid gap-3 sm:grid-cols-2">
          <div class="rounded-xl border border-deepGreen/12 bg-gray-50 px-4 py-3">
            <p class="text-[11px] font-semibold uppercase tracking-wide text-deepGreen/75">Cumulative Total</p>
            <p class="mt-1 text-sm font-semibold text-deepGreen">${amountText || 'Not verified yet'}</p>
          </div>
          <div class="rounded-xl border border-deepGreen/12 bg-gray-50 px-4 py-3">
            <p class="text-[11px] font-semibold uppercase tracking-wide text-deepGreen/75">Contributors</p>
            <p class="mt-1 text-sm font-semibold text-deepGreen">${summary.contributors.length}</p>
          </div>
        </div>

        <div class="rounded-xl border border-deepGreen/12 bg-white px-4 py-3">
          <p class="text-[11px] font-semibold uppercase tracking-wide text-deepGreen/75">Contributions</p>
          <ul class="mt-2 divide-y divide-gray-100">
            ${summary.contributors
              .map((entry) => `
                <li class="flex items-center justify-between gap-3 rounded-lg px-2 py-2 ${entry.status === 'pending' ? 'bg-gray-50 opacity-80' : ''}">
                  <div>
                    <p class="text-sm font-semibold text-dark">${escapeHtml(entry.name)}</p>
                    <div class="mt-0.5 flex items-center gap-2">
                      <p class="text-[11px] uppercase tracking-wide text-dark/55">${entry.role}</p>
                      ${entry.status === 'pending'
                        ? '<span class="rounded-full border border-gray-300 bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600">Pending</span>'
                        : ''}
                    </div>
                    ${entry.message ? `<p class="mt-1 text-xs italic text-dark/65">"${escapeHtml(entry.message)}"</p>` : ''}
                  </div>
                  <p class="text-sm font-semibold text-deepGreen">${renderAmountText(entry.amount) || (entry.status === 'pending' ? 'Pending' : 'Not set')}</p>
                </li>
              `)
              .join('')}
          </ul>
        </div>

        ${sponsorType === 'sadaqah_jariyah' ? `
          <div class="rounded-xl border border-gold/45 bg-[#fff9e8] px-4 py-3">
            <p class="text-[11px] font-semibold uppercase tracking-wide text-[#7a5c12]">From</p>
            <p class="mt-1 text-sm font-semibold text-dark">${fromName || 'Pending'}</p>
          </div>
        ` : ''}

        ${message ? `
          <div class="rounded-xl border border-deepGreen/12 bg-white px-4 py-3">
            <p class="text-[11px] font-semibold uppercase tracking-wide text-deepGreen/75">Message</p>
            <p class="mt-1 text-sm italic leading-6 text-dark/85">"${message}"</p>
          </div>
        ` : ''}

        <button
          type="button"
          data-detail-action="contribute"
          data-km="${km}"
          class="inline-flex w-full items-center justify-center rounded-full bg-deepGreen px-5 py-3 text-sm font-semibold text-cream transition hover:bg-[#0b3024]"
        >
          Contribute to this KM
        </button>

        <details class="rounded-xl border border-deepGreen/12 bg-gray-50 p-4">
          <summary class="cursor-pointer list-none text-sm font-semibold text-deepGreen">
            Share options
          </summary>
          <div class="mt-3 space-y-2">
            <button
              type="button"
              id="tileWhatsappShareBtn"
              class="inline-flex w-full items-center justify-center rounded-full bg-[#25D366] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95"
            >
              Share on WhatsApp
            </button>
            <button
              type="button"
              id="copyTileShareBtn"
              class="inline-flex w-full items-center justify-center rounded-full border border-deepGreen/25 bg-white px-4 py-2.5 text-sm font-semibold text-deepGreen transition hover:bg-cream"
            >
              Copy Share Text (Text)
            </button>
            <button
              type="button"
              id="downloadTileImageBtn"
              class="inline-flex w-full items-center justify-center rounded-full border border-deepGreen/20 bg-white px-4 py-2.5 text-sm font-semibold text-deepGreen transition hover:bg-cream"
            >
              Download Tile Image
            </button>
          </div>
          <p id="tileShareStatus" class="mt-2 hidden text-xs font-medium text-deepGreen"></p>
        </details>
      </div>
    `;

    const copyBtn = document.getElementById('copyTileShareBtn');
    const whatsappBtn = document.getElementById('tileWhatsappShareBtn');
    const downloadImageBtn = document.getElementById('downloadTileImageBtn');
    const shareStatus = document.getElementById('tileShareStatus');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        try {
          await copyToClipboard(shareText);
          if (shareStatus) {
            shareStatus.textContent = 'Share text copied.';
            shareStatus.classList.remove('hidden');
          }
        } catch {
          if (shareStatus) {
            shareStatus.textContent = 'Unable to copy automatically. Please copy manually.';
            shareStatus.classList.remove('hidden');
          }
        }
      });
    }
    if (downloadImageBtn) {
      downloadImageBtn.addEventListener('click', async () => {
        try {
          const blob = await createTileShareImageBlob(
            km,
            source,
            status === 'claimed' ? 'Donation Confirmed' : 'Donation Pending'
          );
          downloadBlob(blob, `km-${km}-42km-for-sudan.png`);
          if (shareStatus) {
            shareStatus.textContent = 'Tile image downloaded.';
            shareStatus.classList.remove('hidden');
          }
        } catch {
          if (shareStatus) {
            shareStatus.textContent = 'Unable to download tile image right now.';
            shareStatus.classList.remove('hidden');
          }
        }
      });
    }
    if (whatsappBtn) {
      whatsappBtn.addEventListener('click', () => {
        window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
      });
    }

    openModal();
  }

  function renderTileContent(tile, km) {
    const status = getKmStatus(km);
    tile.className = 'km-tile text-left';

    if (status === 'claimed') {
      const claimed = claimedKmData[km];
      const meta = getSponsorMeta({
        ...claimed,
        name: claimed.primarySponsor
      });
      const headingText = escapeHtml(meta.heading);
      const nameText = escapeHtml(meta.nameLine);
      const summary = getContributionSummary(claimed, meta, km);
      const amountRaised = Number(summary.verifiedTotal);
      const amountText = renderAmountText(amountRaised);
      tile.classList.add('km-claimed');
      if (meta.sponsorType === 'sadaqah_jariyah') {
        tile.classList.add('km-sadaqah');
      }
      tile.innerHTML = `
        <div>
        <p class="text-xs font-semibold opacity-90 sm:text-sm">KM ${km}</p>
        <p class="mt-3 text-[10px] font-medium uppercase tracking-wider opacity-75 sm:text-xs">${headingText}</p>
        <p class="mt-1 truncate text-sm font-semibold leading-snug sm:text-base" title="${nameText}">${nameText}</p>
      </div>
      ${amountText ? `<p class="truncate text-[11px] font-medium opacity-90 sm:text-xs">${amountText}</p>` : ''}
    `;
      return;
    }

    if (status === 'reserved') {
      const reserved = reservedKmData.get(km) || {};
      const meta = getSponsorMeta(reserved);
      const headingText = escapeHtml(meta.heading);
      const nameText = escapeHtml(meta.nameLine);
      const summary = getContributionSummary(reserved, meta, km);
      const reservedAmount = Number(summary.verifiedTotal);
      const amountText = renderAmountText(reservedAmount);
      tile.classList.add('km-reserved');
      if (meta.sponsorType === 'sadaqah_jariyah') {
        tile.classList.add('km-sadaqah');
      }
      tile.innerHTML = `
        <div>
          <p class="text-xs font-semibold sm:text-sm">KM ${km}</p>
          <p class="mt-3 text-[10px] font-medium uppercase tracking-wider sm:text-xs">${headingText}</p>
          <p class="mt-1 truncate text-xs font-semibold leading-snug sm:text-sm" title="${nameText}">${nameText}</p>
        </div>
        ${amountText ? `<p class="text-[11px] font-medium opacity-90 sm:text-xs">${amountText}</p>` : ''}
      `;
      return;
    }

    tile.classList.add('km-available');

    tile.innerHTML = `
      <div>
        <p class="text-xs font-semibold sm:text-sm">KM ${km}</p>
        <p class="mt-3 text-xs font-medium text-dark/75 sm:text-sm">Available</p>
      </div>
      <button
        type="button"
        class="km-action-btn km-action-btn-primary"
        data-action="sponsor"
        data-km="${km}"
      >
        Sponsor
      </button>
    `;
  }

  function createTile(km) {
    const tile = document.createElement('article');
    tile.dataset.km = String(km);
    renderTileContent(tile, km);
    return tile;
  }

  function updateTile(km) {
    const tile = kmTiles.get(km);
    if (!tile) {
      return;
    }

    renderTileContent(tile, km);
  }

  function renderGrid() {
    const fragment = document.createDocumentFragment();

    for (let km = 1; km <= totalKilometres; km += 1) {
      const tile = createTile(km);
      kmTiles.set(km, tile);
      fragment.appendChild(tile);
    }

    kmGrid.appendChild(fragment);
  }

  function openModal() {
    modal.classList.add('open');
    document.body.classList.add('overflow-hidden');
  }

  function closeModal() {
    modal.classList.remove('open');
    document.body.classList.remove('overflow-hidden');
    modalContent.innerHTML = '';
  }

  function showFormError(message) {
    const errorEl = document.getElementById('sponsorError');
    if (!errorEl) {
      return;
    }

    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
  }

  function formatApiError(payload, fallbackMessage) {
    const apiMessage = payload?.error;
    return apiMessage || fallbackMessage;
  }

  function buildSponsorShareText(km, sponsorData) {
    const sponsorType = normalizeSponsorType(sponsorData?.sponsor_type);
    const shareUrl = getKmShareUrl(km);

    if (sponsorType === 'sadaqah_jariyah') {
      const forName = sponsorData?.for_name || 'a loved one';
      return `I just sponsored KM ${km} as Sadaqah Jariyah for ${forName} in support of Sudan. Please join in and contribute to this kilometre: ${shareUrl}`;
    }

    if (sponsorType === 'group') {
      const groupName = sponsorData?.group_name || 'our group';
      return `${groupName} just sponsored KM ${km} to support families in Sudan. Please join us and contribute to this kilometre: ${shareUrl}`;
    }

    const name = sponsorData?.name || 'I';
    return `${name} just sponsored KM ${km} to support families in Sudan. Please join in and contribute to this kilometre: ${shareUrl}`;
  }

  async function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const temp = document.createElement('textarea');
    temp.value = text;
    temp.setAttribute('readonly', '');
    temp.style.position = 'absolute';
    temp.style.left = '-9999px';
    document.body.appendChild(temp);
    temp.select();
    document.execCommand('copy');
    document.body.removeChild(temp);
  }

  function drawRoundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function wrapTextLines(ctx, text, maxWidth, maxLines) {
    const words = String(text || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      return [];
    }

    const lines = [];
    let current = words[0];

    for (let i = 1; i < words.length; i += 1) {
      const next = `${current} ${words[i]}`;
      if (ctx.measureText(next).width <= maxWidth) {
        current = next;
      } else {
        lines.push(current);
        current = words[i];
      }
    }
    lines.push(current);

    if (lines.length <= maxLines) {
      return lines;
    }

    const trimmed = lines.slice(0, maxLines);
    let last = trimmed[maxLines - 1];
    while (last.length > 0 && ctx.measureText(`${last}…`).width > maxWidth) {
      last = last.slice(0, -1).trimEnd();
    }
    trimmed[maxLines - 1] = `${last}…`;
    return trimmed;
  }

  async function createTileShareImageBlob(km, sponsorData, statusLabel) {
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1350;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Unable to create image canvas');
    }

    const meta = getSponsorMeta(sponsorData || {});
    const sponsorType = normalizeSponsorType(sponsorData?.sponsor_type);
    const sponsorHeading = sponsorType === 'sadaqah_jariyah' ? 'Sadaqah Jariyah' : meta.heading;
    const sponsorName = meta.nameLine || 'Sponsor';
    const amount = Number(sponsorData?.verified_amount) > 0
      ? formatPounds(sponsorData.verified_amount)
      : Number(sponsorData?.primary_amount) > 0
        ? `Pledged ${formatPounds(sponsorData.primary_amount)}`
        : '';
    const sponsorMessage = String(sponsorData?.message || '').trim();

    ctx.fillStyle = '#F8F5EF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    grad.addColorStop(0, '#0F3D2E');
    grad.addColorStop(1, '#14553F');
    drawRoundedRect(ctx, 90, 120, 900, 1110, 44);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.fillStyle = '#D4AF37';
    ctx.font = '700 40px Inter, Arial, sans-serif';
    ctx.fillText('42km for Sudan', 150, 210);

    ctx.fillStyle = '#F8F5EF';
    ctx.font = '700 132px Inter, Arial, sans-serif';
    ctx.fillText(`KM ${km}`, 150, 370);

    ctx.font = '600 44px Inter, Arial, sans-serif';
    ctx.fillText(sponsorHeading, 150, 460);

    ctx.font = '700 62px Inter, Arial, sans-serif';
    const namePrefix = sponsorType === 'sadaqah_jariyah' ? 'for ' : '';
    ctx.fillText(`${namePrefix}${sponsorName}`, 150, 545);

    if (sponsorType === 'sadaqah_jariyah' && sponsorData?.from_name) {
      ctx.fillStyle = '#F2E9CC';
      ctx.font = '500 34px Inter, Arial, sans-serif';
      ctx.fillText(`From ${sponsorData.from_name}`, 150, 602);
      ctx.fillStyle = '#F8F5EF';
    }

    if (amount) {
      ctx.font = '600 46px Inter, Arial, sans-serif';
      ctx.fillText(amount, 150, 700);
    }

    drawRoundedRect(ctx, 150, 760, 420, 84, 999);
    ctx.fillStyle = '#D4AF37';
    ctx.fill();
    ctx.fillStyle = '#1F1F1F';
    ctx.font = '700 28px Inter, Arial, sans-serif';
    ctx.fillText(statusLabel, 188, 815);

    let ctaY = 920;
    let hostY = 1110;
    if (sponsorMessage) {
      ctx.fillStyle = '#F8F5EF';
      ctx.font = '500 34px Inter, Arial, sans-serif';
      const messageLines = wrapTextLines(ctx, `"${sponsorMessage}"`, 780, 2);
      messageLines.forEach((line, index) => {
        ctx.fillText(line, 150, 910 + (index * 42));
      });

      ctaY = 1045;
      hostY = 1185;
    }

    ctx.fillStyle = '#F8F5EF';
    ctx.font = '500 36px Inter, Arial, sans-serif';
    ctx.fillText('Join this kilometre and contribute today.', 150, ctaY);

    ctx.fillStyle = '#E9DFC4';
    ctx.font = '500 28px Inter, Arial, sans-serif';
    ctx.fillText(window.location.host || '42kmforsudan.com', 150, hostY);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) {
      throw new Error('Unable to export image');
    }
    return blob;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async function parseJsonResponse(response) {
    const raw = await response.text();
    if (!raw) {
      return {};
    }

    try {
      return JSON.parse(raw);
    } catch {
      return {
        error: response.ok ? '' : raw
      };
    }
  }

  function sanitizeHydratedContribution(entry) {
    return {
      name: entry?.name || 'Contributor',
      amount: Number(entry?.amount ?? 0),
      message: entry?.message || '',
      status: entry?.status === 'confirmed' ? 'confirmed' : 'pending'
    };
  }

  function clearHydratedState() {
    backendClaimedKms.forEach((km) => {
      delete claimedKmData[km];
    });
    backendClaimedKms.clear();
    reservedKmData.clear();
    liveContributionsByKm.clear();
  }

  function applyHydratedState(payload) {
    clearHydratedState();

    const sponsors = payload?.sponsors && typeof payload.sponsors === 'object'
      ? payload.sponsors
      : {};
    const contributorsByKm = payload?.contributorsByKm && typeof payload.contributorsByKm === 'object'
      ? payload.contributorsByKm
      : {};

    Object.entries(sponsors).forEach(([kmKey, rawRecord]) => {
      const km = Number(kmKey);
      if (!Number.isInteger(km) || km < 1 || km > totalKilometres || !rawRecord || typeof rawRecord !== 'object') {
        return;
      }

      const supporters = Array.isArray(contributorsByKm[kmKey]) ? contributorsByKm[kmKey] : [];
      const normalizedSupporters = supporters.map(sanitizeHydratedContribution);
      const primaryAmount = Number(rawRecord.primary_amount ?? 85);
      const verifiedAmount = Number(rawRecord.verified_amount ?? 0);
      const mergedRecord = {
        ...rawRecord,
        primarySponsor: rawRecord.name || rawRecord.primarySponsor || '',
        primary_amount: primaryAmount,
        verified_amount: verifiedAmount,
        supporters: normalizedSupporters
      };

      if (rawRecord.status === 'confirmed') {
        claimedKmData[km] = mergedRecord;
        backendClaimedKms.add(km);
      } else {
        reservedKmData.set(km, mergedRecord);
      }
    });

    for (let km = 1; km <= totalKilometres; km += 1) {
      updateTile(km);
    }
    renderProgress();
  }

  async function hydrateFromApi() {
    try {
      const response = await fetch('/api/sponsor', {
        method: 'GET',
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) {
        return;
      }

      const payload = await parseJsonResponse(response);
      applyHydratedState(payload);
    } catch {
      // Keep demo state if live hydration fails.
    }
  }

  function setSubmitLoading(isLoading) {
    const submitBtn = document.getElementById('reserveSubmit');
    const spinner = document.getElementById('reserveSpinner');

    if (!submitBtn || !spinner) {
      return;
    }

    submitBtn.disabled = isLoading;
    spinner.classList.toggle('hidden', !isLoading);
    submitBtn.querySelector('.reserve-label').textContent = isLoading ? 'Reserving...' : 'Reserve KM';
  }

  function renderConfirmation(km, verificationCode, pledgeAmount) {
    const formattedCode = verificationCode.toUpperCase();
    const normalizedPledgeAmount = Number(pledgeAmount);
    const hasPledgeAmount = Number.isFinite(normalizedPledgeAmount) && normalizedPledgeAmount >= 85;

    const renderDonationStep = () => {
      modalTitle.textContent = `KM ${km} Donation`;
      modalContent.innerHTML = `
        <div class="space-y-4">
          <p class="text-xs font-semibold uppercase tracking-wide text-deepGreen/70">Step 3 of 3</p>
          <p class="text-dark/80 leading-7">
            Donate on JustGiving and make sure you <strong>include this code in your donation message</strong>:
          </p>
          <div class="rounded-xl border border-deepGreen/20 bg-cream px-4 py-4">
            <p class="text-xs font-semibold uppercase tracking-wide text-deepGreen/80">Donation Code</p>
            <p class="mt-2 font-mono text-2xl font-semibold tracking-widest text-deepGreen">${formattedCode}</p>
          </div>
          ${hasPledgeAmount ? `
          <p class="text-sm leading-6 text-dark/75">
            <strong>Pledge amount:</strong> ${formatPounds(normalizedPledgeAmount)}
          </p>
          ` : ''}
          <p class="text-sm leading-6 text-dark/70">
            Reminder: set JustGiving tip to £0.
          </p>
          <button
            type="button"
            id="openJustGivingNowBtn"
            class="inline-flex w-full items-center justify-center rounded-full bg-deepGreen px-6 py-3 text-base font-semibold text-cream transition hover:bg-[#0b3024]"
          >
            Open JustGiving
          </button>
          <button
            type="button"
            id="donationDoneBtn"
            class="inline-flex w-full items-center justify-center rounded-full border border-deepGreen/25 bg-white px-6 py-3 text-sm font-semibold text-deepGreen transition hover:bg-cream sm:text-base"
          >
            I've Donated
          </button>
          <p class="text-xs text-dark/60">
            Step 3: tap "I've Donated" and we will verify your donation shortly.
          </p>
        </div>
      `;

      const openBtn = document.getElementById('openJustGivingNowBtn');
      const doneBtn = document.getElementById('donationDoneBtn');

      if (openBtn) {
        openBtn.addEventListener('click', () => {
          window.open(justGivingUrl, '_blank', 'noopener,noreferrer');
        });
      }

      if (doneBtn) {
        doneBtn.addEventListener('click', () => {
          closeModal();
        });
      }
    };

    modalTitle.textContent = `KM ${km} Reserved`;
    modalContent.innerHTML = `
      <div class="space-y-4">
        <p class="text-xs font-semibold uppercase tracking-wide text-deepGreen/70">Step 2 of 3</p>
        <p class="text-dark/90 font-medium">Thank you for sponsoring KM ${km}.</p>
        <p class="text-dark/80 leading-7">
          Please <strong>copy</strong> this code.
        </p>
        <div class="rounded-xl border border-deepGreen/20 bg-cream px-4 py-4 text-center">
          <p class="text-xs font-semibold uppercase tracking-wide text-deepGreen/80">Donation Code</p>
          <p class="mt-2 font-mono text-3xl font-semibold tracking-widest text-deepGreen">${formattedCode}</p>
        </div>
        <p id="donationCodeStatus" class="hidden text-xs font-medium text-deepGreen"></p>
        <button
          type="button"
          id="copyDonationCodeBtn"
          class="inline-flex w-full items-center justify-center rounded-full border border-deepGreen/25 bg-white px-6 py-3 text-sm font-semibold text-deepGreen transition hover:bg-cream sm:text-base"
        >
          Copy Code
        </button>
        <button
          type="button"
          id="continueToDonateBtn"
          class="inline-flex w-full items-center justify-center rounded-full bg-deepGreen px-6 py-3 text-base font-semibold text-cream transition hover:bg-[#0b3024]"
        >
          Next
        </button>
      </div>
    `;

    const copyCodeBtn = document.getElementById('copyDonationCodeBtn');
    const continueBtn = document.getElementById('continueToDonateBtn');
    const codeStatus = document.getElementById('donationCodeStatus');

    if (copyCodeBtn) {
      copyCodeBtn.addEventListener('click', async () => {
        try {
          await copyToClipboard(formattedCode);
          if (codeStatus) {
            codeStatus.textContent = 'Donation code copied.';
            codeStatus.classList.remove('hidden');
          }
        } catch {
          if (codeStatus) {
            codeStatus.textContent = 'Unable to copy automatically. Please copy manually.';
            codeStatus.classList.remove('hidden');
          }
        }
      });
    }

    if (continueBtn) {
      continueBtn.addEventListener('click', async () => {
        try {
          await copyToClipboard(formattedCode);
        } catch {
          // Continue even if clipboard permission is blocked.
        }
        renderDonationStep();
      });
    }
  }

  function setContributeLoading(isLoading) {
    const submitBtn = document.getElementById('contributeSubmit');
    const spinner = document.getElementById('contributeSpinner');
    if (!submitBtn || !spinner) {
      return;
    }

    submitBtn.disabled = isLoading;
    spinner.classList.toggle('hidden', !isLoading);
    submitBtn.querySelector('.contribute-label').textContent = isLoading ? 'Submitting...' : 'Submit Contribution';
  }

  function renderContributeConfirmation(km, contributionCode) {
    modalTitle.textContent = `Contribution Added • KM ${km}`;
    modalContent.innerHTML = `
      <p class="text-dark/80 leading-7">
        Thank you. Complete your contribution on JustGiving. <strong>Copy</strong> and include your contribution code in the donation message.
      </p>
      <div class="mt-5 rounded-xl border border-deepGreen/20 bg-cream px-4 py-4">
        <p class="text-xs font-semibold uppercase tracking-wide text-deepGreen/80">Contribution Code</p>
        <p class="mt-2 font-mono text-xl font-semibold tracking-widest text-deepGreen">${escapeHtml(contributionCode)}</p>
      </div>
      <a
        href="${justGivingUrl}"
        target="_blank"
        rel="noopener noreferrer"
        class="mt-6 inline-flex w-full items-center justify-center rounded-full bg-deepGreen px-6 py-3 text-base font-semibold text-cream transition hover:bg-[#0b3024]"
      >
        Donate on JustGiving
      </a>
      <p class="mt-4 text-sm leading-6 text-dark/70">
        Include your contribution code in your donation note for matching.
      </p>
    `;
  }

  function openContributeModal(km) {
    modalTitle.textContent = `Contribute • KM ${km}`;
    modalContent.innerHTML = `
      <div class="space-y-4">
        <form id="contributeForm" class="space-y-3" novalidate>
          <div>
            <label for="contribName" class="text-sm font-semibold text-deepGreen/80">Name</label>
            <input id="contribName" name="name" type="text" required maxlength="40" class="mt-1.5 w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-dark outline-none transition focus:border-deepGreen focus:ring-2 focus:ring-deepGreen/10" placeholder="Your name" />
          </div>
          <div>
            <label for="contribEmail" class="text-sm font-semibold text-deepGreen/80">Email</label>
            <input id="contribEmail" name="email" type="email" required maxlength="120" class="mt-1.5 w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-dark outline-none transition focus:border-deepGreen focus:ring-2 focus:ring-deepGreen/10" placeholder="you@example.com" />
          </div>
          <div>
            <label for="contribAmount" class="text-sm font-semibold text-deepGreen/80">Amount (£)</label>
            <input id="contribAmount" name="amount" type="number" required min="1" step="1" class="mt-1.5 w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-dark outline-none transition focus:border-deepGreen focus:ring-2 focus:ring-deepGreen/10" placeholder="35" />
          </div>
          <div>
            <label for="contribMessage" class="text-sm font-semibold text-deepGreen/80">Message (optional)</label>
            <textarea id="contribMessage" name="message" rows="2" maxlength="240" class="mt-1.5 w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-dark outline-none transition focus:border-deepGreen focus:ring-2 focus:ring-deepGreen/10" placeholder="Short note"></textarea>
          </div>
          <p id="contribError" class="hidden rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"></p>
          <button id="contributeSubmit" type="submit" class="inline-flex w-full items-center justify-center rounded-full bg-deepGreen px-6 py-3 text-sm font-semibold text-cream transition hover:bg-[#0b3024] disabled:cursor-not-allowed disabled:opacity-80 sm:text-base">
            <span id="contributeSpinner" class="spinner hidden" aria-hidden="true"></span>
            <span class="contribute-label">Submit Contribution</span>
          </button>
        </form>
      </div>
    `;

    const form = document.getElementById('contributeForm');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const name = form.elements.name.value.trim();
      const email = form.elements.email.value.trim();
      const amount = Number(form.elements.amount.value);
      const message = form.elements.message.value.trim();
      const errorEl = document.getElementById('contribError');
      const showError = (msg) => {
        if (!errorEl) {
          return;
        }
        errorEl.textContent = msg;
        errorEl.classList.remove('hidden');
      };

      if (!name || !email || !Number.isFinite(amount) || amount < 1) {
        showError('Please enter name, email, and a valid amount.');
        return;
      }

      if (!window.confirm(`Are you sure you want to contribute ${formatPounds(amount)} to KM ${km}?`)) {
        return;
      }

      setContributeLoading(true);
      try {
        const response = await fetch('/api/contribute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            km,
            name,
            email,
            message,
            amount
          })
        });
        const payload = await parseJsonResponse(response);
        if (!response.ok || !payload.success) {
          showError(payload.error || 'Unable to submit contribution right now.');
          return;
        }

        const existing = liveContributionsByKm.get(km) || [];
        const contribution = payload.contribution || { name, amount, message, status: 'pending' };
        existing.push({
          name: contribution.name || name,
          amount: Number(contribution.amount ?? amount),
          message: contribution.message || message,
          status: contribution.status || 'pending'
        });
        liveContributionsByKm.set(km, existing);
        updateTile(km);
        renderContributeConfirmation(km, payload.contributionCode);
      } catch (error) {
        showError('Network error. Please try again.');
      } finally {
        setContributeLoading(false);
      }
    });

    openModal();
  }

  async function submitReservation(event, km) {
    event.preventDefault();

    const form = event.currentTarget;
    const sponsorType = normalizeSponsorType(form.elements.sponsor_type.value);
    const name = form.elements.name ? form.elements.name.value.trim() : '';
    const groupName = form.elements.group_name ? form.elements.group_name.value.trim() : '';
    const forName = form.elements.for_name ? form.elements.for_name.value.trim() : '';
    const fromName = form.elements.from_name ? form.elements.from_name.value.trim() : '';
    const email = form.elements.email.value.trim();
    const amount = Number(form.elements.amount.value);
    const message = form.elements.message.value.trim();

    if (sponsorType === 'individual' && !name) {
      showFormError('Please enter your name.');
      return;
    }

    if (sponsorType === 'group' && !groupName) {
      showFormError('Please enter the group name.');
      return;
    }

    if (sponsorType === 'sadaqah_jariyah' && (!forName || !fromName)) {
      showFormError('Please enter both "For" and "From" names.');
      return;
    }

    if (!email) {
      showFormError('Please enter your email.');
      return;
    }

    if (!Number.isFinite(amount) || amount < 85) {
      showFormError('Please enter a sponsorship amount of at least £85.');
      return;
    }

    if (!window.confirm(`Are you sure you want to sponsor KM ${km} for ${formatPounds(amount)}?`)) {
      return;
    }

    setSubmitLoading(true);

    try {
      const response = await fetch('/api/sponsor', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          km,
          sponsor_type: sponsorType,
          name,
          group_name: groupName,
          for_name: forName,
          from_name: fromName,
          email,
          amount,
          message
        })
      });

      const payload = await parseJsonResponse(response);

      if (response.ok && payload.success) {
        reservedKmData.set(km, {
          sponsor_type: sponsorType,
          name,
          group_name: groupName,
          for_name: forName,
          from_name: fromName,
          email,
          message,
          primary_amount: amount,
          verified_amount: 0,
          status: 'pending',
          verificationCode: payload.verificationCode
        });

        updateTile(km);
        renderProgress();
        renderConfirmation(km, payload.verificationCode, amount);
        return;
      }

      if (response.status === 409) {
        showFormError(formatApiError(payload, 'Sorry, this kilometer has already been reserved.'));
        return;
      }

      showFormError(formatApiError(payload, 'Unable to reserve this kilometer right now. Please try again.'));
    } catch (error) {
      showFormError(`Network error: ${error?.message || 'Unable to connect. Please try again in a moment.'}`);
    } finally {
      setSubmitLoading(false);
    }
  }

  function renderSponsorPreview(km, sponsorData) {
    const previewName = document.getElementById('previewName');
    const previewHeading = document.getElementById('previewHeading');
    const previewKm = document.getElementById('previewKm');
    const previewAmount = document.getElementById('previewAmount');
    const previewTile = document.getElementById('previewTile');

    if (!previewName || !previewHeading || !previewKm || !previewAmount || !previewTile) {
      return;
    }

    const meta = getSponsorMeta(sponsorData);
    const amount = normalizeSponsorAmount(sponsorData?.primary_amount);
    previewKm.textContent = `KM ${km}`;
    previewAmount.textContent = amount === null ? 'Minimum £85' : formatPounds(amount);
    previewHeading.textContent = meta.heading;
    previewName.textContent = meta.nameLine;

    previewTile.classList.toggle('km-sadaqah', meta.sponsorType === 'sadaqah_jariyah');
  }

  function openSponsorModal(km) {
    modalTitle.textContent = `Sponsor KM ${km}`;
    modalContent.innerHTML = `
      <form id="sponsorForm" class="space-y-4" novalidate>
        <fieldset>
          <legend class="text-sm font-semibold text-deepGreen/80">Sponsorship type</legend>
          <div class="mt-2 grid gap-2 text-sm text-dark/90">
            <label class="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2">
              <input type="radio" name="sponsor_type" value="individual" checked class="h-4 w-4 text-deepGreen focus:ring-deepGreen/30" />
              <span>Individual</span>
            </label>
            <label class="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2">
              <input type="radio" name="sponsor_type" value="group" class="h-4 w-4 text-deepGreen focus:ring-deepGreen/30" />
              <span>Group</span>
            </label>
            <label class="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2">
              <input type="radio" name="sponsor_type" value="sadaqah_jariyah" class="h-4 w-4 text-deepGreen focus:ring-deepGreen/30" />
              <span>Sadaqah Jariyah</span>
            </label>
          </div>
        </fieldset>
        <div id="individualFields">
        <div>
          <label for="sponsorName" class="text-sm font-semibold text-deepGreen/80">Name</label>
          <input
            id="sponsorName"
            name="name"
            type="text"
            required
            maxlength="40"
            class="mt-1.5 w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-dark outline-none transition focus:border-deepGreen focus:ring-2 focus:ring-deepGreen/10"
            placeholder="Your name"
          />
        </div>
        </div>
        <div id="groupFields" class="hidden">
          <label for="sponsorGroupName" class="text-sm font-semibold text-deepGreen/80">Group name</label>
          <input
            id="sponsorGroupName"
            name="group_name"
            type="text"
            maxlength="40"
            class="mt-1.5 w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-dark outline-none transition focus:border-deepGreen focus:ring-2 focus:ring-deepGreen/10"
            placeholder="Group name"
          />
        </div>
        <div id="sadaqahFields" class="hidden space-y-3">
          <div>
            <label for="sponsorForName" class="text-sm font-semibold text-deepGreen/80">For</label>
            <input
              id="sponsorForName"
              name="for_name"
              type="text"
              maxlength="40"
              class="mt-1.5 w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-dark outline-none transition focus:border-deepGreen focus:ring-2 focus:ring-deepGreen/10"
              placeholder="Who this is for"
            />
          </div>
          <div>
            <label for="sponsorFromName" class="text-sm font-semibold text-deepGreen/80">From</label>
            <input
              id="sponsorFromName"
              name="from_name"
              type="text"
              maxlength="40"
              class="mt-1.5 w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-dark outline-none transition focus:border-deepGreen focus:ring-2 focus:ring-deepGreen/10"
              placeholder="Who this is from"
            />
          </div>
        </div>
        <div>
          <label for="sponsorEmail" class="text-sm font-semibold text-deepGreen/80">Email</label>
          <input
            id="sponsorEmail"
            name="email"
            type="email"
            required
            maxlength="120"
            class="mt-1.5 w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-dark outline-none transition focus:border-deepGreen focus:ring-2 focus:ring-deepGreen/10"
            placeholder="you@example.com"
          />
        </div>
        <div>
          <label for="sponsorAmount" class="text-sm font-semibold text-deepGreen/80">Sponsorship amount (£)</label>
          <p class="mt-1 text-xs text-dark/65">Minimum 85</p>
          <input
            id="sponsorAmount"
            name="amount"
            type="number"
            required
            min="85"
            step="1"
            class="mt-1.5 w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-dark outline-none transition focus:border-deepGreen focus:ring-2 focus:ring-deepGreen/10"
            placeholder="Enter amount (minimum 85)"
          />
        </div>
        <div>
          <label for="sponsorMessage" class="text-sm font-semibold text-deepGreen/80">Message (optional)</label>
          <textarea
            id="sponsorMessage"
            name="message"
            rows="3"
            maxlength="240"
            class="mt-1.5 w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-dark outline-none transition focus:border-deepGreen focus:ring-2 focus:ring-deepGreen/10"
            placeholder="Add a short dedication or note"
          ></textarea>
          <p class="mt-2 text-xs italic text-dark/60">(presets)</p>
          <div class="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              data-message-preset="good_luck"
              class="rounded-full border border-deepGreen/20 bg-white px-3 py-1.5 text-xs font-semibold text-deepGreen transition hover:bg-cream"
            >
              Good luck
            </button>
            <button
              type="button"
              data-message-preset="support"
              class="rounded-full border border-deepGreen/20 bg-white px-3 py-1.5 text-xs font-semibold text-deepGreen transition hover:bg-cream"
            >
              Proud to support
            </button>
            <button
              type="button"
              data-message-preset="inspiring"
              class="rounded-full border border-deepGreen/20 bg-white px-3 py-1.5 text-xs font-semibold text-deepGreen transition hover:bg-cream"
            >
              Inspiring effort
            </button>
          </div>
        </div>
        <div class="rounded-xl border border-deepGreen/10 bg-gray-50 p-3">
          <p class="text-xs font-semibold uppercase tracking-wide text-deepGreen/70">Live Tile Preview</p>
          <div class="mt-2">
            <article id="previewTile" class="km-tile km-claimed text-left">
              <div>
                <p id="previewKm" class="text-sm font-semibold opacity-90">KM ${km}</p>
                <p id="previewHeading" class="mt-3 text-xs font-medium uppercase tracking-wider opacity-75">Primary Sponsor</p>
                <p id="previewName" class="mt-1 truncate text-base font-semibold leading-snug">Your name</p>
              </div>
              <p id="previewAmount" class="text-xs font-medium opacity-90">£85</p>
            </article>
          </div>
        </div>
        <p id="sponsorError" class="hidden rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"></p>
        <button
          id="reserveSubmit"
          type="submit"
          class="inline-flex w-full items-center justify-center rounded-full bg-deepGreen px-6 py-3 text-sm font-semibold text-cream transition hover:bg-[#0b3024] disabled:cursor-not-allowed disabled:opacity-80 sm:text-base"
        >
          <span id="reserveSpinner" class="spinner hidden" aria-hidden="true"></span>
          <span class="reserve-label">Reserve KM</span>
        </button>
      </form>
    `;

    const form = document.getElementById('sponsorForm');
    const nameInput = document.getElementById('sponsorName');
    const groupInput = document.getElementById('sponsorGroupName');
    const forInput = document.getElementById('sponsorForName');
    const fromInput = document.getElementById('sponsorFromName');
    const amountInput = document.getElementById('sponsorAmount');
    const messageInput = document.getElementById('sponsorMessage');
    const sponsorTypeInputs = form.querySelectorAll('input[name="sponsor_type"]');
    const individualFields = document.getElementById('individualFields');
    const groupFields = document.getElementById('groupFields');
    const sadaqahFields = document.getElementById('sadaqahFields');

    const previewTile = modalContent.querySelector('.km-tile');
    if (previewTile) {
      previewTile.style.width = '170px';
      previewTile.style.margin = '0 auto';
    }

    const readSponsorData = () => {
      const sponsorTypeInput = form.querySelector('input[name="sponsor_type"]:checked');
      const sponsorType = normalizeSponsorType(sponsorTypeInput ? sponsorTypeInput.value : 'individual');
      return {
        sponsor_type: sponsorType,
        name: nameInput ? nameInput.value.trim() : '',
        group_name: groupInput ? groupInput.value.trim() : '',
        for_name: forInput ? forInput.value.trim() : '',
        from_name: fromInput ? fromInput.value.trim() : '',
        primary_amount: amountInput ? normalizeSponsorAmount(amountInput.value) : null
      };
    };

    const updateSponsorTypeFields = () => {
      const sponsorData = readSponsorData();
      const sponsorType = sponsorData.sponsor_type;

      individualFields.classList.toggle('hidden', sponsorType !== 'individual');
      groupFields.classList.toggle('hidden', sponsorType !== 'group');
      sadaqahFields.classList.toggle('hidden', sponsorType !== 'sadaqah_jariyah');
      renderSponsorPreview(km, sponsorData);
    };

    const syncPreview = () => renderSponsorPreview(km, readSponsorData());
    const getPresetSenderName = () => {
      const sponsorTypeInput = form.querySelector('input[name="sponsor_type"]:checked');
      const sponsorType = normalizeSponsorType(sponsorTypeInput ? sponsorTypeInput.value : 'individual');

      if (sponsorType === 'group') {
        return (groupInput && groupInput.value.trim()) || 'a supporter group';
      }

      if (sponsorType === 'sadaqah_jariyah') {
        return (fromInput && fromInput.value.trim()) || 'a supporter';
      }

      return (nameInput && nameInput.value.trim()) || 'a supporter';
    };

    const buildPresetMessage = (preset) => {
      if (preset === 'good_luck') {
        return `Good luck from ${getPresetSenderName()}`;
      }
      if (preset === 'support') {
        return 'Proud to sponsor a KM for Sudan';
      }
      if (preset === 'inspiring') {
        return 'Inspiring effort for a great cause.';
      }
      return '';
    };
    nameInput.addEventListener('input', syncPreview);
    if (groupInput) {
      groupInput.addEventListener('input', syncPreview);
    }
    if (forInput) {
      forInput.addEventListener('input', syncPreview);
    }
    if (fromInput) {
      fromInput.addEventListener('input', syncPreview);
    }
    if (amountInput) {
      amountInput.addEventListener('input', syncPreview);
    }
    sponsorTypeInputs.forEach((input) => {
      input.addEventListener('change', updateSponsorTypeFields);
    });
    form.querySelectorAll('[data-message-preset]').forEach((button) => {
      button.addEventListener('click', () => {
        if (!messageInput) {
          return;
        }
        const presetKey = button.dataset.messagePreset;
        const presetMessage = buildPresetMessage(presetKey);
        if (!presetMessage) {
          return;
        }
        messageInput.value = presetMessage;
      });
    });
    updateSponsorTypeFields();
    syncPreview();

    form.addEventListener('submit', (event) => submitReservation(event, km));

    openModal();
  }

  modalContent.addEventListener('click', (event) => {
    const sponsorCta = event.target.closest('[data-detail-action="sponsor"]');
    if (sponsorCta) {
      const km = Number(sponsorCta.dataset.km);
      if (!Number.isInteger(km)) {
        return;
      }
      openSponsorModal(km);
      return;
    }

    const contributeCta = event.target.closest('[data-detail-action="contribute"]');
    if (!contributeCta) {
      return;
    }
    const km = Number(contributeCta.dataset.km);
    if (!Number.isInteger(km)) {
      return;
    }
    openContributeModal(km);
  });

  kmGrid.addEventListener('click', (event) => {
    const sponsorBtn = event.target.closest('[data-action="sponsor"]');

    if (sponsorBtn) {
      const km = Number(sponsorBtn.dataset.km);
      if (!Number.isInteger(km)) {
        return;
      }
      openSponsorModal(km);
      return;
    }

    const tile = event.target.closest('article[data-km]');
    if (!tile) {
      return;
    }

    const km = Number(tile.dataset.km);
    if (!Number.isInteger(km)) {
      return;
    }

    openTileDetailModal(km);
  });

  modalBackdrop.addEventListener('click', closeModal);
  closeModalBtn.addEventListener('click', closeModal);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal.classList.contains('open')) {
      closeModal();
    }
  });

  function handleInitialKmFromQuery() {
    if (initialKmHandled) {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const kmParam = Number(params.get('km'));
    if (!Number.isInteger(kmParam) || kmParam < 1 || kmParam > totalKilometres) {
      initialKmHandled = true;
      return;
    }

    initialKmHandled = true;
    const section = document.getElementById('kilometres');
    if (section) {
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    setTimeout(() => {
      openTileDetailModal(kmParam);
    }, 250);
  }

  renderGrid();
  renderProgress();
  hydrateFromApi().finally(handleInitialKmFromQuery);
})();
