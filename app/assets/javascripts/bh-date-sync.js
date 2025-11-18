(function () {
  'use strict';
  var from = document.getElementById('bh-date-from');
  var to   = document.getElementById('bh-date-to');
  if (!from || !to) return;

  function maybeCopyTo() {
    var fromVal = (from.value || '').trim();
    var toVal   = (to.value   || '').trim();
    if (fromVal && !toVal) {
      to.value = fromVal;
      // let any listeners/validation know it changed
      to.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  // When user picks a date or types one
  from.addEventListener('change', maybeCopyTo);
  from.addEventListener('blur',   maybeCopyTo);

  // Optional: if you want to also fix cases where "to" exists but is *before* "from",
  // uncomment below to force "to" >= "from" (both assumed dd/mm/yy or dd/mm/yyyy)
  /*
  function parseUK(s) {
    var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
    if (!m) return null;
    var d = +m[1], mo = +m[2], y = +m[3];
    if (y < 100) y += 2000;
    return new Date(y, mo - 1, d);
  }
  function ensureToNotBeforeFrom() {
    var f = parseUK((from.value||'').trim());
    var t = parseUK((to.value||'').trim());
    if (f && t && t < f) {
      to.value = from.value;
      to.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
  from.addEventListener('change', ensureToNotBeforeFrom);
  to.addEventListener('blur', ensureToNotBeforeFrom);
  */
})();