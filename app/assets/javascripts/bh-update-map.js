// /public/javascripts/bh-update-map.js
(function () {
  'use strict';

  // Small helpers
  function $(sel, root = document) { return root.querySelector(sel); }
  function getStr(el) { return (el && typeof el.value === 'string') ? el.value.trim() : ''; }

  // Expect gps-map.js to have set this:
  const SCENARIOS_URL = window.__BH_SCENARIOS_URL || '/public/data/gps-traces-bh-demo.json';

  // Parse dd/mm/yyyy -> { y, m, d } (numbers) and to iso yyyy-mm-dd
  function parseDMY(str) {
    // Accept 1/9/2025 or 01/09/2025 etc.
    const m = String(str || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
    if (!d || !mo || !y) return null;
    const iso = `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    return { y, m: mo, d, iso };
  }

  // Build key like bh_YYYYMMDD
  function dayKey({ y, m, d }) {
    return `bh_${y}${String(m).padStart(2,'0')}${String(d).padStart(2,'0')}`;
  }

  // HH:MM -> minutes since 00:00, clamp and normalise
  function hmToMinutes(hStr, mStr) {
    let h = parseInt(hStr, 10); if (isNaN(h)) h = 0;
    let m = parseInt(mStr, 10); if (isNaN(m)) m = 0;
    h = Math.max(0, Math.min(23, h));
    m = Math.max(0, Math.min(59, m));
    return h * 60 + m;
  }

  // Return minutes since midnight from ISO string
  function minutesFromIsoTime(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return d.getHours() * 60 + d.getMinutes();
  }

  // Fetch scenarios JSON (cache once)
  let cache = null;
  async function loadScenarios() {
    if (cache) return cache;
    const res = await fetch(SCENARIOS_URL, { cache: 'no-store' });
    cache = await res.json();
    return cache;
  }

  // Filter points in [startMin..endMin] (inclusive), given they’re all on the same day
  function filterPointsByMinutes(points, startMin, endMin) {
    return (points || []).filter(p => {
      const mins = minutesFromIsoTime(p.time);
      return mins != null && mins >= startMin && mins <= endMin;
    });
  }

  // Join two days when range crosses midnight:
  // Day A: from startMin .. 23:59, Day B: from 00:00 .. endMin
  function collectOverMidnight(pointsA, pointsB, startMin, endMin) {
    const partA = filterPointsByMinutes(pointsA, startMin, 23*60 + 59);
    const partB = filterPointsByMinutes(pointsB, 0, endMin);
    return partA.concat(partB);
  }

  function ddmmyyyy({ d, m, y }) {
    return `${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y}`;
  }

  async function onSubmit(ev) {
    ev.preventDefault();

    // Inputs
    const dateFromStr = getStr($('#bh-date-from'));
    const dateToStr   = getStr($('#bh-date-to'));

    const from = parseDMY(dateFromStr);
    const to   = parseDMY(dateToStr || dateFromStr); // default to same-day if empty

    if (!from || !to) {
      console.warn('[bh-update-map] invalid dates', { dateFromStr, dateToStr });
      return;
    }

    const tFrom = hmToMinutes(getStr($('#bh-time-from-hour')), getStr($('#bh-time-from-min')));
    const tTo   = hmToMinutes(getStr($('#bh-time-to-hour')),   getStr($('#bh-time-to-min')));

    // Load scenarios data
    const all = await loadScenarios();

    // Prepare output trace skeleton
    const out = { points: [], areas: [] };

    // Calculate day keys
    const keyFrom = dayKey(from);
    const keyTo   = dayKey(to);

    const dayFrom = all[keyFrom];
    const dayTo   = all[keyTo];

    if (!dayFrom && !dayTo) {
      // Nothing to show
      window.plotTraceObject(out, { scrollToMap: true });
      const msg = $('#bh-filter-status');
      if (msg) msg.textContent = `No data for ${ddmmyyyy(from)}${keyFrom !== keyTo ? ' to ' + ddmmyyyy(to) : ''}.`;
      return;
    }

    // Ensure safe arrays
    const ptsFrom = (dayFrom && Array.isArray(dayFrom.points)) ? dayFrom.points : [];
    const ptsTo   = (dayTo   && Array.isArray(dayTo.points))   ? dayTo.points   : [];

    // Same calendar day?
    const sameDay = (from.y === to.y && from.m === to.m && from.d === to.d);

    if (sameDay) {
      if (tFrom <= tTo) {
        out.points = filterPointsByMinutes(ptsFrom, tFrom, tTo);
      } else {
        // Over-midnight within same “selected day” doesn’t make sense,
        // so if user flipped times, just swap them.
        out.points = filterPointsByMinutes(ptsFrom, tTo, tFrom);
      }
    } else {
      // Cross-day range. We only support spanning two consecutive days (as per prototype need).
      // If user picked a wider span, we’ll still take the two endpoints.
      out.points = collectOverMidnight(ptsFrom, ptsTo, tFrom, tTo);
    }

    // If either day has an area outline we want to show, prefer the “to” day’s area first,
    // otherwise fall back to the “from” day’s area (purely for visual context).
    const pickAreas = (src) => {
      if (!src || !Array.isArray(src.areas)) return [];
      return src.areas;
    };
    out.areas = pickAreas(dayTo).length ? pickAreas(dayTo) : pickAreas(dayFrom);

    // Plot without row highlight
    window.plotTraceObject(out, { scrollToMap: true, highlightRowEl: null });

    // Status text
    const msg = $('#bh-filter-status');
    if (msg) {
      const times = `${String(Math.floor(tFrom/60)).padStart(2,'0')}:${String(tFrom%60).padStart(2,'0')}–${String(Math.floor(tTo/60)).padStart(2,'0')}:${String(tTo%60).padStart(2,'0')}`;
      msg.textContent = sameDay
        ? `Showing ${out.points.length} point(s) from ${times} on ${ddmmyyyy(from)}.`
        : `Showing ${out.points.length} point(s) from ${ddmmyyyy(from)} ${times.split('–')[0]} to ${ddmmyyyy(to)} ${times.split('–')[1]}.`;
    }
  }

  function onClear(ev) {
    ev.preventDefault();
    const form = $('#bh-map-filters');
    if (form) form.reset();
    // After clear, default back to the “latest 5 mins” mini-trace on scenarios
    // (no highlight, no scroll)
    window.plotTrace('bh_20250903', {
      scrollToMap: false,
      highlightRowEl: null,
      dataUrl: SCENARIOS_URL
    });
    const msg = $('#bh-filter-status');
    if (msg) msg.textContent = 'Filters cleared.';
  }

  document.addEventListener('DOMContentLoaded', function () {
    const form  = $('#bh-map-filters');
    const clear = $('#bh-clear-filters');
    if (form)  form.addEventListener('submit', onSubmit);
    if (clear) clear.addEventListener('click', onClear);
  });
})();
