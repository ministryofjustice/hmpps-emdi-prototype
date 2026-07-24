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
    SCENARIOS_URL:   '/public/data/gps-traces-bh-demo-nov03.json',
    DEFAULT_SCENARIO_KEY: 'bh_20260212',  // safe fallback string
    USE_POINT_CLUSTERING: false,
    USE_START_FINISH_FLAGS: false,
    COLORIZE_ENDPOINTS: false,
    LARGE_MARKERS: false,
    ENABLE_MISSING_DATA_TABLE: false,
    MISSING_DATA_TABLE_BODY_ID: 'missing-data-table-body',
    MISSING_DATA_GAP_MINS: 5,
    MISSING_DATA_TABLE_GAPS_AND_EXCLUSION_ONLY: false
  }, (window.GPS_CONFIG || {}));

  // DEBUG: surface the config we actually ended up with
  window.CFG = CFG;
  console.log('[gps-map] CFG', CFG);

  // Keep the legacy helper in sync
  window.__BH_SCENARIOS_URL = CFG.SCENARIOS_URL;

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

  // point markers and current index for navigation
  let pointMarkers = [];
  let currentPointIndex = null;

  // keep last highlighted row
  let highlightedRow = null;

  // OverlappingMarkerSpiderfier instance (re-created each trace load)
  let oms = null;

  // MarkerCluster group for numbered points (enabled per-page via CFG)
  let pointClusters = null;
  let directionArrowLayers = [];

  // ---------- overlay group helpers ----------
  function getGroups(map) {
    if (window.mapLayers) {
      return {
        directionInfo: window.mapLayers.directionInfo || L.layerGroup().addTo(map), // track + arrows together
        accuracy:      window.mapLayers.accuracy      || L.layerGroup(),
        pointDots:     window.mapLayers.pointDots     || L.layerGroup().addTo(map),
        numbers:       window.mapLayers.numbers       || L.layerGroup().addTo(map),
        areas:         window.mapLayers.areas         || L.layerGroup().addTo(map)
      };
    }
    if (!plotGroup) plotGroup = L.layerGroup().addTo(map);
    return {
      directionInfo: plotGroup,
      accuracy:      plotGroup,
      pointDots:     plotGroup,
      numbers:       plotGroup,
      areas:         plotGroup
    };
  }

  function clearGroups(groups) {
    groups.directionInfo.clearLayers();
    groups.accuracy.clearLayers();
    groups.pointDots.clearLayers();
    groups.numbers.clearLayers();
    groups.areas.clearLayers();
    directionArrowLayers = [];
    if (oms) { oms.clearMarkers(); }
    pointClusters = null;
  }

  function ensureArrowZoomHandler(map) {
    if (!map || map.__emdiArrowZoomHandlerBound) return;
    map.on('zoomend', function () {
      updateArrowVisibilityForZoom(map);
    });
    map.__emdiArrowZoomHandlerBound = true;
  }

  function updateArrowVisibilityForZoom(map) {
    if (!map || !Array.isArray(directionArrowLayers)) return;
    const zoom = map.getZoom();

    directionArrowLayers.forEach(function (entry) {
      if (!entry || !entry.group || !entry.layer) return;
      const minZoom = Number.isFinite(entry.minZoomToShow) ? entry.minZoomToShow : 0;
      const shouldShow = zoom >= minZoom;
      const hasLayer = entry.group.hasLayer(entry.layer);

      if (shouldShow && !hasLayer) {
        entry.group.addLayer(entry.layer);
      } else if (!shouldShow && hasLayer) {
        entry.group.removeLayer(entry.layer);
      }
    });
  }

  function registerArrowLayer(map, group, layer, arrowConfig) {
    if (!map || !group || !layer) return;
    ensureArrowZoomHandler(map);

    directionArrowLayers.push({
      group,
      layer,
      minZoomToShow: Number(arrowConfig.minZoomToShow || 0)
    });

    updateArrowVisibilityForZoom(map);
  }

  window.clearMapTrace = function () {
    const map = window.map;
    if (!map || typeof map.addLayer !== 'function') return;
    const groups = getGroups(map);
    clearGroups(groups);
    if (typeof map.closePopup === 'function') map.closePopup();
    if (highlightedRow && highlightedRow.classList) {
      highlightedRow.classList.remove('highlighted-row');
    }
    highlightedRow = null;
    map.setView([54.00366, -2.54786], 5.5);
  };

  async function loadGpsData(url) {
    const key = url;
    if (dataCache.has(key)) return dataCache.get(key);
    const res = await fetch(key, { cache: 'no-store' });
    const json = await res.json();
    dataCache.set(key, json);
    return json;
  }

  // --- Densify helpers (paste once) -------------------------------------------

  // Ray-casting: point inside polygon?
  function pointInPolygon(point, vs) {
    const x = point[1], y = point[0];
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
      const xi = vs[i][1], yi = vs[i][0];
      const xj = vs[j][1], yj = vs[j][0];
      const intersect = ((yi > y) !== (yj > y)) &&
        (x < ((xj - xi) * (y - yi)) / (yj - yi + 0.0000001) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  // Random point inside polygon by rejection sampling within its bbox
  function randomPointInPolygon(polyLatLngs) {
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    polyLatLngs.forEach(p => {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
    });
    // try up to N times (polygon is small; this is fine)
    for (let i = 0; i < 2000; i++) {
      const lat = minLat + Math.random() * (maxLat - minLat);
      const lng = minLng + Math.random() * (maxLng - minLng);
      if (pointInPolygon([lat, lng], polyLatLngs.map(p => [p.lat, p.lng]))) {
        return { lat, lng };
      }
    }
    // fallback to centroid if something odd happens
    const c = polyLatLngs.reduce((a, p) => ({ lat: a.lat + p.lat, lng: a.lng + p.lng }), { lat: 0, lng: 0 });
    return { lat: c.lat / polyLatLngs.length, lng: c.lng / polyLatLngs.length };
  }

  // Make HH:MM minutes between a start and end time (strings 'HH:MM')
  function minutesBetween(startHHMM, endHHMM) {
    const [sh, sm] = startHHMM.split(':').map(Number);
    const [eh, em] = endHHMM.split(':').map(Number);
    return (eh * 60 + em) - (sh * 60 + sm);
  }
  function addMinutes(hhmm, m) {
    const [h, mm] = hhmm.split(':').map(Number);
    const t = h * 60 + mm + m;
    const H = Math.floor((t % 1440) / 60);
    const M = t % 60;
    return `${String(H).padStart(2,'0')}:${String(M).padStart(2,'0')}`;
  }

  // --- helpers for random-walk densify ---
  function metersToDegrees(lat, meters) {
    const dLat = meters / 111320; // ~111.32km per degree latitude
    const dLng = meters / (111320 * Math.cos(lat * Math.PI / 180) || 1);
    return { dLat, dLng };
  }

  function polygonCentroid(poly) {
    // basic polygon centroid (lat/lng objects)
    let x = 0, y = 0, f, area = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      f = (poly[i].lng * poly[j].lat) - (poly[j].lng * poly[i].lat);
      x += (poly[i].lng + poly[j].lng) * f;
      y += (poly[i].lat + poly[j].lat) * f;
      area += f;
    }
    area *= 0.5;
    if (!area) return { lat: poly[0].lat, lng: poly[0].lng };
    return { lat: y / (6 * area), lng: x / (6 * area) };
  }

  // Densify a trace: generate N extra points inside polygon, with label/accuracy/time,
  // and return the LOI time window so the caller can splice into the right place.
  function densifyTrace(original, areaPoly, opts) {
    const extra = opts?.count || 0;
    if (!extra || !Array.isArray(areaPoly) || !areaPoly.length) {
      return { points: [], startHHMM: null, endHHMM: null };
    }

    // Read LOI window from areas[0].timeanddate (e.g. "... 11:05am to 12:26pm")
    // Fallback to first/last original point times.
    const timeStr = original?.areas?.[0]?.timeanddate || '';
    const m = timeStr.match(/(\d{1,2}:\d{2})\s*(am|pm)\s*to\s*(\d{1,2}:\d{2})\s*(am|pm)/i);

    const to24 = (hhmm, ap) => {
      let [h, mm] = hhmm.split(':').map(Number);
      const apu = ap.toLowerCase();
      if (apu === 'pm' && h !== 12) h += 12;
      if (apu === 'am' && h === 12) h = 0;
      return `${String(h).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
    };

    let startHHMM = original?.points?.[0]?.time || '11:05';
    let endHHMM   = original?.points?.[original.points.length - 1]?.time || '12:26';
    if (m) {
      startHHMM = to24(m[1], m[2]);
      endHHMM   = to24(m[3], m[4]);
    }

    const windowMins = Math.max(1, minutesBetween(startHHMM, endHHMM));
    const startLabel = Number(original?.points?.[0]?.label || 0); // we will relabel after merge
    const out = [];

    // pick a sensible anchor inside the LOI window if possible, else centroid
    const toMin = (s) => {
      const [H, M] = String(s || '00:00').split(':').map(Number);
      return H * 60 + M;
    };
    const sMin = toMin(startHHMM), eMin = toMin(endHHMM);
    const anchor = (original.points || []).find(p => {
      const t = toMin(p.time);
      return t >= sMin && t <= eMin;
    }) || polygonCentroid(areaPoly);

    let cur = { lat: anchor.lat, lng: anchor.lng };

    for (let i = 0; i < extra; i++) {
      // 8–35 m step, random bearing; keep steps modest so it "meanders"
      const stepMeters = 8 + Math.random() * 27;
      const bearing = Math.random() * 2 * Math.PI;
      const { dLat, dLng } = metersToDegrees(cur.lat, stepMeters);

      // candidate step
      let next = {
        lat: cur.lat + Math.sin(bearing) * dLat,
        lng: cur.lng + Math.cos(bearing) * dLng
      };

      // keep it inside the polygon: re-roll a few times, then snap to centroid
      let attempts = 0;
      while (
        !pointInPolygon([next.lat, next.lng], areaPoly.map(p => [p.lat, p.lng])) &&
        attempts < 4
      ) {
        const b2 = Math.random() * 2 * Math.PI;
        const m2 = 6 + Math.random() * 16;
        const d2 = metersToDegrees(cur.lat, m2);
        next = {
          lat: cur.lat + Math.sin(b2) * d2.dLat,
          lng: cur.lng + Math.cos(b2) * d2.dLng
        };
        attempts++;
      }
      if (!pointInPolygon([next.lat, next.lng], areaPoly.map(p => [p.lat, p.lng]))) {
        next = polygonCentroid(areaPoly);
      }

      const accuracy = Math.floor(8 + Math.random() * 33);
      const t = addMinutes(startHHMM, Math.floor((i % windowMins)));

      out.push({
        lat: +next.lat.toFixed(6),
        lng: +next.lng.toFixed(6),
        label: String(startLabel + i + 1), // temp label; we relabel after splice
        accuracy,
        time: t,
        isDensified: true
      });

      cur = next;
    }

    return { points: out, startHHMM, endHHMM };
  }

  function hhmmToMinutes(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return (h * 60) + m;
  }

  function spliceDensifiedIntoWindow(points, densified, startHHMM, endHHMM) {
    if (!densified?.length) return points;

    const startMin = hhmmToMinutes(startHHMM);
    const endMin   = hhmmToMinutes(endHHMM);

    // Find the first point whose time falls INSIDE the LOI window.
    const firstInsideIdx = points.findIndex(p => {
      const t = hhmmToMinutes(p.time);
      return t >= startMin && t <= endMin;
    });

    // Fallback: if none detected, insert near the start (but this should not happen)
    const insertAt = (firstInsideIdx === -1) ? 0 : firstInsideIdx + 1;

    const merged = points.slice();
    merged.splice(insertAt, 0, ...densified);

    // Renumber labels 1..N (keeps everything tidy for tooltips/overlays)
    for (let i = 0; i < merged.length; i++) {
      merged[i] = { ...merged[i], label: String(i + 1) };
    }
    return merged;
  }

  function createNumberMarkerIcon(label, color, large) {
    const size = large ? 40 : 28;
    const anchor = large ? 20 : 14;
    let style = '';
    if (color) {
      style = ` style="color: ${color};"` ;
    }
    return L.divIcon({
      className: 'gps-number-marker' + (large ? ' gps-number-marker--large' : ''),
      html: `<span${style}>${label}</span>`,
      iconSize: [size, size],
      iconAnchor: [anchor, anchor],
      popupAnchor: [0, -22]
    });
  }

  function createEndpointMarkerIcon(kind) {
    let markerClass = 'gps-endpoint-marker gps-endpoint-marker--start';
    let label = 'Start';

    if (kind === 'finish') {
      markerClass = 'gps-endpoint-marker gps-endpoint-marker--finish';
      label = 'Finish';
    } else if (kind === 'both') {
      markerClass = 'gps-endpoint-marker gps-endpoint-marker--both';
      label = 'Start/finish';
    }

    return L.divIcon({
      className: markerClass,
      html: '<span class="gps-endpoint-marker__wrap"><span class="gps-endpoint-marker__flag" aria-hidden="true"></span><span class="gps-endpoint-marker__text">' + label + '</span></span>',
      iconSize: [62, 30],
      iconAnchor: [8, 22],
      popupAnchor: [18, -20]
    });
  }

  // Build arrowed polyline; BOTH line and arrows go into "directionInfo"
  // If points array provided, uses time gaps to create dotted lines for >5 min gaps
  function addPolylineWithArrows(map, latlngs, groups, points) {
    const targetGroup = groups.directionInfo || L.layerGroup().addTo(map);
    const arrowConfig = Object.assign({
      offset: 12,
      repeat: 80,
      pixelSize: 8,
      pathOptions: { fill: true, fillColor: 'black', fillOpacity: 0.9, weight: 2, color: 'black' },
      minSegmentDistanceMeters: 1,
      minZoomToShow: 0
    }, window.emdiDirectionArrowConfig || {});

    function shouldDrawArrowForSegment(startPoint, endPoint) {
      if (!startPoint || !endPoint) return true;

      if (typeof map.distance === 'function') {
        const segmentDistance = map.distance([startPoint.lat, startPoint.lng], [endPoint.lat, endPoint.lng]);
        return segmentDistance > Number(arrowConfig.minSegmentDistanceMeters || 1);
      }

      return startPoint.lat !== endPoint.lat || startPoint.lng !== endPoint.lng;
    }

    // If no points array, fall back to single solid line (legacy)
    if (!points || !Array.isArray(points) || points.length < 2) {
      const line = L.polyline(latlngs, { color: 'black', weight: 3, opacity: 0.9 });
      targetGroup.addLayer(line);
      if (L.polylineDecorator && L.Symbol && typeof L.Symbol.arrowHead === 'function') {
        const arrows = L.polylineDecorator(line, {
          patterns: [{
            offset: arrowConfig.offset,
            repeat: arrowConfig.repeat,
            symbol: L.Symbol.arrowHead({
              pixelSize: arrowConfig.pixelSize,
              pathOptions: arrowConfig.pathOptions
            })
          }]
        });
        registerArrowLayer(map, targetGroup, arrows, arrowConfig);
      }
      return line;
    }

    // Draw segment-by-segment, checking time gaps
    const GAP_THRESHOLD_MINS = Number(CFG.MISSING_DATA_GAP_MINS) || 5;

    for (let i = 0; i < points.length - 1; i++) {
      const curr = points[i];
      const next = points[i + 1];
      const segment = [[curr.lat, curr.lng], [next.lat, next.lng]];

      // Calculate time gap in minutes
      const currTime = new Date(curr.time);
      const nextTime = new Date(next.time);
      const gapMins = (nextTime - currTime) / 60000;

      // Dotted line for large gaps, solid for small gaps
      const isDottedSegment = gapMins >= GAP_THRESHOLD_MINS;
      const line = L.polyline(segment, {
        color: 'black',
        weight: 3,
        opacity: 0.9,
        dashArray: isDottedSegment ? '5, 5' : null,  // dashed if gap exceeds configured threshold
        interactive: false
      });
      targetGroup.addLayer(line);

      // Add arrows to each segment
      if (shouldDrawArrowForSegment(curr, next) && L.polylineDecorator && L.Symbol && typeof L.Symbol.arrowHead === 'function') {
        const arrows = L.polylineDecorator(line, {
          patterns: [{
            offset: arrowConfig.offset,
            repeat: arrowConfig.repeat,
            symbol: L.Symbol.arrowHead({
              pixelSize: arrowConfig.pixelSize,
              pathOptions: arrowConfig.pathOptions
            })
          }]
        });
        registerArrowLayer(map, targetGroup, arrows, arrowConfig);
      }
    }

    return null;
  }

  // ------- formatting helpers for point popups --------
  function fmtNum(n, dp = 0) {
    return (typeof n === 'number') ? n.toFixed(dp) : '—';
  }
  function fmtCoord(n) {
    return (typeof n === 'number') ? n.toFixed(6) : '—';
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getExclusionZonePolygon() {
    const exclusionZoneLayer = window.mapLayers && window.mapLayers.exclusionZone;
    if (!exclusionZoneLayer || typeof exclusionZoneLayer.eachLayer !== 'function') return [];

    let polygon = [];
    exclusionZoneLayer.eachLayer(function (layer) {
      if (polygon.length || !layer || typeof layer.getLatLngs !== 'function') return;
      const latlngs = layer.getLatLngs();
      if (!Array.isArray(latlngs) || !latlngs.length) return;

      const ring = Array.isArray(latlngs[0]) ? latlngs[0] : latlngs;
      if (!Array.isArray(ring) || ring.length < 3) return;

      polygon = ring
        .filter(function (p) { return p && Number.isFinite(p.lat) && Number.isFinite(p.lng); })
        .map(function (p) { return [p.lat, p.lng]; });
    });

    return polygon;
  }

  function isPointInsidePolygon(point, polygon) {
    if (!point || !Array.isArray(polygon) || polygon.length < 3) return false;
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return false;
    return pointInPolygon([point.lat, point.lng], polygon);
  }

  function buildMissingDataRows(points) {
    const byPoint = new Map();
    const gapThreshold = Number(CFG.MISSING_DATA_GAP_MINS) || 5;
    const gapsAndExclusionOnly = !!CFG.MISSING_DATA_TABLE_GAPS_AND_EXCLUSION_ONLY;
    const exclusionPolygon = getExclusionZonePolygon();

    function addIssue(pointIndex, message) {
      if (!Number.isFinite(pointIndex) || pointIndex < 0) return;
      if (!byPoint.has(pointIndex)) byPoint.set(pointIndex, []);
      byPoint.get(pointIndex).push(message);
    }

    if (gapsAndExclusionOnly) {
      for (let i = 0; i < points.length; i++) {
        const pt = points[i] || {};
        const prev = i > 0 ? (points[i - 1] || {}) : null;

        if (i > 0) {
          const prevTime = new Date(prev.time);
          const currTime = new Date(pt.time);
          if (!Number.isNaN(prevTime.getTime()) && !Number.isNaN(currTime.getTime())) {
            const gapMins = (currTime - prevTime) / 60000;
            if (gapMins >= gapThreshold) {
              addIssue(i, `Dotted line shown: gap of ${Math.round(gapMins)} minutes since previous point.`);
            }
          }
        }

        const insideNow = isPointInsidePolygon(pt, exclusionPolygon);
        const insidePrev = prev ? isPointInsidePolygon(prev, exclusionPolygon) : false;
        if (insideNow && !insidePrev) {
          addIssue(i, 'Point entered the exclusion zone.');
        }
      }

      return Array.from(byPoint.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([pointIndex, issues]) => ({
          pointIndex,
          pointLabel: `Point ${pointIndex + 1}`,
          issues
        }));
    }

    for (let i = 0; i < points.length; i++) {
      const pt = points[i] || {};

      if (!Number.isFinite(pt.lat) || !Number.isFinite(pt.lng)) {
        addIssue(i, 'Location coordinates are missing or invalid.');
      }

      if (!Number.isFinite(pt.accuracy) || pt.accuracy <= 0) {
        addIssue(i, 'Accuracy value is missing.');
      }

      if (!pt.geolocationMechanism) {
        addIssue(i, 'Signal type is missing.');
      }

      if (!pt.time || Number.isNaN(new Date(pt.time).getTime())) {
        addIssue(i, 'Date/time is missing or invalid.');
      }

      if (i > 0) {
        const prev = points[i - 1] || {};
        const prevTime = new Date(prev.time);
        const currTime = new Date(pt.time);
        if (!Number.isNaN(prevTime.getTime()) && !Number.isNaN(currTime.getTime())) {
          const gapMins = (currTime - prevTime) / 60000;
          if (gapMins >= gapThreshold) {
            addIssue(i, `Gap of ${Math.round(gapMins)} minutes since previous point.`);
          }
        }
      }
    }

    return Array.from(byPoint.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([pointIndex, issues]) => ({
        pointIndex,
        pointLabel: `Point ${pointIndex + 1}`,
        issues
      }));
  }

  function renderMissingDataTable(points) {
    if (!CFG.ENABLE_MISSING_DATA_TABLE) return;
    const bodyId = CFG.MISSING_DATA_TABLE_BODY_ID || 'missing-data-table-body';
    const tbody = document.getElementById(bodyId);
    if (!tbody) return;

    const rows = buildMissingDataRows(Array.isArray(points) ? points : []);
    if (!rows.length) {
      tbody.innerHTML = [
        '<tr class="govuk-table__row">',
        '<th scope="row" class="govuk-table__header">None</th>',
        '<td class="govuk-table__cell">No missing data found for current map view.</td>',
        '</tr>'
      ].join('');
      return;
    }

    tbody.innerHTML = rows.map((row) => {
      const issuesHtml = row.issues.map(issue => escapeHtml(issue)).join('<br>');
      return [
        '<tr class="govuk-table__row">',
        `<th scope="row" class="govuk-table__header"><a class="govuk-link js-missing-point-link" href="#" data-point-index="${row.pointIndex}">${escapeHtml(row.pointLabel)}</a></th>`,
        `<td class="govuk-table__cell">${issuesHtml}</td>`,
        '</tr>'
      ].join('');
    }).join('');
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

  function pointPopupHTML(pt, idx, totalPoints) {
  const pointNumber = idx + 1;
  const acc   = (typeof pt.accuracy === 'number') ? `${fmtNum(pt.accuracy, 0)} metres` : '—';
  const hasPrev = idx > 0;
  const hasNext = idx < (totalPoints - 1);

  // --- NEW: date + short time formatter ---
  function formatDateTime(raw) {
    if (!raw) return '—';
    const d = new Date(raw);
    if (isNaN(d)) return '—';

    const day = d.getDate();                    // 1 → 31
    const monthNames = ["Jan","Feb","Mar","Apr","May","Jun",
                        "Jul","Aug","Sep","Oct","Nov","Dec"];
    const mon = monthNames[d.getMonth()];
    const yr  = String(d.getFullYear());

    const hh = String(d.getHours()).padStart(2,'0');
    const mm = String(d.getMinutes()).padStart(2,'0');

    return `${day} ${mon} ${yr}, ${hh}:${mm}`;
  }

  const dateTime = formatDateTime(pt.time);

  const lat = fmtCoord(pt.lat);
  const lng = fmtCoord(pt.lng);
  const speed = (pt.speed != null) ? `${pt.speed} kilometres per hour` : '—';
  const geolocationMechanism = pt.geolocationMechanism || '—';

  return `
    <div class="gps-point-card">
      <h4 class="govuk-heading-s govuk-!-margin-bottom-2">Point ${pointNumber} of ${totalPoints}</h4>
      <dl class="govuk-summary-list govuk-!-margin-bottom-0">
        <div class="govuk-summary-list__row">
          <dt class="govuk-summary-list__key">Accuracy</dt>
          <dd class="govuk-summary-list__value">${acc}</dd>
        </div>

        <div class="govuk-summary-list__row">
          <dt class="govuk-summary-list__key">Date, time</dt>
          <dd class="govuk-summary-list__value">${dateTime}</dd>
        </div>

        <div class="govuk-summary-list__row">
          <dt class="govuk-summary-list__key">Lat, long</dt>
          <dd class="govuk-summary-list__value"><code>${lat}, ${lng}</code></dd>
        </div>

        <div class="govuk-summary-list__row">
          <dt class="govuk-summary-list__key">Speed</dt>
          <dd class="govuk-summary-list__value">${speed}</dd>
        </div>

        <div class="govuk-summary-list__row">
          <dt class="govuk-summary-list__key">Signal type</dt>
          <dd class="govuk-summary-list__value" style="margin-left: 1rem;">${geolocationMechanism}</dd>
        </div>

          <div class="govuk-summary-list__row">
          <dt class="govuk-summary-list__key">Tamper event</dt>
          <dd class="govuk-summary-list__value" style="margin-left: 1rem;"></dd>
        </div>

          <div class="govuk-summary-list__row">
          <dt class="govuk-summary-list__key">Battery status</dt>
          <dd class="govuk-summary-list__value" style="margin-left: 1rem;"></dd>
        </div>

        
      </dl>
    </div>
  `;
}

  function showPointPopup(targetIndex) {
    if (!Array.isArray(pointMarkers) || pointMarkers.length === 0) return;
    if (!Number.isFinite(targetIndex)) return;
    if (targetIndex < 0 || targetIndex >= pointMarkers.length) return;

    const marker = pointMarkers[targetIndex];
    if (!marker) return;

    currentPointIndex = targetIndex;
    if (pointClusters && typeof pointClusters.zoomToShowLayer === 'function') {
      pointClusters.zoomToShowLayer(marker, function () {
        marker.openPopup();
      });
    } else {
      marker.openPopup();
    }

    const map = window.map;
    if (map && typeof marker.getLatLng === 'function') {
      map.panTo(marker.getLatLng(), { animate: true });
    }
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
    // 1) Remove anchors entirely, then all tags, then specific junk like "Send to NDelius"
    const cleanText = (s) => {
      let str = String(s || "");
      // remove <a ...>...</a> completely
      str = str.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, "");
      // remove any remaining tags
      str = str.replace(/<\/?[^>]+>/g, "");
      // remove literal "Send to NDelius" if it snuck in via textContent
      str = str.replace(/\bSend\s+to\s+NDelius\b/gi, "");
      // tidy double spaces/stray commas
      str = str.replace(/\s{2,}/g, " ").replace(/\s*,\s*,/g, ",").replace(/\s+,/g, ",").trim();
      return str;
    };

    const escapeHTML = (s) => String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

    // Plain, safe values only
    const labelText = escapeHTML(cleanText(area.label || "Area"));
    const typeText  = escapeHTML(cleanText(area.type || ""));

    // buildAreaWhen may include the link text if it read from the table cell; clean it hard.
    const whenRaw  = buildAreaWhen(area, overrideDateText);
    const whenText = escapeHTML(cleanText(whenRaw));

    const typeChip = typeText ? `<span class="app-area-chip">${typeText}</span>` : "";

    // Optional building functions panel
    const hasFunctions = Array.isArray(area.buildingFunctions) && area.buildingFunctions.length > 0;
    const headingText  = escapeHTML(cleanText(area.notesHeading || "Mixed-use building:"));

    const notes = hasFunctions ? `
      <div class="app-popup-panel" role="group" aria-labelledby="bf-title">
        <div class="app-popup-panel__icon" aria-hidden="true">
          <img src="/public/images/icons/multi-use.svg" width="48" height="48" alt="">
        </div>
        <div class="app-popup-panel__content">
          <p id="bf-title" class="govuk-body-s govuk-!-margin-bottom-1 govuk-!-margin-top-0">
            ${headingText}
          </p>
          <ul class="app-popup-functions govuk-list govuk-list--bullet">
            ${area.buildingFunctions.map(item => `<li>${escapeHTML(cleanText(item))}</li>`).join("")}
          </ul>
        </div>
      </div>
    ` : "";

    const when = whenText
      ? `<p class="app-area-when govuk-!-margin-bottom-0 govuk-!-margin-top-0">${whenText}</p>`
      : "";

    return `
      <div class="app-area-card">
        <h4 class="govuk-heading-s govuk-!-margin-bottom-1">${labelText}</h4>
        ${typeChip}
        ${when}
        ${notes}
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

    // Return true if any point in `points` falls inside the polygon defined by `area.coordinates`
  function areaHasAnyPoint(area, points) {
    if (!Array.isArray(points) || !Array.isArray(area?.coordinates)) return false;

    const polyLatLngs = area.coordinates.map(c => ({ lat: c.lat, lng: c.lng }));
    if (polyLatLngs.length < 3) return false;

    const vs = polyLatLngs.map(p => [p.lat, p.lng]); // for pointInPolygon

    return points.some(p => {
      if (typeof p.lat !== 'number' || typeof p.lng !== 'number') return false;
      return pointInPolygon([p.lat, p.lng], vs);
    });
  }


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
    pointMarkers = [];
    currentPointIndex = null;

    // (Re-)initialise marker clusters for numbered points when enabled for this page
    pointClusters = null;
    if (CFG.USE_POINT_CLUSTERING && typeof L.markerClusterGroup === 'function') {
      pointClusters = L.markerClusterGroup({
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
        iconCreateFunction: function (cluster) {
          const count = cluster.getChildCount();
          const label = count === 1 ? '1 point' : `${count} points`;
          return L.divIcon({
            html: `<span>${label}</span>`,
            className: 'marker-cluster marker-cluster-small gps-point-cluster',
            iconSize: L.point(68, 68)
          });
        }
      });
      groups.numbers.addLayer(pointClusters);
    }

    // (Re-)initialise spiderfy — replaces per-marker click listeners
    if (typeof OverlappingMarkerSpiderfier !== 'undefined') {
      oms = new OverlappingMarkerSpiderfier(map, {
        keepSpiderfied: true,
        nearbyDistance: 20
      });
      oms.addListener('click', function (m) {
        currentPointIndex = m._pointIndex;
        m.openPopup();
      });
    } else {
      oms = null;
    }

    const allBounds = L.latLngBounds([]);

    const latlngs = [];

    (traceObj.points || []).forEach((pt, idx) => {
      const ll = [pt.lat, pt.lng];
      latlngs.push(ll);

      // --- accuracy circles + dot ---
      if (Number.isFinite(pt.accuracy) && pt.accuracy > 0) {
        const popupOptions = {
          closeButton: true,
          autoClose: true,
          closeOnClick: true,
          className: 'gps-point-popup',
          autoPan: true,
          autoPanPadding: [20, 20],
          autoPanPaddingTopLeft: [20, 20],
          autoPanPaddingBottomRight: [20, 20]
        };

        // Keep confidence circles clear so they do not look like exclusion zones.
        const accCircle = L.circle(ll, {
          radius: pt.accuracy,
          color: '#1d70b8',
          weight: 1,
          fill: false,
          fillOpacity: 0
        }).addTo(groups.accuracy);

        accCircle.bindPopup(pointPopupHTML(pt, idx, traceObj.points.length), popupOptions);
        accCircle.on('click', function (e) {
          if (e && e.originalEvent) {
            e.originalEvent.preventDefault();
            e.originalEvent.stopPropagation();
          }
          this.openPopup();
        });

        // Dot in the centre
        if (window.addConfidenceCircle) {
          window.addConfidenceCircle(pt.lat, pt.lng, pt.accuracy);
        } else {
          const dot = L.circleMarker(ll, {
            radius: 5,
            color: '#1d70b8',
            weight: 0,
            fillColor: '#1d70b8',
            fillOpacity: 1,
            interactive: true
          }).addTo(groups.pointDots);

          dot.bindPopup(pointPopupHTML(pt, idx, traceObj.points.length), popupOptions);
          dot.on('click', function (e) {
            if (e && e.originalEvent) {
              e.originalEvent.preventDefault();
              e.originalEvent.stopPropagation();
            }
            this.openPopup();
          });
        }
      }

      // --- hidden marker with tooltip + popup ---
      const markerPopupOptions = {
        closeButton: true,
        autoClose: true,
        closeOnClick: true,
        className: 'gps-point-popup',
        autoPan: true,
        autoPanPadding: [20, 20],
        autoPanPaddingTopLeft: [20, 20],
        autoPanPaddingBottomRight: [20, 20]
      };

      const isFirstPoint = idx === 0;
      const isLastPoint = idx === (traceObj.points.length - 1);
      let markerIcon = null;
      let markerColor = null;

      if (CFG.COLORIZE_ENDPOINTS) {
        if (isFirstPoint) {
          markerColor = '#00703c';
        } else if (isLastPoint) {
          markerColor = '#d4351c';
        }
      }

      if (CFG.USE_START_FINISH_FLAGS) {
        if (traceObj.points.length === 1) {
          markerIcon = createEndpointMarkerIcon('both');
        } else if (isFirstPoint) {
          markerIcon = createEndpointMarkerIcon('start');
        } else if (isLastPoint) {
          markerIcon = createEndpointMarkerIcon('finish');
        }
      }

      if (!markerIcon) {
        const largeMarker = CFG.LARGE_MARKERS && (isFirstPoint || isLastPoint);
        markerIcon = createNumberMarkerIcon(String(pt.label || idx + 1), markerColor, largeMarker);
      }

      const marker = L.marker(ll, {
        title: `Point ${idx + 1}`,
        interactive: true,
        riseOnHover: true,
        zIndexOffset: 1000,
        icon: markerIcon
      });

      if (pointClusters) {
        pointClusters.addLayer(marker);
      } else {
        marker.addTo(groups.numbers);
      }

      marker._pointIndex = idx;
      pointMarkers.push(marker);

      marker.bindPopup(pointPopupHTML(pt, idx, traceObj.points.length), markerPopupOptions);

      if (oms) {
        // OMS intercepts overlapping clicks and spiderfies; click fires via oms listener
        oms.addMarker(marker);
      } else {
        marker.on('click', function (e) {
          if (e && e.originalEvent) {
            e.originalEvent.preventDefault();
            e.originalEvent.stopPropagation();
          }
          currentPointIndex = this._pointIndex;
          this.openPopup();
        });
      }
    }); // <-- THIS WAS MISSING

    if (latlngs.length) {
      accumulateBounds(allBounds, latlngs);
    }


    // ---- polyline with arrows (Direction info) ----
    if (latlngs.length >= 2) {
      addPolylineWithArrows(map, latlngs, groups, traceObj.points);
    }

        // ---- polygons / areas + always-visible info card ----
    const allAreas = Array.isArray(traceObj.areas) ? traceObj.areas : [];

    // First, try to find areas that actually contain at least one point
    let hitAreas = allAreas.filter(area => areaHasAnyPoint(area, traceObj.points || []));

    // Fallback: if none are "hit", show all areas (for legacy scenarios / LOI table)
    if (!hitAreas.length) {
      hitAreas = allAreas;
    }

    let firstPoly = null;

    hitAreas.forEach(area => {
      const pts = (area.coordinates || []).map(c => [c.lat, c.lng]);
      if (pts.length >= 3) {
        const poly = L.polygon(pts, {
          color: '#DB90B7',
          fillColor: '#DB90B7',
          fillOpacity: 0.3,
          weight: 5,
          pane: 'loi-areas'   // draw in our high-z pane
        }).addTo(groups.areas);

        accumulateBounds(allBounds, pts);

        poly.bindPopup(areaPopupHTML(area, overrideDateText), {
          closeButton: true,
          autoClose: false,
          closeOnClick: false,
          className: 'app-area-popup'
        });

        if (!firstPoly) {
          firstPoly = poly;
        }

        poly.on('click', () => poly.openPopup());
      }
    });

    if (firstPoly) {
      firstPoly.openPopup();
    }

    // ---- dwell time heatmap ----
    if (window.createDwellHeatmapData && window.addHeatmapLayer && (traceObj.points || []).length > 1) {
      const heatData = window.createDwellHeatmapData(traceObj.points);
      window.addHeatmapLayer(heatData);
    }

    if (allBounds.isValid()) {
      groups.areas.eachLayer(l => { if (l.bringToFront) l.bringToFront(); });
      map.fitBounds(allBounds, { padding: [28, 28] });
    }

    if (highlightRowEl) {
      if (highlightedRow) highlightedRow.classList.remove('highlighted-row');
      highlightRowEl.classList.add('highlighted-row');
      highlightedRow = highlightRowEl;
    }

    if (scrollToMap) {
      const heading = document.getElementById('map');
      if (heading) heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    renderMissingDataTable(traceObj.points || []);

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

    // 2) Delegated navigation for GPS point popups — removed.

    // 3) Missing-data table links to exact map points.
    document.addEventListener('click', function (e) {
      const link = e.target.closest('.js-missing-point-link');
      if (!link) return;
      e.preventDefault();
      const pointIndex = Number(link.dataset.pointIndex);
      if (!Number.isFinite(pointIndex)) return;
      showPointPopup(pointIndex);
      const mapEl = document.getElementById('map');
      if (mapEl) mapEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    // 4) Preload scenarios JSON, then simulate a click on "Update map"
    whenMapReady(async () => {
      try {
        const scenariosUrl = CFG.SCENARIOS_URL;
        const lib = await loadGpsData(scenariosUrl);
        window.GPS_TRACES = lib; // expose for other modules

        // Get all bh_YYYYMMDD keys sorted by date
        const keys = Object.keys(lib).filter(k => /^bh_\d{8}$/.test(k))
          .sort((a, b) => {
            const da = new Date(`${a.slice(3, 7)}-${a.slice(7, 9)}-${a.slice(9, 11)}T00:00:00Z`);
            const db = new Date(`${b.slice(3, 7)}-${b.slice(7, 9)}-${b.slice(9, 11)}T00:00:00Z`);
            return da - db;
          });

        if (keys.length) {
          const latestKey = keys.at(-1);
          window.CFG.DEFAULT_SCENARIO_KEY = latestKey;
        }
      } catch (e) {
        console.warn('[gps-map] scenario preload failed:', e);
      }

      // After data is loaded and other scripts have had a chance to bind
      // their handlers, trigger the same path as a user clicking "Update map".
      setTimeout(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const updateBtn = buttons.find(b =>
          b.textContent && b.textContent.trim() === 'Update map'
        );
        if (updateBtn) {
          console.log('[gps-map] Auto-triggering initial "Update map" search');
          updateBtn.click();
        } else {
          console.warn('[gps-map] Could not find "Update map" button for auto-search.');
        }
      }, 0);
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
