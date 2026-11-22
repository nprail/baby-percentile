import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/fraunces/latin-500.css';
import '@fontsource/fraunces/latin-600.css';
import './index.css';
import DATA from './growthData.js';
/* ---------- math ---------- */
const KG2LB = 2.20462262185;
const DAYS_PER_MONTH = 30.4375;
const IDX = { p3: 4, p5: 5, p10: 6, p25: 7, p50: 8, p75: 9, p90: 10, p95: 11, p97: 12 };

function interp(sex, age) {
  const d = DATA[sex];
  const a = Math.min(Math.max(age, 0), 36);
  let i = 0;
  while (i < d.length - 2 && d[i + 1][0] < a) i++;
  const r0 = d[i], r1 = d[i + 1];
  const t = r1[0] === r0[0] ? 0 : (a - r0[0]) / (r1[0] - r0[0]);
  return r0.map((v, k) => v + (r1[k] - v) * t);
}
function erf(x) {
  const s = x < 0 ? -1 : 1; x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
const normCdf = z => 0.5 * (1 + erf(z / Math.SQRT2));

function calc(sex, age, lbs) {
  if (!(age >= 0 && age <= 36) || !(lbs > 0)) return null;
  const r = interp(sex, age);
  const L = r[1], M = r[2], S = r[3];
  const kg = lbs / KG2LB;
  const z = Math.abs(L) < 1e-9 ? Math.log(kg / M) / S : (Math.pow(kg / M, L) - 1) / (L * S);
  return { z, pct: normCdf(z) * 100, medianLbs: M * KG2LB };
}

/* ---------- formatting ---------- */
function fmtPct(p) {
  if (p < 0.1) return '<0.1';
  if (p > 99.9) return '>99.9';
  if (p < 1 || p > 99) return p.toFixed(1);
  return String(Math.round(p));
}
function ord(p) {
  const s = fmtPct(p);
  if (/[<>.]/.test(s)) return s + 'th';
  const n = +s, v = n % 100;
  const suf = (v >= 11 && v <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
  return n + suf;
}
function fmtLbOz(lbs) {
  const oz = Math.round(lbs * 16);
  return `${Math.floor(oz / 16)} lb ${oz % 16} oz`;
}
const fmtAge = m => `${m.toFixed(1)} mo`;
function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
const uid = () => Math.random().toString(36).slice(2, 9);

/* ---------- dates & csv ---------- */
function isoDate(y, m, d) {
  if (y < 1900 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}
const MONTHS = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };
const fullYear = y => y >= 100 ? y : (y < 70 ? 2000 + y : 1900 + y);
function localeOrder() {
  try {
    const p = new Intl.DateTimeFormat(undefined).formatToParts(new Date(2000, 10, 25)).map(x => x.type);
    return p.indexOf('day') < p.indexOf('month') ? 'dmy' : 'mdy';
  } catch (e) { return 'mdy'; }
}
/* order: 'mdy' | 'dmy' | 'auto' (auto = whichever is unambiguous, else the device's locale) */
function parseDate(input, order) {
  let s = String(input == null ? '' : input).trim().replace(/^["']|["']$/g, '');
  if (!s) return null;
  if (/^\d{9,13}$/.test(s)) {                                   /* unix seconds / milliseconds */
    const n = +s; const ms = s.length >= 12 ? n : n * 1000;
    if (ms > 6e11 && ms < 4.2e12) { const d = new Date(ms); return isoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
    return null;
  }
  if (/^\d{5}(\.\d+)?$/.test(s)) {                              /* Excel / Sheets serial */
    const n = Math.floor(+s);
    if (n > 20000 && n < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000); return isoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
    return null;
  }
  if (/^(19|20)\d{6}$/.test(s)) return isoDate(+s.slice(0, 4), +s.slice(4, 6), +s.slice(6, 8));
  s = s.toLowerCase()
    .replace(/\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\.?,?/g, ' ')            /* weekdays */
    .replace(/t?\d{1,2}:\d{2}(:\d{2})?(\.\d+)?\s*(am|pm|a\.m\.|p\.m\.)?\s*(z|utc|gmt|[+-]\d{2}:?\d{2})?/g, ' ') /* times */
    .replace(/\b(\d{1,2})(st|nd|rd|th)\b/g, '$1')                                           /* 5th -> 5 */
    .replace(/\b(of|at|the)\b/g, ' ')
    .replace(/[,()]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  let m;
  if ((m = s.match(/^(\d{4})[-\/. ](\d{1,2})[-\/. ](\d{1,2})$/))) return isoDate(+m[1], +m[2], +m[3]);   /* 2026-01-05, 2026/1/5 */
  if ((m = s.match(/^(\d{1,2})[-\/. ](\d{1,2})[-\/. ](\d{2}|\d{4})$/))) {                                /* 1/5/2026, 5.1.26 */
    let a = +m[1], b = +m[2]; const y = fullYear(+m[3]);
    let o = order === 'mdy' || order === 'dmy' ? order : (a > 12 ? 'dmy' : b > 12 ? 'mdy' : localeOrder());
    if (o === 'mdy' && a > 12 && b <= 12) o = 'dmy';           /* impossible month: swap */
    if (o === 'dmy' && b > 12 && a <= 12) o = 'mdy';
    return o === 'mdy' ? isoDate(y, a, b) : isoDate(y, b, a);
  }
  /* anything with a month name: "Jan 5 2026", "5 January 2026", "2026 Jan 5", "5-Jan-26", "Jan-5-2026" */
  const toks = s.split(/[\s\-\/.]+/).filter(Boolean);
  let mon = null; const nums = [];
  for (const tk of toks) {
    if (MONTHS[tk] && mon === null) mon = MONTHS[tk];
    else if (/^\d+$/.test(tk)) nums.push(tk);
    else return null;
  }
  if (mon === null || nums.length !== 2) return null;
  let day, year;
  const four = nums.findIndex(n => n.length === 4);
  if (four >= 0) { year = +nums[four]; day = +nums[1 - four]; }
  else if (+nums[0] > 31) { year = fullYear(+nums[0]); day = +nums[1]; }
  else { day = +nums[0]; year = fullYear(+nums[1]); }
  return isoDate(year, mon, day);
}
/* Decide d/m vs m/d for a whole file from its date cells */
function detectOrder(cells, pref) {
  if (pref === 'mdy' || pref === 'dmy') return { order: pref, ambiguous: false };
  let a12 = false, b12 = false, anyNumeric = false;
  cells.forEach(c => {
    const m = String(c).trim().match(/^(\d{1,2})[-\/. ](\d{1,2})[-\/. ](\d{2}|\d{4})(?!\d)/);
    if (m) { anyNumeric = true; if (+m[1] > 12) a12 = true; if (+m[2] > 12) b12 = true; }
  });
  if (a12 && !b12) return { order: 'dmy', ambiguous: false };
  if (b12 && !a12) return { order: 'mdy', ambiguous: false };
  return { order: localeOrder(), ambiguous: anyNumeric };
}
function monthsBetween(birthIso, dateIso) {
  return (Date.parse(dateIso) - Date.parse(birthIso)) / 86400000 / DAYS_PER_MONTH;
}
function parseWeightCell(raw, unit) {
  const s = String(raw == null ? '' : raw).trim().toLowerCase();
  if (!s) return null;
  let m = s.match(/^(\d+(?:\.\d+)?)\s*(?:lb|lbs|pounds?|#)\s*[,&]?\s*(?:and\s*)?(?:(\d+(?:\.\d+)?)\s*(?:oz|ounces?)?)?$/);
  if (m) return +m[1] + (m[2] ? +m[2] / 16 : 0);
  m = s.match(/^(\d+(?:\.\d+)?)\s*(?:kg|kgs|kilograms?)$/);
  if (m) return +m[1] * KG2LB;
  m = s.match(/^(\d+(?:\.\d+)?)\s*(?:oz|ounces?)$/);
  if (m) return +m[1] / 16;
  m = s.match(/^(\d+(?:\.\d+)?)$/);
  if (m) { const v = +m[1]; return unit === 'kg' ? v * KG2LB : unit === 'oz' ? v / 16 : v; }
  return null;
}
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const delim = [',', '\t', ';'].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  row.push(cell); rows.push(row);
  return rows.map(r => r.map(c => c.trim())).filter(r => r.some(c => c !== ''));
}
function importMeasurements(text, unit, datePref) {
  const rows = parseCSV(text);
  if (!rows.length) return { items: [], error: 'That file looks empty.' };
  const isHeader = rows[0].every(c => c === '' || (parseDate(c) === null && parseWeightCell(c, 'lb') === null));
  const head = isHeader ? rows[0].map(h => h.toLowerCase()) : null;
  const body = isHeader ? rows.slice(1) : rows;
  const find = re => head ? head.findIndex(h => re.test(h)) : -1;
  const ageCol = find(/age|month|week|\bwk|\bmo\b/);
  let dateCol = find(/date|when|measured|timestamp|visit|checkup|recorded|logged/);
  const lbCol = find(/(^|[^a-z])(lb|lbs|pound|pounds)([^a-z]|$)/);
  const ozCol = find(/(^|[^a-z])(oz|ounce|ounces)([^a-z]|$)/);
  const kgCol = find(/(^|[^a-z])(kg|kgs|kilo|kilos|kilogram|kilograms)([^a-z]|$)/);
  const wCol = find(/weight|wt|mass/);
  if (head && ageCol < 0 && dateCol < 0) {   /* unnamed date column: look for one by content */
    const taken = new Set([lbCol, ozCol, kgCol, wCol]);
    for (let j = 0; j < head.length; j++) {
      if (taken.has(j)) continue;
      const sample = body.slice(0, 6).map(r => r[j]).filter(Boolean);
      if (sample.length && sample.filter(v => parseDate(v) !== null).length >= Math.ceil(sample.length * 0.6)) { dateCol = j; break; }
    }
  }
  const positional = !head || (ageCol < 0 && dateCol < 0 && lbCol < 0 && kgCol < 0 && ozCol < 0 && wCol < 0);
  if (!positional && lbCol < 0 && kgCol < 0 && ozCol < 0 && wCol < 0) return { items: [], error: "Couldn't find a weight column. Name it something like “Weight (lbs)”." };
  if (!positional && ageCol < 0 && dateCol < 0) return { items: [], error: "Couldn't find a date or age column. Name it “Date” or “Age (months)”." };

  const getW = r => {
    if (positional) return parseWeightCell(r[1], unit);
    if (lbCol >= 0 && ozCol >= 0 && lbCol !== ozCol) {
      const a = parseFloat(r[lbCol]); const b = parseFloat(r[ozCol]) || 0;
      return isNaN(a) ? null : a + b / 16;
    }
    if (lbCol >= 0) return parseWeightCell(r[lbCol], 'lb');
    if (kgCol >= 0) return parseWeightCell(r[kgCol], 'kg');
    if (ozCol >= 0) return parseWeightCell(r[ozCol], 'oz');
    return parseWeightCell(r[wCol], unit);
  };
  const ageHead = ageCol >= 0 ? head[ageCol] : '';
  const ageFactor = /week|wk/.test(ageHead) ? 12 / 52.1775 : /day/.test(ageHead) ? 1 / DAYS_PER_MONTH : 1;

  const dateCells = body.map(r => positional ? r[0] : (dateCol >= 0 && ageCol < 0 ? r[dateCol] : '')).filter(Boolean);
  const { order, ambiguous } = detectOrder(dateCells, datePref);
  const items = []; let skipped = 0;
  body.forEach(r => {
    const w = getW(r);
    if (w == null || !(w > 0)) { skipped++; return; }
    let date = null, age = null, raw;
    if (positional) {
      raw = r[0]; date = parseDate(raw, order);
      if (!date) { const v = parseFloat(r[0]); if (!isNaN(v)) age = v; }
    } else if (ageCol >= 0) {
      const v = parseFloat(r[ageCol]); if (!isNaN(v)) age = v * ageFactor;
    } else {
      raw = r[dateCol]; date = parseDate(raw, order);
    }
    if (date == null && age == null) { skipped++; return; }
    items.push(date ? { id: uid(), date, raw, lbs: w } : { id: uid(), age, lbs: w });
  });
  if (!items.length) return { items, error: 'No usable rows found. Each row needs a date (or age) and a weight.' };
  return { items, skipped, order, ambiguous };
}

/* ---------- estimate today's weight when the last weigh-in is stale ---------- */
function localToday() { const d = new Date(); return isoDate(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
function weightAtZ(sex, age, z) {
  const r = interp(sex, age), L = r[1], M = r[2], S = r[3];
  const base = 1 + L * S * z;
  const kg = Math.abs(L) < 1e-9 ? M * Math.exp(S * z) : (base > 0 ? M * Math.pow(base, 1 / L) : NaN);
  return kg * KG2LB;
}
/* Carries the baby's own growth curve forward: keep the latest z-score, nudged halfway along the recent trend. */
function estimateNow(sex, good, birth, todayIso) {
  if (!birth || !good.length) return null;
  const last = good[good.length - 1];
  const today = todayIso || localToday();
  const ageNow = monthsBetween(birth, today);
  if (!(ageNow > last.age) || ageNow > 36) return null;
  const gapDays = last.date ? (Date.parse(today) - Date.parse(last.date)) / 86400000 : (ageNow - last.age) * DAYS_PER_MONTH;
  if (!(last.date ? gapDays >= 2 : gapDays > 1)) return null;     /* only when more than a day old */
  const recent = good.slice(-3);
  let drift = 0;
  if (recent.length >= 2 && (last.age - recent[0].age) * DAYS_PER_MONTH >= 5) {
    const n = recent.length, mx = recent.reduce((s, p) => s + p.age, 0) / n, mz = recent.reduce((s, p) => s + p.res.z, 0) / n;
    const den = recent.reduce((s, p) => s + (p.age - mx) ** 2, 0);
    const slope = den > 0 ? recent.reduce((s, p) => s + (p.age - mx) * (p.res.z - mz), 0) / den : 0;   /* z per month */
    drift = Math.max(-0.5, Math.min(0.5, 0.5 * slope * (ageNow - last.age)));
  }
  const z = last.res.z + drift;
  let lbs = weightAtZ(sex, ageNow, z);
  if (!(lbs > 0)) return null;
  if (last.age >= 0.5) lbs = Math.max(lbs, last.lbs);               /* weight rarely drops after the newborn weeks */
  const hw = Math.min(0.6, 0.15 + 0.01 * gapDays);
  const lo = Math.min(weightAtZ(sex, ageNow, z - hw), lbs), hi = Math.max(weightAtZ(sex, ageNow, z + hw), lbs);
  return { age: ageNow, lbs, lo, hi, z, pct: normCdf(z) * 100, gapDays, last };
}
const fmtGap = d => d < 14 ? `${Math.round(d)} days` : `${Math.round(d / 7)} weeks`;

/* ---------- chart data ---------- */
function buildRows(sex, pts, xMax, est) {
  const ages = new Set();
  for (let a = 0; a <= xMax + 1e-9; a += 0.5) ages.add(+a.toFixed(3));
  ages.add(xMax);
  if (est) ages.add(+est.age.toFixed(3));
  const baby = new Map();
  pts.forEach(p => {
    if (p.age <= xMax) { const k = +p.age.toFixed(3); ages.add(k); baby.set(k, p); }
  });
  return [...ages].sort((a, b) => a - b).map(age => {
    const r = interp(sex, age);
    const v = {}; Object.keys(IDX).forEach(k => v[k] = r[IDX[k]] * KG2LB);
    const b = baby.get(age);
    const e = {};
    if (est) {
      if (age === +est.last.age.toFixed(3)) e.est = est.last.lbs;
      if (age === +est.age.toFixed(3)) Object.assign(e, { est: est.lbs, isEst: true, estLo: est.lo, estHi: est.hi, estPct: est.pct });
    }
    return {
      age, ...v, ...e,
      b0: v.p3, b1: v.p10 - v.p3, b2: v.p25 - v.p10, b3: v.p75 - v.p25, b4: v.p90 - v.p75, b5: v.p97 - v.p90,
      baby: b ? b.lbs : undefined, babyPct: b ? b.res.pct : undefined
    };
  });
}

/* ---------- ui bits ---------- */
const inputCls = 'w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-base md:text-sm md:min-h-0 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500 transition';
const labelCls = 'block text-xs font-semibold text-slate-500 mb-1.5';
const card = 'bg-white/80 backdrop-blur rounded-3xl shadow-sm ring-1 ring-slate-200/70';

function Seg({ value, onChange, options, small }) {
  return (
    <div className="inline-flex w-full rounded-xl bg-slate-100 p-1 select-none">
      {options.map(o => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          className={`flex-1 ${small ? 'px-2.5 py-2 md:py-1 text-xs' : 'px-3 py-2.5 md:py-1.5 text-sm'} rounded-lg font-semibold transition ${value === o.value ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Gauge({ pct }) {
  const ticks = [3, 10, 25, 50, 75, 90, 97];
  return (
    <div className="pt-2">
      <div className="relative h-3 rounded-full" style={{ background: 'linear-gradient(90deg,#ccfbf1 0%,#5eead4 50%,#ccfbf1 100%)' }}>
        {ticks.map(t => <span key={t} className="absolute top-0 h-3 w-px bg-white/90" style={{ left: t + '%' }} />)}
        <span className="absolute -top-1.5 h-6 w-6 -ml-3 rounded-full bg-rose-500 ring-4 ring-white shadow-md transition-all duration-500" style={{ left: Math.min(Math.max(pct, 1.5), 98.5) + '%' }} />
      </div>
      <div className="relative h-5 mt-2 text-[10px] font-medium text-slate-400">
        {ticks.map(t => <span key={t} className="absolute -translate-x-1/2" style={{ left: t + '%' }}>{t}</span>)}
      </div>
    </div>
  );
}

function ChartTip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const r = payload[0].payload;
  return (
    <div className="rounded-2xl bg-white px-4 py-3 shadow-xl ring-1 ring-slate-200 text-sm min-w-[190px]">
      <div className="text-xs font-semibold text-slate-400 mb-1.5">{fmtAge(r.age)} old</div>
      {r.baby != null && (
        <div className="mb-2 pb-2 border-b border-slate-100">
          <div className="flex items-center gap-2 font-semibold text-slate-800"><span className="h-2.5 w-2.5 rounded-full bg-rose-500" />{fmtLbOz(r.baby)}<span className="text-slate-400 font-normal">({r.baby.toFixed(2)} lb)</span></div>
          <div className="text-rose-600 font-semibold ml-4.5 pl-[18px]">{ord(r.babyPct)} percentile</div>
        </div>
      )}
      {r.isEst && (
        <div className="mb-2 pb-2 border-b border-slate-100">
          <div className="flex items-center gap-2 font-semibold text-slate-800"><span className="h-2.5 w-2.5 rounded-full border-2 border-rose-500 bg-white" />≈ {fmtLbOz(r.est)}</div>
          <div className="pl-[18px] text-xs text-slate-500">Estimate · {fmtLbOz(r.estLo)} – {fmtLbOz(r.estHi)}</div>
          <div className="pl-[18px] text-rose-600 font-semibold">~{ord(r.estPct)} percentile</div>
        </div>
      )}
      <div className="space-y-0.5 text-xs text-slate-500">
        {[['97th', r.p97], ['75th', r.p75], ['50th', r.p50], ['25th', r.p25], ['3rd', r.p3]].map(([k, v]) => (
          <div key={k} className="flex justify-between gap-6"><span>{k}</span><span className="tabular-nums font-medium text-slate-700">{v.toFixed(1)} lb</span></div>
        ))}
      </div>
    </div>
  );
}

function GrowthChart({ sex, pts, range, est }) {
  const maxAge = pts.length ? Math.max(...pts.map(p => p.age), est ? est.age : 0) : 0;
  const xMax = range === 'auto' ? Math.min(36, Math.max(6, Math.ceil(maxAge) + 3)) : +range;
  const visible = pts.filter(p => p.age <= xMax);
  const e = est && est.age <= xMax ? est : null;
  const rows = useMemo(() => buildRows(sex, visible, xMax, e), [sex, pts, xMax, est]);
  const lo = Math.min(...rows.map(r => r.p3), ...visible.map(p => p.lbs));
  const hi = Math.max(...rows.map(r => r.p97), ...visible.map(p => p.lbs), e ? e.hi : 0);
  const yMin = Math.max(0, Math.floor(lo - 0.5)), yMax = Math.ceil(hi + 0.5);
  const step = xMax <= 12 ? 1 : xMax <= 24 ? 2 : 3;
  const xTicks = []; for (let t = 0; t <= xMax; t += step) xTicks.push(t);
  const n = rows.length;
  const endLabel = txt => p => p.index === n - 1
    ? <text x={p.x + 8} y={p.y} dy={3.5} fontSize="10.5" fontWeight="600" fill="#64748b">{txt}</text>
    : <g />;
  const T = '#0f766e';
  return (
    <div className="h-[320px] sm:h-[440px] -ml-3 sm:-ml-2">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 12, right: 34, bottom: 22, left: 0 }}>
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="2 4" vertical={false} />
          <XAxis type="number" dataKey="age" domain={[0, xMax]} ticks={xTicks} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }}
            label={{ value: 'Age (months)', position: 'insideBottom', offset: -14, fontSize: 11, fill: '#64748b', fontWeight: 600 }} />
          <YAxis type="number" domain={[yMin, yMax]} allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} width={44}
            label={{ value: 'Weight (lb)', angle: -90, position: 'insideLeft', offset: 14, fontSize: 11, fill: '#64748b', fontWeight: 600, style: { textAnchor: 'middle' } }} />
          <Tooltip content={<ChartTip />} cursor={{ stroke: '#94a3b8', strokeDasharray: '3 3' }} isAnimationActive={false} />
          <Area dataKey="b0" stackId="s" stroke="none" fill="none" isAnimationActive={false} activeDot={false} />
          <Area dataKey="b1" stackId="s" stroke="none" fill={T} fillOpacity={0.07} isAnimationActive={false} activeDot={false} />
          <Area dataKey="b2" stackId="s" stroke="none" fill={T} fillOpacity={0.13} isAnimationActive={false} activeDot={false} />
          <Area dataKey="b3" stackId="s" stroke="none" fill={T} fillOpacity={0.21} isAnimationActive={false} activeDot={false} />
          <Area dataKey="b4" stackId="s" stroke="none" fill={T} fillOpacity={0.13} isAnimationActive={false} activeDot={false} />
          <Area dataKey="b5" stackId="s" stroke="none" fill={T} fillOpacity={0.07} isAnimationActive={false} activeDot={false} />
          <Line dataKey="p3" stroke={T} strokeOpacity={0.45} strokeWidth={1} dot={false} activeDot={false} isAnimationActive={false} label={endLabel('3rd')} />
          <Line dataKey="p10" stroke={T} strokeOpacity={0.3} strokeWidth={1} dot={false} activeDot={false} isAnimationActive={false} />
          <Line dataKey="p25" stroke={T} strokeOpacity={0.45} strokeWidth={1} dot={false} activeDot={false} isAnimationActive={false} label={endLabel('25th')} />
          <Line dataKey="p50" stroke={T} strokeWidth={1.5} strokeDasharray="5 4" dot={false} activeDot={false} isAnimationActive={false} label={endLabel('50th')} />
          <Line dataKey="p75" stroke={T} strokeOpacity={0.45} strokeWidth={1} dot={false} activeDot={false} isAnimationActive={false} label={endLabel('75th')} />
          <Line dataKey="p90" stroke={T} strokeOpacity={0.3} strokeWidth={1} dot={false} activeDot={false} isAnimationActive={false} />
          <Line dataKey="p97" stroke={T} strokeOpacity={0.45} strokeWidth={1} dot={false} activeDot={false} isAnimationActive={false} label={endLabel('97th')} />
          {e && <Line dataKey="est" stroke="#e11d48" strokeWidth={2.5} strokeDasharray="1 7" strokeLinecap="round" connectNulls isAnimationActive={false} activeDot={false}
            dot={p => p.payload.isEst ? <circle key={'e' + p.index} cx={p.cx} cy={p.cy} r={7} fill="#fff" stroke="#e11d48" strokeWidth={3} /> : <g key={'e' + p.index} />} />}
          <Line dataKey="baby" stroke="#e11d48" strokeWidth={2.5} connectNulls isAnimationActive={false}
            dot={{ r: 5, fill: '#e11d48', stroke: '#fff', strokeWidth: 2 }} activeDot={{ r: 7, fill: '#e11d48', stroke: '#fff', strokeWidth: 2 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function AddForm({ birth, sex, onAdd }) {
  const [mode, setMode] = useState(birth ? 'date' : 'age');
  const [date, setDate] = useState('');
  const [age, setAge] = useState('');
  const [lb, setLb] = useState('');
  const [oz, setOz] = useState('');
  const lbs = (parseFloat(lb) || 0) + (parseFloat(oz) || 0) / 16;
  const ageVal = mode === 'date' ? (birth && date ? monthsBetween(birth, date) : null) : (age !== '' ? parseFloat(age) : null);
  const res = lbs > 0 && ageVal != null && !isNaN(ageVal) ? calc(sex, ageVal < 0 && ageVal > -0.1 ? 0 : ageVal, lbs) : null;
  const canAdd = res != null;
  const submit = e => {
    e.preventDefault();
    if (!canAdd) return;
    onAdd(mode === 'date' ? { date, lbs } : { age: ageVal, lbs });
    setLb(''); setOz(''); setDate(''); setAge('');
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <Seg small value={mode} onChange={setMode} options={[{ value: 'date', label: 'By date' }, { value: 'age', label: 'By age' }]} />
      {mode === 'date' ? (
        <div>
          <label className={labelCls}>Weigh-in date</label>
          <input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} />
          {!birth && <p className="mt-1.5 text-xs text-amber-600">Set a birth date above to use dates.</p>}
        </div>
      ) : (
        <div>
          <label className={labelCls}>Age (months, 0–36)</label>
          <input type="number" step="0.1" min="0" max="36" placeholder="e.g. 4.5" className={inputCls} value={age} onChange={e => setAge(e.target.value)} />
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div><label className={labelCls}>Pounds</label><input type="number" step="0.01" min="0" placeholder="14" className={inputCls} value={lb} onChange={e => setLb(e.target.value)} /></div>
        <div><label className={labelCls}>Ounces</label><input type="number" step="0.1" min="0" placeholder="3" className={inputCls} value={oz} onChange={e => setOz(e.target.value)} /></div>
      </div>
      <div className={`rounded-2xl px-4 py-3 text-sm transition ${res ? 'bg-teal-50 ring-1 ring-teal-100' : 'bg-slate-50 text-slate-400'}`}>
        {res ? (<div className="flex items-baseline justify-between"><span className="text-slate-500">Percentile</span><span className="font-display text-2xl font-semibold text-teal-700">{ord(res.pct)}</span></div>)
          : ageVal != null && !isNaN(ageVal) && (ageVal > 36 || ageVal < 0) ? 'Age must be between 0 and 36 months.' : 'Enter an age and weight to preview the percentile.'}
      </div>
      <button type="submit" disabled={!canAdd} className="w-full rounded-xl bg-teal-600 py-3 md:py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed transition">Add to chart</button>
    </form>
  );
}


/* ---------- shareable 9:16 image ---------- */
const SHARE_W = 1080, SHARE_H = 1920;
const DISPLAY = 'Fraunces, Georgia, serif', SANS = 'Inter, system-ui, -apple-system, sans-serif';
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function fmtAgeLong(m) {
  if (m < 0.25) return 'Newborn';
  if (m < 2) return `${Math.round(m * DAYS_PER_MONTH / 7)} weeks old`;
  return `${+m.toFixed(1)} months old`;
}
function fmtSpan(m) {
  if (m < 2) return `${Math.max(1, Math.round(m * DAYS_PER_MONTH / 7))} wk`;
  return `${+m.toFixed(1)} mo`;
}
/* Pure canvas drawing: ctx is any 2D context sized SHARE_W x SHARE_H. */
function drawShare(ctx, { sex, name, pts }) {
  const W = SHARE_W, H = SHARE_H, T = '#0f766e', ROSE = '#e11d48', INK = '#0f172a', MUTE = '#64748b', FAINT = '#94a3b8';
  const latest = pts[pts.length - 1], first = pts[0], res = latest.res;
  const text = (s, x, y, size, weight, color, o = {}) => {
    ctx.font = `${weight} ${size}px ${o.family || SANS}`; ctx.fillStyle = color; ctx.textAlign = o.align || 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(s, x, y);
  };
  const card = (x, y, w, h, r) => {
    ctx.save(); ctx.shadowColor = 'rgba(15,23,42,.10)'; ctx.shadowBlur = 50; ctx.shadowOffsetY = 16;
    rr(ctx, x, y, w, h, r); ctx.fillStyle = '#fff'; ctx.fill(); ctx.restore();
    rr(ctx, x, y, w, h, r); ctx.strokeStyle = 'rgba(226,232,240,.8)'; ctx.lineWidth = 2; ctx.stroke();
  };

  /* background */
  let g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#ccfbf1'); g.addColorStop(0.45, '#ffffff'); g.addColorStop(1, '#ffe4e6');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  [[W * 0.9, 60, 560, '20,184,166', 0.20], [W * 0.05, H * 0.95, 620, '244,63,94', 0.15]].forEach(([cx, cy, r, c, a]) => {
    const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    rg.addColorStop(0, `rgba(${c},${a})`); rg.addColorStop(1, `rgba(${c},0)`);
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
  });

  /* header */
  ctx.font = `700 24px ${SANS}`;
  const label = 'WEIGHT PERCENTILE', lw = ctx.measureText(label).width + 84;
  rr(ctx, 72, 96, lw, 58, 29); ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fill(); ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 2; ctx.stroke();
  ctx.beginPath(); ctx.arc(104, 125, 7, 0, Math.PI * 2); ctx.fillStyle = '#14b8a6'; ctx.fill();
  text(label, 126, 134, 24, 700, T, { align: 'left' });
  const title = name ? `${name}’s growth` : 'Growth update';
  let ts = 92; ctx.font = `600 ${ts}px ${DISPLAY}`;
  while (ctx.measureText(title).width > W - 144 && ts > 40) { ts -= 4; ctx.font = `600 ${ts}px ${DISPLAY}`; }
  text(title, 72, 268, ts, 600, INK, { align: 'left', family: DISPLAY });
  text(fmtAgeLong(latest.age), 72, 336, 40, 500, MUTE, { align: 'left' });

  /* hero */
  card(72, 400, 936, 520, 56);
  text('PERCENTILE', W / 2, 482, 26, 700, FAINT);
  const m = ord(res.pct).match(/^([<>]?[\d.]+)(\D+)$/) || [null, fmtPct(res.pct), 'th'];
  ctx.font = `600 270px ${DISPLAY}`; const nw = ctx.measureText(m[1]).width;
  ctx.font = `600 92px ${DISPLAY}`; const sw = ctx.measureText(m[2]).width;
  const x0 = W / 2 - (nw + sw + 8) / 2;
  text(m[1], x0, 710, 270, 600, ROSE, { align: 'left', family: DISPLAY });
  text(m[2], x0 + nw + 8, 580, 92, 600, ROSE, { align: 'left', family: DISPLAY });
  text(`of ${sex === 'boy' ? 'boys' : 'girls'} this age`, W / 2, 778, 40, 500, MUTE);
  const gx = 156, gw = 768, gy = 832;
  const gg = ctx.createLinearGradient(gx, 0, gx + gw, 0);
  gg.addColorStop(0, '#ccfbf1'); gg.addColorStop(0.5, '#5eead4'); gg.addColorStop(1, '#ccfbf1');
  rr(ctx, gx, gy, gw, 24, 12); ctx.fillStyle = gg; ctx.fill();
  [3, 10, 25, 50, 75, 90, 97].forEach(p => {
    const x = gx + gw * p / 100;
    ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.fillRect(x - 1.5, gy, 3, 24);
    text(String(p), x, gy + 62, 22, 600, FAINT);
  });
  const mx = gx + gw * Math.min(Math.max(res.pct, 1.5), 98.5) / 100;
  ctx.beginPath(); ctx.arc(mx, gy + 12, 24, 0, Math.PI * 2); ctx.fillStyle = ROSE; ctx.fill(); ctx.lineWidth = 8; ctx.strokeStyle = '#fff'; ctx.stroke();

  /* tiles */
  const diff = latest.lbs - res.medianLbs;
  let t3;
  if (pts.length > 1) {
    const d = latest.lbs - first.lbs;
    t3 = ['GAINED', `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)} lb`, `over ${fmtSpan(latest.age - first.age)}`];
  } else t3 = ['WEIGH-INS', '1', 'recorded'];
  const tiles = [
    ['WEIGHT', fmtLbOz(latest.lbs), `${latest.lbs.toFixed(2)} lbs`],
    ['VS MEDIAN', `${diff >= 0 ? '+' : '−'}${Math.abs(diff).toFixed(1)} lb`, `50th: ${fmtLbOz(res.medianLbs)}`],
    t3
  ];
  const tw = (936 - 48) / 3;
  tiles.forEach(([l, v, s], i) => {
    const x = 72 + i * (tw + 24);
    card(x, 950, tw, 176, 44);
    text(l, x + tw / 2, 1004, 22, 700, FAINT);
    let vs = 44; ctx.font = `600 ${vs}px ${DISPLAY}`;
    while (ctx.measureText(v).width > tw - 36 && vs > 24) { vs -= 2; ctx.font = `600 ${vs}px ${DISPLAY}`; }
    text(v, x + tw / 2, 1066, vs, 600, INK, { family: DISPLAY });
    text(s, x + tw / 2, 1104, 23, 500, MUTE);
  });

  /* chart card */
  const cx = 72, cy = 1156, cw = 936, ch = 634;
  card(cx, cy, cw, ch, 56);
  text('WEIGHT FOR AGE', cx + 48, cy + 74, 24, 700, FAINT, { align: 'left' });
  /* legend, right-aligned */
  let lx = cx + cw - 48;
  ctx.font = `500 22px ${SANS}`;
  const leg = [['3rd–97th', 'band'], ['Median', 'dash'], ['Baby', 'baby']];
  leg.forEach(([s, kind]) => {
    ctx.font = `500 22px ${SANS}`; const w = ctx.measureText(s).width;
    text(s, lx, cy + 74, 22, 500, MUTE, { align: 'right' });
    lx -= w + 12;
    if (kind === 'band') { ctx.fillStyle = 'rgba(15,118,110,.22)'; rr(ctx, lx - 30, cy + 58, 30, 18, 4); ctx.fill(); lx -= 30; }
    else if (kind === 'dash') { ctx.strokeStyle = T; ctx.lineWidth = 3; ctx.setLineDash([8, 5]); ctx.beginPath(); ctx.moveTo(lx - 32, cy + 67); ctx.lineTo(lx, cy + 67); ctx.stroke(); ctx.setLineDash([]); lx -= 32; }
    else { ctx.strokeStyle = ROSE; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(lx - 32, cy + 67); ctx.lineTo(lx, cy + 67); ctx.stroke(); ctx.beginPath(); ctx.arc(lx - 16, cy + 67, 7, 0, Math.PI * 2); ctx.fillStyle = ROSE; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke(); lx -= 32; }
    lx -= 26;
  });

  const maxAge = Math.max(...pts.map(p => p.age));
  const xMax = Math.min(36, Math.max(6, Math.ceil(maxAge) + 3));
  const rows = buildRows(sex, pts, xMax);
  const lo = Math.min(...rows.map(r => r.p3), ...pts.map(p => p.lbs)), hi = Math.max(...rows.map(r => r.p97), ...pts.map(p => p.lbs));
  const yMin = Math.max(0, Math.floor(lo - 0.5)), yMax = Math.ceil(hi + 0.5);
  const L = cx + 48 + 62, R = cx + cw - 48 - 72, TOP = cy + 118, BOT = cy + ch - 128;
  const sx = a => L + a / xMax * (R - L), sy = v => BOT - (v - yMin) / (yMax - yMin) * (BOT - TOP);
  /* grid + y ticks */
  const span = yMax - yMin, ystep = span <= 8 ? 1 : span <= 16 ? 2 : span <= 30 ? 5 : 10;
  ctx.lineWidth = 2; ctx.setLineDash([3, 9]); ctx.strokeStyle = '#cbd5e1';
  for (let v = Math.ceil(yMin / ystep) * ystep; v <= yMax; v += ystep) {
    ctx.beginPath(); ctx.moveTo(L, sy(v)); ctx.lineTo(R, sy(v)); ctx.stroke();
    text(String(v), L - 16, sy(v) + 8, 24, 500, MUTE, { align: 'right' });
  }
  ctx.setLineDash([]);
  const xstep = xMax <= 12 ? 1 : xMax <= 24 ? 2 : 3;
  ctx.strokeStyle = '#cbd5e1'; ctx.beginPath(); ctx.moveTo(L, BOT); ctx.lineTo(R, BOT); ctx.stroke();
  for (let a = 0; a <= xMax; a += xstep) text(String(a), sx(a), BOT + 40, 24, 500, MUTE);
  text('Age (months)', (L + R) / 2, BOT + 88, 24, 600, MUTE);
  ctx.save(); ctx.translate(cx + 52, (TOP + BOT) / 2); ctx.rotate(-Math.PI / 2); text('Weight (lb)', 0, 0, 24, 600, MUTE); ctx.restore();
  /* bands */
  const band = (up, dn, a) => {
    ctx.beginPath(); rows.forEach((r, i) => i ? ctx.lineTo(sx(r.age), sy(r[up])) : ctx.moveTo(sx(r.age), sy(r[up])));
    for (let i = rows.length - 1; i >= 0; i--) ctx.lineTo(sx(rows[i].age), sy(rows[i][dn]));
    ctx.closePath(); ctx.fillStyle = `rgba(15,118,110,${a})`; ctx.fill();
  };
  band('p10', 'p3', 0.08); band('p25', 'p10', 0.15); band('p75', 'p25', 0.24); band('p90', 'p75', 0.15); band('p97', 'p90', 0.08);
  const line = (k, w, a, dash) => {
    ctx.beginPath(); rows.forEach((r, i) => i ? ctx.lineTo(sx(r.age), sy(r[k])) : ctx.moveTo(sx(r.age), sy(r[k])));
    ctx.setLineDash(dash || []); ctx.lineWidth = w; ctx.strokeStyle = `rgba(15,118,110,${a})`; ctx.stroke(); ctx.setLineDash([]);
  };
  line('p3', 2.5, 0.5); line('p10', 2, 0.3); line('p25', 2.5, 0.5); line('p75', 2.5, 0.5); line('p90', 2, 0.3); line('p97', 2.5, 0.5); line('p50', 4, 1, [14, 10]);
  /* end labels, nudged apart */
  const last = rows[rows.length - 1];
  const labs = [['97th', 'p97'], ['75th', 'p75'], ['50th', 'p50'], ['25th', 'p25'], ['3rd', 'p3']].map(([s, k]) => ({ s, y: sy(last[k]) + 8 }));
  for (let i = 1; i < labs.length; i++) if (labs[i].y < labs[i - 1].y + 28) labs[i].y = labs[i - 1].y + 28;
  labs.forEach(l => text(l.s, R + 14, l.y, 24, 600, MUTE, { align: 'left' }));
  /* baby */
  const bp = rows.filter(r => r.baby != null);
  ctx.beginPath(); bp.forEach((r, i) => i ? ctx.lineTo(sx(r.age), sy(r.baby)) : ctx.moveTo(sx(r.age), sy(r.baby)));
  ctx.lineWidth = 7; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = ROSE; ctx.stroke();
  bp.forEach(r => { ctx.beginPath(); ctx.arc(sx(r.age), sy(r.baby), 11, 0, Math.PI * 2); ctx.fillStyle = ROSE; ctx.fill(); ctx.lineWidth = 5; ctx.strokeStyle = '#fff'; ctx.stroke(); });
  const lp = bp[bp.length - 1], lpx = sx(lp.age), lpy = sy(lp.baby);
  const bub = ord(lp.babyPct); ctx.font = `700 30px ${SANS}`;
  const bw = ctx.measureText(bub).width + 40;
  const bx = Math.min(Math.max(lpx - bw / 2, L), R - bw), by = lpy - 82;
  rr(ctx, bx, by, bw, 50, 25); ctx.fillStyle = ROSE; ctx.fill();
  ctx.beginPath(); ctx.moveTo(lpx - 10, by + 48); ctx.lineTo(lpx + 10, by + 48); ctx.lineTo(lpx, by + 64); ctx.closePath(); ctx.fill();
  text(bub, bx + bw / 2, by + 35, 30, 700, '#fff');

  text('CDC weight-for-age growth data · birth to 36 months', W / 2, 1862, 24, 500, FAINT);
}
async function renderShareImage({ sex, name, pts }) {
  try {
    await withTimeout(Promise.all([
      document.fonts.load('600 80px Fraunces'), document.fonts.load('600 30px Inter'),
      document.fonts.load('500 30px Inter'), document.fonts.load('700 30px Inter')
    ]), 3000);
  } catch (e) {}
  const c = document.createElement('canvas'); c.width = SHARE_W; c.height = SHARE_H;
  drawShare(c.getContext('2d'), { sex, name, pts });
  return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), 'image/png'));
}
async function saveBlob(blob, filename) {
  try {
    const dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null;
    if (dl) { await dl.save({ filename, data: blob }); return 'saved'; }
  } catch (e) { if (e && e.code === 'declined') return 'declined'; }
  try {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove(); return 'saved';
  } catch (e) { return 'failed'; }
}

function ShareModal({ url, busy, hasName, showName, setShowName, onSave, onClose, msg }) {
  useEffect(() => {
    const k = e => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm" onClick={onClose}>
      <div className="min-h-full flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-3xl bg-white p-4 shadow-2xl" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-3 px-1">
            <h3 className="font-display text-lg font-semibold">Share image</h3>
            <button type="button" aria-label="Close" onClick={onClose} className="h-10 w-10 -mr-2 flex items-center justify-center text-2xl text-slate-400 hover:text-slate-600">×</button>
          </div>
          <div className="mx-auto overflow-hidden rounded-2xl bg-slate-100 shadow-inner" style={{ aspectRatio: '9 / 16', maxHeight: '62vh' }}>
            {url ? <img src={url} alt="Shareable growth graphic" className="h-full w-full object-contain" /> : <div className="h-full w-full flex items-center justify-center text-sm text-slate-400">{busy ? 'Drawing…' : ''}</div>}
          </div>
          {hasName && (
            <label className="mt-3 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-600 cursor-pointer">
              Include name
              <input type="checkbox" checked={showName} onChange={e => setShowName(e.target.checked)} className="h-5 w-5 accent-teal-600" />
            </label>
          )}
          <button type="button" disabled={!url} onClick={onSave} className="mt-3 w-full rounded-xl bg-teal-600 py-3 text-sm font-semibold text-white shadow-sm hover:bg-teal-700 disabled:opacity-40 transition">Save image</button>
          <p className="mt-2 px-1 text-center text-xs text-slate-400">{msg || 'You can also press and hold the image to save or share it. 1080 × 1920 PNG.'}</p>
        </div>
      </div>
    </div>
  );
}

const SAMPLE = [[0, 7.5], [0.5, 8.4], [1, 9.9], [2, 12.1], [3, 14.0], [4, 15.4], [5, 16.5], [6, 17.4]];
const EXAMPLE = `date,weight_lbs\n2026-06-20,7.6\n2026-07-05,8.3\n2026-08-04,9.6\n2026-10-02,12.1`;

const LS_KEY = 'bpc-v1';
function load() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (e) { return {}; }
}
const withTimeout = (p, ms) => Promise.race([p, new Promise(res => setTimeout(() => res(undefined), ms))]);
/* If the page is hosted where Claude offers per-person storage, mirror saved data there so it follows the
   person across devices; otherwise (or on any failure) localStorage alone is used. */
async function openCloud() {
  try {
    if (!(window.claude && window.claude.use)) return null;
    const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
    if (!db || !user || !user.id) return null;
    const id = await user.id();
    return db.collection('data/users/' + id).doc('baby');
  } catch (e) { return null; }
}
async function readCloud(ref) {
  try {
    const snap = await withTimeout(ref.get(), 8000);
    if (!snap) return null;
    let d = typeof snap.data === 'function' ? snap.data() : (snap.data !== undefined ? snap.data : snap);
    if (typeof snap.exists === 'function' ? !snap.exists() : snap.exists === false) return null;
    if (d && typeof d.json === 'string') return { ...JSON.parse(d.json), ts: d.ts || 0 };
    return null;
  } catch (e) { return null; }
}

/* ---------- end-to-end encrypted sync ----------
   One random 256-bit secret lives in the share link's #fragment (never sent to the server). Everything else is
   derived from it with HKDF:   edit secret M -> read secret R (+ write token W);  R -> id, AES-GCM key K.
   The server stores ciphertext under `id` and checks sha256(W) on writes; it never sees M, R, K or any data.
   A "view" link carries only R, so it can decrypt but cannot derive W and therefore cannot write. */
const SYNC_KEY = 'bpc-sync';
const SECRET_RE = /^[A-Za-z0-9_-]{43}$/;
const te = new TextEncoder(), td = new TextDecoder();
function b64uEnc(bytes) {
  let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64uDec(str) {
  const b = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
  return Uint8Array.from(b, c => c.charCodeAt(0));
}
async function hkdf(secret, info, bytes = 32) {
  const k = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: te.encode(info) }, k, bytes * 8));
}
async function deriveKeys(mode, secret) {
  const base = b64uDec(secret);
  const R = mode === 'edit' ? await hkdf(base, 'bpc/read') : base;
  const keys = {
    id: b64uEnc(await hkdf(R, 'bpc/id', 16)),
    K: await crypto.subtle.importKey('raw', await hkdf(R, 'bpc/enc'), 'AES-GCM', false, ['encrypt', 'decrypt']),
    readSecret: b64uEnc(R), editSecret: mode === 'edit' ? secret : null, token: null,
  };
  if (mode === 'edit') keys.token = b64uEnc(await hkdf(base, 'bpc/write'));
  return keys;
}
/* AAD binds each ciphertext to its profile id and revision, so the server can't swap or roll back blobs unnoticed. */
async function seal(keys, rev, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(keys.id + ':' + rev) }, keys.K, te.encode(JSON.stringify(data))));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return b64uEnc(out);
}
async function unseal(keys, rev, blob) {
  const b = b64uDec(blob);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(0, 12), additionalData: te.encode(keys.id + ':' + rev) }, keys.K, b.slice(12));
  return JSON.parse(td.decode(pt));
}
async function syncApi(method, id, token, body) {
  const r = await fetch('/api/p/' + id, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
}
/* Union entries by id (minus tombstones in `gone`); the side changed more recently wins the scalar fields. */
function mergeState(a, b) {
  const gone = [...new Set([...(a.gone || []), ...(b.gone || [])])].slice(-2000);
  const dead = new Set(gone);
  const win = (a.ts || 0) >= (b.ts || 0) ? a : b, lose = win === a ? b : a;
  const byId = new Map();
  [lose, win].forEach(st => (st.items || []).forEach(it => { if (!dead.has(it.id)) byId.set(it.id, it); }));
  return { name: win.name ?? '', sex: win.sex || 'boy', birth: win.birth ?? '', unit: win.unit || 'lb', dateOrder: win.dateOrder || 'auto', items: [...byId.values()], gone, ts: Math.max(a.ts || 0, b.ts || 0) };
}
const canon = d => JSON.stringify({ name: d.name ?? '', sex: d.sex, birth: d.birth ?? '', unit: d.unit, dateOrder: d.dateOrder, items: [...(d.items || [])].sort((x, y) => (x.id < y.id ? -1 : 1)), gone: [...(d.gone || [])].sort() });

/* Decide at load time which profile (if any) this page is attached to. */
const BOOT = (() => {
  const m = /^#\/([ev])\/([A-Za-z0-9_-]{43})$/.exec(location.hash);
  const strip = () => { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {} };
  let stored = null;
  try { const s = JSON.parse(localStorage.getItem(SYNC_KEY)); if (s && s.mode === 'edit' && SECRET_RE.test(s.secret)) stored = s; } catch (e) {}
  if (m) {
    strip();
    const mode = m[1] === 'e' ? 'edit' : 'view', secret = m[2];
    if (mode === 'view') return { mode, secret, fresh: true };               /* view links are never persisted */
    if (stored && stored.secret === secret) return { mode, secret };
    let hasLocal = false;
    try { const l = JSON.parse(localStorage.getItem('bpc-v1')); hasLocal = !!(l && l.items && l.items.length); } catch (e) {}
    if (hasLocal && !confirm('Open this shared profile? It will replace the weights currently saved on this device.')) return stored ? { mode: 'edit', secret: stored.secret } : null;
    try { localStorage.setItem(SYNC_KEY, JSON.stringify({ mode, secret })); } catch (e) {}
    return { mode, secret, fresh: true };
  }
  return stored ? { mode: 'edit', secret: stored.secret } : null;
})();

function SyncModal({ mode, links, busy, error, onEnable, onDisable, onDelete, onCopy, copied, onClose }) {
  useEffect(() => {
    const k = e => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);
  const LinkRow = ({ label, hint, k }) => (
    <div className="rounded-xl bg-slate-50 p-3">
      <div className="flex items-center justify-between gap-3">
        <div><div className="text-sm font-semibold text-slate-700">{label}</div><div className="text-xs text-slate-400">{hint}</div></div>
        <button type="button" onClick={() => onCopy(k, links[k])} className="shrink-0 rounded-lg bg-teal-600 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-700">{copied === k ? 'Copied' : 'Copy link'}</button>
      </div>
    </div>
  );
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm" onClick={onClose}>
      <div className="min-h-full flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-display text-lg font-semibold">Sync &amp; share</h3>
            <button type="button" aria-label="Close" onClick={onClose} className="h-10 w-10 -mr-2 flex items-center justify-center text-2xl text-slate-400 hover:text-slate-600">×</button>
          </div>
          {mode === 'view' ? (
            <p className="text-sm text-slate-500">You’re viewing a shared profile. It’s read-only, and nothing you change here is saved.</p>
          ) : mode === 'edit' ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-500">Syncing is on. Anyone with a link below can open this profile on any device. There are no accounts, so <b>keep the links somewhere safe</b>. If they’re lost, the data can’t be recovered.</p>
              <LinkRow k="edit" label="Edit link" hint="Full access. Use it on your other devices or for your partner." />
              <LinkRow k="view" label="View-only link" hint="Can see the chart but can’t change anything." />
              <p className="text-xs leading-relaxed text-slate-400">Everything is encrypted in your browser with a key that only exists in these links, so the server stores scrambled data it can’t read. Profiles are deleted automatically after 18 months with no activity, or after 1 month if no weigh-ins were ever added.</p>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={onDisable} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">Stop syncing here</button>
                <button type="button" onClick={onDelete} className="flex-1 rounded-xl border border-rose-200 py-2.5 text-xs font-semibold text-rose-600 hover:bg-rose-50">Delete from server</button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-slate-500">Keep this baby’s weights in sync across your phone and computer, or share them with family. No account needed: you get a private link.</p>
              <ul className="space-y-1.5 text-xs text-slate-500 list-disc pl-5">
                <li>End-to-end encrypted. The server can’t read your data.</li>
                <li>Get an edit link for your devices and a view-only link for others.</li>
                <li>Deleted automatically after 18 months of not being used, or 1 month if no weigh-ins are added.</li>
              </ul>
              <button type="button" disabled={busy} onClick={onEnable} className="w-full rounded-xl bg-teal-600 py-3 text-sm font-semibold text-white shadow-sm hover:bg-teal-700 disabled:opacity-50 transition">{busy ? 'Setting up…' : 'Turn on sync'}</button>
            </div>
          )}
          {error && <p className="mt-3 text-xs font-medium text-rose-600">{error}</p>}
        </div>
      </div>
    </div>
  );
}


function App() {
  const viewMode = !!(BOOT && BOOT.mode === 'view');
  const saved = useMemo(() => (BOOT && BOOT.fresh ? {} : load()), []);
  const [name, setName] = useState(saved.name || '');
  const [sex, setSex] = useState(saved.sex || 'boy');
  const [birth, setBirth] = useState(saved.birth || '');
  const [items, setItems] = useState(saved.items || []);
  const [gone, setGone] = useState(saved.gone || []);   /* ids of removed items, so removals survive a sync merge */
  const [unit, setUnit] = useState(saved.unit || 'lb');
  const [dateOrder, setDateOrder] = useState(saved.dateOrder || 'auto');
  const [tab, setTab] = useState(saved.tab || 'upload');
  const [view, setView] = useState(saved.view || 'chart');
  const [range, setRange] = useState(saved.range || 'auto');
  const [saveState, setSaveState] = useState('');   /* '', 'device', 'account' */
  const [ready, setReady] = useState(false);
  const cloud = useRef(null);
  const localTs = useRef(saved.ts || 0);
  const [msg, setMsg] = useState(null);
  const [drag, setDrag] = useState(false);
  const [paste, setPaste] = useState('');
  const [copied, setCopied] = useState('');
  const fileRef = useRef(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [showName, setShowName] = useState(true);
  const [shareUrl, setShareUrl] = useState('');
  const [shareMsg, setShareMsg] = useState('');
  const shareBlob = useRef(null);

  /* ---- sync state ---- */
  const [syncMode, setSyncMode] = useState(BOOT ? BOOT.mode : null);   /* 'edit' | 'view' | null */
  const [syncStatus, setSyncStatus] = useState('');                     /* '', 'syncing', 'ok', 'error' */
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncLinks, setSyncLinks] = useState(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncErr, setSyncErr] = useState('');
  const keysRef = useRef(null);
  /* dataTs: when the synced scalar fields (name, sex, birth, unit, order) last changed by the user. Unlike localTs it
     ignores UI prefs and remote merges, so a stale device can't win a merge just because it was opened recently. */
  const dataTs = useRef(saved.dts || 0);
  const scalarStr = d => JSON.stringify([d.name ?? '', d.sex || 'boy', d.birth ?? '', d.unit || 'lb', d.dateOrder || 'auto']);
  const lastScalars = useRef(scalarStr({ name: saved.name, sex: saved.sex, birth: saved.birth, unit: saved.unit, dateOrder: saved.dateOrder }));
  useEffect(() => {
    const cur = scalarStr({ name, sex, birth, unit, dateOrder });
    if (cur !== lastScalars.current) { lastScalars.current = cur; dataTs.current = Date.now(); }
  }, [name, sex, birth, unit, dateOrder]);
  const syncing = useRef(false), syncAgain = useRef(false);
  const stateRef = useRef({});
  stateRef.current = { name, sex, birth, unit, dateOrder, items, gone };
  const snapshot = () => { const s = stateRef.current; return { name: s.name, sex: s.sex, birth: s.birth, unit: s.unit, dateOrder: s.dateOrder, items: s.items, gone: s.gone }; };
  const applyData = d => {
    setName(d.name ?? ''); setSex(d.sex || 'boy'); setBirth(d.birth ?? ''); setUnit(d.unit || 'lb');
    setDateOrder(d.dateOrder || 'auto'); setItems(d.items || []); setGone(d.gone || []);
    lastScalars.current = scalarStr(d);
    if (d.ts) dataTs.current = d.ts;
    stateRef.current = { ...stateRef.current, ...d };
  };
  const dropItems = pred => {
    const dead = items.filter(pred).map(i => i.id);
    if (dead.length) setGone(g => [...g, ...dead].slice(-2000));
    setItems(items.filter(i => !pred(i)));
  };
  const makeLinks = k => {
    const base = location.origin + location.pathname;
    return { edit: k.editSecret ? base + '#/e/' + k.editSecret : '', view: base + '#/v/' + k.readSecret };
  };

  /* one sync round: pull, merge, push if anything differs. Retries on write conflicts. */
  const syncOnce = async () => {
    const keys = keysRef.current;
    for (let i = 0; i < 4; i++) {
      const g = await syncApi('GET', keys.id);
      let remote = null, rev = 0;
      if (g.status === 200) { rev = g.body.rev; remote = await unseal(keys, rev, g.body.blob); }
      else if (g.status !== 404) throw new Error('get ' + g.status);
      if (!keys.token) { if (!remote) throw new Error('gone'); applyData(remote); return; }          /* view-only: just show the latest */
      const mine = { ...snapshot(), ts: dataTs.current };
      const merged = remote ? mergeState(mine, remote) : mine;
      if (canon(merged) !== canon(mine)) {
        if (canon(snapshot()) !== canon(mine)) continue;                    /* user edited mid-flight: go again */
        applyData(merged);
      }
      if (remote && canon(merged) === canon(remote)) return;                /* server already has it */
      const body = { rev, blob: await seal(keys, rev + 1, { v: 1, ...merged, ts: Date.now() }), active: merged.items.length > 0 };
      const p = await syncApi('PUT', keys.id, keys.token, body);
      if (p.status === 200 || p.status === 201) return;
      if (p.status !== 409) throw new Error('put ' + p.status);
    }
    throw new Error('conflict');
  };
  const requestSync = async () => {
    if (!keysRef.current) return;
    if (syncing.current) { syncAgain.current = true; return; }
    syncing.current = true;
    try {
      do { syncAgain.current = false; setSyncStatus('syncing'); await syncOnce(); setSyncStatus('ok'); } while (syncAgain.current);
    } catch (e) { setSyncStatus('error'); }
    finally { syncing.current = false; }
  };

  /* attach to the profile from the link / previous session, then pull */
  useEffect(() => {
    if (!BOOT) return;
    let dead = false;
    deriveKeys(BOOT.mode, BOOT.secret).then(k => {
      if (dead) return;
      keysRef.current = k; setSyncLinks(makeLinks(k));
      requestSync();
    }).catch(() => setSyncStatus('error'));
    const onVis = () => { if (document.visibilityState === 'visible') requestSync(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { dead = true; document.removeEventListener('visibilitychange', onVis); };
  }, []);
  /* push local changes shortly after they happen */
  useEffect(() => {
    if (syncMode !== 'edit' || !ready) return;
    const h = setTimeout(requestSync, 800);
    return () => clearTimeout(h);
  }, [syncMode, ready, name, sex, birth, items, gone, unit, dateOrder]);

  const enableSync = async () => {
    setSyncBusy(true); setSyncErr('');
    try {
      const secret = b64uEnc(crypto.getRandomValues(new Uint8Array(32)));
      const k = await deriveKeys('edit', secret);
      const mine = { ...snapshot(), ts: dataTs.current || Date.now() };
      const p = await syncApi('PUT', k.id, k.token, { rev: 0, blob: await seal(k, 1, { v: 1, ...mine }), active: mine.items.length > 0 });
      if (p.status !== 201) throw new Error('status ' + p.status);
      try { localStorage.setItem(SYNC_KEY, JSON.stringify({ mode: 'edit', secret })); } catch (e) {}
      keysRef.current = k; setSyncLinks(makeLinks(k)); setSyncMode('edit'); setSyncStatus('ok');
    } catch (e) {
      setSyncErr(window.crypto && crypto.subtle ? 'Couldn’t reach the sync server. Try again in a moment.' : 'Sync needs a secure (https) connection.');
    }
    setSyncBusy(false);
  };
  const stopSync = () => {
    try { localStorage.removeItem(SYNC_KEY); } catch (e) {}
    keysRef.current = null; setSyncMode(null); setSyncLinks(null); setSyncStatus('');
  };
  const deleteSync = async () => {
    if (!confirm('Delete this profile from the server? Links to it will stop working. The weights on this device are kept.')) return;
    const k = keysRef.current;
    try { const r = await syncApi('DELETE', k.id, k.token); if (r.status !== 200 && r.status !== 404) throw new Error(); stopSync(); }
    catch (e) { setSyncErr('Couldn’t delete it right now. Try again in a moment.'); }
  };

  /* load: device copy is already in state; then pull the account copy if there is one and it's newer */
  useEffect(() => {
    let dead = false;
    (async () => {
      const ref = await openCloud();
      if (dead) return;
      if (ref) {
        cloud.current = ref;
        const remote = await readCloud(ref);
        if (!dead && remote && remote.ts > localTs.current) {
          if (remote.name != null) setName(remote.name);
          if (remote.sex) setSex(remote.sex);
          if (remote.birth != null) setBirth(remote.birth);
          if (Array.isArray(remote.items)) setItems(remote.items);
          if (remote.unit) setUnit(remote.unit);
          if (remote.dateOrder) setDateOrder(remote.dateOrder);
          localTs.current = remote.ts;
        }
      }
      if (!dead) setReady(true);
    })();
    const fallback = setTimeout(() => !dead && setReady(true), 12000);
    return () => { dead = true; clearTimeout(fallback); };
  }, []);

  /* save: debounced, after loading has finished so an empty page never overwrites saved data */
  const firstSave = useRef(true);
  useEffect(() => {
    if (!ready || viewMode) return;
    if (firstSave.current) { firstSave.current = false; if (localTs.current) return; }
    const h = setTimeout(async () => {
      const ts = Date.now(); localTs.current = ts;
      const payload = { name, sex, birth, items, gone, unit, dateOrder, tab, view, range, ts, dts: dataTs.current };
      let ok = false;
      try { localStorage.setItem(LS_KEY, JSON.stringify(payload)); ok = true; } catch (e) {}
      if (cloud.current) {
        try { await cloud.current.set({ json: JSON.stringify(payload), ts }); setSaveState('account'); return; } catch (e) {}
      }
      setSaveState(ok ? 'device' : '');
    }, 500);
    return () => clearTimeout(h);
  }, [ready, name, sex, birth, items, gone, unit, dateOrder, tab, view, range]);

  const pts = useMemo(() => items.map(it => {
    let age = it.date ? (birth ? monthsBetween(birth, it.date) : null) : it.age;
    if (age == null) return { ...it, age: null, status: 'needs-birth' };
    if (age < 0 && age > -0.1) age = 0;
    if (age < 0) return { ...it, age, status: 'before-birth' };
    if (age > 36) return { ...it, age, status: 'over-range' };
    return { ...it, age, res: calc(sex, age, it.lbs), status: 'ok' };
  }).sort((a, b) => (a.age == null ? 1e9 : a.age) - (b.age == null ? 1e9 : b.age)), [items, birth, sex]);
  const good = pts.filter(p => p.status === 'ok');
  const latest = good[good.length - 1], prev = good[good.length - 2];
  const needsBirth = pts.some(p => p.status === 'needs-birth');
  const est = estimateNow(sex, good, birth);

  useEffect(() => {
    if (!shareOpen || !good.length) return;
    let dead = false;
    setShareMsg('');
    renderShareImage({ sex, name: showName ? name.trim() : '', pts: good }).then(b => {
      if (dead) return;
      shareBlob.current = b;
      setShareUrl(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(b); });
    }).catch(() => !dead && setShareMsg('Sorry, the image couldn’t be created.'));
    return () => { dead = true; };
  }, [shareOpen, showName, sex, pts]);
  const closeShare = () => { setShareOpen(false); setShareUrl(prev => { if (prev) URL.revokeObjectURL(prev); return ''; }); };
  const saveShare = async () => {
    if (!shareBlob.current) return;
    const slug = (showName && name.trim() ? name.trim() : 'baby').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'baby';
    const r = await saveBlob(shareBlob.current, `${slug}-weight-percentile.png`);
    setShareMsg(r === 'saved' ? 'Saved. If nothing downloaded, press and hold the image to save it.' : r === 'declined' ? '' : 'Couldn’t save automatically. Press and hold the image to save it.');
  };

  const ingest = (text) => {
    const out = importMeasurements(text, unit, dateOrder);
    if (out.error) { setMsg({ type: 'err', text: out.error }); return; }
    setItems(cur => [...cur, ...out.items]);
    setMsg({ type: 'ok', text: `Added ${out.items.length} measurement${out.items.length === 1 ? '' : 's'}${out.skipped ? ` · skipped ${out.skipped} unreadable row${out.skipped === 1 ? '' : 's'}` : ''}.${out.ambiguous ? ` Dates like 03/04/2026 were read as ${out.order === 'mdy' ? 'month/day/year' : 'day/month/year'}. If that’s wrong, switch “Date order” below.` : ''}` });
  };
  const changeOrder = o => {
    setDateOrder(o);
    const eff = o === 'auto' ? localeOrder() : o;
    setItems(cur => cur.map(it => it.raw ? { ...it, date: parseDate(it.raw, eff) || it.date } : it));
  };
  const onFile = async f => {
    if (!f) return;
    try { ingest(await f.text()); } catch (e) { setMsg({ type: 'err', text: 'Could not read that file.' }); }
  };
  const copy = async (key, text) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(''), 1600); } catch (e) {}
  };
  const resultsCsv = () => 'date,age_months,weight_lbs,percentile,z_score\n' + good.map(p => `${p.date || ''},${p.age.toFixed(2)},${p.lbs.toFixed(2)},${p.res.pct.toFixed(1)},${p.res.z.toFixed(2)}`).join('\n');
  const loadSample = () => {
    const dead = items.map(i => i.id);
    if (dead.length) setGone(g => [...g, ...dead].slice(-2000));
    setItems(SAMPLE.map(([age, lbs]) => ({ id: uid(), age, lbs })));
    setMsg({ type: 'ok', text: 'Loaded sample measurements.' });
  };

  const outside = latest && (latest.res.pct < 3 || latest.res.pct > 97);
  const title = name.trim() ? `${name.trim()}’s growth` : 'Weight percentile';

  return (
    <div className="min-h-screen text-slate-800 bg-gradient-to-br from-teal-50 via-white to-rose-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-12" style={{ paddingLeft: 'max(1rem, env(safe-area-inset-left))', paddingRight: 'max(1rem, env(safe-area-inset-right))', paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
        <header className="mb-8 sm:mb-10">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/80 ring-1 ring-slate-200 px-3 py-1 text-xs font-semibold text-teal-700 mb-4">
            <span className="h-1.5 w-1.5 rounded-full bg-teal-500" /> Birth to 36 months · CDC weight-for-age
          </div>
          <h1 className="font-display text-3xl sm:text-5xl font-semibold tracking-tight text-slate-900">{title}</h1>
          <p className="mt-3 max-w-2xl text-slate-500 text-sm sm:text-base">Upload weigh-ins, see where your baby falls on the growth curve, and watch the trend over time.</p>
          {saveState && <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-slate-400"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>{saveState === 'account' ? 'Saved to your account' : 'Saved on this device'}</p>}
          {viewMode && <p className="mt-4 max-w-2xl rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 ring-1 ring-amber-200">Viewing a shared profile (read-only). Changes you make here aren’t saved.</p>}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => { setSyncErr(''); setSyncOpen(true); }} className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-white">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 1-15.5 6.2M3 12A9 9 0 0 1 18.5 5.8M18.5 2v4h-4M5.5 22v-4h4" /></svg>
              {syncMode === 'edit' ? 'Sync & share' : syncMode === 'view' ? 'Shared view' : 'Sync & share'}
            </button>
            {syncMode === 'edit' && syncStatus && <span className={`text-xs font-medium ${syncStatus === 'error' ? 'text-rose-600' : 'text-slate-400'}`}>{syncStatus === 'syncing' ? 'Syncing…' : syncStatus === 'ok' ? 'Synced' : 'Sync failed, will retry'}</span>}
            {syncMode === 'view' && syncStatus === 'error' && <span className="text-xs font-medium text-rose-600">Couldn’t load the shared profile</span>}
          </div>
        </header>

        <div className="grid gap-5 sm:gap-6 lg:grid-cols-[360px_minmax(0,1fr)] items-start">
          <aside className={`space-y-6 ${good.length ? 'order-2' : 'order-1'} lg:order-1`}>
            <section className={`${card} p-5 sm:p-6`}>
              <h2 className="font-display text-lg font-semibold mb-4">Baby</h2>
              <div className="space-y-4">
                <div><label className={labelCls}>Name (optional)</label><input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="Baby’s name" /></div>
                <div><label className={labelCls}>Sex (chart used)</label><Seg value={sex} onChange={setSex} options={[{ value: 'boy', label: 'Boy' }, { value: 'girl', label: 'Girl' }]} /></div>
                <div>
                  <label className={labelCls}>Birth date</label>
                  <input type="date" className={inputCls} value={birth} onChange={e => setBirth(e.target.value)} />
                  <p className="mt-1.5 text-xs text-slate-400">Needed when your data uses dates instead of ages.</p>
                </div>
              </div>
            </section>

            <section className={`${card} p-5 sm:p-6`}>
              <h2 className="font-display text-lg font-semibold mb-4">Add weights</h2>
              <Seg value={tab} onChange={setTab} options={[{ value: 'upload', label: 'Upload CSV' }, { value: 'one', label: 'Single entry' }]} />
              <div className="mt-5">
                {tab === 'upload' ? (
                  <div className="space-y-4">
                    <div
                      onDragOver={e => { e.preventDefault(); setDrag(true); }}
                      onDragLeave={() => setDrag(false)}
                      onDrop={e => { e.preventDefault(); setDrag(false); onFile(e.dataTransfer.files[0]); }}
                      onClick={() => fileRef.current && fileRef.current.click()}
                      className={`cursor-pointer rounded-2xl border-2 border-dashed px-4 py-8 text-center transition ${drag ? 'border-teal-500 bg-teal-50' : 'border-slate-200 hover:border-teal-400 hover:bg-teal-50/40'}`}>
                      <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-teal-100 text-teal-700">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4m0 0L7 9m5-5l5 5M4 20h16" /></svg>
                      </div>
                      <div className="text-sm font-semibold text-slate-700"><span className="hidden md:inline">Drop a CSV here or click to browse</span><span className="md:hidden">Tap to choose a CSV file</span></div>
                      <div className="text-xs text-slate-400 mt-1">Columns: date or age, and weight</div>
                      <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv" className="hidden" onChange={e => { onFile(e.target.files[0]); e.target.value = ''; }} />
                    </div>
                    <div>
                      <label className={labelCls}>Unit when the file doesn’t say</label>
                      <Seg small value={unit} onChange={setUnit} options={[{ value: 'lb', label: 'lbs' }, { value: 'oz', label: 'oz' }, { value: 'kg', label: 'kg' }]} />
                    </div>
                    <div>
                      <label className={labelCls}>Date order for 03/04/2026-style dates</label>
                      <Seg small value={dateOrder} onChange={changeOrder} options={[{ value: 'auto', label: 'Auto' }, { value: 'mdy', label: 'Month first' }, { value: 'dmy', label: 'Day first' }]} />
                    </div>
                    <details className="group rounded-2xl bg-slate-50 px-4 py-3 text-sm">
                      <summary className="cursor-pointer font-semibold text-slate-600 list-none flex justify-between items-center">File format & paste <span className="text-slate-400 group-open:rotate-180 transition">▾</span></summary>
                      <div className="mt-3 space-y-3 text-xs text-slate-500">
                        <p>Headers are detected automatically. Dates can be written many ways (2026-01-05, 1/5/26, 5 Jan 2026, January 5th 2026, 20260105, spreadsheet date numbers). Use <b>Date</b> (needs birth date) or <b>Age (months/weeks/days)</b>, plus <b>Weight (lbs / kg / oz)</b>. Separate <b>lbs</b> and <b>oz</b> columns work too, as does text like “8 lb 4 oz”.</p>
                        <pre className="rounded-xl bg-white ring-1 ring-slate-200 p-3 font-mono text-[11px] leading-relaxed text-slate-600 overflow-x-auto">{EXAMPLE}</pre>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => copy('ex', EXAMPLE)} className="rounded-lg bg-white ring-1 ring-slate-200 px-3 py-1.5 font-semibold text-slate-600 hover:bg-slate-100">{copied === 'ex' ? 'Copied!' : 'Copy example'}</button>
                        </div>
                        <textarea rows="4" value={paste} onChange={e => setPaste(e.target.value)} placeholder="…or paste CSV text here" className={inputCls + ' font-mono'} />
                        <button type="button" disabled={!paste.trim()} onClick={() => { ingest(paste); setPaste(''); }} className="rounded-lg bg-teal-600 px-3 py-1.5 font-semibold text-white disabled:opacity-40 hover:bg-teal-700">Import pasted text</button>
                      </div>
                    </details>
                  </div>
                ) : <AddForm birth={birth} sex={sex} onAdd={m => setItems(cur => [...cur, { id: uid(), ...m }])} />}
              </div>
              {msg && <div className={`mt-4 rounded-xl px-3 py-2 text-xs font-medium ${msg.type === 'err' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>{msg.text}</div>}
              <div className="mt-5 flex items-center justify-between text-xs">
                <button type="button" onClick={loadSample} className="font-semibold text-teal-700 hover:underline">Try sample data</button>
                {items.length > 0 && <button type="button" onClick={() => { dropItems(() => true); setMsg(null); }} className="font-semibold text-slate-400 hover:text-rose-600">Clear all ({items.length})</button>}
              </div>
            </section>
          </aside>

          <main className={`space-y-6 min-w-0 ${good.length ? 'order-1' : 'order-2'} lg:order-2`}>
            {needsBirth && <div className="rounded-2xl bg-amber-50 ring-1 ring-amber-200 px-4 py-3 text-sm text-amber-800">Some measurements use dates. Enter a birth date to place them on the chart.</div>}

            <div className="grid gap-5 sm:gap-6 md:grid-cols-3">
              <section className={`${card} p-5 sm:p-6`}>
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Latest weight</div>
                {latest ? (<>
                  <div className="mt-2 font-display text-2xl sm:text-3xl font-semibold text-slate-900">{fmtLbOz(latest.lbs)}</div>
                  <div className="text-sm text-slate-500 mt-1">{latest.lbs.toFixed(2)} lbs</div>
                  <div className="mt-4 text-xs text-slate-400">{fmtAge(latest.age)} old{latest.date ? ` · ${fmtDate(latest.date)}` : ''}</div>
                </>) : <div className="mt-3 text-sm text-slate-400">No measurements yet.<br />Upload a CSV or add one to begin.</div>}
              </section>

              <section className={`${card} p-5 sm:p-6 md:col-span-2`}>
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
                  <div>
                    <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Percentile</div>
                    {latest ? (
                      <div className="mt-2 flex items-baseline gap-3">
                        <span className="font-display text-4xl sm:text-5xl font-semibold text-rose-600">{ord(latest.res.pct)}</span>
                        <span className="text-sm text-slate-500">of {sex === 'boy' ? 'boys' : 'girls'} this age</span>
                      </div>
                    ) : <div className="mt-3 text-sm text-slate-400">Your baby’s percentile appears here.</div>}
                  </div>
                  {latest && (
                    <div className="flex flex-wrap sm:justify-end gap-2 text-xs font-semibold">
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">z {latest.res.z.toFixed(2)}</span>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">{latest.lbs >= latest.res.medianLbs ? '+' : '−'}{Math.abs(latest.lbs - latest.res.medianLbs).toFixed(1)} lb vs median</span>
                      {prev && (() => { const d = latest.res.pct - prev.res.pct; return <span className={`rounded-full px-2.5 py-1 ${Math.abs(d) < 5 ? 'bg-teal-50 text-teal-700' : 'bg-amber-50 text-amber-700'}`}>{d >= 0 ? '▲' : '▼'} {Math.abs(d).toFixed(0)} pts since last</span>; })()}
                    </div>
                  )}
                </div>
                {latest && <Gauge pct={latest.res.pct} />}
                {latest && <button type="button" onClick={() => setShareOpen(true)} className="mt-3 w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-600 ring-1 ring-rose-100 hover:bg-rose-100 transition"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 19h14" /></svg>Create share image</button>}
                {latest && outside && <p className="mt-2 text-xs text-amber-700">This is outside the 3rd–97th range. That isn’t automatically a concern, but it’s worth mentioning to your pediatrician.</p>}
              </section>
            {est && (
              <section className="md:col-span-3 rounded-3xl border-2 border-dashed border-rose-200 bg-rose-50/60 p-5 sm:p-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 text-xs font-semibold text-rose-500 uppercase tracking-wide">Estimated today <span className="rounded-full bg-white px-2 py-0.5 normal-case tracking-normal text-[11px] text-rose-500 ring-1 ring-rose-100">estimate</span></div>
                    <div className="mt-2 font-display text-3xl sm:text-4xl font-semibold text-slate-900">≈ {fmtLbOz(est.lbs)}</div>
                    <div className="mt-1 text-sm text-slate-500">{est.lbs.toFixed(2)} lbs · likely {fmtLbOz(est.lo)} to {fmtLbOz(est.hi)}</div>
                  </div>
                  <div className="text-sm text-slate-500 sm:max-w-xs sm:text-right">
                    <div>Last weighed <b className="text-slate-700">{fmtGap(est.gapDays)} ago</b>. Carries {name.trim() || 'your baby'}’s recent growth curve forward, near the <b className="text-slate-700">{ord(est.pct)}</b> percentile.</div>
                    <div className="mt-1 text-xs text-slate-400">An estimate, not a measurement. Weigh again for an exact number.</div>
                  </div>
                </div>
              </section>
            )}
            </div>

            <section className={`${card} p-4 sm:p-6`}>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <h2 className="font-display text-lg font-semibold">Weight for age</h2>
                <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
                  {view === 'chart' && (
                    <div className="w-full sm:w-56"><Seg small value={range} onChange={setRange} options={[{ value: 'auto', label: 'Auto' }, { value: '6', label: '6' }, { value: '12', label: '12' }, { value: '24', label: '24' }, { value: '36', label: '36' }]} /></div>
                  )}
                  <div className="w-full sm:w-40"><Seg small value={view} onChange={setView} options={[{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table' }]} /></div>
                </div>
              </div>

              {view === 'chart' ? (<>
                <GrowthChart sex={sex} pts={good} range={range} est={est} />
                <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-500">
                  <span className="flex items-center gap-2"><svg width="26" height="10"><line x1="0" y1="5" x2="26" y2="5" stroke="#e11d48" strokeWidth="2.5" /><circle cx="13" cy="5" r="4" fill="#e11d48" stroke="#fff" strokeWidth="1.5" /></svg>{name.trim() || 'Baby'}</span>
                  {est && <span className="flex items-center gap-2"><svg width="26" height="10"><line x1="0" y1="5" x2="14" y2="5" stroke="#e11d48" strokeWidth="2.5" strokeDasharray="1 6" strokeLinecap="round" /><circle cx="19" cy="5" r="4" fill="#fff" stroke="#e11d48" strokeWidth="2" /></svg>Estimate for today</span>}
                  <span className="flex items-center gap-2"><svg width="26" height="10"><line x1="0" y1="5" x2="26" y2="5" stroke="#0f766e" strokeWidth="1.5" strokeDasharray="5 4" /></svg>50th percentile</span>
                  <span className="flex items-center gap-2"><span className="h-3 w-6 rounded-sm" style={{ background: 'rgba(15,118,110,.21)' }} />25th–75th</span>
                  <span className="flex items-center gap-2"><span className="h-3 w-6 rounded-sm" style={{ background: 'rgba(15,118,110,.09)' }} />3rd–97th</span>
                  {!good.length && <span className="text-slate-400">Add data to plot your baby.</span>}
                </div>
              </>) : (
                <div>
                  {pts.length ? (<>
                    {/* phones: one card per weigh-in */}
                    <ul className="sm:hidden space-y-2.5">
                      {pts.map(p => (
                        <li key={p.id} className="rounded-2xl bg-slate-50 px-4 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="font-semibold text-slate-800">{fmtLbOz(p.lbs)} <span className="text-xs font-normal text-slate-400">{p.lbs.toFixed(2)} lb</span></div>
                              <div className="text-xs text-slate-500 mt-0.5">{p.age != null ? fmtAge(p.age) : 'Age unknown'}{p.date ? ` · ${fmtDate(p.date)}` : ''}</div>
                            </div>
                            <button type="button" aria-label="Remove measurement" onClick={() => dropItems(i => i.id === p.id)} className="-mr-2 -mt-1 h-10 w-10 flex items-center justify-center text-slate-300 active:text-rose-500 text-2xl leading-none">×</button>
                          </div>
                          {p.res ? (
                            <div className="mt-2 flex items-center gap-3">
                              <div className="h-1.5 flex-1 rounded-full bg-slate-200 overflow-hidden"><div className="h-full rounded-full bg-rose-400" style={{ width: Math.min(100, Math.max(2, p.res.pct)) + '%' }} /></div>
                              <span className="font-semibold tabular-nums text-rose-600 text-sm">{ord(p.res.pct)}</span>
                            </div>
                          ) : <div className="mt-2 text-xs text-amber-600">{p.status === 'needs-birth' ? 'Needs birth date' : p.status === 'over-range' ? 'Over 36 months' : 'Before birth date'}</div>}
                        </li>
                      ))}
                    </ul>
                    {/* larger screens: table */}
                    <div className="hidden sm:block overflow-x-auto -mx-1">
                    <table className="w-full text-sm">
                      <thead><tr className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">
                        <th className="px-3 py-2">Date</th><th className="px-3 py-2">Age</th><th className="px-3 py-2">Weight</th><th className="px-3 py-2 w-48">Percentile</th><th className="px-3 py-2">z</th><th className="px-3 py-2" />
                      </tr></thead>
                      <tbody>
                        {pts.map(p => (
                          <tr key={p.id} className="border-t border-slate-100">
                            <td className="px-3 py-2.5 text-slate-600">{p.date ? fmtDate(p.date) : '—'}</td>
                            <td className="px-3 py-2.5 tabular-nums">{p.age != null ? fmtAge(p.age) : '—'}</td>
                            <td className="px-3 py-2.5 tabular-nums"><span className="font-semibold text-slate-800">{fmtLbOz(p.lbs)}</span> <span className="text-slate-400 text-xs">{p.lbs.toFixed(2)} lb</span></td>
                            <td className="px-3 py-2.5">
                              {p.res ? (
                                <div className="flex items-center gap-3">
                                  <div className="h-1.5 w-24 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-rose-400" style={{ width: Math.min(100, Math.max(2, p.res.pct)) + '%' }} /></div>
                                  <span className="font-semibold tabular-nums text-slate-800">{ord(p.res.pct)}</span>
                                </div>
                              ) : <span className="text-xs text-amber-600">{p.status === 'needs-birth' ? 'Needs birth date' : p.status === 'over-range' ? 'Over 36 months' : 'Before birth date'}</span>}
                            </td>
                            <td className="px-3 py-2.5 tabular-nums text-slate-500">{p.res ? p.res.z.toFixed(2) : ''}</td>
                            <td className="px-3 py-2.5 text-right"><button type="button" aria-label="Remove" onClick={() => dropItems(i => i.id === p.id)} className="text-slate-300 hover:text-rose-500 text-lg leading-none">×</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                  </>) : <div className="py-10 text-center text-sm text-slate-400">No measurements yet.</div>}
                  {good.length > 0 && <div className="mt-4 sm:text-right"><button type="button" onClick={() => copy('res', resultsCsv())} className="w-full sm:w-auto rounded-xl bg-white ring-1 ring-slate-200 px-3 py-2.5 sm:py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100">{copied === 'res' ? 'Copied!' : 'Copy results as CSV'}</button></div>}
                </div>
              )}
            </section>
          </main>
        </div>

        {syncOpen && <SyncModal mode={syncMode} links={syncLinks} busy={syncBusy} error={syncErr} onEnable={enableSync} onDisable={() => { stopSync(); }} onDelete={deleteSync} onCopy={copy} copied={copied} onClose={() => setSyncOpen(false)} />}
        {shareOpen && <ShareModal url={shareUrl} busy={!shareMsg} hasName={!!name.trim()} showName={showName} setShowName={setShowName} onSave={saveShare} onClose={closeShare} msg={shareMsg} />}

        <footer className="mt-10 max-w-3xl text-xs leading-relaxed text-slate-400">
          Percentiles use the CDC weight-for-age LMS values (birth to 36 months) with linear interpolation between ages. Note that the CDC recommends the WHO growth standards for children under 2 in the U.S., so numbers can differ slightly from those charts. This tool is educational and isn’t medical advice. Steady growth along a curve usually says more than any single reading, so talk with your pediatrician about concerns.
        </footer>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
