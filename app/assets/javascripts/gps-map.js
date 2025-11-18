// /public/javascripts/gps-map.js
(function () {
  'use strict';

  // ---------- tiny helpers ----------
  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else { fn(); }
  }
  function $(sel, root = document) { return root.querySelector(sel); }

  // Wait until Leaflet map is attached to window.map (handles soft reloads)
  function whenMapReady(cb, tries = 40) {
    if (window.map && typeof window.map.addLayer === 'function') return cb();
    if (tries <= 0) return console.warn('[gps-map] Map not ready after waiting.');
    setTimeout(() => whenMapReady(cb, tries - 1), 50);
  }

  // ---------- per-page config with sensible defaults ----------
  const CFG = Object.assign({
    DEFAULT_LOI_URL: '/public/data/gps-traces-bh.json',
    SCENARIOS_URL:   '/public/data/gps-traces-bh-demo.json',
    DEFAULT_SCENARIO_KEY: 'bh_20250903'
  }, (window.GPS_CONFIG || {}));

  // Convert HTML like "Wednesday 3 September<br/>2025" to "Wednesday 3 September 2025"
  function htmlToPlain(html) {
    if (typeof html !== 'string') return '';
    return html
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/?[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Extract the time range (text after the first comma) from
  // "Thursday 24 July 2025, 9:33pm to 10:42pm"
  function extractTimeRange(timeanddate) {
    if (!timeanddate || typeof timeanddate !== 'string') return '';
    const idx = timeanddate.indexOf(',');
    if (idx === -1) return '';
    return timeanddate.slice(idx + 1).trim();
  }

  // cache per-URL
  const dataCache = new Map();

  // fallback single group (when overlay groups aren’t present)
  let plotGroup = null;

  // keep last highlighted row
  let highlightedRow = null;

  // ---------- overlay group helpers ----------
  function getGroups(map) {
    if (window.mapLayers) {
      return {
        directionInfo: window.mapLayers.directionInfo || L.layerGroup().addTo(map), // track + arrows together
        accuracy:      window.mapLayers.accuracy      || L.layerGroup(),
        numbers:       window.mapLayers.numbers       || L.layerGroup().addTo(map),
        areas:         window.mapLayers.areas         || L.layerGroup().addTo(map)
      };
    }
    if (!plotGroup) plotGroup = L.layerGroup().addTo(map);
    return {
      directionInfo: plotGroup,
      accuracy:      plotGroup,
      numbers:       plotGroup,
      areas:         plotGroup
    };
  }

  function clearGroups(groups) {
    groups.directionInfo.clearLayers();
    groups.accuracy.clearLayers();
    groups.numbers.clearLayers();
    groups.areas.clearLayers();
  }

  async function loadGpsData(url) {
    const key = url;
    if (dataCache.has(key)) return dataCache.get(key);
    const res = await fetch(key, { cache: 'no-store' });
    const json = await res.json();
    dataCache.set(key, json);
    return json;
  }

  // Build arrowed polyline; BOTH line and arrows go into "directionInfo"
  function addPolylineWithArrows(map, latlngs, groups) {
    const targetGroup = groups.directionInfo || L.layerGroup().addTo(map);

    const line = L.polyline(latlngs, { color: '#1d70b8', weight: 3, opacity: 0.9 });
    targetGroup.addLayer(line);

    if (L.polylineDecorator && L.Symbol && typeof L.Symbol.arrowHead === 'function') {
      const arrows = L.polylineDecorator(line, {
        patterns: [{
          offset: 12,
          repeat: 80,
          symbol: L.Symbol.arrowHead({
            pixelSize: 8,
            pathOptions: { weight: 2, opacity: 0.9, color: '#1d70b8' }
          })
        }]
      });
      targetGroup.addLayer(arrows);
    }
    return line;
  }

  // ------- formatting helpers for point popups --------
  function fmtNum(n, dp = 0) {
    return (typeof n === 'number') ? n.toFixed(dp) : '—';
  }
  function fmtCoord(n) {
    return (typeof n === 'number') ? n.toFixed(6) : '—';
  }
  function fmtTimeHHMM(val) {
    if (!val) return '—';

    if (typeof val === 'string') {
      const m = val.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
      if (m) {
        const hh = m[1].padStart(2, '0');
        const mm = m[2];
        return `${hh}:${mm}`;
      }
      const d = new Date(val);
      if (!isNaN(d)) {
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return `${hh}:${mm}`;
      }
      return '—';
    }

    if (val instanceof Date && !isNaN(val)) {
      const hh = String(val.getHours()).padStart(2, '0');
      const mm = String(val.getMinutes()).padStart(2, '0');
      return `${hh}:${mm}`;
    }

    if (typeof val === 'number') {
      const d = new Date(val);
      if (!isNaN(d)) {
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return `${hh}:${mm}`;
      }
    }

    return '—';
  }

  function pointPopupHTML(pt, idx) {
    const label = (pt.label != null) ? String(pt.label) : String(idx + 1);
    const acc   = (typeof pt.accuracy === 'number') ? `${fmtNum(pt.accuracy, 0)}m` : '—';
    const time  = fmtTimeHHMM(pt.time);
    const lat   = fmtCoord(pt.lat);
    const lng   = fmtCoord(pt.lng);
    return `
      <div class="gps-point-card">
        <h4 class="govuk-heading-s govuk-!-margin-bottom-2">Point ${label}</h4>
        <dl class="govuk-summary-list govuk-!-margin-bottom-0">
          <div class="govuk-summary-list__row">
            <dt class="govuk-summary-list__key">Accuracy</dt>
            <dd class="govuk-summary-list__value">${acc}</dd>
          </div>
          <div class="govuk-summary-list__row">
            <dt class="govuk-summary-list__key">Time</dt>
            <dd class="govuk-summary-list__value">${time}</dd>
          </div>
          <div class="govuk-summary-list__row">
            <dt class="govuk-summary-list__key">Lat / Lng</dt>
            <dd class="govuk-summary-list__value"><code>${lat}, ${lng}</code></dd>
          </div>
        </dl>
      </div>
    `;
  }

  // Build the "when" line for an Area card using an override date (from the LOI table) if provided.
  function buildAreaWhen(area, overrideDateText) {
    const timePart = extractTimeRange(area.timeanddate);
    if (overrideDateText) {
      return timePart ? `${overrideDateText}, ${timePart}` : `${overrideDateText}`;
    }
    return area.timeanddate || '';
  }

  function areaPopupHTML(area, overrideDateText) {
    const label = area.label || 'Area';
    const type = area.type ? `<span class="app-area-chip">${area.type}</span>` : '';
    const whenText = buildAreaWhen(area, overrideDateText);
    const when = whenText ? `<p class="app-area-when govuk-!-margin-bottom-0 govuk-!-margin-top-0">${whenText}</p>` : '';
    return `
      <div class="app-area-card">
        <h4 class="govuk-heading-s govuk-!-margin-bottom-1">${label}</h4>
        ${type}
        ${when}
      </div>
    `;
  }

  function accumulateBounds(bounds, latlngs) {
    latlngs.forEach(ll => bounds.extend(ll));
  }

  // ---------- plot by key (existing behaviour) ----------
  async function plotTrace(traceKey, opts = {}) {
    const {
      scrollToMap = true,
      highlightRowEl = null,
      dataUrl = CFG.DEFAULT_LOI_URL
    } = opts;

    const map = window.map;
    if (!map || typeof map.addLayer !== 'function') {
      console.warn('[gps-map] window.map not ready yet.');
      return;
    }

    const data = await loadGpsData(dataUrl);
    const trace = data && data[traceKey];
    if (!trace) {
      console.error(`[gps-map] Trace not found for key: ${traceKey} (in ${dataUrl})`);
      return;
    }

    // If this was triggered from a table row, compute an override date from the first cell
    let overrideDateText = '';
    if (highlightRowEl) {
      const dateCell = highlightRowEl.querySelector('td');
      if (dateCell) {
        overrideDateText = htmlToPlain(dateCell.innerHTML).trim();
      }
    }

    // Delegate to object plotter
    return window.plotTraceObject(trace, { scrollToMap, highlightRowEl, overrideDateText });
  }

  // ⚠️ Export plotTrace for other scripts (e.g. bh-update-map.js)
  window.plotTrace = plotTrace;

  // ---------- plot a provided trace object (for filtered scenarios) ----------
  window.plotTraceObject = async function (traceObj, opts = {}) {
    const {
      scrollToMap = true,
      highlightRowEl = null,
      overrideDateText = ''
    } = opts;

    const map = window.map;
    if (!map || typeof map.addLayer !== 'function') {
      console.warn('[gps-map] window.map not ready yet.');
      return;
    }

    const groups = getGroups(map);
    clearGroups(groups);

    const allBounds = L.latLngBounds([]);

    // ---- points, accuracy circles, numbered markers (+ POPUPS) ----
    const latlngs = [];
    (traceObj.points || []).forEach((pt, idx) => {
      const ll = [pt.lat, pt.lng];
      latlngs.push(ll);

      if (Number.isFinite(pt.accuracy) && pt.accuracy > 0) {
        L.circle(ll, { radius: pt.accuracy, color: '#1d70b8', weight: 1, fillOpacity: 0.1 })
          .addTo(groups.accuracy);
      }

      const marker = L.marker(ll, { title: `Point ${idx + 1}` })
        .bindTooltip(String(pt.label || idx + 1), {
          permanent: true,
          direction: 'center',
          className: 'gps-point-label'
        })
        .addTo(groups.numbers);

      marker.bindPopup(pointPopupHTML(pt, idx), {
        closeButton: true,
        autoClose: true,
        closeOnClick: true,
        className: 'gps-point-popup'
      });
    });
    if (latlngs.length) accumulateBounds(allBounds, latlngs);

    // ---- polyline with arrows (Direction info) ----
    if (latlngs.length >= 2) {
      addPolylineWithArrows(map, latlngs, groups);
    }

    // ---- polygons / areas + always-visible info card ----
    (traceObj.areas || []).forEach(area => {
      const pts = (area.coordinates || []).map(c => [c.lat, c.lng]);
      if (pts.length >= 3) {
        const poly = L.polygon(pts, {
          color: '#DB90B7',
          fillColor: '#DB90B7',
          fillOpacity: 0.3,
          weight: 4
        }).addTo(groups.areas);

        accumulateBounds(allBounds, pts);

        poly.bindPopup(areaPopupHTML(area, overrideDateText), {
          closeButton: true,
          autoClose: false,
          closeOnClick: false,
          className: 'app-area-popup'
        });
        poly.openPopup();
        poly.on('click', () => poly.openPopup());
      }
    });

    if (allBounds.isValid()) {
      map.fitBounds(allBounds, { padding: [28, 28] });
    }

    if (highlightRowEl) {
      if (highlightedRow) highlightedRow.classList.remove('highlighted-row');
      highlightRowEl.classList.add('highlighted-row');
      highlightedRow = highlightRowEl;
    }

    if (scrollToMap) {
      const heading = document.getElementById('map-header');
      if (heading) heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    const status = document.getElementById('map-status');
    if (status) status.textContent = 'Map updated with filtered GPS trace.';
  };

  // ---------- wire up clicks & initial plot ----------
  onReady(function () {
    // Remove any server-side default highlight on first paint
    document.querySelectorAll('tr.highlighted-row').forEach(tr => tr.classList.remove('highlighted-row'));
    highlightedRow = null;

    // 1) LOI table “View” links
    document.addEventListener('click', function (e) {
      const a = e.target.closest && e.target.closest('.plot-link');
      if (!a) return;
      e.preventDefault();

      const key = a.dataset.trace;
      if (!key) return;

      const row = a.closest('tr');
      plotTrace(key, {
        scrollToMap: true,
        highlightRowEl: row,
        dataUrl: CFG.DEFAULT_LOI_URL
      });
    });

    // 2) Default scenario trace (no highlight, no scroll).
    whenMapReady(() => {
      plotTrace(CFG.DEFAULT_SCENARIO_KEY, {
        scrollToMap: false,
        highlightRowEl: null,
        dataUrl: CFG.SCENARIOS_URL
      });
    });
  });

  // ---------- dev helper: click map to log coords ----------
  onReady(function () {
    if (window.map && typeof window.map.on === 'function') {
      window.map.on('click', function (e) {
        const { lat, lng } = e.latlng;
        console.log(`{ "lat": ${lat.toFixed(6)}, "lng": ${lng.toFixed(6)} },`);
      });
    }
  });

})();
