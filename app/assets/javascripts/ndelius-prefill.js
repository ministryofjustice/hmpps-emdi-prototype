// /public/javascripts/ndelius-prefill.js
(function () {
  function getParam(name) {
    const u = new URL(window.location.href);
    return u.searchParams.get(name);
  }
  function parseDateStr(str) {
    if (!str) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      const [y, m, d] = str.split("-");
      return { day: d, month: m, year: y };
    }
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) {
      const [d, m, y] = str.split("/");
      return { day: d, month: m, year: y };
    }
    return null;
  }
  function setIf(el, val) { if (el && val != null) el.value = String(val); }

  document.addEventListener('DOMContentLoaded', function () {
    const trace  = getParam('trace');
    const qpDate = parseDateStr(getParam('date'));

    // Primary source: static lookup (built-in traces)
    const base = (trace && window.LOI_LOOKUP && window.LOI_LOOKUP[trace]) ? window.LOI_LOOKUP[trace] : {};

    // Fallback source: data-* on the Notes textarea (custom traces)
    const notesEl = document.getElementById('notes');
    const attr = (notesEl && notesEl.dataset) || {};

    // Prefer LOI_LOOKUP, else fall back to data-attrs, else blanks
    const address  = (Array.isArray(base.address) && base.address.length)
      ? base.address
      : ((attr.address || '').split('\n').filter(Boolean));

    const type     = base.type || attr.type || '';
    const duration = base.duration || attr.duration || '';

    // 1) Prefill Notes ONLY if empty (don’t overwrite user edits)
    if (notesEl && !notesEl.value) {
      const lines = []
        .concat(address)
        .concat(["", `Location type: ${type}`, "", `Duration: ${duration}`])
        .filter(line => line !== "Location type: " && line !== "Duration: ");
      notesEl.value = lines.join("\n");
    }

    // 2) Prefill Date
    setIf(document.getElementById('breach-date-day'),   qpDate ? String(qpDate.day).padStart(2,'0') : null);
    setIf(document.getElementById('breach-date-month'), qpDate ? String(qpDate.month).padStart(2,'0') : null);
    setIf(document.getElementById('breach-date-year'),  qpDate ? String(qpDate.year) : null);

    // 3) Prefill Time (if your LOI_LOOKUP has it)
    const time = base.time || null;
    setIf(document.getElementById('breach-hour'), time ? String(time.hour).padStart(2,'0') : null);
    setIf(document.getElementById('breach-min'),  time ? String(time.min).padStart(2,'0') : null);

    // 4) Keep selections when going to confirmation (unchanged)
    const btn = document.getElementById('send-to-ndelius-btn');
    if (btn) {
      btn.addEventListener('click', function (e) {
        const contactType    = (document.getElementById('contact-type') || {}).value || "";
        const licenceBreach  = (document.getElementById('licence-breach') || {}).value || "";
        const contactOutcome = (document.getElementById('contact-outcome') || {}).value || "";
        const alertVal = (document.querySelector('input[name="alert"]:checked') || {}).value || "";
        const visorVal = (document.querySelector('input[name="visor"]:checked') || {}).value || "";
        const sensVal  = (document.querySelector('input[name="sensitive"]:checked') || {}).value || "";

        const url = new URL(window.location.origin + '/ndelius-confirmation');
        const src = new URL(window.location.href);
        ['trace','date'].forEach(p => {
          const v = src.searchParams.get(p);
          if (v) url.searchParams.set(p, v);
        });

        if (contactType)    url.searchParams.set('contactType', contactType);
        if (licenceBreach)  url.searchParams.set('licenceBreach', licenceBreach);
        if (contactOutcome) url.searchParams.set('contactOutcome', contactOutcome);
        if (alertVal)       url.searchParams.set('alert', alertVal);
        if (visorVal)       url.searchParams.set('visor', visorVal);
        if (sensVal)        url.searchParams.set('sensitive', sensVal);

        e.preventDefault();
        window.location.href = url.toString();
      });
    }
  });
})();
