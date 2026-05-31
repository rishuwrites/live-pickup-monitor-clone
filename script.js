/**
 * Lenskart Live Pickup Monitor (Clone) — script.js
 *
 * Schedule logic:  reads data/pickups.json  (same as original)
 * Counts layer:    reads snapshot from Google Sheets public GET endpoint
 *                  — pushed by the NEXS bookmarklet running on your device
 *
 * Special rule:
 *   DELHIVERY displayed count = raw DELHIVERY count − DELHIVERYPDS count
 *   (DELHIVERYPDS manifests appear inside DELHIVERY's API response)
 */

// ─── Config ───────────────────────────────────────────────────────────────────

/**
 * Your Google Apps Script Web App URL (deployed as "Anyone" readable).
 * GET request returns JSON:
 * {
 *   "timestamp": "30-05-2026 11:32:00 IST",
 *   "BLUEDART": 12,
 *   "DELHIVERY": 8,
 *   "DELHIVERYPDS": 3,
 *   ...
 * }
 */
const SHEET_GET_URL = "https://script.google.com/macros/s/AKfycbwDjSwykFzMWHerWI0SA_ROS0uKYSpE09eWY5NaLzUlqG39O2h3W3bfzAWsy7-SYVVW/exec";

// How often to re-fetch counts from sheet (ms). 60s is fine.
const COUNTS_REFRESH_MS = 30_000;

// ─── State ────────────────────────────────────────────────────────────────────
let pickupData  = [];   // filled after pickups.json fetch
let counts      = {};   // { BLUEDART: 12, DELHIVERY: 5, ... } — from sheet
let lastUpdated = null; // IST timestamp string from sheet
let lastRunKey  = "";   // change-detection for flash/shake

// ─── Courier key extractor ────────────────────────────────────────────────────
/**
 * "BLUEDART RD 1&2"   → "BLUEDART"
 * "PURPLEDRONE RD 2"  → "PURPLEDRONE"
 * "BusybeesSDD RD 1"  → "BusybeesSDD"
 * "shreerajxpress RD 1" → "shreerajxpress"
 */
function courierKey(name) {
  // Split on " RD " (case-insensitive) and take the first part
  return name.split(/ RD /i)[0].trim();
}

/**
 * Returns the count to display for a courier.
 * DELHIVERY special rule: subtract DELHIVERYPDS.
 * Returns null if no snapshot has been pushed yet.
 */
function getCount(name) {
  if (Object.keys(counts).length === 0) return null;
  const key = courierKey(name);
  return counts[key] ?? 0;
}

// ─── Count badge HTML ─────────────────────────────────────────────────────────
function countBadge(name) {
  const c = getCount(name);

  if (c === null) {
    // No snapshot pushed yet
    return `<span class="count-badge count-unknown">⏳ —</span>`;
  }
  if (c === 0) {
    return `<span class="count-badge count-zero">✅ 0</span>`;
  }
  return `<span class="count-badge count-live">📦 ${c}</span>`;
}

// ─── Time helpers ─────────────────────────────────────────────────────────────
function toMin(t) {
  const [tm, ap] = t.split(" ");
  let [h, m]     = tm.split(":").map(Number);
  if (h === 12) h = 0;
  if (ap === "PM") h += 12;
  return h * 60 + m;
}

function normalizeFuture(startMin, nowMin) {
  return startMin <= nowMin ? startMin + 1440 : startMin;
}

// ─── Slot grouping ─────────────────────────────────────────────────────────────
/**
 * Groups pickups by time window.
 * Each slot: { start, end, pickups: [{name, ...}], sortStart }
 */
function buildSlotMap(futureArr) {
  const map = {};
  futureArr.forEach(p => {
    const key = `${p.start}|${p.end}`;
    if (!map[key]) {
      map[key] = { start: p.start, end: p.end, pickups: [], sortStart: p.sortStart };
    }
    map[key].pickups.push(p);
  });
  return Object.values(map).sort((a, b) => a.sortStart - b.sortStart);
}

// ─── Render a slot's courier list with count badges ───────────────────────────
function renderCourierLines(pickups) {
  return pickups.map(p => `
    <div class="courier-line">
      <span class="courier-name">${p.name}</span>
      ${countBadge(p.name)}
    </div>
  `).join("");
}

// ─── DOM helpers ──────────────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }

function flashShake(el) {
  el.classList.add("flash", "shake");
  setTimeout(() => el.classList.remove("flash", "shake"), 600);
}

// ─── IST time ─────────────────────────────────────────────────────────────────
function getISTTime() {
  const now = new Date();
  return new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
}

function formatClockWithDeciseconds(istTime) {
  const base = new Intl.DateTimeFormat("en-IN", {
    weekday: "long", day: "numeric", month: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true,
  }).format(istTime);
  const ds = Math.floor(istTime.getMilliseconds() / 100);
  return `${base}.${ds}`;
}

// ─── Last updated indicator ───────────────────────────────────────────────────
function renderLastUpdated() {
  const el = $("lastUpdated");
  if (!el) return;
  if (!lastUpdated) {
    el.textContent = "⏳ Counts: waiting for first push...";
    el.className = "last-updated stale";
  } else {
    el.textContent = `📊 Counts last pushed: ${lastUpdated}`;
    el.className = "last-updated fresh";
  }
}

// ─── Fetch counts from Google Sheet ──────────────────────────────────────────
async function fetchCounts() {
  if (!SHEET_GET_URL || SHEET_GET_URL.includes("YOUR_GOOGLE")) return;
  try {
    const res  = await fetch(SHEET_GET_URL + "?t=" + Date.now()); // bust cache
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // Pull out the timestamp, rest are counts
    lastUpdated = data.timestamp || null;
    const newCounts = {};
    Object.entries(data).forEach(([k, v]) => {
      if (k === "timestamp") return;
      if (typeof v === "number") newCounts[k] = v;
    });
    counts = newCounts;
    renderLastUpdated();
  } catch (err) {
    console.warn("Could not fetch counts from sheet:", err.message);
  }
}

// ─── Main update loop (100ms) ─────────────────────────────────────────────────
function update() {
  const istNow = getISTTime();
  const curMin = istNow.getHours() * 60 + istNow.getMinutes();
  const nowSec = istNow.getHours() * 3600 + istNow.getMinutes() * 60 + istNow.getSeconds();

  // Clock
  $("clock").innerText = formatClockWithDeciseconds(istNow);

  // Classify pickups
  const running = [];
  const future  = [];

  pickupData.forEach(p => {
    let s = toMin(p.start);
    let e = toMin(p.end);
    if (e <= s) e += 1440;

    const inWindow =
      (curMin >= s && curMin < e) ||
      (e > 1440 && curMin < e - 1440);

    if (inWindow) {
      running.push({ ...p, startMin: s, endMin: e });
    } else {
      future.push({ ...p, sortStart: normalizeFuture(s, curMin) });
    }
  });

  // ── Running section ───────────────────────────────────────────────────────
  const runRow   = $("runningRow");
  const thirdRow = $("thirdRow");

  if (running.length) {
    $("runningRow").style.display = ""; 
    thirdRow.style.display = "none";

    const first  = running[0];
    const remain = Math.max(0, first.endMin * 60 - nowSec);
    const total  = (first.endMin - first.startMin) * 60;
    const pct    = Math.min(100, Math.max(0, ((total - remain) / total) * 100));

    const names = running.map(x => x.name).join(",");
    if (names !== lastRunKey) {
      flashShake(runRow);
      lastRunKey = names;
    }

    $("current").innerHTML = `
      <div class="time-row">
        <span class="alert-emoji">🚨</span>
        <span class="time-badge">${first.start} – ${first.end}</span>
        <span class="countdown-badge">⏱ ${Math.floor(remain / 60)}m ${remain % 60}s left</span>
      </div>
      <div class="courier-list running-couriers">
        ${renderCourierLines(running)}
      </div>
      <div class="progress"><div class="bar" style="width:${pct.toFixed(1)}%"></div></div>
    `;
  } else {
    thirdRow.style.display = "grid";
   $("runningRow").style.display = "none";

  }

  // ── Upcoming slots ────────────────────────────────────────────────────────
  const slots = buildSlotMap(future).slice(0, 3);

  ["next1", "next2", "next3"].forEach((id, i) => {
    const slot = slots[i];
    if (!slot) {
      $(id).innerHTML = "—";
      return;
    }
    $(id).innerHTML = `
      <div class="time-row">
        <span>⏳</span>
        <span class="time-badge">${slot.start} – ${slot.end}</span>
      </div>
      <div class="courier-list">
        ${renderCourierLines(slot.pickups)}
      </div>
    `;
  });
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
async function init() {
  // Load schedule
  try {
    const res  = await fetch("data/pickups.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    pickupData = await res.json();
  } catch (err) {
    console.warn("Could not load data/pickups.json:", err);
    pickupData = [];
  }

  // Load counts immediately, then on interval
  await fetchCounts();
  setInterval(fetchCounts, COUNTS_REFRESH_MS);

  // Start render loop
  update();
  setInterval(update, 100);
}

document.addEventListener("DOMContentLoaded", init);
