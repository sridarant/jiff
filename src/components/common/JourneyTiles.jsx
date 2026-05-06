// src/components/common/JourneyTiles.jsx
// Adaptive decision assistant — decision-first, rejection-aware, session-adaptive.
//
// LAYOUT (strict order):
//   §1  Greeting + week badge + event banner (ONLY when event is active in time window)
//   §2  Continuity nudge (behaviour insight, 1 line, subtle)
//   §3  ONE retention nudge (inline, dismissible)
//   §4  PRIMARY card (dominates screen)
//   §5  ALTERNATES (2 compact rows, tap → swap)
//   §6  "Change direction" — 6 options (3×2 grid)
//   §7  Context tile — below fold (ONLY non-fridge, i.e. only when event/festival/context active)
//   §8  ChallengeTracker — below fold
//   §9  Weekly planner — below fold
//
// All 6 change-direction options route through buildJourneyContext → same engine.
// Rejection: re-scores in-place, no reload.
// Trust: ✔ why text, context labels, "Got it — switching it up", micro-reward toasts.
// Habit: streak, weekly goal progress, continuity nudge, re-entry state.

import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import MoodSelector   from './MoodSelector.jsx';
import OrderInSheet   from './OrderInSheet.jsx';
import GoalSheet      from './GoalSheet.jsx';
import RetentionNudges, { ChallengeTracker } from './RetentionNudges.jsx';
import { getUpcomingFestival, getActiveSportsEvent, getDayOfWeekContext } from '../../lib/festival.js';
import { getUserContext } from '../../lib/weather.js';
import { getFeaturedTile } from './journeyTileEngines.js';
import { logFeedback, syncBehaviourToProfile } from '../../services/feedbackService.js';
import { markAsShown, getPersonalisedRecommendations, recommendationToContext, buildJourneyContext, getTimePressureFlag } from '../../services/recommendationService.js';
import { trackPrimaryShown, trackRecommendationAccepted, trackRecommendationRejected, trackRecommendationSwapped } from '../../lib/analytics.js';

const C = {
  jiff:'#FF4500', jiffDark:'#CC3700', ink:'#1C0A00',
  cream:'#FFFAF5', muted:'#7C6A5E',
  border:'rgba(28,10,0,0.08)', borderMid:'rgba(28,10,0,0.14)',
  softOrange:'rgba(255,69,0,0.055)', softOrangeMid:'rgba(255,69,0,0.09)',
};

function SL({ children, mt }) {
  return (
    <div style={{ fontSize:10, letterSpacing:'2px', textTransform:'uppercase', color:C.muted, fontWeight:600, marginBottom:9, marginTop:mt || 4 }}>
      {children}
    </div>
  );
}

// ── Context label pill ────────────────────────────────────────────
function ContextLabel({ label }) {
  if (!label) return null;
  const colors = {
    'Light meal':    { bg:'rgba(29,158,117,0.08)', border:'rgba(29,158,117,0.22)', color:'#065F46' },
    'High protein':  { bg:'rgba(37,99,235,0.08)',  border:'rgba(37,99,235,0.22)',  color:'#1E40AF' },
    'Festive':       { bg:'rgba(220,38,38,0.07)',   border:'rgba(220,38,38,0.22)',  color:'#991B1B' },
    'Kid-friendly':  { bg:'rgba(217,119,6,0.07)',   border:'rgba(217,119,6,0.22)',  color:'#92400E' },
  };
  const s = colors[label] || { bg:'rgba(28,10,0,0.05)', border:C.border, color:C.muted };
  return (
    <span style={{ fontSize:9, fontWeight:700, letterSpacing:'0.8px', padding:'2px 8px', borderRadius:6, border:'1px solid '+s.border, background:s.bg, color:s.color }}>
      {label.toUpperCase()}
    </span>
  );
}

// ── §4 Primary card ───────────────────────────────────────────────
function PrimaryCard({ emoji, label, effortMins, why, contextLabel, timePressure, confidenceLabel, onCook, onNotForMe, animKey }) {
  const [hov, setHov] = useState(false);
  const isQuick = effortMins <= 15;

  return (
    <div key={animKey} style={{ marginBottom:14, animation:'fadeUp 0.22s ease' }}>
      <style>{`@keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <div
        onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
        style={{ background:hov?C.softOrangeMid:C.softOrange, border:'1.5px solid '+(hov?'rgba(255,69,0,0.28)':'rgba(255,69,0,0.16)'), borderRadius:20, padding:'18px 18px 16px', transition:'all 0.13s', boxShadow:hov?'0 6px 24px rgba(255,69,0,0.11)':'0 2px 10px rgba(28,10,0,0.05)' }}>

        {/* Top row */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:13, gap:8 }}>
          <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
            <span style={{ fontSize:9, fontWeight:700, color:C.jiff, background:'rgba(255,69,0,0.09)', border:'1px solid rgba(255,69,0,0.20)', borderRadius:6, padding:'2px 8px', letterSpacing:'1px' }}>
              {confidenceLabel || 'BEST MATCH TODAY'}
            </span>
            {contextLabel && <ContextLabel label={contextLabel} />}
            {timePressure && (
              <span style={{ fontSize:9, fontWeight:600, color:'#1D9E75', background:'rgba(29,158,117,0.09)', border:'1px solid rgba(29,158,117,0.22)', borderRadius:6, padding:'2px 7px' }}>
                {'SHORT ON TIME?'}
              </span>
            )}
          </div>
          <button onClick={onNotForMe}
            style={{ background:'none', border:'1px solid rgba(28,10,0,0.10)', cursor:'pointer', color:C.muted, fontSize:11, padding:'2px 8px', lineHeight:1.4, borderRadius:6, fontFamily:"'DM Sans',sans-serif", flexShrink:0 }}>
            {'Not this'}
          </button>
        </div>

        {/* Identity */}
        <div style={{ display:'flex', alignItems:'flex-start', gap:13, marginBottom:13, cursor:'pointer' }} onClick={onCook}>
          <span style={{ fontSize:40, lineHeight:1, flexShrink:0 }}>{emoji}</span>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontFamily:"'Fraunces',serif", fontSize:21, fontWeight:900, color:C.ink, lineHeight:1.15, marginBottom:7 }}>{label}</div>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              <span style={{ fontSize:11, fontWeight:700, color:isQuick?'#1D9E75':C.jiff, background:isQuick?'rgba(29,158,117,0.09)':'rgba(255,69,0,0.08)', border:'1px solid '+(isQuick?'rgba(29,158,117,0.22)':'rgba(255,69,0,0.20)'), borderRadius:20, padding:'3px 10px' }}>
                {'⏱ '}{effortMins}{' min'}
              </span>
              <span style={{ fontSize:11, color:C.muted, background:'rgba(28,10,0,0.04)', border:'1px solid rgba(28,10,0,0.07)', borderRadius:20, padding:'3px 10px' }}>
                {why && why.effortLabel ? why.effortLabel : (isQuick ? 'Quick' : 'Medium effort')}
              </span>
            </div>
          </div>
        </div>

        {/* Why block — ✔ line1 + line2 */}
        {why && why.line1 && (
          <div style={{ borderTop:'1px solid rgba(255,69,0,0.11)', paddingTop:11, marginBottom:13 }}>
            <div style={{ fontSize:12, fontWeight:600, color:C.ink, lineHeight:1.5 }}>{'✔ '}{why.line1}</div>
            {why.line2 && <div style={{ fontSize:11, color:C.muted, fontWeight:400, lineHeight:1.45, marginTop:3 }}>{why.line2}</div>}
          </div>
        )}

        <button onClick={onCook}
          style={{ width:'100%', padding:'12px', borderRadius:13, background:C.jiff, color:'white', border:'none', fontSize:14, fontWeight:700, cursor:'pointer', fontFamily:"'DM Sans',sans-serif", letterSpacing:'0.2px', transition:'background 0.12s' }}
          onMouseEnter={e => { e.currentTarget.style.background = C.jiffDark; }}
          onMouseLeave={e => { e.currentTarget.style.background = C.jiff; }}>
          {'Cook this →'}
        </button>
      </div>
    </div>
  );
}

// ── §5 Alternate row ──────────────────────────────────────────────
function AlternateRow({ emoji, label, effortMins, why, onSwap, onNotForMe }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  const whyText = why && why.line1 ? why.line1 : null;
  return (
    <div style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 13px', background:'white', border:'1px solid '+C.border, borderRadius:12, marginBottom:8, animation:'fadeUp 0.2s ease' }}>
      <span style={{ fontSize:22, flexShrink:0 }}>{emoji}</span>
      <div style={{ flex:1, minWidth:0, cursor:'pointer' }} onClick={onSwap}>
        <div style={{ fontSize:13, fontWeight:600, color:C.ink, lineHeight:1.3 }}>{label}</div>
        <div style={{ fontSize:10, color:C.muted, marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {effortMins + ' min'}{whyText ? ' · ' + whyText : ''}
        </div>
      </div>
      <div style={{ display:'flex', gap:6, flexShrink:0 }}>
        <button onClick={onSwap}
          style={{ padding:'6px 12px', borderRadius:8, border:'1px solid rgba(255,69,0,0.22)', background:'rgba(255,69,0,0.04)', color:C.jiff, fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:"'DM Sans',sans-serif", whiteSpace:'nowrap' }}>
          {'Try this →'}
        </button>
        <button onClick={() => { setDismissed(true); onNotForMe && onNotForMe(); }}
          style={{ padding:'6px 8px', borderRadius:8, border:'1px solid rgba(28,10,0,0.08)', background:'white', color:C.muted, fontSize:11, cursor:'pointer', fontFamily:"'DM Sans',sans-serif", lineHeight:1 }}>
          {'✕'}
        </button>
      </div>
    </div>
  );
}

// ── §6 "Change direction" — 6 options ────────────────────────────
function ChangeDirectionRow({ onOption }) {
  const options = [
    { key:'mood',     label:'Match my mood',  emoji:'😊' },
    { key:'fridge',   label:'Cook with what I have',emoji:'🧊' },
    { key:'surprise', label:'Surprise me',    emoji:'✨' },
    { key:'kids',     label:'Cook for kids',  emoji:'🎒' },
    { key:'leftover', label:'Use leftovers',  emoji:'♻️' },
    { key:'hosting',  label:'Guests coming',  emoji:'🎉' },
  ];
  return (
    <div style={{ marginBottom:20 }}>
      <div style={{ fontSize:11, color:C.muted, fontWeight:400, marginBottom:10, textAlign:'center' }}>{'Change direction'}</div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8 }}>
        {options.map(opt => (
          <button key={opt.key} onClick={() => onOption(opt.key)}
            style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4, padding:'9px 6px', borderRadius:12, border:'1px solid '+C.border, background:'white', cursor:'pointer', fontFamily:"'DM Sans',sans-serif", transition:'all 0.12s' }}
            onMouseEnter={e => { e.currentTarget.style.background='rgba(28,10,0,0.03)'; e.currentTarget.style.borderColor=C.borderMid; }}
            onMouseLeave={e => { e.currentTarget.style.background='white'; e.currentTarget.style.borderColor=C.border; }}>
            <span style={{ fontSize:16 }}>{opt.emoji}</span>
            <span style={{ fontSize:10, fontWeight:600, color:C.muted, textAlign:'center', lineHeight:1.3 }}>{opt.label}</span>
          </button>
        ))}
      </div>
      {/* Plan ahead — subtle entry below grid */}
      <button onClick={() => onOption('plan')}
        style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'center', gap:6, marginTop:6, padding:'7px 12px', borderRadius:10, border:'1px solid rgba(28,10,0,0.07)', background:'rgba(28,10,0,0.02)', cursor:'pointer', fontFamily:"'DM Sans',sans-serif", fontSize:11, color:'#7C6A5E', fontWeight:400 }}>
        {'📅 Plan for ' + (new Date().getHours() < 11 ? 'this morning' : new Date().getHours() < 16 ? 'lunch' : 'dinner') + ' →'}
      </button>
    </div>
  );
}

// ── §7 Context tile ───────────────────────────────────────────────
function ContextTile({ emoji, label, sub, color, bg, border, badge, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ width:'100%', display:'flex', alignItems:'center', gap:14, padding:'14px 16px', background:hov?(bg||'rgba(255,69,0,0.09)'):(bg||'rgba(255,69,0,0.05)'), border:'1.5px solid '+(border||'rgba(255,69,0,0.16)'), borderRadius:15, cursor:'pointer', fontFamily:"'DM Sans',sans-serif", textAlign:'left', transition:'all 0.13s', marginBottom:14, position:'relative' }}>
      {badge && <span style={{ position:'absolute', top:9, right:12, fontSize:8, fontWeight:700, color:color||C.jiff, background:'white', border:'1px solid '+(border||'rgba(255,69,0,0.2)'), borderRadius:5, padding:'2px 6px', letterSpacing:'1px' }}>{badge}</span>}
      <span style={{ fontSize:28, flexShrink:0 }}>{emoji}</span>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:13, fontWeight:700, color:color||C.ink, marginBottom:2 }}>{label}</div>
        {sub && <div style={{ fontSize:11, color:C.muted, fontWeight:300, lineHeight:1.4 }}>{sub}</div>}
      </div>
      <span style={{ fontSize:16, color:color||C.jiff, flexShrink:0 }}>{'→'}</span>
    </button>
  );
}

// ── §9 Weekly planner ─────────────────────────────────────────────
function WeeklyPlanner({ onGenerateDirect }) {
  const today = new Date();
  const DAYS  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const h     = today.getHours();
  const slots = [
    { offsetDays:0,  label:'Today',   mealType:h<11?'breakfast':h<16?'lunch':h<19?'snack':'dinner', description:h<11?'Quick breakfast':h<16?'Light lunch':h<19?'Quick snack':'Quick dinner', context:{} },
    { offsetDays:2,  label:'',        mealType:'lunch',  description:'Lighter midweek meal',  context:{ goal:'eat_healthier' } },
    { offsetDays:4,  label:'',        mealType:'dinner', description:'Comfort dinner',         context:{} },
    { offsetDays:6,  label:'Weekend', mealType:'dinner', description:'Something special',      context:{ hosting:true, servings:4 } },
  ].map(slot => {
    const d = new Date(today);
    d.setDate(today.getDate() + slot.offsetDays);
    return { ...slot, dayLabel: slot.label || DAYS[d.getDay()] };
  });
  const MEAL_EMOJI = { breakfast:'🌅', lunch:'☀️', snack:'🍎', dinner:'🌙' };
  return (
    <div style={{ marginBottom:16 }}>
      <div style={{ background:'white', border:'1px solid '+C.border, borderRadius:16, overflow:'hidden' }}>
        <div style={{ padding:'12px 16px', borderBottom:'1px solid rgba(28,10,0,0.05)' }}>
          <div style={{ fontSize:10, letterSpacing:'2px', textTransform:'uppercase', color:C.muted, fontWeight:600 }}>{'This week looks like'}</div>
        </div>
        {slots.map((slot, i) => (
          <button key={i}
            onClick={() => onGenerateDirect && onGenerateDirect({ mealType:slot.mealType, ...slot.context })}
            style={{ width:'100%', display:'flex', alignItems:'center', gap:12, padding:'11px 16px', background:'white', border:'none', borderBottom:i<slots.length-1?'1px solid rgba(28,10,0,0.04)':'none', cursor:'pointer', textAlign:'left', fontFamily:"'DM Sans',sans-serif", transition:'background 0.1s' }}
            onMouseEnter={e => { e.currentTarget.style.background='rgba(255,69,0,0.03)'; }}
            onMouseLeave={e => { e.currentTarget.style.background='white'; }}>
            <span style={{ fontSize:16, flexShrink:0 }}>{MEAL_EMOJI[slot.mealType]||'🍽️'}</span>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:12, fontWeight:600, color:C.ink }}>{slot.dayLabel}</div>
              <div style={{ fontSize:11, color:C.muted, fontWeight:300 }}>{slot.description}</div>
            </div>
            <span style={{ fontSize:12, color:C.muted, flexShrink:0 }}>{'→'}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Toast ─────────────────────────────────────────────────────────
function Toast({ message, visible }) {
  return (
    <div style={{ position:'fixed', bottom:90, left:'50%', transform:'translateX(-50%) translateY('+(visible?0:20)+'px)', background:'#1C0A00', color:'white', borderRadius:24, padding:'9px 20px', fontSize:13, fontWeight:600, whiteSpace:'nowrap', opacity:visible?1:0, transition:'all 0.22s ease', pointerEvents:'none', zIndex:300, fontFamily:"'DM Sans',sans-serif", boxShadow:'0 4px 18px rgba(28,10,0,0.22)' }}>
      {message}
    </div>
  );
}

// ── Continuity nudge (Part 10 §3) ────────────────────────────────
// 1-line subtle text just above primary card. Reads from mealHistory.
function ContinuityNudge({ mealHistory, streak }) {
  const text = (() => {
    if (!Array.isArray(mealHistory) || mealHistory.length === 0) return null;
    const now     = Date.now();
    const day1    = 86400000;
    const lastTs  = new Date(mealHistory[0].generated_at || mealHistory[0].created_at || 0).getTime();
    const daysSince = Math.floor((now - lastTs) / day1);

    // Re-entry state: >48h → nudge toward quick meals
    if (daysSince >= 2) return "You haven't cooked in " + daysSince + " days — try something quick";

    // Last meal was light → continue?
    const lastTags = mealHistory[0].meal?.tags || [];
    if (lastTags.includes('light') || lastTags.includes('healthy')) {
      return 'You cooked something light — continue the streak?';
    }

    // Streak signal
    if (streak >= 3) return "You're on a " + streak + "-day cooking streak 🔥";

    return null;
  })();

  if (!text) return null;
  return (
    <div style={{ fontSize:11, color:C.muted, fontWeight:400, marginBottom:8, marginTop:4, paddingLeft:2, fontStyle:'italic' }}>
      {text}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────
export function JourneyTiles({
  profile, season, streak, country,
  ratings, mealHistory,
  didYouCookNudge, weeklyDigest, welcomeBack, challenge, milestone,
  upgradeNudge, onDismissUpgrade,
  onConfirmCooked, onDismissNudge,
  onSelectFridge, onGenerateDirect, onLeftoverRescue, onWeatherGenerate,
  user,
  navJourneyCtx = null,
  continuityNudge = null,
  weekCookCount = 0,
  showPrefNudge = false,
  onNotYet,
  onShowSomethingElse,
}) {
  const navigate = useNavigate();
  const [showMood,  setShowMood]  = useState(false);
  const [showOrder, setShowOrder] = useState(false);
  const [showGoal,  setShowGoal]  = useState(false);
  const [weather,   setWeather]   = useState(null);
  const [toast,     setToast]     = useState({ visible:false, message:'' });
  const [adaptMsg,  setAdaptMsg]  = useState(null);
  const [cards,          setCards]          = useState(null);
  const [primaryAnimKey, setPrimaryAnimKey] = useState(0);
  const acceptedPrimaryRef = useRef(false);
  const feedbackCountRef   = useRef(0);
  const shownTrackedRef    = useRef(false);

  const festival = getUpcomingFestival(profile);
  const sports   = getActiveSportsEvent();
  const dayCtx   = getDayOfWeekContext();

  // ── Load cards ────────────────────────────────────────────────
  const loadCards = useCallback((journeyCtx = null) => {
    const jCtx = journeyCtx || buildJourneyContext({ journeyType:'default', profile, mealHistory });
    const recs  = getPersonalisedRecommendations({ profile, ratings, mealHistory, journeyContext: jCtx });
    const mapped = recs.map(rec => ({
      meal:         rec.meal,
      emoji:        rec.meal.emoji,
      label:        rec.meal.name,
      cuisine:      rec.meal.cuisine,
      effortMins:   rec.meal.effortMins,
      tags:         rec.meal.tags,
      why:          rec.why,
      role:         rec.role,
      score:        rec.score,
      timePressure: rec.timePressure || false,
      activeEvent:  rec.activeEvent  || null,
      contextLabel: rec.contextLabel || null,
      context:      recommendationToContext(rec),
    }));
    setCards(mapped);
    setPrimaryAnimKey(k => k + 1);
    shownTrackedRef.current = false;
    return mapped;
  }, [profile, ratings, mealHistory]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    getUserContext().then(ctx => setWeather(ctx ? (ctx.weather || null) : null)).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const initCtx = navJourneyCtx || null;
    const mapped  = loadCards(initCtx);
    if (mapped.length > 0) markAsShown(mapped.map(c => c.label));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!cards) return;
    const primary = cards.find(c => c.role === 'primary');
    if (primary && !shownTrackedRef.current) {
      shownTrackedRef.current = true;
      trackPrimaryShown({ mealId: primary.meal?.id || primary.label, mealName: primary.label, cuisine: primary.cuisine, score: primary.score });
    }
  }, [cards]);

  const syncBehaviour = () => {
    feedbackCountRef.current += 1;
    if (feedbackCountRef.current >= 5 && user && user.id) {
      feedbackCountRef.current = 0;
      syncBehaviourToProfile(user.id);
    }
  };

  const showToast = (msg, ms = 2200) => {
    setToast({ visible:true, message:msg });
    setTimeout(() => setToast({ visible:false, message:msg }), ms);
  };

  // Micro-reward: context-aware post-cook message
  const cookToastMsg = (card) => {
    if (card.effortMins <= 15 && card.tags && card.tags.includes('healthy')) {
      return "Nice — quick and healthy 👍";
    }
    const realStreak = (streak || 0) + 1;
    if (realStreak >= 2) return "You're on a " + realStreak + "-day streak 🔥";
    return "Nice — I'll keep this in mind 👍";
  };

  const greet = () => {
    const h    = new Date().getHours();
    const name = profile && profile.name ? profile.name.split(' ')[0] : '';
    const base = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    return name ? base + ', ' + name : base;
  };

  const framingText = () => {
    const h = new Date().getHours();
    if (h >= 5  && h < 11) return 'Ready for breakfast?';
    if (h >= 11 && h < 16) return 'Ready for lunch?';
    if (h >= 16 && h < 19) return 'Snack time?';
    if (h >= 19 && h < 23) return 'Ready for dinner?';
    return 'Something to cook?'; // midnight – 5am
  };

  const isReturning    = !!(welcomeBack && welcomeBack.daysAway >= 3);
  const lastFavCuisine = (() => {
    if (!Array.isArray(mealHistory)) return null;
    const hit = [...mealHistory]
      .sort((a,b) => new Date(b.generated_at||0) - new Date(a.generated_at||0))
      .find(h => h.cuisine && (ratings && ratings[h.meal_name] >= 4));
    return hit ? (hit.cuisine || null) : null;
  })();

  const featured = getFeaturedTile({ festival, sports, weather, dayCtx, profile, isReturning, lastFavCuisine });

  const handleFeatured = () => {
    if (featured.isFridge) { onSelectFridge && onSelectFridge(); return; }
    if (featured.navTo)    { navigate(featured.navTo); return; }
    if (featured.context)  { onGenerateDirect && onGenerateDirect(featured.context); }
  };

  const ratingCount  = ratings ? Object.keys(ratings).length : 0;
  const primaryCard  = cards ? cards.find(c => c.role === 'primary') : null;
  const alternates   = cards ? cards.filter(c => c.role === 'alternate') : [];
  const hasSignal    = ratingCount >= 1 ||
    (profile && (profile.preferred_cuisines || []).length > 0) ||
    (profile && profile.active_goal);

  const confidenceLabel = (() => {
    if (ratingCount >= 5) return 'PICKED FOR YOU';
    if (ratingCount >= 2) return 'BEST MATCH TODAY';
    if (profile && (profile.preferred_cuisines || []).length > 0) return 'FROM YOUR CUISINES';
    return 'SUGGESTED FOR YOU';
  })();

  // weekCookCount comes from useRetention via prop (line 304) — no local duplicate

  // Weekly goal: cook 3 times this week (Part 10 §2)
  const weeklyGoalTarget = 3;
  const weeklyGoalProgress = Math.min(weekCookCount, weeklyGoalTarget);
  const showWeeklyGoal = weeklyGoalProgress > 0 && weeklyGoalProgress < weeklyGoalTarget;

  // Streak logic: show only if ≥1 cook in last 7 days; else show restart prompt (Part 10 §1)
  const hasRecentCook = weekCookCount >= 1;
  const showStreak    = (streak || 0) >= 2 && hasRecentCook;
  const showRestart   = (streak || 0) === 0 && !hasRecentCook && Array.isArray(mealHistory) && mealHistory.length > 0;

  // Active event from primary card — only shown when truly active
  const activeEvent = primaryCard && primaryCard.activeEvent ? primaryCard.activeEvent : null;

  // ── Cook this ───────────────────────────────────────────────
  const handleCook = (card, position) => {
    const action = (position > 0 && acceptedPrimaryRef.current) ? 'swapped' : 'accepted';
    if (position === 0) acceptedPrimaryRef.current = true;
    logFeedback({ meal: card.meal, action, userId: user ? user.id : null, position });
    syncBehaviour();
    if (action === 'accepted') {
      trackRecommendationAccepted({ mealId: card.meal?.id || card.label, mealName: card.label, cuisine: card.cuisine, position });
    } else {
      trackRecommendationSwapped({ mealId: card.meal?.id || card.label, mealName: card.label, cuisine: card.cuisine, position });
    }
    showToast(cookToastMsg(card));
    setAdaptMsg(null);
    onGenerateDirect && onGenerateDirect(card.context);
  };

  // ── Reject → re-score ───────────────────────────────────────
  const handleNotForMe = (card, position) => {
    logFeedback({ meal: card.meal, action: 'rejected', userId: user ? user.id : null, position });
    syncBehaviour();
    trackRecommendationRejected({ mealId: card.meal?.id || card.label, mealName: card.label, cuisine: card.cuisine, position });
    const rejectStreak = (() => { try { return parseInt(sessionStorage.getItem('jiff-session-reject-streak') || '0'); } catch { return 0; } })();
    if (rejectStreak >= 2 && !adaptMsg) {
      setAdaptMsg('Got it — switching it up');
      setTimeout(() => setAdaptMsg(null), 3000);
    }
    const newCards = loadCards();
    markAsShown(newCards.map(c => c.label));
  };

  // ── Swap: alternate → primary ───────────────────────────────
  const handleSwap = (altCard, altPosition) => {
    if (primaryCard) {
      logFeedback({ meal: primaryCard.meal, action: 'swapped', userId: user ? user.id : null, position: 0 });
      trackRecommendationSwapped({ mealId: primaryCard.meal?.id || primaryCard.label, mealName: primaryCard.label, cuisine: primaryCard.cuisine, position: 0 });
    }
    logFeedback({ meal: altCard.meal, action: 'accepted', userId: user ? user.id : null, position: altPosition });
    trackRecommendationAccepted({ mealId: altCard.meal?.id || altCard.label, mealName: altCard.label, cuisine: altCard.cuisine, position: altPosition });
    syncBehaviour();
    showToast(cookToastMsg(altCard));
    setAdaptMsg(null);
    onGenerateDirect && onGenerateDirect(altCard.context);
  };

  // ── Change direction ─────────────────────────────────────────
  const handleChangeDirection = (optionKey) => {
    let journeyCtx;
    switch (optionKey) {
      case 'mood':
        setShowMood(true);
        return;
      case 'fridge':
        onSelectFridge && onSelectFridge();
        return;
      case 'surprise':
        journeyCtx = buildJourneyContext({ journeyType:'surprise', profile, mealHistory });
        onGenerateDirect && onGenerateDirect({ surpriseMode:true });
        break;
      case 'kids':
        journeyCtx = buildJourneyContext({ journeyType:'kids', profile, mealHistory });
        onGenerateDirect && onGenerateDirect({ mealType:'lunch', kidsMode:true });
        break;
      case 'leftover':
        journeyCtx = buildJourneyContext({ journeyType:'leftover', profile, mealHistory });
        onLeftoverRescue && onLeftoverRescue();
        break;
      case 'hosting':
        journeyCtx = buildJourneyContext({ journeyType:'hosting', profile, mealHistory });
        onGenerateDirect && onGenerateDirect({ hosting:true, servings:8, mealType:'dinner' });
        break;
      case 'plan': {
        const planHour = new Date().getHours();
        const planMeal = planHour < 11 ? 'breakfast' : planHour < 16 ? 'lunch' : 'dinner';
        journeyCtx = buildJourneyContext({ journeyType:'default', mealTypeOverride:planMeal, profile, mealHistory });
        onGenerateDirect && onGenerateDirect({ mealType:planMeal, planAhead:true });
        break;
      }
      default:
        journeyCtx = buildJourneyContext({ journeyType:'default', profile, mealHistory });
    }
    if (journeyCtx && optionKey !== 'surprise' && optionKey !== 'fridge') {
      const newCards = loadCards(journeyCtx);
      markAsShown(newCards.map(c => c.label));
    }
  };

  const handleMoodEntry = (mood, moodContext) => {
    setShowMood(false);
    if (mood) {
      const jCtx = buildJourneyContext({ journeyType:'mood', mood: mood.id, profile, mealHistory });
      const newCards = loadCards(jCtx);
      markAsShown(newCards.map(c => c.label));
    }
    onGenerateDirect && onGenerateDirect({ mood: mood?.id, moodContext });
  };

  return (
    <div style={{ maxWidth:680, margin:'0 auto', padding:'14px 16px 80px', fontFamily:"'DM Sans',sans-serif" }}>

      {/* §1 GREETING + streak / week badge */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:8, marginBottom:4 }}>
        <div>
          <h2 style={{ fontFamily:"'Fraunces',serif", fontSize:'clamp(19px,5vw,24px)', fontWeight:900, color:C.ink, margin:0, lineHeight:1.2 }}>
            {greet()} ⚡
          </h2>
          <div style={{ fontSize:13, color:C.muted, fontWeight:300, marginTop:3 }}>{framingText()}</div>

          {/* Streak — only if ≥2 and has recent cook */}
          {showStreak && (
            <div style={{ display:'inline-flex', alignItems:'center', gap:4, marginTop:5, background:'rgba(255,69,0,0.07)', border:'1px solid rgba(255,69,0,0.18)', borderRadius:20, padding:'2px 10px', fontSize:10, color:'#CC3700', fontWeight:600 }}>
              {'🔥 '}{streak}{'-day streak!'}
            </div>
          )}

          {/* Restart prompt — if streak broke */}
          {showRestart && (
            <div style={{ marginTop:5, fontSize:11, color:C.muted, fontStyle:'italic' }}>
              {"Let's restart today — even a quick meal counts"}
            </div>
          )}
        </div>

        {/* Weekly goal progress — 🔥 X/3 this week */}
        {weekCookCount > 0 && (
          <div style={{ flexShrink:0, marginTop:2, display:'flex', flexDirection:'column', alignItems:'flex-end', gap:3 }}>
            <div style={{ display:'inline-flex', alignItems:'center', gap:4, background:'rgba(255,69,0,0.07)', border:'1px solid rgba(255,69,0,0.18)', borderRadius:20, padding:'3px 10px', fontSize:11, color:'#CC3700', fontWeight:700, whiteSpace:'nowrap' }}>
              {'🔥 '}{weekCookCount}{'/7 this week'}
            </div>
            {showWeeklyGoal && (
              <div style={{ fontSize:10, color:C.muted, fontWeight:400 }}>
                {'Goal: '}{weeklyGoalProgress}{'/'}{weeklyGoalTarget}{' this week'}
              </div>
            )}
          </div>
        )}
      </div>



      {/* §3 NUDGE */}
      {/* Preference nudge — replaces onboarding, non-blocking */}
      {showPrefNudge && (
        <div style={{ marginTop:8, padding:'9px 13px', borderRadius:11, background:'rgba(255,69,0,0.05)', border:'1px solid rgba(255,69,0,0.18)', display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontSize:16, flexShrink:0 }}>{'🎯'}</span>
          <div style={{ flex:1, fontSize:12, color:'#CC3700', lineHeight:1.5 }}>
            {'Help Jiff get better — '}
            <a href="/profile" style={{ color:'#FF4500', fontWeight:600, textDecoration:'underline' }}>{'update your preferences'}</a>
          </div>
          <button onClick={() => { try { localStorage.setItem('jiff-pref-nudge-dismissed','1'); } catch {} window.location.reload(); }}
            style={{ background:'none', border:'none', cursor:'pointer', fontSize:14, color:'rgba(28,10,0,0.35)', padding:'0 2px', flexShrink:0 }}>{'×'}</button>
        </div>
      )}

      <RetentionNudges
        welcomeBack={welcomeBack} weeklyDigest={weeklyDigest}
        milestone={milestone} didYouCookNudge={didYouCookNudge}
        continuityNudge={continuityNudge}
        weekCookCount={weekCookCount}
        upgradeNudge={upgradeNudge} onDismissUpgrade={onDismissUpgrade}
        onConfirmCooked={onConfirmCooked}
        onNotYet={onNotYet}
        onShowSomethingElse={() => { onShowSomethingElse?.(); loadCards(); }}
        onDismissNudge={onDismissNudge}
        lastFavCuisine={lastFavCuisine}
      />

      {/* Adaptation signal */}
      {adaptMsg && (
        <div style={{ marginTop:8, marginBottom:4, padding:'8px 14px', borderRadius:10, background:'rgba(29,158,117,0.07)', border:'1px solid rgba(29,158,117,0.2)', fontSize:12, color:'#065F46', fontWeight:600, textAlign:'center', animation:'fadeUp 0.2s ease' }}>
          {adaptMsg}
        </div>
      )}

      {/* §4 PRIMARY */}
      {hasSignal && primaryCard ? (
        <PrimaryCard
          animKey={primaryAnimKey}
          emoji={primaryCard.emoji} label={primaryCard.label}
          effortMins={primaryCard.effortMins} why={primaryCard.why}
          contextLabel={primaryCard.contextLabel}
          timePressure={primaryCard.timePressure}
          confidenceLabel={confidenceLabel}
          onCook={() => handleCook(primaryCard, 0)}
          onNotForMe={() => handleNotForMe(primaryCard, 0)}
        />
      ) : (
        <div style={{ marginBottom:14, marginTop:8 }}>
          <button onClick={onSelectFridge}
            style={{ width:'100%', display:'flex', alignItems:'center', gap:14, padding:'20px 18px', borderRadius:18, background:'rgba(255,69,0,0.055)', border:'1.5px solid rgba(255,69,0,0.16)', cursor:'pointer', fontFamily:"'DM Sans',sans-serif", textAlign:'left' }}>
            <span style={{ fontSize:36 }}>🧊</span>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:16, fontWeight:700, color:C.ink, marginBottom:4, fontFamily:"'Fraunces',serif" }}>{"Cook with what I have?"}</div>
              <div style={{ fontSize:12, color:C.muted, fontWeight:300 }}>Tell me what you have — get a meal in 10 seconds</div>
            </div>
            <span style={{ fontSize:20, color:C.jiff }}>{'→'}</span>
          </button>
        </div>
      )}

      {/* §5 ALTERNATES */}
      {alternates.length > 0 && (
        <div style={{ marginBottom:14 }}>
          <SL>{'Or try instead'}</SL>
          {alternates.map((card, i) => (
            <AlternateRow key={card.label + i}
              emoji={card.emoji} label={card.label} effortMins={card.effortMins} why={card.why}
              onSwap={() => handleSwap(card, i + 1)}
              onNotForMe={() => handleNotForMe(card, i + 1)}
            />
          ))}
        </div>
      )}

      {/* §6 CHANGE DIRECTION */}
      <ChangeDirectionRow onOption={handleChangeDirection} />

      {/* §7 CONTEXT TILE — only when NOT the generic fridge fallback */}
      {!featured.isFridge && (
        <ContextTile
          emoji={featured.emoji} label={featured.label} sub={featured.sub}
          color={featured.color} bg={featured.bg} border={featured.border}
          badge={featured.badge} onClick={handleFeatured}
        />
      )}

      {/* §8 CHALLENGE + TRACKER */}
      <ChallengeTracker challenge={challenge} mealHistory={mealHistory} />

      {/* §9 WEEKLY PLANNER */}
      <WeeklyPlanner onGenerateDirect={onGenerateDirect} />

      <Toast message={toast.message} visible={toast.visible} />

      {showMood && (
        <MoodSelector
          onSelect={({ mood, context }) => handleMoodEntry(mood, context)}
          onClose={() => setShowMood(false)}
        />
      )}
      {showOrder && (
        <OrderInSheet city={profile ? (profile.city || '') : ''} onClose={() => setShowOrder(false)} />
      )}
      {showGoal && (
        <GoalSheet
          onSelect={({ id, ...goal }) => { setShowGoal(false); onGenerateDirect && onGenerateDirect({ goal: id, goalContext: goal }); }}
          onClose={() => setShowGoal(false)}
        />
      )}
    </div>
  );
}
