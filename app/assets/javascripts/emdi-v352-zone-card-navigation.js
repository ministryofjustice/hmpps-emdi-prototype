(function () {
  'use strict';

  if (window.location.pathname.split('/')[1] !== 'v3-5-2') return;
  if (window.__emdiV352ZoneCardNavigationLoaded) return;
  window.__emdiV352ZoneCardNavigationLoaded = true;

  var zoneGroups = {
    exclusion: { label: 'Exclusion zone', sources: ['exclusionZone'] },
    inclusion: { label: 'Inclusion zone', sources: ['inclusionZone', 'restrictionZone'] }
  };
  var activeZonePopup = null;

  function getZoneLayers(groupKey) {
    var config = zoneGroups[groupKey];
    if (!config || !window.mapLayers) return [];
    return config.sources.reduce(function (layers, sourceName) {
      var source = window.mapLayers[sourceName];
      if (source && typeof source.getLayers === 'function') {
        layers = layers.concat(source.getLayers());
      }
      return layers;
    }, []);
  }

  function getZoneContext(layer) {
    var groupKeys = Object.keys(zoneGroups);
    for (var index = 0; index < groupKeys.length; index += 1) {
      var key = groupKeys[index];
      var layers = getZoneLayers(key);
      var layerIndex = layers.indexOf(layer);
      if (layerIndex !== -1) {
        return { key: key, label: zoneGroups[key].label, layers: layers, index: layerIndex };
      }
    }
    return null;
  }

  function addNavigation(popup, context) {
    var container = popup && popup.getElement && popup.getElement();
    var content = container && container.querySelector('.leaflet-popup-content');
    if (!content || content.querySelector('.emdi-zone-popup-nav-button, .emdi-exclusion-zone-nav-button')) return;

    var header = content.querySelector('.gps-point-popup__header');
    var title = header && header.querySelector('.gps-point-popup__title');
    if (!header) {
      header = document.createElement('div');
      header.className = 'gps-point-popup__header';
      content.insertBefore(header, content.firstChild);
    }
    if (!title) {
      title = document.createElement('h4');
      title.className = 'govuk-heading-s govuk-!-margin-bottom-0 gps-point-popup__title';
      header.appendChild(title);
    }

    var existingTitle = title.textContent.trim();
    var zoneLabel = existingTitle || context.label;
    title.textContent = zoneLabel + ' ' + (context.index + 1) + ' of ' + context.layers.length;

    function addArrow(targetIndex, glyph, label, beforeTitle) {
      var link = document.createElement('a');
      link.className = 'govuk-link gps-point-popup__nav-button';
      link.href = '#';
      link.innerHTML = glyph;
      link.setAttribute('aria-label', label);
      link.setAttribute('data-zone-group', context.key);
      link.setAttribute('data-zone-index', targetIndex);
      if (beforeTitle) header.insertBefore(link, title);
      else header.appendChild(link);
    }

    if (context.index > 0) {
      addArrow(0, '&laquo;', 'Go to first ' + context.label.toLowerCase(), true);
      addArrow(context.index - 1, '&lsaquo;', 'Go to previous ' + context.label.toLowerCase(), true);
    }
    if (context.index < context.layers.length - 1) {
      addArrow(context.index + 1, '&rsaquo;', 'Go to next ' + context.label.toLowerCase(), false);
      addArrow(context.layers.length - 1, '&raquo;', 'Go to last ' + context.label.toLowerCase(), false);
    }
  }

  function focusZoneCard(popup) {
    var container = popup && popup.getElement && popup.getElement();
    var heading = container && container.querySelector('.gps-point-popup__title');
    if (!heading) return;

    heading.setAttribute('tabindex', '-1');
    var focusHeading = function () {
      if (document.contains(heading)) heading.focus({ preventScroll: true });
    };
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(focusHeading);
    } else {
      window.setTimeout(focusHeading, 0);
    }
  }

  function layerCenter(layer) {
    if (layer && typeof layer.getBounds === 'function') return layer.getBounds().getCenter();
    if (layer && typeof layer.getLatLng === 'function') return layer.getLatLng();
    return null;
  }

  function ensureZoneFillPatterns() {
    var namespace = 'http://www.w3.org/2000/svg';
    ['inclusionZone', 'restrictionZone'].forEach(function (groupName) {
      var group = window.mapLayers && window.mapLayers[groupName];
      if (!group || typeof group.eachLayer !== 'function') return;

      group.eachLayer(function (layer) {
        var className = layer && layer.options && layer.options.className;
        var patternId = className === 'emdi-inclusion-zone-path' ? 'emdi-dot-fill'
          : className === 'emdi-restriction-zone-path' ? 'emdi-horizontal-line-fill'
            : null;
        var svg = layer && layer._path && layer._path.ownerSVGElement;
        if (!patternId || !svg || svg.querySelector('#' + patternId)) return;

        var defs = svg.querySelector('defs');
        if (!defs) {
          defs = document.createElementNS(namespace, 'defs');
          svg.insertBefore(defs, svg.firstChild);
        }

        var pattern = document.createElementNS(namespace, 'pattern');
        pattern.setAttribute('id', patternId);
        pattern.setAttribute('width', '8');
        pattern.setAttribute('height', '8');
        pattern.setAttribute('patternUnits', 'userSpaceOnUse');

        var background = document.createElementNS(namespace, 'rect');
        background.setAttribute('width', '8');
        background.setAttribute('height', '8');
        background.setAttribute('fill', '#d4351c');
        background.setAttribute('fill-opacity', '0.12');
        pattern.appendChild(background);

        var mark = document.createElementNS(namespace, className === 'emdi-inclusion-zone-path' ? 'circle' : 'path');
        if (className === 'emdi-inclusion-zone-path') {
          mark.setAttribute('cx', '2');
          mark.setAttribute('cy', '2');
          mark.setAttribute('r', '1');
        } else {
          mark.setAttribute('d', 'M0,4 L8,4');
          mark.setAttribute('stroke', '#d4351c');
          mark.setAttribute('stroke-width', '1');
        }
        mark.setAttribute('fill', '#d4351c');
        pattern.appendChild(mark);
        defs.appendChild(pattern);
      });
    });
  }

  document.addEventListener('bh:map-ready', function () {
    if (!window.map || window.__emdiV352ZoneCardNavigationInitialised) return;
    window.__emdiV352ZoneCardNavigationInitialised = true;

    ensureZoneFillPatterns();
    window.map.on('layeradd', ensureZoneFillPatterns);

    window.map.on('popupopen', function (event) {
      var context = getZoneContext(event.popup && event.popup._source);
      if (!context) return;
      if (activeZonePopup && activeZonePopup !== event.popup) {
        window.map.closePopup(activeZonePopup);
      }
      activeZonePopup = event.popup;
      addNavigation(event.popup, context);
      focusZoneCard(event.popup);
    });

    window.map.on('popupclose', function (event) {
      if (activeZonePopup === event.popup) activeZonePopup = null;
    });

    document.addEventListener('click', function (event) {
      var button = event.target.closest && event.target.closest('.gps-point-popup__nav-button[data-zone-group]');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();

      var zones = getZoneLayers(button.dataset.zoneGroup);
      var target = zones[Number(button.dataset.zoneIndex)];
      if (!target || typeof target.openPopup !== 'function') return;

      var center = layerCenter(target);
      if (activeZonePopup) {
        window.map.closePopup(activeZonePopup);
        activeZonePopup = null;
      }
      target.openPopup(center || undefined);
      if (center) window.map.panTo(center, { animate: true });
    }, true);
  });
})();
