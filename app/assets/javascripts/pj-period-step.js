// /public/javascripts/pj-period-step.js
(function () {
  'use strict';

  const $ = (sel, root=document) => root.querySelector(sel);
  const pad2 = (n) => String(n).padStart(2, '0');

  function getDateStr() {
    return $('#bh-date-from input')?.value?.trim()
        || $('#bh-date-from')?.value?.trim()
        || '';
  }
  function setDateStr(d) {
    const s = `${pad2(d.getDate())}/${pad2(d.getMonth()+1)}/${d.getFullYear()}`;
    const el = $('#bh-date-from input') || $('#bh-date-from');
    if (el) el.value = s;
  }
  function parseDMY(str) {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(str||'').trim());
    if (!m) return null;
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 0, 0, 0, 0);
    return isNaN(d) ? null : d;
  }
  function addHours(date, h) {
    const d = new Date(date.getTime());
    d.setHours(d.getHours() + h);
    return d;
  }
  function getPeriodHours() {
    const el = document.querySelector('#bh-period') || (document.forms['bh-map-filters']?.elements['periodHours']);
    const v = Number(el?.value || 6);
    return (isFinite(v) && v > 0) ? v : 6;
  }
  function updateButtonLabel() {
    const btn = $('#bh-step-forward');
    if (!btn) return;
    const h = getPeriodHours();
    btn.textContent = `+ ${h} hour${h === 1 ? '' : 's'}`;
  }

  function precomputeToFields() {
    // Mirror pj-period-filters logic so we’re not racing it
    const dateFromStr = getDateStr();
    const hFrom = Number($('#bh-time-from-hour')?.value || 0);
    const mFrom = Number($('#bh-time-from-min')?.value  || 0);
    const periodHrs = getPeriodHours();

    const base = parseDMY(dateFromStr);
    if (!base || isNaN(hFrom) || isNaN(mFrom)) return;

    base.setHours(hFrom, mFrom, 0, 0);
    const end = addHours(base, periodHrs);

    const dateToEl = $('#bh-date-to');
    const toHourEl = $('#bh-time-to-hour');
    const toMinEl  = $('#bh-time-to-min');

    if (dateToEl) dateToEl.value = `${pad2(end.getDate())}/${pad2(end.getMonth()+1)}/${end.getFullYear()}`;
    if (toHourEl) toHourEl.value = pad2(end.getHours());
    if (toMinEl)  toMinEl.value  = pad2(end.getMinutes());
  }

  function stepForward() {
    const form = $('#bh-map-filters');
    if (!form) return;

    // 1) Move the FROM forward by current period
    const currentDate = parseDMY(getDateStr());
    const hour = Number($('#bh-time-from-hour')?.value || 0);
    const min  = Number($('#bh-time-from-min')?.value  || 0);
    if (!currentDate || isNaN(hour) || isNaN(min)) return;

    const start = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate(), hour, min, 0, 0);
    const h = getPeriodHours();
    const next = addHours(start, h);

    setDateStr(next);
    const hEl = $('#bh-time-from-hour'); if (hEl) hEl.value = pad2(next.getHours());
    const mEl = $('#bh-time-from-min');  if (mEl) mEl.value = pad2(next.getMinutes());

    // 2) Write hidden TO fields now (no race)
    precomputeToFields();

    // 3) Fire a cancellable submit event (bh-update-map.js will preventDefault and plot)
    const evt = new Event('submit', { cancelable: true, bubbles: true });
    form.dispatchEvent(evt);
    // No navigation; fields remain as updated.
  }

  document.addEventListener('DOMContentLoaded', () => {
    updateButtonLabel();
    $('#bh-period')?.addEventListener('change', updateButtonLabel);
    $('#bh-step-forward')?.addEventListener('click', stepForward);
  });
})();
