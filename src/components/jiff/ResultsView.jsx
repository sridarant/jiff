// src/components/jiff/ResultsView.jsx
// Results grid: filter pills, meal cards, feedback actions, order strip, reset
// Leftover mode: groups cards into Quick Fix (≤15 min) and Creative Twist
// Hosting mode: groups cards into Starter / Main / Side / Dessert sections

import { useState } from 'react';
import { MealCard } from '../meal/MealCard.jsx';
import { mealKey }  from '../../lib/mealKey.js';
import { updateRating } from '../../services/historyService';
import { trackPaywallShown, trackUpgradeClick, trackRating } from '../../lib/analytics';
import { logFeedback } from '../../services/feedbackService';

const MEAL_TYPE_OPTIONS = [
  { id: 'any',       label: 'Any meal',   emoji: '🍽️' },
  { id: 'breakfast', label: 'Breakfast',  emoji: '🌅' },
  { id: 'lunch',     label: 'Lunch',      emoji: '☀️' },
  { id: 'dinner',    label: 'Dinner',     emoji: '🌙' },
  { id: 'snack',     label: 'Snacks',     emoji: '🍎' },
];

function toFeedbackMeal(meal) {
  return {
    id:         meal.id || meal.name?.toLowerCase().replace(/\s+/g, '_') || 'unknown',
    name:       meal.name       || '',
    cuisine:    meal.cuisine    || 'any',
    effortMins: meal.effortMins || (meal.time ? parseInt(meal.time) : 30),
  };
}

// ── Leftover grouping helpers ─────────────────────────────────────
function parseMins(timeStr) {
  if (!timeStr) return 30;
  const n = parseInt(timeStr);
  return isNaN(n) ? 30 : n;
}

function isLeftoverContext(tileContext) {
  return !!(tileContext?.label?.toLowerCase().includes('leftover') ||
            tileContext?.label?.toLowerCase().includes('rescue'));
}

function isHostingContext(tileContext) {
  return !!(tileContext?.label?.toLowerCase().includes('host') ||
            tileContext?.label?.toLowerCase().includes('guest'));
}

// ── Section label ─────────────────────────────────────────────────
const SL = ({ emoji, title, sub, color = '#FF4500' }) => (
  <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:20, marginBottom:10 }}>
    <span style={{ fontSize:18 }}>{emoji}</span>
    <div>
      <div style={{ fontSize:12, fontWeight:700, color, letterSpacing:'0.3px' }}>{title}</div>
      {sub && <div style={{ fontSize:10, color:'#7C6A5E', marginTop:1 }}>{sub}</div>}
    </div>
  </div>
);

// ── Course labels for hosting ─────────────────────────────────────
// Tries to infer course from meal name / description, falls back to position
const COURSE_KEYWORDS = {
  starter:  ['salad','chaat','papdi','pakora','samosa','soup','tikka','kebab','bruschetta','chutney','dip','appetizer','starter'],
  dessert:  ['halwa','kheer','gulab','ladoo','barfi','ice cream','dessert','sweet','pudding','cake','peda','rasgulla','jalebi','payasam'],
  side:     ['raita','pickle','papad','chutney','bread','roti','naan','rice','dal','lentil','side'],
};

function inferCourse(meal, index, total) {
  const text = ((meal.name || '') + ' ' + (meal.description || '')).toLowerCase();
  for (const [course, keywords] of Object.entries(COURSE_KEYWORDS)) {
    if (keywords.some(k => text.includes(k))) return course;
  }
  // Positional fallback: 1st → starter, last → dessert, mid → main/side
  if (index === 0) return 'starter';
  if (index === total - 1) return 'dessert';
  if (index === Math.floor(total / 2)) return 'side';
  return 'main';
}

const COURSE_CONFIG = {
  starter: { emoji:'🥗', title:'Starter',  color:'#1D9E75' },
  main:    { emoji:'🍛', title:'Main',      color:'#FF4500' },
  side:    { emoji:'🫙', title:'Side',      color:'#D97706' },
  dessert: { emoji:'🍮', title:'Dessert',   color:'#7C3AED' },
};

// ── Effort tag ────────────────────────────────────────────────────
function EffortTag({ meal }) {
  const mins = parseMins(meal.time);
  const isQuick = mins <= 15;
  return (
    <div style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'2px 9px', borderRadius:20, fontSize:10, fontWeight:600, marginBottom:6, background:isQuick?'rgba(29,158,117,0.09)':'rgba(217,119,6,0.09)', color:isQuick?'#065F46':'#92400E', border:'1px solid '+(isQuick?'rgba(29,158,117,0.22)':'rgba(217,119,6,0.22)') }}>
      {'⏱ '}{meal.time || '30 min'}{isQuick ? ' · Quick' : ' · Medium effort'}
    </div>
  );
}

export default function ResultsView({
  meals = [], mealType, cuisine, time, diet, defaultServings,
  ingredients, profile, user, isPremium, trialActive, PAID_RECIPE_CAP,
  ratings, setRatings, isFav, toggleFavourite, country,
  CUISINE_OPTIONS, tileContext,
  stapleSuggestion, onDismissStapleSuggestion, onAddStaple,
  handleSurprise, onRate, reset, navigate, t,
}) {
  const [dismissed, setDismissed] = useState(new Set());

  const handleRate = onRate || ((meal, stars) => {
    trackRating({ stars, cuisine: meal.cuisine, mealType });
    const key = mealKey(meal);
    setRatings(prev => ({ ...prev, [key]: stars }));
    if (user) updateRating({ userId: user.id, mealName: meal.name, rating: stars });
  });

  const handleRateWithFeedback = (meal, stars) => {
    handleRate(meal, stars);
    const fbMeal = toFeedbackMeal(meal);
    if (stars >= 4)       logFeedback({ meal: fbMeal, action: 'accepted', userId: user ? user.id : null });
    else if (stars <= 2)  logFeedback({ meal: fbMeal, action: 'rejected', userId: user ? user.id : null });
  };

  const handleNotForMe = (meal) => {
    const key = mealKey(meal);
    setDismissed(prev => new Set([...prev, key]));
    logFeedback({ meal: toFeedbackMeal(meal), action: 'rejected', userId: user ? user.id : null });
  };

  const handleCookThis = (meal) => {
    logFeedback({ meal: toFeedbackMeal(meal), action: 'accepted', userId: user ? user.id : null });
    handleSurprise && handleSurprise();
  };

  const topRated    = Object.entries(ratings).filter(([, r]) => r >= 4).map(([k]) => k);
  const visibleMeals = meals.filter(m => !dismissed.has(mealKey(m)));

  const isLeftover = isLeftoverContext(tileContext);
  const isHosting  = isHostingContext(tileContext);

  // ── Leftover groups ────────────────────────────────────────────
  const leftoverGroups = isLeftover ? (() => {
    const quick    = visibleMeals.filter(m => parseMins(m.time) <= 15);
    const creative = visibleMeals.filter(m => parseMins(m.time) > 15);
    // If all meals are quick or all are creative, split by position
    if (quick.length === 0 && creative.length === 0) return { quick: visibleMeals, creative: [] };
    if (quick.length === 0) return { quick: creative.slice(0, 2), creative: creative.slice(2) };
    return { quick, creative };
  })() : null;

  // ── Hosting course groups ──────────────────────────────────────
  const hostingGroups = isHosting ? (() => {
    const groups = { starter:[], main:[], side:[], dessert:[] };
    visibleMeals.forEach((meal, i) => {
      const course = inferCourse(meal, i, visibleMeals.length);
      groups[course].push(meal);
    });
    // Ensure at least main has meals if grouping left everything in one bucket
    if (groups.main.length === 0 && groups.starter.length > 1) {
      groups.main.push(...groups.starter.splice(1));
    }
    return groups;
  })() : null;

  // ── Meal card renderer ─────────────────────────────────────────
  // "Not for me" rendered BELOW card (not as absolute overlay) to keep fav clickable
  const renderMealCard = (meal, i) => (
    <div key={mealKey(meal) + i}>
      {isLeftover && <EffortTag meal={meal} />}
      <MealCard
        meal={meal} isFav={isFav(meal)}
        onToggleFav={(m) => { toggleFavourite(m || meal); logFeedback({ meal: toFeedbackMeal(m || meal), action: 'saved', userId: user ? user.id : null }); }}
        defaultServings={defaultServings}
        rating={ratings[mealKey(meal)] || 0}
        onRate={stars => handleRateWithFeedback(meal, stars)}
      />
      {(ratings[mealKey(meal)] || 0) === 0 && !dismissed.has(mealKey(meal)) && (
        <div style={{ textAlign:'right', marginTop:-6, marginBottom:8, paddingRight:4 }}>
          <button onClick={() => handleNotForMe(meal)}
            style={{ background:'none', border:'none', cursor:'pointer', fontSize:11, color:'#B0A09A', fontFamily:"'DM Sans',sans-serif", padding:'2px 4px', lineHeight:1.4, touchAction:'manipulation' }}>
            {'Not for me'}
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="results-wrap">

      {/* Pantry learning nudge */}
      {stapleSuggestion?.items?.length > 0 && !stapleSuggestion.shown && (
        <div style={{ background:'rgba(29,158,117,0.06)', border:'1px solid rgba(29,158,117,0.2)', borderRadius:12, padding:'10px 14px', marginBottom:12, display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, flexWrap:'wrap' }}>
          <span style={{ fontSize:12, color:'#1D9E75', fontWeight:400, flex:1 }}>
            {'🌿 You often add '}{stapleSuggestion.items.join(' and ')}{' — save it to your weekly staples?'}
          </span>
          <div style={{ display:'flex', gap:6, flexShrink:0 }}>
            <button onClick={() => onAddStaple?.(stapleSuggestion.items)} style={{ fontSize:11, padding:'4px 10px', borderRadius:8, background:'#1D9E75', color:'white', border:'none', cursor:'pointer', fontFamily:"'DM Sans',sans-serif", fontWeight:500 }}>{'+ Add'}</button>
            <button onClick={() => onDismissStapleSuggestion?.()} style={{ fontSize:11, padding:'4px 10px', borderRadius:8, background:'none', color:'#7C6A5E', border:'1px solid rgba(28,10,0,0.1)', cursor:'pointer', fontFamily:"'DM Sans',sans-serif" }}>{'Dismiss'}</button>
          </div>
        </div>
      )}

      </strong>
          </span>
          <button onClick={() => setPantryNudge([])} style={{ background:'none', border:'none', color:'#9E9E9E', cursor:'pointer', fontSize:12, fontFamily:"'DM Sans',sans-serif" }}>{'✕'}</button>
        </div>
      )}

      {/* Context banner */}
      {tileContext && (
        <div style={{ display:'flex', alignItems:'center', gap:12, padding:'14px 16px', borderRadius:14, marginBottom:20, background:tileContext.bg||'rgba(255,69,0,0.06)', border:'1px solid '+(tileContext.border||'rgba(255,69,0,0.18)') }}>
          <span style={{ fontSize:28, flexShrink:0 }}>{tileContext.emoji}</span>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:14, fontWeight:700, color:tileContext.color||'#CC3700', marginBottom:2 }}>{tileContext.label}</div>
            <div style={{ fontSize:12, color:'#7C6A5E', fontWeight:300, lineHeight:1.5 }}>{tileContext.sub||'Recipes personalised for this context'}</div>
          </div>
        </div>
      )}

      <div className="results-header">
        <div className="results-title">
          {isHosting
            ? '🎉 Full Meal Plan for your guests'
            : isLeftover
            ? '♻️ Rescued! Here\'s what to make.'
            : 'Jiffed. ⚡ Here\'s your menu.'}
        </div>
        <div className="results-sub">
          {'Tap ♥ to save · expand for full recipe + timers · adjust servings inside'}
          {profile && (
            <span style={{ color:'var(--jiff)', fontWeight:500 }}>
              {' · personalised for '}{profile.name?.split(' ')[0]}
            </span>
          )}
        </div>
      </div>

      <div className="filter-pills">
        {mealType && mealType !== 'any' && (
          <span className="filter-pill">
            {(MEAL_TYPE_OPTIONS.find(m => m.id === mealType)?.emoji || '🍽️') + ' ' + mealType}
          </span>
        )}
        {cuisine && cuisine !== 'any' && (
          <span className="filter-pill">{'🍴 ' + cuisine}</span>
        )}
        {time && <span className="filter-pill">{'⏱ ' + time}</span>}
        {diet && diet !== 'none' && <span className="filter-pill">{'🥗 ' + diet}</span>}
        <span className="filter-pill">{'👥 ' + defaultServings + (defaultServings !== 1 ? ' servings' : ' serving')}</span>
      </div>

      {!isPremium && trialActive && (
        <div style={{ background:'rgba(255,184,0,0.08)', border:'1px solid rgba(255,184,0,0.25)', borderRadius:12, padding:'10px 16px', marginBottom:12, display:'flex', alignItems:'center', justifyContent:'space-between', gap:10 }}>
          <div>
            <div style={{ fontSize:13, color:'#854F0B', fontWeight:500 }}>{'🎁 Trial — seeing 1 of '}{PAID_RECIPE_CAP}{' recipes'}</div>
            <div style={{ fontSize:11, color:'#92400E', fontWeight:300, marginTop:2 }}>{'Upgrade to unlock all recipes + week planner + saved meals'}</div>
          </div>
          <button onClick={() => { trackUpgradeClick('trial_banner'); navigate('/pricing'); }}
            style={{ background:'#854F0B', color:'white', border:'none', borderRadius:8, padding:'7px 16px', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:"'DM Sans',sans-serif", whiteSpace:'nowrap', flexShrink:0 }}>
            {'⚡ Upgrade'}
          </button>
        </div>
      )}

      {!isPremium && !trialActive && user && (
        <div style={{ background:'rgba(255,69,0,0.06)', border:'1.5px solid rgba(255,69,0,0.25)', borderRadius:12, padding:'12px 16px', marginBottom:12, display:'flex', alignItems:'center', justifyContent:'space-between', gap:10 }}>
          <div>
            <div style={{ fontSize:13, color:'#CC3700', fontWeight:600 }}>{'✨ '}{meals.length}{' recipes found'}</div>
            <div style={{ fontSize:11, color:'#7C6A5E', fontWeight:300, marginTop:2 }}>{'Unlock all '}{PAID_RECIPE_CAP}{' recipes, week planner, and saved meals'}</div>
          </div>
          <button onClick={() => { trackUpgradeClick('results_gate'); navigate('/pricing'); }}
            style={{ background:'#FF4500', color:'white', border:'none', borderRadius:8, padding:'7px 16px', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:"'DM Sans',sans-serif", whiteSpace:'nowrap', flexShrink:0 }}>
            {'⚡ Upgrade →'}
          </button>
        </div>
      )}

      {profile?.skill_level === 'beginner' && (
        <div style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'5px 12px', borderRadius:20, background:'rgba(29,158,117,0.08)', border:'1px solid rgba(29,158,117,0.2)', marginBottom:10, fontSize:11, color:'#065F46', fontWeight:500 }}>
          {'✓ Beginner-friendly recipes'}
        </div>
      )}

      {/* ── LEFTOVER MODE: Quick Fix + Creative Twist ─────────── */}
      {isLeftover && leftoverGroups && (
        <>
          {leftoverGroups.quick.length > 0 && (
            <>
              <SL emoji="⚡" title="Quick Fix" sub="Ready in 15 minutes or less" color="#1D9E75" />
              <div className="meals-grid">
                {leftoverGroups.quick.map((meal, i) => renderMealCard(meal, i))}
              </div>
            </>
          )}
          {leftoverGroups.creative.length > 0 && (
            <>
              <SL emoji="✨" title="Creative Twist" sub="A little more effort, worth it" color="#7C3AED" />
              <div className="meals-grid">
                {leftoverGroups.creative.map((meal, i) => renderMealCard(meal, i + leftoverGroups.quick.length))}
              </div>
            </>
          )}
        </>
      )}

      {/* ── HOSTING MODE: Starter / Main / Side / Dessert ────── */}
      {isHosting && hostingGroups && (
        <>
          {(['starter','main','side','dessert']).map(course => {
            const courseMeals = hostingGroups[course];
            if (!courseMeals || courseMeals.length === 0) return null;
            const cfg = COURSE_CONFIG[course];
            return (
              <div key={course}>
                <SL emoji={cfg.emoji} title={cfg.title} color={cfg.color} />
                <div className="meals-grid">
                  {courseMeals.map((meal, i) => renderMealCard(meal, i))}
                </div>
              </div>
            );
          })}
        </>
      )}

      {/* ── DEFAULT MODE: standard grid ───────────────────────── */}
      {!isLeftover && !isHosting && (
        <div className="meals-grid">
          {visibleMeals.map((meal, i) => renderMealCard(meal, i))}
        </div>
      )}

      {/* Smart recommendations — post-rating */}
      {topRated.length >= 1 && (() => {
        const topMeal    = meals.find(m => (ratings[mealKey(m)] || 0) >= 4 && m.cuisine);
        const topCuisine = topMeal?.cuisine;
        const cuisineLabel = topCuisine
          ? topCuisine.replace(/_/g,' ').split(' ').map(w => w.charAt(0).toUpperCase()+w.slice(1)).join(' ')
          : null;
        return (
          <div style={{ background:'rgba(255,69,0,0.04)', border:'1px solid rgba(255,69,0,0.15)', borderRadius:14, padding:'14px 16px', marginBottom:16 }}>
            <div style={{ fontSize:11, letterSpacing:'1.5px', textTransform:'uppercase', color:'var(--muted)', fontWeight:600, marginBottom:8 }}>
              {'✨ More like what you loved'}
            </div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
              {cuisineLabel && (
                <button onClick={() => { handleCookThis(topMeal); }}
                  style={{ padding:'8px 16px', borderRadius:20, background:'#FF4500', color:'white', border:'none', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:"'DM Sans',sans-serif" }}>
                  {'More '}{cuisineLabel}{' ideas →'}
                </button>
              )}
              <button onClick={handleSurprise}
                style={{ padding:'8px 16px', borderRadius:20, background:'white', color:'#FF4500', border:'1.5px solid rgba(255,69,0,0.3)', fontSize:12, fontWeight:500, cursor:'pointer', fontFamily:"'DM Sans',sans-serif" }}>
                {'✨ Surprise me'}
              </button>
            </div>
          </div>
        );
      })()}

      {/* Order-in strip */}
      {meals?.[0]?.name && (
        <div style={{ background:'rgba(28,10,0,0.025)', border:'1px solid rgba(28,10,0,0.07)', borderRadius:14, padding:'14px 18px', marginBottom:12 }}>
          <div style={{ fontSize:12, fontWeight:500, color:'var(--muted)', marginBottom:10 }}>
            {"🛵 Can't cook today? Order it instead"}
          </div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            {[
              { name:'Swiggy',  color:'#FC8019', url:'https://www.swiggy.com/search?query=' +encodeURIComponent(meals[0].name) },
              { name:'Zomato',  color:'#CB202D', url:'https://www.zomato.com/search?q='     +encodeURIComponent(meals[0].name) },
              { name:'EatSure', color:'#E84855', url:'https://eatsure.com/search?query='    +encodeURIComponent(meals[0].name) },
            ].map(d => (
              <a key={d.name} href={d.url} target="_blank" rel="noopener noreferrer"
                style={{ padding:'7px 16px', borderRadius:10, textDecoration:'none', fontSize:12, fontWeight:600, color:'white', background:d.color, display:'inline-block' }}>
                {d.name}
              </a>
            ))}
          </div>
        </div>
      )}


    </div>
  );
}
