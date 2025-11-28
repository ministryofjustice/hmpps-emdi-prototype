// /public/javascripts/map-overlays.js
(function () {
  'use strict';

  window.setupMapOverlays = function setupMapOverlays(opts) {
    const map = window.map;
    if (!map) return;

    const baseLayers = (opts && opts.baseLayers) || {};

    // Always-on LOI polygons
    const areas = L.layerGroup().addTo(map);

    // Toggleable overlays
    const directionInfo = L.layerGroup().addTo(map); // tracks + arrows
    const accuracy      = L.layerGroup().addTo(map); // confidence circles (big) + centre dots
    const numbers       = L.layerGroup();            // point numbers (off by default)

    // Expose for other scripts (gps-map.js, etc.)
    window.mapLayers = { areas, directionInfo, accuracy, numbers };

    // ---- Centre dot helper (no zoom gate; big circle stays in gps-map.js)
    function addConfidenceCircle(lat, lng /* radius not needed here */) {
      return L.circleMarker([lat, lng], {
        radius: 3,
        color: '#1d70b8',
        weight: 0,
        fillColor: '#1d70b8',
        fillOpacity: 1,
        interactive: false
      }).addTo(accuracy);
    }
    window.addConfidenceCircle = addConfidenceCircle;

    // ---- Layer control (MoJ/GDS default position top-right) ----
    const overlays = {
      'Direction info': directionInfo,
      'Confidence circles': accuracy,
      'Point numbers': numbers
    };

    // Start expanded (no default Leaflet "collapsed" behaviour)
    const layersControl = L.control.layers(baseLayers, overlays, {
      position: 'topright',
      collapsed: false
    }).addTo(map);

    // ---- Enhance it with our own open/close behaviour ----
    const container = layersControl.getContainer();
    if (!container) return;

    // Mark this as our panel so we can style/override old hover CSS
    container.classList.add('emdi-layers-panel');

    // Close “X” button inside the panel
    const closeBtn = L.DomUtil.create('button', 'emdi-layers-close', container);
    closeBtn.type = 'button';
    closeBtn.innerHTML = '×';
    closeBtn.setAttribute('title', 'Close layer controls');
    closeBtn.setAttribute('aria-label', 'Close layer controls');

    // Floating reopen button over the map
    // Use Leaflet's built-in layers icon sprite
    const mapContainer = map.getContainer();
    const opener = L.DomUtil.create(
      'a',
      'leaflet-control-layers-toggle emdi-layers-opener',
      mapContainer
    );
    opener.href = '#';
    opener.setAttribute('role', 'button');
    opener.setAttribute('aria-label', 'Show layer controls');

    // Start with the panel visible, opener hidden
    container.classList.remove('emdi-collapsed');
    opener.style.display = 'none';

    // Stop clicks on these buttons from bubbling to the map
    L.DomEvent.disableClickPropagation(closeBtn);
    L.DomEvent.disableClickPropagation(opener);

    closeBtn.onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();
      container.classList.add('emdi-collapsed');
      opener.style.display = 'block';
    };

    opener.onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();
      container.classList.remove('emdi-collapsed');
      opener.style.display = 'none';
    };
  };
})();
