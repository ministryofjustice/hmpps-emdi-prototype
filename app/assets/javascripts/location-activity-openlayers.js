(function () {
  'use strict';

  function isFiniteCoord(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function extractPointsFromTrace(payload) {
    if (!payload || typeof payload !== 'object') return [];

    const traceKeys = Object.keys(payload);
    if (!traceKeys.length) return [];

    const firstTrace = payload[traceKeys[0]];
    if (!firstTrace || !Array.isArray(firstTrace.points)) return [];

    return firstTrace.points
      .filter(function (pt) {
        return isFiniteCoord(pt.lat) && isFiniteCoord(pt.lng);
      })
      .map(function (pt, index) {
        return {
          index: index + 1,
          lat: pt.lat,
          lng: pt.lng,
          time: pt.time || ''
        };
      });
  }

  function initOpenLayersLocationActivityMap() {
    const mapTarget = document.getElementById('ol-map');
    if (!mapTarget || !window.ol) return;

    const status = document.getElementById('ol-map-status');

    const vectorSource = new ol.source.Vector();

    const baseLayer = new ol.layer.Tile({
      source: new ol.source.OSM()
    });

    const pointsLayer = new ol.layer.Vector({
      source: vectorSource,
      style: new ol.style.Style({
        image: new ol.style.Circle({
          radius: 4,
          fill: new ol.style.Fill({ color: '#005ea5' }),
          stroke: new ol.style.Stroke({ color: '#ffffff', width: 1 })
        })
      })
    });

    const map = new ol.Map({
      target: 'ol-map',
      layers: [baseLayer, pointsLayer],
      controls: ol.control.defaults.defaults({
        zoom: true,
        rotate: false,
        attribution: true
      }).extend([
        new ol.control.ScaleLine(),
        new ol.control.FullScreen()
      ]),
      view: new ol.View({
        center: ol.proj.fromLonLat([-3.5, 54.5]),
        zoom: 5,
        minZoom: 3,
        maxZoom: 20
      })
    });

    const view = map.getView();

    const zoomInBtn = document.getElementById('ol-zoom-in');
    const zoomOutBtn = document.getElementById('ol-zoom-out');
    const resetBtn = document.getElementById('ol-zoom-reset');

    if (zoomInBtn) {
      zoomInBtn.addEventListener('click', function () {
        const currentZoom = view.getZoom() || 13;
        view.animate({ zoom: currentZoom + 1, duration: 150 });
      });
    }

    if (zoomOutBtn) {
      zoomOutBtn.addEventListener('click', function () {
        const currentZoom = view.getZoom() || 13;
        view.animate({ zoom: currentZoom - 1, duration: 150 });
      });
    }

    function fitToPoints() {
      const extent = vectorSource.getExtent();
      if (!extent || ol.extent.isEmpty(extent)) return;

      view.fit(extent, {
        padding: [30, 30, 30, 30],
        maxZoom: 17,
        duration: 250
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        fitToPoints();
      });
    }

    function loadMapData() {
      vectorSource.clear();
      if (status) {
        status.textContent = 'Loading map data...';
      }

      fetch('/public/data/gps-traces-bh-demo-nov03.json', { cache: 'no-store' })
        .then(function (response) {
          if (!response.ok) {
            throw new Error('Unable to load map data.');
          }
          return response.json();
        })
        .then(function (payload) {
          const points = extractPointsFromTrace(payload);

          const features = points.map(function (pt) {
            const feature = new ol.Feature({
              geometry: new ol.geom.Point(ol.proj.fromLonLat([pt.lng, pt.lat])),
              pointIndex: pt.index,
              pointTime: pt.time
            });
            return feature;
          });

          vectorSource.addFeatures(features);

          if (status) {
            status.textContent = points.length
              ? points.length + ' points loaded on OpenLayers map.'
              : 'No points available for this map.';
          }
        })
        .catch(function (err) {
          if (status) {
            status.textContent = 'Error loading map data: ' + err.message;
          }
        });
    }

    const applyBtn = document.getElementById('bh-apply-filters');
    if (applyBtn) {
      applyBtn.addEventListener('click', function (e) {
        e.preventDefault();
        loadMapData();
      });
    }

    window.openLayersLocationActivityMap = map;
    window.loadMapData = loadMapData;
  }

  function setupFilterHandlers() {
    const clearBtn = document.getElementById('bh-clear-filters');
    if (clearBtn) {
      clearBtn.addEventListener('click', function (e) {
        e.preventDefault();
        // Clear date pickers - find all date inputs within their containers
        const dateFromContainer = document.getElementById('bh-date-from');
        const dateToContainer = document.getElementById('bh-date-to');
        
        if (dateFromContainer) {
          const inputs = dateFromContainer.querySelectorAll('input[type="text"]');
          inputs.forEach(function (input) {
            input.value = '';
          });
        }
        
        if (dateToContainer) {
          const inputs = dateToContainer.querySelectorAll('input[type="text"]');
          inputs.forEach(function (input) {
            input.value = '';
          });
        }
        
        // Clear time inputs
        document.getElementById('bh-time-from-hour').value = '';
        document.getElementById('bh-time-from-min').value = '';
        document.getElementById('bh-time-to-hour').value = '';
        document.getElementById('bh-time-to-min').value = '';
        
        const status = document.getElementById('bh-filter-status');
        if (status) {
          status.textContent = 'Filters cleared.';
          status.classList.remove('govuk-visually-hidden');
        }
      });
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    initOpenLayersLocationActivityMap();
    setupFilterHandlers();
  });
})();
