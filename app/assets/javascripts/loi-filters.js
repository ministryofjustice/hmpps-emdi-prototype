// /public/javascripts/loi-filters.js
(function () {
  'use strict';

  // --- small utilities -------------------------------------------------------
  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else { fn(); }
  }

  // Wait for a selector to exist
  function waitForEl(selector, cb, tries = 40) {
    const el = document.querySelector(selector);
    if (el) return cb(el);
    if (tries <= 0) return console.warn('[loi-filters] gave up waiting for', selector);
    setTimeout(() => waitForEl(selector, cb, tries - 1), 50);
  }

  // Wait for at least one row in the LOI table body
  function waitForRows(table, cb, tries = 40) {
    const tbody = table.tBodies && table.tBodies[0];
    const rowCount = tbody ? tbody.querySelectorAll('tr').length : 0;
    if (rowCount > 0) return cb(tbody);
    if (tries <= 0) return console.warn('[loi-filters] tbody present but no rows after waiting.');
    setTimeout(() => waitForRows(table, cb, tries - 1), 50);
  }

  // Parse ISO (YYYY-MM-DD) or UK-ish long dates
  function parseUkOrIsoDate(str) {
    if (!str) return null;
    const s = String(str).trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])); // local midnight
    const d = new Date(s);
    return isNaN(d) ? null : d;
  }

  onReady(function boot() {
    console.log('[loi-filters] loaded');

    // Wait for the specific LOI table to exist…
    waitForEl('#bh-loi-table', function (table) {
      console.log('[loi-filters] table found? 1');

      // …then wait until it actually has rows
      waitForRows(table, function (tbody) {
        const form = document.getElementById('loi-filters');
        if (!form) {
          console.warn('[loi-filters] #loi-filters not found; aborting.');
          return;
        }

        const statusEl = document.getElementById('loi-filter-status');
        // Pagination: closest one to the table, fallback to first on page
        const pagination =
          table.closest('.govuk-width-container')?.querySelector('.govuk-pagination') ||
          document.querySelector('.govuk-pagination');

        // Cache rows (DOM, not jQuery)
        const rows = Array.from(tbody.querySelectorAll('tr')).map(tr => {
          // Date from first cell (prefer data-sort-value)
          const dateCell = tr.cells[0];
          const rawDate =
            (dateCell && dateCell.getAttribute('data-sort-value')) ||
            (dateCell && dateCell.textContent.trim()) || '';
          const date = parseUkOrIsoDate(rawDate);

          // Type from second cell (prefer machine keys)
          const typeCell = tr.cells[1];
          const typeKey = (
            (typeCell && typeCell.getAttribute('data-loi-type')) ||
            (typeCell && typeCell.getAttribute('data-sort-value')) ||
            (typeCell && typeCell.textContent) ||
            ''
          ).trim().toLowerCase();

          return { tr, date, typeKey };
        });

        if (!rows.length) {
          console.warn('[loi-filters] table exists but no rows found.');
          return;
        }

        // Anchor for relative “last 7/30” filters
        const latestDate = new Date(Math.max.apply(null, rows.map(r => r.date?.getTime() || 0)));

        // Wire up
        form.addEventListener('submit', applyFilters);
        const clearLink = document.getElementById('clear-loi-filters');
        if (clearLink) clearLink.addEventListener('click', clearFilters);

        // Optional: apply once on load if a filter is already chosen
        applyFilters();

        // ---- functions ------------------------------------------------------
        function applyFilters(ev) {
          if (ev) ev.preventDefault();

          const typeSel = document.getElementById('filter-type');
          const dateSel = document.getElementById('filter-date');

          const typeFilterRaw = (typeSel && typeSel.value || '').trim().toLowerCase();
          const dateFilter = (dateSel && dateSel.value) || ''; // '', 'last7', 'last30'

          let shown = 0;

          rows.forEach(r => {
            let match = true;

            // Type filter (includes historic 'non-home' quirk)
            if (typeFilterRaw) {
              if (typeFilterRaw === 'non-home') {
                if (r.typeKey === 'home') match = false;
              } else if (!(r.typeKey === typeFilterRaw || r.typeKey.includes(typeFilterRaw))) {
                match = false;
              }
            }

            // Date range filter
            if (match && r.date instanceof Date && !isNaN(r.date)) {
              if (dateFilter === 'last7' || dateFilter === 'last30') {
                const days = (dateFilter === 'last7') ? 7 : 30;
                const diffDays = Math.floor((latestDate - r.date) / (1000 * 60 * 60 * 24));
                if (diffDays > days) match = false;
              }
            }

            r.tr.hidden = !match;
            if (match) shown++;
          });

          if (statusEl) statusEl.textContent = `Showing ${shown} of ${rows.length} records.`;

          if (pagination) {
            const hasTypeFilter = (document.getElementById('filter-type')?.selectedIndex || 0) > 0;
            if (hasTypeFilter) {
              pagination.setAttribute('hidden', 'hidden');
              pagination.setAttribute('aria-hidden', 'true');
              // jQuery present? keep old behaviour too:
              if (typeof window.$ === 'function') { $(pagination).hide(); }
            } else {
              pagination.removeAttribute('hidden');
              pagination.setAttribute('aria-hidden', 'false');
              if (typeof window.$ === 'function') { $(pagination).show(); }
            }
          }
        }

        function clearFilters(ev) {
          if (ev) ev.preventDefault();
          const typeSel = document.getElementById('filter-type');
          const dateSel = document.getElementById('filter-date');
          if (typeSel) typeSel.value = '';
          if (dateSel) dateSel.value = '';
          applyFilters();
        }
      });
    });
  });
})();
