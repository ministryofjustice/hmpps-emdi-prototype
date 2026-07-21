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
    const exclusionZone = L.layerGroup();            // exclusion zone (off by default)

    // Expose for other scripts (gps-map.js, etc.)
    window.mapLayers = { areas, directionInfo, accuracy, pointDots, numbers, heatmap, exclusionZone };

    // ---- Centre dot helper (no zoom gate; big circle stays in gps-map.js)
    function getPointDotRadius(zoom) {
      const z = Number.isFinite(zoom) ? zoom : map.getZoom();
      if (z <= 6) return 3;
      if (z <= 9) return 4;
      if (z <= 12) return 5;
      return 6;
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

    // ---- Exclusion zone helper ----
    // Creates an exclusion zone polygon around St James Park
    function addExclusionZone(polygonCoordinates) {
      exclusionZone.clearLayers();
      
      // Add the exclusion zone polygon
      const polygon = L.polygon(polygonCoordinates, {
        className: 'emdi-exclusion-zone-path',
        color: '#D32F2F',
        weight: 0,
        opacity: 0.9,
        fillColor: '#D32F2F',
        fillOpacity: 0.35,
        interactive: true
      });
      
      polygon.bindPopup('Exclusion Zone<br/>St James Park, Westminster<br/>SW1A 2BJ');
      
      exclusionZone.addLayer(polygon);
    }
    window.addExclusionZone = addExclusionZone;

    // St James Park boundary coordinates (precise polygon using provided coordinates)
    const stJamesParkBoundary = [
      // West Edge (Spur Road Curve)
      [51.50020, -0.14120],  // 1. South-West corner (Birdcage Walk & Buckingham Gate junction)
      [51.50065, -0.14155],  // 2. Spur Road curve heading north past Wellington Barracks
      [51.50115, -0.14190],  // 3. Spur Road midpoint, directly facing the Victoria Memorial
      [51.50155, -0.14185],  // 4. Spur Road northern curve approaching the Queen's Gardens
      [51.50195, -0.14155],  // 5. North-West corner where Spur Road meets The Mall
      
      // North Edge (The Mall)
      [51.50220, -0.14100],  // 1. Western section of The Mall, near St James's Park path crossing
      [51.50240, -0.13950],  // 2. Moving east along the central carriageway
      [51.50260, -0.13800],  // 3. Parallel to the lake’s western end (center of road)
      [51.50280, -0.13650],  // 4. Opposite Marlborough House (mid-road)
      [51.50300, -0.13500],  // 5. Passing north access path toward Blue Bridge
      [51.50320, -0.13350],  // 6. Central Mall stretch alongside open parkland
      [51.50340, -0.13200],  // 7. Opposite Duke of York Column (centerline)
      [51.50360, -0.13050],  // 8. Approaching Admiralty Arch from the west
      [51.50380, -0.12940],  // 9. Final stretch before Horse Guards Road junction
      [51.50395, -0.12890],   // 10. Junction with Horse Guards Road near Admiralty Arch

      // East Edge (Horse Guards Road)
      [51.50370, -0.12945],  // 14. Horse Guards Road, directly outside the Old Admiralty Building
      [51.50315, -0.12930],  // 15. Horse Guards Road, tracing the edge of Horse Guards Parade
      [51.50260, -0.12920],  // 16. Horse Guards Road, passing Kent's Treasury Building
      [51.50205, -0.12905],  // 17. Horse Guards Road, directly opposite the King Charles Street steps
      [51.50150, -0.12890],  // 18. Horse Guards Road, running outside the Churchill War Rooms
      [51.50110, -0.12870],  // 19. South-East corner where Horse Guards Road joins Birdcage Walk
      // South Edge (Birdcage Walk)
      [51.50100, -0.12980],  // 20. Birdcage Walk pavement, tracking outside HM Treasury
      [51.50085, -0.13150],  // 21. Birdcage Walk, opposite the Storey's Gate cafe entrance
      [51.50070, -0.13300],  // 22. Birdcage Walk, just past the Cockpit Steps path
      [51.50055, -0.13450],  // 23. Birdcage Walk, running opposite the Queen Anne's Gate area
      [51.50040, -0.13600],  // 24. Birdcage Walk, passing the playground and Wellington Barracks
      [51.50025, -0.13750],  // 25. Birdcage Walk, directly opposite the Guards Chapel
      [51.50015, -0.13920],  // 26. Birdcage Walk, heading west past the final cluster of park trees
      [51.50020, -0.14120]   // 27. Re-entering the South-West corner to close the boundary loop
    ];

    // Add the exclusion zone for St James Park
    addExclusionZone(stJamesParkBoundary);

    const overlays = {
      'Direction of travel': directionInfo,
      'Location accuracy': accuracy,
      'Point numbers': numbers,
      'Heatmap': heatmap,
      'Exclusion zone': exclusionZone
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
