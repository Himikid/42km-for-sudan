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

const kmGrid = document.getElementById('kmGrid');
const progressText = document.getElementById('progressText');
const progressBar = document.getElementById('progressBar');
const modal = document.getElementById('modal');
const modalBackdrop = document.getElementById('modalBackdrop');
const closeModalBtn = document.getElementById('closeModal');
const modalTitle = document.getElementById('modalTitle');
const modalPrimary = document.getElementById('modalPrimary');
const modalSupporters = document.getElementById('modalSupporters');

function claimedCount() {
  return Object.keys(claimedKmData).length;
}

function progressPercentage() {
  return (claimedCount() / totalKilometres) * 100;
}

function createTile(km) {
  const claimed = claimedKmData[km];
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = `km-tile text-left ${claimed ? 'km-claimed' : 'km-available'}`;

  if (claimed) {
    tile.innerHTML = `
      <div>
        <p class="text-sm font-semibold opacity-90">KM ${km}</p>
        <p class="mt-3 text-xs font-medium uppercase tracking-wider opacity-75">Primary Sponsor</p>
        <p class="mt-1 text-base font-semibold leading-snug">${claimed.primarySponsor}</p>
      </div>
      <p class="text-xs font-medium opacity-90">+${claimed.supporters.length} supporters</p>
    `;
  } else {
    tile.innerHTML = `
      <div>
        <p class="text-sm font-semibold">KM ${km}</p>
        <p class="mt-3 text-sm font-medium text-dark/75">Available</p>
      </div>
      <p class="text-sm font-semibold text-deepGreen">Claim (£85)</p>
    `;
  }

  tile.addEventListener('click', () => openModal(km));
  return tile;
}

function renderGrid() {
  const fragment = document.createDocumentFragment();

  for (let km = 1; km <= totalKilometres; km += 1) {
    fragment.appendChild(createTile(km));
  }

  kmGrid.appendChild(fragment);
}

function renderProgress() {
  const claimed = claimedCount();
  progressText.textContent = `${claimed} / ${totalKilometres} kilometres sponsored`;
  progressBar.style.width = `${progressPercentage()}%`;
}

function openModal(km) {
  const claimed = claimedKmData[km];

  modalTitle.textContent = `KM ${km}`;

  if (claimed) {
    modalPrimary.textContent = claimed.primarySponsor;
    modalSupporters.innerHTML = claimed.supporters
      .map((name) => `<li class="rounded-md bg-gray-50 px-3 py-2">${name}</li>`)
      .join('');
  } else {
    modalPrimary.textContent = 'Available to claim for £85';
    modalSupporters.innerHTML = '<li class="rounded-md bg-gray-50 px-3 py-2">Be the first supporter for this kilometre.</li>';
  }

  modal.classList.add('open');
  document.body.classList.add('overflow-hidden');
}

function closeModal() {
  modal.classList.remove('open');
  document.body.classList.remove('overflow-hidden');
}

modalBackdrop.addEventListener('click', closeModal);
closeModalBtn.addEventListener('click', closeModal);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && modal.classList.contains('open')) {
    closeModal();
  }
});

renderGrid();
renderProgress();
