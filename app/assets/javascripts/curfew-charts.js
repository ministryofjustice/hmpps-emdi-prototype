// /public/javascripts/curfew-charts.js
// One source of truth for chart + table from /public/data/violations-bh.json
// First visit defaults: Line • 7 days • All durations
(function () {
  'use strict';

  // ---------- tiny helpers ----------
  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else { fn(); }
  }
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const pad2  = (n) => String(n).padStart(2, '0');

  // ---------- storage (v3) ----------
  const STORAGE_VERSION = 'v3';
  const LS  = window.localStorage || null;
  const key = (s) => `curfew:${STORAGE_VERSION}:${s}`;
  const getPref = (k, d) => { try { const v = LS && LS.getItem(k); return (v === null || v === undefined) ? d : v; } catch { return d; } };
  const setPref = (k, v) => { try { LS && LS.setItem(k, v); } catch { } };

  // seed defaults only if v3 keys don’t exist
  function seedDefaultsOnce() {
    if (getPref(key('seeded'), null) != null) return;
    setPref(key('rangeDays'),   '7');     // last 7 days
    setPref(key('durationMin'), '0');     // all durations
    setPref('curfew:v3:view',   'chart'); // belt & braces if view-toggle hasn’t run yet
    setPref(key('seeded'),      '1');
  }

  // ---------- time helpers ----------
  const to12h = (h) => ({ h: ((h + 11) % 12) + 1, suf: h < 12 ? 'am' : 'pm' });
  function fmtTime(hh, mm) { const { h, suf } = to12h(hh); return `${h}.${pad2(mm)}${suf}`; } // dots will be normalised by your normaliser
  function addMinutes(hh, mm, mins) { const t = hh * 60 + mm + mins; return { hh: Math.floor((t / 60) % 24), mm: t % 60 }; }

    
  // ---------- fallback dataset (only if fetch fails) ----------
  function skewedMinutes() { const u = Math.random(); const m = Math.round(-Math.log(1 - u) * 8); return clamp(m, 1, 217); }
  
  function buildSyntheticDataset(totalDays = 43) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const days = [];
    for (let i = totalDays - 1; i >= 0; i--) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      const iso = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      const busy = Math.random() < 0.35;
      const targetMax = busy ? 360 : 120;
      const count = clamp(Math.round((busy ? 12 : 8) + Math.random() * (busy ? 10 : 6)), 5, 20);
      const events = []; let sum = 0;
      for (let e = 0; e < count; e++) {
        const type = pickType(); const mins = skewedMinutes();
        if (sum + mins > targetMax) break;
        const windowMins = 12 * 60; // 19:00–07:00
        const startInWin = Math.floor(Math.random() * (windowMins - Math.min(mins, windowMins)));
        const startTotal = 19 * 60 + startInWin;
        const stHH = Math.floor((startTotal) % 1440 / 60);
        const stMM = (startTotal) % 60;
        events.push({ minutes: mins, type, startHH: stHH, startMM: stMM });
        sum += mins;
      }
      days.push({ date: iso, events });
    }
    return { totalDays, days };
  }

  // ---------- data load ----------
  async function loadDataset() {
    const URL = '/public/data/violations-bh.json';
    try {
      const res = await fetch(`${URL}?v=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(res.statusText);
      const json = await res.json();
      try {
        const all = (json.days || []).map(d => d.date).sort();
        if (all.length) console.info('[curfew] loaded', URL, 'range:', all[0], '→', all[all.length - 1], 'days:', all.length);
      } catch {}
      window.VIOLATION_SERIES = json;
      return json;
    } catch (err) {
      console.warn('[curfew] Using synthetic dataset (fetch failed):', err);
      const fb = buildSyntheticDataset(43);
      window.VIOLATION_SERIES = fb;
      return fb;
    }
  }


    // ---------- aggregations for chart (v3: no pending) ----------
    function aggregateDayByType(day, minMinutes) {
      const o = { reasonable: 0, unreasonable: 0, total: 0 };
      for (const ev of (day.events || [])) {
        const m = Number(ev.minutes);
        if (!Number.isFinite(m)) continue;
        if (m >= (Number(minMinutes) || 0)) {
          // Only count acceptable/unacceptable; ignore pending entirely
          if (ev.type === 'acceptable')      { o.reasonable   += m; o.total += m; }
          else if (ev.type === 'unacceptable'){ o.unreasonable += m; o.total += m; }
        }
      }
      return o;
    }


  // ---------- heading + a11y ----------
  function ensureLiveRegion(){
    let el = document.getElementById('curfew-status');
    if(!el){
      el = document.createElement('div');
      el.id = 'curfew-status';
      el.className = 'govuk-visually-hidden';
      el.setAttribute('aria-live','polite');
      document.body.appendChild(el);
    }
    return el;
  }
  function announce(msg){
    ensureLiveRegion().textContent = msg || '';
  }
  function setHeading(el, view, rangeDays, total, min) {
    if (!el) return;
    const rangePhrase =
      (rangeDays === 7)  ? 'for the last 7 days' :
      (rangeDays === 30) ? 'for the last 30 days' :
                           `since tag was fitted (${total} days)`;
    const durPhrase =
      (Number(min) === 0) ? '(All durations)' :
      (Number(min) === 1) ? '(Over 1 min)'   :
      (Number(min) === 5) ? '(Over 5 mins)'  : '(Over 15 mins)';
    const viewWord = (view === 'table') ? 'Table' : 'Graph';
    el.textContent = `${viewWord} showing curfew data ${rangePhrase} ${durPhrase}`;
  }
  function setDurationUI(links, min) {
    links.forEach(a => {
      if (a.dataset.min === String(min)) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    });
  }

  // ---------- table generation + pagination ----------
  const PAGE_SIZE = 20;

  // Human labels for status keys (don’t change data keys)
  const STATUS_LABEL = {
    acceptable:   'Reasonable',
    unacceptable: 'Unreasonable'
  };

  // Build array of row HTML strings, newest day first; within each day, latest time first
function buildEventRows(dataset, rangeDays, minDuration) {
  const pad2 = (n)=>String(n).padStart(2,'0');
  const df = new Intl.DateTimeFormat('en-GB', {
    weekday:'long', day:'2-digit', month:'long', year:'numeric'
  });

  const rows = [];
  const slice = (dataset.days || []).slice(-rangeDays); // oldest → newest
  const tMin = (H, M) => (Number(H) || 0) * 60 + (Number(M) || 0);

  // newest day first; within day, latest time first
  for (let i = slice.length - 1; i >= 0; i--) {
    const d = slice[i];
    const [y,m,dd] = (d.date || '').split('-').map(Number);
    const pretty = df.format(new Date(y || 1970, (m || 1) - 1, dd || 1));

    const dayEvents = (d.events || [])
      .filter(ev => {
        const mins = Number(ev.minutes) || 0;
        if (mins <= 0) return false; // hide zero-minute rows
        // keep only acceptable/unacceptable; drop pending entirely
        return (ev.type === 'acceptable' || ev.type === 'unacceptable') &&
               mins >= (Number(minDuration) || 0);
      })
      .slice()
      .sort((a, b) => tMin(b.startHH, b.startMM) - tMin(a.startHH, a.startMM));

    for (const ev of dayEvents) {
      const mins = Number(ev.minutes);
      const end  = addMinutes(ev.startHH, ev.startMM, mins);
      const startStr = fmtTime(ev.startHH, ev.startMM);
      const endStr   = fmtTime(end.hh, end.mm);
      const durStr   = mins === 1 ? '1 min' : `${mins} mins`;

      // derive key + human label
      const statusKey  = (ev.type === 'acceptable') ? 'acceptable' : 'unacceptable';
      const statusText = STATUS_LABEL[statusKey]; // Reasonable / Unreasonable

      // contextual description (unchanged apart from names)
      const typeText = (statusKey === 'unacceptable') ? 'Out past curfew'
                    : (statusKey === 'acceptable')   ? 'Return home late'
                    : '';

      rows.push(`
        <tr class="govuk-table__row" data-status="${statusKey}">
          <td class="govuk-table__cell" data-sort-value="${d.date || ''}">${pretty}</td>
          <td class="govuk-table__cell" data-sort-value="${pad2(ev.startHH)}${pad2(ev.startMM)}">${startStr} to ${endStr}</td>
          <td class="govuk-table__cell" data-sort-value="${mins}">${durStr}</td>
          <td class="govuk-table__cell">${typeText}</td>
          <td class="govuk-table__cell" data-sort-value="${statusKey}">${statusText}</td>
        </tr>
      `);
    }
  }
  return rows;
}



  function renderPager(pagerEl, totalPages, currentPage) {
    if (!pagerEl) return;
    const item = (n, label = n, opts = {}) => {
      const cls = ['moj-pagination__item'];
      if (opts.prev) cls.push('moj-pagination__item--prev');
      if (opts.next) cls.push('moj-pagination__item--next');
      if (opts.ellipses) cls.push('moj-pagination__item--ellipses');

      if (opts.disabled) {
        return `<li class="${cls.join(' ')}"><span class="moj-pagination__link" aria-disabled="true">${label}</span></li>`;
      }
      if (opts.ellipses) return `<li class="${cls.join(' ')}" aria-hidden="true">…</li>`;
      const aria = (opts.current) ? ' aria-current="page"' : '';
      const rel  = opts.prev ? ' rel="prev"' : opts.next ? ' rel="next"' : '';
      return `<li class="${cls.join(' ')}"><a class="moj-pagination__link" href="#" data-page="${n}"${aria}${rel}
        aria-label="${opts.prev ? 'Previous page' : opts.next ? 'Next page' : 'Page ' + n}">${label}</a></li>`;
    };

    const current = currentPage;
    const last    = totalPages;
    const win     = 2;
    const start   = Math.max(1, current - win);
    const end     = Math.min(last, current + win);

    const parts = [];
    parts.push(item(current-1, '<span class="moj-pagination__link-title">Previous</span>', {prev:true, disabled: current===1}));
    if (start > 1) parts.push(item(1, 1));
    if (start > 2) parts.push(item(null, '…', {ellipses:true}));
    for (let n=start; n<=end; n++) parts.push(item(n, n, {current: n===current}));
    if (end < last-1) parts.push(item(null, '…', {ellipses:true}));
    if (end < last)   parts.push(item(last, last));
    parts.push(item(current+1, '<span class="moj-pagination__link-title">Next</span>', {next:true, disabled: current===last}));

    pagerEl.innerHTML = `<ul class="moj-pagination__list">${parts.join('')}</ul>`;
  }

  function renderEventTablePage(tbody, captionEl, pagerEl, rows, page, dataset, rangeDays, minDuration) {
    const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    const current = Math.min(Math.max(1, page || 1), totalPages);
    const start = (current - 1) * PAGE_SIZE;
    const end   = start + PAGE_SIZE;

    tbody.innerHTML = rows.slice(start, end).join('');

    if (captionEl) {
      const label = (rangeDays === 7) ? 'Last 7 days' :
                    (rangeDays === 30) ? 'Last 30 days' :
                    `Since tag was fitted (${dataset.totalDays} days)`;
      const dur = (minDuration === 0) ? 'All durations' :
                  (minDuration === 1) ? 'Over 1 min' :
                  (minDuration === 5) ? 'Over 5 mins' : 'Over 15 mins';
      captionEl.textContent = `Violation events – ${label} (${dur}) • ${rows.length} results`;
    }

    renderPager(pagerEl, totalPages, current);
  }

// ---------- Day bands as a DOM layer (always behind the canvas) ----------
const dayBandsDOMPlugin = {
  id: 'dayBandsDOM',

  _ensureLayer(chart) {
    const holder = chart.canvas.parentNode; // Chart.js wraps the canvas in a div
    if (!holder) return null;

    // Make the holder a positioning context
    if (!holder.style.position) holder.style.position = 'relative';

    // Ensure the canvas is explicitly ABOVE the band layer
    if (!chart.canvas.style.position) chart.canvas.style.position = 'relative';
    chart.canvas.style.zIndex = '1';

    // Create or reuse the band layer (z-index below the canvas)
    let layer = holder.querySelector('.curfew-day-bands');
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'curfew-day-bands';
      Object.assign(layer.style, {
        position: 'absolute',
        pointerEvents: 'none',
        zIndex: '0'     // canvas is zIndex: 1
      });
      // Insert *before* the canvas so DOM order also keeps it below
      holder.insertBefore(layer, chart.canvas);
    } else {
      layer.style.zIndex = '0';
    }
    return layer;
  },

  afterRender(chart, _args, opts) {
    const { enabled = true, shade = 'rgba(0,0,0,0.03)' } = opts || {};
    if (!enabled) return;

    const area = chart.chartArea;
    const x    = chart.scales?.x;
    if (!area || !x) return;

    const layer = this._ensureLayer(chart);
    if (!layer) return;

    // Robust per-day width using the scale (works even before datasets animate in)
    const tickCount = (x.ticks || []).length;
    const catW = (tickCount >= 2)
      ? Math.max(1, Math.round(x.getPixelForTick(1) - x.getPixelForTick(0)))
      : Math.max(1, Math.round((area.right - area.left) / Math.max(1, (chart.data?.labels?.length || 1))));

    // Align the first band to the midpoint before tick 0
    const firstCentre = x.getPixelForTick(0);
    const leftEdge    = Math.round(firstCentre - catW / 2);

    // Position layer to the plotting area and paint alternating 50/50 bands
    Object.assign(layer.style, {
      left:   area.left   + 'px',
      top:    area.top    + 'px',
      width:  (area.right - area.left) + 'px',
      height: (area.bottom - area.top) + 'px',
      backgroundImage: `repeating-linear-gradient(
        90deg,
        ${shade}, ${shade} ${catW/2}px,
        transparent ${catW/2}px, transparent ${catW}px
      )`,
      backgroundPositionX: (leftEdge - area.left) + 'px',
      backgroundRepeat: 'repeat'
    });
  }
};

// ---------- Minor x-axis ticks (one per day, skip labelled/major ticks) ----------
const minorXTicksPlugin = {
  id: 'minorXTicks',
  afterDraw(chart, _args, opts) {
    const { enabled = true, length = 4, color = 'rgba(0,0,0,0.25)' } = opts || {};
    if (!enabled) return;

    const meta = chart.getDatasetMeta(0);
    const pts  = meta?.data;
    const x    = chart.scales?.x;
    const y    = chart.scales?.y;
    if (!pts || !pts.length || !x || !y) return;

    // Pixel positions of majors (labelled ticks)
    const majorPx = (x.ticks || []).map((_, i) => Math.round(x.getPixelForTick(i)));
    const nearMajor = (px) => majorPx.some(m => Math.abs(m - px) <= 1); // 1px tolerance

    const { bottom } = chart.chartArea;
    const ctx = chart.ctx;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;

    for (let i = 0; i < pts.length; i++) {
      const px = Math.round(pts[i].x);
      if (nearMajor(px)) continue; // skip where a major exists
      ctx.beginPath();
      ctx.moveTo(px + 0.5, bottom);
      ctx.lineTo(px + 0.5, bottom + length);
      ctx.stroke();
    }
    ctx.restore();
  }
};




// ---------- Chart.js setup with reduced-motion guard ----------
function ensureChart(canvas) {
  if (!canvas || typeof Chart === 'undefined') return null;
  const existing = Chart.getChart ? Chart.getChart(canvas) : null;
  if (existing) return existing;

  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reducedMotion = mq.matches;

  const chart = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: [],
      datasets: [
        { key: 'reasonable',   label: 'Reasonable',   type: 'bar', data: [], backgroundColor: '#0070b3', borderWidth: 0, pointRadius: 0, borderRadius: 3, categoryPercentage: 0.85, barPercentage: 0.9 },
        { key: 'unreasonable', label: 'Unreasonable', type: 'bar', data: [], backgroundColor: '#d4351c', borderWidth: 0, pointRadius: 0, borderRadius: 3, categoryPercentage: 0.85, barPercentage: 0.9 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          stacked: false,
          ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10, font: { size: 13 } },
          // show axis line, no vertical grid, let plugins do banding + ticks
          grid: { display: true, drawOnChartArea: false, drawTicks: true, tickLength: 6 }
        },
        y: {
          stacked: false,
          beginAtZero: true,
          title: { display: true, text: 'Minutes' },
          grid: { color: 'rgba(0,0,0,0.06)' }
        }
      },
      plugins: {
        // background stripes per day
        dayBandsDOM: { enabled: true, shade: 'rgba(0,0,0,0.03)' },
        minorXTicks: { enabled: true, length: 4, color: 'rgba(0,0,0,0.25)' },
        legend: { position: 'top', labels: { usePointStyle: true } },
        tooltip: { animation: !reducedMotion }
      },
      animation: { duration: reducedMotion ? 0 : 400 },
      transitions: reducedMotion ? {
        active: { animation: { duration: 0 } },
        resize: { animation: { duration: 0 } },
        show:   { animation: { duration: 0 } },
        hide:   { animation: { duration: 0 } }
      } : undefined
    },
    // register both custom plugins
    plugins: [dayBandsDOMPlugin, minorXTicksPlugin]
  });

  if (typeof mq.addEventListener === 'function') {
    mq.addEventListener('change', (e) => {
      const reduce = e.matches;
      chart.options.animation.duration = reduce ? 0 : 400;
      chart.options.plugins.tooltip.animation = !reduce;
      chart.options.transitions = reduce ? {
        active: { animation: { duration: 0 } },
        resize: { animation: { duration: 0 } },
        show:   { animation: { duration: 0 } },
        hide:   { animation: { duration: 0 } }
      } : undefined;
      chart.update(0);
    });
  }

  return chart;
}



  // ---------- main ----------
  onReady(async function () {
    // DOM
    const headingEl  = document.getElementById('violation-heading');
    const chooserEl  = document.getElementById('range-chooser');
    const canvas     = document.getElementById('violationsChart');
    const eventsBody = document.getElementById('bh-events-body');
    const captionEl  = document.getElementById('bh-table-caption');
    if (captionEl) captionEl.classList.add('govuk-visually-hidden');
    const pagerEl    = document.getElementById('bh-pager');
    
    // ONE declaration (no duplicate const errors)
    const durationLinks = Array.from(document.querySelectorAll('.bh-duration-link')).map((a,i)=>{
      if(!a.hasAttribute('data-min')) a.setAttribute('data-min', String([0,1,5,15][i] ?? 0));
      return a;
    });

    // seed defaults for first visit
    seedDefaultsOnce();

    // 1) Get or create the chart
    const chart = ensureChart(canvas);
    if (!chart) { console.warn('[curfew] Chart not available'); return; }
    window.curfewChart = chart;

    // Load data
    const DATA = window.VIOLATION_SERIES || await loadDataset();

    // read prefs (clamped + sanitised)
    let rangeDays   = Math.min(Number(getPref(key('rangeDays'), 7)) || 7, DATA.totalDays || 7);
    let minDuration = Number(getPref(key('durationMin'), 0)) || 0;
    let currentView = 'chart'; // updated via bh:curfew:view-changed

    function buildSeries(dataset, rangeDays, minDuration) {
      const fmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
      const slice = (dataset.days || []).slice(-rangeDays);

      const labels = [], acc = [], unacc = [], tot = [];

      for (const d of slice) {
        const [y, m, dd] = (d.date || '').split('-').map(Number);
        labels.push(fmt.format(new Date(y || 1970, (m || 1) - 1, dd || 1)));

        const t = aggregateDayByType(d, Number(minDuration) || 0);
        acc.push(+t.reasonable     || 0);   // maps to dataset[0]
        unacc.push(+t.unreasonable || 0);   // maps to dataset[1]
        tot.push(+t.total          || 0);   // maps to dataset[2]
      }

      return { labels, acc, unacc, tot };
    }


    // --- renderers ---
    function renderChartAndUI() {
      const s = buildSeries(DATA, rangeDays, minDuration);
      chart.data.labels = s.labels;
      chart.data.datasets[0].data = s.acc;
      chart.data.datasets[1].data = s.unacc;
      chart.update('none');

      setHeading(headingEl, currentView, rangeDays, DATA.totalDays, minDuration);
      setDurationUI(durationLinks, minDuration);

      const durText = (minDuration===0) ? 'All durations' :
                      (minDuration===1) ? 'Over 1 min' :
                      (minDuration===5) ? 'Over 5 mins' : 'Over 15 mins';
      announce(`${currentView === 'table' ? 'Table' : 'Graph'} updated ${rangeDays===7?'for the last 7 days':rangeDays===30?'for the last 30 days':`since tag was fitted (${DATA.totalDays} days)`} (${durText}).`);
    }

  

    function buildRows() { return buildEventRows(DATA, rangeDays, minDuration); }

    function renderCurfewTableFromCurrent(page = 1) {
      if (!eventsBody || !captionEl || !pagerEl) return;
      const rows = buildRows();
      renderEventTablePage(eventsBody, captionEl, pagerEl, rows, page, DATA, rangeDays, minDuration);
      if (window.TimeFormat?.normaliseCurfewTimesNow) window.TimeFormat.normaliseCurfewTimesNow();

      const durText = (minDuration===0) ? 'All durations' :
                      (minDuration===1) ? 'Over 1 min' :
                      (minDuration===5) ? 'Over 5 mins' : 'Over 15 mins';
      announce(`Table updated ${rangeDays===7?'for the last 7 days':rangeDays===30?'for the last 30 days':`since tag was fitted (${DATA.totalDays} days)`} (${durText}).`);
    }

    // --- events ---
    document.addEventListener('bh:curfew:view-changed', (e) => {
      currentView = (e?.detail?.view === 'table') ? 'table' : 'chart';
      setHeading(headingEl, currentView, rangeDays, DATA.totalDays, minDuration);
      if (currentView === 'table') renderCurfewTableFromCurrent(1);
    });
    document.addEventListener('bh:curfew:request-table', () => renderCurfewTableFromCurrent(1));

    if (pagerEl) {
      pagerEl.addEventListener('click', (e) => {
        const a = e.target.closest('a[data-page]'); if (!a) return;
        e.preventDefault();
        const page = Number(a.dataset.page) || 1;
        const rows = buildRows();
        renderEventTablePage(eventsBody, captionEl, pagerEl, rows, page, DATA, rangeDays, minDuration);
        document.getElementById('curfew-table-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    if (chooserEl) {
      chooserEl.addEventListener('click', (e) => {
        const a = e.target.closest('a[data-range]'); if (!a) return;
        e.preventDefault();
        rangeDays = Number(a.dataset.range) || DATA.totalDays;
        setPref(key('rangeDays'), String(rangeDays));
        const rowsOpen = !document.getElementById('curfew-table-wrap')?.hasAttribute('hidden');
        renderChartAndUI();
        if (rowsOpen) renderCurfewTableFromCurrent(1);
        // no auto scroll on range change
      });
    }

    durationLinks.forEach(a => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        minDuration = Number(a.dataset.min) || 0;
        setPref(key('durationMin'), String(minDuration));
        const rowsOpen = !document.getElementById('curfew-table-wrap')?.hasAttribute('hidden');
        renderChartAndUI();
        if (rowsOpen) renderCurfewTableFromCurrent(1);
      });
    });


    // ---- first paint (guaranteed non-blank) ----
    renderChartAndUI();                  // paints Line • 7 days • All durations

    const tableWrap = document.getElementById('curfew-table-wrap');
    if (tableWrap) {
      // Keep your original behavior
      if (!tableWrap.hasAttribute('hidden')) {
        renderCurfewTableFromCurrent(1);
      }
    }

    window.addEventListener('load', () => chart.resize());
    document.dispatchEvent(new CustomEvent('bh:curfew:data-ready'));

  });
})();
