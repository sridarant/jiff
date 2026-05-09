// src/services/feedbackService.js
// Single tracking layer for all user feedback on meal recommendations.
// No direct DB calls from UI — everything routes through here.
//
// Actions: accepted | swapped | completed | rejected | saved
//
// Storage layers:
//   1. localStorage weights (instant)
//   2. Supabase recommendation_log (persistent, async)
//
// Pattern memory: tracks cuisine trends, effort trends, veg/non-veg ratio.
// All patterns fed back into scoring via getHouseholdPatterns().

import { recordSessionRejection, clearSessionRejectionStreak } from './recommendationService.js';

const ADMIN = '/api/admin';

const FB_KEY       = 'jiff-feedback-weights';
const REJECTED_KEY = 'jiff-rejected-meals';
const PREF_KEY     = 'jiff-learned-prefs';
const PATTERN_KEY  = 'jiff-household-patterns';

const SCORE_DELTA = {
  accepted:  +0.25,
  completed: +0.40,
  saved:     +0.20,
  swapped:   -0.10,
  rejected:  -0.50,
};


// ── Implicit behavioral signals (invisible to user) ───────────────
// These capture PATTERNS, not individual events.
// All signals decay over time — see DECAY_HALF_LIFE.
// Storage is localStorage only; syncs to Supabase on session end.
const IMPLICIT_KEY      = 'jiff-implicit-v1';  // {swapVelocity, exploreRate, timeOfDay, weekday, noveltyAppetite, effortFatigue}
const DECAY_HALF_LIFE   = 14;                  // days: signal weight halves every 14 days
const MAX_IMPLICIT_OBS  = 50;                  // cap observations to keep localStorage small

function decayedScore(value, daysSince) {
  // Exponential decay: value × (0.5)^(daysSince / DECAY_HALF_LIFE)
  return value * Math.pow(0.5, daysSince / DECAY_HALF_LIFE);
}

function loadImplicit() {
  try { return JSON.parse(localStorage.getItem(IMPLICIT_KEY) || '{}'); } catch { return {}; }
}
function saveImplicit(d) {
  try { localStorage.setItem(IMPLICIT_KEY, JSON.stringify(d)); } catch {}
}

const REJECTED_TTL_DAYS = 14;

// ── Weight store ──────────────────────────────────────────────────
function loadWeights() {
  try { return JSON.parse(localStorage.getItem(FB_KEY) || '{}'); } catch { return {}; }
}
function saveWeights(w) {
  try { localStorage.setItem(FB_KEY, JSON.stringify(w)); } catch {}
}

export function getLearnedWeight(mealId) {
  return loadWeights()[mealId]?.score || 0;
}
export function getAllLearnedWeights() {
  return loadWeights();
}

// ── Rejected store ────────────────────────────────────────────────
function loadRejected() {
  try {
    const raw    = JSON.parse(localStorage.getItem(REJECTED_KEY) || '{}');
    const cutoff = Date.now() - REJECTED_TTL_DAYS * 86400000;
    const pruned = {};
    Object.entries(raw).forEach(([name, ts]) => { if (ts > cutoff) pruned[name] = ts; });
    return pruned;
  } catch { return {}; }
}
function saveRejected(r) {
  try { localStorage.setItem(REJECTED_KEY, JSON.stringify(r)); } catch {}
}

export function isRecentlyRejected(mealName) {
  const r      = loadRejected();
  const cutoff = Date.now() - REJECTED_TTL_DAYS * 86400000;
  const ts     = r[mealName?.toLowerCase().trim()];
  return ts && ts > cutoff;
}
export function getRejectedMealNames() {
  return new Set(Object.keys(loadRejected()));
}

// ── Learned preference store ──────────────────────────────────────
function loadLearnedPrefs() {
  try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{"cuisines":{},"efforts":{}}'); }
  catch { return { cuisines: {}, efforts: {} }; }
}
function saveLearnedPrefs(p) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch {}
}

export function getLearnedPrefs() { return loadLearnedPrefs(); }

export function getLearnedCuisinePreferences() {
  return Object.entries(loadLearnedPrefs().cuisines || {})
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
}

export function getLearnedEffortPreference() {
  const e     = loadLearnedPrefs().efforts || {};
  const quick = e.quick || 0, moderate = e.moderate || 0, involved = e.involved || 0;
  const total = quick + moderate + involved;
  if (total < 3) return 'any';
  if (quick    / total >= 0.6) return 'quick';
  if (involved / total >= 0.5) return 'involved';
  return 'moderate';
}

// ── Household patterns (passive memory) ───────────────────────────
// Tracks: cuisine trends, effort trends, veg/non-veg ratio, quick vs elaborate.
// Used in scoring via getHouseholdPatterns().
function loadPatterns() {
  try { return JSON.parse(localStorage.getItem(PATTERN_KEY) || '{"vegCount":0,"nonVegCount":0,"totalCooks":0,"cuisineTrend":{},"effortTrend":{}}'); }
  catch { return { vegCount:0, nonVegCount:0, totalCooks:0, cuisineTrend:{}, effortTrend:{} }; }
}
function savePatterns(p) {
  try { localStorage.setItem(PATTERN_KEY, JSON.stringify(p)); } catch {}
}

export function getHouseholdPatterns() {
  const p = loadPatterns();
  const total = p.totalCooks || 1;
  return {
    vegRatio:   (p.vegCount    || 0) / total,
    nonVegRatio:(p.nonVegCount || 0) / total,
    topCuisines: Object.entries(p.cuisineTrend || {})
      .sort((a,b) => b[1] - a[1]).slice(0, 3).map(([id]) => id),
    effortTrend: p.effortTrend || {},
    totalCooks:  total,
  };
}

// ── Core: logFeedback ─────────────────────────────────────────────
export function logFeedback({ meal, action, userId = null, position = null }) {
  if (!meal || !action) return;

  const mealId   = meal.id   || (meal.name || '').toLowerCase().replace(/\s+/g, '_') || 'unknown';
  const mealName = (meal.name || '').toLowerCase().trim();
  const delta    = SCORE_DELTA[action] || 0;

  // 1. Weight store
  const weights = loadWeights();
  const prev    = weights[mealId] || { score: 0, acceptCount: 0, rejectCount: 0 };
  weights[mealId] = {
    score:       Math.max(-1, Math.min(1, (prev.score || 0) + delta)),
    lastAction:  action,
    lastTs:      Date.now(),
    acceptCount: (prev.acceptCount || 0) + (action === 'accepted' || action === 'completed' ? 1 : 0),
    rejectCount: (prev.rejectCount || 0) + (action === 'rejected' ? 1 : 0),
  };
  saveWeights(weights);

  // 1b. Implicit signals — pattern-level, decayed
  (function captureImplicit() {
    try {
      const impl = loadImplicit();
      const now  = Date.now();
      const h    = new Date().getHours();
      const dow  = new Date().getDay(); // 0=Sun

      // Swap velocity: note time since last primary shown (approximated by session)
      if (action === 'swapped') {
        const lastShown = impl.lastPrimaryShownTs || now;
        const secsSince = (now - lastShown) / 1000;
        // Fast swap (<5s) = immediate rejection. Slow swap (>30s) = considered.
        const velocityScore = secsSince < 5 ? -0.8 : secsSince < 15 ? -0.3 : -0.05;
        impl.swapVelocity = impl.swapVelocity || [];
        impl.swapVelocity = [{ v: velocityScore, ts: now }, ...impl.swapVelocity].slice(0, MAX_IMPLICIT_OBS);
      }

      // Record when primary shown (for swap velocity calc)
      if (action === 'accepted' || action === 'swapped' || action === 'rejected') {
        impl.lastPrimaryShownTs = now;
      }

      // Explore rate: accepted=0, swapped=0.5, rejected=1
      const exploreSignal = action === 'accepted' ? 0 : action === 'swapped' ? 0.5 : 1;
      impl.exploreObs = impl.exploreObs || [];
      impl.exploreObs = [{ v: exploreSignal, ts: now }, ...impl.exploreObs].slice(0, MAX_IMPLICIT_OBS);

      // Time-of-day buckets: breakfast(0), lunch(1), dinner(2)
      const tod = h < 11 ? 0 : h < 16 ? 1 : 2;
      impl.todObs = impl.todObs || [];
      impl.todObs = [{ tod, ts: now }, ...impl.todObs].slice(0, MAX_IMPLICIT_OBS);

      // Weekday vs weekend signal
      const isWeekend = dow === 0 || dow === 6;
      impl.weekendObs = impl.weekendObs || [];
      impl.weekendObs = [{ wk: isWeekend ? 1 : 0, ts: now }, ...impl.weekendObs].slice(0, MAX_IMPLICIT_OBS);

      // Effort signal on accept: quick accept → efficiency preference
      if ((action === 'accepted' || action === 'completed') && meal.effortMins) {
        impl.effortObs = impl.effortObs || [];
        impl.effortObs = [{ m: meal.effortMins, ts: now }, ...impl.effortObs].slice(0, MAX_IMPLICIT_OBS);
      }

      saveImplicit(impl);
    } catch {} // never throw — implicit capture is non-blocking
  })();

  // 2. Rejected set + session streak
  if (action === 'rejected') {
    const rejected = loadRejected();
    rejected[mealName] = Date.now();
    saveRejected(rejected);
    recordSessionRejection();
  } else if (action === 'accepted' || action === 'completed') {
    clearSessionRejectionStreak();
  }

  // 3. Learned prefs
  if (action === 'accepted' || action === 'completed' || action === 'saved') {
    const prefs = loadLearnedPrefs();
    if (meal.cuisine && meal.cuisine !== 'any') {
      prefs.cuisines = prefs.cuisines || {};
      prefs.cuisines[meal.cuisine] = (prefs.cuisines[meal.cuisine] || 0) + 1;
    }
    const em = meal.effortMins || 30;
    prefs.efforts = prefs.efforts || {};
    if      (em <= 15) prefs.efforts.quick    = (prefs.efforts.quick    || 0) + 1;
    else if (em <= 25) prefs.efforts.moderate = (prefs.efforts.moderate || 0) + 1;
    else               prefs.efforts.involved = (prefs.efforts.involved || 0) + 1;
    saveLearnedPrefs(prefs);

    // 4. Household pattern memory
    const patterns = loadPatterns();
    patterns.totalCooks = (patterns.totalCooks || 0) + 1;

    // Veg/non-veg ratio
    const isVeg = meal.diet
      ? (Array.isArray(meal.diet) ? meal.diet : [meal.diet]).some(d => d === 'veg' || d === 'vegan' || d === 'jain')
      : false;
    if (isVeg) patterns.vegCount = (patterns.vegCount || 0) + 1;
    else       patterns.nonVegCount = (patterns.nonVegCount || 0) + 1;

    // Cuisine trend (weighted towards recent — decay older counts)
    if (meal.cuisine && meal.cuisine !== 'any') {
      patterns.cuisineTrend = patterns.cuisineTrend || {};
      patterns.cuisineTrend[meal.cuisine] = (patterns.cuisineTrend[meal.cuisine] || 0) + 1;
    }

    // Effort trend
    const effortBucket = em <= 15 ? 'quick' : em <= 25 ? 'moderate' : 'involved';
    patterns.effortTrend = patterns.effortTrend || {};
    patterns.effortTrend[effortBucket] = (patterns.effortTrend[effortBucket] || 0) + 1;

    savePatterns(patterns);
  }

  // 5. Supabase async
  _persistToSupabase({ mealId, mealName, action, userId, position, cuisine: meal.cuisine });
}

async function _persistToSupabase({ mealId, mealName, action, userId, position, cuisine }) {
  try {
    await fetch(`${ADMIN}?action=log-recommendation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, mealId, mealName, action, position, cuisine, timestamp: new Date().toISOString() }),
    });
  } catch {}
}

// ── Admin / insights ──────────────────────────────────────────────
export async function fetchRecommendationLog(userId, { limit = 100 } = {}) {
  if (!userId) return [];
  try {
    const res = await fetch(`${ADMIN}?action=recommendation-log&userId=${encodeURIComponent(userId)}&limit=${limit}`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.log) ? data.log : [];
  } catch { return []; }
}



// ── Step 4+8: Implicit behaviour profile — multi-horizon memory ───
// Returns a lightweight profile object for the scoring engine.
// All values are [0,1] ranges or booleans. Decayed.
export function getImplicitBehaviourProfile() {
  try {
    const impl = loadImplicit();
    const now  = Date.now();
    const DAY  = 86400000;

    // Helper: compute decayed mean of observations
    function decayedMean(obs, valueFn) {
      if (!obs || obs.length === 0) return null;
      let sumW = 0, sumV = 0;
      obs.forEach(o => {
        const daysAgo = (now - o.ts) / DAY;
        if (daysAgo > 60) return; // discard stale beyond 60 days
        const w = Math.pow(0.5, daysAgo / DECAY_HALF_LIFE);
        sumW += w;
        sumV += valueFn(o) * w;
      });
      return sumW < 0.01 ? null : sumV / sumW;
    }

    // 1. Novelty appetite: 0=decisive (accepts first), 1=explorer (always swaps)
    const noveltyAppetite = decayedMean(impl.exploreObs, o => o.v);

    // 2. Effort tolerance: mean accepted effort in minutes (decayed)
    const meanEffort = decayedMean(impl.effortObs, o => o.m);
    const effortTolerance = meanEffort === null ? 'any'
      : meanEffort <= 18 ? 'quick'
      : meanEffort <= 32 ? 'moderate'
      : 'involved';

    // 3. Time-of-day preference: most common tod bucket (decayed frequency)
    const todCounts = [0, 0, 0];
    (impl.todObs || []).forEach(o => {
      const daysAgo = (now - o.ts) / DAY;
      if (daysAgo > 30) return;
      const w = Math.pow(0.5, daysAgo / DECAY_HALF_LIFE);
      todCounts[o.tod] = (todCounts[o.tod] || 0) + w;
    });
    const preferredTod = todCounts[0] === 0 && todCounts[1] === 0 && todCounts[2] === 0
      ? null : todCounts.indexOf(Math.max(...todCounts));

    // 4. Weekend preference (decayed)
    const weekendMean = decayedMean(impl.weekendObs, o => o.wk);

    // 5. Swap velocity: decayed mean (negative = fast swapper = low recommendation trust)
    const swapVelocityMean = decayedMean(impl.swapVelocity, o => o.v);

    return {
      noveltyAppetite,    // 0=decisive 1=explorer | null=unknown
      effortTolerance,    // 'quick'|'moderate'|'involved'|'any'
      preferredTod,       // 0=morning 1=lunch 2=dinner | null=unknown
      weekendUser: weekendMean === null ? null : weekendMean > 0.6,
      swapVelocityMean,   // negative = impatient swapper
      hasEnoughData: (impl.exploreObs || []).length >= 5,
    };
  } catch { return { noveltyAppetite:null, effortTolerance:'any', preferredTod:null, weekendUser:null, swapVelocityMean:null, hasEnoughData:false }; }
}

// Record when primary card is shown (for swap velocity calculation)
export function recordPrimaryShown() {
  try {
    const impl = loadImplicit();
    impl.lastPrimaryShownTs = Date.now();
    saveImplicit(impl);
  } catch {}
}

export async function syncBehaviourToProfile(userId) {
  if (!userId) return;
  const prefs    = loadLearnedPrefs();
  const weights  = loadWeights();
  const patterns = loadPatterns();
  try {
    await fetch(`${ADMIN}?action=update-behaviour`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        behaviourData: {
          learnedCuisines:  prefs.cuisines    || {},
          learnedEfforts:   prefs.efforts     || {},
          mealWeights:      weights,
          householdPatterns: patterns,
          syncedAt:         new Date().toISOString(),
        },
      }),
    });
  } catch {}
}

export function clearFeedbackData() {
  try {
    localStorage.removeItem(FB_KEY);
    localStorage.removeItem(REJECTED_KEY);
    localStorage.removeItem(PREF_KEY);
    localStorage.removeItem(PATTERN_KEY);
  } catch {}
}
