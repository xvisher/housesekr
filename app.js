/* HouseSeekr – Paraguay Property Market Map */

// ── Gradients per property type ───────────────────────────────────────────────
const TYPE_GRADIENT = {
  house:      'linear-gradient(135deg, #f97316, #fb923c)',
  apartment:  'linear-gradient(135deg, #6366f1, #818cf8)',
  land:       'linear-gradient(135deg, #22c55e, #4ade80)',
  commercial: 'linear-gradient(135deg, #f59e0b, #fbbf24)',
};

// ── Map init ──────────────────────────────────────────────────────────────────
const map = L.map('map', {
  center: [-25.32, -57.50],
  zoom: 11,
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
const resetBtn      = document.getElementById('reset-filters');
const modalBackdrop = document.getElementById('modal-backdrop');
const modalBody     = document.getElementById('modal-body');
const modalClose    = document.getElementById('modal-close');

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
  return { house: '🏡', apartment: '🏢', land: '🌿', commercial: '🏪' }[type] || '📍';
}

// Read active pill values from a pill-group container
function getPillValues(containerId) {
  return [...document.querySelectorAll(`#${containerId} .pill.active`)]
    .map(b => b.dataset.value);
}

// Read single active pill value (for single-select groups like bedrooms)
function getPillValue(containerId) {
  return document.querySelector(`#${containerId} .pill.active`)?.dataset.value ?? '0';
}

// ── City filter – built dynamically ──────────────────────────────────────────
function buildCityFilter() {
  const container = document.getElementById('city-filters');
  if (!container) return;

  // Collect unique cities from data, preserve insertion order
  const cities = [...new Set(PROPERTIES.map(p => p.city || 'Asunción'))];

  cities.forEach(city => {
    const btn = document.createElement('button');
    btn.className = 'pill active';
    btn.dataset.value = city;
    btn.textContent = city;
    btn.addEventListener('click', () => {
      btn.classList.toggle('active');
      const active = container.querySelectorAll('.pill.active');
      if (active.length === 0) btn.classList.add('active');
      render();
    });
    container.appendChild(btn);
  });
}

// ── Neighborhood price analysis ───────────────────────────────────────────────
// Returns per-neighborhood and per-city average prices, computed once from all data.
const _nbStats = (() => {
  const nb   = {};
  const city = {};
  for (const p of PROPERTIES) {
    const c = p.city || 'Asunción';
    if (!nb[p.neighborhood]) nb[p.neighborhood] = { sale: [], rent: [] };
    if (!city[c])            city[c]            = { sale: [], rent: [] };
    nb[p.neighborhood][p.listing].push(p.price);
    city[c][p.listing].push(p.price);
  }
  return { nb, city };
})();

function getPriceAnalysis(p) {
  const nbPool   = _nbStats.nb[p.neighborhood]?.[p.listing] || [];
  const cityPool = _nbStats.city[p.city || 'Asunción']?.[p.listing] || [];

  // Prefer neighborhood pool if it has 2+ entries; fall back to city pool
  const pool = nbPool.length >= 2 ? nbPool : cityPool.length >= 2 ? cityPool : null;
  if (!pool) return null;

  const avg    = pool.reduce((a, b) => a + b, 0) / pool.length;
  const pct    = ((p.price - avg) / avg) * 100;
  const label  = pct < -10 ? `${Math.abs(Math.round(pct))}% below avg`
               : pct >  10 ? `${Math.round(pct)}% above avg`
               : 'At market avg';
  const type   = pct < -10 ? 'below' : pct > 10 ? 'above' : 'fair';
  const icon   = pct < -10 ? '🟢' : pct > 10 ? '🔴' : '⚪';
  return { label, type, icon, pct };
}

// ── Filter logic ──────────────────────────────────────────────────────────────
function getFiltered() {
  const types    = getPillValues('type-filters');
  const listings = getPillValues('listing-filters');
  const cities   = getPillValues('city-filters');
  const maxPrice = parseInt(priceRange.value, 10);
  const minBeds  = parseInt(getPillValue('bedroom-pills'), 10);

  return PROPERTIES.filter(p =>
    types.includes(p.type) &&
    listings.includes(p.listing) &&
    cities.includes(p.city || 'Asunción') &&
    p.price <= maxPrice &&
    p.bedrooms >= minBeds
  );
}

// Show/hide the "× Clear" button based on whether defaults are active
function updateClearBtn() {
  const allTypes      = document.querySelectorAll('#type-filters .pill').length;
  const activeTypes   = document.querySelectorAll('#type-filters .pill.active').length;
  const allListing    = document.querySelectorAll('#listing-filters .pill').length;
  const activeListing = document.querySelectorAll('#listing-filters .pill.active').length;
  const allCities     = document.querySelectorAll('#city-filters .pill').length;
  const activeCities  = document.querySelectorAll('#city-filters .pill.active').length;
  const bedroomVal    = getPillValue('bedroom-pills');
  const priceVal      = parseInt(priceRange.value, 10);

  const isDefault = activeTypes === allTypes && activeListing === allListing
    && activeCities === allCities && bedroomVal === '0' && priceVal >= 500000;

  resetBtn.classList.toggle('visible', !isDefault);
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function updateStats(filtered) {
  statCount.textContent = filtered.length;

  const sales = filtered.filter(p => p.listing === 'sale');
  const rents = filtered.filter(p => p.listing === 'rent');

  if (sales.length) {
    const avg = Math.round(sales.reduce((s, p) => s + p.price, 0) / sales.length);
    statAvgSale.textContent = formatPrice(avg, 'sale');
  } else {
    statAvgSale.textContent = '—';
  }

  if (rents.length) {
    const avg = Math.round(rents.reduce((s, p) => s + p.price, 0) / rents.length);
    statAvgRent.textContent = `$${avg.toLocaleString()}`;
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
      <div class="popup-price">${formatPrice(p.price, p.listing)}</div>
      <div class="popup-title">${p.emoji} ${p.title}</div>
      <div class="popup-meta">
        ${p.neighborhood} · ${p.city || 'Asunción'}
        ${p.bedrooms > 0 ? ` · ${p.bedrooms} bd` : ''}
        ${p.area ? ` · ${p.area} m²` : ''}
      </div>
      <button class="popup-btn" onclick="openModal(${p.id})">View Details</button>
    </div>
  `;
}

function refreshMarkers(filtered) {
  Object.keys(markers).forEach(id => {
    if (!filtered.find(p => p.id === parseInt(id))) {
      map.removeLayer(markers[id]);
      delete markers[id];
    }
  });

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
    listingList.innerHTML = '<div class="list-empty">No listings match your filters.<br>Try adjusting the filters above.</div>';
    return;
  }

  filtered.forEach(p => {
    const card = document.createElement('div');
    card.className = 'listing-card' + (p.id === activeId ? ' active' : '');
    card.dataset.id = p.id;

    const gradient = TYPE_GRADIENT[p.type] || TYPE_GRADIENT.house;
    const hasImage = p.images && p.images.length > 0;
    const analysis = getPriceAnalysis(p);

    const heroContent = hasImage
      ? `<img src="${p.images[0]}" alt="${p.title}" loading="lazy" />`
      : p.emoji;

    const badgeHtml = analysis
      ? `<div class="price-badge badge-${analysis.type}">${analysis.icon} ${analysis.label}</div>`
      : '';

    card.innerHTML = `
      <div class="card-hero" style="${hasImage ? '' : `background:${gradient}`}">
        ${heroContent}
        <span class="card-hero-badge badge-${p.listing}">
          ${p.listing === 'sale' ? 'For Sale' : 'For Rent'}
        </span>
      </div>
      <div class="card-body">
        <div class="card-price">${formatPrice(p.price, p.listing)}</div>
        ${badgeHtml}
        <div class="card-title">${p.title} · ${p.neighborhood}</div>
        <div class="card-chips">
          ${p.bedrooms > 0 ? `<span class="card-chip">🛏 ${p.bedrooms}</span>` : ''}
          ${p.bathrooms > 0 ? `<span class="card-chip">🚿 ${p.bathrooms}</span>` : ''}
          ${p.area > 0 ? `<span class="card-chip">📐 ${p.area} m²</span>` : ''}
          <span class="card-chip">📍 ${p.city || 'Asunción'}</span>
        </div>
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
  document.querySelectorAll('.listing-card').forEach(c => {
    c.classList.toggle('active', parseInt(c.dataset.id) === id);
  });
  Object.entries(markers).forEach(([mid, m]) => {
    const p = PROPERTIES.find(x => x.id === parseInt(mid));
    if (p) m.setIcon(createMarkerIcon(p, parseInt(mid) === id));
  });
  const card = listingList.querySelector(`[data-id="${id}"]`);
  if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function openModal(id) {
  const p = PROPERTIES.find(x => x.id === id);
  if (!p) return;

  const gradient  = TYPE_GRADIENT[p.type] || TYPE_GRADIENT.house;
  const hasImages = p.images && p.images.length > 0;
  const analysis  = getPriceAnalysis(p);
  const contact   = p.contact || {};

  // Hero: image gallery or gradient
  const heroHtml = hasImages
    ? `<div class="modal-images">${p.images.map(src =>
        `<img src="${src}" alt="${p.title}" loading="lazy" />`
      ).join('')}</div>`
    : `<div class="modal-hero" style="background:${gradient}">
        ${p.emoji}
        <span class="modal-hero-badge badge-${p.listing}">
          ${p.listing === 'sale' ? 'For Sale' : 'For Rent'}
        </span>
      </div>`;

  // Price analysis badge
  const priceBadgeHtml = analysis
    ? `<span class="modal-price-badge badge-${analysis.type}">${analysis.icon} ${analysis.label}</span>`
    : '';

  // Contact block
  const contactHtml = (contact.agent || contact.phone)
    ? `<div class="modal-section-label">Contact</div>
       <div class="modal-contact">
         <div class="contact-avatar">${contact.agent ? contact.agent[0].toUpperCase() : '?'}</div>
         <div class="contact-info">
           ${contact.agent ? `<div class="contact-agent">${contact.agent}</div>` : ''}
           ${contact.phone ? `<div class="contact-phone">+${contact.phone}</div>` : ''}
         </div>
         ${contact.phone
           ? `<a class="contact-btn" href="https://wa.me/${contact.phone}?text=Hola,%20vi%20la%20propiedad%20${encodeURIComponent(p.title)}%20en%20HouseSeekr" target="_blank" rel="noopener">
               💬 WhatsApp
             </a>`
           : ''}
       </div>`
    : '';

  modalBody.innerHTML = `
    ${heroHtml}
    <div class="modal-inner">
      <div class="modal-price-row">
        <div class="modal-price">${formatPrice(p.price, p.listing)}</div>
        ${priceBadgeHtml}
      </div>
      <h2 class="modal-title">${p.title}</h2>
      <p class="modal-neighborhood">📍 ${p.neighborhood}, ${p.city || 'Asunción'}, Paraguay</p>
      <div class="modal-specs">
        ${p.bedrooms  > 0 ? `<div class="spec-box"><div class="spec-icon">🛏</div><div class="spec-value">${p.bedrooms}</div><div class="spec-label">Bedrooms</div></div>` : ''}
        ${p.bathrooms > 0 ? `<div class="spec-box"><div class="spec-icon">🚿</div><div class="spec-value">${p.bathrooms}</div><div class="spec-label">Bathrooms</div></div>` : ''}
        ${p.area      > 0 ? `<div class="spec-box"><div class="spec-icon">📐</div><div class="spec-value">${p.area}</div><div class="spec-label">m²</div></div>` : ''}
      </div>
      ${p.description ? `<div class="modal-section-label">Description</div><p class="modal-desc">${p.description}</p>` : ''}
      ${p.tags?.length ? `<div class="modal-section-label">Features</div><div class="modal-tags">${p.tags.map(t => `<span class="tag">${t}</span>`).join('')}</div>` : ''}
      ${contactHtml}
    </div>
  `;

  modalBackdrop.classList.add('open');
}

window.openModal = openModal;

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
  updateClearBtn();
}

// ── Pill filter event listeners ───────────────────────────────────────────────

// Type pills — multi-select, at least one must stay active
document.querySelectorAll('#type-filters .pill').forEach(pill => {
  pill.addEventListener('click', () => {
    pill.classList.toggle('active');
    const active = document.querySelectorAll('#type-filters .pill.active');
    if (active.length === 0) pill.classList.add('active');
    render();
  });
});

// Listing type pills — multi-select, at least one must stay active
document.querySelectorAll('#listing-filters .pill').forEach(pill => {
  pill.addEventListener('click', () => {
    pill.classList.toggle('active');
    const active = document.querySelectorAll('#listing-filters .pill.active');
    if (active.length === 0) pill.classList.add('active');
    render();
  });
});

// Bedroom pills — single-select
document.querySelectorAll('#bedroom-pills .pill').forEach(pill => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('#bedroom-pills .pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    render();
  });
});

// Price range
priceRange.addEventListener('input', () => {
  const val = parseInt(priceRange.value, 10);
  priceDisplay.textContent = val >= 500000 ? '$500,000+' : `$${val.toLocaleString()}`;
  render();
});

// Reset / Clear
resetBtn.addEventListener('click', () => {
  document.querySelectorAll('#type-filters .pill, #listing-filters .pill, #city-filters .pill')
    .forEach(p => p.classList.add('active'));
  document.querySelectorAll('#bedroom-pills .pill')
    .forEach((p, i) => p.classList.toggle('active', i === 0));
  priceRange.value = 500000;
  priceDisplay.textContent = '$500,000+';
  activeId = null;
  render();
});

// ── Initial render ────────────────────────────────────────────────────────────
buildCityFilter();
render();
