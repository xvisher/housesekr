/**
 * HouseSeekr Scraper
 * Scrapes real property listings from:
 *  - infocasas.com.py
 *  - remax.com.py
 *  - inmobiliariadeleste.com.py
 *
 * Outputs: ../data.js  (same schema as existing file)
 *
 * Usage: node scrape.js
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { getCoords } = require('./neighborhoods.js');

// PYG → USD conversion rate (approximate)
const PYG_TO_USD = 1 / 7700;

const EMOJI = { house: '🏡', apartment: '🏢', land: '🌿', commercial: '🏪' };

// ─── Utilities ──────────────────────────────────────────────────────────────

function parsePrice(raw, currency = 'USD') {
  if (!raw) return null;
  const clean = String(raw).replace(/[^\d.,]/g, '').replace(',', '.');
  const num = parseFloat(clean.replace(/\./g, '').replace(',', '.'));
  if (isNaN(num) || num === 0) return null;
  if (currency === 'PYG' || num > 1_000_000) return Math.round(num * PYG_TO_USD);
  return Math.round(num);
}

function parseNum(raw) {
  if (!raw) return 0;
  const n = parseInt(String(raw).replace(/\D/g, ''), 10);
  return isNaN(n) ? 0 : n;
}

function guessType(title = '', raw = '') {
  const t = (title + ' ' + raw).toLowerCase();
  if (t.includes('terreno') || t.includes('lote') || t.includes('land')) return 'land';
  if (t.includes('local') || t.includes('oficina') || t.includes('comercial') || t.includes('galpón')) return 'commercial';
  if (t.includes('apartamento') || t.includes('depto') || t.includes('piso') || t.includes('flat') || t.includes('monoambiente')) return 'apartment';
  return 'house';
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Infocasas ───────────────────────────────────────────────────────────────

async function scrapeInfocasas(browser) {
  const results = [];
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-PY,es;q=0.9' });

  const sections = [
    { url: 'https://www.infocasas.com.py/venta/asuncion', listing: 'sale' },
    { url: 'https://www.infocasas.com.py/alquiler/asuncion', listing: 'rent' },
  ];

  for (const { url, listing } of sections) {
    console.log(`  [Infocasas] Scraping ${listing}: ${url}`);
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await sleep(2000);

      // Try to find listing cards
      const cards = await page.$$eval(
        '[class*="listing"], [class*="property"], [class*="inmueble"], article, [data-id]',
        (els) => els.slice(0, 60).map(el => {
          const text = el.innerText || '';
          const link = el.querySelector('a')?.href || '';
          const title = el.querySelector('h2, h3, [class*="title"], [class*="titulo"]')?.innerText?.trim() || '';
          const priceEl = el.querySelector('[class*="price"], [class*="precio"]');
          const price = priceEl?.innerText?.trim() || '';
          const neighborhood = el.querySelector('[class*="neighborhood"], [class*="barrio"], [class*="location"], [class*="ubicacion"]')?.innerText?.trim() || '';
          const beds = el.querySelector('[class*="bed"], [class*="dorm"], [class*="habitacion"]')?.innerText?.trim() || '';
          const baths = el.querySelector('[class*="bath"], [class*="baño"]')?.innerText?.trim() || '';
          const area = el.querySelector('[class*="area"], [class*="superficie"], [class*="m2"]')?.innerText?.trim() || '';
          return { title, price, neighborhood, beds, baths, area, link, text: text.slice(0, 300) };
        })
      );

      for (const c of cards) {
        if (!c.title && !c.price) continue;
        const type = guessType(c.title, c.text);
        const coords = getCoords(c.neighborhood);
        results.push({
          source: 'Infocasas',
          title: c.title || `${type} en ${c.neighborhood || 'Asunción'}`,
          neighborhood: c.neighborhood || 'Asunción',
          type,
          listing,
          rawPrice: c.price,
          bedrooms: parseNum(c.beds),
          bathrooms: parseNum(c.baths),
          area: parseNum(c.area),
          lat: coords.lat,
          lng: coords.lng,
          description: c.text.split('\n').slice(0, 3).join(' ').trim(),
          tags: [],
          link: c.link,
        });
      }

      console.log(`  [Infocasas] Found ${cards.length} cards for ${listing}`);
    } catch (e) {
      console.warn(`  [Infocasas] Error on ${url}: ${e.message}`);
    }
  }

  await page.close();
  return results;
}

// ─── RE/MAX Paraguay ─────────────────────────────────────────────────────────

async function scrapeRemax(browser) {
  const results = [];
  const page = await browser.newPage();

  // Intercept API responses
  const apiData = [];
  page.on('response', async (resp) => {
    try {
      const ct = resp.headers()['content-type'] || '';
      if (ct.includes('json') && resp.url().includes('publicacion')) {
        const json = await resp.json().catch(() => null);
        if (json && (json.data || json.results || json.items || Array.isArray(json))) {
          apiData.push(json);
        }
      }
    } catch (_) {}
  });

  const sections = [
    { url: 'https://www.remax.com.py/publicaciones/comprar?ubicacion=asuncion', listing: 'sale' },
    { url: 'https://www.remax.com.py/publicaciones/alquilar?ubicacion=asuncion', listing: 'rent' },
  ];

  for (const { url, listing } of sections) {
    apiData.length = 0;
    console.log(`  [RE/MAX] Scraping ${listing}: ${url}`);
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await sleep(3000);

      // Try API data first
      if (apiData.length > 0) {
        for (const batch of apiData) {
          const items = batch.data || batch.results || batch.items || (Array.isArray(batch) ? batch : []);
          for (const item of items) {
            const neighborhood = item.neighborhood || item.barrio || item.city || item.ciudad || '';
            const coords = getCoords(neighborhood);
            const typeRaw = (item.type || item.tipo || item.propertyType || '').toLowerCase();
            const type = typeRaw.includes('apart') ? 'apartment'
              : typeRaw.includes('terreno') || typeRaw.includes('lote') ? 'land'
              : typeRaw.includes('comercial') || typeRaw.includes('local') ? 'commercial'
              : 'house';
            results.push({
              source: 'RE/MAX',
              title: item.title || item.titulo || `${type} en ${neighborhood}`,
              neighborhood,
              type,
              listing,
              rawPrice: String(item.price || item.precio || ''),
              bedrooms: parseNum(item.bedrooms || item.dormitorios || item.habitaciones),
              bathrooms: parseNum(item.bathrooms || item.banos),
              area: parseNum(item.area || item.superficie || item.m2),
              lat: parseFloat(item.lat || item.latitude || coords.lat) || coords.lat,
              lng: parseFloat(item.lng || item.longitude || coords.lng) || coords.lng,
              description: item.description || item.descripcion || '',
              tags: Array.isArray(item.amenities) ? item.amenities : [],
              link: item.url || item.link || '',
            });
          }
        }
        console.log(`  [RE/MAX] Captured ${results.length} listings from API for ${listing}`);
      } else {
        // Fallback: DOM scraping
        const cards = await page.$$eval(
          '[class*="listing"], [class*="property"], [class*="card"], [class*="result"]',
          (els) => els.slice(0, 50).map(el => ({
            title: el.querySelector('h2,h3,[class*="title"]')?.innerText?.trim() || '',
            price: el.querySelector('[class*="price"],[class*="precio"]')?.innerText?.trim() || '',
            neighborhood: el.querySelector('[class*="location"],[class*="barrio"],[class*="neighborhood"]')?.innerText?.trim() || '',
            beds: el.querySelector('[class*="bed"],[class*="dorm"]')?.innerText?.trim() || '',
            baths: el.querySelector('[class*="bath"],[class*="bano"]')?.innerText?.trim() || '',
            area: el.querySelector('[class*="area"],[class*="m2"]')?.innerText?.trim() || '',
            text: (el.innerText || '').slice(0, 200),
          }))
        );
        for (const c of cards) {
          if (!c.title && !c.price) continue;
          const type = guessType(c.title, c.text);
          const coords = getCoords(c.neighborhood);
          results.push({
            source: 'RE/MAX',
            title: c.title || `${type} en ${c.neighborhood || 'Asunción'}`,
            neighborhood: c.neighborhood || 'Asunción',
            type,
            listing,
            rawPrice: c.price,
            bedrooms: parseNum(c.beds),
            bathrooms: parseNum(c.baths),
            area: parseNum(c.area),
            lat: coords.lat,
            lng: coords.lng,
            description: c.text,
            tags: [],
            link: '',
          });
        }
        console.log(`  [RE/MAX] DOM scraped ${cards.length} cards for ${listing}`);
      }
    } catch (e) {
      console.warn(`  [RE/MAX] Error on ${url}: ${e.message}`);
    }
  }

  await page.close();
  return results;
}

// ─── Inmobiliaria del Este ────────────────────────────────────────────────────

async function scrapeInmobiliariaDelEste(browser) {
  const results = [];
  const page = await browser.newPage();

  const urls = [
    { url: 'https://www.inmobiliariadel este.com.py/propiedades', listing: 'sale' },
    { url: 'https://www.inmobiliariadeleste.com.py/propiedades', listing: 'sale' },
    { url: 'https://inmobiliariadeleste.com.py/propiedades', listing: 'sale' },
  ];

  for (const { url, listing } of urls) {
    console.log(`  [InmDel Este] Trying: ${url}`);
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      if (!resp || resp.status() >= 400) continue;
      await sleep(2000);

      const cards = await page.$$eval(
        'article, [class*="propiedad"], [class*="listing"], [class*="card"], [class*="property"]',
        (els) => els.slice(0, 50).map(el => ({
          title: el.querySelector('h2,h3,h4,[class*="title"],[class*="titulo"]')?.innerText?.trim() || '',
          price: el.querySelector('[class*="price"],[class*="precio"],[class*="valor"]')?.innerText?.trim() || '',
          neighborhood: el.querySelector('[class*="barrio"],[class*="neighborhood"],[class*="ubicacion"],[class*="location"]')?.innerText?.trim() || '',
          beds: el.querySelector('[class*="dorm"],[class*="habitacion"],[class*="bed"]')?.innerText?.trim() || '',
          baths: el.querySelector('[class*="bano"],[class*="bath"]')?.innerText?.trim() || '',
          area: el.querySelector('[class*="m2"],[class*="area"],[class*="superficie"],[class*="terreno"]')?.innerText?.trim() || '',
          text: (el.innerText || '').slice(0, 300),
          link: el.querySelector('a')?.href || '',
        }))
      );

      for (const c of cards) {
        if (!c.title && !c.price) continue;
        const type = guessType(c.title, c.text);
        const coords = getCoords(c.neighborhood);
        results.push({
          source: 'InmDelEste',
          title: c.title || `${type} en ${c.neighborhood || 'Asunción'}`,
          neighborhood: c.neighborhood || 'Asunción',
          type,
          listing,
          rawPrice: c.price,
          bedrooms: parseNum(c.beds),
          bathrooms: parseNum(c.baths),
          area: parseNum(c.area),
          lat: coords.lat,
          lng: coords.lng,
          description: c.text.split('\n').slice(0, 3).join(' ').trim(),
          tags: [],
          link: c.link,
        });
      }
      console.log(`  [InmDel Este] Found ${cards.length} cards`);
      break; // stop trying URLs once one works
    } catch (e) {
      console.warn(`  [InmDel Este] Error on ${url}: ${e.message}`);
    }
  }

  await page.close();
  return results;
}

// ─── Normalize & Deduplicate ─────────────────────────────────────────────────

function normalize(raw) {
  // Determine price currency
  const priceStr = String(raw.rawPrice || '');
  const isGuarani = priceStr.includes('Gs') || priceStr.includes('PYG') || priceStr.includes('₲');
  const price = parsePrice(priceStr, isGuarani ? 'PYG' : 'USD');

  return {
    title: raw.title,
    neighborhood: raw.neighborhood,
    type: raw.type,
    listing: raw.listing,
    price,
    currency: 'USD',
    bedrooms: raw.bedrooms || 0,
    bathrooms: raw.bathrooms || 0,
    area: raw.area || 0,
    lat: raw.lat,
    lng: raw.lng,
    description: raw.description || '',
    tags: raw.tags || [],
    emoji: EMOJI[raw.type] || '🏠',
    _source: raw.source,
    _link: raw.link,
  };
}

function deduplicate(listings) {
  const seen = new Set();
  return listings.filter(l => {
    const key = `${l.title}|${l.price}|${l.neighborhood}`.toLowerCase().replace(/\s/g, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Write output ─────────────────────────────────────────────────────────────

function writeDataJs(listings) {
  const indexed = listings.map((l, i) => ({ id: i + 1, ...l }));
  const json = JSON.stringify(indexed, null, 2)
    .replace(/"([a-zA-Z_][a-zA-Z0-9_]*)"\s*:/g, '$1:') // unquote keys
    .replace(/"(🏡|🏢|🌿|🏪|🏠)"/g, '"$1"');           // keep emoji strings

  const js = `// Real property listings scraped from Infocasas, RE/MAX Paraguay, and Inmobiliaria del Este
// Generated: ${new Date().toISOString()}
const PROPERTIES = ${json};\n`;

  const outPath = path.resolve(__dirname, '..', 'data.js');
  fs.writeFileSync(outPath, js, 'utf8');
  console.log(`\n✅ Wrote ${listings.length} listings to ${outPath}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Starting HouseSeekr scraper...\n');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  let all = [];

  try {
    console.log('📦 Scraping Infocasas...');
    const infocasas = await scrapeInfocasas(browser);
    console.log(`  → ${infocasas.length} raw listings\n`);
    all = all.concat(infocasas);

    console.log('📦 Scraping RE/MAX Paraguay...');
    const remax = await scrapeRemax(browser);
    console.log(`  → ${remax.length} raw listings\n`);
    all = all.concat(remax);

    console.log('📦 Scraping Inmobiliaria del Este...');
    const ide = await scrapeInmobiliariaDelEste(browser);
    console.log(`  → ${ide.length} raw listings\n`);
    all = all.concat(ide);
  } finally {
    await browser.close();
  }

  console.log(`\n📊 Total raw: ${all.length}`);

  // Normalize
  const normalized = all
    .map(normalize)
    .filter(l => l.price && l.price > 0 && l.title);

  console.log(`📊 After filtering (has price + title): ${normalized.length}`);

  const deduped = deduplicate(normalized);
  console.log(`📊 After dedup: ${deduped.length}`);

  if (deduped.length === 0) {
    console.warn('\n⚠️  No listings scraped. Sites may have changed structure.');
    console.warn('   Keeping existing data.js unchanged.');
    process.exit(1);
  }

  writeDataJs(deduped);

  // Print sample
  console.log('\nSample listing:');
  console.log(JSON.stringify(deduped[0], null, 2));
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
