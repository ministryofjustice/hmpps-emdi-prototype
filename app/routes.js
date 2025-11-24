//
// For guidance on how to create routes see:
// https://prototype-kit.service.gov.uk/docs/create-routes
//

const govukPrototypeKit = require('govuk-prototype-kit')
const router = govukPrototypeKit.requests.setupRouter()

// Add your routes here

// Routes for Penny Location page
router.get('/penny-location', (req, res) => {
  const d = new Date();
  const dd   = String(d.getDate()).padStart(2, '0');
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();

  const todayMax = `${dd}/${mm}/${yyyy}`;
  const todayDisplay = `${d.getDate()}/${d.getMonth()+1}/${String(yyyy).slice(-2)}`;

  // loiDates and startIndex are already populated by your middleware
  res.render('penny-location', { todayMax, todayDisplay, startIndex: res.locals.startIndex });
});

// For Richard's Create report page
// Create report – show form
router.get('/rm-create-report', function (req, res) {
  res.render('rm-create-report');
});


// Handle form submit → go to “generating” state
router.post('/rm-create-report', function (req, res) {
  const data = req.session.data || {};

  // -------------------------------
  // Report start date and time (from form)
  // -------------------------------
  const rawDate = data['rm-report-start-date'];   // e.g. "10/11/2025"
  const hour    = data['rm-report-start-hour'];   // e.g. "10"
  const minute  = data['rm-report-start-minute']; // e.g. "01"

  const MONTHS = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December'
  ];
  const pad2 = (n) => String(n).padStart(2, '0');

  let startLabel = 'Not set';

  if (rawDate && hour && minute) {
    const parts = rawDate.split('/'); // expect ["dd","mm","yyyy"]
    if (parts.length === 3) {
      const ddRaw = parts[0];
      const mmRaw = parts[1];
      const yyyy  = parts[2];

      const dd      = parseInt(ddRaw, 10);
      const mmIndex = parseInt(mmRaw, 10) - 1;
      const monthName = MONTHS[mmIndex] || '';

      const hNum = parseInt(hour, 10);
      const mNum = parseInt(minute, 10) || 0;

      const mmText = pad2(mNum);

      // Convert 24h → 12h
      const hour24  = hNum;
      const hour12  = ((hour24 + 11) % 12) + 1;  // 1–12
      const ampm    = hour24 >= 12 ? 'pm' : 'am';

      // e.g. "10 November 2025 10:01am"
      startLabel = `${dd} ${monthName} ${yyyy} ${hour12}:${mmText}${ampm}`;
    }
  }

  data['rm-report-start-label'] = startLabel;

  // -------------------------------
  // Build dynamic report filename
  // -------------------------------
  const startRaw = data['rm-report-start-date'];        // e.g. "20/10/2025"
  const lengthRaw = (data['rm-report-length'] || '')    // e.g. "7 days"
    .toString()
    .trim()
    .replace(/\s+/g, '');                               // "7days"
  const hoursRaw  = (data['rm-report-hours-per-map'] || '') // e.g. "6 hours"
    .toString()
    .trim()
    .replace(/\s+/g, '');                               // "6hours"

  let ddmmyyyy = '';

  if (startRaw && startRaw.includes('/')) {
    const parts = startRaw.split('/'); // ["dd","mm","yyyy"]
    if (parts.length === 3) {
      const dd = parts[0].padStart(2, '0'); // "20"
      const mm = parts[1].padStart(2, '0'); // "10"
      const yyyy = parts[2];                // "2025"
      ddmmyyyy = `${dd}${mm}${yyyy}`;       // "20102025"
    }
  }

  const filename = ddmmyyyy
    ? `HMPPS-trail-monitoring-report-${ddmmyyyy}-${lengthRaw}-${hoursRaw}.pdf`
    : 'HMPPS-trail-monitoring-report.pdf';

  data['rm-report-filename'] = filename;

  // -------------------------------
  // Date and time REQUESTED (now)
  // -------------------------------
  const now = new Date();

  const day     = now.getDate();
  const month   = MONTHS[now.getMonth()];
  const year    = now.getFullYear();
  const minutes = pad2(now.getMinutes());

  const reqHour24  = now.getHours();
  const reqHour12  = ((reqHour24 + 11) % 12) + 1;
  const reqAmpm    = reqHour24 >= 12 ? 'pm' : 'am';

  const requestedLabel =
    `${day} ${month} ${year} ${reqHour12}:${minutes}${reqAmpm}`;

  data['rm-report-requested-label'] = requestedLabel;

  // -------------------------------
  // Save and continue
  // -------------------------------
  req.session.data = data;
  res.redirect('/rm-report-generating');
});



// Generating + ready pages just render templates
router.get('/rm-report-generating', function (req, res) {
  res.render('rm-report-generating');
});

router.get('/rm-report-ready', function (req, res) {
  res.render('rm-report-ready');
});





// ---- Dynamic dates for LOI table (available to all views) ----
// Set how many days to shift the ENTIRE display pattern back (e.g. 1 = show "yesterday" as day 0)
const DISPLAY_DAY_SHIFT = 1; // <-- change to 0 to revert, or 2 to shift two days back, etc.

// NOTE: We build `iso` as a LOCAL date string (YYYY-MM-DD) to avoid UTC/local mismatches.
function buildLoiRowsDates(anchorDate /* Date at 00:00 local */) {
  // Offsets matching your original pattern:
  // top 4 rows = 0; then -1, -2; then 3 rows at -3; 3 rows at -4;
  // then -5; then last 3 rows at -14
  const offsets = [0,0,0,0, -1, -2, -3,-3,-3, -4,-4,-4, -5, -14,-14,-14];

  return offsets.map(off => {
    const d = new Date(anchorDate);
    d.setDate(d.getDate() + off); // apply offset (still local time)

    // Build LOCAL ISO-like string YYYY-MM-DD (not UTC)
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const iso = `${y}-${m}-${day}`;

    // UK display
    const weekday = d.toLocaleDateString('en-GB', { weekday: 'long' });
    const dispDay  = d.toLocaleDateString('en-GB', { day: 'numeric' });
    const month    = d.toLocaleDateString('en-GB', { month: 'long' });
    const year     = d.toLocaleDateString('en-GB', { year: 'numeric' });

    return {
      html: `${weekday} ${dispDay} ${month}<br/>${year}`,
      iso
    };
  });
}

// Compute the first index whose date is strictly before TODAY (local midnight).
// (We keep this for robustness; with DISPLAY_DAY_SHIFT=1 it will typically return 0.)
function computeStartIndex(loiDates) {
  // Local midnight today
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  for (let i = 0; i < loiDates.length; i++) {
    const iso = loiDates[i]?.iso;
    if (!iso) continue;

    // Parse our LOCAL yyyy-mm-dd safely into a local Date
    const [Y, M, D] = iso.split('-').map(Number);
    const d = new Date(Y, (M - 1), D); // local midnight for that date

    if (d < todayStart) {
      return i; // first row strictly before today
    }
  }
  // If nothing is before today, start at 0
  return 0;
}

// Middleware: compute loiDates for every request
router.use(function setLoiDates(req, res, next) {
  // Local midnight today
  const anchor = new Date();
  anchor.setHours(0,0,0,0);

  // Shift the entire pattern back by DISPLAY_DAY_SHIFT days
  const shifted = new Date(anchor);
  shifted.setDate(shifted.getDate() - DISPLAY_DAY_SHIFT);

  res.locals.loiDates = buildLoiRowsDates(shifted);
  next();
});


router.get('/bh-location', (req, res) => {
  const d = new Date();

  // For maxDate (what the picker expects)
  const dd   = String(d.getDate()).padStart(2, '0');
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const todayMax = `${dd}/${mm}/${yyyy}`;   // e.g. 21/08/2025

  // For display (your requested 21/8/25)
  const todayDisplay = `${d.getDate()}/${d.getMonth()+1}/${String(yyyy).slice(-2)}`;

  // Compute startIndex based on res.locals.loiDates
  const loiDates = res.locals.loiDates || [];
  const startIndex = computeStartIndex(loiDates);

  res.render('bh-location', { todayMax, todayDisplay, startIndex });
});


router.get('/design-history', function (req, res) {
  res.render('design-history');
});

// Step 1 -> Step 2
router.post('/add-location1', function (req, res) {
  // postcode/searchString saved automatically in req.session.data
  return res.redirect('/add-location2');
});

// Step 2 -> Step 3
router.post('/add-location2', function (req, res) {
  // selectedAddress saved automatically in req.session.data.selectedAddress
  if (!req.session.data.selectedAddress) {
    // No selection? stay here (later you can add an error)
    return res.redirect('/add-location2');
  }
  return res.redirect('/add-location3');
});

// Step 3 -> Manage (or Location tab if you prefer)
router.post('/add-location3', function (req, res) {
  // loiName saved in req.session.data.loiName
  return res.redirect('/bh-manage-locations');
});


// Clear the current custom LOI (name + address) from session, then return to Manage Locations
router.post('/loi/clear', function (req, res) {
  req.session.data.selectedAddress = '';
  req.session.data.loiName = '';
  return res.redirect('/bh-manage-locations');
});

// NEW: allow GET for the prototype so the link works inside the main form
router.get('/loi/clear', function (req, res) {
  req.session.data.selectedAddress = '';
  req.session.data.loiName = '';
  return res.redirect('/bh-manage-locations');
});

// Manage Locations form submission
router.post('/bh-manage-locations', function (req, res) {
  const raw = req.body['loiTypes[]'] ?? req.body.loiTypes;
  const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  req.session.data.loiTypes = list;

  const outside = req.body['outsideUk[]'] ?? req.body.outsideUk;
  req.session.data.outsideUk = Array.isArray(outside) ? outside : (outside ? [outside] : []);

  // go back to the manage page (you can change to bh-location if preferred)
  return res.redirect('/bh-location');
});



// POST: add address manually
router.post('/add-location-manually', function (req, res) {
  const { loiName, addressLine1, addressLine2, addressTown, addressCounty, addressPostcode } = req.body;

  // Save name
  req.session.data.loiName = loiName;

  // Build a single string address for reuse in the table/inset
  const parts = [addressLine1, addressLine2, addressTown, addressCounty, addressPostcode]
    .filter(Boolean); // remove empties

  req.session.data.selectedAddress = parts.join(', ');

  // Redirect back to manage locations
  res.redirect('/bh-manage-locations');
});


// GET: NDelius record form (prefill from trace + date)
router.get('/ndelius-record', function (req, res) {
  const { trace = '' } = req.query;
  const sess = req.session.data || {};

  const isCustom =
    trace === 'finch-road' ||
    trace === 'custom-1' ||
    (typeof trace === 'string' && trace.toLowerCase().startsWith('custom'));

  if (isCustom) {
    const addrLines = (sess.selectedAddress || '').split(', ').join('\n').trim();
    const typeName  = (sess.loiName || '').trim() || 'Custom';
    const duration  = '6 hours 4 mins';

    const defaultNotes = [
      addrLines,
      addrLines ? '' : '',
      `Location type: ${typeName}`,
      '',
      `Duration: ${duration}`
    ].join('\n').trim();

    if (!sess.notes || !sess.notes.trim()) {
      req.session.data.notes = defaultNotes; // only for custom
    }
  } else {
    req.session.data.notes = ''; // ensure built-ins don’t inherit last custom
  }

  res.render('ndelius-record', { query: req.query });
});


module.exports = router;
