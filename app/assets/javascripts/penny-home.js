// /public/javascripts/penny-home.js
(function () {
  'use strict';

  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else { fn(); }
  }
  function $(sel, root = document) { return root.querySelector(sel); }
  function $all(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

  // Parse "9:33pm" -> minutes since 00:00 (0..1439)
  function parseClockToMinutes(s) {
    if (!s || typeof s !== 'string') return NaN;
    const m = s.trim().match(/^(\d{1,2}):(\d{2})\s*([ap]m)$/i);
    if (!m) return NaN;
    let hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    const ap = m[3].toLowerCase();
    if (hh === 12) hh = 0;
    let mins = hh * 60 + mm;
    if (ap === 'pm') mins += 12 * 60;
    return mins;
  }

  // Does "9:33pm to 10:42pm" intersect the overnight window 19:00–07:00 (wraps midnight)?
  function intersectsOvernightWindow(timeText) {
    if (!timeText) return false;
    const m = String(timeText).match(/(\d{1,2}:\d{2}\s*[ap]m)\s*to\s*(\d{1,2}:\d{2}\s*[ap]m)/i);
    if (!m) return false;
    const start = parseClockToMinutes(m[1]);
    const end   = parseClockToMinutes(m[2]);
    if (isNaN(start) || isNaN(end)) return false;

    const WIN_START = 19 * 60; // 19:00
    const WIN_END   = 7 * 60;  // 07:00 (next day)

    function expand(start, end) {
      return (end >= start) ? [[start, end]] : [[start, 1440], [0, end]];
    }
    const A = expand(start, end);
    const B = expand(WIN_START, WIN_END);
    for (const [xs, xe] of A) for (const [ys, ye] of B) {
      if (xs < ye && ys < xe) return true;
    }
    return false;
  }

  // "Wednesday 3 September<br/>2025" -> "2025-09-03"
  function dateCellToIsoKey(cell) {
    if (!cell) return null;
    const txt = cell.innerHTML.replace(/<br\s*\/?>/gi, ' ').replace(/<\/?[^>]+>/g, '').trim();
    const m = txt.match(/^\w+\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
    if (!m) return null;
    const day = String(parseInt(m[1], 10)).padStart(2, '0');
    const monthName = m[2].toLowerCase();
    const year = m[3];
    const months = {
      january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
      july: '07', august: '08', september: '09', october: '10', november: '11', december: '12'
    };
    const mm = months[monthName];
    if (!mm) return null;
    return `${year}-${mm}-${day}`;
  }

  // Build a map { isoDate: boolean } indicating home-present overnight
  function computeOvernightComplianceFromTable() {
    const table = $('#bh-loi-table');
    if (!table) return new Map();
    const rows = $all('tbody tr', table);
    const map = new Map(); // isoDate -> boolean

    rows.forEach(tr => {
      const tds = tr.querySelectorAll('td');
      if (tds.length < 4) return;
      const dateIso = dateCellToIsoKey(tds[0]);
      if (!dateIso) return;

      const locType = tds[1]?.textContent?.toLowerCase().trim() || '';
      const isHome  = locType === 'home';

      const timeHTML = tds[3]?.innerHTML || '';
      const timeText = timeHTML.replace(/<br\s*\/?>/gi, ' ').replace(/<\/?[^>]+>/g, '').trim();

      if (!map.has(dateIso)) map.set(dateIso, false);
      if (isHome && intersectsOvernightWindow(timeText)) {
        map.set(dateIso, true);
      }
    });

    return map;
  }

// Render two rows of 7 nights (total 14): top = older week, bottom = last week.
// Each cell shows the overnight span "Fri 22–Sat 23 Aug" (19:00→07:00).
// If the span ends today, we append " (Today)". Returns { totalYes }.
// Uses fixed 3-letter months (Jan, Feb, Mar, Apr, May, Jun, Jul, Aug, Sep, Oct, Nov, Dec).
function renderTwoWeekStreak(container, complianceMap) {
  if (!container) return { totalYes: 0 };

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Build end-dates from (today - 13) … to … (today)
  const items = [];
  for (let back = 13; back >= 0; back--) {
    const end = new Date(today);
    end.setDate(today.getDate() - back); // morning date (07:00)
    const start = new Date(end);
    start.setDate(end.getDate() - 1);    // previous evening date (19:00)

    const endIso = `${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,'0')}-${String(end.getDate()).padStart(2,'0')}`;

    // ok: true = at home; false = not at home; undefined = no data
    let ok = complianceMap.has(endIso) ? !!complianceMap.get(endIso) : undefined;
    items.push({ start, end, endIso, ok });
  }

  const week1 = items.slice(0, 7);   // older week
  const week2 = items.slice(7, 14);  // last week (latest at rightmost)

  // Demo shaping: ensure week2 has at least 1 red (only if none present)
  const redsInWeek2 = week2.reduce((n, it) => n + (it.ok === false ? 1 : 0), 0);
  if (redsInWeek2 === 0) {
    week2[3].ok = false; // middle-ish cell
  }

  // Final state per day (treat undefined as green for the demo)
  const allDays = [...week1, ...week2].map(it => ({
    start: it.start,
    end: it.end,
    state: (it.ok === false) ? 'no' : 'yes'
  }));
  const totalYes = allDays.reduce((n, it) => n + (it.state === 'yes' ? 1 : 0), 0);

  // Formatters (force 3-letter months)
  function wdShort(d) { return d.toLocaleDateString('en-GB', { weekday: 'short' }); } // Fri
  function wdLong(d)  { return d.toLocaleDateString('en-GB', { weekday: 'long'  }); } // Friday
  function dayNum(d)  { return d.getDate(); }
  function mon3(d)    { return MONTHS[d.getMonth()]; }

  // Compact range label: "Fri 22–Sat 23 Aug" (or include both months if needed); "(Today)" if end is today
  // Compact range label: use end month only when months differ
function rangeLabel(start, end) {
  const endsToday = end.getFullYear() === today.getFullYear()
    && end.getMonth() === today.getMonth()
    && end.getDate() === today.getDate();

  const sWD = wdShort(start); const eWD = wdShort(end);
  const sD  = dayNum(start);  const eD  = dayNum(end);
  const sM  = mon3(start);    const eM  = mon3(end);

  // If month changes across the night, show ONLY the end month (e.g. "Sun 31–Mon 1 Sep")
  const monthPart = (sM === eM) ? ` ${eM}` : ` ${eM}`;
  const base = `${sWD} ${sD}–${eWD} ${eD}${monthPart}`;

  return endsToday ? `${base} (Today)` : base;
}

  // Helper to render one 7-day row
  function renderRow(days) {
    const row = document.createElement('div');
    row.className = 'app-streak';
    days.forEach(({ start, end, state }) => {
      const item = document.createElement('div');
      item.className = 'app-streak__item';

      const bar = document.createElement('div');
      bar.className = `app-streak__bar app-streak__bar--${state}`;

      // Titles/ARIA with fixed 3-letter months too
      const startTitle = `${wdShort(start)} ${dayNum(start)} ${mon3(start)}`;
      const endTitle   = `${wdShort(end)} ${dayNum(end)} ${mon3(end)}`;
      const startFull  = `${wdLong(start)} ${dayNum(start)} ${mon3(start)} ${start.getFullYear()}`;
      const endFull    = `${wdLong(end)} ${dayNum(end)} ${mon3(end)} ${end.getFullYear()}`;

      bar.setAttribute('title',
        `Overnight 19:00 ${startTitle} → 07:00 ${endTitle} — ${state === 'yes' ? 'at home' : 'not at home'}`
      );
      bar.setAttribute('aria-label',
        `Overnight 19:00 ${startFull} → 07:00 ${endFull} — ${state === 'yes' ? 'at home' : 'not at home'}`
      );

      const label = document.createElement('div');
      label.className = 'app-streak__label';
      label.textContent = rangeLabel(start, end);

      item.appendChild(bar);
      item.appendChild(label);
      row.appendChild(item);
    });
    return row;
  }

  // Build wrapper with two rows
  const wrap = document.createElement('div');
  wrap.className = 'app-streak-2w';

  const week1WithState = allDays.slice(0, 7);
  const week2WithState = allDays.slice(7, 14);

  wrap.appendChild(renderRow(week1WithState));
  wrap.appendChild(renderRow(week2WithState));

  container.innerHTML = '';
  container.appendChild(wrap);

  return { totalYes };
}

//END renderTwoWeekStreak



  // Count consecutive yeses starting from yesterday backwards
  function countConsecutiveYes(complianceMap) {
    const now = new Date();
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    base.setDate(base.getDate() - 1);

    let count = 0;
    for (let i = 0; i < 120; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() - i);
      const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      if (complianceMap.get(iso)) count++;
      else break;
    }
    return count;
  }

  function findMostRecentNo(complianceMap) {
    const now = new Date();
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    base.setDate(base.getDate() - 1);

    for (let i = 0; i < 365; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() - i);
      const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      if (complianceMap.has(iso) && !complianceMap.get(iso)) {
        return d;
      }
    }
    return null;
  }

  onReady(function () {
    // Build compliance from the current LOI table
    const complianceMap = computeOvernightComplianceFromTable();

    // Render two-week streak graph and get totals
const res = renderTwoWeekStreak($('#home-overnight-streak'), complianceMap);

// New summary: total compliances over the last 14 nights
const summary = $('#home-overnight-summary');
if (summary) {
  summary.innerHTML =
    `Penny <strong>remained at home overnight</strong> for <strong>${res.totalYes}</strong> nights in the past two weeks.`;
}

  });
})();
