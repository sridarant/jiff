// src/services/recipeService.js
// All recipe generation API calls. No UI imports, no React deps.
// Used by: Jiff.jsx, LittleChefs.jsx, KidsDishes.jsx, KidsLunchbox.jsx,
//          Plans.jsx, Planner.jsx, SacredKitchen.jsx

const BASE = '/api/suggest';

/**
 * Generate recipe suggestions from ingredients.
 * @param {object} params
 * @returns {Promise<{meals: object[], error?: string}>}
 */
export async function generateRecipes({
  ingredients = [],
  time = '30 min',
  diet = 'none',
  cuisine = 'any',
  mealType = 'any',
  servings = 2,
  count = 3,
  language = 'en',
  units = 'metric',
  tasteProfile = null,
  familyMembers = [],
  moodContext = null,
  weatherContext = null,
  dish = null,
  surpriseMode = false,
  kidsMode = false,
  kidsPromptOverride = null,
  country = 'IN',
} = {}) {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ingredients, time, diet, cuisine, mealType,
      defaultServings: servings, count, language, units,
      tasteProfile, familyMembers, moodContext, weatherContext,
      dish, surpriseMode, kidsMode, kidsPromptOverride, country,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * normalizeRecipe — canonical shape for a single meal object.
 * Use this in ALL pages that consume generateRecipes() output.
 * Guarantees: name, time, servings, ingredients[], method[], description, nutrition{}
 */
export function normalizeRecipe(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    name:        raw.name        || 'Unnamed dish',
    emoji:       raw.emoji       || '🍽️',
    time:        raw.time        || '30 min',
    servings:    raw.servings    || 2,
    description: raw.description || '',
    cuisine:     raw.cuisine     || 'any',
    diet:        raw.diet        || 'any',
    tags:        Array.isArray(raw.tags) ? raw.tags : [],
    ingredients: Array.isArray(raw.ingredients) ? raw.ingredients : [],
    method:      Array.isArray(raw.method)      ? raw.method      :
                 Array.isArray(raw.steps)        ? raw.steps       : [],
    nutrition:   raw.nutrition && typeof raw.nutrition === 'object' ? raw.nutrition : {},
    videoId:     raw.videoId     || null,
    videoTitle:  raw.videoTitle  || null,
    fun_fact:    raw.fun_fact    || null,
  };
}

/**
 * normalizeResponse — extract and normalize meals from any API response shape.
 * Handles: { meals: [...] }  |  { meals: { meals: [...] } }  |  [...]
 */
export function normalizeResponse(data) {
  if (!data) return [];
  let raw = [];
  if (Array.isArray(data))              raw = data;
  else if (Array.isArray(data.meals))   raw = data.meals;
  else if (data.meals?.meals)           raw = data.meals.meals;
  return raw.map(normalizeRecipe).filter(Boolean);
}

/**
 * generateMeal — SINGLE ENTRY POINT for all page-level recipe generation.
 * Wraps generateRecipes + normalizeResponse.
 * Pages MUST call this instead of generateRecipes directly.
 *
 * @param {object} context  — caller-supplied overrides (kidsMode, kidsPromptOverride, etc.)
 * @param {object} profile  — user profile (food_type, spice_level, allergies, etc.)
 * @param {object} options  — { lang, units, country }
 * @returns {Promise<object[]>} Normalized meal array
 */
export async function generateMeal(context = {}, profile = null, options = {}) {
  const { lang = 'en', units = 'metric', country = 'IN' } = options;

  // Diet — derive from profile, never hardcode
  const effectiveDiet = (() => {
    const ft = Array.isArray(profile?.food_type) ? profile.food_type[0] : profile?.food_type;
    return (ft && ft !== 'none') ? ft : (context.diet || 'any');
  })();

  // Cuisine — profile preference over caller override, fallback 'any'
  const effectiveCuisine = context.cuisine
    || profile?.preferred_cuisines?.[0]
    || 'any';

  // Full tasteProfile — always from live profile
  const tasteProfile = profile ? {
    spice_level:        profile.spice_level,
    allergies:          Array.isArray(context.extraAllergens)
                          ? [...(profile.allergies || []), ...context.extraAllergens]
                          : (profile.allergies || []),
    preferred_cuisines: profile.preferred_cuisines,
    skill_level:        profile.skill_level,
    active_goal:        profile.active_goal,
    country:            profile.country || country,
  } : null;

  const data = await generateRecipes({
    ingredients:        context.ingredients        || [],
    time:               context.time               || '30 min',
    diet:               effectiveDiet,
    cuisine:            effectiveCuisine,
    mealType:           context.mealType           || 'any',
    servings:           context.servings           || 2,
    count:              context.count              || 3,
    language:           lang,
    units,
    country:            profile?.country           || country,
    tasteProfile,
    kidsMode:           context.kidsMode           || false,
    kidsPromptOverride: context.kidsPromptOverride || null,
    surpriseMode:       context.surpriseMode       || false,
    dish:               context.dish               || null,
    moodContext:        context.moodContext        || null,
    // Retention signals — pass through for API-side personalisation
    lastCooked:         context.lastCooked         || null,
    likedMealNames:     context.likedMealNames     || [],
  });

  return normalizeResponse(data);
}

/**
 * Translate an ingredient list to English.
 * @param {string[]} items
 * @param {string} sourceLang
 * @returns {Promise<string[]>}
 */
export async function translateIngredients(items, sourceLang) {
  const res = await fetch(`${BASE}?action=translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, sourceLang }),
  });
  if (!res.ok) throw new Error(`Translate failed: HTTP ${res.status}`);
  const data = await res.json();
  return data.translated || items;
}

/**
 * Detect ingredients from a photo (base64).
 * @param {string} imageBase64
 * @param {string[]} existingIngredients
 * @returns {Promise<string[]>}
 */
export async function detectIngredientsFromPhoto(imageBase64, existingIngredients = []) {
  const res = await fetch('/api/detect-ingredients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: imageBase64, existingIngredients }),
  });
  if (!res.ok) throw new Error(`Photo detect failed: HTTP ${res.status}`);
  const data = await res.json();
  return data.ingredients || [];
}
