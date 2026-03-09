/* HouseSeekr – Asuncion Property Market Map */

// ── Map init ──────────────────────────────────────────────────────────────────
const map = L.map('map', {
  center: [-25.2867, -57.5759],
  zoom: 13,
  zoomControl: true
});

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19
}).addTo(map);

// ── State ─────────────────────────────────────────────────────────────────────
let activeId = null;
let markers = {}; // id → L.marker

// ── DOM refs ─────────────────────────────────────────────────────────────────
const listingList   = document.getElementById('listing-list');
const priceRange    = document.getElementById('price-range');
const priceDisplay  = document.getElementById('price-display');
const bedroomFilter = document.getElementById('bedroom-filter');
const resetBtn      = document.getElementById('reset-filters');
const modalBackdrop = document.getElementById('modal-backdrop');
const modalBody     = document.getElementById('modal-body');
const modalClose    = document.getElementById('modal-close');

// stat elements
const statCount   = document.getElementById('stat-count');
const statAvgSale = document.getElementById('stat-avg-sale');
const statAvgRent = document.getElementById('stat-avg-rent');
const statMin     = document.getElementById('stat-min');

// ── Helpers ──────────────────────────────────────────────────────────────────
function formatPrice(p, listing) {
  if (listing === 'rent') return `$${p.toLocaleString()}/mo`;
  if (p >= 1_000_000) return `$${(p / 1_000_000).toFixed(2)}M`;
  return `$${p.toLocaleString()}`;
}

function typeIcon(type) {
  return { house: '🏠', apartment: '🏢', land: '🌿', commercial: '🏪' }[type] || '📍';
}

function getSelectedValues(containerId) {
  return [...document.querySelectorAll(`#${containerId} input[type=checkbox]:checked`)]
    .map(cb => cb.value);
}

// ── Filter logic ──────────────────────────────────────────────────────────────
function getFiltered() {
  const types    = getSelectedValues('type-filters');
  const listings = getSelectedValues('listing-filters');
  const maxPrice = parseInt(priceRange.value, 10);
  const minBeds  = parseInt(bedroomFilter.value, 10);

  return PROPERTIES.filter(p =>
    types.includes(p.type) &&
    listings.includes(p.listing) &&
    p.price <= maxPrice &&
    p.bedrooms >= minBeds
  );
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function updateStats(filtered) {
  statCount.textContent = filtered.length;

  const sales = filtered.filter(p => p.listing === 'sale');
  const rents = filtered.filter(p => p.listing === 'rent');

  if (sales.length) {
    const avg = Math.round(sales.reduce((s, p) => s + p.price, 0) / sales.length);
    statAvgSale.textContent = `$${avg.toLocaleString()}`;
  } else {
    statAvgSale.textContent = '—';
  }

  if (rents.length) {
    const avg = Math.round(rents.reduce((s, p) => s + p.price, 0) / rents.length);
    statAvgRent.textContent = `$${avg.toLocaleString()}/mo`;
  } else {
    statAvgRent.textContent = '—';
  }

  if (filtered.length) {
    const min = filtered.reduce((a, b) => a.price < b.price ? a : b);
    statMin.textContent = formatPrice(min.price, min.listing);
  } else {
    statMin.textContent = '—';
  }
}

// ── Markers ───────────────────────────────────────────────────────────────────
function createMarkerIcon(property, isActive) {
  const cls = [
    'custom-marker',
    property.listing === 'rent' ? 'rent-marker' : '',
    isActive ? 'active-marker' : ''
  ].filter(Boolean).join(' ');

  const label = formatPrice(property.price, property.listing);
  return L.divIcon({
    html: `<div class="${cls}">${label}</div>`,
    className: '',
    iconAnchor: [0, 0]
  });
}

function buildPopupHtml(p) {
  return `
    <div class="popup-content">
      <div class="popup-title">${p.emoji} ${p.title}</div>
      <div class="popup-price">${formatPrice(p.price, p.listing)}</div>
      <div class="popup-meta">
        ${typeIcon(p.type)} ${p.type.charAt(0).toUpperCase() + p.type.slice(1)} &bull;
        ${p.neighborhood}
        ${p.bedrooms > 0 ? `&bull; ${p.bedrooms} bd` : ''}
        ${p.area ? `&bull; ${p.area} m²` : ''}
      </div>
      <button class="popup-btn" onclick="openModal(${p.id})">View Details</button>
    </div>
  `;
}

function refreshMarkers(filtered) {
  // Remove markers not in filtered
  Object.keys(markers).forEach(id => {
    if (!filtered.find(p => p.id === parseInt(id))) {
      map.removeLayer(markers[id]);
      delete markers[id];
    }
  });

  // Add/update markers
  filtered.forEach(p => {
    if (!markers[p.id]) {
      const m = L.marker([p.lat, p.lng], { icon: createMarkerIcon(p, p.id === activeId) });
      m.bindPopup(buildPopupHtml(p), { maxWidth: 240 });
      m.on('click', () => setActive(p.id));
      m.addTo(map);
      markers[p.id] = m;
    }
  });
}

// ── Sidebar list ─────────────────────────────────────────────────────────────
function renderList(filtered) {
  listingList.innerHTML = '';
  if (filtered.length === 0) {
    listingList.innerHTML = '<p style="padding:16px;color:#64748b;font-size:.85rem;">No listings match your filters.</p>';
    return;
  }

  filtered.forEach(p => {
    const card = document.createElement('div');
    card.className = 'listing-card' + (p.id === activeId ? ' active' : '');
    card.dataset.id = p.id;

    card.innerHTML = `
      <div class="card-header">
        <span class="card-title">${p.emoji} ${p.title}</span>
        <span class="card-badge badge-${p.listing}">${p.listing === 'sale' ? 'Sale' : 'Rent'}</span>
      </div>
      <div class="card-price">${formatPrice(p.price, p.listing)}</div>
      <div class="card-meta">
        <span class="card-type-icon">${typeIcon(p.type)}</span>
        ${p.type.charAt(0).toUpperCase() + p.type.slice(1)}
        ${p.bedrooms > 0 ? ` &bull; ${p.bedrooms} bd / ${p.bathrooms} ba` : ''}
        ${p.area ? ` &bull; ${p.area} m²` : ''}
        &bull; ${p.neighborhood}
      </div>
    `;

    card.addEventListener('click', () => {
      setActive(p.id);
      const m = markers[p.id];
      if (m) {
        map.setView([p.lat, p.lng], Math.max(map.getZoom(), 15), { animate: true });
        m.openPopup();
      }
    });

    listingList.appendChild(card);
  });
}

// ── Active state ─────────────────────────────────────────────────────────────
function setActive(id) {
  activeId = id;
  // refresh card styles
  document.querySelectorAll('.listing-card').forEach(c => {
    c.classList.toggle('active', parseInt(c.dataset.id) === id);
  });
  // refresh marker icons
  Object.entries(markers).forEach(([mid, m]) => {
    const p = PROPERTIES.find(x => x.id === parseInt(mid));
    if (p) m.setIcon(createMarkerIcon(p, parseInt(mid) === id));
  });
  // scroll card into view
  const card = listingList.querySelector(`[data-id="${id}"]`);
  if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function openModal(id) {
  const p = PROPERTIES.find(x => x.id === id);
  if (!p) return;

  modalBody.innerHTML = `
    <div class="modal-img">${p.emoji}</div>
    <span class="card-badge badge-${p.listing}" style="margin-bottom:8px;display:inline-block;">
      ${p.listing === 'sale' ? 'For Sale' : 'For Rent'}
    </span>
    <h2 class="modal-title">${p.title}</h2>
    <p class="modal-neighborhood">📍 ${p.neighborhood}, Asuncion</p>
    <div class="modal-price">${formatPrice(p.price, p.listing)}</div>
    <div class="modal-specs">
      ${p.bedrooms > 0 ? `<div class="spec-box"><div class="spec-value">${p.bedrooms}</div><div class="spec-label">Bedrooms</div></div>` : ''}
      ${p.bathrooms > 0 ? `<div class="spec-box"><div class="spec-value">${p.bathrooms}</div><div class="spec-label">Bathrooms</div></div>` : ''}
      ${p.area > 0 ? `<div class="spec-box"><div class="spec-value">${p.area}</div><div class="spec-label">m²</div></div>` : ''}
    </div>
    <p class="modal-desc">${p.description}</p>
    <div class="modal-tags">
      ${p.tags.map(t => `<span class="tag">${t}</span>`).join('')}
    </div>
  `;

  modalBackdrop.classList.add('open');
}

window.openModal = openModal; // expose for popup button onclick

modalClose.addEventListener('click', () => modalBackdrop.classList.remove('open'));
modalBackdrop.addEventListener('click', e => {
  if (e.target === modalBackdrop) modalBackdrop.classList.remove('open');
});

// ── Render all ────────────────────────────────────────────────────────────────
function render() {
  const filtered = getFiltered();
  refreshMarkers(filtered);
  renderList(filtered);
  updateStats(filtered);
}

// ── Event listeners ───────────────────────────────────────────────────────────
priceRange.addEventListener('input', () => {
  const val = parseInt(priceRange.value, 10);
  priceDisplay.textContent = val >= 500000 ? '$500,000+' : `$${val.toLocaleString()}`;
  render();
});

document.querySelectorAll('#type-filters input, #listing-filters input')
  .forEach(cb => cb.addEventListener('change', render));

bedroomFilter.addEventListener('change', render);

resetBtn.addEventListener('click', () => {
  document.querySelectorAll('#type-filters input, #listing-filters input')
    .forEach(cb => { cb.checked = true; });
  priceRange.value = 500000;
  priceDisplay.textContent = '$500,000+';
  bedroomFilter.value = '0';
  activeId = null;
  render();
});

// ── Initial render ────────────────────────────────────────────────────────────
render();
