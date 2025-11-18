// pj-route-details.js
(function () {
  'use strict';

  // Reuse your PJ JSON
  async function ensureTraces() {
    if (window.GPS_TRACES) return;
    const res = await fetch('/public/data/gps-traces-pj.json', { cache: 'no-store' });
    window.GPS_TRACES = await res.json();
  }

  function setMessage(el, html, cls) {
    el.innerHTML = `<p class="${cls || 'govuk-hint'}">${html}</p>`;
  }

  async function onOpen(detailsEl) {
    if (detailsEl.dataset.loaded === '1') return; // load once

    const traceKey = detailsEl.getAttribute('data-trace');
    const target = detailsEl.querySelector('.route-target');
    if (!traceKey || !target) return;

    setMessage(target, 'Generating route…');

    try {
      await ensureTraces();
      if (!window.PJ_ROUTING) throw new Error('Routing module missing');
      await window.PJ_ROUTING.runRoutingForTraceKey(
        traceKey,
        target,
        (msg) => setMessage(target, msg || 'No route available.', 'govuk-hint')
      );
      detailsEl.dataset.loaded = '1';
    } catch (err) {
      console.error('[pj] details routing error', err);
      setMessage(target, 'Could not generate route just now.', 'govuk-error-message');
    }
  }

  // Progressive enhancement: load on first open
  function initDetails() {
    document.querySelectorAll('.route-details[data-trace]').forEach((d) => {
      d.addEventListener('toggle', () => {
        if (d.open) onOpen(d);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDetails, { once: true });
  } else {
    initDetails();
  }
})();
