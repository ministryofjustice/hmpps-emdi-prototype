// /public/javascripts/duration-helper.js
(function () {
  'use strict';

  function parseTime12(str) {
    if (!str) return null;
    const s = String(str).trim().toLowerCase().replace(/\s+/g, '');
    const m = s.match(/^(\d{1,2}):(\d{2})(am|pm)$/);
    if (!m) return null;
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const ap = m[3]; // am|pm
    if (ap === 'am') {
      if (h === 12) h = 0;         // 12:xxam -> 00:xx
      // allow 00:xxam (non-standard) -> stays 00:xx
    } else {
      if (h !== 12) h += 12;        // add 12 for pm, except 12pm
    }
    return h * 60 + min;
  }

  function diffMinutes(startStr, endStr) {
    const a = parseTime12(startStr);
    const b = parseTime12(endStr);
    if (a == null || b == null) return null;
    let d = b - a;
    if (d < 0) d += 24 * 60;        // cross-midnight
    return d;
  }

  function formatHM(mins) {
    if (mins == null) return '';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `(${h} hours ${m} mins)`; // always plural per spec
  }

  // Public helper if you need it elsewhere
  window.DurationHelper = {
    parseTime12,
    diffMinutes,
    formatHM,
    computeDisplay(startStr, endStr) {
      const mins = diffMinutes(startStr, endStr);
      return { minutes: mins, display: formatHM(mins) };
    }
  };

  // Auto-apply:
  // 1) Elements with data-duration-start + data-duration-end
  // 2) Elements with data-duration-range="HH:MMam to HH:MMpm"
  function applyDurations() {
    // Mode 1
    document.querySelectorAll('[data-duration-start][data-duration-end]').forEach(el => {
      const start = el.getAttribute('data-duration-start');
      const end = el.getAttribute('data-duration-end');
      const mins = diffMinutes(start, end);
      const out = formatHM(mins);
      if (out) el.textContent = out;
      if (mins != null) {
        el.setAttribute('data-sort-value', String(mins));
        el.setAttribute('data-order', String(mins)); // for libs that use data-order
      }
    });

    // Mode 2
    document.querySelectorAll('[data-duration-range]').forEach(el => {
      const range = el.getAttribute('data-duration-range') || '';
      const parts = range.split(/\s+to\s+/i).map(s => s.trim());
      if (parts.length === 2) {
        const mins = diffMinutes(parts[0], parts[1]);
        const out = formatHM(mins);
        if (out) el.textContent = out;
        if (mins != null) {
          el.setAttribute('data-sort-value', String(mins));
          el.setAttribute('data-order', String(mins));
        }
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyDurations, { once: true });
  } else {
    applyDurations();
  }
})();
