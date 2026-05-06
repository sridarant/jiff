// src/components/common/journeyTileEngines.js
// Pure functions — no React deps.
// getFeaturedTile: context-aware tile for below-fold section (festival/sports/weather/day)

import {
  getPersonalisedRecommendations,
  recommendationToContext,
} from '../../services/recommendationService.js';

// ── Context tile engine ───────────────────────────────────────────
function getFeaturedTile({ festival, sports, weather, dayCtx, profile, isReturning, lastFavCuisine }) {
  if (festival && !sports) return {
    emoji: festival.emoji, badge: 'FESTIVAL',
    label: festival.name + ' special',
    sub:   festival.note || 'Traditional recipes for the occasion',
    color: '#DC2626', bg:'rgba(220,38,38,0.06)', border:'rgba(220,38,38,0.2)',
    context: { type:'festival', cuisine: festival.cuisine || 'indian', mealType: festival.mealType || 'dinner' },
  };
  if (festival && sports) {
    if (new Date().getHours() >= 14) return {
      emoji: sports.emoji, badge: 'MATCH DAY', label: sports.label, sub: sports.note,
      color: '#1D4ED8', bg:'rgba(29,78,216,0.06)', border:'rgba(29,78,216,0.2)',
      context: { type:'sports', mealType:'snack', cuisine: sports.cuisine || 'indian' },
    };
    return {
      emoji: festival.emoji, badge: 'FESTIVAL', label: festival.name + ' special',
      sub: festival.note || 'Traditional recipes for the occasion',
      color: '#DC2626', bg:'rgba(220,38,38,0.06)', border:'rgba(220,38,38,0.2)',
      context: { type:'festival', cuisine: festival.cuisine || 'indian', mealType: festival.mealType || 'dinner' },
    };
  }
  if (sports) return {
    emoji: sports.emoji, badge: 'MATCH DAY', label: sports.label, sub: sports.note,
    color: '#1D4ED8', bg:'rgba(29,78,216,0.06)', border:'rgba(29,78,216,0.2)',
    context: { type:'sports', mealType:'snack', cuisine: sports.cuisine || 'indian' },
  };
  if (weather && weather.temp > 35) return {
    emoji: '🥤', badge: 'HOT DAY', label: 'Cooling foods for today',
    sub: 'Aam panna · Raita · Lassi · Cold rice dishes',
    color: '#D97706', bg:'rgba(217,119,6,0.06)', border:'rgba(217,119,6,0.2)',
    context: { type:'weather', weather, mealType:'any' },
  };
  if (weather && (weather.condition === 'rain' || weather.condition === 'monsoon')) return {
    emoji: '🌧️', badge: 'MONSOON', label: 'Perfect pakora weather',
    sub: 'Hot, crispy, comforting — rain demands it',
    color: '#2563EB', bg:'rgba(37,99,235,0.06)', border:'rgba(37,99,235,0.2)',
    context: { type:'weather', weather, mealType:'snack' },
  };
  if (dayCtx) {
    if (dayCtx.type === 'leftover')  return { emoji:'♻️', label:dayCtx.label, sub:dayCtx.note, color:'#D97706', bg:'rgba(217,119,6,0.07)', border:'rgba(217,119,6,0.2)', context:{ type:'leftover', mealType:'dinner' } };
    if (dayCtx.type === 'hosting')   return { emoji:'🎉', label:dayCtx.label, sub:dayCtx.note, color:'#2563EB', bg:'rgba(37,99,235,0.07)', border:'rgba(37,99,235,0.2)', context:{ hosting:true, servings:10, mealType:'dinner' } };
    if (dayCtx.type === 'planner')   return { emoji:'📅', label:dayCtx.label, sub:dayCtx.note, color:'#7C3AED', bg:'rgba(124,58,237,0.07)', border:'rgba(124,58,237,0.2)', context:null, navTo:'/planner' };
    if (dayCtx.type === 'adventure') return { emoji:'🌍', label:dayCtx.label, sub:dayCtx.note, color:'#1D9E75', bg:'rgba(29,158,117,0.07)', border:'rgba(29,158,117,0.2)', context:{ surpriseMode:true, mealType:'any' } };
  }
  if (isReturning && lastFavCuisine) {
    const cl = lastFavCuisine.replace(/_/g,' ').split(' ').map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(' ');
    return { emoji:'🍽️', badge:'WELCOME BACK', label:'Pick up where you left off', sub:'More '+cl+' — your favourite cuisine', color:'#1D4ED8', bg:'rgba(29,78,216,0.06)', border:'rgba(29,78,216,0.2)', context:{ cuisine:lastFavCuisine, mealType:'dinner' } };
  }
  return { emoji:'🧊', label:'Cook with what I have', sub:'Pick a meal, then mark what you need.', color:'#FF4500', bg:'rgba(255,69,0,0.06)', border:'rgba(255,69,0,0.2)', context:null, isFridge:true };
}

// Thin wrapper for any callers that still use this
function getScoredForYouCards({ profile, ratings, mealHistory, overrideMealType }) {
  const recs = getPersonalisedRecommendations({ profile: profile || null, ratings: ratings || {}, mealHistory: mealHistory || [], overrideMealType: overrideMealType || null });
  return recs.map(rec => ({
    meal: rec.meal, emoji: rec.meal.emoji, label: rec.meal.name,
    cuisine: rec.meal.cuisine, effortMins: rec.meal.effortMins,
    tags: rec.meal.tags, why: rec.why, role: rec.role, score: rec.score,
    context: recommendationToContext(rec),
  }));
}

export { getFeaturedTile, getScoredForYouCards };
