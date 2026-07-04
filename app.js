'use strict';
const $ = (s, r = document) => r.querySelector(s);
const money = n => (n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }));
const pct = n => (n == null ? '—' : Math.round(n * 100) + '%');
const fmtBuilt = iso => { const p = (iso || '').slice(0, 10).split('-'); const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][(+p[1]) - 1]; return mo ? `${mo} ${+p[2]}, ${p[0]}` : (iso || '').slice(0, 10); };

let DATA = null;
const state = { q: '', cat: '', sort: 'az', country: 'US' };

// plan for a product in a specific country: full for core markets, compact otherwise.
function getPlan(p, cc) {
  if (p.countries[cc]) return p.countries[cc];  // full plan (has .tiers, .route_options)
  const c = p.all && p.all[cc];
  if (!c) return null;
  return {
    _compact: true,
    landed_cost: c.l, current_gm_pct: c.g, recommended_price: c.r, floor_price: c.f,
    below_floor: c.bf, supplier: c.sup, shipping_cost: c.sh, days_max: c.d, action: c.a,
    price_to_win_share: c.r, price_protect_margin: c.r, market_ref: null,
    shipping_share: (c.sh != null && c.l) ? c.sh / c.l : null,
  };
}
const cur = p => getPlan(p, state.country);   // list uses the global country
const isFull = plan => plan && !plan._compact;

function passes(p) {
  const plan = cur(p); if (!plan) return false;
  if (state.cat && !(p.categories || [p.category]).includes(state.cat)) return false;
  if (state.q) {
    const q = state.q.toLowerCase();
    if (!(p.title || '').toLowerCase().includes(q) && !(p.category || '').includes(q)) return false;
  }
  return true;
}

function sortRows(rows) {
  const by = {
    marginLow: (a, b) => ((cur(a) || {}).current_gm_pct ?? 1) - ((cur(b) || {}).current_gm_pct ?? 1),
    priceHigh: (a, b) => (b.current_price || 0) - (a.current_price || 0),
    priceLow: (a, b) => (a.current_price || 0) - (b.current_price || 0),
    az: (a, b) => (a.title || '').localeCompare(b.title || ''),
  }[state.sort] || ((a, b) => (a.title || '').localeCompare(b.title || ''));
  return rows.slice().sort(by);
}

function renderSummary() {
  const rows = DATA.products.filter(p => cur(p));
  let msum = 0, mc = 0;
  for (const p of rows) { const g = (cur(p) || {}).current_gm_pct; if (g != null) { msum += g; mc++; } }
  const cats = new Set(rows.map(p => p.category)).size;
  $('#summary').innerHTML = `
    <div class="stat"><div class="n">${rows.length}</div><div class="l">Products</div></div>
    <div class="stat"><div class="n good">${pct(mc ? msum / mc : null)}</div><div class="l">Avg margin</div></div>
    <div class="stat"><div class="n">${cats}</div><div class="l">Categories</div></div>`;
}

function renderControls() {
  const opt = c => `<option value="${c.code}" ${c.code === state.country ? 'selected' : ''}>${c.code} · ${c.name}</option>`;
  const core = DATA.countries.filter(c => c.full), rest = DATA.countries.filter(c => !c.full);
  $('#country').innerHTML =
    `<optgroup label="Core markets (full detail)">${core.map(opt).join('')}</optgroup>` +
    (rest.length ? `<optgroup label="Any destination (landed + margin)">${rest.map(opt).join('')}</optgroup>` : '');
  const cats = DATA.category_list || [...new Set(DATA.products.map(p => p.category))].sort();
  $('#cat').innerHTML = `<option value="">All categories</option>` + cats.map(c => `<option value="${c}">${c}</option>`).join('');
}

function card(p, i) {
  const plan = cur(p);
  const img = p.image ? `<img class="thumb" loading="lazy" src="${p.image}" alt="">` : `<div class="thumb"></div>`;
  return `<div class="card" data-i="${i}">
    ${img}
    <div class="mid">
      <p class="t">${p.title || ''}</p>
      <div class="meta">${p.category} · cost ${money(plan.landed_cost)} · ${pct(plan.current_gm_pct)} margin</div>
    </div>
    <div class="right">
      <div class="price-dtc">${money(p.current_price)}</div>
      <div class="price-lbl">DTC single</div>
    </div>
  </div>`;
}

let VIEW = [];
function renderList() {
  VIEW = sortRows(DATA.products.filter(passes));
  const el = $('#list');
  el.innerHTML = VIEW.length ? VIEW.map((p, i) => card(p, i)).join('')
    : `<div class="empty">No products match${state.country !== 'US' ? ' for ' + state.country : ''}.</div>`;
}

// --- Route selection + P&L ---
let DETAIL = null;   // { routes, sel, price }

function pnlHtml(route, price) {
  const pc = (route.landed != null && route.shipping != null) ? route.landed - route.shipping : null;
  const gp = price != null ? price - route.landed : null;
  const gm = (gp != null && price) ? gp / price : null;
  const cls = v => v == null ? '' : v >= 0 ? 'pos' : 'neg';
  return `<table>
    <tr><th>P&amp;L / unit</th><th>Amount</th></tr>
    <tr><td>Sale price</td><td>${money(price)}</td></tr>
    <tr><td>Product cost <span class="tmute">fixed</span></td><td>−${money(pc)}</td></tr>
    <tr><td>Shipping <span class="tmute">by route</span></td><td>−${money(route.shipping)}</td></tr>
    <tr class="tot"><td>Gross profit</td><td class="${cls(gp)}">${money(gp)}</td></tr>
    <tr><td>Gross margin</td><td class="${cls(gp)}">${pct(gm)}</td></tr>
  </table>`;
}

function renderRoutes() {
  const routes = DETAIL._routes, sel = DETAIL.sel, price = DETAIL.product.current_price;
  $('#routes').innerHTML = routes.map((r, i) => `<button class="route-chip ${i === sel ? 'on' : ''}" data-r="${i}">
    <div class="rc-l">${r.shipping > 0 ? money(r.shipping) : 'Free'} <span class="rc-t">ship</span></div>
    <div class="rc-m">${(r.method || r.supplier || 'Route').slice(0, 18)}</div>
    <div class="rc-m">${r.days_max ? '~' + r.days_max + 'd' : ''}${i === 0 ? ' · cheapest' : ''}</div>
  </button>`).join('');
  $('#pnl').innerHTML = pnlHtml(routes[sel], price);
}
function selectRoute(i) {
  if (!DETAIL) return;
  DETAIL.sel = i;
  const s = $('#detail-card').scrollTop;
  renderDetail();               // re-render so P&L + cost breakdown stay in sync
  $('#detail-card').scrollTop = s;
}

// build the routes list from a plan (full → route_options; compact → the one cheapest route)
function routesFor(plan) {
  if (isFull(plan) && plan.route_options && plan.route_options.length) return plan.route_options;
  return [{ supplier: plan.supplier, method: 'Cheapest route', landed: plan.landed_cost,
            shipping: plan.shipping_cost, days_max: plan.days_max, premium: 0 }];
}

const TIER_SCHED = [['1', 0], ['2-4', .05], ['5-9', .10], ['10-24', .15], ['25-49', .22], ['50-99', .28], ['100+', .35]];
const countryName = cc => (DATA.countries.find(c => c.code === cc) || {}).name || cc;

const charm95 = v => v < 100 ? Math.max(0.95, Math.ceil(v) - 0.05) : Math.ceil(v / 5) * 5 - 0.05;
function computeTiers(landed, rec) {
  const floor = landed / (1 - DATA.guardrails.min_tier_gm);
  return TIER_SCHED.map(([qty, disc]) => {
    const unit = charm95(Math.max(rec * (1 - disc), floor));   // ends in .95, stays >= floor
    const gm = unit ? (unit - landed) / unit : null;
    return { qty, unit, off: rec ? Math.round((1 - unit / rec) * 100) : 0, gm };
  });
}

// Which live Kaching deal a product falls under (drives the retail bundle ladder).
function dealFor(p) {
  const c = p.categories || [];
  if (c.includes('Decor')) return 'decor';
  if (c.includes('Workspace Essentials')) return 'workspace';
  return 'qty';
}
// Live Kaching retail bundle prices — discount off the DTC single price (that's
// exactly how Kaching computes them). Not charm-rounded: shows the true charge.
function kachingTiers(price, landed, p) {
  if (price == null) return [];
  const deal = dealFor(p);
  const spec = deal === 'decor' ? [['Any 3+ mixed', .15]]
    : deal === 'workspace' ? [['Any 3+ mixed', .15], ['Any 5+', .20]]
    : [['2', .10], ['3', .15], ['5', .20], ['10', .25]];
  return spec.map(([qty, disc]) => {
    const unit = Math.round(price * (1 - disc) * 100) / 100;
    return { qty, off: Math.round(disc * 100), unit, gm: unit ? (unit - landed) / unit : null };
  });
}
// Hypothetical bulk / B2B quote ladder beyond the retail bundles, clamped to the
// tier margin floor so a quote never goes underwater.
const VOLUME_SPEC = [['11-24', .28], ['25-49', .32], ['50-100', .36], ['101+', .40]];
function volumeTiers(price, landed) {
  if (price == null) return [];
  const floor = landed / (1 - (DATA.guardrails.min_tier_gm || .22));
  return VOLUME_SPEC.map(([qty, disc]) => {
    const raw = price * (1 - disc), unit = Math.round(Math.max(raw, floor) * 100) / 100;
    return { qty, off: price ? Math.round((1 - unit / price) * 100) : 0,
             unit, gm: unit ? (unit - landed) / unit : null, atFloor: raw < floor };
  });
}

// --- Sales-rep commission (revenue-based by category band; reps never see cost) ---
const COMM_LOW = ['Office Chairs', 'Desks', 'Ergonomics & Comfort'];        // 6%
const COMM_MID = ['Workspace Essentials', 'Monitor & Laptop Stands', 'Tech & Device Accessories', 'Faux Plants']; // 10%
const COMM_MIN_NET = 0.20;   // company keeps >=20% net at the floor, after commission
const floor95 = v => Math.ceil(v - 0.95) + 0.95;
function commBand(p) {
  const c = p.categories || [p.category];
  if (c.some(x => COMM_LOW.includes(x))) return { name: 'Furniture & oversize', rate: 0.06 };
  if (c.some(x => COMM_MID.includes(x))) return { name: 'Workspace & tech', rate: 0.10 };
  return { name: 'Lighting, decor & bar', rate: 0.12 };
}
function commission(p, plan) {
  const price = p.current_price, land = plan.landed_cost;
  if (price == null || land == null) return null;
  const b = commBand(p);
  const floor = Math.min(price, floor95(land / (1 - COMM_MIN_NET - b.rate)));
  return { name: b.name, rate: b.rate, floor,
    repList: price * b.rate, netList: (price - land - price * b.rate) / price,
    repFloor: floor * b.rate, netFloor: (floor - land - floor * b.rate) / floor };
}

function shipToOptions(p) {
  const codes = Object.keys(p.all || {});
  const core = (DATA.core_countries || []).filter(c => codes.includes(c));
  const rest = codes.filter(c => !(DATA.core_countries || []).includes(c)).sort((a, b) => countryName(a).localeCompare(countryName(b)));
  const opt = c => `<option value="${c}" ${c === DETAIL.cc ? 'selected' : ''}>${countryName(c)}</option>`;
  return `<optgroup label="Core markets">${core.map(opt).join('')}</optgroup>` +
    (rest.length ? `<optgroup label="Any destination">${rest.map(opt).join('')}</optgroup>` : '');
}

function openDetail(p) {
  DETAIL = { product: p, cc: state.country, sel: 0 };
  renderDetail();
  $('#detail').hidden = false;
  document.body.style.overflow = 'hidden';
  $('#detail-card').scrollTop = 0;
}

function renderDetail() {
  const p = DETAIL.product, cc = DETAIL.cc, nm = countryName(cc);
  const plan = getPlan(p, cc);
  const shipField = `<div class="d-field"><label>Ship to</label><select id="d-shipto" class="sel">${shipToOptions(p)}</select></div>`;
  const head = `
    <button class="d-close" data-close aria-label="Back">✕</button>
    <div class="d-head">
      ${p.image ? `<img class="d-img" src="${p.image}" alt="">` : ''}
      <div class="d-headmeta">
        <h2 class="d-title">${p.title || ''}</h2>
        <div class="d-sub">${p.category}${plan && plan.supplier ? ' · ' + plan.supplier : ''}</div>
      </div>
    </div>`;
  if (!plan) {
    $('#detail-card').innerHTML = head + shipField + `<div class="empty">Not shipped to ${nm}.</div>`;
    return;
  }
  const routes = routesFor(plan);
  DETAIL.sel = Math.min(DETAIL.sel, routes.length - 1);
  const productCost = (plan.landed_cost != null && plan.shipping_cost != null) ? plan.landed_cost - plan.shipping_cost : null;
  const kt = kachingTiers(p.current_price, plan.landed_cost, p);
  const vt = volumeTiers(p.current_price, plan.landed_cost);
  const ktRows = kt.map(t => `<tr><td>${t.qty}</td><td>${money(t.unit)} <span class="tmute">/ea</span></td><td>${t.off}%</td><td>${pct(t.gm)}</td></tr>`).join('');
  const vtRows = vt.map(t => `<tr><td>${t.qty}</td><td>${money(t.unit)} <span class="tmute">/ea</span></td><td>${t.off}%${t.atFloor ? '*' : ''}</td><td>${pct(t.gm)}</td></tr>`).join('');
  const cm = commission(p, plan);
  DETAIL._routes = routes;

  $('#detail-card').innerHTML = head + `
    <div class="d-priceline"><span class="price-dtc">${money(p.current_price)}</span> <span class="d-dtc-lbl">DTC single</span></div>
    ${shipField}
    <div class="sec-h">Shipping route${routes.length > 1 ? ' — tap to compare' : ''}</div>
    <div id="routes" class="routes"></div>
    <div class="sec-h">P&amp;L per unit — ${nm}</div>
    <div id="pnl" class="pnl"></div>
    <div class="sec-h">Kaching bundle — live retail (off ${money(p.current_price)})</div>
    <table class="tiers"><tr><th>Buy</th><th>Unit price</th><th>Off</th><th>Margin</th></tr>${ktRows}</table>
    <div class="sec-h">Volume quote — hypothetical bulk</div>
    <table class="tiers"><tr><th>Qty</th><th>Unit price</th><th>Off</th><th>Margin</th></tr>${vtRows}</table>
    <div class="rec-why" style="margin-top:8px">Top table = your <b>live Kaching bundle</b> discounts off the DTC single price (what customers actually pay). Bottom = <b>hypothetical bulk quotes</b> for B2B; <b>*</b> = clamped to the ${pct(DATA.guardrails.min_tier_gm)} margin floor so a quote never goes underwater.</div>
    ${cm ? `<div class="sec-h">Sales-rep commission — ${cm.name} · ${Math.round(cm.rate * 100)}% of sales</div>
    <table class="tiers"><tr><th></th><th>Sale price</th><th>Rep earns</th><th>You net</th></tr>
      <tr><td>At list</td><td>${money(p.current_price)}</td><td>${money(cm.repList)}</td><td>${pct(cm.netList)}</td></tr>
      <tr><td>Floor <span class="tmute">min quote</span></td><td>${money(cm.floor)}</td><td>${money(cm.repFloor)}</td><td>${pct(cm.netFloor)}</td></tr>
    </table>
    <div class="rec-why" style="margin-top:8px">Rep earns <b>${Math.round(cm.rate * 100)}% of net sales</b> — reps see only the rate + floor, never your cost. <b>Floor ${money(cm.floor)}</b> is the lowest a rep may quote without approval; you still net ~20% after commission. Full rate card + all floors are in <b>COMMISSION_PROGRAM.md</b>.</div>` : ''}
    <div class="sec-h">Cost breakdown — ${nm}</div>
    <div class="kv"><span class="muted">Product cost</span><span>${money(productCost)}</span></div>
    <div class="kv"><span class="muted">Shipping (selected route)</span><span>${money(routes[DETAIL.sel].shipping)}</span></div>
    <div class="kv"><span class="muted">Landed cost</span><span><b>${money(plan.landed_cost)}</b></span></div>
    ${plan.shipping_share > 0.6 ? `<div class="why" style="border-left-color:var(--warn);margin-top:12px">Shipping is ${Math.round(plan.shipping_share * 100)}% of landed here — a cheaper route or a US-warehouse supplier is the real lever, not just retail price.</div>` : ''}
  `;
  renderRoutes();
}
function closeDetail() { $('#detail').hidden = true; document.body.style.overflow = ''; DETAIL = null; }

function rerender() { renderSummary(); renderList(); }

function wire() {
  $('#search').addEventListener('input', e => { state.q = e.target.value; renderList(); });
  $('#country').addEventListener('change', e => { state.country = e.target.value; rerender(); });
  $('#cat').addEventListener('change', e => { state.cat = e.target.value; renderList(); });
  $('#sort').addEventListener('change', e => { state.sort = e.target.value; renderList(); });
  $('#list').addEventListener('click', e => { const c = e.target.closest('.card'); if (c) openDetail(VIEW[+c.dataset.i]); });
  $('#detail').addEventListener('click', e => {
    const chip = e.target.closest('.route-chip');
    if (chip) { selectRoute(+chip.dataset.r); return; }
    if (e.target.closest('[data-close]')) closeDetail();
  });
  $('#detail').addEventListener('change', e => {
    if (e.target.id === 'd-shipto') { DETAIL.cc = e.target.value; DETAIL.sel = 0; renderDetail(); $('#detail-card').scrollTop = 0; }
  });
  window.addEventListener('online', () => $('#offline').hidden = true);
  window.addEventListener('offline', () => $('#offline').hidden = false);
  if (!navigator.onLine) $('#offline').hidden = false;
}

async function loadEncrypted() {
  try { const r = await fetch('./data.enc.json', { cache: 'no-cache' }); if (r.ok) return await r.json(); } catch (e) {}
  const c = await caches.match('./data.enc.json'); if (c) return await c.json();
  return null;
}
async function loadPlain() {
  try { return await (await fetch('./data.json', { cache: 'no-cache' })).json(); }
  catch (e) { const r = await caches.match('./data.json'); if (r) return await r.json(); }
  return null;
}
async function decryptData(enc, pin) {
  const b = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: b(enc.salt), iterations: enc.iter || 150000, hash: 'SHA-256' },
    baseKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b(enc.iv) }, key, b(enc.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
function startApp() {
  $('#built').textContent = DATA.built_at ? '· synced ' + fmtBuilt(DATA.built_at) : '';
  renderControls(); rerender(); wire();
}
async function tryUnlock(enc, pin, remember) {
  try { DATA = await decryptData(enc, pin); } catch (e) { return false; }
  if (!DATA) return false;
  if (remember) localStorage.setItem('eg_pin', pin);
  $('#lock').hidden = true;
  startApp();
  return true;
}
async function boot() {
  const enc = await loadEncrypted();
  if (enc) {
    const saved = localStorage.getItem('eg_pin');
    if (saved && await tryUnlock(enc, saved, false)) return;
    localStorage.removeItem('eg_pin');
    $('#lock').hidden = false;
    const submit = async () => {
      $('#lockerr').textContent = '';
      const ok = await tryUnlock(enc, $('#pin').value, $('#remember').checked);
      if (!ok) { $('#lockerr').textContent = 'Wrong passcode — try again'; $('#pin').value = ''; }
    };
    $('#unlock').addEventListener('click', submit);
    $('#pin').addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    $('#pin').focus();
    return;
  }
  DATA = await loadPlain();
  if (!DATA) { $('#list').innerHTML = '<div class="empty">No data available.</div>'; return; }
  startApp();
}

if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
boot();
