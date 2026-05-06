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
import { getActiveEvent, getEventBoost, getMealContextLabel } from '../lib/eventIntelligence.js';
import { getRecentSuccessBoostMap } from '../hooks/useRetention.js';
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
    journeyTagBoosts.push('mild', 'safe', 'light', 'healthy', 'protein', 'quick');
    journeyMealType  = autoMealType === 'dinner' ? 'lunch' : autoMealType;
  }
  if (journeyType === 'leftover') {
    effortPreference = 'quick';
    journeyTagBoosts.push('leftover', 'quick', 'comfort');
  }
  if (journeyType === 'hosting') {
    effortPreference = 'any';
    journeyTagBoosts.push('crowd-friendly', 'popular', 'comfort', 'indulgent', 'special');
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
  // Breakfast
  { id:'poha',              name:'Poha',               emoji:'🍚', cuisine:'maharashtrian', mealType:['breakfast','snack'],         diet:['veg','vegan','jain','eggetarian'],  effortMins:15, tags:['quick','light','popular','mild','safe'] },
  { id:'upma',              name:'Upma',               emoji:'🥣', cuisine:'south_indian',  mealType:['breakfast'],                 diet:['veg','vegan','jain','eggetarian'],  effortMins:20, tags:['quick','filling','mild','safe'] },
  { id:'idli_sambar',       name:'Idli Sambar',        emoji:'🫓', cuisine:'tamil_nadu',    mealType:['breakfast','lunch'],         diet:['veg','vegan','jain','eggetarian'],  effortMins:10, tags:['light','popular','mild','healthy','protein','safe'] },
  { id:'paratha',           name:'Paratha',            emoji:'🫓', cuisine:'punjabi',       mealType:['breakfast','lunch'],         diet:['veg','eggetarian'],                 effortMins:20, tags:['filling','popular','comfort'] },
  { id:'aloo_paratha',      name:'Aloo Paratha',       emoji:'🫓', cuisine:'punjabi',       mealType:['breakfast','lunch'],         diet:['veg','jain','eggetarian'],          effortMins:25, tags:['filling','popular','comfort','heavy'] },
  { id:'vermicelli',        name:'Vermicelli Upma',    emoji:'🍜', cuisine:'south_indian',  mealType:['breakfast'],                 diet:['veg','vegan','eggetarian'],         effortMins:15, tags:['quick','light','mild','safe'] },
  { id:'oats_savory',       name:'Masala Oats',        emoji:'🥣', cuisine:'any',           mealType:['breakfast'],                 diet:['veg','vegan','jain','eggetarian'],  effortMins:10, tags:['quick','healthy','light','protein'] },
  { id:'egg_bhurji',        name:'Egg Bhurji',         emoji:'🍳', cuisine:'any',           mealType:['breakfast','snack'],         diet:['eggetarian','non-veg'],             effortMins:12, tags:['quick','protein','spicy','light'] },
  { id:'dosa',              name:'Plain Dosa',         emoji:'🥞', cuisine:'tamil_nadu',    mealType:['breakfast','snack'],         diet:['veg','vegan','eggetarian'],         effortMins:15, tags:['light','popular','mild','safe'] },
  { id:'moong_chilla',      name:'Moong Dal Chilla',   emoji:'🥞', cuisine:'any',           mealType:['breakfast','snack'],         diet:['veg','vegan','jain','eggetarian'],  effortMins:20, tags:['healthy','protein','quick','light','safe'] },
  { id:'pongal',            name:'Ven Pongal',         emoji:'🍲', cuisine:'tamil_nadu',    mealType:['breakfast','lunch'],         diet:['veg','jain'],                       effortMins:25, tags:['light','healthy','mild','comfort','festive','safe'] },
  { id:'dhokla',            name:'Dhokla',             emoji:'🧆', cuisine:'gujarati',      mealType:['breakfast','snack'],         diet:['veg','vegan','eggetarian'],         effortMins:25, tags:['light','popular','healthy','mild','safe'] },
  { id:'puttu_kadala',      name:'Puttu Kadala',       emoji:'🫙', cuisine:'kerala',        mealType:['breakfast'],                 diet:['veg','vegan'],                      effortMins:20, tags:['heavy','healthy','protein'] },
  // Lunch
  { id:'dal_rice',          name:'Dal Rice',           emoji:'🍛', cuisine:'any',           mealType:['lunch','dinner'],            diet:['veg','vegan','jain','eggetarian'],  effortMins:25, tags:['comfort','popular','filling','protein','healthy','safe'] },
  { id:'rajma',             name:'Rajma Chawal',       emoji:'🫘', cuisine:'punjabi',       mealType:['lunch','dinner'],            diet:['veg','vegan','jain','eggetarian'],  effortMins:30, tags:['comfort','popular','protein','heavy'] },
  { id:'curd_rice',         name:'Curd Rice',          emoji:'🍚', cuisine:'tamil_nadu',    mealType:['lunch'],                     diet:['veg','eggetarian'],                 effortMins:10, tags:['light','quick','mild','summer','safe'] },
  { id:'khichdi',           name:'Khichdi',            emoji:'🍲', cuisine:'any',           mealType:['lunch','dinner'],            diet:['veg','vegan','jain','eggetarian'],  effortMins:20, tags:['comfort','light','healthy','mild','safe'] },
  { id:'roti_sabzi',        name:'Roti Sabzi',         emoji:'🫓', cuisine:'any',           mealType:['lunch','dinner'],            diet:['veg','vegan','jain','eggetarian'],  effortMins:25, tags:['everyday','popular','light','safe'] },
  { id:'sambar_rice',       name:'Sambar Rice',        emoji:'🍛', cuisine:'tamil_nadu',    mealType:['lunch'],                     diet:['veg','vegan','eggetarian'],         effortMins:20, tags:['comfort','popular','spicy','protein'] },
  { id:'chole_bhature',     name:'Chole Bhature',      emoji:'🫘', cuisine:'punjabi',       mealType:['lunch'],                     diet:['veg','vegan','jain','eggetarian'],  effortMins:30, tags:['indulgent','popular','heavy','spicy'] },
  { id:'biryani_veg',       name:'Veg Biryani',        emoji:'🍚', cuisine:'hyderabadi',    mealType:['lunch','dinner'],            diet:['veg','jain','eggetarian'],          effortMins:40, tags:['indulgent','popular','festive','spicy','heavy','crowd-friendly'] },
  { id:'misal_pav',         name:'Misal Pav',          emoji:'🌶️', cuisine:'maharashtrian', mealType:['breakfast','lunch','snack'], diet:['veg','vegan','jain','eggetarian'],  effortMins:25, tags:['spicy','popular','protein','heavy'] },
  { id:'thepla',            name:'Thepla',             emoji:'🫓', cuisine:'gujarati',      mealType:['breakfast','lunch'],         diet:['veg','jain'],                       effortMins:20, tags:['light','quick','healthy','mild','safe'] },
  { id:'rasam_rice',        name:'Rasam Rice',         emoji:'🍲', cuisine:'tamil_nadu',    mealType:['lunch','dinner'],            diet:['veg','vegan','eggetarian'],         effortMins:20, tags:['light','spicy','healthy','monsoon','comfort'] },
  // Dinner
  { id:'palak_paneer',      name:'Palak Paneer',       emoji:'🥬', cuisine:'punjabi',       mealType:['dinner','lunch'],            diet:['veg','eggetarian'],                 effortMins:25, tags:['popular','healthy','comfort','protein','spicy','crowd-friendly'] },
  { id:'dal_tadka',         name:'Dal Tadka',          emoji:'🍛', cuisine:'any',           mealType:['dinner','lunch'],            diet:['veg','vegan','jain','eggetarian'],  effortMins:20, tags:['comfort','popular','everyday','protein','safe'] },
  { id:'aloo_gobi',         name:'Aloo Gobi',          emoji:'🥦', cuisine:'punjabi',       mealType:['dinner','lunch'],            diet:['veg','vegan','jain','eggetarian'],  effortMins:25, tags:['everyday','popular','mild','light','safe'] },
  { id:'chicken_curry',     name:'Chicken Curry',      emoji:'🍗', cuisine:'any',           mealType:['dinner','lunch'],            diet:['non-veg','halal'],                  effortMins:35, tags:['popular','protein','comfort','spicy','crowd-friendly'] },
  { id:'fish_curry',        name:'Fish Curry',         emoji:'🐟', cuisine:'bengali',       mealType:['dinner','lunch'],            diet:['non-veg','halal'],                  effortMins:30, tags:['popular','protein','spicy','comfort'] },
  { id:'butter_chicken',    name:'Butter Chicken',     emoji:'🍗', cuisine:'punjabi',       mealType:['dinner'],                    diet:['non-veg','halal'],                  effortMins:35, tags:['popular','comfort','indulgent','protein','crowd-friendly'] },
  { id:'hyderabadi_biryani',name:'Hyderabadi Biryani', emoji:'🍚', cuisine:'hyderabadi',    mealType:['lunch','dinner'],            diet:['non-veg','halal'],                  effortMins:60, tags:['special','popular','festive','spicy','heavy','crowd-friendly'] },
  { id:'macher_jhol',       name:'Macher Jhol',        emoji:'🐟', cuisine:'bengali',       mealType:['lunch','dinner'],            diet:['non-veg','halal'],                  effortMins:30, tags:['comfort','protein','spicy'] },
  { id:'avial',             name:'Avial',              emoji:'🥥', cuisine:'kerala',        mealType:['lunch','dinner'],            diet:['veg','vegan','eggetarian'],         effortMins:30, tags:['healthy','mild','festive','crowd-friendly'] },
  { id:'fish_curry_kerala', name:'Kerala Fish Curry',  emoji:'🐠', cuisine:'kerala',        mealType:['dinner','lunch'],            diet:['non-veg','halal'],                  effortMins:30, tags:['heavy','spicy','protein','comfort'] },
  { id:'sarson_saag',       name:'Sarson da Saag',     emoji:'🥬', cuisine:'punjabi',       mealType:['lunch','dinner'],            diet:['veg'],                              effortMins:30, tags:['healthy','heavy','winter','festive','crowd-friendly'] },
  { id:'palak_dal',         name:'Palak Dal',          emoji:'🥬', cuisine:'any',           mealType:['lunch','dinner'],            diet:['veg','vegan','jain','eggetarian'],  effortMins:25, tags:['healthy','protein','light','spicy'] },
  { id:'moong_soup',        name:'Moong Dal Soup',     emoji:'🥣', cuisine:'any',           mealType:['dinner','lunch'],            diet:['veg','vegan','jain','eggetarian'],  effortMins:20, tags:['light','healthy','protein','mild','safe'] },
  // Snack
  { id:'samosa',            name:'Samosa',             emoji:'🥟', cuisine:'any',           mealType:['snack'],                     diet:['veg','vegan','jain','eggetarian'],  effortMins:30, tags:['popular','comfort','spicy','heavy'] },
  { id:'pakora',            name:'Onion Pakora',       emoji:'🧅', cuisine:'any',           mealType:['snack'],                     diet:['veg','vegan','jain','eggetarian'],  effortMins:20, tags:['popular','monsoon','comfort','spicy'] },
  { id:'vada',              name:'Medu Vada',          emoji:'🍩', cuisine:'tamil_nadu',    mealType:['breakfast','snack'],         diet:['veg','vegan','eggetarian'],         effortMins:25, tags:['popular','crispy','protein'] },
  { id:'bread_pakora',      name:'Bread Pakora',       emoji:'🥪', cuisine:'any',           mealType:['snack','breakfast'],         diet:['veg','eggetarian'],                 effortMins:15, tags:['quick','popular','comfort','monsoon','safe'] },
  { id:'bhel_puri',         name:'Bhel Puri',          emoji:'🥗', cuisine:'maharashtrian', mealType:['snack'],                     diet:['veg','vegan','jain'],               effortMins:10, tags:['quick','light','popular'] },
  { id:'sprouts_salad',     name:'Sprouts Salad',      emoji:'🥗', cuisine:'any',           mealType:['snack','breakfast'],         diet:['veg','vegan','jain','eggetarian'],  effortMins:10, tags:['quick','healthy','light','protein','safe'] },
  // Leftover
  { id:'fried_rice',        name:'Fried Rice',         emoji:'🍳', cuisine:'any',           mealType:['lunch','dinner'],            diet:['non-veg','veg','eggetarian'],       effortMins:15, tags:['quick','leftover','comfort'] },
  { id:'chapati_rolls',     name:'Chapati Rolls',      emoji:'🌯', cuisine:'any',           mealType:['lunch','snack'],             diet:['veg','non-veg'],                    effortMins:10, tags:['quick','leftover','light','safe'] },
  { id:'dal_paratha',       name:'Dal Paratha',        emoji:'🫓', cuisine:'any',           mealType:['breakfast','lunch'],         diet:['veg'],                              effortMins:20, tags:['leftover','comfort','protein'] },
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
    pantryItems     = [],
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

  // ── Final score ───────────────────────────────────────────────
  const score =
    (preferenceScore  * 0.35) +
    (timeScore        * 0.20) +
    (successScore     * 0.15) +
    (varietyScore     * 0.15) +
    (feasibilityScore * 0.10) +
    (continuityScore  * 0.05);

  return {
    meal, score,
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

  const period = ({ breakfast:'this morning', lunch:'for lunch', snack:'right now', dinner:'tonight' })[_targetMealType] || 'today';

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
  } else if (meal.tags.includes('popular')) {
    line1 = 'A favourite across India';
  } else if (meal.tags.includes('comfort')) {
    line1 = 'A reliable comfort dish';
  } else if (meal.tags.includes('healthy')) {
    line1 = 'A wholesome choice';
  } else {
    line1 = 'Looks good for today';
  }

  // ── Line 2: the context ─────────────────────────────────────────
  let line2 = '';

  if (_timePressure && meal.effortMins <= 15) {
    line2 = meal.effortMins + ' min — ready fast';
  } else if (_effortBias === 'quick' && meal.effortMins <= 15) {
    line2 = 'Quick for ' + period;
  } else if (_targetMealType === 'breakfast' && meal.effortMins <= 15) {
    line2 = 'Light and quick this morning';
  } else if (_targetMealType === 'dinner' && meal.effortMins <= 20) {
    line2 = 'Easy to make tonight';
  } else if (_targetMealType === 'snack') {
    line2 = 'Ready in ' + meal.effortMins + ' min';
  } else if (_learnedEffortPref === 'quick' && meal.effortMins <= 15) {
    line2 = 'Matches how you like to cook';
  } else if (isWeekend() && meal.effortMins >= 30) {
    line2 = 'Worth the effort this weekend';
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

  const continuityRecentCuisines = journeyContext
    ? (journeyContext.continuityData?.recentCuisines || []).map(normC)
    : [];

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
    pantryItems: [], // pantry removed — feasibility uses tag-based proxy only
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
  };
}

export function getMealTypeLabel(mealType) {
  return ({ breakfast:'Morning ideas', lunch:'Lunch ideas', snack:'Snack time', dinner:"Tonight's ideas", any:'Ideas for you' })[mealType] || 'Ideas for you';
}

export function getMealCatalogue() { return MEAL_CATALOGUE; }
export { getMealTypeFromHour };
