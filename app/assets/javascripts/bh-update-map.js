// /public/javascripts/bh-update-map.js
(function () {
  'use strict';

  // Small helpers
  function $(sel, root = document) { return root.querySelector(sel); }

  // Robust getter: supports plain inputs OR MOJ date-picker wrappers (reads inner input)
  function getStr(el) {
    if (!el) return '';
    if (typeof el.value === 'string') return el.value.trim();
    const inner = el.querySelector && el.querySelector('input');
    return (inner && typeof inner.value === 'string') ? inner.value.trim() : '';
  }

  // Expect gps-map.js to have set this:
  const SCENARIOS_URL = window.__BH_SCENARIOS_URL || '/public/data/gps-traces-bh-demo-nov01.json';

  // Parse dd/mm/yyyy -> { y, m, d } (numbers) and to iso yyyy-mm-dd
  function parseDMY(str) {
    const m = String(str || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
    if (!d || !mo || !y) return null;
    const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return { y, m: mo, d, iso };
  }

  // Build key like bh_YYYYMMDD
  function dayKey({ y, m, d }) {
    return `bh_${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
  }

  // HH:MM -> minutes since 00:00, clamp and normalise
  function hmToMinutes(hStr, mStr) {
    let h = parseInt(hStr, 10); if (isNaN(h)) h = 0;
    let m = parseInt(mStr, 10); if (isNaN(m)) m = 0;
    h = Math.max(0, Math.min(23, h));
    m = Math.max(0, Math.min(59, m));
    return h * 60 + m;
  }

  // Return minutes since midnight from various time formats
  function minutesFromIsoTime(raw) {
    if (!raw) return null;
    let s = String(raw);

    // Strip trailing 'Z'
    s = s.replace(/Z$/, '');

    // Turn "2025-11-01 09:15:00" into "2025-11-01T09:15:00"
    if (s.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/)) {
      s = s.replace(' ', 'T');
    }

    const d = new Date(s);
    if (isNaN(d.getTime())) {
      console.warn('[bh-update-map] Unparseable time:', raw);
      return null;
    }
    return d.getHours() * 60 + d.getMinutes();
  }

  // Parse a point's datetime into a Date object (for Billy multi-day range)
  function parsePointDate(raw) {
    if (!raw) return null;
    let s = String(raw);

    // Strip trailing 'Z'
    s = s.replace(/Z$/, '');

    // Turn "2025-11-01 09:15:00" into "2025-11-01T09:15:00"
    if (s.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/)) {
      s = s.replace(' ', 'T');
    }

    const d = new Date(s);
    if (isNaN(d.getTime())) {
      console.warn('[bh-update-map] Unparseable point datetime:', raw);
      return null;
    }
    return d;
  }

  // Filter points in [startMin..endMin], but if *nothing* parses, fall back
  function filterPointsByMinutes(points, startMin, endMin) {
    const src = points || [];
    let anyParsed = false;

    const out = src.filter((p, idx) => {
      const timeStr = p.time || p.timestamp || p.ts;
      const mins = minutesFromIsoTime(timeStr);

      if (mins != null) {
        anyParsed = true;
      }

      // log the first few, so we can see what's going on
      if (idx < 5) {
        console.log('[bh-update-map] sample point', {
          idx,
          timeStr,
          mins,
          startMin,
          endMin
        });
      }

      return mins != null && mins >= startMin && mins <= endMin;
    });

    if (!anyParsed) {
      console.warn('[bh-update-map] All point times failed to parse; returning unfiltered list.');
      return src;
    }

    console.log('[bh-update-map] filter result', {
      startMin,
      endMin,
      total: src.length,
      kept: out.length
    });

    return out;
  }

  // Fetch scenarios JSON (cache once)
  let cache = null;
  async function loadScenarios() {
    if (cache) return cache;

    console.log('[bh-update-map] fetching', SCENARIOS_URL);
    const res = await fetch(SCENARIOS_URL, { cache: 'no-store' });
    console.log('[bh-update-map] fetch status', res.status);

    const raw = await res.json();

    // Handle possible wrapper shapes: {days:{...}} or {scenarios:{...}}
    const data = raw.days || raw.scenarios || raw;

    const keys = Object.keys(data || {});
    console.log(
      '[bh-update-map] keys sample:',
      keys.slice(0, 10),
      '… total:', keys.length
    );

    cache = data;
    return cache;
  }

  // Join two days when range crosses midnight:
  function collectOverMidnight(pointsA, pointsB, startMin, endMin) {
    const partA = filterPointsByMinutes(pointsA, startMin, 23 * 60 + 59);
    const partB = filterPointsByMinutes(pointsB, 0, endMin);
    return partA.concat(partB);
  }

  function ddmmyyyy({ d, m, y }) {
    return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
  }

  document.addEventListener('DOMContentLoaded', function () {
    const form  = $('#bh-map-filters');
    const clear = $('#bh-clear-filters');
    if (form)  form.addEventListener('submit', onSubmit, false);
    if (clear) clear.addEventListener('click', onClear, false);
  });

  // Unified onSubmit: supports both Billy (from/to) and Penny (from + period)
  async function onSubmit(ev) {
    ev.preventDefault();

    const form = document.querySelector('#bh-map-filters');
    if (!form) return;

    // --- Detect mode ----------------------------------------------------
    // Penny: has a period select, no explicit TO date.
    // Billy: has a TO date picker (#bh-date-to).
    const periodEl =
      form.elements['periodHours'] ||
      form.querySelector('#bh-period') ||
      form.querySelector('#search-period');

    const dateToWrapper = form.querySelector('#bh-date-to');

    const isPenny = !!periodEl && !dateToWrapper;
    const isBilly = !!dateToWrapper;

    // --- Read FROM date -------------------------------------------------
    // On both pages, this is the MOJ date picker wrapper with id="bh-date-from".
    const fromDateWrapper = form.querySelector('#bh-date-from');
    const dateFromStr = getStr(fromDateWrapper); // uses your existing helper

    const fromParsed = parseDMY(dateFromStr);
    if (!fromParsed) {
      console.warn('[bh-update-map] invalid FROM date:', dateFromStr);
      return;
    }

    // --- Read FROM time -------------------------------------------------
    const fromHourStr = getStr(form.querySelector('#bh-time-from-hour')) || '0';
    const fromMinStr  = getStr(form.querySelector('#bh-time-from-min'))  || '0';

    const fromHour = Math.max(0, Math.min(23, parseInt(fromHourStr, 10) || 0));
    const fromMin  = Math.max(0, Math.min(59, parseInt(fromMinStr, 10)  || 0));

    const fromDate = new Date(
      fromParsed.y,
      fromParsed.m - 1,
      fromParsed.d,
      fromHour,
      fromMin,
      0,
      0
    );

    // --- Compute END date/time -----------------------------------------
    let endDate;
    let periodRaw = '';
    let periodHrs = 0;

    if (isPenny) {
      // Penny: derive end from period
      periodRaw = periodEl ? String(periodEl.value || '').trim() : '';
      periodHrs = Number(periodRaw || 6); // default 6
      endDate = new Date(fromDate.getTime() + periodHrs * 60 * 60 * 1000);
    } else if (isBilly) {
      // Billy: use explicit TO date/time
      const toDateWrapper = dateToWrapper;
      const dateToStr = getStr(toDateWrapper) || dateFromStr;
      const toParsed = parseDMY(dateToStr) || fromParsed;

      const toHourStr = getStr(form.querySelector('#bh-time-to-hour')) || fromHourStr;
      const toMinStr  = getStr(form.querySelector('#bh-time-to-min'))  || fromMinStr;

      const toHour = Math.max(0, Math.min(23, parseInt(toHourStr, 10) || 0));
      const toMin  = Math.max(0, Math.min(59, parseInt(toMinStr, 10)  || 0));

      endDate = new Date(
        toParsed.y,
        toParsed.m - 1,
        toParsed.d,
        toHour,
        toMin,
        0,
        0
      );
    } else {
      // Failsafe: treat like Penny with a 6h default window
      periodRaw = '';
      periodHrs = 6;
      endDate = new Date(fromDate.getTime() + periodHrs * 60 * 60 * 1000);
    }

    // --- Build calendar structs for dayKey ------------------------------
    function calFromDate(d) {
      return {
        y: d.getFullYear(),
        m: d.getMonth() + 1,
        d: d.getDate()
      };
    }

    const fromCal = calFromDate(fromDate);
    const toCal   = calFromDate(endDate);

    const keyFrom = dayKey(fromCal);
    const keyTo   = dayKey(toCal);

    const tFrom = fromDate.getHours() * 60 + fromDate.getMinutes();
    const tTo   = endDate.getHours() * 60 + endDate.getMinutes();

    // --- Load JSON + pull day slices -----------------------------------
    const all = await loadScenarios();
    const out = { points: [], areas: [] };

    // NEW: debug which keys we're using and whether they exist
    console.log('[bh-update-map] from/to keys:', keyFrom, keyTo, {
      hasFrom: !!all[keyFrom],
      hasTo: !!all[keyTo]
    });

    const dayFrom = all[keyFrom];
    const dayTo   = all[keyTo];

    console.log('[bh-update-map] from/to objects:', keyFrom, keyTo, {
      hasFrom: !!dayFrom,
      hasTo: !!dayTo
    });

    // New deep-dive debug
    (function () {
      const day = dayFrom || dayTo;
      if (!day) {
        console.log('[bh-update-map] no day object at all for these keys');
        return;
      }
      const pts = Array.isArray(day.points) ? day.points
                : Array.isArray(day)       ? day
                : [];
      console.log('[bh-update-map] day shape:', {
        isArray: Array.isArray(day),
        hasPointsProp: Array.isArray(day.points),
        pointsLength: pts.length,
        samplePoint: pts[0]
      });
    })();

    if (!dayFrom && !dayTo) {
      console.warn('[bh-update-map] no data for keys', keyFrom, keyTo);
      const outEmpty = { points: [], areas: [] };
      window.plotTraceObject(outEmpty, { scrollToMap: false, highlightRowEl: null });

      const msgNone = document.querySelector('#bh-filter-status');
      if (msgNone) {
        msgNone.textContent = `No data for ${ddmmyyyy(fromCal)}${
          keyFrom !== keyTo ? ' to ' + ddmmyyyy(toCal) : ''
        }.`;
      }
      return;
    }

    // Ensure safe arrays – support both { points: [...] } and plain arrays
    const ptsFrom = dayFrom
      ? (Array.isArray(dayFrom.points) ? dayFrom.points
        : Array.isArray(dayFrom)       ? dayFrom
        : [])
      : [];

    const ptsTo = dayTo
      ? (Array.isArray(dayTo.points) ? dayTo.points
        : Array.isArray(dayTo)       ? dayTo
        : [])
      : [];

    const sameDay =
      fromCal.y === toCal.y &&
      fromCal.m === toCal.m &&
      fromCal.d === toCal.d;

    // difference in whole days between FROM and TO (midnight-to-midnight)
    const startDayOnly = new Date(fromCal.y, fromCal.m - 1, fromCal.d);
    const endDayOnly   = new Date(toCal.y,   toCal.m   - 1, toCal.d);
    const dayDiff = Math.round(
      (endDayOnly.getTime() - startDayOnly.getTime()) / (24 * 60 * 60 * 1000)
    );

    // --- Build points ---------------------------------------------------
    if (sameDay) {
      // Simple case: just slice that single day
      const a = Math.min(tFrom, tTo);
      const b = Math.max(tFrom, tTo);
      out.points = filterPointsByMinutes(ptsFrom, a, b);
    } else if (isBilly && dayDiff > 1) {
      // BILLY MULTI-DAY RANGE (more than one full day) – include ALL days between
      console.log('[bh-update-map] Billy multi-day range, dayDiff=', dayDiff);

      const collected = [];
      const oneDayMs = 24 * 60 * 60 * 1000;
      let cursor = new Date(startDayOnly.getTime());

      while (cursor.getTime() <= endDayOnly.getTime()) {
        const cal = calFromDate(cursor);
        const key = dayKey(cal);
        const dayObj = all[key];

        if (dayObj) {
          const pts = Array.isArray(dayObj.points) ? dayObj.points
                    : Array.isArray(dayObj)       ? dayObj
                    : [];

          pts.forEach(p => {
            const dt = parsePointDate(p.time || p.timestamp || p.ts);
            if (!dt) {
              // If we can't parse, keep it so things don't silently vanish
              collected.push(p);
              return;
            }
            if (dt >= fromDate && dt <= endDate) {
              collected.push(p);
            }
          });
        }

        cursor = new Date(cursor.getTime() + oneDayMs);
      }

      out.points = collected;
    } else {
      // Crosses midnight but only between two neighbouring days – keep old behaviour
      out.points = collectOverMidnight(ptsFrom, ptsTo, tFrom, tTo);
    }

    // Areas: keep existing "prefer TO day, else FROM day" behaviour
    const areasOf = (src) => (src && Array.isArray(src.areas)) ? src.areas : [];
    out.areas = areasOf(dayTo).length ? areasOf(dayTo) : areasOf(dayFrom);

    // --- Plot WITHOUT scrolling for filter form submits ----------------
    window.plotTraceObject(out, {
      scrollToMap: false,          // <- stops jump for Update / +X hours
      highlightRowEl: null
    });

    // --- Status text ----------------------------------------------------
    const msg = document.querySelector('#bh-filter-status');
    if (msg) {
      const hhmm = (mins) =>
        `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

      const fromPretty = ddmmyyyy(fromCal);
      const toPretty   = ddmmyyyy(toCal);

      if (sameDay) {
        msg.textContent = `Showing ${out.points.length} point(s) from ${hhmm(tFrom)}–${hhmm(tTo)} on ${fromPretty}.`;
      } else {
        msg.textContent = `Showing ${out.points.length} point(s) from ${fromPretty} ${hhmm(tFrom)} to ${toPretty} ${hhmm(tTo)}.`;
      }
    }

    // Debug
    console.log('[bh-update-map]', {
      mode: isPenny ? 'penny' : (isBilly ? 'billy' : 'fallback'),
      fromDateStr: dateFromStr,
      fromHM: { h: fromHour, m: fromMin },
      periodRaw,
      periodHrs,
      fromKey: keyFrom,
      toKey: keyTo,
      dayDiff,
      points: out.points.length
    });
  }

  function onClear(ev) {
    ev.preventDefault();
    const form = $('#bh-map-filters');
    if (form) form.reset();

    // After clear, default back to the “latest 5 mins” mini-trace on scenarios
    const defaultKey = (window.CFG?.DEFAULT_SCENARIO_KEY) || 'bh_20251113';
    window.plotTrace(defaultKey, {
      scrollToMap: false,
      highlightRowEl: null,
      dataUrl: window.CFG?.SCENARIOS_URL || '/public/data/gps-traces-bh-demo-nov01.json'
    });

    const msg = $('#bh-filter-status');
    if (msg) msg.textContent = 'Filters cleared.';
  }
})();
