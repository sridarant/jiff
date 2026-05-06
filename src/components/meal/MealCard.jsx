// src/components/meal/MealCard.jsx — v23.25
//
// REDESIGN PRINCIPLES:
//   1. Action-first: CTA always visible, no expand required
//   2. Progressive: collapsed shows name+meta+CTA only
//   3. Interactive ingredients: Have / Need toggle per item (post-selection)
//   4. Low-scroll: first 5 ingredients shown, method hidden until tapped
//   5. Single layout: same structure on web and mobile (max-width 600px centered)
//   6. No duplication: one share popup, one scale selector, one CTA
//
// STRUCTURE (collapsed):
//   ┌──────────────────────────────────┐
//   │ emoji  MEAL NAME          ♥      │  ← header
//   │ ⏱ 30 min  🌿 veg  ⭐⭐⭐☆☆     │  ← meta (stripped down)
//   │ [ 🔥 Cook this → ]               │  ← CTA always visible
//   │ ▾ See ingredients & steps        │  ← expand toggle
//   └──────────────────────────────────┘
//
// STRUCTURE (expanded):
//   ┌──────────────────────────────────┐
//   │ [header as above]                │
//   │ [ 🔥 Cook this → ]               │
//   │ Video (if exists, tap to load)   │
//   │ ── Ingredients ──────────────────│
//   │  [✓] Salt    [✓] Oil             │  ← Have/Need toggles
//   │  [?] Paneer  [?] Cream           │
//   │  Missing 2 items → Order         │
//   │ ── Method ──────── (collapsible) │
//   │  Step 1 · Step 2 ·  View all ↓  │
//   │ ── Footer ───────────────────────│
//   │  Share          Serves: 2 3 4   │
//   └──────────────────────────────────┘

import { useState, useRef, memo } from 'react';
import { useLocale }        from '../../contexts/LocaleContext.jsx';
import { scaleIngredient, scaleNutrition } from '../../lib/scaling.js';
import { buildShareText }   from '../../lib/sharing.js';
import { StepWithTimer }    from './StepTimer.jsx';
import { VideoButton }      from './VideoButton.jsx';

const C = {
  jiff:'#FF4500', ember:'#CC3700', ink:'#1C0A00', cream:'#FFFAF5',
  muted:'#7C6A5E', green:'#1D9E75', border:'rgba(28,10,0,0.08)',
  haveGreen:'rgba(29,158,117,0.08)', needAmber:'rgba(217,119,6,0.08)',
};

// Default staples — pre-marked as "have" in ingredient check
const DEFAULT_STAPLES = ['salt','oil','water','turmeric','cumin','onion','garlic','ginger','sugar','ghee','atta','rice','dal'];

const STEPS_PREVIEW = 2;

// ── Icons ──────────────────────────────────────────────────────────
const IconHeart = ({ filled }) => (
  <svg viewBox="0 0 24 24" fill={filled ? '#E53E3E' : 'none'} stroke={filled ? '#E53E3E' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width:18, height:18 }}>
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
  </svg>
);
const IconShare = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width:14, height:14 }}>
    <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
  </svg>
);
const IconCopy = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width:14, height:14 }}>
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>
);

// ── EmbeddedVideo — tap to load thumbnail, avoids autoload ────────
function EmbeddedVideo({ videoId, title }) {
  const [loaded, setLoaded] = useState(false);
  if (!videoId) return null;
  return (
    <div style={{ borderRadius:10, overflow:'hidden', background:'#111', position:'relative', aspectRatio:'16/9', width:'100%', marginBottom:4 }}>
      {loaded ? (
        <iframe
          src={'https://www.youtube.com/embed/' + videoId + '?autoplay=1&rel=0&modestbranding=1'}
          title={title || 'Recipe video'}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          style={{ width:'100%', height:'100%', border:'none', display:'block' }}
        />
      ) : (
        <button onClick={() => setLoaded(true)}
          aria-label="Watch recipe video"
          style={{ width:'100%', height:'100%', border:'none', background:'transparent', cursor:'pointer', position:'absolute', inset:0 }}>
          <img
            src={'https://img.youtube.com/vi/' + videoId + '/mqdefault.jpg'}
            alt={title || 'Recipe video'}
            style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover' }}
          />
          <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.25)', display:'flex', alignItems:'center', justifyContent:'center', gap:10 }}>
            <div style={{ width:48, height:48, borderRadius:'50%', background:'rgba(220,0,0,0.92)', display:'flex', alignItems:'center', justifyContent:'center' }}>
              <svg viewBox="0 0 24 24" fill="white" style={{ width:20, height:20, marginLeft:3 }}><polygon points="5 3 19 12 5 21 5 3"/></svg>
            </div>
            <div style={{ fontSize:12, color:'white', background:'rgba(0,0,0,0.5)', padding:'4px 12px', borderRadius:20, backdropFilter:'blur(4px)', fontFamily:"'DM Sans',sans-serif" }}>
              {'Watch recipe'}
            </div>
          </div>
        </button>
      )}
    </div>
  );
}

// ── Star rating ────────────────────────────────────────────────────
function StarRating({ value, onChange }) {
  const [hov, setHov] = useState(0);
  return (
    <div style={{ display:'flex', gap:1 }}>
      {[1,2,3,4,5].map(n => (
        <button key={n} onClick={() => onChange?.(n)}
          onMouseEnter={() => setHov(n)} onMouseLeave={() => setHov(0)}
          style={{ background:'none', border:'none', cursor:'pointer', padding:0, fontSize:13, lineHeight:1 }}>
          {(hov || value) >= n ? '⭐' : '☆'}
        </button>
      ))}
    </div>
  );
}

// ── Scale selector ─────────────────────────────────────────────────
function ScaleSelector({ servings, baseServings, onChange }) {
  const opts = [1,2,3,4,6,8].filter(n => n !== baseServings);
  opts.unshift(baseServings);
  return (
    <div style={{ display:'flex', gap:4, alignItems:'center' }}>
      <span style={{ fontSize:11, color:C.muted, marginRight:2 }}>{'Serves'}</span>
      {opts.slice(0, 5).map(n => (
        <button key={n} onClick={() => onChange(n)}
          style={{ width:26, height:26, borderRadius:'50%', border:'none', background:servings===n?C.jiff:'rgba(28,10,0,0.06)', color:servings===n?'white':C.ink, fontSize:11, fontWeight:servings===n?600:400, cursor:'pointer', fontFamily:"'DM Sans',sans-serif", touchAction:'manipulation' }}>
          {n}
        </button>
      ))}
    </div>
  );
}

// ── CTA button ────────────────────────────────────────────────────
function CookCTA({ onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8, width:'100%', padding:'13px', borderRadius:12, background:hov?C.ember:C.jiff, color:'white', border:'none', fontSize:15, fontWeight:700, cursor:'pointer', fontFamily:"'DM Sans',sans-serif", transition:'background 0.12s', touchAction:'manipulation' }}>
      {'🔥 Cook this →'}
    </button>
  );
}

// ── Share popup ────────────────────────────────────────────────────
function SharePopup({ show, onClose, onCopy, copied, onWhatsApp }) {
  if (!show) return null;
  return (
    <>
      <div onClick={onClose} style={{ position:'fixed', inset:0, zIndex:100 }}/>
      <div style={{ position:'absolute', bottom:'calc(100% + 6px)', left:0, background:'white', border:'1px solid '+C.border, borderRadius:12, padding:'6px', zIndex:101, minWidth:140, boxShadow:'0 8px 24px rgba(28,10,0,0.1)' }}>
        <button onClick={onCopy} style={{ display:'flex', alignItems:'center', gap:8, width:'100%', padding:'8px 10px', border:'none', background:'none', fontSize:12, color:C.ink, cursor:'pointer', borderRadius:8, fontFamily:"'DM Sans',sans-serif" }}>
          <IconCopy /> {copied ? '✓ Copied!' : 'Copy recipe'}
        </button>
        <button onClick={onWhatsApp} style={{ display:'flex', alignItems:'center', gap:8, width:'100%', padding:'8px 10px', border:'none', background:'none', fontSize:12, color:'#25D366', cursor:'pointer', borderRadius:8, fontFamily:"'DM Sans',sans-serif" }}>
          <span style={{ fontSize:14 }}>{'📱'}</span> {'WhatsApp'}
        </button>
      </div>
    </>
  );
}

// ── Focus step fullscreen ──────────────────────────────────────────
function FocusStep({ step, stepNum, total, onClose }) {
  return (
    <div style={{ position:'fixed', inset:0, zIndex:9500, background:'#1C0A00', display:'flex', flexDirection:'column', fontFamily:"'DM Sans',sans-serif" }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'20px 24px' }}>
        <div style={{ fontSize:12, color:'rgba(255,255,255,0.45)' }}>{'Step '}{stepNum}{' of '}{total}</div>
        <button onClick={onClose} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.6)', fontSize:24, cursor:'pointer', lineHeight:1 }}>{'✕'}</button>
      </div>
      <div style={{ flex:1, display:'flex', alignItems:'center', padding:'0 32px' }}>
        <div style={{ fontSize:'clamp(18px,4vw,26px)', color:'white', lineHeight:1.65, fontWeight:300 }}>
          {step.instruction || step}
        </div>
      </div>
    </div>
  );
}

// ── Interactive ingredient row: Have / Need toggle ─────────────────
function IngredientRow({ text, defaultHave }) {
  const [have, setHave] = useState(defaultHave);
  return (
    <div
      onClick={() => setHave(v => !v)}
      style={{ display:'flex', alignItems:'center', gap:10, padding:'7px 0', borderBottom:'1px solid rgba(28,10,0,0.04)', cursor:'pointer', userSelect:'none' }}>
      {/* Toggle indicator */}
      <div style={{
        width:20, height:20, borderRadius:'50%', flexShrink:0,
        background: have ? C.haveGreen : C.needAmber,
        border: '1.5px solid ' + (have ? C.green : '#D97706'),
        display:'flex', alignItems:'center', justifyContent:'center',
        fontSize:10, fontWeight:700,
        color: have ? C.green : '#D97706',
        transition:'all 0.12s',
      }}>
        {have ? '✓' : '?'}
      </div>
      <span style={{ fontSize:13, color: have ? C.ink : '#92400E', lineHeight:1.4, flex:1 }}>
        {text}
      </span>
    </div>
  );
}

// ── Main MealCard ──────────────────────────────────────────────────
const MealCardInner = function MealCard({
  meal, isFav, onToggleFav,
  rating, onRate,
  pantry = [], lang = 'en',
}) {
  const { units } = useLocale();

  const [expanded,     setExpanded]     = useState(false);
  const [methodOpen,   setMethodOpen]   = useState(false);
  const [showAllSteps, setShowAllSteps] = useState(false);
  const [servings,     setServings]     = useState(meal?.servings || 2);
  const [showShare,    setShowShare]    = useState(false);
  const [copied,       setCopied]       = useState(false);
  const [focusStep,    setFocusStep]    = useState(null);
  const cardRef = useRef(null);

  if (!meal) return null;

  const baseServings = meal.servings || 2;
  const scale        = servings / baseServings;
  const steps        = meal.method || meal.steps || [];
  const ingredients  = meal.ingredients || [];
  const visibleSteps = showAllSteps ? steps : steps.slice(0, STEPS_PREVIEW);

  // Determine default have/need for each ingredient
  const staples     = new Set([
    ...DEFAULT_STAPLES,
    ...(pantry || []).map(p => (p || '').toLowerCase().trim()),
  ]);
  function isStaple(ing) {
    const name = (typeof ing === 'string' ? ing : ing.name || ing.item || '').toLowerCase();
    return name && staples.has(name.split(' ')[0]) || staples.has(name);
  }

  // Missing = items user will likely need (non-staples)
  const missingCount = ingredients.filter(ing => !isStaple(ing)).length;

  const handleCookThis = () => {
    setExpanded(true);
    setTimeout(() => cardRef.current?.scrollIntoView({ behavior:'smooth', block:'start' }), 80);
  };

  const handleCopy = () => {
    navigator.clipboard?.writeText(buildShareText(meal, lang)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <>
      <div ref={cardRef} style={{
        background:   'white',
        border:       '1px solid ' + C.border,
        borderRadius: 16,
        overflow:     'hidden',
        fontFamily:   "'DM Sans', sans-serif",
        marginBottom: 14,
        maxWidth:     600,
        width:        '100%',
        boxSizing:    'border-box',
        marginLeft:   'auto',
        marginRight:  'auto',
      }}>

        {/* ── SECTION 1: HEADER (always visible) ── */}
        <div style={{ padding:'14px 14px 12px' }}>
          {/* Name + fav */}
          <div style={{ display:'flex', alignItems:'flex-start', gap:10, marginBottom:8 }}>
            <span style={{ fontSize:22, flexShrink:0, marginTop:1 }}>{meal.emoji || '🍽️'}</span>
            <span style={{ fontFamily:"'Fraunces',serif", fontSize:18, fontWeight:700, color:C.ink, lineHeight:1.25, flex:1 }}>
              {meal.name}
            </span>
            <button
              onClick={e => { e.stopPropagation(); onToggleFav?.(meal); }}
              style={{ background:'none', border:'none', cursor:'pointer', padding:4, flexShrink:0, touchAction:'manipulation' }}>
              <IconHeart filled={isFav} />
            </button>
          </div>

          {/* Meta — minimal: time + diet + rating only */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
            <div style={{ fontSize:11, color:C.muted, display:'flex', gap:10 }}>
              {meal.time && <span>{'⏱ '}{meal.time}</span>}
              {meal.diet && meal.diet !== 'any' && <span style={{ color:C.green }}>{'🌿 '}{meal.diet}</span>}
              {steps.length > 0 && <span>{steps.length}{' steps'}</span>}
            </div>
            <StarRating value={rating || 0} onChange={r => onRate?.(r)} />
          </div>

          {/* CTA — always visible */}
          <CookCTA onClick={handleCookThis} />
        </div>

        {/* ── EXPAND TOGGLE ── */}
        <button
          onClick={() => setExpanded(v => !v)}
          style={{ width:'100%', padding:'6px 14px 9px', background:'none', border:'none', borderTop:'1px solid '+C.border, cursor:'pointer', fontSize:11, color:C.muted, display:'flex', alignItems:'center', gap:5, fontFamily:"'DM Sans',sans-serif", touchAction:'manipulation' }}>
          <span style={{ display:'inline-block', transform:expanded?'rotate(180deg)':'none', transition:'transform 0.18s', fontSize:13 }}>{'▾'}</span>
          <span>{expanded ? 'Hide recipe' : 'See ingredients & steps'}</span>
          {!expanded && missingCount > 0 && (
            <span style={{ marginLeft:'auto', fontSize:10, color:'#D97706', fontWeight:500 }}>
              {'~'}{missingCount}{' items to get'}
            </span>
          )}
        </button>

        {/* ── EXPANDED CONTENT ── */}
        {expanded && (
          <div style={{ padding:'0 14px 14px' }}>

            {/* Video — tap to load */}
            {meal.videoId
              ? <EmbeddedVideo videoId={meal.videoId} title={meal.videoTitle} />
              : <VideoButton recipeName={meal.name} compact />
            }

            {/* ── INGREDIENTS with Have/Need toggles ── */}
            <div style={{ marginTop:12, marginBottom:4 }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                <div style={{ fontSize:12, fontWeight:700, color:C.ink }}>
                  {'Ingredients'}
                  <span style={{ fontWeight:400, color:C.muted, marginLeft:6, fontSize:10 }}>{'('}{ingredients.length}{')'}</span>
                </div>
                <div style={{ display:'flex', gap:10, fontSize:10, color:C.muted }}>
                  <span style={{ color:C.green }}>{'✓ have'}</span>
                  <span style={{ color:'#D97706' }}>{'? need'}</span>
                </div>
              </div>

              {ingredients.map((ing, i) => (
                <IngredientRow
                  key={i}
                  text={scaleIngredient(ing, scale, units)}
                  defaultHave={isStaple(ing)}
                />
              ))}

              {/* Missing items CTA */}
              {missingCount > 0 && (
                <div style={{ marginTop:10, padding:'8px 12px', background:C.needAmber, border:'1px solid rgba(217,119,6,0.22)', borderRadius:8, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                  <span style={{ fontSize:12, color:'#92400E' }}>
                    {'~'}{missingCount}{' ingredient'}{missingCount !== 1 ? 's' : ''}{' to grab'}
                  </span>
                  <button
                    onClick={() => window.open('https://blinkit.com', '_blank', 'noopener')}
                    style={{ fontSize:11, fontWeight:600, color:'#FF4500', background:'white', border:'1px solid rgba(255,69,0,0.2)', borderRadius:6, padding:'4px 10px', cursor:'pointer', fontFamily:"'DM Sans',sans-serif", touchAction:'manipulation' }}>
                    {'Order now →'}
                  </button>
                </div>
              )}

              {/* Nutrition */}
              {meal.nutrition && (
                <div style={{ marginTop:10, padding:'6px 10px', background:'rgba(29,158,117,0.05)', borderRadius:8, fontSize:11, color:C.green }}>
                  {(() => { const n = scaleNutrition(meal.nutrition, scale); return '~' + n.calories + ' kcal · ' + n.protein + 'g protein'; })()}
                </div>
              )}
            </div>

            {/* ── METHOD — collapsible ── */}
            {steps.length > 0 && (
              <>
                <button
                  onClick={() => setMethodOpen(v => !v)}
                  style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 0', background:'none', border:'none', borderTop:'1px solid '+C.border, cursor:'pointer', fontFamily:"'DM Sans',sans-serif", marginTop:8, touchAction:'manipulation' }}>
                  <span style={{ fontSize:12, fontWeight:700, color:C.ink }}>
                    {'Method'}
                    <span style={{ fontWeight:400, color:C.muted, marginLeft:6, fontSize:10 }}>{'('}{steps.length}{' steps)'}</span>
                  </span>
                  <span style={{ fontSize:13, color:C.muted, transform:methodOpen?'rotate(180deg)':'none', display:'inline-block', transition:'transform 0.18s' }}>{'▾'}</span>
                </button>

                {methodOpen && (
                  <div style={{ paddingTop:8 }}>
                    {visibleSteps.map((step, i) => (
                      <div key={i} style={{ marginBottom:12 }}>
                        <div style={{ fontSize:10, fontWeight:600, color:C.muted, marginBottom:3 }}>
                          {'Step '}{i + 1}
                        </div>
                        <StepWithTimer
                          text={typeof step === 'string' ? step : (step?.instruction || step?.text || String(step))}
                          index={i}
                        />
                        <button
                          onClick={() => setFocusStep({ step, num: i + 1 })}
                          style={{ marginTop:4, fontSize:10, color:C.muted, background:'none', border:'1px solid rgba(28,10,0,0.08)', borderRadius:6, padding:'2px 8px', cursor:'pointer', fontFamily:"'DM Sans',sans-serif" }}>
                          {'Focus →'}
                        </button>
                      </div>
                    ))}
                    {!showAllSteps && steps.length > STEPS_PREVIEW && (
                      <button
                        onClick={() => setShowAllSteps(true)}
                        style={{ background:'none', border:'none', cursor:'pointer', fontSize:12, color:C.jiff, fontFamily:"'DM Sans',sans-serif", fontWeight:600, padding:'4px 0' }}>
                        {'View all '}{steps.length}{' steps ↓'}
                      </button>
                    )}
                  </div>
                )}
              </>
            )}

            {/* ── FOOTER: share + scale ── */}
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:14, paddingTop:12, borderTop:'1px solid '+C.border }}>
              <div style={{ position:'relative' }}>
                <button
                  onClick={() => setShowShare(s => !s)}
                  style={{ display:'flex', alignItems:'center', gap:5, background:'none', border:'1px solid '+C.border, borderRadius:8, padding:'6px 12px', fontSize:12, color:C.ink, cursor:'pointer', fontFamily:"'DM Sans',sans-serif" }}>
                  <IconShare /> {'Share'}
                </button>
                <SharePopup
                  show={showShare}
                  onClose={() => setShowShare(false)}
                  onCopy={handleCopy}
                  copied={copied}
                  onWhatsApp={() => window.open('https://api.whatsapp.com/send?text=' + encodeURIComponent(buildShareText(meal, lang)), '_blank')}
                />
              </div>
              <ScaleSelector servings={servings} baseServings={baseServings} onChange={setServings} />
            </div>
          </div>
        )}
      </div>

      {focusStep && (
        <FocusStep step={focusStep.step} stepNum={focusStep.num} total={steps.length} onClose={() => setFocusStep(null)} />
      )}
    </>
  );
};

export const MealCard = memo(MealCardInner, (prev, next) =>
  prev.rating          === next.rating     &&
  prev.isFav           === next.isFav      &&
  prev.meal?.name      === next.meal?.name &&
  prev.defaultServings === next.defaultServings
);
