// /public/javascripts/bh-location-init.js
// Initialise Leaflet with Street as default, provide Satellite, and layer in a11y enhancements.
(function () {
  'use strict';

  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else { fn(); }
  }

  onReady(function () {
    // 1) Create the map
    window.map = L.map('map').setView([51.889, 0.903], 13);

    // 2) Define base layers
    const streetLayer = L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }
    );

    const satelliteLayer = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        maxZoom: 19,
        attribution:
          'Tiles &copy; Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
      }
    );

    // 3) Make STREET the default (we’ll possibly swap immediately based on saved preference)
    streetLayer.addTo(window.map);

    // 3a) Expose layers globally for other scripts
    window.streetLayer = streetLayer;
    window.satelliteLayer = satelliteLayer;

    // 4) Register base layers with your overlay control if present
    if (typeof window.setupMapOverlays === 'function') {
      window.setupMapOverlays({
        baseLayers: { Street: streetLayer, Satellite: satelliteLayer }
      });
    } else {
      L.control.layers({ Street: streetLayer, Satellite: satelliteLayer }, {}, {
        position: 'topright', collapsed: true
      }).addTo(window.map);
    }

    // 5) Restore previously chosen base (Street/Satellite)
    try {
      const last = (localStorage.getItem('loi-base') || 'street').toLowerCase();
      const wanted = (last === 'satellite') ? satelliteLayer : streetLayer;
      if (wanted && !window.map.hasLayer(wanted)) wanted.addTo(window.map);
      window.map.on('baselayerchange', (e) => {
        if (e && e.name) localStorage.setItem('loi-base', e.name.toLowerCase());
      });
    } catch (e) {
      console.warn('[init] base layer persistence skipped:', e);
    }

    // 6) Ensure polygons sit above lines but below tooltips/popups (for easy click + logging)
    if (!window.map.getPane('loi-areas')) {
      const pane = window.map.createPane('loi-areas');
      // Leaflet defaults: overlayPane=400, markerPane=600, tooltip=650, popup=700
      pane.style.zIndex = 645; // just under tooltip
    }

    // 7) Tiny wayfinding: North arrow (non-interfering)
    (function addNorthArrow() {
      const compass = L.control({ position: 'topleft' });
      compass.onAdd = function () {
        const bar = L.DomUtil.create('div', 'leaflet-bar');
        const a = L.DomUtil.create('a', '', bar);
        a.href = '#';
        a.title = 'North';
        a.setAttribute('aria-label', 'North arrow');
        a.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><polygon points="12,3 20,21 12,16 4,21" /></svg>';
        L.DomEvent.on(a, 'click', (e) => L.DomEvent.stop(e));
        return bar;
      };
      compass.addTo(window.map);
    })();

    // 8) Accessibility: treat popups as lightweight dialogs, move focus in, restore on close,
    //    and announce opens in the existing live region (#map-status).
    const live = document.getElementById('map-status');
    function announce(msg) { if (live) live.textContent = msg; }

    let lastTrigger = null;
    // Remember the element that opened the popup (e.g. a "View" link in the table)
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a.plot-link, a[data-trace]');
      if (link) lastTrigger = link;
    }, true);

    window.map.on('popupopen', (e) => {
      const container = e.popup?.getElement?.();
      if (!container) return;

      // Role + non-modal dialog semantics (keyboard & SR friendly)
      container.setAttribute('role', 'dialog');
      container.setAttribute('aria-modal', 'false');

      // Focus the first heading; fall back to the close button
      const heading = container.querySelector('h1,h2,h3,.govuk-heading-xl,.govuk-heading-l,.govuk-heading-m,.govuk-heading-s');
      if (heading) {
        heading.setAttribute('tabindex', '-1');
        heading.focus();
      } else {
        const close = container.querySelector('.leaflet-popup-close-button');
        if (close) close.focus();
      }

      // Announce to SRs (try to grab a readable LOI name from the popup)
      const name = container.querySelector('[data-loi-name]')?.textContent?.trim();
      announce(name ? `Showing details for ${name} on the map.` : 'Showing location details on the map.');
    });

    window.map.on('popupclose', () => {
      if (lastTrigger && document.contains(lastTrigger)) {
        lastTrigger.focus();
      }
      announce('Map popup closed.');
    });

    // 9) Safety: ensure sizing if container was hidden initially
    setTimeout(() => {
      if (window.map && typeof window.map.invalidateSize === 'function') {
        window.map.invalidateSize();
      }
    }, 0);

// --- announce readiness for other scripts (after all deferred scripts have run)
requestAnimationFrame(() => {
  window.BH = window.BH || {};
  window.BH.mapReady = true;

  // Newer canonical event
  document.dispatchEvent(new CustomEvent('bh:map-ready', { detail: { when: Date.now() } }));

  // Back-compat with older listeners
  document.dispatchEvent(new CustomEvent('bh:map:ready', { detail: { when: Date.now() } }));
});

  });
})();