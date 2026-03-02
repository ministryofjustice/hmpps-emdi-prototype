(function () {
  'use strict';

  var TABLE_ID       = 'bh-loi-table';   // your table id
  var FORM_ID        = 'bh-map-filters'; // your filters form id
  var BUTTON_IDS     = ['bh-apply-filters', 'bh-update-map']; // both, just in case

  function findTable() {
    var t = document.getElementById(TABLE_ID);
    if (t) return t;
    var link = document.querySelector('.plot-link');
    return link ? link.closest('table') : null;
  }

  function clearHighlights(table) {
    if (!table) return;
    var nodes = table.querySelectorAll(
      [
        'tr.is-active-row','td.is-active-row',
        'tr.highlighted-row','td.highlighted-row',
        'tr.highlighted','td.highlighted',
        'tr.rowFlash','td.rowFlash',
        'tr.app-row-parent--open','tr.app-row-expansion--open'
      ].join(',')
    );
    nodes.forEach(function (el) {
      el.classList.remove(
        'is-active-row',
        'highlighted-row',
        'highlighted',
        'rowFlash',
        'app-row-parent--open',
        'app-row-expansion--open'
      );
    });
  }

  function markRowActive(row, table) {
    if (!row || !table) return;
    clearHighlights(table);
    row.classList.add('is-active-row');
  }

  document.addEventListener('DOMContentLoaded', function () {
    var table = findTable();
    if (!table) return;

    // Keep/restore highlight when a "View on map" link is clicked
    table.addEventListener('click', function (e) {
      var link = e.target.closest('.plot-link');
      if (!link) return;
      var row = link.closest('tr');
      if (!row) return;
      markRowActive(row, table);
    });

    // Clear highlight when submitting the Update Map filters (form-level)
    var form = document.getElementById(FORM_ID);
    if (form) {
      form.addEventListener('submit', function () {
        clearHighlights(table);
      });
    }

    // Also clear if an explicit update button is clicked (in case it’s not type="submit")
    BUTTON_IDS.forEach(function (id) {
      var btn = document.getElementById(id);
      if (btn) {
        btn.addEventListener('click', function () {
          clearHighlights(table);
        });
      }
    });

    // Optional: also clear on “Clear filters” link if you want
    var clearLink = document.getElementById('bh-clear-filters');
    if (clearLink) {
      clearLink.addEventListener('click', function () {
        clearHighlights(table);
      });
    }
  });
})();
