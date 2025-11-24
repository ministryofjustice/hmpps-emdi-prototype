// /public/javascripts/curfew-view-toggle.js
// Single job: toggle between chart and table, persist view, and announce.
// Assumes these IDs exist: curfew-chart-wrap, curfew-table-wrap, curfew-btn-toggle-view
(function(){
  'use strict';

  function onReady(fn){
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else { fn(); }
  }

  onReady(function(){
    const chartWrap  = document.getElementById('curfew-chart-wrap');
    const tableWrap  = document.getElementById('curfew-table-wrap');
    const toggleBtn  = document.getElementById('curfew-btn-toggle-view');
    const typeBtn    = document.getElementById('curfew-btn-stacked'); // graph type button (we hide it in table view)

    if (!chartWrap || !tableWrap || !toggleBtn) return;

    // --- storage helpers (v3 to avoid old keys) ---
    const STORAGE_VERSION = 'v3';
    const LS  = window.localStorage || null;
    const key = (s) => `curfew:${STORAGE_VERSION}:${s}`;
    const getPref = (k, d) => { try { const v = LS && LS.getItem(k); return (v === null || v === undefined) ? d : v; } catch { return d; } };
    const setPref = (k, v) => { try { LS && LS.setItem(k, v); } catch { /* ignore */ } };

    // seed first-visit view
    if (getPref(key('view'), null) == null) setPref(key('view'), 'chart');

    function applyView(view){
      const showChart = (view !== 'table');

      if (showChart) {
        tableWrap.setAttribute('hidden', '');
        chartWrap.removeAttribute('hidden');
        toggleBtn.textContent = 'Change to accessible table view';
        toggleBtn.setAttribute('data-view', 'chart');
        toggleBtn.setAttribute('aria-controls', 'curfew-chart-wrap');
        typeBtn && typeBtn.classList.remove('bh-hide');
      } else {
        chartWrap.setAttribute('hidden', '');
        tableWrap.removeAttribute('hidden');
        toggleBtn.textContent = 'Change to chart view';
        toggleBtn.setAttribute('data-view', 'table');
        toggleBtn.setAttribute('aria-controls', 'curfew-table-wrap');
        typeBtn && typeBtn.classList.add('bh-hide');
        // ask charts controller to (re)build the table now
        document.dispatchEvent(new CustomEvent('bh:curfew:request-table'));
      }

      document.dispatchEvent(new CustomEvent('bh:curfew:view-changed', {
        detail: { view: showChart ? 'chart' : 'table' }
      }));
      setPref(key('view'), showChart ? 'chart' : 'table');
    }

    // apply stored (or default) view
    applyView(getPref(key('view'), 'chart'));

    // Toggle handler
    toggleBtn.addEventListener('click', function(){
      const goingTo = (toggleBtn.getAttribute('data-view') === 'chart') ? 'table' : 'chart';
      applyView(goingTo);
    });
  });
})();
