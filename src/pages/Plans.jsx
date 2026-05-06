// src/pages/Plans.jsx — Premium Meal Plans by goal (Phase 4)
// Curated 7-day plans for specific goals: weight loss, muscle gain, family, budget, etc.

import { useState, useEffect } from 'react';
import { VideoButton } from '../components/meal/VideoButton.jsx';
import { getDietaryLabel } from '../lib/dietary';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/common/PageHeader';
import { usePremium } from '../contexts/PremiumContext';
import { useAuth }    from '../contexts/AuthContext';
import { generatePlan } from '../services/plannerService';

const C = {
  jiff:'#FF4500', jiffDark:'#CC3700', ink:'#1C0A00',
  cream:'#FFFAF5', warm:'#FFF0E5', muted:'#7C6A5E',
  border:'rgba(28,10,0,0.10)', borderMid:'rgba(28,10,0,0.18)',
  shadow:'0 4px 28px rgba(28,10,0,0.08)',
  gold:'#FFB800', goldBg:'rgba(255,184,0,0.08)',
};

const PLANS = [
  {
    id:       'weight-loss',
    emoji:    '🥗',
    title:    'Weight Loss',
    tagline:  'High protein, low calorie — satisfying meals under 400 cal',
    color:    '#1D9E75',
    bg:       'rgba(29,158,117,0.08)',
    border:   'rgba(29,158,117,0.25)',
    targets:  ['< 1600 cal/day', '30g+ protein/meal', 'High fibre'],
    cuisine:  'Mediterranean',
    goal:     'weight loss with high protein and fibre, under 400 calories per meal, Mediterranean-inspired',
  },
  {
    id:       'muscle-gain',
    emoji:    '💪',
    title:    'Muscle Gain',
    tagline:  'Protein-packed meals to fuel your training',
    color:    '#3949AB',
    bg:       'rgba(57,73,171,0.07)',
    border:   'rgba(57,73,171,0.2)',
    targets:  ['40g+ protein/meal', '2500+ cal/day', 'Complex carbs'],
    cuisine:  'any',
    goal:     'muscle gain with very high protein (40g+ per meal), complex carbohydrates, and calorie-dense ingredients',
  },
  {
    id:       'family',
    emoji:    '👨‍👩‍👧‍👦',
    title:    'Family Friendly',
    tagline:  'Mild, crowd-pleasing meals everyone will eat',
    color:    '#F57C00',
    bg:       'rgba(245,124,0,0.07)',
    border:   'rgba(245,124,0,0.2)',
    targets:  ['Kid-approved', 'Mild spice', '4 servings'],
    cuisine:  'Indian',
    goal:     'family-friendly meals that children love, mild spice, simple ingredients, 4 servings each',
  },
  {
    id:       'budget',
    emoji:    '💰',
    title:    'Budget Meals',
    tagline:  'Nutritious and filling — under ₹100 per serving',
    color:    '#5D4037',
    bg:       'rgba(93,64,55,0.07)',
    border:   'rgba(93,64,55,0.2)',
    targets:  ['₹100/serving', 'Pantry staples', 'Zero waste'],
    cuisine:  'Indian',
    goal:     'budget-friendly meals using only pantry staples and affordable ingredients, maximising nutrition per rupee',
  },
  {
    id:       'vegetarian',
    emoji:    '🌱',
    title:    'Vegetarian Week',
    tagline:  'Plant-based meals packed with flavour and protein',
    color:    '#388E3C',
    bg:       'rgba(56,142,60,0.07)',
    border:   'rgba(56,142,60,0.2)',
    targets:  ['100% vegetarian', '20g+ protein/meal', 'Whole foods'],
    cuisine:  'any',
    goal:     'fully vegetarian meals with 20g+ protein per meal using legumes, dairy, nuts, and whole grains',
  },
  {
    id:       'quick',
    emoji:    '⚡',
    title:    '15-Minute Meals',
    tagline:  'Full week of meals under 15 minutes each',
    color:    '#FF4500',
    bg:       'rgba(255,69,0,0.07)',
    border:   'rgba(255,69,0,0.2)',
    targets:  ['< 15 min each', 'Simple steps', 'No complex prep'],
    cuisine:  'any',
    goal:     'ultra-quick meals under 15 minutes each, minimal prep, simple 3-4 step recipes, easy for busy weekdays',
  },
];

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner'];

function PlanCard({ plan, onGenerate, generating }) {
  const isGenerating = generating === plan.id;
  return (
    <div style={{
      background: 'white', border: '1px solid ' + C.border, borderRadius: 18,
      overflow: 'hidden', boxShadow: C.shadow, transition: 'transform 0.2s, box-shadow 0.2s',
    }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 12px 32px rgba(28,10,0,0.12)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = C.shadow; }}
    >
      <div style={{ background: plan.bg, borderBottom: '1px solid ' + plan.border, padding: '20px 20px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <span style={{ fontSize: 32 }}>{plan.emoji}</span>
          <div>
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: 18, fontWeight: 900, color: plan.color, letterSpacing: '-0.3px' }}>{plan.title}</div>
            <div style={{ fontSize: 12, color: C.muted, fontWeight: 300, marginTop: 2 }}>{plan.tagline}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {plan.targets.map(t => (
            <span key={t} style={{ fontSize: 11, fontWeight: 500, padding: '3px 9px', borderRadius: 20, background: 'white', color: plan.color, border: '1px solid ' + plan.border }}>
              {t}
            </span>
          ))}
        </div>
      </div>
      <div style={{ padding: '16px 20px' }}>
        <div style={{ fontSize: 12, color: C.muted, fontWeight: 300, marginBottom: 14, lineHeight: 1.6 }}>
          7 days × 3 meals — breakfast, lunch &amp; dinner — all optimised for {plan.title.toLowerCase()}.
        </div>
        <button
          onClick={() => onGenerate(plan)}
          disabled={!!generating}
          style={{
            width: '100%', background: isGenerating ? C.muted : plan.color,
            color: 'white', border: 'none', borderRadius: 10, padding: '11px 0',
            fontSize: 14, fontWeight: 500, cursor: generating ? 'not-allowed' : 'pointer',
            fontFamily: "'DM Sans', sans-serif", transition: 'all 0.18s',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
        >
          {isGenerating ? (
            <><span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />Planning…</>
          ) : (
            '📅 Generate this plan'
          )}
        </button>
      </div>
    </div>
  );
}

export default function Plans() {
  const navigate   = useNavigate();
  const { isPremium } = usePremium();
  const { pantry, profile } = useAuth();

  const [servings,     setServings]     = useState(2);
  const [generating,   setGenerating]   = useState(null);

  // Pre-fill pantry items from saved pantry

  const [plan,         setPlan]         = useState(null);
  const [currentGoal,  setCurrentGoal]  = useState(null);
  const [errorMsg,     setErrorMsg]     = useState('');
  const [genElapsed,   setGenElapsed]   = useState(0);
  const [expandedDay,  setExpandedDay]  = useState(null);


  const handleGenerate = async (planConfig) => {
    if (!isPremium) { navigate('/pricing'); return; }
    setGenerating(planConfig.id);
    setGenElapsed(0);
    const elapsed_timer = setInterval(() => setGenElapsed(e => e + 1), 1000);
    setCurrentGoal(planConfig);
    setErrorMsg('');
    try {
      const data = await generatePlan({
        ingredients: pantry?.length ? pantry : ['rice', 'lentils', 'vegetables', 'eggs'],
        diet: planConfig.id === 'vegetarian' ? 'vegetarian' : 'none',
        cuisine: planConfig.cuisine,
        mealTypes: MEAL_TYPES,
        servings,
        language: 'en',
        units: 'metric',
        tasteProfile: { goal: planConfig.goal },
      });
      if (data.plan?.length >= 7) { setPlan(data.plan); setExpandedDay(0); }
      else { setErrorMsg(data.error || 'Could not generate plan. Please try again.'); }
    } catch { setErrorMsg('Connection error. Please try again.'); }
    finally { setGenerating(null); if (typeof elapsed_timer !== 'undefined') clearInterval(elapsed_timer); }
  };

  const DAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const MEAL_EMOJI = { breakfast: '🌅', lunch: '☀️', dinner: '🌙' };

  const hdr = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 28px', borderBottom: '1px solid ' + C.border, position: 'sticky', top: 0, zIndex: 10, background: 'rgba(255,250,245,0.95)', backdropFilter: 'blur(12px)' };

  return (
    <div style={{ minHeight: '100vh', background: C.cream, fontFamily: "'DM Sans', sans-serif", color: C.ink }}>
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
      <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,700;0,900&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet"/>
      <PageHeader title="Goal Plans" backTo='/plan' backLabel='← Plan' />

      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '40px 24px 80px' }}>
        {/* Hero */}
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: C.goldBg, border: '1px solid rgba(255,184,0,0.25)', borderRadius: 20, padding: '5px 14px', marginBottom: 16 }}>
            <span style={{ fontSize: 12 }}>⚡</span>
            <span style={{ fontSize: 11, fontWeight: 500, color: '#854F0B', letterSpacing: '1px', textTransform: 'uppercase' }}>Premium Feature</span>
          </div>
          <h1 style={{ fontFamily: "'Fraunces', serif", fontSize: 'clamp(28px,5vw,48px)', fontWeight: 900, color: C.ink, letterSpacing: '-1.5px', lineHeight: 1.05, marginBottom: 12 }}>
            Goal-based<br /><span style={{ color: C.jiff, fontStyle: 'italic' }}>Meal Plans</span>
          </h1>
          <p style={{ fontSize: 15, color: C.muted, fontWeight: 300, lineHeight: 1.7, maxWidth: 460, margin: '0 auto 28px' }}>
            Pick a goal. Jiff builds a full 7-day plan optimised for it — every breakfast, lunch and dinner calibrated to your target.
          </p>
          {!isPremium && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, background: C.goldBg, border: '1px solid rgba(255,184,0,0.3)', borderRadius: 12, padding: '10px 18px', marginBottom: 28 }}>
              <span style={{ fontSize: 13, color: '#854F0B', fontWeight: 300 }}>Premium feature — upgrade to generate goal-based plans</span>
              <button onClick={() => navigate('/pricing')} style={{ background: '#854F0B', color: 'white', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' }}>
                ⚡ Upgrade
              </button>
            </div>
          )}
        </div>

        {/* Profile-based generation info */}
        <div style={{ background: 'white', border: '1px solid ' + C.border, borderRadius: 18, padding: '20px 22px', marginBottom: 32, boxShadow: C.shadow }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:16 }}>
            <div style={{ flex:1, minWidth:200 }}>
              <div style={{ fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase', color: C.jiff, fontWeight: 500, marginBottom: 10 }}>
                Based on your preferences
              </div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                {profile?.preferred_cuisines?.length > 0 && (
                  <span style={{ fontSize:12, background:'rgba(255,69,0,0.08)', color:C.jiff, padding:'3px 10px', borderRadius:20, fontWeight:400 }}>
                    🌍 {profile.preferred_cuisines.slice(0,3).join(', ')}
                  </span>
                )}
                {profile?.food_type?.length > 0 && (
                  <span style={{ fontSize:12, background:'rgba(28,10,0,0.06)', color:C.ink, padding:'3px 10px', borderRadius:20, fontWeight:400 }}>
                    🍽️ {getDietaryLabel(profile.food_type)}
                  </span>
                )}
                {profile?.spice_level && (
                  <span style={{ fontSize:12, background:'rgba(28,10,0,0.06)', color:C.ink, padding:'3px 10px', borderRadius:20, fontWeight:400 }}>
                    🌶️ {profile.spice_level}
                  </span>
                )}
                {pantry?.length > 0 && (
                  <span style={{ fontSize:12, background:'rgba(28,10,0,0.06)', color:C.ink, padding:'3px 10px', borderRadius:20, fontWeight:400 }}>
                    🧂 {pantry.length} pantry items
                  </span>
                )}
              </div>
              {(!profile?.preferred_cuisines?.length && !profile?.food_type?.length) && (
                <div style={{ fontSize:12, color:C.muted, fontWeight:300, marginTop:8 }}>
                  No preferences set. <button onClick={()=>navigate('/profile')} style={{ background:'none', border:'none', color:C.jiff, cursor:'pointer', fontFamily:"'DM Sans',sans-serif", fontSize:12, fontWeight:500, textDecoration:'underline' }}>Set them now →</button>
                </div>
              )}
            </div>
            <div>
              <div style={{ fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase', color: C.jiff, fontWeight: 500, marginBottom: 10 }}>Servings</div>
              <div style={{ display: 'flex', alignItems: 'center', border: '1.5px solid ' + C.borderMid, borderRadius: 10, overflow: 'hidden' }}>
                <button onClick={() => setServings(s => Math.max(1, s - 1))} disabled={servings <= 1} style={{ width: 34, height: 34, background: 'white', border: 'none', fontSize: 18, color: C.jiff, cursor: 'pointer' }}>−</button>
                <div style={{ padding: '0 14px', fontSize: 15, fontWeight: 500, color: C.ink }}>{servings}</div>
                <button onClick={() => setServings(s => Math.min(12, s + 1))} disabled={servings >= 12} style={{ width: 34, height: 34, background: 'white', border: 'none', fontSize: 18, color: C.jiff, cursor: 'pointer' }}>+</button>
              </div>
            </div>
          </div>
        </div>

        {errorMsg && (
          <div style={{ background: '#FFF5F5', border: '1px solid rgba(229,62,62,0.3)', borderRadius: 12, padding: '12px 16px', marginBottom: 20, fontSize: 13, color: '#E53E3E' }}>
            {errorMsg} <button onClick={() => setErrorMsg('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#E53E3E', marginLeft: 8 }}>×</button>
          </div>
        )}

        {/* Latency warning */}
      {generating && genElapsed >= 12 && (
        <div style={{background:'rgba(255,69,0,0.07)',border:'1px solid rgba(255,69,0,0.2)',borderRadius:12,padding:'12px 16px',marginBottom:16,fontSize:13,color:'#CC3700',fontWeight:300,lineHeight:1.6}}>
          ⏳ Taking a bit longer ({genElapsed}s) — building your full 7-day plan… this usually takes 20–30 seconds.
        </div>
      )}

      {/* Plan cards grid */}
        {!plan && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {PLANS.map(p => <PlanCard key={p.id} plan={p} onGenerate={handleGenerate} generating={generating} />)}
          </div>
        )}

        {/* Generated plan results */}
        {plan && currentGoal && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h2 style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 900, color: C.ink, letterSpacing: '-0.5px', marginBottom: 4 }}>
                  {currentGoal.emoji} {currentGoal.title} Plan — ready ⚡
                </h2>
                <p style={{ fontSize: 13, color: C.muted, fontWeight: 300 }}>7 days · 21 meals · {servings} serving{servings > 1 ? 's' : ''} each</p>
              </div>
              <button onClick={() => { setPlan(null); setCurrentGoal(null); }} style={{ fontSize: 13, color: C.muted, background: 'none', border: '1.5px solid ' + C.borderMid, borderRadius: 10, padding: '8px 16px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
                ← Choose different plan
              </button>
            </div>

            {/* Day tabs */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
              {plan.map((day, i) => (
                <button key={day.day} onClick={() => setExpandedDay(i)}
                  style={{ padding: '7px 14px', borderRadius: 20, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", border: '1.5px solid ' + (expandedDay === i ? C.jiff : C.borderMid), background: expandedDay === i ? C.jiff : 'white', color: expandedDay === i ? 'white' : C.muted, transition: 'all 0.15s' }}>
                  {DAYS_SHORT[i]}
                </button>
              ))}
            </div>

            {/* Day detail */}
            {expandedDay !== null && plan[expandedDay] && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
                {MEAL_TYPES.map(type => {
                  const meal = plan[expandedDay].meals?.[type];
                  if (!meal) return null;
                  return (
                    <div key={type} style={{ background: 'white', border: '1px solid ' + C.border, borderRadius: 16, overflow: 'hidden', boxShadow: C.shadow }}>
                      <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid ' + C.border }}>
                        <div style={{ fontSize: 10, letterSpacing: '1.5px', textTransform: 'uppercase', fontWeight: 600, color: C.muted, marginBottom: 4 }}>
                          {MEAL_EMOJI[type]} {type}
                        </div>
                        <div style={{ fontFamily: "'Fraunces', serif", fontSize: 16, fontWeight: 700, color: C.ink, marginBottom: 4 }}>
                          {meal.emoji} {meal.name}
                        </div>
                        <div style={{ fontSize: 12, color: C.muted, fontWeight: 300 }}>⏱ {meal.time} · 🔥 {meal.calories} cal · 💪 {meal.protein}</div>
                      </div>
                      <div style={{ padding: '12px 16px' }}>
                        <p style={{ fontSize: 12, color: C.muted, fontWeight: 300, lineHeight: 1.6, marginBottom: 10 }}>{meal.description}</p>
                        <div style={{ fontSize: 10, letterSpacing: '1.5px', textTransform: 'uppercase', fontWeight: 600, color: C.jiff, marginBottom: 6 }}>Ingredients</div>
                        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                          {(meal.ingredients || []).slice(0, 5).map((ing, i) => (
                            <li key={i} style={{ fontSize: 12, color: C.ink, padding: '3px 0', borderBottom: '1px solid rgba(0,0,0,0.04)', fontWeight: 300, display: 'flex', gap: 6 }}>
                              <span style={{ color: C.jiff, fontSize: 14, lineHeight: 0, paddingTop: 7 }}>·</span>{ing}
                            </li>
                          ))}
                          {(meal.ingredients || []).length > 5 && <li style={{ fontSize: 11, color: C.muted, paddingTop: 4 }}>+{meal.ingredients.length - 5} more</li>}
                        </ul>
                        <div style={{ display:'flex', gap:6, marginTop:10, flexWrap:'wrap' }}>
                          <VideoButton recipeName={meal.name||''} compact={true}/>
                          <a href={'https://www.swiggy.com/search?query=' + (encodeURIComponent(meal.name||''))}
                            target="_blank" rel="noopener noreferrer"
                            style={{ padding:'5px 10px', borderRadius:8, border:'1px solid rgba(252,128,25,0.25)', background:'rgba(252,128,25,0.05)', color:'#FC8019', fontSize:11, fontWeight:500, textDecoration:'none' }}>
                            🛵 Order
                          </a>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
