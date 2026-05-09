// src/components/meal/MealCard.jsx — v23.43
//
// CHANGES vs v23.39:
//   + Time-of-day CTA language (A4: "Cook this tonight" / "Cook this today" / "Make this tonight")
//   + Emotional framing helper — replaces generic description with contextual framing
//   + Expand toggle softened: "See how to make it" / "Close"
//   + Desktop breathing room: max-width 600px, bigger padding on wide screens
//   + Ingredient section heading removed (UPPERCASE labels feel utility-heavy)
//   + Method heading softened: "Steps" not "METHOD · N STEPS"
//   + Removed: hardcoded "🔥" emoji in CTA (let label carry the energy)

import { useState, useRef, memo } from 'react';
import { useLocale }       from '../../contexts/LocaleContext.jsx';
import { scaleIngredient } from '../../lib/scaling.js';
import { buildShareText }  from '../../lib/sharing.js';

const F     = "'DM Sans', sans-serif";
const SERIF = "'Fraunces', serif";
const C = {
  jiff:   '#FF4500', ember:  '#CC3700',
  ink:    '#1C0A00', muted:  '#7C6A5E',
  soft:   '#B5A49A', green:  '#1D9E75',
  border: 'rgba(28,10,0,0.07)',
};

// ── Step A4: Single centralised time-of-day helper ────────────────
// Returns { cook, notThis } based on local hour.
// One place to change copy — no scattered time checks.
function getTimeCtx() {
  const h = new Date().getHours();
  if (h >= 5  && h < 12) return { cook: 'Cook this for breakfast',   notThis: 'Not this morning'       };
  if (h >= 12 && h < 15) return { cook: 'Cook this for lunch',       notThis: 'Try something else'     };
  if (h >= 15 && h < 18) return { cook: 'Cook this today',           notThis: 'Try something else'     };
  if (h >= 18 && h < 23) return { cook: 'Cook this tonight →',       notThis: 'Not tonight'            };
  return                         { cook: 'Make this tonight →',       notThis: 'Try something lighter'  };
}

// ── Staples ───────────────────────────────────────────────────────
const STAPLES = new Set([
  'salt','oil','water','turmeric','cumin','onion','garlic','ginger',
  'sugar','ghee','atta','rice','dal','mustard seeds','coriander',
  'butter','lemon','pepper','chilli','chili','besan','paneer',
  'curd','yogurt','milk','flour',
]);
function isStaple(ing) {
  const name  = (typeof ing === 'string' ? ing : ing?.name || ing?.item || '').toLowerCase().trim();
  const first = name.split(' ')[0];
  return STAPLES.has(name) || STAPLES.has(first);
}

// ── Effort label (no numbers) ─────────────────────────────────────
function effortLabel(steps, time) {
  const mins = parseInt(time) || 30;
  if (mins <= 15 || (steps && steps <= 3)) return 'Very quick';
  if (mins <= 25 || (steps && steps <= 5)) return 'Easy';
  if (mins <= 40)                           return 'Moderate';
  return 'Worth the effort';
}

// ── Calm reassurance — silence for complex recipes ────────────────
function reassuranceLine(ingredients) {
  if (!ingredients || ingredients.length === 0) return null;
  const nonStaple = ingredients.filter(i => !isStaple(i)).length;
  const total     = ingredients.length;
  if (nonStaple === 0) return 'All pantry staples';
  if (nonStaple <= 2)  return 'Just ' + nonStaple + ' item' + (nonStaple !== 1 ? 's' : '') + ' to pick up';
  if (total > 0 && (total - nonStaple) / total >= 0.6) return 'Most ingredients you likely have';
  return null;
}

// ── Step A3: Emotional framing from description + time-of-day ─────
// Replaces cold "Matches your taste" with contextual food energy.
function emotionalFrame(description, time, steps) {
  if (!description) return null;
  const h = new Date().getHours();
  // If the description already sounds emotional, use it directly
  const cold = /classic|traditional|popular|common|dish|recipe|option/i.test(description);
  if (!cold) return description;
  // Re-frame cold descriptions with time-of-day energy
  const effort = effortLabel(steps, time);
  if (h < 12) return effort === 'Very quick' ? 'A quick, energising start to the day' : 'Warming and filling this morning';
  if (h < 16) return effort === 'Very quick' ? 'Light and easy for the afternoon' : 'Satisfying midday meal';
  if (h < 20) return effort === 'Very quick' ? 'Quick and easy tonight'            : 'Comforting and easy this evening';
  return 'Warm and filling, just right for now';
}

// ── Heart icon ────────────────────────────────────────────────────
function Heart({ filled }) {
  return (
    <svg viewBox="0 0 24 24" fill={filled ? '#E53E3E' : 'none'} stroke={filled ? '#E53E3E' : C.soft} strokeWidth="2" style={{ width:18, height:18, display:'block' }}>
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
    </svg>
  );
}

// ── Primary CTA — time-aware label ───────────────────────────────
function CookBtn({ onClick, timeCtx }) {
  const [hov, setHov] = useState(false);
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        width:'100%', padding:'14px 0', borderRadius:12,
        background: hov ? C.ember : C.jiff,
        color:'white', border:'none', fontSize:15,
        fontWeight:700, fontFamily:F, cursor:'pointer',
        letterSpacing:'0.01em', transition:'background 0.15s ease',
        touchAction:'manipulation',
      }}>
      {timeCtx.cook}
    </button>
  );
}

// ── Ingredient line — calm, scannable ────────────────────────────
function IngLine({ text, staple }) {
  return (
    <div style={{
      fontSize:13, lineHeight:1.6, fontFamily:F,
      color: staple ? C.muted : C.ink,
      padding:'4px 0', borderBottom:'1px solid rgba(28,10,0,0.03)',
    }}>{text}</div>
  );
}

// ── Share sheet ───────────────────────────────────────────────────
function ShareSheet({ show, onClose, onCopy, copied, onWhatsApp }) {
  if (!show) return null;
  const btn = { display:'flex', alignItems:'center', gap:8, width:'100%', padding:'9px 12px', border:'none', background:'none', fontSize:13, cursor:'pointer', borderRadius:8, fontFamily:F };
  return (
    <>
      <div onClick={onClose} style={{ position:'fixed', inset:0, zIndex:200 }}/>
      <div style={{ position:'absolute', bottom:'calc(100% + 8px)', left:0, background:'white', border:'1px solid '+C.border, borderRadius:14, padding:6, zIndex:201, minWidth:148, boxShadow:'0 8px 32px rgba(28,10,0,0.10)' }}>
        <button style={{ ...btn, color:C.ink }} onClick={onCopy}><span>📋</span>{copied ? 'Copied!' : 'Copy recipe'}</button>
        <button style={{ ...btn, color:'#25D366' }} onClick={onWhatsApp}><span>💬</span>{'WhatsApp'}</button>
      </div>
    </>
  );
}

// ── Main MealCard ─────────────────────────────────────────────────
function MealCardInner({ meal, isFav, onToggleFav, rating, onRate, lang = 'en' }) {
  const { units } = useLocale();
  const [open,      setOpen]      = useState(false);
  const [stepsOpen, setStepsOpen] = useState(false);
  const [servings,  setServings]  = useState(meal?.servings || 2);
  const [share,     setShare]     = useState(false);
  const [copied,    setCopied]    = useState(false);
  // Staged reveal: card identity appears instantly; detail fades in after first paint
  const [revealed,  setRevealed]  = useState(false);
  const ref = useRef(null);

  // Stage 2 reveal — 180ms after mount, expanded detail becomes available
  // This creates the "assembling" feel without layout shift
  useState(() => {
    const t = setTimeout(() => setRevealed(true), 180);
    return () => clearTimeout(t);
  });

  if (!meal) return null;

  const base     = meal.servings || 2;
  const scale    = servings / base;
  const steps    = meal.method || meal.steps || [];
  const ingr     = meal.ingredients || [];
  const time     = meal.time || '';
  const effort   = effortLabel(steps.length, time);
  const calm     = reassuranceLine(ingr);
  const frame    = emotionalFrame(meal.description, time, steps.length);
  const timeCtx  = getTimeCtx();

  const handleCook = () => {
    setOpen(true);
    setTimeout(() => ref.current?.scrollIntoView({ behavior:'smooth', block:'start' }), 80);
  };
  const handleCopy = () => {
    navigator.clipboard?.writeText(buildShareText(meal, lang)).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2200);
    });
  };

  return (
    <><style>{`@keyframes jiffReveal{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}} @keyframes jiffDetail{from{opacity:0}to{opacity:1}}`}</style>
    <div ref={ref} style={{
      background:'white', border:'1px solid '+C.border,
      borderRadius:18, overflow:'hidden', fontFamily:F,
      marginBottom:16, maxWidth:600, width:'100%',
      boxSizing:'border-box', marginLeft:'auto', marginRight:'auto',
    }}>

      {/* ── LEVEL 1: DECISION ─────────────────────────────────── */}
      <div style={{ padding:'clamp(16px,4vw,24px) clamp(16px,4vw,24px) 0' }}>

        {/* Name + fav */}
        <div style={{ display:'flex', alignItems:'flex-start', gap:12, marginBottom:8 }}>
          <span style={{ fontSize:'clamp(24px,5vw,30px)', flexShrink:0, lineHeight:1.1, marginTop:2 }}>
            {meal.emoji || '🍽️'}
          </span>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontFamily:SERIF, fontSize:'clamp(17px,3.5vw,21px)', fontWeight:700, color:C.ink, lineHeight:1.2, wordBreak:'break-word' }}>
              {meal.name}
            </div>
            {/* Emotional framing — replaces cold generic description */}
            {frame && (
              <div style={{ fontSize:12, color:C.muted, marginTop:5, lineHeight:1.55, fontWeight:300, fontStyle:'italic' }}>
                {frame}
              </div>
            )}
          </div>
          <button onClick={e => { e.stopPropagation(); onToggleFav?.(meal); }}
            style={{ background:'none', border:'none', cursor:'pointer', padding:4, flexShrink:0, touchAction:'manipulation' }}>
            <Heart filled={isFav}/>
          </button>
        </div>

        {/* Meta row — minimal */}
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14, flexWrap:'wrap' }}>
          {time && <span style={{ fontSize:12, color:C.muted }}>{'⏱ '}{time}</span>}
          <span style={{ fontSize:12, color:C.muted }}>{effort}</span>
          {meal.diet && !['any','none'].includes(meal.diet) && (
            <span style={{ fontSize:12, color:C.green }}>{'🌿 '}{meal.diet}</span>
          )}
          {calm && (
            <span style={{ fontSize:11, color:C.green, fontWeight:500 }}>{'✓ '}{calm}</span>
          )}
        </div>

        {/* Primary CTA — time-aware */}
        <CookBtn onClick={handleCook} timeCtx={timeCtx}/>

        {/* Expand toggle — fades in after first paint (Stage 2 reveal) */}
        {revealed ? (
          <button onClick={() => setOpen(v => !v)} style={{
            width:'100%', padding:'9px 0 0', background:'none', border:'none',
            fontSize:11, color:C.soft, cursor:'pointer', fontFamily:F,
            display:'flex', alignItems:'center', justifyContent:'center', gap:4,
            touchAction:'manipulation', marginTop:8, animation:'jiffDetail 0.3s ease',
          }}>
            <span style={{ display:'inline-block', transform:open?'rotate(180deg)':'none', transition:'transform 0.18s ease' }}>{'▾'}</span>
            {open ? 'Close' : 'See how to make it'}
          </button>
        ) : (
          <div style={{ height:25, marginTop:8 }} />
        )}
      </div>

      {/* ── LEVELS 2+3: REASSURANCE + EXECUTION ──────────────── */}
      {open && (
        <div style={{ padding:'16px clamp(16px,4vw,24px) clamp(16px,4vw,22px)' }}>

          {/* Servings */}
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:18 }}>
            <span style={{ fontSize:11, color:C.muted }}>{'Serves'}</span>
            {[1,2,3,4,6].map(n => (
              <button key={n} onClick={() => setServings(n)} style={{
                width:28, height:28, borderRadius:'50%', border:'none',
                background: servings===n ? C.jiff : 'rgba(28,10,0,0.06)',
                color: servings===n ? 'white' : C.ink,
                fontSize:11, fontWeight:servings===n?600:400,
                cursor:'pointer', fontFamily:F, touchAction:'manipulation',
              }}>{n}</button>
            ))}
          </div>

          {/* Ingredients — calm list, no header label */}
          {ingr.length > 0 && (
            <div style={{ marginBottom:18 }}>
              {ingr.map((ing, i) => (
                <IngLine key={i} text={scaleIngredient(ing, scale, units)} staple={isStaple(ing)}/>
              ))}
            </div>
          )}

          {/* Method — collapsible, softened heading */}
          {steps.length > 0 && (
            <div style={{ borderTop:'1px solid '+C.border, paddingTop:14 }}>
              <button onClick={() => setStepsOpen(v => !v)} style={{
                width:'100%', display:'flex', justifyContent:'space-between', alignItems:'center',
                background:'none', border:'none', cursor:'pointer', fontFamily:F,
                marginBottom:stepsOpen?12:0, touchAction:'manipulation', padding:0,
              }}>
                <span style={{ fontSize:11, fontWeight:600, color:C.soft, letterSpacing:'0.06em', textTransform:'uppercase' }}>
                  {'Steps · '}{steps.length}
                </span>
                <span style={{ fontSize:13, color:C.soft, display:'inline-block', transform:stepsOpen?'rotate(180deg)':'none', transition:'transform 0.18s ease' }}>{'▾'}</span>
              </button>

              {stepsOpen && steps.map((step, i) => {
                const text = typeof step === 'string' ? step : (step?.instruction || step?.text || String(step));
                return (
                  <div key={i} style={{ display:'flex', gap:12, marginBottom:12 }}>
                    <div style={{ width:20, height:20, borderRadius:'50%', flexShrink:0, background:'rgba(28,10,0,0.05)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:700, color:C.muted, marginTop:2 }}>
                      {i + 1}
                    </div>
                    <div style={{ fontSize:13, color:C.ink, lineHeight:1.65, flex:1 }}>{text}</div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Footer */}
          <div style={{ borderTop:'1px solid '+C.border, paddingTop:12, marginTop:4, position:'relative', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <div style={{ position:'relative' }}>
              <button onClick={() => setShare(s => !s)} style={{
                display:'flex', alignItems:'center', gap:6, background:'none',
                border:'1px solid '+C.border, borderRadius:8, padding:'6px 12px',
                fontSize:12, color:C.muted, cursor:'pointer', fontFamily:F, touchAction:'manipulation',
              }}>{'Share'}</button>
              <ShareSheet show={share} onClose={() => setShare(false)} onCopy={handleCopy} copied={copied}
                onWhatsApp={() => window.open('https://api.whatsapp.com/send?text='+encodeURIComponent(buildShareText(meal,lang)),'_blank')}/>
            </div>
            {onRate && (
              <button onClick={() => onRate?.(rating === 1 ? 0 : 1)} style={{
                display:'flex', alignItems:'center', gap:5, background:'none', border:'none',
                cursor:'pointer', fontFamily:F, fontSize:12, color:rating?C.jiff:C.soft,
                touchAction:'manipulation', padding:0,
              }}>
                {rating ? '❤️ Saved as favourite' : '♡ Save as favourite'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
    </>
  );
}

export const MealCard = memo(MealCardInner, (prev, next) =>
  prev.isFav      === next.isFav      &&
  prev.rating     === next.rating     &&
  prev.meal?.name === next.meal?.name
);
