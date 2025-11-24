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

    // Layer control (MoJ/GDS default position top-right)
    const overlays = {
      'Direction info': directionInfo,
      'Confidence circles': accuracy,
      'Point numbers': numbers
    };

    L.control.layers(baseLayers, overlays, {
      position: 'topright',
      collapsed: true
    }).addTo(map);
  };
})();
