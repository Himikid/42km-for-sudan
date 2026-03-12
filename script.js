(() => {
  const totalKilometres = 42;

  const claimedKmData = {
    3: {
      primarySponsor: 'Ibrahim',
      supporters: ['Aisha', 'Bilal', 'Mariam']
    },
    7: {
      primarySponsor: 'Ahmed',
      supporters: ['Hafsa', 'Umar', 'Sara', 'Zain']
    },
    12: {
      primarySponsor: 'Fatima',
      supporters: ['Ali', 'Yusuf', 'Khadijah']
    },
    17: {
      primarySponsor: 'Sadaqah Jariyah (Parents)',
      supporters: ['Nadia', 'Hamza']
    },
    24: {
      primarySponsor: 'Yusuf',
      supporters: ['Layla', 'Noor', 'Idris', 'Samir']
    },
    31: {
      primarySponsor: 'Ali',
      supporters: ['Zara', 'Maryam', 'Sulaiman']
    }
  };

  const reservedKmData = new Map();
  const kmTiles = new Map();

  const kmGrid = document.getElementById('kmGrid');
  const progressText = document.getElementById('progressText');
  const progressBar = document.getElementById('progressBar');

  const modal = document.getElementById('modal');
  const modalBackdrop = document.getElementById('modalBackdrop');
  const closeModalBtn = document.getElementById('closeModal');
  const modalTitle = document.getElementById('modalTitle');
  const modalContent = document.getElementById('modalContent');

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

  function renderTileContent(tile, km) {
    const status = getKmStatus(km);

    tile.className = 'km-tile text-left';
    tile.classList.add(
      status === 'claimed' ? 'km-claimed' : status === 'reserved' ? 'km-reserved' : 'km-available'
    );

    if (status === 'claimed') {
      const claimed = claimedKmData[km];
      tile.innerHTML = `
        <div>
          <p class="text-sm font-semibold opacity-90">KM ${km}</p>
          <p class="mt-3 text-xs font-medium uppercase tracking-wider opacity-75">Primary Sponsor</p>
          <p class="mt-1 text-base font-semibold leading-snug">${claimed.primarySponsor}</p>
        </div>
        <p class="text-xs font-medium opacity-90">+${claimed.supporters.length} supporters</p>
      `;
      return;
    }

    if (status === 'reserved') {
      tile.innerHTML = `
        <div>
          <p class="text-sm font-semibold">KM ${km}</p>
          <p class="mt-3 text-sm font-medium">Reserved</p>
        </div>
        <button type="button" class="km-action-btn km-action-btn-secondary" disabled>
          Reserved
        </button>
      `;
      return;
    }

    tile.innerHTML = `
      <div>
        <p class="text-sm font-semibold">KM ${km}</p>
        <p class="mt-3 text-sm font-medium text-dark/75">Available</p>
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

  function renderConfirmation(km, verificationCode) {
    modalTitle.textContent = `KM ${km} Reserved!`;
    modalContent.innerHTML = `
      <p class="text-dark/80 leading-7">
        Please complete your sponsorship by donating on JustGiving and including your verification code.
      </p>
      <div class="mt-5 rounded-xl border border-deepGreen/20 bg-cream px-4 py-4">
        <p class="text-xs font-semibold uppercase tracking-wide text-deepGreen/80">Verification Code</p>
        <p class="mt-2 font-mono text-2xl font-semibold tracking-widest text-deepGreen">${verificationCode.toUpperCase()}</p>
      </div>
      <a
        href="https://www.justgiving.com/"
        target="_blank"
        rel="noopener noreferrer"
        class="mt-6 inline-flex w-full items-center justify-center rounded-full bg-deepGreen px-6 py-3 text-base font-semibold text-cream transition hover:bg-[#0b3024]"
      >
        Donate on JustGiving
      </a>
      <p class="mt-4 text-sm leading-6 text-dark/70">
        When donating, please include your verification code in the donation message so we can confirm your sponsorship.
      </p>
    `;
  }

  async function submitReservation(event, km) {
    event.preventDefault();

    const form = event.currentTarget;
    const name = form.elements.name.value.trim();
    const message = form.elements.message.value.trim();

    if (!name) {
      showFormError('Please enter your name.');
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
          name,
          message
        })
      });

      const payload = await response.json().catch(() => ({}));

      if (response.ok && payload.success) {
        reservedKmData.set(km, {
          name,
          message,
          verificationCode: payload.verificationCode
        });

        updateTile(km);
        renderProgress();
        renderConfirmation(km, payload.verificationCode);
        return;
      }

      if (response.status === 409) {
        showFormError('Sorry, this kilometer has already been reserved.');
        return;
      }

      showFormError(payload.error || 'Unable to reserve this kilometer right now. Please try again.');
    } catch (error) {
      showFormError('Unable to connect. Please try again in a moment.');
    } finally {
      setSubmitLoading(false);
    }
  }

  function openSponsorModal(km) {
    modalTitle.textContent = `Sponsor KM ${km}`;
    modalContent.innerHTML = `
      <form id="sponsorForm" class="space-y-4" novalidate>
        <div>
          <label for="sponsorName" class="text-sm font-semibold text-deepGreen/80">Name</label>
          <input
            id="sponsorName"
            name="name"
            type="text"
            required
            class="mt-1.5 w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-dark outline-none transition focus:border-deepGreen focus:ring-2 focus:ring-deepGreen/10"
            placeholder="Your name"
          />
        </div>
        <div>
          <label for="sponsorMessage" class="text-sm font-semibold text-deepGreen/80">Message (optional)</label>
          <textarea
            id="sponsorMessage"
            name="message"
            rows="3"
            class="mt-1.5 w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm text-dark outline-none transition focus:border-deepGreen focus:ring-2 focus:ring-deepGreen/10"
            placeholder="Add a short dedication or note"
          ></textarea>
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
    form.addEventListener('submit', (event) => submitReservation(event, km));

    openModal();
  }

  kmGrid.addEventListener('click', (event) => {
    const sponsorBtn = event.target.closest('[data-action="sponsor"]');

    if (!sponsorBtn) {
      return;
    }

    const km = Number(sponsorBtn.dataset.km);
    if (!Number.isInteger(km)) {
      return;
    }

    openSponsorModal(km);
  });

  modalBackdrop.addEventListener('click', closeModal);
  closeModalBtn.addEventListener('click', closeModal);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal.classList.contains('open')) {
      closeModal();
    }
  });

  renderGrid();
  renderProgress();
})();
