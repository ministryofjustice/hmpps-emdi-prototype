// Align the Update button (and Clear link) so their TOP matches the TOP of the time inputs.
// Robust against reflows and won't "toggle" on click.
(function () {
  'use strict';

  function alignBhActions() {
    var grid = document.querySelector('#bh-map-filters .bh-filters-grid');
    if (!grid) return;

    var actions = grid.querySelector('.bh-actions');
    if (!actions) return;

    // Prefer a "Time to" input, fallback to "Time from"
    var timeInput = grid.querySelector('#bh-time-to input') ||
                    grid.querySelector('#bh-time-from input');
    if (!timeInput) return;

    // Current layout metrics
    var inputTop = timeInput.getBoundingClientRect().top + window.scrollY;

    // IMPORTANT: compute the actions' top WITHOUT its current margin-top,
    // so we don't oscillate when we re-run.
    var cs = window.getComputedStyle(actions);
    var currentMargin = parseFloat(cs.marginTop) || 0;
    var actionsTopNoMargin =
      (actions.getBoundingClientRect().top + window.scrollY) - currentMargin;

    // New margin so actionsTopNoMargin + marginTop === inputTop
    var needed = Math.round(inputTop - actionsTopNoMargin);
    if (needed < 0) needed = 0;

    // Only write if it changes meaningfully (avoid tiny 1px jitters)
    if (Math.abs(needed - currentMargin) > 1) {
      actions.style.marginTop = needed + 'px';
    }
  }

  // Debounce to avoid thrashing on resize
  var resizeTimer = null;
  function debouncedAlign() {
    if (resizeTimer) window.cancelAnimationFrame(resizeTimer);
    resizeTimer = window.requestAnimationFrame(alignBhActions);
  }

  // Run on load and on resize
  window.addEventListener('DOMContentLoaded', alignBhActions);
  window.addEventListener('resize', debouncedAlign);

  // Re-align when form fields change (including MOJ date picker populating the inputs)
  var grid = document.querySelector('#bh-map-filters .bh-filters-grid');
  if (grid) {
    ['input', 'change'].forEach(function (evt) {
      grid.addEventListener(evt, debouncedAlign);
    });
    // Clicks inside the grid can open/close the calendar; re-measure next frame
    grid.addEventListener('click', function () {
      window.requestAnimationFrame(alignBhActions);
    });
  }
})();
