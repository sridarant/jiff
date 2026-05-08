// src/hooks/useRecipes.js
// Encapsulates all recipe generation state and handlers.
// Jiff.jsx imports this hook — zero fetch() calls remain in the component.

import { useState, useCallback, useRef } from 'react';
import { generateRecipes, normalizeResponse } from '../services/recipeService';
import { trackGeneration } from '../lib/analytics';
import { saveHistory, fetchHistory, buildRatingsFromHistory, updateRating } from '../services/historyService';
import { updateStreak, computeNextStreak } from '../services/userService';
import { getRecentSuccessBoostMap } from './useRetention.js';

const TILE_MSGS = {
  magic_moment: 'Your first personalised recipe is on its way…',
  family:   'Planning for the whole family... 👨‍👩‍👧',
  hosting:  'Preparing an impressive spread... 🎉',
  mood:     'Finding something that matches your vibe... 😊',
  seasonal: "Pulling in what's fresh right now... 🌿",
  weather:  "Picking recipes for today's weather... 🌤️",
  goal:     'Finding recipes that work for your goal... 🎯',
  discover: 'Getting that recipe ready... ⚡',
  planner:  'Building your 7-day menu... 📅',
  trending: 'Grabbing a trending recipe... 🔥',
  regional: "Exploring this week's region... 🌍",
  festival: 'Bringing in the festival flavours... 🎉',
};

export function useRecipes({
  user, profile,
  isPremium, PAID_RECIPE_CAP,
  checkAccess, recordUsage,
  time, diet, cuisine, mealType, defaultServings,
  lang, units, country,
  setCuisine, setMealType,
  setJourneyMode,
  mealHistory,
}) {
  const [meals,          setMeals]          = useState([]);
  const [view,           setView]           = useState('input');
  const [errorMsg,       setErrorMsg]       = useState('');
  const [loadingMessage, setLoadingMessage] = useState('Finding your perfect recipes...');
  const [factIdx,        setFactIdx]        = useState(0);
  const [tileContext,    setTileContext]    = useState(null); // { type, label, emoji, color, bg }

  // Async guard — prevents overlapping generation calls
  const isGenerating = useRef(false);

  // ── SINGLE SOURCE OF TRUTH: shared param builder ───────────────
  // Both handleSubmit and handleGenerateDirect must call this.
  // Ensures web and mobile always produce identical API inputs for the same profile.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  function buildBaseParams(overrides) {
    // 1. Diet — always derive from profile.food_type; never use stale local state
    const effectiveDiet = (() => {
      const ft = Array.isArray(profile?.food_type) ? profile.food_type[0] : profile?.food_type;
      if (!ft || ft === 'none') return diet; // fallback to local state only when profile absent
      // Pass raw food_type value — API understands 'veg','vegan','jain','eggetarian','non-veg','halal'
      return ft;
    })();

    // 2. Cuisine — prefer profile.preferred_cuisines[0] when local state is still default 'any'
    const effectiveCuisine = overrides.cuisine
      || (cuisine !== 'any' ? cuisine : null)
      || profile?.preferred_cuisines?.[0]
      || 'any';

    // 3. Full tasteProfile — identical fields in both paths
    const tasteProfile = profile ? {
      spice_level:        profile.spice_level,
      allergies:          profile.allergies,
      preferred_cuisines: profile.preferred_cuisines,
      skill_level:        profile.skill_level,
      active_goal:        profile.active_goal,
      country:            profile.country,
    } : null;

    // 4. Retention signals — cook history and liked meals for personalisation
    const successBoosts = (() => { try { return getRecentSuccessBoostMap(); } catch { return {}; } })();
    const likedMealNames = Object.keys(successBoosts);
    const recentMealHistory = Array.isArray(mealHistory) ? mealHistory.slice(0, 20) : [];
    const lastCooked = recentMealHistory.find(h => h.cooked !== false)?.meal_name || null;

    const base = { diet: effectiveDiet, cuisine: effectiveCuisine, tasteProfile, time: (overrides.time || time), mealType: (overrides.mealType || mealType), servings: (overrides.servings || defaultServings), language: lang, units, country, lastCooked, likedMealNames, recentMealHistory };
    return Object.assign(base, overrides, { diet: (overrides.diet || effectiveDiet), cuisine: (overrides.cuisine || effectiveCuisine), tasteProfile: (overrides.tasteProfile || tasteProfile) });
  }

  const [ratings,        setRatings]        = useState(() => {
    try { return JSON.parse(localStorage.getItem('jiff-ratings') || '{}'); } catch { return {}; }
  });

  const handleStreak = useCallback((userId) => {
    const next = computeNextStreak(0);
    if (userId) updateStreak(userId, next);
    return next;
  }, []);

  // ── Submit from fridge/direct view ─────────────────────────────
  const handleSubmit = useCallback(async (ingredients, gateDismissCallback) => {
    if (!ingredients.length) return;
    if (!user) { gateDismissCallback?.(); return; }
    if (!checkAccess('generation')) return;
    if (isGenerating.current) return;
    isGenerating.current = true;

    setView('loading'); setFactIdx(0);
    setLoadingMessage('Finding your perfect recipes...');
    try {
      const count = isPremium ? PAID_RECIPE_CAP : 1;
      const data  = await generateRecipes({
        ...buildBaseParams({ mealType, cuisine }),
        ingredients,
        count,
      });

      const normalized = normalizeResponse(data);
      if (!normalized.length) {
        setErrorMsg(data?.error || 'Could not generate suggestions.');
        setView('error');
        return;
      }

      setMeals(normalized);
      setView('results');
      recordUsage();
      handleStreak(user.id);

      saveHistory({
        userId: user.id, meals: data.meals,
        mealType, cuisine, servings: defaultServings, ingredients,
      });
      trackGeneration({ cuisine, mealType, diet, isPremium, source: 'fridge' });
    } catch (err) {
      setErrorMsg('Connection error. Please try again.');
      setView('error');
    } finally {
      isGenerating.current = false;
    }
  }, [user, isPremium, PAID_RECIPE_CAP, checkAccess, recordUsage,
      time, diet, cuisine, mealType, defaultServings, lang, units,
      profile, handleStreak]);

  // ── 1-tap tile generation ───────────────────────────────────────
  const handleGenerateDirect = useCallback(async (context = {}) => {
    const msgKey = context.mood ? 'mood' : context.seasonal ? 'seasonal'
      : context.weather ? 'weather' : context.hosting ? 'hosting'
      : context.family ? 'family' : context.goal ? 'goal'
      : context.type || 'discover';

    setLoadingMessage(TILE_MSGS[msgKey] || 'Finding your perfect recipes...');
    if (!user) return false; // caller shows gate
    if (!checkAccess('generation')) return false;

    if (context.cuisine) setCuisine(context.cuisine);
    if (context.mealType && context.mealType !== 'any') setMealType(context.mealType);

    // Apply diet override from magic moment (profile may not be loaded yet)
    if (context.dietOverride && context.type === 'magic_moment') {
      if (context.dietOverride === 'veg' || context.dietOverride === 'vegan' ||
          context.dietOverride === 'jain' || context.dietOverride === 'eggetarian') {
        // Will be picked up by the diet state already set from profile load
      }
    }
    const tileIngredients = [];

    // Build context descriptor for result banner
    // Build rich context descriptor for result banner
    const CTX_MAP = {
      magic_moment: { emoji:'⚡', color:'#FF4500', bg:'rgba(255,69,0,0.06)', border:'rgba(255,69,0,0.2)',
                      label:'Your first Jiff',
                      sub:'Personalised from your preferences — rate it to make future suggestions even better' },
      mood:     { emoji: context.moodContext?.emoji || '😊', color:'#7C3AED', bg:'rgba(124,58,237,0.07)', border:'rgba(124,58,237,0.2)',
                  label: 'Mood: ' + (context.moodContext?.label || context.mood),
                  sub: context.moodContext?.description || 'Matched to your mood' },
      goal:     { emoji: context.goalContext?.emoji || '🎯', color:'#1D9E75', bg:'rgba(29,158,117,0.07)', border:'rgba(29,158,117,0.2)',
                  label: 'Goal: ' + (context.goalContext?.label || context.goal),
                  sub: context.goalContext?.description || 'Recipes that work for your goal' },
      family:   { emoji:'👨‍👩‍👧', color:'#2563EB', bg:'rgba(37,99,235,0.07)', border:'rgba(37,99,235,0.2)',
                  label:'Family meal', sub:'Suitable for all ages and dietary needs' },
      hosting:  { emoji:'🎉', color:'#D97706', bg:'rgba(217,119,6,0.07)', border:'rgba(217,119,6,0.2)',
                  label:'Hosting guests', sub:'Impressive dishes for 8–12 people, can be prepped ahead' },
      seasonal: { emoji:'🌿', color:'#16A34A', bg:'rgba(22,163,74,0.07)', border:'rgba(22,163,74,0.2)',
                  label:'In season now', sub:'Using the freshest produce available this month' },
      festival: { emoji:'🪔', color:'#DC2626', bg:'rgba(220,38,38,0.07)', border:'rgba(220,38,38,0.2)',
                  label:'Festival special', sub:'Traditional recipes for the occasion' },
      leftover: { emoji:'♻️', color:'#D97706', bg:'rgba(217,119,6,0.08)', border:'rgba(217,119,6,0.25)',
                  label:'Leftover rescue', sub:'Turning what you have into something great' },
    };
    const ctxType = context.mood ? 'mood' : context.goal ? 'goal'
      : context.hosting ? 'hosting' : context.family ? 'family'
      : context.seasonal ? 'seasonal'
      : context.type === 'festival' ? 'festival'
      : context.type === 'leftover' ? 'leftover' : null;
    setTileContext(ctxType ? CTX_MAP[ctxType] : null);
    if (isGenerating.current) return false;
    isGenerating.current = true;
    setView('loading'); setFactIdx(0); setJourneyMode(false);
    try {
      // Leftover: always show 3-5 options split by effort; hosting: full-menu count
      const baseCount = isPremium ? PAID_RECIPE_CAP : 1;
      const count = context.type === 'leftover' ? Math.max(3, baseCount)
                  : context.hosting            ? Math.max(4, baseCount)
                  : baseCount;

      // Build a dish hint for hosting (multi-course) or leftover (effort-split)
      const dishHint = context.hosting
        ? 'Include a starter, main, side, and dessert. Label each with its course type in the name.'
        : context.type === 'leftover'
        ? 'Split suggestions: first 2 under 15 min (label Quick Fix), rest as Creative Twist.'
        : null;

      const data  = await generateRecipes({
        ...buildBaseParams({
          cuisine:   context.cuisine,
          mealType:  context.mealType,
          servings:  context.servings,
          time,
        }),
        ingredients: tileIngredients,
        count,
        dish:        dishHint || context.dish || null,
        moodContext: context.moodContext || null,
      });

      if (data.error) {
        const isParseErr = data.stage === 'parse' || (data.error && data.error.toLowerCase().includes('parse'));
        setErrorMsg(isParseErr ? 'Taking a moment — please try again.' : (data.error || 'Could not generate suggestions.'));
        setView('input');
        setJourneyMode(true);
        return false;
      }

      const resultMeals = normalizeResponse(data);
      if (!resultMeals.length) {
        setErrorMsg('Taking a moment — please try again.');
        setView('input');
        setJourneyMode(true);
        return false;
      }
      setMeals(resultMeals);
      handleStreak(user.id);
      saveHistory({ userId: user.id, meals: resultMeals, mealType, cuisine, servings: defaultServings, ingredients: tileIngredients });
      trackGeneration({ cuisine: context.cuisine || cuisine, mealType: context.mealType || mealType, diet, isPremium, source: context.type || 'tile' });
      setView('results');
      return true;
    } catch {
      setErrorMsg('Something went wrong. Please try again.');
      setView('input');
      setJourneyMode(true);
      return false;
    } finally {
      isGenerating.current = false;
    }
  }, [user, isPremium, PAID_RECIPE_CAP, checkAccess,
      time, diet, cuisine, mealType, defaultServings, lang, country,
      setCuisine, setMealType, setJourneyMode, handleStreak]);

  // ── Surprise me ─────────────────────────────────────────────────
  const handleSurprise = useCallback(async (season) => {
    if (!checkAccess('generation')) return;
    setView('loading'); setFactIdx(0);
    setLoadingMessage('Finding something you\'ll love...');
    try {
      const count = isPremium ? PAID_RECIPE_CAP : 1;
      const surpriseCuisine = profile?.preferred_cuisines?.length
        ? profile.preferred_cuisines[Math.floor(Math.random() * profile.preferred_cuisines.length)]
        : 'any';

      const data = await generateRecipes({
        ...buildBaseParams({ cuisine: surpriseCuisine }),
        ingredients: [],
        count,
        surpriseMode: true,
      });
      const surpriseMeals = normalizeResponse(data);
      if (surpriseMeals.length > 0) {
        setMeals(surpriseMeals);
        setView('results');
        recordUsage();
      } else {
        setErrorMsg(data.error || 'Could not generate suggestions.');
        setView('error');
      }
    } catch {
      setErrorMsg('Connection error. Please try again.');
      setView('error');
    }
  }, [checkAccess, isPremium, PAID_RECIPE_CAP, recordUsage,
      time, diet, lang, units, profile]);

  // ── Ratings ─────────────────────────────────────────────────────
  const syncRatings = useCallback(async (userId) => {
    const history = await fetchHistory(userId);
    const remote  = buildRatingsFromHistory(history);
    if (Object.keys(remote).length) {
      setRatings(prev => {
        const merged = { ...prev, ...remote };
        try { localStorage.setItem('jiff-ratings', JSON.stringify(merged)); } catch {}
        return merged;
      });
    }
  }, []);

  const handleRate = useCallback((meal, stars, userId, mealKeyFn) => {
    const key = mealKeyFn(meal);
    setRatings(prev => {
      const next = { ...prev, [key]: stars };
      try { localStorage.setItem('jiff-ratings', JSON.stringify(next)); } catch {}
      return next;
    });
    updateRating({ userId, mealName: meal.name, rating: stars });
  }, []);

  const reset = useCallback(() => {
    setView('input'); setMeals([]); setErrorMsg('');
  }, []);

  return {
    meals, view, errorMsg, loadingMessage, factIdx, ratings, tileContext,
    setView, setMeals, setErrorMsg, setFactIdx, setRatings,
    setTileContext, setLoadingMessage,
    handleSubmit, handleGenerateDirect, handleSurprise, handleRate, handleStreak,
    syncRatings, reset,
  };
}
