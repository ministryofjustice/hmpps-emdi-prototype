// /public/javascripts/bh-map-filters.js
(function () {
  'use strict';

  var JSON_URL = '/public/data/gps-traces-bh.json';
  var traces = null, keys = [], idx = -1, layerGroup = null;

  function $(sel) { return document.querySelector(sel); }
  function clearMap() { if (layerGroup) layerGroup.clearLayers(); }
  function ensureGroup() { if (!layerGroup) layerGroup = L.featureGroup().addTo(window.map); }

  function plotTrace(trace) {
    if (!window.map || !trace) return;
    ensureGroup(); clearMap();

    if (Array.isArray(trace.points) && trace.points.length > 1) {
      var latlngs = trace.points.map(p => [p.lat, p.lng]);
      layerGroup.addLayer(L.polyline(latlngs, { color: '#0b84a5', weight: 3, opacity: 0.9 }));
    }
    (trace.areas || []).forEach(a => {
      var pts = (a.coordinates || []).map(c => [c.lat, c.lng]);
      if (pts.length >= 3) {
        layerGroup.addLayer(L.polygon(pts, { color: '#2a9d8f', fillColor: '#2a9d8f', fillOpacity: 0.25, weight: 2 }));
      }
    });

    var b = layerGroup.getBounds();
    if (b && b.isValid && b.isValid()) window.map.fitBounds(b, { padding: [20, 20] });

    var status = $('#bh-map-status');
    if (status) {
      var a = (trace.areas && trace.areas[0]) || {};
      status.textContent = 'Showing: ' + (a.label || 'trace') + (a.timeanddate ? ' — ' + a.timeanddate : '');
    }
  }

  function showRandomFirst() {
    if (!keys.length) return;
    idx = Math.floor(Math.random() * keys.length);
    plotTrace(traces[keys[idx]]);
  }

  function showNext() {
    if (!keys.length) return;
    idx = (idx + 1) % keys.length;
    plotTrace(traces[keys[idx]]);
  }

  async function init() {
    try {
      var res = await fetch(JSON_URL);
      traces = await res.json();
      keys = Object.keys(traces);
    } catch (e) {
      console.error('[bh] failed to load traces:', e);
      return;
    }

    // ----- IMPORTANT GUARD -----
    // If the page's filters form includes MOJ date pickers,
    // we assume this is Billy's date-search panel and we DO NOT
    // attach our submit handlers (prevents cycling).
    var form = $('#bh-map-filters');
    var hasDatePickers = form && (form.querySelector('#bh-date-from') || form.querySelector('#bh-date-to'));

    if (!hasDatePickers) {
      // Start from a random trace each load (original LOI table behaviour)
      showRandomFirst();

      if (form) {
        form.addEventListener('submit', function (ev) {
          ev.preventDefault();
          showNext();
        });
      }

      var clear = $('#bh-clear-filters');
      if (clear) {
        clear.addEventListener('click', function (ev) {
          ev.preventDefault();
          if (form && typeof form.reset === 'function') form.reset();
          showRandomFirst();
        });
      }
    }
    // If hasDatePickers === true, do nothing here;
    // bh-update-map.js handles the date/time filtering & plotting.
  }

  document.addEventListener('DOMContentLoaded', init);
})();
