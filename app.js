'use strict';
const $ = (s, r = document) => r.querySelector(s);
const money = n => (n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }));
const pct = n => (n == null ? '—' : Math.round(n * 100) + '%');

let DATA = null;
const state = { q: '', filter: 'all', cat: '', sort: 'opportunity', country: 'US', strategy: 'balanced' };

const FILTERS = [['all', 'All'], ['below', 'Below floor'], ['raise', 'Raise'], ['lower', 'Lower'], ['lowmargin', 'Low margin']];
const STRATS = [['balanced', 'Balanced'], ['win', 'Win share'], ['protect', 'Protect margin']];

// active-country plan for a product: full for core markets, compact otherwise.
function cur(p) {
  const cc = state.country;
  if (p.countries[cc]) return p.countries[cc];  // _full has no flag; detect via .tiers
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
const isFull = plan => plan && !plan._compact;
// the highlighted target price for the current strategy (compact = recommended only)
function target(plan) {
  if (!plan) return null;
  if (!isFull(plan)) return plan.recommended_price;
  return state.strategy === 'win' ? plan.price_to_win_share
    : state.strategy === 'protect' ? plan.price_protect_margin
    : plan.recommended_price;
}
function targetGm(plan, price) {
  const t = target(plan);
  return (t && plan.landed_cost != null) ? (t - plan.landed_cost) / t : null;
}
function opportunity(p) {
  const plan = cur(p); if (!plan) return -1e9;
  return (target(plan) || 0) - (p.current_price || 0);
}

function passes(p) {
  const plan = cur(p); if (!plan) return false;
  if (state.cat && p.category !== state.cat) return false;
  const t = target(plan), diff = (t || 0) - (p.current_price || 0);
  const action = diff > 1 ? 'raise' : diff < -1 ? 'lower' : 'hold';
  if (state.filter === 'below' && !plan.below_floor) return false;
  if (state.filter === 'raise' && action !== 'raise') return false;
  if (state.filter === 'lower' && action !== 'lower') return false;
  if (state.filter === 'lowmargin' && !plan.low_margin_structural) return false;
  if (state.q) {
    const q = state.q.toLowerCase();
    if (!(p.title || '').toLowerCase().includes(q) && !(p.category || '').includes(q)) return false;
  }
  return true;
}

function sortRows(rows) {
  const by = {
    opportunity: (a, b) => opportunity(b) - opportunity(a),
    marginLow: (a, b) => ((cur(a) || {}).current_gm_pct ?? 1) - ((cur(b) || {}).current_gm_pct ?? 1),
    priceHigh: (a, b) => (b.current_price || 0) - (a.current_price || 0),
    priceLow: (a, b) => (a.current_price || 0) - (b.current_price || 0),
    az: (a, b) => (a.title || '').localeCompare(b.title || ''),
  }[state.sort];
  return rows.slice().sort(by);
}

function badge(p) {
  const plan = cur(p); const t = target(plan);
  const diff = (t || 0) - (p.current_price || 0);
  if (plan.below_floor) return `<span class="badge b-floor">BELOW FLOOR</span>`;
  if (diff > 1) return `<span class="badge b-raise">RAISE ${money(diff)}</span>`;
  if (diff < -1) return `<span class="badge b-lower">LOWER ${money(Math.abs(diff))}</span>`;
  return `<span class="badge b-hold">ON TARGET</span>`;
}

function renderSummary() {
  const rows = DATA.products.filter(p => cur(p));
  let below = 0, raise = 0, upside = 0, rc = 0;
  for (const p of rows) {
    const plan = cur(p), t = target(plan), diff = (t || 0) - (p.current_price || 0);
    if (plan.below_floor) below++;
    if (diff > 1) { raise++; upside += diff; rc++; }
  }
  const avg = rc ? upside / rc : 0;
  $('#summary').innerHTML = `
    <div class="stat"><div class="n bad">${below}</div><div class="l">Below floor</div></div>
    <div class="stat"><div class="n">${raise}</div><div class="l">Underpriced</div></div>
    <div class="stat"><div class="n good">${money(Math.round(avg))}</div><div class="l">Avg upside/unit</div></div>`;
}

function renderControls() {
  $('#chips').innerHTML = FILTERS.map(([k, l]) => `<button class="chip ${state.filter === k ? 'on' : ''}" data-f="${k}">${l}</button>`).join('');
  $('#strategy').innerHTML = STRATS.map(([k, l]) => `<button class="${state.strategy === k ? 'on' : ''}" data-s="${k}">${l}</button>`).join('');
  const opt = c => `<option value="${c.code}" ${c.code === state.country ? 'selected' : ''}>${c.code} · ${c.name}</option>`;
  const core = DATA.countries.filter(c => c.full), rest = DATA.countries.filter(c => !c.full);
  $('#country').innerHTML =
    `<optgroup label="Core markets (full detail)">${core.map(opt).join('')}</optgroup>` +
    (rest.length ? `<optgroup label="Any destination (landed + margin)">${rest.map(opt).join('')}</optgroup>` : '');
  const cats = [...new Set(DATA.products.map(p => p.category))].sort();
  $('#cat').innerHTML = `<option value="">All categories</option>` + cats.map(c => `<option value="${c}">${c[0].toUpperCase() + c.slice(1)}</option>`).join('');
}

function card(p, i) {
  const plan = cur(p);
  const img = p.image ? `<img class="thumb" loading="lazy" src="${p.image}" alt="">` : `<div class="thumb"></div>`;
  return `<div class="card" data-i="${i}">
    ${img}
    <div class="mid">
      <p class="t">${p.title || ''}</p>
      <div class="meta">${p.category} · land ${money(plan.landed_cost)} · GM ${pct(plan.current_gm_pct)}</div>
      ${badge(p)}
    </div>
    <div class="right">
      <div class="price-cur">${money(p.current_price)}</div>
      <div class="price-rec">${money(target(plan))}</div>
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

function bandMark(plan, price) {
  const t = target(plan);
  const lo = plan.floor_price, hi = Math.max(plan.market_ref, t, lo + 1);
  const clamp = x => Math.max(0, Math.min(100, ((x - lo) / (hi - lo)) * 100));
  return { posRec: clamp(t), posCur: clamp(price), lo, hi };
}

// --- Route selection + P&L ---
let DETAIL = null;   // { routes, sel, price, rec }

function pnlHtml(route, price, rec) {
  const pc = (route.landed != null && route.shipping != null) ? route.landed - route.shipping : null;
  const gpCur = price != null ? price - route.landed : null;
  const gpRec = rec != null ? rec - route.landed : null;
  const gmCur = (gpCur != null && price) ? gpCur / price : null;
  const gmRec = (gpRec != null && rec) ? gpRec / rec : null;
  const cls = v => v == null ? '' : v >= 0 ? 'pos' : 'neg';
  return `<table>
    <tr><th>P&amp;L / unit</th><th>At current</th><th>At recommended</th></tr>
    <tr><td>Sale price</td><td>${money(price)}</td><td>${money(rec)}</td></tr>
    <tr><td>Product cost</td><td>−${money(pc)}</td><td>−${money(pc)}</td></tr>
    <tr><td>Shipping</td><td>−${money(route.shipping)}</td><td>−${money(route.shipping)}</td></tr>
    <tr class="tot"><td>Gross profit</td><td class="${cls(gpCur)}">${money(gpCur)}</td><td class="${cls(gpRec)}">${money(gpRec)}</td></tr>
    <tr><td>Gross margin</td><td class="${cls(gpCur)}">${pct(gmCur)}</td><td class="${cls(gpRec)}">${pct(gmRec)}</td></tr>
  </table>`;
}

function renderRoutes() {
  const { routes, sel, price, rec } = DETAIL;
  $('#routes').innerHTML = routes.map((r, i) => `<button class="route-chip ${i === sel ? 'on' : ''}" data-r="${i}">
    <div class="rc-l">${money(r.landed)}</div>
    <div class="rc-m">${(r.method || r.supplier || 'Route').slice(0, 18)}</div>
    <div class="rc-m">${r.days_max ? '~' + r.days_max + 'd' : ''}${r.premium > 0.5 ? ' · +' + money(r.premium) : (i === 0 ? ' · cheapest' : '')}</div>
  </button>`).join('');
  $('#pnl').innerHTML = pnlHtml(routes[sel], price, rec);
}
function selectRoute(i) { if (DETAIL) { DETAIL.sel = i; renderRoutes(); } }

// build the routes list from a plan (full → route_options; compact → the one cheapest route)
function routesFor(plan) {
  if (isFull(plan) && plan.route_options && plan.route_options.length) return plan.route_options;
  return [{ supplier: plan.supplier, method: 'Cheapest route', landed: plan.landed_cost,
            shipping: plan.shipping_cost, days_max: plan.days_max, premium: 0 }];
}

function openDetail(p) {
  const plan = cur(p);
  const countryName = (DATA.countries.find(c => c.code === state.country) || {}).name || state.country;
  if (!isFull(plan)) { openCompact(p, plan, countryName); return; }
  const t = target(plan), tgm = targetGm(plan, p.current_price);
  const b = bandMark(plan, p.current_price);
  const stratLabel = { balanced: 'Recommended', win: 'Win share', protect: 'Protect margin' }[state.strategy];
  const tiers = plan.tiers.map(t => `<tr><td>${t.qty}</td><td>${money(t.unit_price)}</td><td>${t.pct_off ? t.pct_off + '%' : '—'}</td><td>${pct(t.gross_margin_pct)}</td></tr>`).join('');
  const fast = plan.best_fast_route;
  const fastLine = fast ? `<div class="kv"><span class="muted">Fastest good route</span><span>${fast.days_max}d · ${money(fast.landed)}${fast.premium > 0.5 ? ' (+' + money(fast.premium) + ')' : ''} <span style="color:var(--muted)">${fast.supplier}</span></span></div>` : '';
  $('#detail-card').innerHTML = `
    <div class="d-grip"></div>
    <h2 class="d-title">${p.title || ''}</h2>
    <div class="d-sub">${p.category} · ${plan.supplier || ''}${plan.days_max ? ' · ~' + plan.days_max + 'd' : ''} · ${state.country}</div>
    <div class="d-hero">
      <div class="col"><div class="k">Current</div><div class="v">${money(p.current_price)}</div><div class="k">${pct(plan.current_gm_pct)} GM</div></div>
      <div class="to">→</div>
      <div class="col"><div class="k">${stratLabel}</div><div class="v rec">${money(t)}</div><div class="k">${pct(tgm)} GM</div></div>
    </div>
    <div class="strat-note">Showing <b>${stratLabel}</b>. Balanced ${money(plan.recommended_price)} · Win share ${money(plan.price_to_win_share)} · Protect ${money(plan.price_protect_margin)}</div>
    <div class="why">${plan.why}</div>
    <div class="sec-h">Where it sits vs the market</div>
    <div class="band">
      <div class="band-track">
        <div class="band-mark" style="left:${b.posCur}%;background:#b06a00"></div>
        <div class="band-mark" style="left:${b.posRec}%"></div>
      </div>
      <div class="band-lbls"><span>floor ${money(plan.floor_price)}</span><span>market ${money(plan.market_ref)}</span></div>
    </div>
    <div class="sec-h">Everyday sale</div>
    <div><span class="promo">${plan.everyday_sale}</span> <span class="muted" style="font-size:12px">${plan.promo_style === 'percent' ? '(% off reads bigger under $120)' : plan.promo_style === 'dollar' ? '($ off reads bigger above $120)' : ''}</span></div>
    <div class="sec-h">Route &amp; P&amp;L${plan.route_options && plan.route_options.length > 1 ? ' — tap a route' : ''}</div>
    <div id="routes" class="routes"></div>
    <div id="pnl" class="pnl"></div>
    <div class="sec-h">Volume tiers (off balanced price)</div>
    <table class="tiers"><tr><th>Qty</th><th>Unit</th><th>Off</th><th>GM</th></tr>${tiers}</table>
    <div class="sec-h">Cost breakdown</div>
    <div class="kv"><span class="muted">Product cost</span><span>${money(plan.product_cost)}</span></div>
    <div class="kv"><span class="muted">Shipping${plan.shipping_method ? ' · ' + plan.shipping_method : ''}</span><span>${money(plan.shipping_cost)}${plan.shipping_share != null ? ' <span style="color:var(--muted)">(' + Math.round(plan.shipping_share * 100) + '% of landed)</span>' : ''}</span></div>
    <div class="kv"><span class="muted">Landed cost</span><span><b>${money(plan.landed_cost)}</b></span></div>
    ${fastLine}
    <div class="kv"><span class="muted">Margin floor (${pct(DATA.guardrails.floor_gm)})</span><span>${money(plan.floor_price)}</span></div>
    ${plan.shipping_share > 0.6 ? '<div class="why" style="border-left-color:var(--warn);margin-top:12px">Shipping is ' + Math.round(plan.shipping_share * 100) + '% of landed. The lever is a cheaper route or a US-warehouse supplier, not just retail price' + (plan.route_options.length > 1 ? ' — tap the routes above to compare P&L' : '') + '.</div>' : ''}
  `;
  DETAIL = { routes: routesFor(plan), sel: 0, price: p.current_price, rec: t };
  renderRoutes();
  $('#detail').hidden = false;
  document.body.style.overflow = 'hidden';
}
function openCompact(p, plan, countryName) {
  const t = plan.recommended_price, tgm = targetGm(plan, p.current_price);
  const productCost = (plan.landed_cost != null && plan.shipping_cost != null) ? plan.landed_cost - plan.shipping_cost : null;
  const why = plan.below_floor
    ? `At ${money(p.current_price)} you're BELOW your ${pct(DATA.guardrails.floor_gm)} floor for ${countryName} (${money(plan.floor_price)})${plan.current_gm_pct < 0 ? ' — you are LOSING money on orders here' : ''}.`
    : plan.action === 'raise' ? `Room to raise for ${countryName}.` : `Healthy margin for ${countryName}.`;
  $('#detail-card').innerHTML = `
    <div class="d-grip"></div>
    <h2 class="d-title">${p.title || ''}</h2>
    <div class="d-sub">${p.category} · ${plan.supplier || ''}${plan.days_max ? ' · ~' + plan.days_max + 'd' : ''} · ${countryName}</div>
    <div class="d-hero">
      <div class="col"><div class="k">Current</div><div class="v">${money(p.current_price)}</div><div class="k">${pct(plan.current_gm_pct)} GM</div></div>
      <div class="to">→</div>
      <div class="col"><div class="k">Recommended</div><div class="v rec">${money(t)}</div><div class="k">${pct(tgm)} GM</div></div>
    </div>
    <div class="why">${why}</div>
    <div class="sec-h">Route &amp; P&amp;L — ${countryName}</div>
    <div id="routes" class="routes"></div>
    <div id="pnl" class="pnl"></div>
    <div class="sec-h">Cost breakdown — ${countryName}</div>
    <div class="kv"><span class="muted">Product cost</span><span>${money(productCost)}</span></div>
    <div class="kv"><span class="muted">Shipping (cheapest)</span><span>${money(plan.shipping_cost)}${plan.shipping_share != null ? ' <span style="color:var(--muted)">(' + Math.round(plan.shipping_share * 100) + '% of landed)</span>' : ''}</span></div>
    <div class="kv"><span class="muted">Landed cost</span><span><b>${money(plan.landed_cost)}</b></span></div>
    <div class="kv"><span class="muted">Margin floor (${pct(DATA.guardrails.floor_gm)})</span><span>${money(plan.floor_price)}</span></div>
    <div class="strat-note">Landed-cost + margin view for ${countryName}. Full tiers, multiple route options and strategy pricing show in the core markets (US, CA, GB, DE, FR, JP, AE…).</div>
  `;
  DETAIL = { routes: routesFor(plan), sel: 0, price: p.current_price, rec: t };
  renderRoutes();
  $('#detail').hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeDetail() { $('#detail').hidden = true; document.body.style.overflow = ''; DETAIL = null; }

function rerender() { renderSummary(); renderList(); }

function wire() {
  $('#search').addEventListener('input', e => { state.q = e.target.value; renderList(); });
  $('#chips').addEventListener('click', e => { const f = e.target.dataset.f; if (!f) return; state.filter = f; renderControls(); rerender(); });
  $('#strategy').addEventListener('click', e => { const s = e.target.dataset.s; if (!s) return; state.strategy = s; renderControls(); rerender(); });
  $('#country').addEventListener('change', e => { state.country = e.target.value; rerender(); });
  $('#cat').addEventListener('change', e => { state.cat = e.target.value; renderList(); });
  $('#sort').addEventListener('change', e => { state.sort = e.target.value; renderList(); });
  $('#list').addEventListener('click', e => { const c = e.target.closest('.card'); if (c) openDetail(VIEW[+c.dataset.i]); });
  $('#detail').addEventListener('click', e => {
    const chip = e.target.closest('.route-chip');
    if (chip) { selectRoute(+chip.dataset.r); return; }
    if (e.target.dataset.close !== undefined) closeDetail();
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
  $('#built').textContent = '· updated ' + (DATA.built_at || '').slice(0, 10);
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
