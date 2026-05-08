// src/components/common/JourneyTiles.jsx — v23.40
//
// CONSTITUTION-FIRST rebuild. Previous version had 9 simultaneously rendered sections.
//
// NEW TIER STRUCTURE:
//
//   TIER 1 — DECISION (always visible, above fold)
//     greeting · framing · ONE primary recommendation · ONE CTA
//
//   TIER 2 — GENTLE EXPLORATION (below primary, visible on load)
//     "Try something else" → 2 quiet alternate rows
//     "Cook differently" → collapsed 6-option grid (tap to open)
//
//   TIER 3 — SUPPORT SYSTEMS (only shown when directly relevant)
//     nudge (max 1, reserved slot above Tier 1)
//     context tile (festival/event — only when active and recent)
//
// REMOVED vs previous:
//   ✕ streak badge in §1 (dashboard gamification in decision zone)
//   ✕ week-cook-count badge always visible
//   ✕ weekly goal progress in §1
//   ✕ ChangeDirectionRow always visible (6 tiles competing with recommendation)
//   ✕ ChallengeTracker always rendered below fold
//   ✕ WeeklyPlanner always rendered below fold
//   ✕ ContinuityNudge as standalone (merged into framing text)
//   ✕ "OR TRY INSTEAD" label above alternates (noise)
//   ✕ "BEST MATCH TODAY" chip + contextLabel chip + "SHORT ON TIME?" chip on PrimaryCard
//   ✕ adaptMsg state (edge case that added render noise)

import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import MoodSelector  from './MoodSelector.jsx';
import RetentionNudges from './RetentionNudges.jsx';
import { getUpcomingFestival, getActiveSportsEvent, getDayOfWeekContext } from '../../lib/festival.js';
import { getFeaturedTile } from './journeyTileEngines.js';
import { logFeedback, syncBehaviourToProfile } from '../../services/feedbackService.js';
import { markAsShown, getPersonalisedRecommendations, recommendationToContext, buildJourneyContext } from '../../services/recommendationService.js';
import { trackPrimaryShown, trackRecommendationAccepted, trackRecommendationRejected, trackRecommendationSwapped } from '../../lib/analytics.js';

const F     = "'DM Sans', sans-serif";
const SERIF = "'Fraunces', serif";
const C     = {
  jiff:   '#FF4500', dark: '#CC3700', ink: '#1C0A00',
  muted:  '#7C6A5E', soft: '#B5A49A',
  border: 'rgba(28,10,0,0.07)',
  tint:   'rgba(255,69,0,0.05)',
  tintMid:'rgba(255,69,0,0.09)',
};

// ── Helpers ───────────────────────────────────────────────────────
function greet(profile) {
  const h    = new Date().getHours();
  const name = profile && profile.name ? profile.name.split(' ')[0] : '';
  const base = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  return name ? base + ', ' + name : base;
}

function framingText(mealHistory, weekCookCount, streak) {
  const h = new Date().getHours();
  // Time-of-day base
  const mealCtx = h < 11 ? 'breakfast' : h < 16 ? 'lunch' : h < 19 ? 'snack time' : 'dinner';
  // Cooking streak signal — single line, below greeting
  if ((streak || 0) >= 3) return "You're on a " + streak + "-day streak 🔥 — keep it up.";
  if (weekCookCount >= 4) return 'Great week of cooking. Ready for ' + mealCtx + '?';
  const timeSinceLastCook = (() => {
    if (!Array.isArray(mealHistory) || mealHistory.length === 0) return null;
    const last = new Date(mealHistory[0].generated_at || mealHistory[0].created_at || 0);
    return Math.floor((Date.now() - last.getTime()) / 86400000);
  })();
  if (timeSinceLastCook !== null && timeSinceLastCook >= 3) return "Haven't cooked in a while — something quick tonight?";
  return 'Ready for ' + mealCtx + '?';
}

// ── Toast ─────────────────────────────────────────────────────────
function Toast({ msg, show }) {
  return (
    <div style={{
      position:'fixed', bottom:90, left:'50%',
      transform:'translateX(-50%) translateY(' + (show ? 0 : 16) + 'px)',
      background:'#1C0A00', color:'white', borderRadius:24,
      padding:'9px 22px', fontSize:13, fontWeight:600,
      whiteSpace:'nowrap', opacity:show ? 1 : 0,
      transition:'all 0.2s ease', pointerEvents:'none',
      zIndex:300, fontFamily:F, boxShadow:'0 4px 18px rgba(28,10,0,0.22)',
    }}>{msg}</div>
  );
}

// ── TIER 1: Primary recommendation card ──────────────────────────
// Constitution: ONE decision, ONE CTA, why line, effort only
// Removed: confidence label chip, contextLabel chip, timePressure chip
function PrimaryCard({ emoji, label, effortMins, why, onCook, onNotThis, animKey }) {
  const isQuick = effortMins <= 15;
  const effortText = effortMins <= 15 ? 'Very quick'
    : effortMins <= 25 ? 'Easy'
    : effortMins <= 40 ? 'Moderate'
    : 'Worth the effort';

  return (
    <div key={animKey} style={{ marginBottom:20, animation:'jiffFadeUp 0.2s ease' }}>
      <style>{`@keyframes jiffFadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}`}</style>

      <div style={{
        background: C.tint, border:'1.5px solid rgba(255,69,0,0.14)',
        borderRadius:22, padding:'22px 20px 20px',
        boxShadow:'0 4px 20px rgba(28,10,0,0.06), 0 1px 4px rgba(28,10,0,0.04)',
      }}>
        {/* Meal identity */}
        <div style={{ display:'flex', alignItems:'flex-start', gap:14, marginBottom:14, cursor:'pointer' }} onClick={onCook}>
          <span style={{ fontSize:42, lineHeight:1, flexShrink:0, marginTop:2 }}>{emoji}</span>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontFamily:SERIF, fontSize:22, fontWeight:900, color:C.ink, lineHeight:1.15, marginBottom:8 }}>
              {label}
            </div>
            <div style={{ display:'flex', gap:7, flexWrap:'wrap' }}>
              <span style={{
                fontSize:11, fontWeight:700, padding:'3px 10px', borderRadius:20,
                color:isQuick ? '#1D9E75' : C.jiff,
                background:isQuick ? 'rgba(29,158,117,0.09)' : 'rgba(255,69,0,0.08)',
                border:'1px solid ' + (isQuick ? 'rgba(29,158,117,0.22)' : 'rgba(255,69,0,0.2)'),
              }}>
                {'⏱ '}{effortMins}{' min'}
              </span>
              <span style={{
                fontSize:11, color:C.muted, padding:'3px 10px', borderRadius:20,
                background:'rgba(28,10,0,0.04)', border:'1px solid rgba(28,10,0,0.07)',
              }}>
                {effortText}
              </span>
            </div>
          </div>
        </div>

        {/* Why line — trust signal */}
        {why && why.line1 && (
          <div style={{ borderTop:'1px solid rgba(255,69,0,0.1)', paddingTop:12, marginBottom:14 }}>
            <div style={{ fontSize:12, fontWeight:600, color:C.ink, lineHeight:1.5 }}>
              {'✔ '}{why.line1}
            </div>
            {why.line2 && (
              <div style={{ fontSize:11, color:C.muted, marginTop:3, lineHeight:1.45 }}>
                {why.line2}
              </div>
            )}
          </div>
        )}

        {/* Primary CTA */}
        <button
          onClick={onCook}
          style={{
            width:'100%', padding:'13px 0', borderRadius:13,
            background:C.jiff, color:'white', border:'none',
            fontSize:15, fontWeight:700, fontFamily:F,
            cursor:'pointer', letterSpacing:'0.01em',
            transition:'background 0.12s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = C.dark; }}
          onMouseLeave={e => { e.currentTarget.style.background = C.jiff; }}>
          {'Cook this tonight →'}
        </button>

        {/* "Not this" — visually receded secondary action */}
        <div style={{ textAlign:'center', marginTop:10 }}>
          <button onClick={onNotThis} style={{
            background:'none', border:'none', cursor:'pointer',
            fontSize:11, color:C.soft, fontFamily:F,
            touchAction:'manipulation', padding:'4px 8px',
          }}>
            {'Not tonight — show something else'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── TIER 2a: Alternate row — quiet, receded ───────────────────────
// Constitution: supporting actions visually recede from Tier 1
function AlternateRow({ emoji, label, effortMins, why, onSwap, onDismiss }) {
  const [gone, setGone] = useState(false);
  if (gone) return null;
  return (
    <div style={{
      display:'flex', alignItems:'center', gap:11,
      padding:'8px 11px', background:'rgba(255,250,245,0.7)',
      border:'1px solid rgba(28,10,0,0.06)', borderRadius:11, marginBottom:6,
    }}>
      <span style={{ fontSize:20, flexShrink:0 }}>{emoji}</span>
      <div style={{ flex:1, minWidth:0, cursor:'pointer' }} onClick={onSwap}>
        <div style={{ fontSize:13, fontWeight:600, color:C.ink, lineHeight:1.3 }}>{label}</div>
        <div style={{ fontSize:10, color:C.muted, marginTop:1 }}>
          {effortMins + ' min'}{why && why.line1 ? ' · ' + why.line1 : ''}
        </div>
      </div>
      <button onClick={onSwap} style={{
        padding:'5px 10px', borderRadius:7, border:'1px solid rgba(255,69,0,0.2)',
        background:'rgba(255,69,0,0.04)', color:C.jiff, fontSize:11,
        fontWeight:600, cursor:'pointer', fontFamily:F, whiteSpace:'nowrap',
        touchAction:'manipulation',
      }}>
        {'Try this'}
      </button>
      <button onClick={() => { setGone(true); onDismiss && onDismiss(); }} style={{
        padding:'5px 7px', borderRadius:7, border:'1px solid ' + C.border,
        background:'white', color:C.soft, fontSize:11, cursor:'pointer',
        fontFamily:F, touchAction:'manipulation', lineHeight:1,
      }}>
        {'✕'}
      </button>
    </div>
  );
}

// ── TIER 2b: Change direction — collapsed by default ─────────────
// Constitution: D4 — journey tiles are fallback exploration, not primary
function ChangeDirection({ onOption, open, onToggle }) {
  const opts = [
    { key:'mood',     emoji:'😊', label:'Match my mood'       },
    { key:'fridge',   emoji:'🧊', label:'Cook with what I have'},
    { key:'surprise', emoji:'✨', label:'Surprise me'          },
    { key:'kids',     emoji:'🎒', label:'For the kids'         },
    { key:'leftover', emoji:'♻️', label:'Use leftovers'        },
    { key:'hosting',  emoji:'🎉', label:'Guests coming'        },
  ];
  return (
    <div style={{ marginBottom:16 }}>
      <button
        onClick={onToggle}
        style={{
          width:'100%', display:'flex', alignItems:'center', justifyContent:'center', gap:6,
          padding:'10px 12px', background:'white', border:'1px solid ' + C.border,
          borderRadius:12, cursor:'pointer', fontFamily:F,
          fontSize:12, color:C.muted, fontWeight:400, touchAction:'manipulation',
          transition:'all 0.12s',
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(28,10,0,0.14)'; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; }}>
        <span style={{ display:'inline-block', transform:open?'rotate(180deg)':'none', transition:'transform 0.18s', fontSize:11 }}>▾</span>
        {'Cook something different'}
      </button>

      {open && (
        <div style={{ marginTop:8, display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:7 }}>
          {opts.map(o => (
            <button key={o.key} onClick={() => onOption(o.key)} style={{
              display:'flex', flexDirection:'column', alignItems:'center', gap:4,
              padding:'10px 6px', borderRadius:12, border:'1px solid ' + C.border,
              background:'white', cursor:'pointer', fontFamily:F, touchAction:'manipulation',
              transition:'all 0.12s',
            }}
              onMouseEnter={e => { e.currentTarget.style.background='rgba(28,10,0,0.025)'; }}
              onMouseLeave={e => { e.currentTarget.style.background='white'; }}>
              <span style={{ fontSize:17 }}>{o.emoji}</span>
              <span style={{ fontSize:10, fontWeight:600, color:C.muted, textAlign:'center', lineHeight:1.3 }}>{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── TIER 3: Context tile — only when actively relevant ────────────
// Constitution: shown only when a festival/event is within its active window
function ContextTile({ tile, onClick }) {
  if (!tile || tile.isFridge) return null; // Constitution: never show generic fallback
  return (
    <button onClick={onClick} style={{
      width:'100%', display:'flex', alignItems:'center', gap:14,
      padding:'13px 15px', marginBottom:14,
      background: tile.bg || 'rgba(255,69,0,0.05)',
      border:'1.5px solid ' + (tile.border || 'rgba(255,69,0,0.15)'),
      borderRadius:15, cursor:'pointer', fontFamily:F, textAlign:'left',
      transition:'all 0.13s',
    }}
      onMouseEnter={e => { e.currentTarget.style.opacity='0.88'; }}
      onMouseLeave={e => { e.currentTarget.style.opacity='1'; }}>
      <span style={{ fontSize:26, flexShrink:0 }}>{tile.emoji}</span>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:13, fontWeight:700, color:tile.color || C.ink, marginBottom:2 }}>{tile.label}</div>
        {tile.sub && <div style={{ fontSize:11, color:C.muted, fontWeight:300, lineHeight:1.4 }}>{tile.sub}</div>}
      </div>
      <span style={{ fontSize:14, color:tile.color || C.jiff, flexShrink:0 }}>{'→'}</span>
    </button>
  );
}

// ── Main ──────────────────────────────────────────────────────────
export function JourneyTiles({
  profile, season, streak, country,
  ratings, mealHistory,
  didYouCookNudge, weeklyDigest, welcomeBack, challenge, milestone,
  upgradeNudge, onDismissUpgrade,
  onConfirmCooked, onDismissNudge,
  onSelectFridge, onGenerateDirect,
  user,
  isLoadingRecommendation = false,
  loadingSource = 'default',
  loadingMessage = '',
  navJourneyCtx = null,
  continuityNudge = null,
  weekCookCount   = 0,
  showPrefNudge   = false,
  onNotYet,
  onShowSomethingElse,
  profileLoaded = false,
}) {
  const navigate = useNavigate();
  const [showMood,      setShowMood]      = useState(false);
  const [dirOpen,       setDirOpen]       = useState(false);
  const [cards,         setCards]         = useState(null);
  const [animKey,       setAnimKey]       = useState(0);
  const [toast,         setToast]         = useState({ show:false, msg:'' });
  const [showAlternates,setShowAlternates]= useState(false); // revealed after first 'Not this'
  const feedbackRef  = useRef(0);
  const shownRef     = useRef(false);

  const festival = getUpcomingFestival(profile);
  const sports   = getActiveSportsEvent();
  const dayCtx   = getDayOfWeekContext();
  const lastFav  = (() => {
    if (!Array.isArray(mealHistory)) return null;
    const hit = [...mealHistory]
      .sort((a,b) => new Date(b.generated_at||0) - new Date(a.generated_at||0))
      .find(h => h.cuisine && ratings && ratings[h.meal_name] >= 4);
    return hit ? hit.cuisine || null : null;
  })();
  const isReturning = !!(welcomeBack && welcomeBack.daysAway >= 3);
  const featured    = getFeaturedTile({ festival, sports, weather:null, dayCtx, profile, isReturning, lastFavCuisine:lastFav });

  // ── Recommendation loading ──────────────────────────────────────
  const loadCards = useCallback((journeyCtx) => {
    const jCtx = journeyCtx || buildJourneyContext({ journeyType:'default', profile, mealHistory });
    const recs  = getPersonalisedRecommendations({ profile, ratings, mealHistory, journeyContext: jCtx });
    const mapped = recs.map(rec => ({
      meal:       rec.meal,
      emoji:      rec.meal.emoji,
      label:      rec.meal.name,
      cuisine:    rec.meal.cuisine,
      effortMins: rec.meal.effortMins,
      tags:       rec.meal.tags,
      why:        rec.why,
      role:       rec.role,
      score:      rec.score,
      context:    recommendationToContext(rec),
    }));
    setCards(mapped);
    setAnimKey(k => k + 1);
    shownRef.current = false;
    return mapped;
  }, [profile, ratings, mealHistory]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const mapped = loadCards(navJourneyCtx || null);
    if (mapped.length > 0) markAsShown(mapped.map(c => c.label));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (profileLoaded) loadCards(null);
  }, [profileLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!cards) return;
    const primary = cards.find(c => c.role === 'primary');
    if (primary && !shownRef.current) {
      shownRef.current = true;
      trackPrimaryShown({ mealId: primary.meal?.id || primary.label, mealName: primary.label, cuisine: primary.cuisine, score: primary.score });
    }
  }, [cards]);

  // ── Interactions ────────────────────────────────────────────────
  const syncBehavior = () => {
    feedbackRef.current += 1;
    if (feedbackRef.current >= 5 && user && user.id) {
      feedbackRef.current = 0;
      syncBehaviourToProfile(user.id);
    }
  };

  const showToast = (msg) => {
    setToast({ show:true, msg });
    setTimeout(() => setToast({ show:false, msg }), 2200);
  };

  const toastMsg = (card) => {
    const s = (streak || 0) + 1;
    if (card.effortMins <= 15 && (card.tags||[]).includes('healthy')) return 'Quick and healthy — nice 👍';
    if (s >= 2) return "You're on a " + s + '-day streak 🔥';
    return "Nice — I'll keep this in mind 👍";
  };

  const handleCook = (card, pos) => {
    logFeedback({ meal:card.meal, action:pos === 0 ? 'accepted' : 'swapped', userId:user?.id||null, position:pos });
    syncBehavior();
    (pos === 0 ? trackRecommendationAccepted : trackRecommendationSwapped)({
      mealId:card.meal?.id||card.label, mealName:card.label, cuisine:card.cuisine, position:pos,
    });
    showToast(toastMsg(card));
    onGenerateDirect && onGenerateDirect(card.context);
  };

  const handleNotThis = (card, pos) => {
    logFeedback({ meal:card.meal, action:'rejected', userId:user?.id||null, position:pos });
    syncBehavior();
    trackRecommendationRejected({ mealId:card.meal?.id||card.label, mealName:card.label, cuisine:card.cuisine, position:pos });
    setShowAlternates(true); // first rejection reveals alternates + change-direction
    const newCards = loadCards();
    markAsShown(newCards.map(c => c.label));
  };

  const handleSwap = (alt, pos) => {
    const primary = cards && cards.find(c => c.role === 'primary');
    if (primary) {
      logFeedback({ meal:primary.meal, action:'swapped', userId:user?.id||null, position:0 });
      trackRecommendationSwapped({ mealId:primary.meal?.id||primary.label, mealName:primary.label, cuisine:primary.cuisine, position:0 });
    }
    handleCook(alt, pos);
  };

  const handleDirection = (key) => {
    setDirOpen(false);
    switch (key) {
      case 'mood':     setShowMood(true);  return;
      case 'fridge':   onSelectFridge && onSelectFridge(); return;
      case 'surprise': onGenerateDirect && onGenerateDirect({ surpriseMode:true }); return;
      case 'kids':     onGenerateDirect && onGenerateDirect({ mealType:'lunch', kidsMode:true, explore:true }); return;
      case 'leftover': onGenerateDirect && onGenerateDirect({ mealType:'dinner', leftoverMode:true, explore:true }); return;
      case 'hosting':  onGenerateDirect && onGenerateDirect({ hosting:true, servings:8, mealType:'dinner' }); return;
      default:         loadCards(buildJourneyContext({ journeyType:'default', profile, mealHistory }));
    }
  };

  const handleFeatured = () => {
    if (featured.navTo) { navigate(featured.navTo); return; }
    if (featured.context) onGenerateDirect && onGenerateDirect(featured.context);
  };

  // ── Derived ─────────────────────────────────────────────────────
  const primary    = cards ? cards.find(c => c.role === 'primary') : null;
  const alternates = cards ? cards.filter(c => c.role === 'alternate') : [];
  const hasSignal  = !!(profile && ((profile.preferred_cuisines||[]).length || profile.food_type || profile.active_goal))
    || (ratings && Object.keys(ratings).length > 0);

  // ── Skeleton — shown for the one frame before cards load ────────
  if (!cards) return (
    <div style={{ maxWidth:600, margin:'0 auto', padding:'20px 16px 80px', fontFamily:F }}>
      <div style={{ height:26, width:180, background:'rgba(28,10,0,0.06)', borderRadius:8, marginBottom:10 }} />
      <div style={{ height:12, width:140, background:'rgba(28,10,0,0.04)', borderRadius:6, marginBottom:20 }} />
      <div style={{ height:220, background:'rgba(28,10,0,0.04)', borderRadius:20 }} />
    </div>
  );

  return (
    <div style={{ maxWidth:600, margin:'0 auto', padding:'20px 16px 80px', fontFamily:F }}>

      {/* TIER 3: Nudge slot — max 1, reserved, above greeting */}
      {/* Preference nudge */}
      {showPrefNudge && (
        <div style={{
          marginBottom:12, padding:'9px 13px', borderRadius:11,
          background:'rgba(255,69,0,0.05)', border:'1px solid rgba(255,69,0,0.18)',
          display:'flex', alignItems:'center', gap:10,
        }}>
          <span style={{ fontSize:15, flexShrink:0 }}>🎯</span>
          <div style={{ flex:1, fontSize:12, color:'#CC3700', lineHeight:1.5 }}>
            {'Help Jiff know you better — '}
            <a href="/profile" style={{ color:'#FF4500', fontWeight:600 }}>update your preferences</a>
          </div>
          <button
            onClick={() => { try { localStorage.setItem('jiff-pref-nudge-dismissed','1'); } catch {} window.location.reload(); }}
            style={{ background:'none', border:'none', cursor:'pointer', fontSize:14, color:'rgba(28,10,0,0.3)', padding:'0 2px', flexShrink:0 }}>
            {'×'}
          </button>
        </div>
      )}

      {/* Retention nudge — max 1 per session, reserved slot */}
      {!showPrefNudge && (
        <RetentionNudges
          welcomeBack={welcomeBack} weeklyDigest={weeklyDigest}
          milestone={milestone} didYouCookNudge={didYouCookNudge}
          continuityNudge={continuityNudge}
          upgradeNudge={upgradeNudge} onDismissUpgrade={onDismissUpgrade}
          onConfirmCooked={onConfirmCooked}
          onNotYet={onNotYet}
          onShowSomethingElse={() => { onShowSomethingElse?.(); loadCards(); }}
          onDismissNudge={onDismissNudge}
          lastFavCuisine={lastFav}
        />
      )}

      {/* TIER 1: Greeting — calm, single line, no badges competing */}
      <div style={{ marginBottom:18 }}>
        <h2 style={{
          fontFamily:SERIF, fontSize:'clamp(18px,5vw,22px)', fontWeight:900,
          color:C.ink, margin:'0 0 4px', lineHeight:1.2,
        }}>
          {greet(profile)}
        </h2>
        <div style={{ fontSize:13, color:C.muted, fontWeight:300 }}>
          {framingText(mealHistory, weekCookCount, streak)}
        </div>
      </div>

      {/* TIER 1: Primary recommendation */}
      {/* Inline loading state: calm skeleton overlays the primary slot */}
      {isLoadingRecommendation ? (
        <div style={{ marginBottom:20, animation:'jiffFadeUp 0.2s ease' }}>
          <div style={{
            background:'rgba(255,69,0,0.04)', border:'1.5px solid rgba(255,69,0,0.1)',
            borderRadius:20, padding:'20px 18px',
          }}>
            {/* Pulsing skeleton content */}
            <style>{`@keyframes jiffSkel{0%,100%{opacity:.4}50%{opacity:.8}}`}</style>
            <div style={{ display:'flex', gap:14, marginBottom:16 }}>
              <div style={{ width:46, height:46, borderRadius:'50%', background:'rgba(255,69,0,0.12)', animation:'jiffSkel 1.2s ease infinite' }}/>
              <div style={{ flex:1 }}>
                <div style={{ height:20, borderRadius:6, background:'rgba(28,10,0,0.08)', marginBottom:8, animation:'jiffSkel 1.2s ease infinite' }}/>
                <div style={{ height:11, borderRadius:6, background:'rgba(28,10,0,0.05)', width:'60%', animation:'jiffSkel 1.2s ease infinite 0.2s' }}/>
              </div>
            </div>
            <div style={{ height:13, borderRadius:6, background:'rgba(28,10,0,0.05)', marginBottom:14, animation:'jiffSkel 1.2s ease infinite 0.1s' }}/>
            <div style={{ height:46, borderRadius:13, background:'rgba(255,69,0,0.15)', animation:'jiffSkel 1.2s ease infinite 0.15s' }}/>
            <div style={{ textAlign:'center', marginTop:10, fontSize:12, color:'rgba(28,10,0,0.35)', fontFamily:F }}>
              {loadingMessage || 'Putting together your recommendation…'}
            </div>
          </div>
        </div>
      ) : primary ? (
        <PrimaryCard
          animKey={animKey}
          emoji={primary.emoji}
          label={primary.label}
          effortMins={primary.effortMins}
          why={primary.why}
          onCook={() => handleCook(primary, 0)}
          onNotThis={() => handleNotThis(primary, 0)}
        />
      ) : (
        // No-profile fallback — Constitution: still one CTA, decisive
        <div style={{ marginBottom:20 }}>
          <button onClick={onSelectFridge} style={{
            width:'100%', display:'flex', alignItems:'center', gap:14,
            padding:'20px 18px', borderRadius:20,
            background:C.tint, border:'1.5px solid rgba(255,69,0,0.15)',
            cursor:'pointer', fontFamily:F, textAlign:'left', transition:'all 0.13s',
          }}>
            <span style={{ fontSize:36 }}>🧊</span>
            <div style={{ flex:1 }}>
              <div style={{ fontFamily:SERIF, fontSize:17, fontWeight:700, color:C.ink, marginBottom:4 }}>
                Cook with what I have
              </div>
              <div style={{ fontSize:12, color:C.muted, fontWeight:300 }}>
                Tell me what you have — get a meal in seconds
              </div>
            </div>
            <span style={{ fontSize:16, color:C.jiff }}>→</span>
          </button>
        </div>
      )}

      {/* Explore hint — quiet, only before first rejection */}
      {!showAlternates && (
        <div style={{ textAlign:'center', marginBottom:12 }}>
          <button onClick={() => setShowAlternates(true)} style={{
            background:'none', border:'none', cursor:'pointer',
            fontSize:11, color:'rgba(124,106,94,0.55)', fontFamily:"'DM Sans',sans-serif",
            touchAction:'manipulation', padding:'2px 8px', letterSpacing:'0.01em',
          }}>{'or explore other options'}</button>
        </div>
      )}

      {/* TIER 2a: Alternates — revealed after first rejection (Constitution D2) */}
      {showAlternates && alternates.length > 0 && (
        <div style={{ marginBottom:16 }}>
          {alternates.map((card, i) => (
            <AlternateRow
              key={card.label + i}
              emoji={card.emoji}
              label={card.label}
              effortMins={card.effortMins}
              why={card.why}
              onSwap={() => handleSwap(card, i + 1)}
              onDismiss={() => handleNotThis(card, i + 1)}
            />
          ))}
        </div>
      )}

      {/* TIER 2b: Change direction — collapsed, only after first rejection */}
      {showAlternates && <ChangeDirection
        open={dirOpen}
        onToggle={() => setDirOpen(v => !v)}
        onOption={handleDirection}
      />}

      {/* TIER 3: Context tile — only when festival/event is active */}
      <ContextTile tile={featured} onClick={handleFeatured} />

      <Toast msg={toast.msg} show={toast.show} />

      {showMood && (
        <MoodSelector
          onSelect={({ mood, context }) => {
            setShowMood(false);
            if (mood) {
              const jCtx = buildJourneyContext({ journeyType:'mood', mood:mood.id, profile, mealHistory });
              loadCards(jCtx);
            }
            onGenerateDirect && onGenerateDirect({ mood:mood?.id, moodContext:context, explore:true });
          }}
          onClose={() => setShowMood(false)}
        />
      )}
    </div>
  );
}
