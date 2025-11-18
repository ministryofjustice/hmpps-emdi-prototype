// /public/javascripts/pj-routing.js
(function () {
  'use strict';

  // -------------------------------------------------------------------------
  // Config + caches
  // -------------------------------------------------------------------------
  var cfg = window.OSRM_CONFIG || {};
  var _cacheHTML = new Map();   // traceKey -> rendered HTML
  var _inflight  = new Map();   // url -> Promise(json)

  // -------------------------------------------------------------------------
  // Geometry helpers (polygon entry/exit detection)
  // -------------------------------------------------------------------------
  function pointInPoly(pt, poly) {
    // Ray casting (lat/lng)
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i].lng, yi = poly[i].lat;
      var xj = poly[j].lng, yj = poly[j].lat;
      var intersect = ((yi > pt.lat) !== (yj > pt.lat)) &&
                      (pt.lng < (xj - xi) * (pt.lat - yi) / ((yj - yi) || 1e-12) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  // Simple ray-casting point-in-polygon (expects [lat, lng] points)
  function pointInPolygon(latlng, polygonLatLngs) {
    var x = latlng[1], y = latlng[0];
    var inside = false;
    for (var i = 0, j = polygonLatLngs.length - 1; i < polygonLatLngs.length; j = i++) {
      var xi = polygonLatLngs[i][1], yi = polygonLatLngs[i][0];
      var xj = polygonLatLngs[j][1], yj = polygonLatLngs[j][0];
      var intersect = ((yi > y) !== (yj > y)) &&
                      (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  // Find first trace index that lies inside the LOI polygon (coords: [[lng,lat],...])
  function findFirstInsideIndex(coordsLngLat, area) {
    if (!area || !Array.isArray(area.coordinates) || !area.coordinates.length) return null;
    var polyLatLngs = area.coordinates.map(function (c) { return [c.lat, c.lng]; });
    for (var i = 0; i < coordsLngLat.length; i++) {
      var lng = coordsLngLat[i][0], lat = coordsLngLat[i][1];
      if (pointInPolygon([lat, lng], polyLatLngs)) return i;
    }
    return null;
  }

  function orient(a, b, c) {
    return (b.lng - a.lng) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lng - a.lng);
  }
  function onSeg(a, b, c) {
    return Math.min(a.lng, c.lng) <= b.lng && b.lng <= Math.max(a.lng, c.lng) &&
           Math.min(a.lat, c.lat) <= b.lat && b.lat <= Math.max(a.lat, c.lat);
  }
  function segmentsIntersect(p1, p2, p3, p4) {
    var o1 = orient(p1, p2, p3);
    var o2 = orient(p1, p2, p4);
    var o3 = orient(p3, p4, p1);
    var o4 = orient(p3, p4, p2);
    if (o1 === 0 && onSeg(p1, p3, p2)) return true;
    if (o2 === 0 && onSeg(p1, p4, p2)) return true;
    if (o3 === 0 && onSeg(p3, p1, p4)) return true;
    if (o4 === 0 && onSeg(p3, p2, p4)) return true;
    return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
  }
  function segIntersectsPoly(a, b, poly) {
    for (var k = 0; k < poly.length; k++) {
      var c = poly[k];
      var d = poly[(k + 1) % poly.length];
      if (segmentsIntersect(a, b, c, d)) return true;
    }
    return false;
  }

  // Returns { entry, exit } where:
  //  - entry = index where the track first becomes inside the polygon
  //  - exit  = first index outside AFTER having been inside
  // If never enters, both are null. If enters but never exits, exit is null.
  function findEntryExit(points, polygon) {
    if (!polygon || polygon.length < 3 || !points || points.length < 2) {
      return { entry: null, exit: null };
    }
    var wasInside = pointInPoly(points[0], polygon);
    var entry = wasInside ? 0 : null;
    var exit = null;

    for (var i = 0; i < points.length - 1; i++) {
      var a = points[i], b = points[i + 1];
      var nowInside = pointInPoly(b, polygon);
      var crosses = segIntersectsPoly(a, b, polygon);

      if (!wasInside && (nowInside || crosses)) {
        if (entry === null) entry = i + 1;
        wasInside = true;
        continue;
      }
      if (wasInside && (!nowInside || crosses)) {
        if (!nowInside) { exit = i + 1; wasInside = false; break; }
      }
      wasInside = nowInside;
    }
    return { entry: entry, exit: exit };
  }

  // -------------------------------------------------------------------------
  // Fetch / OSRM helpers (with backoff + de-dupe)
  // -------------------------------------------------------------------------
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function thinCoords(arr, max) {
    max = max || 15;
    if (arr.length <= max) return arr;
    var step = (arr.length - 1) / (max - 1);
    var out = [];
    for (var i = 0; i < max; i++) out.push(arr[Math.round(i * step)]);
    return out;
  }

  function fetchJSONWithBackoff(url, attempts, baseDelay) {
    attempts = attempts || 3;
    baseDelay = baseDelay || 600;
    if (_inflight.has(url)) return _inflight.get(url);
    var run = (async function () {
      var delay = baseDelay;
      for (var i = 0; i < attempts; i++) {
        try {
          var res = await fetch(url);
          if (res.status === 429) throw new Error('RATE_LIMIT');
          if (!res.ok) throw new Error('HTTP_' + res.status);
          return await res.json();
        } catch (err) {
          if (i === attempts - 1) throw err;
          await sleep(delay + Math.floor(Math.random() * 250));
          delay *= 2;
        }
      }
    })();
    _inflight.set(url, run);
    return run.finally(function () { _inflight.delete(url); });
  }

  // --- (B) match with an intermediate "inside LOI" waypoint when applicable --
  function buildWaypointsParam(coordsLngLat, area) {
    var indices = [0];
    var last = coordsLngLat.length - 1;
    var insideIdx = findFirstInsideIndex(coordsLngLat, area);
    if (insideIdx !== null && insideIdx > 0 && insideIdx < last) {
      indices.push(insideIdx);
    }
    indices.push(last);
    return indices.join(';');
  }

  async function matchCoords(coordsLonLat, area) {
    // Work on a thinned copy and compute the "inside" index on that same set
    var coords = thinCoords(coordsLonLat, 15);
    var last = coords.length - 1;

    var coordStr = coords.map(function (c) { return c.join(','); }).join(';');
    var radiuses = new Array(coords.length).fill(25).join(';');

    var base = cfg.baseUrl || 'https://router.project-osrm.org/match/v1/foot';

    // Include intermediate LOI entry waypoint (if present)
    var waypoints = buildWaypointsParam(coords, area);

    var url = base + '/' + coordStr +
              '?steps=true&geometries=geojson&overview=full' +
              '&waypoints=' + encodeURIComponent(waypoints) +
              '&radiuses=' + encodeURIComponent(radiuses) +
              '&annotations=distance,duration&tidy=true';

    var json = await fetchJSONWithBackoff(url, 3, 600);
    var m = json.matchings && json.matchings[0];
    if (!m) throw new Error('No match found');
    return { geometry: m.geometry, legs: m.legs };
  }

  async function routeCoords(coordsLonLat) {
    // Route fallback (no explicit waypoints param; coords act as via points)
    var coords = thinCoords(coordsLonLat, 15);
    var coordStr = coords.map(function (c) { return c.join(','); }).join(';');
    var url = 'https://router.project-osrm.org/route/v1/foot/' + coordStr +
              '?steps=true&geometries=geojson&overview=full&annotations=distance,duration';
    var json = await fetchJSONWithBackoff(url, 3, 600);
    var r = json.routes && json.routes[0];
    if (!r) throw new Error('No route found');
    return { geometry: r.geometry, legs: r.legs };
  }

  async function matchOrRoute(coordsLonLat, area) {
    try { return await matchCoords(coordsLonLat, area); }
    catch (e) {
      console.warn('[pj] match failed, falling back to route', e);
      return await routeCoords(coordsLonLat);
    }
  }

  // -------------------------------------------------------------------------
  // Text helpers
  // -------------------------------------------------------------------------
  function stepText(s) {
    var name = s.name || 'the road';
    var mod = (s.maneuver && s.maneuver.modifier) || '';
    var type = (s.maneuver && s.maneuver.type) || '';
    var exit = (s.maneuver && s.maneuver.exit);
    var dir = mod ? mod.replace(/_/g, ' ') : '';
    switch (type) {
      case 'depart':     return dir ? ('Head ' + dir + ' on ' + name) : ('Head on ' + name);
      case 'turn':       return dir ? ('Turn ' + dir + ' onto ' + name) : ('Turn onto ' + name);
      case 'continue':   return 'Continue on ' + name;
      case 'new name':   return 'Continue onto ' + name;
      case 'merge':      return dir ? ('Merge ' + dir + ' onto ' + name) : ('Merge onto ' + name);
      case 'roundabout': return exit ? ('At the roundabout, take exit ' + exit + ' onto ' + name)
                                     : ('At the roundabout, continue onto ' + name);
      case 'arrive':     return 'Arrive at destination';
      default:           return name ? ('Continue on ' + name) : 'Continue';
    }
  }

  function fmtMin(sec) {
    var m = Math.round((sec || 0) / 60);
    return m <= 0 ? '≤1 min' : (m + ' min');
  }

  function simplifySteps(route) {
    var out = [];
    var legs = route.legs || [];
    for (var i = 0; i < legs.length; i++) {
      var steps = legs[i].steps || [];
      for (var j = 0; j < steps.length; j++) {
        var s = steps[j];
        // Keep 'arrive' only at true leg ends; those are useful as boundaries
        var keepArrive = (s.maneuver && s.maneuver.type === 'arrive') ? true : false;
        out.push({
          text: stepText(s),
          distance: Math.round(s.distance || 0),
          duration: s.duration || 0,
          isArrive: keepArrive
        });
      }
    }
    return out;
  }

  // --- (C) render with continuous numbering across sections -----------------
  function renderSection(container, title, steps, finalLine, startIndexRef) {
    var startIndex = startIndexRef.value || 1;

    var h = document.createElement('h4');
    h.className = 'govuk-heading-s';
    h.textContent = title;
    container.appendChild(h);

    var ol = document.createElement('ol');
    ol.className = 'govuk-list govuk-list--number';
    ol.setAttribute('start', String(startIndex));
    for (var i = 0; i < steps.length; i++) {
      var st = steps[i];
      // Optionally skip internal arrive if you don't want them numbered here:
      if (st.isArrive && !finalLine) {
        // If you prefer arrive to be shown as a numbered step, remove this continue.
        continue;
      }
      var li = document.createElement('li');
      li.innerHTML =
        '<div class="step-text">' + st.text + '</div>' +
        '<div class="step-meta">~' + st.distance + ' m · ' + fmtMin(st.duration) + '</div>';
      ol.appendChild(li);
      startIndex++;
    }
    if (finalLine) {
      // Count the final explicit line as a numbered step
      var li2 = document.createElement('li');
      li2.innerHTML = '<div class="step-text">' + finalLine + '</div>';
      ol.appendChild(li2);
      startIndex++;
    }
    startIndexRef.value = startIndex; // hand back the next index
    container.appendChild(ol);
  }

  // -------------------------------------------------------------------------
  // Main API
  // -------------------------------------------------------------------------
  async function runRoutingForTraceKey(key, containerEl, onError) {
    // Serve from cache instantly (no network)
    if (_cacheHTML.has(key)) {
      containerEl.innerHTML = _cacheHTML.get(key);
      return;
    }

    var trace = (window.GPS_TRACES || {})[key];
    if (!trace || !trace.points || trace.points.length < 2) {
      if (onError) onError('No route available for this selection.');
      return;
    }

    // Loading message
    containerEl.innerHTML = '<p class="govuk-hint">Generating route…</p>';

    var area    = (trace.areas && trace.areas[0]) || null;
    var polygon = (area && area.coordinates) ? area.coordinates : [];
    var label   = (area && area.label) ? area.label : 'destination';

    var pts = trace.points;
    var entry = null, exit = null;
    if (polygon.length >= 3) {
      var res = findEntryExit(pts, polygon);
      entry = res.entry;
      exit  = res.exit;
    }

    var approachPts = (entry == null) ? pts : pts.slice(0, entry + 1);
    var afterPts    = (entry != null && exit != null && exit < pts.length - 1) ? pts.slice(exit) : null;
    var insidePts   = (entry != null && exit != null) ? pts.slice(entry, exit + 1)
                      : (entry != null && exit == null) ? pts.slice(entry) : null;

    // Build HTML in a temp container, then cache+paint
    var temp = document.createElement('div');
    var rendered = 0;
    var stepIndexRef = { value: 1 }; // (C) continuous numbering across sections

    try {
      // A) Approach or full Journey
      if (approachPts && approachPts.length >= 2) {
        var routeA = await matchOrRoute(
          approachPts.map(function (p) { return [p.lng, p.lat]; }),
          area // (B) pass area so match() can add inside-LOI waypoint if relevant
        );
        var stepsA = simplifySteps(routeA);
        var endLine = (entry != null && polygon.length >= 3) ? ('Arrive at ' + label) : null;
        renderSection(temp, (entry != null ? ('Approach to ' + label) : 'Journey'), stepsA, endLine, stepIndexRef);
        rendered++;
      }

      // B) Inside LOI (note only; not numbered, so it doesn’t consume index)
      if (entry != null && insidePts && insidePts.length >= 1) {
        var p = document.createElement('p');
        p.className = 'govuk-body';
        p.textContent = 'Within ' + label;
        temp.appendChild(p);
        rendered++;
      }

      // C) After LOI
      if (afterPts && afterPts.length >= 2) {
        var routeB = await matchOrRoute(
          afterPts.map(function (p) { return [p.lng, p.lat]; }),
          null // no special area waypoint needed for the "after" segment
        );
        var stepsB = simplifySteps(routeB);
        renderSection(temp, 'After leaving ' + label, stepsB, null, stepIndexRef);
        rendered++;
      }
    } catch (err) {
      console.error('[pj] routing error', err);
      if (onError) onError('Could not generate route just now.');
      return;
    }

    if (!rendered) {
      if (onError) onError('No route steps available for this trace.');
      return;
    }

    var html = temp.innerHTML;
    _cacheHTML.set(key, html);
    containerEl.innerHTML = html;
  }

  // Cache helpers for callers
  function renderFromCache(key, el) {
    if (_cacheHTML.has(key)) { el.innerHTML = _cacheHTML.get(key); return true; }
    return false;
  }
  function hasCached(key) { return _cacheHTML.has(key); }

  // Expose
  window.PJ_ROUTING = {
    runRoutingForTraceKey: runRoutingForTraceKey,
    renderFromCache: renderFromCache,
    hasCached: hasCached
  };
})();
