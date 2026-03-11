/**
 * HouseSeekr AI Enrichment
 *
 * Cleans and validates scraped property listings using Claude:
 *  - Strips ad-copy noise from titles and descriptions
 *  - Assesses price against Asunción market benchmarks
 *  - Removes clearly unusable listings (zero price, garbage title, etc.)
 *  - Adds priceStatus field: "fair" | "below_market" | "above_market" | "suspicious"
 *
 * Usage:
 *   Part of pipeline (called by scrape.js automatically)
 *   Standalone re-enrichment: ANTHROPIC_API_KEY=sk-ant-... node enrich.js
 */

const Anthropic = require('@anthropic-ai/sdk');
const fs        = require('fs');
const path      = require('path');
const vm        = require('vm');

const DATA_PATH  = path.resolve(__dirname, '..', 'data.js');
const BATCH_SIZE = 20;

// ─── Market context for Claude ───────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a real estate data quality expert specializing in the Paraguay property market (Asunción, Capiatá, Areguá, and Greater Asunción metro).

Your job: clean listing data and validate prices against current market benchmarks.

## Market Benchmarks by City (USD)

### Asunción
- House for sale:        $50,000 – $600,000  (typical $120k–$250k)
- Apartment for sale:   $35,000 – $400,000  (typical $60k–$150k)
- Land for sale:         $8,000 – $300,000
- Commercial for sale:  $80,000 – $600,000
- House for rent:           $350 – $3,000/mo (typical $500–$1,200)
- Apartment for rent:       $200 – $2,000/mo (typical $400–$900)
- Commercial for rent:      $300 – $5,000/mo

### Capiatá (suburban, lower prices than Asunción)
- House for sale:        $30,000 – $150,000  (typical $50k–$100k)
- Apartment for sale:   $25,000 – $100,000  (typical $35k–$70k)
- Land for sale:         $5,000 – $80,000
- House for rent:           $250 – $700/mo   (typical $350–$550)
- Apartment for rent:       $180 – $500/mo   (typical $250–$400)

### Areguá (lakeside / scenic town, mid-range)
- House for sale:        $40,000 – $200,000  (typical $70k–$130k, lakefront up to $200k)
- Land for sale:         $10,000 – $100,000
- House for rent:           $300 – $900/mo   (typical $400–$700)

## Your tasks for EACH listing

1. **title** — Clean the title. Remove: exclamation marks, all-caps words, marketing phrases
   ("Excelente oportunidad", "No te pierdas", "OPORTUNIDAD ÚNICA", etc.).
   Keep: property type + key location detail. Max 65 characters.

2. **description** — Write 1–2 clean factual sentences. No promotional language.
   Use available data (type, bedrooms, area, neighborhood). If input description is
   already clean, preserve it shortened. If empty or useless, invent a neutral one
   based on the listing's fields.

3. **priceStatus** — Compare price to the benchmarks above:
   - "fair"         → within normal range for type + listing
   - "below_market" → noticeably under market (could be a deal or missing a zero)
   - "above_market" → noticeably over market
   - "suspicious"   → clearly wrong: price ≤ 100, implausibly low, or absurdly high

4. **keep** — Set to false ONLY when:
   - Price is 0, null, or missing
   - Neighborhood is completely empty AND title gives no location
   - Title is unintelligible garbage or a test entry
   Keep everything else (imperfect listings are still useful).

Return ONLY the JSON object. No commentary, no markdown fences.`;

// ─── JSON schema for structured output ───────────────────────────────────────

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    listings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id:          { type: 'integer' },
          title:       { type: 'string' },
          description: { type: 'string' },
          priceStatus: { type: 'string', enum: ['fair', 'below_market', 'above_market', 'suspicious'] },
          keep:        { type: 'boolean' },
        },
        required: ['id', 'title', 'description', 'priceStatus', 'keep'],
        additionalProperties: false,
      },
    },
  },
  required: ['listings'],
  additionalProperties: false,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readDataJs() {
  const raw  = fs.readFileSync(DATA_PATH, 'utf8');
  // vm.runInNewContext only exposes var (not const/let) on the sandbox,
  // so strip declaration keywords to make PROPERTIES a global assignment.
  const code = raw.replace(/^\s*(const|let|var)\s+/gm, '');
  const ctx  = {};
  vm.runInNewContext(code, ctx);
  return Array.isArray(ctx.PROPERTIES) ? ctx.PROPERTIES : [];
}

function writeDataJs(listings) {
  const indexed = listings.map((l, i) => ({ ...l, id: i + 1 }));
  const json = JSON.stringify(indexed, null, 2)
    .replace(/"([a-zA-Z_][a-zA-Z0-9_]*)"\s*:/g, '$1:')
    .replace(/"(🏡|🏢|🌿|🏪|🏠)"/g, '"$1"');

  const out = `// Real property listings scraped from Infocasas, RE/MAX Paraguay, and Inmobiliaria del Este
// Generated: ${new Date().toISOString()}
// AI-enriched: titles cleaned, descriptions refined, prices validated
const PROPERTIES = ${json};\n`;

  fs.writeFileSync(DATA_PATH, out, 'utf8');
  console.log(`✅ Wrote ${listings.length} listings to ${DATA_PATH}`);
}

// ─── Single-batch enrichment call ────────────────────────────────────────────

async function enrichBatch(client, batch) {
  // Strip internal fields; send only what Claude needs
  const input = batch.map(l => ({
    id:          l._tempId,
    title:       l.title,
    description: l.description,
    type:        l.type,
    listing:     l.listing,
    price:       l.price,
    neighborhood: l.neighborhood,
    bedrooms:    l.bedrooms,
    bathrooms:   l.bathrooms,
    area:        l.area,
  }));

  const response = await client.messages.create({
    model:      'claude-opus-4-6',
    max_tokens: 4096,
    system:     SYSTEM_PROMPT,
    messages: [{
      role:    'user',
      content: `Clean and assess these ${batch.length} listings:\n\n${JSON.stringify(input, null, 2)}`,
    }],
    output_config: {
      format: {
        type:   'json_schema',
        schema: OUTPUT_SCHEMA,
      },
    },
  });

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock) throw new Error('No text block in API response');

  const parsed = JSON.parse(textBlock.text);
  if (!Array.isArray(parsed.listings)) throw new Error('Unexpected response shape');
  return parsed.listings;
}

// ─── Main exported function ───────────────────────────────────────────────────

async function enrichListings(listings) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('\n⚠️  ANTHROPIC_API_KEY not set — skipping AI enrichment.');
    console.warn('   Set it to enable title/description cleaning and price validation.\n');
    return listings;
  }

  const client = new Anthropic();

  console.log(`\n🤖 AI enrichment: ${listings.length} listings in batches of ${BATCH_SIZE}...`);

  // Tag with temporary sequential IDs for round-trip matching
  const tagged = listings.map((l, i) => ({ ...l, _tempId: i }));
  const resultMap = new Map();

  const batches = [];
  for (let i = 0; i < tagged.length; i += BATCH_SIZE) {
    batches.push(tagged.slice(i, i + BATCH_SIZE));
  }

  for (let b = 0; b < batches.length; b++) {
    const batch    = batches[b];
    const rangeEnd = Math.min((b + 1) * BATCH_SIZE, tagged.length);
    process.stdout.write(`  Batch ${b + 1}/${batches.length} (#${b * BATCH_SIZE + 1}–${rangeEnd})... `);

    try {
      const results = await enrichBatch(client, batch);
      for (const r of results) resultMap.set(r.id, r);
      console.log('✓');
    } catch (err) {
      console.log(`✗  Error: ${err.message} — keeping originals`);
      // On failure, keep all listings in this batch unchanged
      for (const l of batch) {
        resultMap.set(l._tempId, {
          id: l._tempId, title: l.title, description: l.description,
          priceStatus: 'fair', keep: true,
        });
      }
    }
  }

  // Merge AI results back onto original listings; drop keep=false
  const enriched = tagged
    .map(l => {
      const r = resultMap.get(l._tempId);
      if (!r || !r.keep) return null;
      const { _tempId, ...clean } = l;
      return {
        ...clean,
        title:       r.title       || l.title,
        description: r.description || l.description,
        priceStatus: r.priceStatus || 'fair',
      };
    })
    .filter(Boolean);

  const removed = listings.length - enriched.length;
  console.log(`\n  ✅ Kept ${enriched.length}/${listings.length} listings (removed ${removed})`);
  return enriched;
}

module.exports = { enrichListings, writeDataJs };

// ─── Standalone mode ──────────────────────────────────────────────────────────

if (require.main === module) {
  (async () => {
    console.log('🤖 HouseSeekr AI Enrichment (standalone)\n');

    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('❌ ANTHROPIC_API_KEY is required.\n');
      console.error('   export ANTHROPIC_API_KEY=sk-ant-...');
      console.error('   node enrich.js');
      process.exit(1);
    }

    let listings;
    try {
      listings = readDataJs();
      console.log(`📂 Loaded ${listings.length} listings from data.js`);
    } catch (e) {
      console.error('❌ Could not read data.js:', e.message);
      process.exit(1);
    }

    if (listings.length === 0) {
      console.warn('⚠️  data.js is empty. Run node scrape.js first.');
      process.exit(0);
    }

    const enriched = await enrichListings(listings);
    writeDataJs(enriched);

    console.log('\nSample enriched listing:');
    console.log(JSON.stringify(enriched[0], null, 2));
  })().catch(e => {
    console.error('Fatal:', e);
    process.exit(1);
  });
}
