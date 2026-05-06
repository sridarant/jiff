// src/pages/Planner.jsx — Week Planner v17
// Uses profile preferences; no fridge/pantry input; multi-cuisine ratio selection
import { useState, useRef, useEffect } from 'react';
import { MealSlot, GrocerySection, CuisineRatioSelector } from '../components/planner/PlannerComponents.jsx';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/common/PageHeader';
import { useLocale } from '../contexts/LocaleContext';
import { useAuth }   from '../contexts/AuthContext';
import { usePremium } from '../contexts/PremiumContext';
import { generatePlan } from '../services/plannerService';
import { trackPaywallShown, trackUpgradeClick } from '../lib/analytics';
import styles from '../styles/plannerStyles';


// ── Components + helpers → src/components/planner/PlannerComponents.jsx ──

// ── Main component ─────────────────────────────────────────────────
const MEAL_TYPE_OPTIONS = [
  { id:'breakfast', label:'Breakfast', emoji:'🌅', color:'#F59E0B' },
  { id:'lunch',     label:'Lunch',     emoji:'☀️', color:'#3B82F6' },
  { id:'dinner',    label:'Dinner',    emoji:'🌙', color:'#8B5CF6' },
  { id:'snack',     label:'Snack',     emoji:'🍎', color:'#10B981' },
];
const DAYS       = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const DAYS_SHORT = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

export default function Planner() {
  const navigate = useNavigate();
  const { isPremium, trialActive, PAID_RECIPE_CAP } = usePremium();
  const { profile } = useAuth();
  const { country } = useLocale();

  // Check profile completeness
  const hasProfile = profile && (profile.preferred_cuisines?.length || profile.food_type?.length);

  const [servings,      setServings]      = useState(2);
  const [selectedTypes, setSelectedTypes] = useState(['breakfast','lunch','dinner']);
  const [view,          setView]          = useState('input');
  const [plan,          setPlan]          = useState(null);
  const [loadingDay,    setLoadingDay]    = useState(0);
  const [activeDay,     setActiveDay]     = useState(0);
  const [showGrocery,   setShowGrocery]   = useState(false);
  const [errorMsg,      setErrorMsg]      = useState('');
  const timerRef = useRef(null);
  const [loadElapsed,  setLoadElapsed]   = useState(0);

  // Multi-cuisine ratio
  const cuisines = profile?.preferred_cuisines?.length ? profile.preferred_cuisines : ['any'];
  const [cuisineRatio, setCuisineRatio] = useState(() => {
    if (!profile?.preferred_cuisines?.length) return {};
    const even = Math.floor(7 / profile.preferred_cuisines.length);
    const r = {};
    profile.preferred_cuisines.forEach((c, i) => {
      r[c] = i === 0 ? 7 - even * (profile.preferred_cuisines.length - 1) : even;
    });
    return r;
  });

  const updateRatio = (cuisine, val) => setCuisineRatio(p => ({ ...p, [cuisine]: val }));
  const ratioTotal = Object.values(cuisineRatio).reduce((s,v)=>s+v,0);

  const toggleType = (id) => setSelectedTypes(prev =>
    prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
  );

  const handleSubmit = async () => {
    if (selectedTypes.length === 0) return;
    setView('loading'); setErrorMsg(''); setPlan(null);
    try {
      const data = await generatePlan({
        ingredients: [],
        mealTypes: selectedTypes,
        servings,
        cuisine: cuisines.join(', '),
        diet: Array.isArray(profile?.food_type) ? profile.food_type[0] : (profile?.food_type || 'none'),
        tasteProfile: {
          spice_level: profile?.spice_level,
          allergies: profile?.allergies,
          skill_level: profile?.skill_level,
          preferred_cuisines: cuisines,
        },
      });
      if (data.plan) { setPlan(data.plan); setView('results'); }
      else { setErrorMsg(data.error || 'Could not generate plan. Please try again.'); setView('error'); }
    } catch { setErrorMsg('Connection error. Please try again.'); setView('error'); }
  };

  useEffect(() => {
    if (view==='loading') {
      let d=0; timerRef.current=setInterval(()=>{d++;setLoadingDay(d);if(d>=7)clearInterval(timerRef.current);},1100);
      const startTs = Date.now();
      const elapsedT = setInterval(() => setLoadElapsed(Math.floor((Date.now()-startTs)/1000)), 1000);
      return () => { clearInterval(timerRef.current); clearInterval(elapsedT); setLoadElapsed(0); };
    }
    return ()=>clearInterval(timerRef.current);
  }, [view]);

  const mealCount = selectedTypes.length * 7;

  return (
    <>
      <style>{styles}</style>
      <div className="page">
        <PageHeader title="Week Planner" backTo='/plan' backLabel='← Plan' />

        {!isPremium && !trialActive && (
          <div style={{ margin:'12px 16px 0', padding:'12px 16px', background:'rgba(255,69,0,0.06)', border:'1.5px solid rgba(255,69,0,0.2)', borderRadius:12, display:'flex', alignItems:'center', justifyContent:'space-between', gap:10 }}>
            <div>
              <div style={{ fontSize:13, color:'#CC3700', fontWeight:600 }}>{'⚡ Premium feature'}</div>
              <div style={{ fontSize:11, color:'#7C6A5E', fontWeight:300, marginTop:2 }}>{'Full week planner requires a premium subscription'}</div>
            </div>
            <button onClick={() => { trackUpgradeClick('planner_gate'); navigate('/pricing'); }}
              style={{ background:'#FF4500', color:'white', border:'none', borderRadius:8, padding:'7px 16px', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:"'DM Sans',sans-serif", flexShrink:0, whiteSpace:'nowrap' }}>
              {'Upgrade →'}
            </button>
          </div>
        )}

        {/* No profile — redirect prompt */}
        {!hasProfile && (
          <div className="profile-redirect">
            <div style={{fontSize:32,marginBottom:12}}>👤</div>
            <div style={{fontFamily:"'Fraunces',serif",fontSize:18,fontWeight:900,color:'#1C0A00',marginBottom:6}}>Set up your profile first</div>
            <div style={{fontSize:13,color:'#7C6A5E',fontWeight:300,marginBottom:16,lineHeight:1.6}}>
              Week Plan uses your cuisine preferences and dietary settings to build your 7-day menu. Complete your profile to get started.
            </div>
            <button onClick={()=>navigate('/profile')} style={{background:'#FF4500',color:'white',border:'none',borderRadius:10,padding:'11px 24px',fontSize:13,fontWeight:500,cursor:'pointer',fontFamily:"'DM Sans',sans-serif"}}>
              Set up preferences →
            </button>
          </div>
        )}

        {hasProfile && view==='input' && (
          <>
            <div className="hero">
              <div className="hero-eyebrow">Plan once, eat well all week</div>
              <h1 className="hero-title">7 days.<br /><em>Your meals sorted.</em></h1>
              <p className="hero-sub">Jiff builds your entire week's menu from your preferences — cuisines, dietary needs, spice level and skill. No fridge input needed.</p>
            </div>
            <div className="card">
              {/* Meal type */}
              <div className="section">
                <div className="section-label">Which meals to plan?</div>
                <div className="meal-type-grid">
                  {MEAL_TYPE_OPTIONS.map(mt=>{
                    const sel=selectedTypes.includes(mt.id);
                    return(
                      <div key={mt.id} className={`meal-type-toggle ${sel?'selected':''}`}
                        style={sel?{borderColor:mt.color,background:mt.bg,color:mt.dark}:{}}
                        onClick={()=>toggleType(mt.id)}>
                        <span className="meal-type-toggle-emoji">{mt.emoji}</span>
                        <span className="meal-type-toggle-label">{mt.label}</span>
                        <div className="meal-type-toggle-check" style={sel?{borderColor:mt.color,background:mt.color}:{}}>
                          {sel&&<svg width="10" height="10" viewBox="0 0 12 12"><polyline points="10 2 5 9 2 6" stroke="white" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="cta-note" style={{textAlign:'left',marginTop:8}}>{selectedTypes.length} meal type{selectedTypes.length!==1?'s':''} · {mealCount} meals total</p>
              </div>

              {/* Servings */}
              <div className="section">
                <div className="section-label">Servings per meal</div>
                <div className="serving-controls">
                  <button className="serving-btn" disabled={servings<=1} onClick={()=>setServings(s=>Math.max(1,s-1))}>−</button>
                  <div className="serving-count">{servings}</div>
                  <button className="serving-btn" disabled={servings>=12} onClick={()=>setServings(s=>Math.min(12,s+1))}>+</button>
                  <span style={{fontSize:12,color:'#7C6A5E',fontWeight:300,marginLeft:8}}>serving{servings!==1?'s':''} — all recipes sized for {servings} {servings===1?'person':'people'}</span>
                </div>
              </div>

              {/* Cuisine ratio — only if multiple cuisines */}
              {cuisines.length > 1 && cuisines[0] !== 'any' && (
                <div className="section">
                  <div className="section-label">Days per cuisine</div>
                  <CuisineRatioSelector cuisines={cuisines} ratio={cuisineRatio} onChange={updateRatio} />
                </div>
              )}
              {cuisines.length === 1 && cuisines[0] !== 'any' && (
                <div style={{fontSize:12,color:'#7C6A5E',fontWeight:300,marginBottom:12,padding:'8px 12px',background:'rgba(255,69,0,0.04)',borderRadius:8}}>
                  All 7 days: <strong>{cuisines[0]}</strong> cuisine · based on your preference
                </div>
              )}

              <div className="cta-wrap">
                <button className="cta-btn" onClick={handleSubmit} disabled={selectedTypes.length===0 || (cuisines.length>1 && ratioTotal!==7)}>
                  <span>📅</span>
                  <span>Plan my week</span>
                </button>
                {cuisines.length > 1 && ratioTotal !== 7 && (
                  <p className="cta-note">Assign all 7 days across your cuisines to continue</p>
                )}
              </div>
            </div>
          </>
        )}

        {view==='loading' && (
          <div className="loading-wrap">
            <div className="loading-title">Building your week…</div>
            <div className="loading-sub">Planning {mealCount} meals across 7 days — usually takes 20–30 seconds. ({loadElapsed}s)</div>
            <div className="loading-days">
              {DAYS_SHORT.map((d,i)=>(
                <div key={d} className={`loading-day ${i<loadingDay?'done':''}`}>{i<loadingDay?'✓':d}</div>
              ))}
            </div>
          </div>
        )}

        {view==='error' && (
          <div className="error-wrap">
            <div style={{fontSize:40,marginBottom:12}}>⚠️</div>
            <div className="error-title">Couldn't build your plan</div>
            <div className="error-msg">{errorMsg}</div>
            <button className="cta-btn" onClick={()=>setView('input')}>← Try again</button>
          </div>
        )}

        {view==='results' && plan && (
          <div style={{padding:'16px 20px', maxWidth:720, margin:'0 auto', paddingBottom:80}}>
            {/* Plan header */}
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
              <div>
                <div style={{fontFamily:"'Fraunces',serif",fontSize:20,fontWeight:700,color:'#1C0A00'}}>
                  Your 7-day menu ⚡
                </div>
                <div style={{fontSize:12,color:'#7C6A5E',fontWeight:300}}>
                  {mealCount} meals · {servings} serving{servings!==1?'s':''} each
                </div>
              </div>
              <div style={{display:'flex',gap:8}}>
                <button onClick={()=>setShowGrocery(p=>!p)}
                  style={{
                    padding:'7px 12px',fontSize:12,border:'1px solid rgba(28,10,0,0.12)',
                    borderRadius:8,background:showGrocery?'rgba(255,69,0,0.07)':'white',
                    color:showGrocery?'#FF4500':'#7C6A5E',cursor:'pointer',
                    fontFamily:"'DM Sans',sans-serif",
                  }}>
                  🛒 {showGrocery?'Hide':'Grocery'}
                </button>
                <button onClick={handleSubmit}
                  style={{
                    padding:'7px 14px',fontSize:12,background:'#FF4500',color:'white',
                    border:'none',borderRadius:8,cursor:'pointer',fontWeight:500,
                    fontFamily:"'DM Sans',sans-serif",
                  }}>
                  ⚡ Regenerate
                </button>
              </div>
            </div>

            {/* Week strip — emoji + cooked status */}
            <div style={{
              display:'grid',gridTemplateColumns:'repeat(7,1fr)',
              gap:4,marginBottom:20,
            }}>
              {DAYS.map((day,i) => {
                const meals = plan[day]?.meals || {};
                const firstMeal = Object.values(meals)[0];
                const emoji = firstMeal?.emoji || '🍽️';
                const isToday = i === new Date().getDay() - 1;
                return (
                  <button key={day} onClick={()=>setActiveDay(i)}
                    style={{
                      display:'flex',flexDirection:'column',alignItems:'center',gap:3,
                      padding:'8px 4px',borderRadius:12,
                      border:'1.5px solid ' + (activeDay===i?'#FF4500':'rgba(28,10,0,0.08)'),
                      background:activeDay===i?'rgba(255,69,0,0.06)':isToday?'rgba(255,184,0,0.06)':'white',
                      cursor:'pointer',fontFamily:"'DM Sans',sans-serif",
                    }}>
                    <span style={{fontSize:9,color:'#7C6A5E',fontWeight:500}}>
                      {DAYS_SHORT[i]}
                    </span>
                    <span style={{fontSize:16}}>{emoji}</span>
                  </button>
                );
              })}
            </div>

            {/* Accordion — active day expanded, rest collapsed */}
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              {DAYS.map((day,i) => {
                const dayPlan = plan[day];
                const isOpen = activeDay === i;
                const firstEmoji = Object.values(dayPlan?.meals||{})[0]?.emoji||'🍽️';
                return (
                  <div key={day} style={{
                    background:'white',border:'1px solid rgba(28,10,0,0.08)',
                    borderRadius:14,overflow:'hidden',
                    boxShadow: isOpen?'0 4px 16px rgba(28,10,0,0.07)':'none',
                    transition:'box-shadow 0.15s',
                  }}>
                    {/* Day header — always visible */}
                    <button onClick={()=>setActiveDay(isOpen?-1:i)}
                      style={{
                        width:'100%',padding:'14px 16px',
                        display:'flex',alignItems:'center',gap:10,
                        border:'none',background:'none',cursor:'pointer',
                        fontFamily:"'DM Sans',sans-serif",
                      }}>
                      <span style={{fontSize:20}}>{firstEmoji}</span>
                      <div style={{flex:1,textAlign:'left'}}>
                        <div style={{fontSize:14,fontWeight:600,color:'#1C0A00'}}>
                          {day}
                        </div>
                        {!isOpen && (
                          <div style={{fontSize:11,color:'#7C6A5E',fontWeight:300}}>
                            {Object.values(dayPlan?.meals||{}).map(m=>m?.name).filter(Boolean).slice(0,2).join(' · ')}
                          </div>
                        )}
                      </div>
                      <span style={{
                        fontSize:16,color:'#7C6A5E',
                        transform:isOpen?'rotate(180deg)':'none',
                        transition:'transform 0.2s',
                      }}>▾</span>
                    </button>

                    {/* Expanded day content */}
                    {isOpen && (
                      <div style={{borderTop:'1px solid rgba(28,10,0,0.06)',padding:'0 0 4px'}}>
                        {selectedTypes.map(type => {
                          const mt = MEAL_TYPE_OPTIONS.find(m=>m.id===type);
                          const meal = dayPlan?.meals?.[type];
                          return (
                            <div key={type} style={{
                              padding:'12px 16px',
                              borderBottom:'1px solid rgba(28,10,0,0.04)',
                            }}>
                              <div style={{
                                fontSize:10,letterSpacing:'1px',textTransform:'uppercase',
                                color:mt?.color||'#FF4500',fontWeight:600,marginBottom:6,
                              }}>
                                {mt?.emoji} {mt?.label}
                              </div>
                              {meal ? (
                                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10}}>
                                  <div>
                                    <div style={{fontSize:14,fontWeight:600,color:'#1C0A00'}}>
                                      {meal.emoji} {meal.name}
                                    </div>
                                    <div style={{fontSize:11,color:'#7C6A5E',marginTop:2}}>
                                      {meal.time && `⏱ ${meal.time}`}
                                      {meal.calories && ` · ~${meal.calories} kcal`}
                                    </div>
                                  </div>
                                  <button
                                    onClick={()=>navigate('/app',{state:{generateContext:{dish:meal.name,type:'planner'}}})}
                                    style={{
                                      padding:'6px 12px',fontSize:11,
                                      background:'rgba(255,69,0,0.07)',
                                      border:'1px solid rgba(255,69,0,0.2)',
                                      borderRadius:8,color:'#FF4500',
                                      cursor:'pointer',fontWeight:500,
                                      fontFamily:"'DM Sans',sans-serif",
                                      flexShrink:0,
                                    }}>
                                    Cook this →
                                  </button>
                                </div>
                              ) : (
                                <div style={{fontSize:12,color:'#7C6A5E',fontStyle:'italic'}}>
                                  Not planned
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {showGrocery && <GrocerySection plan={plan} mealTypes={selectedTypes}/>}
          </div>
        )}
      </div>
    </>
  );
}
