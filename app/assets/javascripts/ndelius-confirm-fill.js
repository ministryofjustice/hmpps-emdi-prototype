(function () {
  function getParam(name) {
    const u = new URL(window.location.href);
    return u.searchParams.get(name);
  }

  function formatDateFromISO(iso) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "—";
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.toLocaleDateString("en-GB", {
      day: "numeric", month: "long", year: "numeric", timeZone: "UTC"
    });
  }

  function formatTime(hh, mm) {
    if (hh == null || mm == null) return "—";
    const h = Number(hh);
    const m = String(mm).padStart(2, "0");
    const suffix = h >= 12 ? "pm" : "am";
    const hour12 = ((h + 11) % 12) + 1;
    return `${hour12}:${m}${suffix}`;
  }

  // Maps for human-readable labels (mirror your <select> option text)
  const LABELS = {
    contactType: {
      "office-visit-planned": "Office Visit – Planned",
      "office-visit-unplanned": "Office Visit – Unplanned",
      "home-visit-planned": "Home Visit – Planned",
      "home-visit-unplanned": "Home Visit – Unplanned",
      "telephone-incoming": "Telephone Call – Incoming",
      "telephone-outgoing": "Telephone Call – Outgoing",
      "case-note": "Case Note – General",
      "info-to-ems": "Information – To EMS Provider",
      "info-from-ems": "Information – From EMS Provider",
      "email-sent": "Email Sent",
      "email-received": "Email Received"
    },
    licenceBreach: {
      "no-licensed-premises": "Not to enter licensed premises (pubs, bars, clubs)",
      "no-gambling": "Not to enter gambling establishments (betting shops, casinos)",
      "no-schools": "Not to enter schools or places of education",
      "no-contact-named": "Not to contact named individuals",
      "exclusion-zone": "Exclusion zone (specified area)",
      "curfew": "Curfew requirement (e.g. 19:00–07:00 at approved address)",
      "attend-probation": "Attend appointments at probation office",
      "programme": "Participate in accredited programme",
      "no-travel-outside-uk": "Not to travel outside the UK without permission"
    },
    contactOutcome: {
      "complied-no-action": "Complied – No Action Required",
      "breach-suspected-investigate": "Breach Suspected – Further Investigation",
      "breach-confirmed-enforcement": "Breach Confirmed – Enforcement Action",
      "missed-acceptable": "Missed Appointment – Acceptable Reason",
      "missed-unacceptable": "Missed Appointment – Unacceptable",
      "info-only": "Information Only – No Action",
      "referred-manager": "Referred to Manager for Review"
    },
    yesno: { "yes": "Yes", "no": "No" }
  };

  document.addEventListener("DOMContentLoaded", function () {
    const trace   = getParam("trace");
    const dateISO = getParam("date");

    const base = (trace && window.LOI_LOOKUP && window.LOI_LOOKUP[trace]) ? window.LOI_LOOKUP[trace] : {};

    // LOI-derived bits
    const type     = base.type || "—";
    const address  = base.address || [];
    const duration = base.duration || "—";
    const start    = base.time || null;

    // Form-derived bits (from query string)
    const contactType   = LABELS.contactType[getParam("contactType")] || "—";
    const licenceBreach = LABELS.licenceBreach[getParam("licenceBreach")] || "—";
    const contactOutcome= LABELS.contactOutcome[getParam("contactOutcome")] || "—";
    const alert         = LABELS.yesno[(getParam("alert")||"").toLowerCase()] || "—";
    const visor         = LABELS.yesno[(getParam("visor")||"").toLowerCase()] || "—";
    const sensitive     = LABELS.yesno[(getParam("sensitive")||"").toLowerCase()] || "—";

    // Inject
    const byId = (id) => document.getElementById(id);

    const typeEl     = byId("conf-type");
    const notesEl    = byId("conf-notes");
    const dateEl     = byId("conf-date");
    const timeEl     = byId("conf-time");
    const durationEl = byId("conf-duration");
    const ctEl       = byId("conf-contact-type");
    const licEl      = byId("conf-licence");
    const outEl      = byId("conf-outcome");
    const alertEl    = byId("conf-alert");
    const visorEl    = byId("conf-visor");
    const sensEl     = byId("conf-sensitive");

    if (typeEl) typeEl.textContent = type;

    if (notesEl) {
      const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
      notesEl.innerHTML = address.length ? address.map(esc).join("<br>") : "—";
    }

    if (dateEl) dateEl.textContent = formatDateFromISO(dateISO);
    if (timeEl) timeEl.textContent = start ? formatTime(start.hour, start.min) : "—";
    if (durationEl) durationEl.textContent = duration;

    if (ctEl)   ctEl.textContent = contactType;
    if (licEl)  licEl.textContent = licenceBreach;
    if (outEl)  outEl.textContent = contactOutcome;

    if (alertEl) alertEl.textContent = alert;
    if (visorEl) visorEl.textContent = visor;
    if (sensEl)  sensEl.textContent = sensitive;
  });
})();
