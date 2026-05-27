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
    const pointDots     = L.layerGroup().addTo(map); // always-on centre dots
    const numbers       = L.layerGroup();            // point numbers (off by default)
    const heatmap       = L.layerGroup();            // dwell time heatmap (off by default)

    // Expose for other scripts (gps-map.js, etc.)
    window.mapLayers = { areas, directionInfo, accuracy, pointDots, numbers, heatmap };

    // ---- Centre dot helper (no zoom gate; big circle stays in gps-map.js)
    function getPointDotRadius(zoom) {
      const z = Number.isFinite(zoom) ? zoom : map.getZoom();
      if (z <= 6) return 4;
      if (z <= 9) return 5;
      if (z <= 12) return 6;
      return 7;
    }

    function updatePointDotRadii() {
      const radius = getPointDotRadius(map.getZoom());
      pointDots.eachLayer(function (layer) {
        if (layer && typeof layer.setRadius === 'function') {
          layer.setRadius(radius);
        }
      });
    }

    map.on('zoomend', updatePointDotRadii);

    function addConfidenceCircle(lat, lng /* radius not needed here */) {
      return L.circleMarker([lat, lng], {
        radius: getPointDotRadius(map.getZoom()),
        color: '#1d70b8',
        weight: 0,
        fillColor: '#1d70b8',
        fillOpacity: 1,
        interactive: false
      }).addTo(pointDots);
    }
    window.addConfidenceCircle = addConfidenceCircle;

    // ---- Dwell time heatmap helper ----
    // Converts GPS points into heatmap data weighted by time spent at each location
    // Points with longer gaps to the next point get higher intensity
    function createDwellHeatmapData(points) {
      if (!Array.isArray(points) || points.length < 2) return [];
      
      const heatData = [];
      const maxTimeGap = Math.max(
        ...points.slice(0, -1).map((p, i) => {
          const nextTime = new Date(points[i + 1].time);
          const currTime = new Date(p.time);
          return (nextTime - currTime) / 60000; // gap in minutes
        })
      );
      
      // Create heatmap entries: [lat, lng, intensity (0-1)]
      points.slice(0, -1).forEach((p, i) => {
        const nextTime = new Date(points[i + 1].time);
        const currTime = new Date(p.time);
        const gapMinutes = (nextTime - currTime) / 60000;
        const intensity = maxTimeGap > 0 ? gapMinutes / maxTimeGap : 0;
        
        if (intensity > 0) {
          heatData.push([p.lat, p.lng, intensity]);
        }
      });
      
      return heatData;
    }
    window.createDwellHeatmapData = createDwellHeatmapData;

    // Add heatmap layer to the map when data is provided
    function addHeatmapLayer(heatData) {
      heatmap.clearLayers();
      if (!heatData || heatData.length === 0) return;
      
      if (typeof L.heatLayer === 'function') {
        const heat = L.heatLayer(heatData, {
          radius: 40,
          blur: 25,
          maxZoom: 17,
          minOpacity: 0.3,
          gradient: {
            0.0: '#0000ff',
            0.25: '#00ffff',
            0.5: '#00ff00',
            0.75: '#ffff00',
            1.0: '#ff0000'
          }
        }).addTo(heatmap);
      }
    }
    window.addHeatmapLayer = addHeatmapLayer;

    const overlays = {
      'Direction of travel': directionInfo,
      'Location accuracy': accuracy,
      'Point numbers': numbers,
      'Heatmap': heatmap
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
