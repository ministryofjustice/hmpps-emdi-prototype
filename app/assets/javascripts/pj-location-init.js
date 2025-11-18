// /public/javascripts/pj-location-init.js
(function () {
  'use strict';

  let currentTraceKey = null;

  async function ensureTracesLoaded() {
    if (window.GPS_TRACES) return;
    const res = await fetch('/public/data/gps-traces-pj.json', { cache: 'no-store' });
    window.GPS_TRACES = await res.json();
  }

  // track which "View" link (data-trace) was last clicked
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('.plot-link');
    if (!a) return;
    const key = a.getAttribute('data-trace');
    if (key) currentTraceKey = key;
  });

  async function renderAccessible() {
    await ensureTracesLoaded();
    if (!window.PJ_ROUTING) return;
    const keys = Object.keys(window.GPS_TRACES || {});
    const key = currentTraceKey || (window.GPS_TRACES.home ? 'home' : keys[0]);
    if (!key) {
      listEl.innerHTML = '<li>No data available.</li>';
      return;
    }
    try {
      await window.PJ_ROUTING.runRoutingForTraceKey(key, listEl, (msg) => {
        listEl.innerHTML = `<li>${msg}</li>`;
      }, { drawOnMap: false });
      routeLive.textContent = 'Accessible table view ready.';
    } catch (err) {
      listEl.innerHTML = '<li>Could not generate route just now.</li>';
      routeLive.textContent = 'Routing failed.';
      console.error('[pj] routing error', err);
    }
  }

  // toggle view
  (function setupToggles(){
    const mapWrap = document.getElementById('map-wrap');
    const accWrap = document.getElementById('accessible-wrap');

    toAccBtn?.addEventListener('click', async (e) => {
      e.preventDefault();
      mapWrap.hidden = true;
      accWrap.hidden = false;
      await renderAccessible();
      toMapBtn?.focus({ preventScroll: true });
    });

    toMapBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      accWrap.hidden = true;
      mapWrap.hidden = false;
      // nudge Leaflet if present
      setTimeout(() => { if (window.map?.invalidateSize) window.map.invalidateSize(); }, 0);
      toAccBtn?.focus({ preventScroll: true });
    });

)();
})();
