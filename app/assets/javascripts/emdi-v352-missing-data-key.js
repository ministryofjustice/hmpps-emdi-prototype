(function () {
  'use strict';

  if (window.location.pathname.split('/')[1] !== 'v3-5-2') return;
  if (window.__emdiMissingDataKeyHelperLoaded) return;
  window.__emdiMissingDataKeyHelperLoaded = true;

  function initialiseMissingDataKey() {
    var keySlot = document.querySelector('.emdi-shared-panel__key-content');
    var routeLayer = window.mapLayers && window.mapLayers.directionInfo;
    if (!keySlot || !routeLayer || !window.map) return;

    var item = keySlot.querySelector('.emdi-heatmap-key__item--missing-data');
    var divider = keySlot.querySelector('.emdi-heatmap-key__missing-data-divider');

    if (!item) {
      item = document.createElement('div');
      item.className = 'emdi-heatmap-key__item emdi-heatmap-key__item--missing-data';
      item.innerHTML = '<span class="emdi-heatmap-key__swatch emdi-heatmap-key__swatch--missing-data" aria-hidden="true"></span>Missing data';
      item.hidden = true;

      divider = document.createElement('hr');
      divider.className = 'emdi-heatmap-key__divider emdi-heatmap-key__missing-data-divider';
      divider.hidden = true;

      var anchor = keySlot.querySelector('.emdi-heatmap-key__section--zones, .emdi-heatmap-key__section--exclusion');
      var emptyMessage = keySlot.querySelector('.emdi-heatmap-key__empty');
      if (anchor) {
        anchor.insertAdjacentElement('afterend', divider);
      } else if (emptyMessage) {
        emptyMessage.insertAdjacentElement('beforebegin', divider);
      } else {
        keySlot.appendChild(divider);
      }
      divider.insertAdjacentElement('afterend', item);
    }

    function hasDashedLayer(layer) {
      if (!layer) return false;
      if (layer.options && layer.options.dashArray) return true;
      if (typeof layer.eachLayer !== 'function') return false;

      var found = false;
      layer.eachLayer(function (child) {
        if (!found && hasDashedLayer(child)) found = true;
      });
      return found;
    }

    function updateMissingDataKey() {
      var directionInfo = window.mapLayers && window.mapLayers.directionInfo;
      var isVisible = !!(directionInfo && window.map && window.map.hasLayer(directionInfo) && hasDashedLayer(directionInfo));
      item.hidden = !isVisible;

      var heatmapSection = keySlot.querySelector('.emdi-heatmap-key__section--heatmap');
      var zonesSection = keySlot.querySelector('.emdi-heatmap-key__section--zones, .emdi-heatmap-key__section--exclusion');
      var emptyMessage = keySlot.querySelector('.emdi-heatmap-key__empty');
      var heatmapVisible = !!(heatmapSection && !heatmapSection.hidden);
      var zonesVisible = !!(zonesSection && !zonesSection.hidden);
      divider.hidden = !(isVisible && (heatmapVisible || zonesVisible));

      if (emptyMessage) {
        emptyMessage.hidden = heatmapVisible || zonesVisible || isVisible;
      }
    }

    function wrapKeyVisibilityUpdate() {
      var originalUpdate = window.emdiUpdateHeatmapKeyVisibility;
      if (typeof originalUpdate !== 'function' || originalUpdate.__emdiMissingDataKeyWrapped) return;

      var wrappedUpdate = function () {
        originalUpdate.apply(this, arguments);
        updateMissingDataKey();
      };
      wrappedUpdate.__emdiMissingDataKeyWrapped = true;
      window.emdiUpdateHeatmapKeyVisibility = wrappedUpdate;
    }

    function wrapPlotTraceObject() {
      var originalPlot = window.plotTraceObject;
      if (typeof originalPlot !== 'function' || originalPlot.__emdiMissingDataKeyWrapped) return;

      var wrappedPlot = function () {
        var result = originalPlot.apply(this, arguments);
        return Promise.resolve(result).then(function (plotResult) {
          updateMissingDataKey();
          return plotResult;
        });
      };
      wrappedPlot.__emdiMissingDataKeyWrapped = true;
      window.plotTraceObject = wrappedPlot;
    }

    wrapKeyVisibilityUpdate();
    wrapPlotTraceObject();
    updateMissingDataKey();
  }

  document.addEventListener('bh:map-ready', initialiseMissingDataKey);
})();
