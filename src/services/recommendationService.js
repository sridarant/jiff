// src/services/recommendationService.js
// Unified decision engine for all journey entry types.
//
// All journeys call getPersonalisedRecommendations(context) via buildJourneyContext().
// No UI-level filtering. No duplicate logic per entry.
//
// Brain v2.1 Scoring (6 named components):
//
//   score = preferenceScore  * 0.35   // cuisine fit + goal + history + journey tags
//         + timeScore        * 0.20   // meal type, effort, time-of-day
//         + successScore     * 0.15   // liked meals, learned behaviour
//         + varietyScore     * 0.15   // penalise repetition, reward novelty
//         + feasibilityScore * 0.10   // ingredient availability (pantry vs recipe)
//         + continuityScore  * 0.05   // tag-similarity to recently cooked
//
// "any" cuisine meals get a fixed penalty (-0.10 from preferenceScore)
// Cuisine lock-in: same cuisine × 2 in session → preferenceScore × 0.40
//
// Primary dominance:  primaryScore *= 1.2
// Time pressure:      boost ≤15 min meals when flag active
// Session adaptation: streak ≥2 → force cuisine + effort shift
// Repetition control: same meal blocked 3 sessions; same cuisine capped 2 consecutive

import { parseFoodTypeIds } from '../lib/dietary.js';
import { getDaypart, MEAL_PERIOD } from '../lib/daypart.js';
import { getActiveEvent, getEventBoost, getMealContextLabel } from '../lib/eventIntelligence.js';
import { getRecentSuccessBoostMap }       from '../hooks/useRetention.js';
import { getImplicitBehaviourProfile, recordPrimaryShown } from '../services/feedbackService.js';
import {
  getAllLearnedWeights,
  getRejectedMealNames,
  getLearnedCuisinePreferences,
  getLearnedEffortPreference,
  getHouseholdPatterns,
} from './feedbackService.js';

// ── Session state ─────────────────────────────────────────────────
const SK_REJECT  = 'jiff-session-reject-streak';
const SK_CUISINE = 'jiff-session-cuisine-history';

function sessionGet(key) {
  try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { return null; }
}
function sessionSet(key, val) {
  try { sessionStorage.setItem(key, JSON.stringify(val)); } catch {}
}

export function recordSessionRejection() {
  const n = (sessionGet(SK_REJECT) || 0) + 1;
  sessionSet(SK_REJECT, n);
  return n;
}
export function clearSessionRejectionStreak() {
  sessionSet(SK_REJECT, 0);
}
function getSessionRejectionStreak() {
  return sessionGet(SK_REJECT) || 0;
}
function getSessionCuisineHistory() {
  return sessionGet(SK_CUISINE) || [];
}
function appendSessionCuisine(cuisine) {
  const hist = getSessionCuisineHistory();
  hist.push(cuisine);
  sessionSet(SK_CUISINE, hist.slice(-6));
}

// ── Shown-meal store (3-day rolling window) ───────────────────────
const SHOWN_KEY = 'jiff-recently-shown';
const SHOWN_TTL = 3 * 24 * 60 * 60 * 1000;

export function getRecentlyShown() {
  try {
    const raw = JSON.parse(localStorage.getItem(SHOWN_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    const now = Date.now();
    return raw.filter(e => (now - (e.ts || 0)) < SHOWN_TTL).map(e => e.name);
  } catch { return []; }
}

export function markAsShown(mealNames = []) {
  try {
    const now  = Date.now();
    const prev = JSON.parse(localStorage.getItem(SHOWN_KEY) || '[]').filter(e => (now - (e.ts || 0)) < SHOWN_TTL);
    const names = new Set(prev.map(e => e.name));
    mealNames.forEach(n => { if (n) names.add(n.toLowerCase()); });
    localStorage.setItem(SHOWN_KEY, JSON.stringify([...names].slice(0, 21).map(name => ({ name, ts: now }))));
  } catch {}
}

export function clearRecentlyShown() {
  try { localStorage.removeItem(SHOWN_KEY); } catch {}
}

// ── Time pressure detection ───────────────────────────────────────
export function getTimePressureFlag(rejectStreak = 0) {
  const h = new Date().getHours();
  if (rejectStreak >= 2) return true;
  if (h >= 21 || (h >= 7 && h < 9)) return true;
  return false;
}

// ── buildContinuityProfile — tag pattern of recent meals ──────────────────
// Reads mealHistory to detect streaks: heavy, comfort, quick, novelty.
// Used by: scoreMeal (modifier) and buildWhyParts (framing).
// Cap: 5 recent meals for pattern. No long-term lock-in.
function buildContinuityProfile(mealHistory, catalogue) {
  // Step 7: Recency-weighted continuity — recent meals count more than older ones
  // Decay: meal[0] (most recent) weight=1.0, meal[1]=0.7, meal[2]=0.5, meal[3]=0.35, meal[4]=0.25
  const WEIGHTS     = [1.0, 0.7, 0.5, 0.35, 0.25];
  const recent      = (mealHistory || []).slice(0, 5);
  const totalWeight = recent.reduce((s, _, i) => s + (WEIGHTS[i] || 0.2), 0);
  if (recent.length < 2) return {
    heavyStreak:0, comfortStreak:0, quickStreak:0, noveltyStreak:0,
    lightStreak:0, effortStreak:'any', weekdayLean:false, recentCuisines:[],
  };

  const catMap = {};
  (catalogue || []).forEach(m => { catMap[m.name.toLowerCase()] = m; });

  let heavy = 0, comfort = 0, quick = 0, novel = 0, light = 0;
  let involvedCount = 0, moderateCount = 0;
  const recentCuisines = []; // for cuisine fatigue

  recent.forEach((h, idx) => {
    const w    = WEIGHTS[idx] || 0.2;
    const name = (h.meal || h.meal_name || '').toLowerCase();
    const entry = catMap[name];
    if (entry) {
      const tags = entry.tags || [];
      const ef   = entry.effortMins || 25;
      if (tags.includes('heavy') || tags.includes('indulgent'))  heavy   += w;
      if (tags.includes('comfort'))                               comfort += w;
      if (tags.includes('quick') || ef <= 18)                    quick   += w;
      if (tags.includes('regional') || tags.includes('creative')) novel  += w;
      if (tags.includes('light') || tags.includes('healthy'))     light  += w;
      if (ef >= 36)  involvedCount += w;
      if (ef >= 22 && ef < 36) moderateCount += w;
      if (entry.cuisine && entry.cuisine !== 'any') recentCuisines.push(entry.cuisine);
    } else if (h.cuisine && h.cuisine !== 'any') {
      // fallback: use history record's cuisine directly
      recentCuisines.push(h.cuisine);
    }
  });

  const tw = totalWeight || 1;
  // Step 2D: Weekday lean — are most recent meals on weekdays?
  const weekdayLean = recent.filter((h, i) => {
    const d = h.generated_at ? new Date(h.generated_at).getDay() : -1;
    return d >= 1 && d <= 5; // Mon–Fri
  }).length / recent.length > 0.6;

  // Step 2B: Effort streak label — dominant effort level in recent sessions
  const effortStreak = involvedCount / tw >= 0.4 ? 'involved'
                     : quick / tw >= 0.5         ? 'quick'
                     : 'moderate';

  return {
    heavyStreak:   heavy   / tw,  // recency-weighted proportion — heavy/indulgent
    comfortStreak: comfort / tw,  // recency-weighted proportion — comfort
    quickStreak:   quick   / tw,  // recency-weighted proportion — quick/≤18min
    noveltyStreak: novel   / tw,  // recency-weighted proportion — regional/creative
    lightStreak:   light   / tw,  // recency-weighted proportion — light/healthy
    effortStreak,                  // 'quick'|'moderate'|'involved'
    weekdayLean,                   // true if >60% of recent meals were Mon–Fri
    recentCuisines,                // last N cuisines cooked — for fatigue detection
  };
}


// ── Journey context builder ───────────────────────────────────────
// All entry points must call this. Returns a normalised context consumed by
// getPersonalisedRecommendations(). No per-journey scoring logic allowed outside.
export function buildJourneyContext({
  journeyType  = 'default',  // default|mood|ingredient|surprise|weekly|continuity|kids|leftover|hosting|health|religious
  mood         = null,
  ingredients  = [],
  mealTypeOverride = null,
  profile      = null,
  mealHistory  = [],
  rejectStreak = 0,
} = {}) {
  const h = new Date().getHours();
  const autoMealType = mealTypeOverride || getMealTypeFromHour(h);

  // Continuity: what was cooked in the last 3 days
  const cutoff3d       = Date.now() - 3 * 86400000;
  const recent         = (mealHistory || []).filter(m => new Date(m.generated_at || m.created_at || 0).getTime() > cutoff3d).slice(0, 5);
  const recentCuisines = [...new Set(recent.map(m => m.cuisine).filter(Boolean))];
  const recentMeals    = recent.map(m => m.meal_name || m.meal?.name).filter(Boolean);

  const timePressureFlag = getTimePressureFlag(rejectStreak);

  // Base effort preference
  let effortPreference = 'any';
  if (timePressureFlag) effortPreference = 'quick';
  else if (autoMealType === 'breakfast') effortPreference = 'quick';
  else if (isWeekend()) effortPreference = 'any';
  else if (autoMealType === 'dinner') effortPreference = 'moderate';

  // Journey-type overrides for effort + tag boosts
  // These shape the context consumed by the engine — NOT separate logic paths
  const journeyTagBoosts = [];  // extra tag signals to boost in scoring
  let   journeyMealType  = autoMealType;

  if (journeyType === 'kids') {
    effortPreference = 'quick';
    journeyTagBoosts.push('mild', 'safe', 'light', 'healthy', 'protein', 'quick', 'kids', 'one_pot');
    journeyMealType  = autoMealType === 'dinner' ? 'lunch' : autoMealType;
  }
  if (journeyType === 'leftover') {
    effortPreference = 'quick';
    journeyTagBoosts.push('leftover', 'quick', 'comfort', 'one_pot', 'rainy_day');
  }
  if (journeyType === 'hosting') {
    effortPreference = 'any';
    journeyTagBoosts.push('crowd-friendly', 'popular', 'comfort', 'indulgent', 'special', 'hosting', 'festive', 'celebratory');
  }
  if (journeyType === 'health') {
    effortPreference = effortPreference === 'any' ? 'moderate' : effortPreference;
    journeyTagBoosts.push('healthy', 'light', 'protein');
  }
  if (journeyType === 'religious' || journeyType === 'festival') {
    journeyTagBoosts.push('festive', 'mild', 'comfort');
  }

  const activeEvent = getActiveEvent({ region: (profile && profile.country) || 'IN' });

  return {
    journeyType,
    mood,
    ingredients,
    mealType:          journeyMealType,
    effortPreference,
    journeyTagBoosts,
    continuityData:    { recentCuisines, recentMeals },
    timePressureFlag,
    activeEvent,
  };
}

// ── Meal catalogue ────────────────────────────────────────────────
const MEAL_CATALOGUE = [
  // ── BREAKFAST ──────────────────────────────────────────────────────
  { id:'poha',             name:'Poha',                      emoji:'🍚', cuisine:'maharashtrian', mealType:['breakfast','snack'],   diet:['veg','vegan','jain','eggetarian'],   effortMins:15, tags:['quick','light','popular','mild','safe','weekday','one_pot'] },
  { id:'upma',             name:'Upma',                      emoji:'🥣', cuisine:'south_indian',  mealType:['breakfast','snack'],   diet:['veg','vegan','jain','eggetarian'],   effortMins:20, tags:['quick','light','popular','mild','safe','weekday','one_pot'] },
  { id:'idli_sambar',      name:'Idli Sambar',               emoji:'🫓', cuisine:'south_indian',  mealType:['breakfast','lunch'],   diet:['veg','vegan','jain','eggetarian'],   effortMins:30, tags:['light','popular','comfort','mild','healthy','everyday'] },
  { id:'masala_dosa',      name:'Masala Dosa',               emoji:'🥞', cuisine:'south_indian',  mealType:['breakfast','lunch'],   diet:['veg','vegan','eggetarian'],          effortMins:35, tags:['popular','comfort','spicy','weekend','crowd-friendly'] },
  { id:'aloo_paratha',     name:'Aloo Paratha',              emoji:'🫓', cuisine:'punjabi',       mealType:['breakfast','lunch'],   diet:['veg','eggetarian'],                  effortMins:30, tags:['comfort','filling','popular','mild','weekend'] },
  { id:'puri_bhaji',       name:'Puri Bhaji',                emoji:'🫓', cuisine:'maharashtrian', mealType:['breakfast','lunch'],   diet:['veg','eggetarian'],                  effortMins:25, tags:['comfort','popular','festive','weekend'] },
  { id:'methi_paratha',    name:'Methi Paratha',             emoji:'🫓', cuisine:'punjabi',       mealType:['breakfast','lunch'],   diet:['veg','eggetarian'],                  effortMins:25, tags:['healthy','light','mild','weekday'] },
  { id:'besan_chilla',     name:'Besan Chilla',              emoji:'🥞', cuisine:'any',           mealType:['breakfast','snack'],   diet:['veg','vegan','jain','eggetarian'],   effortMins:15, tags:['quick','protein','healthy','mild','weekday','one_pot'] },
  { id:'egg_bhurji',       name:'Egg Bhurji',                emoji:'🍳', cuisine:'any',           mealType:['breakfast','dinner'],  diet:['eggetarian'],                        effortMins:10, tags:['quick','protein','spicy','weekday','one_pot'] },
  { id:'akki_roti',        name:'Akki Roti',                 emoji:'🫓', cuisine:'karnataka',     mealType:['breakfast','lunch'],   diet:['veg','vegan','jain','eggetarian'],   effortMins:20, tags:['quick','light','healthy','weekday','regional'] },
  { id:'rava_uttapam',     name:'Rava Uttapam',              emoji:'🥞', cuisine:'south_indian',  mealType:['breakfast','lunch'],   diet:['veg','eggetarian'],                  effortMins:20, tags:['quick','light','mild','comfort','kids'] },
  { id:'vermicelli_upma',  name:'Vermicelli Upma',           emoji:'🍝', cuisine:'south_indian',  mealType:['breakfast','snack'],   diet:['veg','eggetarian'],                  effortMins:15, tags:['quick','light','mild','kids','weekday','one_pot'] },
  { id:'moong_dal_chilla', name:'Moong Dal Chilla',          emoji:'🥞', cuisine:'any',           mealType:['breakfast','snack'],   diet:['veg','vegan','jain','eggetarian'],   effortMins:15, tags:['quick','protein','healthy','light','weekday'] },
  { id:'banana_pancake',   name:'Banana Oat Pancakes',       emoji:'🥞', cuisine:'any',           mealType:['breakfast'],           diet:['veg','eggetarian'],                  effortMins:20, tags:['kids','healthy','mild','comfort','weekend'] },
  // ── LUNCH ──────────────────────────────────────────────────────────
  { id:'dal_tadka',        name:'Dal Tadka',                 emoji:'🍲', cuisine:'punjabi',       mealType:['lunch','dinner'],      diet:['veg','vegan','eggetarian'],          effortMins:25, tags:['comfort','popular','safe','protein','mild','weekday','everyday'] },
  { id:'rajma',            name:'Rajma Chawal',              emoji:'🫘', cuisine:'punjabi',       mealType:['lunch','dinner'],      diet:['veg','vegan','eggetarian'],          effortMins:45, tags:['comfort','popular','protein','filling','weekend','rainy_day'] },
  { id:'chole_bhature',    name:'Chole Bhature',             emoji:'🍛', cuisine:'punjabi',       mealType:['lunch'],               diet:['veg','eggetarian'],                  effortMins:45, tags:['indulgent','popular','comfort','spicy','weekend','festive','crowd-friendly'] },
  { id:'palak_paneer',     name:'Palak Paneer',              emoji:'🥬', cuisine:'punjabi',       mealType:['lunch','dinner'],      diet:['veg','eggetarian'],                  effortMins:30, tags:['comfort','healthy','protein','popular','mild'] },
  { id:'butter_chicken',   name:'Butter Chicken',            emoji:'🍗', cuisine:'punjabi',       mealType:['lunch','dinner'],      diet:['nonveg'],                            effortMins:40, tags:['indulgent','popular','comfort','mild','hosting','crowd-friendly','weekend'] },
  { id:'chicken_curry',    name:'Chicken Curry',             emoji:'🍗', cuisine:'any',           mealType:['lunch','dinner'],      diet:['nonveg'],                            effortMins:40, tags:['comfort','popular','protein','spicy','everyday','rainy_day'] },
  { id:'fish_curry',       name:'Fish Curry',                emoji:'🐟', cuisine:'kerala',        mealType:['lunch','dinner'],      diet:['nonveg'],                            effortMins:30, tags:['comfort','spicy','protein','regional','rainy_day','everyday'] },
  { id:'prawn_masala',     name:'Prawn Masala',              emoji:'🍤', cuisine:'coastal',       mealType:['lunch','dinner'],      diet:['nonveg'],                            effortMins:25, tags:['protein','spicy','quick','special','hosting'] },
  { id:'sambar_rice',      name:'Sambar Rice',               emoji:'🍚', cuisine:'tamil_nadu',    mealType:['lunch'],               diet:['veg','vegan','eggetarian'],          effortMins:25, tags:['comfort','popular','light','healthy','everyday','one_pot','rainy_day'] },
  { id:'curd_rice',        name:'Curd Rice',                 emoji:'🍚', cuisine:'south_indian',  mealType:['lunch','dinner'],      diet:['veg','eggetarian'],                  effortMins:10, tags:['quick','light','comfort','safe','kids','healthy','one_pot'] },
  { id:'lemon_rice',       name:'Lemon Rice',                emoji:'🍋', cuisine:'south_indian',  mealType:['lunch'],               diet:['veg','vegan','jain','eggetarian'],   effortMins:20, tags:['quick','light','tangy','kids','one_pot','weekday'] },
  { id:'tamarind_rice',    name:'Tamarind Rice',             emoji:'🍚', cuisine:'tamil_nadu',    mealType:['lunch'],               diet:['veg','vegan','jain','eggetarian'],   effortMins:20, tags:['quick','tangy','light','regional','weekday','one_pot'] },
  { id:'pongal',           name:'Ven Pongal',                emoji:'🍚', cuisine:'tamil_nadu',    mealType:['breakfast','lunch'],   diet:['veg','eggetarian'],                  effortMins:25, tags:['comfort','mild','light','safe','kids','rainy_day','one_pot'] },
  { id:'rasam_rice',       name:'Rasam Rice',                emoji:'🍲', cuisine:'tamil_nadu',    mealType:['lunch','dinner'],      diet:['veg','vegan','eggetarian'],          effortMins:20, tags:['quick','light','comfort','rainy_day','healthy','one_pot'] },
  { id:'kootu',            name:'Keerai Kootu',              emoji:'🥬', cuisine:'tamil_nadu',    mealType:['lunch'],               diet:['veg','vegan','eggetarian'],          effortMins:25, tags:['healthy','light','mild','regional','everyday'] },
  { id:'bisi_bele_bath',   name:'Bisi Bele Bath',            emoji:'🍲', cuisine:'karnataka',     mealType:['lunch'],               diet:['veg','eggetarian'],                  effortMins:40, tags:['comfort','filling','spicy','one_pot','weekend','rainy_day'] },
  { id:'vangi_bath',       name:'Vangi Bath',                emoji:'🍆', cuisine:'karnataka',     mealType:['lunch'],               diet:['veg','vegan','eggetarian'],          effortMins:30, tags:['comfort','spicy','regional','everyday'] },
  { id:'bhindi_masala',    name:'Bhindi Masala',             emoji:'🫑', cuisine:'any',           mealType:['lunch','dinner'],      diet:['veg','vegan','jain','eggetarian'],   effortMins:20, tags:['quick','light','healthy','everyday','mild'] },
  { id:'aloo_gobi',        name:'Aloo Gobi',                 emoji:'🥔', cuisine:'punjabi',       mealType:['lunch','dinner'],      diet:['veg','vegan','jain','eggetarian'],   effortMins:20, tags:['quick','comfort','mild','everyday','weekday'] },
  { id:'matar_paneer',     name:'Matar Paneer',              emoji:'🫛', cuisine:'punjabi',       mealType:['lunch','dinner'],      diet:['veg','eggetarian'],                  effortMins:25, tags:['comfort','protein','mild','popular','everyday'] },
  { id:'chana_masala',     name:'Chana Masala',              emoji:'🫘', cuisine:'punjabi',       mealType:['lunch','dinner'],      diet:['veg','vegan','eggetarian'],          effortMins:30, tags:['comfort','protein','spicy','popular','everyday','rainy_day'] },
  { id:'dal_makhani',      name:'Dal Makhani',               emoji:'🫘', cuisine:'punjabi',       mealType:['lunch','dinner'],      diet:['veg','eggetarian'],                  effortMins:50, tags:['indulgent','comfort','popular','hosting','weekend','crowd-friendly'] },
  { id:'kadai_paneer',     name:'Kadai Paneer',              emoji:'🫑', cuisine:'punjabi',       mealType:['lunch','dinner'],      diet:['veg','eggetarian'],                  effortMins:30, tags:['spicy','protein','popular','hosting','weekend'] },
  { id:'shahi_paneer',     name:'Shahi Paneer',              emoji:'🧀', cuisine:'punjabi',       mealType:['lunch','dinner'],      diet:['veg','eggetarian'],                  effortMins:35, tags:['indulgent','comfort','mild','hosting','festive','crowd-friendly'] },
  { id:'mixed_veg',        name:'Mixed Veg Curry',           emoji:'🥕', cuisine:'any',           mealType:['lunch','dinner'],      diet:['veg','vegan','jain','eggetarian'],   effortMins:20, tags:['light','healthy','mild','safe','everyday','weekday'] },
  // ── DINNER ─────────────────────────────────────────────────────────
  { id:'biryani_veg',      name:'Veg Biryani',               emoji:'🍚', cuisine:'hyderabadi',    mealType:['lunch','dinner'],      diet:['veg','eggetarian'],                  effortMins:50, tags:['festive','hosting','crowd-friendly','indulgent','weekend','celebratory'] },
  { id:'biryani_chicken',  name:'Chicken Biryani',           emoji:'🍗', cuisine:'hyderabadi',    mealType:['lunch','dinner'],      diet:['nonveg'],                            effortMins:60, tags:['festive','hosting','crowd-friendly','indulgent','weekend','celebratory'] },
  { id:'pulao',            name:'Vegetable Pulao',           emoji:'🍚', cuisine:'any',           mealType:['lunch','dinner'],      diet:['veg','vegan','eggetarian'],          effortMins:25, tags:['light','mild','quick','weekday','one_pot'] },
  { id:'jeera_rice',       name:'Jeera Rice',                emoji:'🍚', cuisine:'any',           mealType:['lunch','dinner'],      diet:['veg','vegan','jain','eggetarian'],   effortMins:15, tags:['quick','mild','light','safe','weekday','one_pot'] },
  { id:'egg_curry',        name:'Egg Curry',                 emoji:'🥚', cuisine:'any',           mealType:['lunch','dinner'],      diet:['eggetarian'],                        effortMins:25, tags:['protein','spicy','comfort','everyday','quick'] },
  { id:'mutton_curry',     name:'Mutton Curry',              emoji:'🥩', cuisine:'any',           mealType:['dinner'],              diet:['nonveg'],                            effortMins:60, tags:['indulgent','spicy','protein','weekend','special','rainy_day'] },
  { id:'keema_matar',      name:'Keema Matar',               emoji:'🥩', cuisine:'punjabi',       mealType:['lunch','dinner'],      diet:['nonveg'],                            effortMins:30, tags:['protein','spicy','comfort','everyday','quick'] },
  { id:'chicken_65',       name:'Chicken 65',                emoji:'🍗', cuisine:'south_indian',  mealType:['dinner','snack'],      diet:['nonveg'],                            effortMins:30, tags:['spicy','crispy','protein','kids','hosting','crowd-friendly'] },
  { id:'paneer_tikka',     name:'Paneer Tikka',              emoji:'🧀', cuisine:'punjabi',       mealType:['dinner','snack'],      diet:['veg','eggetarian'],                  effortMins:30, tags:['protein','hosting','crowd-friendly','spicy','weekend','festive'] },
  { id:'tandoori_chicken', name:'Tandoori Chicken',          emoji:'🍗', cuisine:'punjabi',       mealType:['dinner'],              diet:['nonveg'],                            effortMins:45, tags:['hosting','crowd-friendly','spicy','protein','weekend','festive'] },
  { id:'rogan_josh',       name:'Rogan Josh',                emoji:'🍖', cuisine:'kashmiri',      mealType:['lunch','dinner'],      diet:['nonveg'],                            effortMins:60, tags:['indulgent','spicy','special','hosting','rainy_day','weekend'] },
  { id:'malabar_chicken',  name:'Malabar Chicken Curry',     emoji:'🍗', cuisine:'kerala',        mealType:['lunch','dinner'],      diet:['nonveg'],                            effortMins:35, tags:['spicy','comfort','protein','regional','rainy_day'] },
  { id:'avial',            name:'Avial',                     emoji:'🥕', cuisine:'kerala',        mealType:['lunch','dinner'],      diet:['veg','vegan','eggetarian'],          effortMins:35, tags:['healthy','light','regional','comfort','festive'] },
  { id:'puttu_kadala',     name:'Puttu & Kadala Curry',      emoji:'🥥', cuisine:'kerala',        mealType:['breakfast','lunch'],   diet:['veg','vegan','eggetarian'],          effortMins:40, tags:['comfort','regional','weekend','special','protein'] },
  { id:'theeyal',          name:'Theeyal',                   emoji:'🍲', cuisine:'kerala',        mealType:['lunch','dinner'],      diet:['veg','vegan','eggetarian'],          effortMins:40, tags:['spicy','regional','comfort','rainy_day','special'] },
  { id:'chettinad_chicken',name:'Chettinad Chicken',         emoji:'🍗', cuisine:'tamil_nadu',    mealType:['lunch','dinner'],      diet:['nonveg'],                            effortMins:45, tags:['spicy','special','regional','protein','weekend'] },
  { id:'kuzhambu',         name:'Vatha Kuzhambu',            emoji:'🍲', cuisine:'tamil_nadu',    mealType:['lunch','dinner'],      diet:['veg','vegan','eggetarian'],          effortMins:25, tags:['spicy','tangy','comfort','regional','rainy_day','everyday'] },
  { id:'dal_palak',        name:'Dal Palak',                 emoji:'🥬', cuisine:'any',           mealType:['lunch','dinner'],      diet:['veg','vegan','eggetarian'],          effortMins:20, tags:['healthy','light','quick','protein','mild','weekday','one_pot'] },
  { id:'aloo_methi',       name:'Aloo Methi',                emoji:'🌿', cuisine:'punjabi',       mealType:['lunch','dinner'],      diet:['veg','vegan','jain','eggetarian'],   effortMins:20, tags:['healthy','light','quick','weekday','mild'] },
  { id:'baingan_bharta',   name:'Baingan Bharta',            emoji:'🍆', cuisine:'punjabi',       mealType:['lunch','dinner'],      diet:['veg','vegan','eggetarian'],          effortMins:30, tags:['smoky','comfort','spicy','everyday','rainy_day'] },
  { id:'lauki_dal',        name:'Lauki Dal',                 emoji:'🥒', cuisine:'any',           mealType:['lunch','dinner'],      diet:['veg','vegan','eggetarian'],          effortMins:25, tags:['light','healthy','mild','weekday','one_pot','everyday'] },
  { id:'mushroom_masala',  name:'Mushroom Masala',           emoji:'🍄', cuisine:'any',           mealType:['lunch','dinner'],      diet:['veg','vegan','eggetarian'],          effortMins:20, tags:['quick','protein','spicy','weekday','everyday'] },
  { id:'egg_masala_rice',  name:'Egg Masala Rice',           emoji:'🍳', cuisine:'any',           mealType:['lunch','dinner'],      diet:['eggetarian'],                        effortMins:20, tags:['quick','protein','one_pot','weekday','comfort'] },
  // ── SNACKS + SIDES ─────────────────────────────────────────────────
  { id:'samosa',           name:'Samosa',                    emoji:'🔶', cuisine:'any',           mealType:['snack'],               diet:['veg','vegan','eggetarian'],          effortMins:45, tags:['comfort','popular','spicy','festive','kids','crowd-friendly','weekend'] },
  { id:'vada_pav',         name:'Vada Pav',                  emoji:'🍔', cuisine:'maharashtrian', mealType:['snack','lunch'],        diet:['veg','vegan','eggetarian'],          effortMins:30, tags:['comfort','popular','spicy','kids','street_food','weekend'] },
  { id:'masala_chai_pakora',name:'Masala Pakoras',           emoji:'🫚', cuisine:'any',           mealType:['snack'],               diet:['veg','eggetarian'],                  effortMins:20, tags:['comfort','quick','rainy_day','spicy','kids','crowd-friendly'] },
  { id:'aloo_tikki',       name:'Aloo Tikki Chaat',          emoji:'🥔', cuisine:'any',           mealType:['snack'],               diet:['veg','eggetarian'],                  effortMins:30, tags:['comfort','spicy','tangy','kids','street_food','popular'] },
  { id:'pani_puri',        name:'Pani Puri',                 emoji:'🫙', cuisine:'any',           mealType:['snack'],               diet:['veg','vegan','eggetarian'],          effortMins:30, tags:['comfort','popular','kids','tangy','spicy','festive'] },
  { id:'misal_pav',        name:'Misal Pav',                 emoji:'🍲', cuisine:'maharashtrian', mealType:['breakfast','lunch'],   diet:['veg','eggetarian'],                  effortMins:35, tags:['spicy','comfort','protein','popular','regional','weekend'] },
  { id:'khandvi',          name:'Khandvi',                   emoji:'🌯', cuisine:'gujarati',      mealType:['snack'],               diet:['veg','eggetarian'],                  effortMins:30, tags:['light','mild','comfort','festive','kids','regional'] },
  { id:'dhokla',           name:'Steamed Dhokla',            emoji:'🫓', cuisine:'gujarati',      mealType:['breakfast','snack'],   diet:['veg','eggetarian'],                  effortMins:40, tags:['healthy','light','mild','festive','kids','popular'] },
  { id:'thepla',           name:'Thepla',                    emoji:'🫓', cuisine:'gujarati',      mealType:['breakfast','snack'],   diet:['veg','eggetarian'],                  effortMins:20, tags:['quick','healthy','light','weekday','mild','everyday'] },
  // ── INDO-CHINESE ────────────────────────────────────────────────────
  { id:'hakka_noodles',    name:'Hakka Noodles',             emoji:'🍜', cuisine:'indo_chinese',  mealType:['lunch','dinner'],      diet:['veg','eggetarian'],                  effortMins:20, tags:['quick','kids','crowd-friendly','spicy','weekday','popular','one_pot'] },
  { id:'veg_fried_rice',   name:'Vegetable Fried Rice',      emoji:'🍳', cuisine:'indo_chinese',  mealType:['lunch','dinner'],      diet:['veg','eggetarian'],                  effortMins:20, tags:['quick','kids','popular','mild','weekday','one_pot'] },
  { id:'chilli_paneer',    name:'Chilli Paneer',             emoji:'🌶️', cuisine:'indo_chinese',  mealType:['lunch','dinner'],      diet:['veg','eggetarian'],                  effortMins:25, tags:['spicy','protein','kids','popular','hosting','quick','crowd-friendly'] },
  { id:'chicken_manchurian',name:'Chicken Manchurian',       emoji:'🍗', cuisine:'indo_chinese',  mealType:['lunch','dinner'],      diet:['nonveg'],                            effortMins:30, tags:['spicy','protein','kids','popular','hosting','crowd-friendly'] },
  { id:'gobi_manchurian',  name:'Gobi Manchurian',           emoji:'🥦', cuisine:'indo_chinese',  mealType:['lunch','dinner'],      diet:['veg','eggetarian'],                  effortMins:25, tags:['spicy','kids','popular','quick','hosting','crowd-friendly'] },
  { id:'veg_chowmein',     name:'Veg Chowmein',              emoji:'🍝', cuisine:'indo_chinese',  mealType:['lunch','dinner'],      diet:['veg','eggetarian'],                  effortMins:15, tags:['quick','kids','mild','weekday','popular','one_pot'] },
  { id:'spring_rolls',     name:'Veg Spring Rolls',          emoji:'🌯', cuisine:'indo_chinese',  mealType:['snack','dinner'],      diet:['veg','eggetarian'],                  effortMins:40, tags:['crispy','hosting','kids','crowd-friendly','weekend','festive'] },
  // ── HOSTING / SPECIAL OCCASION ──────────────────────────────────────
  { id:'paneer_butter_masala',name:'Paneer Butter Masala',   emoji:'🧀', cuisine:'punjabi',       mealType:['lunch','dinner'],      diet:['veg','eggetarian'],                  effortMins:30, tags:['hosting','comfort','mild','crowd-friendly','popular','festive','indulgent'] },
  { id:'dum_aloo',         name:'Dum Aloo',                  emoji:'🥔', cuisine:'kashmiri',      mealType:['lunch','dinner'],      diet:['veg','eggetarian'],                  effortMins:45, tags:['indulgent','spicy','hosting','special','weekend','festive'] },
  { id:'lamb_biryani',     name:'Lamb Biryani',              emoji:'🍖', cuisine:'hyderabadi',    mealType:['lunch','dinner'],      diet:['nonveg'],                            effortMins:90, tags:['hosting','festive','celebratory','indulgent','crowd-friendly','special','weekend'] },
  { id:'fish_biryani',     name:'Fish Biryani',              emoji:'🐟', cuisine:'coastal',       mealType:['lunch','dinner'],      diet:['nonveg'],                            effortMins:60, tags:['hosting','special','spicy','festive','weekend'] },
  { id:'nihari',           name:'Nihari',                    emoji:'🍖', cuisine:'any',           mealType:['breakfast','dinner'],  diet:['nonveg'],                            effortMins:120,tags:['special','indulgent','hosting','rainy_day','weekend','festive','celebratory'] },
  { id:'dal_baati_churma', name:'Dal Baati Churma',          emoji:'🫓', cuisine:'rajasthani',    mealType:['lunch','dinner'],      diet:['veg','eggetarian'],                  effortMins:90, tags:['hosting','festive','special','indulgent','regional','celebratory'] },
  { id:'laal_maas',        name:'Laal Maas',                 emoji:'🥩', cuisine:'rajasthani',    mealType:['lunch','dinner'],      diet:['nonveg'],                            effortMins:60, tags:['spicy','special','hosting','regional','weekend','indulgent'] },
  { id:'paya',             name:'Paya',                      emoji:'🍲', cuisine:'any',           mealType:['breakfast','dinner'],  diet:['nonveg'],                            effortMins:120,tags:['special','comfort','rainy_day','weekend','regional'] },
  // ── QUICK WEEKDAY ────────────────────────────────────────────────────
  { id:'khichdi',          name:'Moong Dal Khichdi',         emoji:'🍲', cuisine:'any',           mealType:['lunch','dinner'],      diet:['veg','vegan','jain','eggetarian'],   effortMins:20, tags:['quick','comfort','healthy','safe','mild','kids','rainy_day','one_pot','weekday'] },
  { id:'poha_batata',      name:'Batata Poha',               emoji:'🍚', cuisine:'maharashtrian', mealType:['breakfast','snack'],   diet:['veg','vegan','eggetarian'],          effortMins:15, tags:['quick','light','mild','kids','weekday','one_pot'] },
  { id:'rava_dosa',        name:'Rava Dosa',                 emoji:'🥞', cuisine:'south_indian',  mealType:['breakfast','lunch'],   diet:['veg','eggetarian'],                  effortMins:20, tags:['quick','light','crispy','mild','weekday'] },
  { id:'pesarattu',        name:'Pesarattu',                 emoji:'🥞', cuisine:'andhra',        mealType:['breakfast','lunch'],   diet:['veg','vegan','eggetarian'],          effortMins:15, tags:['quick','protein','healthy','light','weekday','regional'] },
  { id:'dal_rice',         name:'Simple Dal Rice',           emoji:'🍚', cuisine:'any',           mealType:['lunch','dinner'],      diet:['veg','vegan','jain','eggetarian'],   effortMins:20, tags:['quick','comfort','safe','mild','kids','weekday','one_pot','everyday'] },
  { id:'tur_dal',          name:'Tur Dal',                   emoji:'🫘', cuisine:'any',           mealType:['lunch','dinner'],      diet:['veg','vegan','jain','eggetarian'],   effortMins:25, tags:['comfort','healthy','mild','protein','weekday','everyday','one_pot'] },
  { id:'tomato_rice',      name:'Tomato Rice',               emoji:'🍅', cuisine:'south_indian',  mealType:['lunch'],               diet:['veg','vegan','eggetarian'],          effortMins:20, tags:['quick','tangy','comfort','weekday','one_pot'] },
  { id:'masala_khichdi',   name:'Masala Khichdi',            emoji:'🍲', cuisine:'any',           mealType:['lunch','dinner'],      diet:['veg','eggetarian'],                  effortMins:25, tags:['comfort','one_pot','rainy_day','quick','healthy','weekday'] },
  { id:'tawa_roti_sabzi',  name:'Tawa Roti + Sabzi',         emoji:'🫓', cuisine:'any',           mealType:['lunch','dinner'],      diet:['veg','vegan','jain','eggetarian'],   effortMins:20, tags:['quick','light','everyday','mild','weekday','healthy'] },
  // ── KIDS / FAMILY ────────────────────────────────────────────────────
  { id:'mac_masala',       name:'Masala Macaroni',           emoji:'🍝', cuisine:'any',           mealType:['lunch','dinner'],      diet:['veg','eggetarian'],                  effortMins:20, tags:['quick','kids','mild','popular','weekday','one_pot'] },
  { id:'paneer_paratha',   name:'Paneer Paratha',            emoji:'🫓', cuisine:'punjabi',       mealType:['breakfast','lunch'],   diet:['veg','eggetarian'],                  effortMins:25, tags:['kids','comfort','protein','mild','weekend','filling'] },
  { id:'veggie_pasta',     name:'Veggie Pasta',              emoji:'🍝', cuisine:'any',           mealType:['lunch','dinner'],      diet:['veg','eggetarian'],                  effortMins:20, tags:['quick','kids','mild','weekday','popular','one_pot'] },
  { id:'mashed_potato_toast',name:'Mashed Potato Toast',     emoji:'🍞', cuisine:'any',           mealType:['breakfast','snack'],   diet:['veg','eggetarian'],                  effortMins:15, tags:['quick','kids','mild','comfort','weekday'] },
  { id:'sweet_corn_soup',  name:'Sweet Corn Soup',           emoji:'🌽', cuisine:'any',           mealType:['dinner','snack'],      diet:['veg','eggetarian'],                  effortMins:15, tags:['quick','kids','mild','light','rainy_day','comfort','one_pot'] },
  // ── RAINY DAY / COMFORT ──────────────────────────────────────────────
  { id:'masala_chai_sandwich',name:'Masala Sandwich',        emoji:'🥪', cuisine:'any',           mealType:['breakfast','snack'],   diet:['veg','eggetarian'],                  effortMins:10, tags:['quick','comfort','rainy_day','kids','mild','weekday'] },
  { id:'tomato_soup',      name:'Tomato Soup & Toast',       emoji:'🍅', cuisine:'any',           mealType:['dinner','snack'],      diet:['veg','vegan','eggetarian'],          effortMins:20, tags:['light','comfort','rainy_day','mild','kids','one_pot'] },
  { id:'hot_and_sour_soup',name:'Hot & Sour Soup',           emoji:'🍜', cuisine:'indo_chinese',  mealType:['dinner','snack'],      diet:['veg','eggetarian'],                  effortMins:15, tags:['quick','rainy_day','light','spicy','one_pot'] },
  { id:'masoor_dal',       name:'Masoor Dal',                emoji:'🫘', cuisine:'any',           mealType:['lunch','dinner'],      diet:['veg','vegan','eggetarian'],          effortMins:20, tags:['quick','comfort','healthy','protein','rainy_day','one_pot','weekday'] },
  { id:'egg_drop_soup',    name:'Egg Drop Soup',             emoji:'🥚', cuisine:'indo_chinese',  mealType:['dinner','snack'],      diet:['eggetarian'],                        effortMins:10, tags:['quick','light','rainy_day','comfort','one_pot'] },
  { id:'moong_soup',       name:'Moong Soup',                emoji:'🫘', cuisine:'any',           mealType:['dinner','snack'],      diet:['veg','vegan','jain','eggetarian'],   effortMins:25, tags:['light','healthy','mild','rainy_day','comfort','one_pot'] },
  // ── BENGALI ─────────────────────────────────────────────────────────
  { id:'shorshe_ilish',    name:'Shorshe Ilish',             emoji:'🐟', cuisine:'bengali',       mealType:['lunch','dinner'],      diet:['nonveg'],                            effortMins:25, tags:['special','regional','protein','spicy','comfort','weekend'] },
  { id:'aloo_posto',       name:'Aloo Posto',                emoji:'🥔', cuisine:'bengali',       mealType:['lunch','dinner'],      diet:['veg','vegan','eggetarian'],          effortMins:20, tags:['quick','regional','mild','comfort','everyday'] },
  { id:'cholar_dal',       name:'Cholar Dal',                emoji:'🫘', cuisine:'bengali',       mealType:['lunch','dinner'],      diet:['veg','eggetarian'],                  effortMins:30, tags:['comfort','festive','mild','regional','weekend'] },
  { id:'kosha_mangsho',    name:'Kosha Mangsho',             emoji:'🥩', cuisine:'bengali',       mealType:['lunch','dinner'],      diet:['nonveg'],                            effortMins:60, tags:['spicy','special','indulgent','weekend','regional','hosting'] },
  // ── ANDHRA ──────────────────────────────────────────────────────────
  { id:'gongura_mutton',   name:'Gongura Mutton',            emoji:'🥩', cuisine:'andhra',        mealType:['lunch','dinner'],      diet:['nonveg'],                            effortMins:50, tags:['spicy','tangy','special','regional','protein','weekend'] },
  { id:'pesarattu_upma',   name:'Pesarattu with Upma',       emoji:'🥞', cuisine:'andhra',        mealType:['breakfast'],           diet:['veg','eggetarian'],                  effortMins:30, tags:['healthy','protein','regional','weekend','comfort'] },
];


// ── Utilities ─────────────────────────────────────────────────────
function getMealTypeFromHour(h) {
  if (h >= 5  && h < 11) return 'breakfast';
  if (h >= 11 && h < 16) return 'lunch';
  if (h >= 16 && h < 19) return 'snack';
  return 'dinner';
}

function isWeekend() {
  const d = new Date().getDay();
  return d === 0 || d === 6;
}

function isDietaryCompatible(meal, userDietIds) {
  if (!userDietIds || !userDietIds.length) return true;
  if (userDietIds.includes('non-veg')) return true;
  if (userDietIds.includes('vegan') && !userDietIds.includes('veg')) return meal.diet.includes('vegan');
  if (userDietIds.includes('jain'))       return meal.diet.includes('jain') || meal.diet.includes('veg');
  if (userDietIds.includes('halal'))      return meal.diet.includes('halal') || meal.diet.includes('veg');
  if (userDietIds.includes('eggetarian')) return meal.diet.includes('veg')  || meal.diet.includes('eggetarian');
  if (userDietIds.includes('veg'))        return meal.diet.includes('veg');
  return userDietIds.some(d => meal.diet.includes(d));
}

function buildRecentHistorySet(mealHistory, windowDays = 7) {
  const cutoff = Date.now() - windowDays * 86400000;
  const names  = new Set();
  (mealHistory || []).forEach(h => {
    const ts = new Date(h.generated_at || h.created_at || 0).getTime();
    if (ts > cutoff) {
      if (h.meal_name)  names.add(h.meal_name.toLowerCase().trim());
      if (h.meal?.name) names.add(h.meal.name.toLowerCase().trim());
    }
  });
  return names;
}

function normC(raw) { return (raw || '').toLowerCase().replace(/[^a-z_]/g, ''); }

function capCuisine(id) {
  if (!id || id === 'any') return '';
  return id.replace(/_/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// ── Brain v2.1: Score a single meal ─────────────────────────────
// Six named, independent components. Each returns a value in [0, 1].
// Hard exclusions return null early (meal is dropped from candidates).
function scoreMeal(meal, ctx) {
  const {
    userDietIds, userCuisines, userGoal, userSkill,
    ratings, mealHistory, recentHistorySet, recentlyShownSet, rejectedSet,
    targetMealType, effortBias, timePressureFlag,
    learnedWeights, learnedCuisines, learnedEffortPref,
    forceShift, forceShiftExcludedCuisines, forceShiftExcludeHeavy,
    continuityRecentCuisines, activeEvent, journeyTagBoosts,
    successBoostMap = {},
    lastCookedName  = null,
    implicitProfile    = {},
    continuityProfile  = {},
  } = ctx;

  const nameLower       = meal.name.toLowerCase().trim();
  const mealCuisineNorm = normC(meal.cuisine);

  // ── Hard exclusions (drop before scoring) ───────────────────────
  if (rejectedSet.has(nameLower))                                     return null;
  if (forceShift && forceShiftExcludedCuisines.has(mealCuisineNorm)) return null;
  if (forceShift && forceShiftExcludeHeavy && meal.tags.includes('heavy')) return null;
  if (timePressureFlag && meal.effortMins > 30)                       return null;
  if (targetMealType === 'breakfast' && !meal.mealType.includes('breakfast')) return null;

  // ── 1. preferenceScore (weight 0.35) ──────────────────────────
  // Cuisine fit, user goal, journey context, learned cuisine, event boosts.
  const allCuisines  = [...new Set([...userCuisines.map(normC), ...learnedCuisines.map(normC)])];
  const prefIdx      = allCuisines.indexOf(mealCuisineNorm);

  let preferenceScore = 0;

  // Cuisine match — higher rank = bigger boost
  if      (prefIdx === 0)        preferenceScore += 0.70;
  else if (prefIdx === 1)        preferenceScore += 0.42;
  else if (prefIdx >= 2)         preferenceScore += 0.18;
  else if (meal.cuisine === 'any') preferenceScore += 0.02; // v2.1: "any" cuisine penalty (was 0.12)

  // History boost — cuisine rated highly in past
  let historyWhyKey   = null;
  let historyHighRate = 0;
  (mealHistory || []).slice(0, 30).forEach(h => {
    const hCuisine = normC(h.cuisine);
    const rating   = (ratings && (ratings[h.meal_name] || ratings[h.meal?.name])) || h.rating || 0;
    if (hCuisine === mealCuisineNorm) {
      preferenceScore += rating >= 4 ? 0.18 : rating >= 3 ? 0.09 : 0.03;
      preferenceScore  = Math.min(1, preferenceScore);
      if (rating >= 4) { historyWhyKey = 'liked_cuisine'; historyHighRate = Math.max(historyHighRate, rating); }
    }
  });

  // Goal signals
  if (userGoal === 'eat_healthier'  && (meal.tags.includes('healthy') || meal.tags.includes('light'))) preferenceScore += 0.22;
  if (userGoal === 'cook_faster'    && meal.effortMins <= 15)  preferenceScore += 0.30;
  else if (userGoal === 'cook_faster' && meal.effortMins <= 20) preferenceScore += 0.15;
  if (userGoal === 'reduce_waste'   && meal.tags.includes('leftover')) preferenceScore += 0.28;
  if (userGoal === 'try_new_things' && !allCuisines.includes(mealCuisineNorm) && meal.cuisine !== 'any') preferenceScore += 0.28;

  // Skill match
  if (userSkill === 'beginner' && meal.effortMins <= 20) preferenceScore += 0.08;
  if (userSkill === 'advanced' && meal.effortMins >= 30) preferenceScore += 0.08;

  // Journey tag boosts
  if (journeyTagBoosts?.length) {
    const matchCount = journeyTagBoosts.filter(t => meal.tags.includes(t)).length;
    if (matchCount > 0) preferenceScore += Math.min(0.36, matchCount * 0.10);
  }

  // Event boost
  preferenceScore += getEventBoost(meal, activeEvent);

  preferenceScore = Math.min(1, preferenceScore);

  // Cuisine lock-in penalty (v2.1: same cuisine × 2 in session → × 0.40)
  const cuisineHistNow = getSessionCuisineHistory();
  const recentTwo      = cuisineHistNow.slice(-2);
  if (recentTwo.length === 2 && recentTwo.every(c => normC(c) === mealCuisineNorm) && mealCuisineNorm !== 'any') {
    preferenceScore *= 0.40;
  }

  // ── 2. timeScore (weight 0.20) ────────────────────────────────
  // Meal type fit, effort vs time pressure, time-of-day signals.
  let timeScore = 0;

  if (meal.mealType.includes(targetMealType))   timeScore += 0.55;

  if (effortBias === 'quick') {
    if      (meal.effortMins <= 15)  timeScore += 0.30;
    else if (meal.effortMins <= 20)  timeScore += 0.15;
    else if (meal.effortMins > 30)   timeScore -= 0.15;
  } else if (effortBias === 'moderate') {
    if (meal.effortMins <= 25)      timeScore += 0.18;
  } else {
    timeScore += 0.08;
  }

  if (timePressureFlag && meal.effortMins <= 15)  timeScore += 0.18;

  const hNow = new Date().getHours();
  if (hNow >= 19 && hNow < 23 && meal.tags.includes('light')) timeScore += 0.08;
  if (hNow >= 5  && hNow < 9  && meal.tags.includes('quick')) timeScore += 0.08;

  timeScore = Math.min(1, Math.max(0, timeScore));

  // ── 3. successScore (weight 0.15) ─────────────────────────────
  // Learned meal weights from ratings + successBoostMap (confirmed cooks + likes).
  const learnedW   = learnedWeights[meal.id] || 0;
  let successScore = (learnedW + 1) / 2;

  if (learnedEffortPref === 'quick'    && meal.effortMins <= 15)                       successScore += 0.25;
  if (learnedEffortPref === 'moderate' && meal.effortMins <= 25 && meal.effortMins > 15) successScore += 0.18;
  if (learnedEffortPref === 'involved' && meal.effortMins > 25)                        successScore += 0.18;

  if (learnedCuisines.length > 0) {
    const lnorm = learnedCuisines.map(normC);
    const lIdx  = lnorm.indexOf(mealCuisineNorm);
    if (lIdx === 0)      successScore += 0.22;
    else if (lIdx === 1) successScore += 0.10;
  }

  successScore += (successBoostMap[nameLower] || 0);
  successScore  = Math.min(1, successScore);

  // ── 4. varietyScore (weight 0.15) ─────────────────────────────
  // Penalise recently shown/cooked meals; reward unseen cuisines.
  let varietyScore = 1.0;
  if      (recentlyShownSet.has(nameLower))    varietyScore = 0.02;
  else if (recentHistorySet.has(nameLower))    varietyScore = 0.22;

  const cuisineHist = getSessionCuisineHistory();
  const lastTwoC    = cuisineHist.slice(-2);
  if (lastTwoC.length === 2 && lastTwoC.every(c => normC(c) === mealCuisineNorm) && mealCuisineNorm !== 'any')
    varietyScore = Math.min(varietyScore, 0.15);
  if (!cuisineHist.slice(-5).includes(mealCuisineNorm) && mealCuisineNorm !== 'any')
    varietyScore = Math.min(1, varietyScore + 0.18);

  // Continuity penalty from 7-day history (avoid overdoing same cuisine family)
  if (continuityRecentCuisines.includes(mealCuisineNorm) && meal.cuisine !== 'any')
    varietyScore = Math.max(0, varietyScore - 0.12);

  // ── 5. feasibilityScore (weight 0.10) — NEW ───────────────────
  // Penalise meals where the user likely lacks key ingredients.
  // // MUST_HAVE tags are a proxy for "key ingredients" — heavy/indulgent meals
  // tend to need speciality items; light/quick meals tend to use staples.
  let feasibilityScore = 1.0;

  // Pantry pre-input removed — feasibility uses tag-based proxy only
  {
    // Proxy: heavy/special meals require harder-to-find ingredients
    // Quick/light/everyday meals are assumed feasible with a basic pantry
    if (meal.tags.includes('heavy') || meal.tags.includes('indulgent') || meal.tags.includes('special')) {
      feasibilityScore = 0.65; // some uncertainty about ingredient availability
    } else if (meal.tags.includes('quick') || meal.tags.includes('everyday') || meal.tags.includes('safe')) {
      feasibilityScore = 0.95; // very likely achievable with basic pantry
    }
    // Default for unlabelled meals: 0.80 (neutral)
    else feasibilityScore = 0.80;
  }

  // ── 6. continuityScore (weight 0.05) — NEW ────────────────────
  // v2.1: tag-similarity to recently cooked meals (not same-cuisine boost).
  // Rewards meals that feel like a "natural next" based on shared food properties.
  let continuityScore = 0.5; // neutral baseline

  if (lastCookedName && lastCookedName !== nameLower) {
    const lastEntry = MEAL_CATALOGUE.find(m => m.name.toLowerCase() === lastCookedName);
    if (lastEntry) {
      // Count shared tags between lastCooked and this candidate
      const sharedTags = meal.tags.filter(t => lastEntry.tags.includes(t)).length;
      const totalTags  = new Set([...meal.tags, ...lastEntry.tags]).size;
      // Jaccard similarity
      const similarity = totalTags > 0 ? sharedTags / totalTags : 0;
      // High similarity (same vibe) = slight boost. Very high = too repetitive = slight reduce.
      if      (similarity >= 0.5)  continuityScore = 0.70; // natural continuation
      else if (similarity >= 0.25) continuityScore = 0.60; // somewhat related
      else if (similarity <= 0.1)  continuityScore = 0.35; // very different — mild variety push
      else                         continuityScore = 0.50;
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // SECTION B — Behavioral adjustment (implicit learning signals)
  //   Declaration → Computation → Validation → Bounded cap
  //   Scope: outer function — not inside any conditional
  // ══════════════════════════════════════════════════════════════════
  let implicitAdj = 0; // declared in outer scope — always accessible to SECTION E
  if (implicitProfile && implicitProfile.hasEnoughData) {
    const em = meal.effortMins || 30;
    if (implicitProfile.effortTolerance === 'quick'    && em <= 18) implicitAdj += 0.05;
    if (implicitProfile.effortTolerance === 'involved' && em >= 40)  implicitAdj += 0.04;
    if (implicitProfile.effortTolerance === 'quick'    && em >= 45)  implicitAdj -= 0.04;
    if ((implicitProfile.noveltyAppetite || 0) > 0.7 && varietyScore < 0.4) implicitAdj -= 0.04;
    const isWeekend = [0, 6].includes(new Date().getDay());
    if (implicitProfile.weekendUser && isWeekend && (meal.tags || []).includes('hosting')) implicitAdj += 0.04;
    if ((implicitProfile.swapVelocityMean || 0) < -0.5) {
      if ((meal.tags || []).some(t => ['creative','fusion','party','new'].includes(t))) implicitAdj += 0.03;
    }
    implicitAdj = Math.max(-0.08, Math.min(0.08, implicitAdj)); // bounded ±0.08
  }

  // ══════════════════════════════════════════════════════════════════
  // SECTION C — Continuity adjustment (tag-pattern streaks)
  //   Declaration → Computation → Validation → Bounded cap
  //   Scope: outer function — not inside any conditional
  // ══════════════════════════════════════════════════════════════════
  let continuityAdj = 0; // declared in outer scope — always accessible to SECTION E
  if (continuityProfile) {
    const cTags  = meal.tags || [];
    const isHeavy   = cTags.includes('heavy')   || cTags.includes('indulgent');
    const isLight   = cTags.includes('light')   || cTags.includes('healthy');
    const isComfort = cTags.includes('comfort');
    const isNovel   = cTags.includes('regional') || cTags.includes('creative');

    if (continuityProfile.heavyStreak   >= 0.6 && isLight)                                continuityAdj += 0.06;
    if (continuityProfile.heavyStreak   >= 0.6 && isHeavy)                                continuityAdj -= 0.05;
    if (continuityProfile.comfortStreak >= 0.8 && isNovel)                                continuityAdj += 0.04;
    if (continuityProfile.quickStreak   >= 0.8 && isComfort && (meal.effortMins||30)>=30) continuityAdj += 0.04;
    if (continuityProfile.noveltyStreak >= 0.6 && isComfort)                              continuityAdj += 0.03;
    if (continuityProfile.lightStreak   >= 0.6 && isComfort && !isHeavy)                  continuityAdj += 0.03;

    // Step 2B: Effort rhythm — after involved streak, boost quick recovery meals
    if (continuityProfile.effortStreak === 'involved' && (meal.tags||[]).includes('quick'))  continuityAdj += 0.03;
    // Step 2D: Weekday lean — on weekdays boost quick/one_pot; on weekends ease up
    const _isWeekday = new Date().getDay() >= 1 && new Date().getDay() <= 5;
    if (continuityProfile.weekdayLean && _isWeekday && (meal.tags||[]).includes('one_pot')) continuityAdj += 0.03;
    if (!continuityProfile.weekdayLean && !_isWeekday && (meal.tags||[]).includes('hosting')) continuityAdj += 0.03;

    continuityAdj = Math.max(-0.07, Math.min(0.07, continuityAdj)); // bounded ±0.07
  }

  // ══════════════════════════════════════════════════════════════════
  // SECTION E — Final score composition
  //   All adjustments declared above — no undeclared references possible
  //   NaN guard: all components initialized to numeric defaults
  // ══════════════════════════════════════════════════════════════════
  const score =
    (preferenceScore  * 0.35) +
    (timeScore        * 0.20) +
    (successScore     * 0.15) +
    (varietyScore     * 0.15) +
    (feasibilityScore * 0.10) +
    (continuityScore  * 0.05) +
    implicitAdj       +        // Section B: ±0.08 behavioral
    continuityAdj;             // Section C: ±0.07 continuity

  // Step 6 — Runtime NaN guard (silent, zero-cost on fast path)
  const safeScore = Number.isFinite(score) ? score : preferenceScore * 0.35;

  return {
    meal, score: safeScore,
    // Scoring components — returned for debugging + why-text generation
    _components:  { preferenceScore, timeScore, successScore, varietyScore, feasibilityScore, continuityScore },
    // Legacy why-text fields (used by buildWhyParts)
    _historyWhyKey: historyWhyKey, _historyHighRate: historyHighRate,
    _prefIdx: prefIdx, _goal: userGoal, _targetMealType: targetMealType,
    _effortBias: effortBias, _learnedW: learnedW,
    _learnedCuisines: learnedCuisines, _allCuisines: allCuisines,
    _learnedEffortPref: learnedEffortPref, _timePressure: timePressureFlag,
    _journeyType: ctx.journeyType,
  };
}

// ── Why builder — confident, natural, no robotic phrasing ─────────
// line1 → the reason    ("You've liked similar meals")
// line2 → the context   ("Quick for tonight")
// Both lines must be grammatically correct and free of mixed signals.
function buildWhyParts(item) {
  const {
    meal, _learnedW, _historyWhyKey,
    _prefIdx, _goal, _targetMealType, _effortBias,
    _learnedCuisines, _allCuisines, _learnedEffortPref, _timePressure,
    _journeyType,
  } = item;

  const period = MEAL_PERIOD[getDaypart()] || 'today'; // always uses actual device time

  // ── Line 1: the reason ──────────────────────────────────────────
  let line1 = '';

  // Journey-type overrides come first — most specific signal
  if (_journeyType === 'kids') {
    line1 = 'Easy, mild, and kid-friendly';
  } else if (_journeyType === 'hosting' || _journeyType === 'guests') {
    if (meal.tags.includes('crowd-friendly')) line1 = 'Works well for a group';
    else line1 = 'A crowd-pleaser';
  } else if (_journeyType === 'health') {
    if (meal.tags.includes('protein')) line1 = 'High protein — good for your goal';
    else line1 = 'Light and nourishing';
  } else if (_journeyType === 'leftover') {
    line1 = 'Uses what you already have';
  } else if (_journeyType === 'religious' || _journeyType === 'festival') {
    line1 = 'Traditional and fitting for today';
  } else if (_learnedW >= 0.4) {
    line1 = "Works well for you";
  } else if (_historyWhyKey === 'liked_cuisine' && meal.cuisine !== 'any') {
    line1 = "You've liked similar meals";
  } else if (_prefIdx === 0 && meal.cuisine !== 'any') {
    line1 = capCuisine(meal.cuisine) + ' is your go-to — great pick';
  } else if (_prefIdx === 1 && meal.cuisine !== 'any') {
    line1 = 'This fits your taste';
  } else if (_learnedCuisines && _learnedCuisines.length > 0 && _learnedCuisines.map(normC).includes(normC(meal.cuisine)) && _prefIdx < 0) {
    line1 = "You've been enjoying " + capCuisine(meal.cuisine) + ' lately';
  } else if (_goal === 'eat_healthier' && (meal.tags.includes('healthy') || meal.tags.includes('light'))) {
    line1 = 'Supports your healthy eating goal';
  } else if (_goal === 'cook_faster' && meal.effortMins <= 15) {
    line1 = 'Ready fast — fits your goal';
  } else if (_goal === 'reduce_waste' && meal.tags.includes('leftover')) {
    line1 = 'Great for using up what you have';
  } else if (_goal === 'try_new_things' && !(_allCuisines || []).includes(normC(meal.cuisine)) && meal.cuisine !== 'any') {
    line1 = 'Something a little different';
  }

  // Continuity framing — fires before generic fallback when no other signal matched
  if (!line1) {
    const cp = (item.ctx && item.ctx.continuityProfile) || {};
    const mTags = meal.tags || [];
    const isLight   = mTags.includes('light')   || mTags.includes('healthy');
    const isComfort = mTags.includes('comfort');
    const isNovel   = mTags.includes('regional') || mTags.includes('creative');
    if      ((cp.heavyStreak   || 0) >= 0.6 && isLight)   line1 = 'A lighter direction from recent meals';
    else if ((cp.comfortStreak || 0) >= 0.8 && isNovel)   line1 = 'A little different from your usual';
    else if ((cp.quickStreak   || 0) >= 0.8 && isComfort) line1 = 'Worth slowing down for this one';
    else if ((cp.noveltyStreak || 0) >= 0.6 && isComfort) line1 = 'Back to something comforting';
    else if ((cp.lightStreak   || 0) >= 0.6 && isComfort)                line1 = 'Satisfying after lighter meals';
    else if (cp.effortStreak === 'involved' && mTags.includes('quick'))    line1 = 'Easy after some bigger meals lately';
    else if (cp.weekdayLean && mTags.includes('one_pot'))                  line1 = 'A quieter option for today';
  }

  if (line1 && !line1.startsWith('Line')) {
    // already set above
  } else if (meal.tags.includes('popular')) {
    line1 = 'Widely loved, for good reason';
  } else if (meal.tags.includes('comfort')) {
    line1 = 'Tried, tested, and genuinely good';
  } else if (meal.tags.includes('healthy')) {
    line1 = 'A wholesome choice';
  } else {
    const dp = getDaypart();
    line1 = dp === 'morning'   ? 'A solid start to the day'
           : dp === 'afternoon' ? 'Balanced for the afternoon'
           : dp === 'evening'   ? 'A relaxed evening meal'
           : 'Comforting end-of-day option';
  }

  // ── Line 2: the context ─────────────────────────────────────────
  let line2 = '';

  if (_timePressure && meal.effortMins <= 15) {
    line2 = meal.effortMins + ' min — ready fast';
  } else if (_effortBias === 'quick' && meal.effortMins <= 15) {
    if (!line1) line1 = 'Low effort, easy to settle into';
    line2 = 'Quick for ' + period;
  } else if (_targetMealType === 'breakfast' && meal.effortMins <= 15) {
    line2 = `Light and quick ${MEAL_PERIOD[getDaypart()]}`;
  } else if (_targetMealType === 'dinner' && meal.effortMins <= 20) {
    line2 = `Easy to make ${MEAL_PERIOD[getDaypart()]}`;
  } else if (_targetMealType === 'snack') {
    line2 = 'Ready in ' + meal.effortMins + ' min';
  } else if (_learnedEffortPref === 'quick' && meal.effortMins <= 15) {
    line2 = 'Matches how you like to cook';
  } else if (isWeekend() && meal.effortMins >= 30) {
    line2 = `Worth the effort ${MEAL_PERIOD[getDaypart()]}`;
  } else {
    line2 = meal.effortMins + ' min — good fit ' + period;
  }

  const effortLabel = meal.effortMins <= 15 ? 'Quick' : meal.effortMins <= 25 ? 'Medium effort' : 'Takes a bit longer';

  return { line1, line2, effortLabel, effortMins: meal.effortMins };
}

// ── Main export ───────────────────────────────────────────────────
export function getPersonalisedRecommendations({
  profile          = null,
  ratings          = {},
  mealHistory      = [],
  overrideMealType = null,
  journeyContext   = null,
} = {}) {
  const h              = new Date().getHours();
  const targetMealType = (journeyContext && journeyContext.mealType) || overrideMealType || getMealTypeFromHour(h);
  const rejectStreak   = getSessionRejectionStreak();
  const timePressureFlag = (journeyContext && journeyContext.timePressureFlag) || getTimePressureFlag(rejectStreak);

  const effortBias = (() => {
    if (journeyContext && journeyContext.effortPreference) return journeyContext.effortPreference;
    if (timePressureFlag) return 'quick';
    if (targetMealType === 'breakfast') return 'quick';
    if (isWeekend()) return 'any';
    if (targetMealType === 'dinner') return 'moderate';
    return 'any';
  })();

  const rawFoodType  = (profile && profile.food_type) || [];
  const userDietIds  = parseFoodTypeIds(rawFoodType);
  const userCuisines = (profile && profile.preferred_cuisines) || [];
  const userGoal     = (profile && profile.active_goal)        || '';
  const userSkill    = (profile && profile.skill_level)        || 'home_cook';

  const behaviourData  = (profile && profile.behaviour_data)   || {};
  const behaviourMerge = typeof behaviourData === 'string'
    ? (() => { try { return JSON.parse(behaviourData); } catch { return {}; } })()
    : behaviourData;

  const learnedCuisines   = getLearnedCuisinePreferences();

  // Recent success boost — meals user confirmed cooking + liked get a score boost
  const successBoostMap = (() => { try { return getRecentSuccessBoostMap(); } catch { return {}; } })();
  const continuityProfile = (() => { try { return buildContinuityProfile(mealHistory, MEAL_CATALOGUE); } catch { return { heavyStreak:0, comfortStreak:0, quickStreak:0, noveltyStreak:0, lightStreak:0 }; } })();
  const implicitProfile = (() => { try { return getImplicitBehaviourProfile(); } catch { return { noveltyAppetite:null, effortTolerance:'any', hasEnoughData:false }; } })();
  const learnedEffortPref = getLearnedEffortPreference();
  const learnedWeightsRaw = getAllLearnedWeights();
  const learnedWeights    = {};
  Object.entries(learnedWeightsRaw).forEach(([id, d]) => { learnedWeights[id] = d.score || 0; });
  Object.entries(behaviourMerge.mealWeights || {}).forEach(([id, d]) => {
    if (learnedWeights[id] === undefined) learnedWeights[id] = d.score || 0;
  });

  const recentHistorySet = buildRecentHistorySet(mealHistory, 7);
  const recentlyShownSet = new Set(getRecentlyShown());
  const rejectedSet      = getRejectedMealNames();

  const forceShift = rejectStreak >= 2;
  const forceShiftExcludedCuisines = forceShift
    ? new Set(getSessionCuisineHistory().slice(-3).map(normC))
    : new Set();
  const forceShiftExcludeHeavy = forceShift;

  // Step 2A: Cuisine fatigue — merge journeyContext cuisines WITH actual cook history
  // This ensures cuisine rotation works across sessions, not just within a session
  const _historyCuisines = (continuityProfile.recentCuisines || []).map(normC);
  const _contextCuisines = journeyContext
    ? (journeyContext.continuityData?.recentCuisines || []).map(normC)
    : [];
  const continuityRecentCuisines = [...new Set([..._contextCuisines, ..._historyCuisines])].slice(0, 4);

  const activeEvent = (journeyContext && journeyContext.activeEvent)
    || getActiveEvent({ region: (profile && profile.country) || 'IN' });

  const journeyTagBoosts = (journeyContext && journeyContext.journeyTagBoosts) || [];
  const journeyType      = (journeyContext && journeyContext.journeyType) || 'default';

  // Brain v2: lastCooked comes from jiff-cook-history (most recent cooked=true entry)
  const lastCookedName = (() => {
    try {
      const hist = JSON.parse(localStorage.getItem('jiff-cook-history') || '[]');
      const entry = hist.find(r => r.cooked === true);
      return entry ? (entry.mealName || '').toLowerCase().trim() : null;
    } catch { return null; }
  })();

  const ctx = {
    userDietIds, userCuisines, userGoal, userSkill,
    ratings, mealHistory, recentHistorySet, recentlyShownSet, rejectedSet,
    targetMealType, effortBias, timePressureFlag,
    learnedWeights, learnedCuisines, learnedEffortPref,
    forceShift, forceShiftExcludedCuisines, forceShiftExcludeHeavy,
    continuityRecentCuisines, activeEvent, journeyTagBoosts, journeyType,
    successBoostMap,
    lastCookedName,
    implicitProfile,
    continuityProfile,
    implicitProfile,
  };

  const compatible = MEAL_CATALOGUE.filter(m => isDietaryCompatible(m, userDietIds));
  const scored     = compatible.map(m => scoreMeal(m, ctx)).filter(Boolean);
  scored.sort((a, b) => b.score - a.score);

  if (scored.length > 0) scored[0].score = Math.min(1, scored[0].score * 1.2);

  const results      = [];
  const usedCuisines = new Set();

  for (const candidate of scored) {
    if (results.length === 3) break;
    const c = normC(candidate.meal.cuisine);
    if (results.length === 0) { results.push(candidate); usedCuisines.add(c); continue; }
    const primary     = results[0];
    const diffCuisine = !usedCuisines.has(c) || c === 'any';
    const diffEffort  = Math.abs(candidate.meal.effortMins - primary.meal.effortMins) >= 10;
    if (diffCuisine || diffEffort || scored.length < 6) {
      results.push(candidate); usedCuisines.add(c);
    }
  }
  for (const candidate of scored) {
    if (results.length >= 3) break;
    if (!results.some(r => r.meal.id === candidate.meal.id)) results.push(candidate);
  }

  if (results.length > 0) appendSessionCuisine(normC(results[0].meal.cuisine));

  return results.slice(0, 3).map((item, i) => ({
    meal:         item.meal,
    score:        Math.round(item.score * 100) / 100,
    why:          buildWhyParts(item),
    role:         i === 0 ? 'primary' : 'alternate',
    timePressure: timePressureFlag,
    activeEvent,
    contextLabel: getMealContextLabel(item.meal, journeyType),
    generateContext: {
      dish:     item.meal.name,
      cuisine:  item.meal.cuisine !== 'any' ? item.meal.cuisine : undefined,
      mealType: targetMealType,
      diet:     userDietIds[0] || undefined,
      time:     item.meal.effortMins + ' min',
    },
  }));
}

export function recommendationToContext(rec) {
  if (!rec || !rec.meal) return { surpriseMode: true };
  return {
    dish:     rec.meal.name,
    cuisine:  rec.meal.cuisine !== 'any' ? rec.meal.cuisine : undefined,
    mealType: (rec.generateContext && rec.generateContext.mealType) || rec.meal.mealType[0] || 'any',
    time:     rec.meal.effortMins + ' min',
    _why:     rec.why,
    _role:    rec.role,
    _emoji:   rec.meal.emoji || '🍽️',
  };
}

export function getMealTypeLabel(mealType) {
  return ({ breakfast:'Morning ideas', lunch:'Lunch ideas', snack:'Snack time', dinner:"Tonight's ideas", any:'Ideas for you' })[mealType] || 'Ideas for you';
}

export function getMealCatalogue() { return MEAL_CATALOGUE; }
export { getMealTypeFromHour };
