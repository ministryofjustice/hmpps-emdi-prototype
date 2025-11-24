// /public/javascripts/curfew-time-normaliser.js
// Normalise times in the Curfew table.
//  - "10.32pm"  -> "10:32pm"
//  - "8.00pm"   -> "8pm"
//  - "8:00 pm"  -> "8pm"
//  - Ranges like "10.32pm to 10.53pm" handled.
// Runs on load + on any table DOM changes (MutationObserver).

(function () {
  'use strict';

  // ---- formatting ----
  function formatTimeString(str) {
    if (!str) return '';
    let t = String(str).trim().toLowerCase();

    // normalise separators (ALL dots to colons)
    t = t.replace(/\./g, ':');

    // ensure a space before am/pm temporarily (simplifies patterns)
    t = t.replace(/\s*(am|pm)\b/i, ' $1');

    // if exactly on the hour, drop :00 (handles "8:00 pm" or "8:00pm")
    t = t.replace(/(\b\d{1,2}):00\s*(am|pm)\b/i, (_, h, ap) => `${parseInt(h, 10)} ${ap}`);

    // tighten am/pm (no space in final style)
    t = t.replace(/\s+(am|pm)\b/gi, '$1');

    return t;
  }

  function formatTimeRange(rangeStr) {
    if (!rangeStr) return '';
    const txt = String(rangeStr).trim();
    const m = txt.match(/^(.+?)\s+to\s+(.+)$/i);
    if (!m) return formatTimeString(txt);
    return `${formatTimeString(m[1])} to ${formatTimeString(m[2])}`;
  }

  // ---- table discovery ----
  function findCurfewTable() {
    // Prefer explicit id if you have it (add id="curfew-table" or "violations-table" if convenient)
    const explicit = document.getElementById('curfew-table')
                   || document.getElementById('violations-table');
    if (explicit) return explicit;

    // Heuristic: any table with a THEAD and a "Time" header next to a "Date" header
    const tables = Array.from(document.querySelectorAll('table'));
    for (const table of tables) {
      const ths = Array.from(table.querySelectorAll('thead th')).map(th =>
        th.textContent.trim().toLowerCase()
      );
      if (ths.length && ths.includes('time') && ths.includes('date')) {
        return table;
      }
    }
    return null;
  }

  function getTimeColumnIndex(table) {
    const ths = Array.from(table.querySelectorAll('thead th'));
    for (let i = 0; i < ths.length; i++) {
      const txt = ths[i].textContent.trim().toLowerCase();
      if (txt === 'time' || txt === 'times' || txt === 'time range') return i;
    }
    // fallback: usually Date, Time, Duration, ...
    return 1;
  }

  // ---- apply to table ----
  function normaliseTableTimes(table) {
    if (!table) return;
    const timeCol = getTimeColumnIndex(table);
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    for (const tr of rows) {
      const cells = tr.cells;
      if (!cells || timeCol >= cells.length) continue;
      const td = cells[timeCol];
      const original = td ? td.textContent : '';
      const formatted = formatTimeRange(original);
      if (formatted && formatted !== original) {
        td.textContent = formatted;
      }
    }
  }

  // Also handle any inline elements marked up for times
  function normaliseInline() {
    document.querySelectorAll('.curfew-time, [data-curfew-time]').forEach(el => {
      const raw = el.getAttribute('data-curfew-time') || el.textContent;
      const formatted = formatTimeRange(raw);
      if (el.hasAttribute('data-curfew-time')) el.setAttribute('data-curfew-time', formatted);
      el.textContent = formatted;
    });
  }

  // Debounce helper for mutation bursts
  function debounce(fn, ms) {
    let t;
    return function () {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }

  // Main runner (idempotent)
  function run() {
    const table = findCurfewTable();
    if (table) normaliseTableTimes(table);
    normaliseInline();
  }

  // Keep things formatted if a sortable table rewrites DOM
  function observeTable() {
    const table = findCurfewTable();
    if (!table) return;

    const tbody = table.tBodies && table.tBodies[0];
    if (!tbody) return;

    const reapply = debounce(run, 50);
    const mo = new MutationObserver(reapply);
    mo.observe(tbody, { childList: true, subtree: true, characterData: true });
  }

  // Public API (optional)
  window.TimeFormat = {
    formatTimeString,
    formatTimeRange,
    normaliseCurfewTimesNow: run
  };

  // Initial run – do it after DOM is ready and once again after layout (for late insertions)
  function boot() {
    run();
    // a little belt-and-braces after initial layout churn
    requestAnimationFrame(run);
    setTimeout(run, 150);
    observeTable();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  // Re-run if your code announces a table refresh
  document.addEventListener('bh:curfew:table-updated', boot);
})();
