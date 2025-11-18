// /public/javascripts/pj-loi-default.js
(function () {
  'use strict';

  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else { fn(); }
  }
  function $(sel, root = document) { return root.querySelector(sel); }
  function $all(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

  function setHomeRowsVisible(visible) {
    const table = $('#bh-loi-table');
    if (!table) return;
    $all('tbody tr', table).forEach(tr => {
      const typeCell = tr.querySelectorAll('td')[1];
      if (!typeCell) return;
      const isHome = (typeCell.textContent || '').trim().toLowerCase() === 'home';
      if (isHome) {
        tr.style.display = visible ? '' : 'none';
      }
    });

    // Optional: announce to SR users
    const status = $('#loi-filter-status');
    if (status) {
      status.textContent = visible
        ? 'Showing all locations including Home.'
        : 'Showing all locations excluding Home.';
    }
  }

  onReady(function () {
    const sel = $('#filter-type');
    if (!sel) return;

    // Apply the default immediately on first paint
    if (sel.value === 'non-home') {
      setHomeRowsVisible(false);
    }

    // Keep table in sync with user choice
    sel.addEventListener('change', function () {
      if (this.value === 'non-home') {
        setHomeRowsVisible(false);
      } else {
        // Show Home rows again; your existing date/type filters (if any) can still act on the table.
        setHomeRowsVisible(true);
      }
    });
  });
})();
