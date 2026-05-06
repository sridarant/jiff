// src/components/meal/MealCard.jsx — v23.39
//
// PHILOSOPHY: Decision-first cooking companion.
// The card says: "Tonight, make THIS. You'll enjoy it. You'll manage it easily."
//
// THREE LEVELS — in strict visual priority order:
//
//   LEVEL 1 — DECISION (always visible)
//     dish name · why line · time · effort · CTA
//
//   LEVEL 2 — REASSURANCE (on expand, above fold)
//     calm ingredient scan · servings
//
//   LEVEL 3 — EXECUTION (below fold on expand)
//     method steps · share
//
// REMOVED vs v23.25:
//   ✕ StarRating (noise in decision zone)
//   ✕ IngredientRow ✓/? toggles (pantry-era interaction, no memory)
//   ✕ "~N items to get" anxiety framing
//   ✕ Order now → grocery CTA
//   ✕ scaleNutrition (AI numbers are unreliable)
//   ✕ FocusStep fullscreen overlay (complexity)
//   ✕ StepWithTimer (complexity before cooking starts)
//   ✕ Focus → per-step button
//   ✕ VideoButton placeholder (misleading when no video)
//   ✕ "items to get" count in expand toggle

import { useState, useRef, memo } from 'react';
import { useLocale }      from '../../contexts/LocaleContext.jsx';
import { scaleIngredient } from '../../lib/scaling.js';
import { buildShareText }  from '../../lib/sharing.js';

const F = "'DM Sans', sans-serif";
const SERIF = "'Fraunces', serif";
const C = {
  jiff:   '#FF4500',
  ember:  '#CC3700',
  ink:    '#1C0A00',
  muted:  '#7C6A5E',
  soft:   '#B5A49A',
  green:  '#1D9E75',
  border: 'rgba(28,10,0,0.07)',
  surface:'#FAFAF8',
};

// Staples pre-marked as reassurance text — NOT shown as warning
const STAPLES = new Set([
  'salt','oil','water','turmeric','cumin','onion','garlic','ginger',
  'sugar','ghee','atta','rice','dal','mustard seeds','coriander',
  'butter','lemon','pepper','chilli','chili','besan',
]);

function isStaple(ing) {
  const name = (typeof ing === 'string' ? ing : ing.name || ing.item || '').toLowerCase().trim();
  const first = name.split(' ')[0];
  return STAPLES.has(name) || STAPLES.has(first);
}

// Calm effort label — no numbers, no warnings
function effortLabel(steps, time) {
  const mins = parseInt(time) || 30;
  if (mins <= 15 || steps <= 3) return 'Very quick';
  if (mins <= 25 || steps <= 5) return 'Easy';
  if (mins <= 40)               return 'Moderate';
  return 'Worth the effort';
}

// How many non-staple ingredients — used only for reassurance text
function reassuranceLine(ingredients) {
  if (!ingredients || ingredients.length === 0) return null;
  const nonStaple = ingredients.filter(i => !isStaple(i)).length;
  const total     = ingredients.length;
  if (nonStaple === 0) return 'All from your kitchen staples';
  if (nonStaple <= 2)  return 'Just ' + nonStaple + ' item' + (nonStaple > 1 ? 's' : '') + ' to pick up';
  const pct = Math.round(((total - nonStaple) / total) * 100);
  if (pct >= 60)       return 'Most ingredients you likely have';
  return null; // don't show for complex recipes — silence is calmer than warning
}

// ── Heart icon ────────────────────────────────────────────────────
function Heart({ filled }) {
  return (
    <svg viewBox="0 0 24 24" fill={filled ? '#E53E3E' : 'none'} stroke={filled ? '#E53E3E' : C.soft} strokeWidth="2" style={{ width:18, height:18, display:'block' }}>
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
    </svg>
  );
}

// ── Primary CTA ───────────────────────────────────────────────────
function CookBtn({ onClick, label }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: '100%', padding: '14px 0', borderRadius: 12,
        background: hov ? C.ember : C.jiff,
        color: 'white', border: 'none',
        fontSize: 15, fontWeight: 700, fontFamily: F,
        cursor: 'pointer', letterSpacing: '0.01em',
        transition: 'background 0.12s',
        touchAction: 'manipulation',
      }}>
      {label || '🔥 Cook this tonight'}
    </button>
  );
}

// ── Ingredient line — calm, scannable, no toggle UI ───────────────
function IngLine({ text, staple }) {
  return (
    <div style={{
      fontSize: 13, lineHeight: 1.55, fontFamily: F,
      color: staple ? C.muted : C.ink,
      padding: '3px 0',
      borderBottom: '1px solid rgba(28,10,0,0.03)',
    }}>
      {text}
    </div>
  );
}

// ── Share sheet ───────────────────────────────────────────────────
function ShareSheet({ show, onClose, onCopy, copied, onWhatsApp }) {
  if (!show) return null;
  const btn = {
    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
    padding: '9px 12px', border: 'none', background: 'none',
    fontSize: 13, cursor: 'pointer', borderRadius: 8, fontFamily: F,
  };
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 200 }} />
      <div style={{
        position: 'absolute', bottom: 'calc(100% + 8px)', left: 0,
        background: 'white', border: '1px solid ' + C.border, borderRadius: 14,
        padding: 6, zIndex: 201, minWidth: 150,
        boxShadow: '0 8px 32px rgba(28,10,0,0.1)',
      }}>
        <button style={{ ...btn, color: C.ink }} onClick={onCopy}>
          <span>📋</span> {copied ? 'Copied!' : 'Copy recipe'}
        </button>
        <button style={{ ...btn, color: '#25D366' }} onClick={onWhatsApp}>
          <span>💬</span> WhatsApp
        </button>
      </div>
    </>
  );
}

// ── Main card ─────────────────────────────────────────────────────
function MealCardInner({ meal, isFav, onToggleFav, rating, onRate, pantry = [], lang = 'en' }) {
  const { units } = useLocale();

  const [open,      setOpen]      = useState(false);
  const [stepsOpen, setStepsOpen] = useState(false);
  const [servings,  setServings]  = useState(meal?.servings || 2);
  const [share,     setShare]     = useState(false);
  const [copied,    setCopied]    = useState(false);
  const ref = useRef(null);

  if (!meal) return null;

  const base  = meal.servings || 2;
  const scale = servings / base;
  const steps = (meal.method || meal.steps || []);
  const ingr  = (meal.ingredients || []);
  const time  = meal.time || '';
  const why   = meal.description || '';
  const effort = effortLabel(steps.length, time);
  const calm  = reassuranceLine(ingr);

  const handleCook = () => {
    setOpen(true);
    setTimeout(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  };

  const handleCopy = () => {
    navigator.clipboard?.writeText(buildShareText(meal, lang)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    });
  };

  return (
    <div ref={ref} style={{
      background: 'white',
      border: '1px solid ' + C.border,
      borderRadius: 18,
      overflow: 'hidden',
      fontFamily: F,
      marginBottom: 16,
      maxWidth: 560,
      width: '100%',
      boxSizing: 'border-box',
      marginLeft: 'auto',
      marginRight: 'auto',
    }}>

      {/* ── LEVEL 1: DECISION ─────────────────────────────────── */}
      <div style={{ padding: '18px 18px 0' }}>

        {/* Name row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 26, flexShrink: 0, lineHeight: 1.1, marginTop: 2 }}>
            {meal.emoji || '🍽️'}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: SERIF, fontSize: 19, fontWeight: 700, color: C.ink, lineHeight: 1.2, wordBreak: 'break-word' }}>
              {meal.name}
            </div>
            {why && (
              <div style={{ fontSize: 12, color: C.muted, marginTop: 4, lineHeight: 1.5, fontWeight: 300 }}>
                {why}
              </div>
            )}
          </div>
          <button
            onClick={e => { e.stopPropagation(); onToggleFav?.(meal); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, flexShrink: 0, touchAction: 'manipulation' }}>
            <Heart filled={isFav} />
          </button>
        </div>

        {/* Meta — time + effort only, no star rating in decision zone */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
          {time && (
            <span style={{ fontSize: 12, color: C.muted }}>⏱ {time}</span>
          )}
          <span style={{ fontSize: 12, color: C.muted }}>{effort}</span>
          {meal.diet && meal.diet !== 'any' && meal.diet !== 'none' && (
            <span style={{ fontSize: 12, color: C.green }}>🌿 {meal.diet}</span>
          )}
          {calm && (
            <span style={{ fontSize: 11, color: C.green, fontWeight: 500 }}>✓ {calm}</span>
          )}
        </div>

        {/* Primary CTA */}
        <CookBtn onClick={handleCook} />

        {/* Expand toggle */}
        <button
          onClick={() => setOpen(v => !v)}
          style={{
            width: '100%', padding: '10px 0 0', background: 'none', border: 'none',
            fontSize: 11, color: C.soft, cursor: 'pointer', fontFamily: F,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            touchAction: 'manipulation', marginTop: 8,
          }}>
          <span style={{ display: 'inline-block', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.18s' }}>▾</span>
          {open ? 'Less detail' : 'Ingredients & method'}
        </button>
      </div>

      {/* ── LEVEL 2 + 3: REASSURANCE + EXECUTION ─────────────── */}
      {open && (
        <div style={{ padding: '16px 18px 18px' }}>

          {/* Servings control — calm, minimal */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <span style={{ fontSize: 11, color: C.muted }}>Serves</span>
            {[1, 2, 3, 4, 6].map(n => (
              <button key={n} onClick={() => setServings(n)}
                style={{
                  width: 28, height: 28, borderRadius: '50%', border: 'none',
                  background: servings === n ? C.jiff : 'rgba(28,10,0,0.06)',
                  color: servings === n ? 'white' : C.ink,
                  fontSize: 11, fontWeight: servings === n ? 600 : 400,
                  cursor: 'pointer', fontFamily: F, touchAction: 'manipulation',
                }}>
                {n}
              </button>
            ))}
          </div>

          {/* Ingredients — calm list, no toggles, no warnings */}
          {ingr.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.soft, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
                Ingredients
              </div>
              {ingr.map((ing, i) => (
                <IngLine
                  key={i}
                  text={scaleIngredient(ing, scale, units)}
                  staple={isStaple(ing)}
                />
              ))}
            </div>
          )}

          {/* Method — collapsible, clean steps */}
          {steps.length > 0 && (
            <div style={{ borderTop: '1px solid ' + C.border, paddingTop: 14 }}>
              <button
                onClick={() => setStepsOpen(v => !v)}
                style={{
                  width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  background: 'none', border: 'none', cursor: 'pointer', fontFamily: F, marginBottom: stepsOpen ? 12 : 0,
                  touchAction: 'manipulation', padding: 0,
                }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: C.soft, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  Method · {steps.length} steps
                </span>
                <span style={{ fontSize: 13, color: C.soft, display: 'inline-block', transform: stepsOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.18s' }}>▾</span>
              </button>

              {stepsOpen && steps.map((step, i) => {
                const text = typeof step === 'string' ? step : (step?.instruction || step?.text || String(step));
                return (
                  <div key={i} style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
                    <div style={{
                      width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                      background: 'rgba(28,10,0,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, fontWeight: 700, color: C.muted, marginTop: 1,
                    }}>
                      {i + 1}
                    </div>
                    <div style={{ fontSize: 13, color: C.ink, lineHeight: 1.6, flex: 1 }}>
                      {text}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Footer — share only, no scale selector (moved above) */}
          <div style={{ borderTop: '1px solid ' + C.border, paddingTop: 12, marginTop: 4, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setShare(s => !s)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: 'none', border: '1px solid ' + C.border, borderRadius: 8,
                  padding: '6px 12px', fontSize: 12, color: C.muted,
                  cursor: 'pointer', fontFamily: F, touchAction: 'manipulation',
                }}>
                Share
              </button>
              <ShareSheet
                show={share}
                onClose={() => setShare(false)}
                onCopy={handleCopy}
                copied={copied}
                onWhatsApp={() => window.open('https://api.whatsapp.com/send?text=' + encodeURIComponent(buildShareText(meal, lang)), '_blank')}
              />
            </div>

            {/* Quiet post-cook rating — only after expansion */}
            {onRate && (
              <button
                onClick={() => onRate?.(rating === 1 ? 0 : 1)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  background: 'none', border: 'none', cursor: 'pointer', fontFamily: F,
                  fontSize: 12, color: rating ? C.jiff : C.soft, touchAction: 'manipulation', padding: 0,
                }}>
                {rating ? '❤️ Saved as favourite' : '♡ Save as favourite'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export const MealCard = memo(MealCardInner, (prev, next) =>
  prev.isFav      === next.isFav      &&
  prev.rating     === next.rating     &&
  prev.meal?.name === next.meal?.name
);
