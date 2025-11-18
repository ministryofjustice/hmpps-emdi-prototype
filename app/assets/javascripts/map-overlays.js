// /public/javascripts/map-overlays.js
(function () {
  'use strict';

  window.setupMapOverlays = function setupMapOverlays(opts) {
    const map = window.map;
    if (!map) return;

    const baseLayers = (opts && opts.baseLayers) || {};

    // Always-on
    const areas  = L.layerGroup().addTo(map);  // LOI polygons

    // Toggleable overlays
    const directionInfo = L.layerGroup().addTo(map); // track + arrows
    const accuracy      = L.layerGroup().addTo(map); // confidence circles
    const numbers       = L.layerGroup().addTo(map); // point numbers

    // Expose only the groups you need
    window.mapLayers = {
      directionInfo,
      accuracy,
      numbers,
      areas
    };

    // Layer control
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
