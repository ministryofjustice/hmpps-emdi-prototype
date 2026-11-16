// Location activity map using Leaflet
(function () {
  'use strict';

  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else { fn(); }
  }

  function isFiniteCoord(value) {
    return typeof value === 'number' && isFinite(value);
  }

  function extractPointsFromTrace(payload) {
    // Payload is an object where keys are trace identifiers and values are trace objects
    // Each trace object has a 'points' array with {lat, lng, time, ...}
    const points = [];
    let pointIndex = 0;

    for (const traceKey in payload) {
      if (payload.hasOwnProperty(traceKey) && payload[traceKey].points) {
        const tracePoints = payload[traceKey].points;
        tracePoints.forEach(pt => {
          if (isFiniteCoord(pt.lat) && isFiniteCoord(pt.lng)) {
            points.push({
              index: pointIndex++,
              lat: pt.lat,
              lng: pt.lng,
              time: pt.time || ''
            });
          }
        });
      }
    }

    return points;
  }

  onReady(function () {
    // Get status element
    const status = document.getElementById('map-status');
    const applyButton = document.getElementById('bh-apply-filters');
    const clearButton = document.getElementById('bh-clear-filters');

    // Create map centered on UK with initial zoom
    const map = L.map('map').setView([54.5, -3.5], 5);
    map.options.minZoom = 3;
    map.options.maxZoom = 20;

    // Add OSM tile layer
    L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }
    ).addTo(map);

    // Create a feature group to hold points
    const pointsLayer = L.featureGroup().addTo(map);

    // Setup zoom buttons
    const zoomInBtn = document.getElementById('ol-zoom-in');
    const zoomOutBtn = document.getElementById('ol-zoom-out');
    const zoomResetBtn = document.getElementById('ol-zoom-reset');

    if (zoomInBtn) {
      zoomInBtn.addEventListener('click', function (e) {
        e.preventDefault();
        map.zoomIn();
      });
    }

    if (zoomOutBtn) {
      zoomOutBtn.addEventListener('click', function (e) {
        e.preventDefault();
        map.zoomOut();
      });
    }

    if (zoomResetBtn) {
      zoomResetBtn.addEventListener('click', function (e) {
        e.preventDefault();
        map.setView([54.5, -3.5], 5);
      });
    }

    // Load map data function
    function loadMapData() {
      pointsLayer.clearLayers();
      if (status) { status.textContent = 'Loading map data...'; }

      fetch('/public/data/gps-traces-bh-demo-nov03.json', { cache: 'no-store' })
        .then(response => {
          if (!response.ok) throw new Error('Unable to load map data.');
          return response.json();
        })
        .then(payload => {
          const points = extractPointsFromTrace(payload);
          
          points.forEach(pt => {
            const marker = L.circleMarker([pt.lat, pt.lng], {
              radius: 4,
              fillColor: '#0000ff',
              color: '#ffffff',
              weight: 1,
              opacity: 1,
              fillOpacity: 0.8
            }).bindPopup(`Lat: ${pt.lat.toFixed(4)}<br>Lng: ${pt.lng.toFixed(4)}<br>Time: ${pt.time}`);
            
            pointsLayer.addLayer(marker);
          });

          if (status) {
            status.textContent = points.length 
              ? points.length + ' points loaded.'
              : 'No points available.';
          }
        })
        .catch(err => {
          if (status) { status.textContent = 'Error: ' + err.message; }
        });
    }

    // Attach load data to apply filters button
    if (applyButton) {
      applyButton.addEventListener('click', function (e) {
        e.preventDefault();
        loadMapData();
      });
    }

    // Clear filters function
    function clearFilters() {
      const fromContainer = document.getElementById('bh-date-from');
      const toContainer = document.getElementById('bh-date-to');

      if (fromContainer) {
        const inputs = fromContainer.querySelectorAll('input[type="text"]');
        inputs.forEach(input => input.value = '');
      }

      if (toContainer) {
        const inputs = toContainer.querySelectorAll('input[type="text"]');
        inputs.forEach(input => input.value = '');
      }

      // Clear time inputs if they exist
      const timeFromHour = document.getElementById('bh-time-from-hour');
      const timeFromMin = document.getElementById('bh-time-from-min');
      const timeToHour = document.getElementById('bh-time-to-hour');
      const timeToMin = document.getElementById('bh-time-to-min');

      if (timeFromHour) timeFromHour.value = '';
      if (timeFromMin) timeFromMin.value = '';
      if (timeToHour) timeToHour.value = '';
      if (timeToMin) timeToMin.value = '';
    }

    // Attach clear filters to link
    if (clearButton) {
      clearButton.addEventListener('click', function (e) {
        e.preventDefault();
        clearFilters();
      });
    }

    // Expose for debugging
    window.locActivityMap = map;
    window.locActivityPointsLayer = pointsLayer;
  });
})();
