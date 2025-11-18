// /public/javascripts/pj-table-expansion.js
(function () {
  'use strict';

  var TABLE_SELECTOR = 'table[data-module="moj-sortable-table"]';

  // --- Data loader ----------------------------------------------------------
  function ensureTraces() {
    if (window.GPS_TRACES) return Promise.resolve();
    return fetch('/public/data/gps-traces-pj.json', { cache: 'no-store' })
      .then(function (res) { return res.json(); })
      .then(function (json) { window.GPS_TRACES = json; })
      .catch(function () { /* PJ_ROUTING onError handles UI */ });
  }

  // --- Helpers --------------------------------------------------------------
  function renderMessage(target, html, cls) {
    if (!target) return;
    target.innerHTML = '<p class="' + (cls || 'govuk-hint') + '">' + html + '</p>';
  }

  function uid() {
    return (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  }

  function getColCount(table) {
    var ths = table.querySelectorAll('thead th');
    if (ths && ths.length) return ths.length;
    var firstRow = table.querySelector('tbody tr');
    if (firstRow) return firstRow.children.length;
    return 1;
  }

  // Prefer Address cell (3rd td), else Date cell (1st td)
  function getRowLabelId(tr) {
    var cells = tr.querySelectorAll('td');
    if (!cells || !cells.length) return null;
    var preferredIndex = (cells.length >= 3) ? 2 : 0;
    var labelCell = cells[preferredIndex] || cells[0];
    if (!labelCell) return null;
    if (!labelCell.id) labelCell.id = 'rowlbl-' + uid();
    return labelCell.id;
  }

  // Find the trace key for a row (via existing map link)
  function getTraceKeyForRow(tr) {
    var a = tr.querySelector('.plot-link[data-trace]');
    return a ? a.getAttribute('data-trace') : '';
  }

  function removeExistingExpansions(table) {
    var exps = table.querySelectorAll('.app-row-expansion');
    for (var i = 0; i < exps.length; i++) exps[i].parentNode.removeChild(exps[i]);
  }

  // Build one expansion row after each data row so the Show/Hide button lives there.
  function buildExpansionRows(table) {
    removeExistingExpansions(table);
    var colCount = getColCount(table);
    var rows = table.querySelectorAll('tbody > tr');

    for (var i = 0; i < rows.length; i++) {
      var tr = rows[i];

      // Skip if this is an expansion (we removed them already anyway)
      if (tr.classList.contains('app-row-expansion')) continue;

      var key = getTraceKeyForRow(tr);
      if (!key) continue; // only add expansion for rows with a trace

      var regionId    = 'exp-'   + key.replace(/\s+/g, '-') + '-' + uid();
      var containerId = 'route-' + key.replace(/\s+/g, '-') + '-' + uid();
      var labelId     = getRowLabelId(tr) || ('rowlbl-' + uid());

      var expTr = document.createElement('tr');
      expTr.className = 'app-row-expansion';

      var td = document.createElement('td');
      td.colSpan = colCount;
      td.id = regionId;
      td.setAttribute('role', 'region');
      td.setAttribute('aria-labelledby', labelId);

      // Button lives in this row even when collapsed; transcript container starts hidden.
      td.innerHTML =
        '<div class="app-expansion-actions">' +
        '  <button type="button" class="govuk-link app-link-button js-route-toggle" ' +
        '          data-trace="' + key + '" ' +
        '          aria-expanded="false" ' +
        '          aria-controls="' + containerId + '">' +
        '    Show route transcript' +
        '  </button>' +
        '</div>' +
        '<div class="app-route-target" id="' + containerId + '" hidden></div>';

      expTr.appendChild(td);
      tr.parentNode.insertBefore(expTr, tr.nextSibling);

      // Mark parent row as a group parent (borders handled via CSS)
      tr.classList.add('app-row-parent');
      tr.setAttribute('aria-controls', regionId);
      tr.setAttribute('aria-expanded', 'false');
    }
  }

  function setOpenState(parentTr, expTr, open, buttonEl, containerEl) {
    if (open) {
      parentTr.classList.add('app-row-parent--open');
      expTr.classList.add('app-row-expansion--open');
      parentTr.setAttribute('aria-expanded', 'true');
      buttonEl.setAttribute('aria-expanded', 'true');
      buttonEl.textContent = 'Hide route transcript';
      containerEl.removeAttribute('hidden');
    } else {
      parentTr.classList.remove('app-row-parent--open');
      expTr.classList.remove('app-row-expansion--open');
      parentTr.setAttribute('aria-expanded', 'false');
      buttonEl.setAttribute('aria-expanded', 'false');
      buttonEl.textContent = 'Show route transcript';
      containerEl.setAttribute('hidden', '');
    }
  }

  function toggle(buttonEl) {
    var expTr = buttonEl.closest ? buttonEl.closest('tr.app-row-expansion') : null;
    if (!expTr) return;
    var parentTr = expTr.previousElementSibling;
    if (!parentTr) return;

    var key = buttonEl.getAttribute('data-trace') || '';
    var containerId = buttonEl.getAttribute('aria-controls');
    var target = document.getElementById(containerId);
    if (!target) return;

    var isOpen = buttonEl.getAttribute('aria-expanded') === 'true';

    // Toggle off
    if (isOpen) {
      setOpenState(parentTr, expTr, false, buttonEl, target);
      parentTr.focus && parentTr.focus();
      return;
    }

    // Optional: one-at-a-time — close any other open groups
    var table = parentTr.closest ? parentTr.closest('table') : null;
    if (table) {
      var openBtns = table.querySelectorAll('.js-route-toggle[aria-expanded="true"]');
      for (var i = 0; i < openBtns.length; i++) {
        var b = openBtns[i];
        var tr2 = b.closest('tr.app-row-expansion');
        if (tr2) {
          var parent2 = tr2.previousElementSibling;
          var container2 = document.getElementById(b.getAttribute('aria-controls'));
          setOpenState(parent2, tr2, false, b, container2);
        }
      }
    }

    // Toggle on
    setOpenState(parentTr, expTr, true, buttonEl, target);

    // Render from cache if present; else lazy-load
    if (window.PJ_ROUTING && window.PJ_ROUTING.renderFromCache &&
        window.PJ_ROUTING.renderFromCache(key, target)) {
      return;
    }

    target.innerHTML = '<p class="govuk-hint">Generating route…</p>';

    ensureTraces()
      .then(function () {
        if (!window.PJ_ROUTING) throw new Error('Routing module missing');
        return window.PJ_ROUTING.runRoutingForTraceKey(
          key,
          target,
          function (msg) { renderMessage(target, msg || 'No route available.', 'govuk-hint'); }
        );
      })
      .then(function () {
        if (target && !target.children.length && !target.textContent.trim()) {
          renderMessage(target, 'No route steps available for this trace.', 'govuk-hint');
        }
      })
      .catch(function (err) {
        console.error('[pj] expansion routing error', err);
        renderMessage(target, 'Could not generate route just now.', 'govuk-error-message');
      });
  }

  // --- Init -----------------------------------------------------------------
  function init() {
    var table = document.querySelector(TABLE_SELECTOR);
    if (!table) return;

    buildExpansionRows(table);

    // Delegate clicks for the Show/Hide toggle (button in expansion row)
    table.addEventListener('click', function (e) {
      var el = e.target;
      var btn = (el && el.classList && el.classList.contains('js-route-toggle'))
        ? el
        : (el && el.closest ? el.closest('.js-route-toggle') : null);
      if (!btn) return;
      e.preventDefault();
      toggle(btn);
    });

    // Rebuild expansions when headers clicked (sorting reorders rows)
    var thead = table.querySelector('thead');
    if (thead) {
      thead.addEventListener('click', function () {
        // Allow sort to complete, then rebuild
        setTimeout(function () { buildExpansionRows(table); }, 0);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
