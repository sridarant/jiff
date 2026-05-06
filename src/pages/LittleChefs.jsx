// src/pages/LittleChefs.jsx — Child-led cooking (guided activity)
// Special step format: simplified language, safety warnings, adult notes
// Mobile-first

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/common/PageHeader';
import { useAuth }     from '../contexts/AuthContext';
import { generateMeal } from '../services/recipeService';

const C = {
  jiff:'#FF4500', ink:'#1C0A00', cream:'#FFFAF5',
  muted:'#7C6A5E', border:'rgba(28,10,0,0.08)',
  green:'#1D9E75', purple:'#7C3AED', gold:'#D97706',
};

const AGE_GROUPS = [
  { id:'4to6',  label:'4–6 yrs',  emoji:'🧒', note:'Simple mixing & assembling only' },
  { id:'7to10', label:'7–10 yrs', emoji:'🧑', note:'Supervised cutting & light cooking' },
  { id:'11to14',label:'11–14 yrs',emoji:'👦', note:'More independence with adult nearby'  },
];
const SKILL_LEVELS = [
  { id:'first_timer', label:'First timer', emoji:'⭐', desc:'Never cooked before' },
  { id:'can_help',    label:'Can help',    emoji:'⭐⭐', desc:'Has helped in kitchen' },
  { id:'solo',        label:'Going solo',  emoji:'⭐⭐⭐', desc:'Ready to cook with guidance' },
];

// Special Little Chefs step card — bigger text, safety callouts, fun language
function ChefStep({ step, num, total }) {
  const [done, setDone] = useState(false);
  const isSafe = step.toLowerCase().includes('careful') ||
                 step.toLowerCase().includes('hot') ||
                 step.toLowerCase().includes('adult') ||
                 step.toLowerCase().includes('knife') ||
                 step.toLowerCase().includes('oven');

  return (
    <div style={{
      padding:'16px', marginBottom:10,
      background: done ? 'rgba(29,158,117,0.06)' : 'white',
      border:'2px solid ' + (done ? C.green : isSafe ? 'rgba(217,119,6,0.3)' : C.border),
      borderRadius:16, transition:'all 0.2s',
    }}>
      <div style={{ display:'flex', alignItems:'flex-start', gap:12 }}>
        <button onClick={() => setDone(d => !d)}
          style={{
            width:32, height:32, borderRadius:'50%', flexShrink:0,
            border:'2px solid ' + (done ? C.green : C.border),
            background: done ? C.green : 'white',
            color: done ? 'white' : C.muted,
            fontSize:16, cursor:'pointer', display:'flex',
            alignItems:'center', justifyContent:'center',
            transition:'all 0.15s',
          }}>
          {done ? '✓' : num}
        </button>
        <div style={{ flex:1 }}>
          {isSafe && (
            <div style={{
              fontSize:10, fontWeight:700, color:C.gold,
              letterSpacing:'1px', textTransform:'uppercase', marginBottom:5,
            }}>
              ⚠️ Ask an adult for help
            </div>
          )}
          <div style={{
            fontSize: 16, color: done ? C.muted : C.ink,
            fontWeight:400, lineHeight:1.6,
            textDecoration: done ? 'line-through' : 'none',
            transition:'all 0.15s',
          }}>
            {step}
          </div>
        </div>
      </div>
    </div>
  );
}

// Special recipe card for Little Chefs
function ChefRecipeCard({ meal }) {
  const [showSteps, setShowSteps] = useState(false);
  if (!meal) return null;

  return (
    <div style={{
      background:'white', border:'1px solid ' + (C.border),
      borderRadius:20, overflow:'hidden', marginBottom:16,
      fontFamily:"'DM Sans',sans-serif",
    }}>
      {/* Header */}
      <div style={{ padding:'20px', background:'linear-gradient(135deg,rgba(124,58,237,0.06),rgba(255,69,0,0.04))' }}>
        <div style={{ fontSize:40, marginBottom:8 }}>{meal.emoji || '🍳'}</div>
        <div style={{ fontFamily:"'Fraunces',serif", fontSize:22, fontWeight:700, color:C.ink, marginBottom:4 }}>
          {meal.name}
        </div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
          {meal.time && (
            <span style={{ fontSize:12, color:C.muted, background:'rgba(28,10,0,0.05)', borderRadius:20, padding:'3px 10px' }}>
              ⏱ {meal.time}
            </span>
          )}
          {meal.difficulty && (
            <span style={{ fontSize:12, color:C.purple, background:'rgba(124,58,237,0.08)', borderRadius:20, padding:'3px 10px' }}>
              🌟 {meal.difficulty}
            </span>
          )}
        </div>
      </div>

      {/* What you need */}
      {meal.ingredients?.length > 0 && (
        <div style={{ padding:'16px 20px', borderBottom:`1px solid ${C.border}` }}>
          <div style={{ fontSize:12, fontWeight:700, color:C.ink, letterSpacing:'0.5px', marginBottom:10 }}>
            🛒 What you need:
          </div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
            {(meal.ingredients || []).map((ing, i) => (
              <span key={i} style={{
                fontSize:12, padding:'4px 10px',
                background:'rgba(28,10,0,0.04)', borderRadius:20,
                color:C.ink, border:'1px solid ' + (C.border),
              }}>
                {typeof ing === 'string' ? ing : ((ing.qty || '') + ' ' + (ing.name || ing))}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Steps */}
      <div style={{ padding:'16px 20px' }}>
        <button onClick={() => setShowSteps(s => !s)}
          style={{
            width:'100%', padding:'13px', background:showSteps ? 'rgba(124,58,237,0.07)' : C.jiff,
            color: showSteps ? C.purple : 'white',
            border:'2px solid ' + (showSteps ? 'rgba(124,58,237,0.3)' : 'transparent'),
            borderRadius:12, fontSize:14, fontWeight:600,
            cursor:'pointer', fontFamily:"'DM Sans',sans-serif",
            marginBottom: showSteps ? 16 : 0, transition:'all 0.15s',
          }}>
          {showSteps ? '▲ Hide steps' : "👨‍🍳 Let's cook! — Show steps →"}
        </button>

        {showSteps && (meal.steps || meal.method || []).map((step, i) => (
          <ChefStep
            key={i}
            step={typeof step === 'string' ? step : step.instruction || step.text || String(step)}
            num={i + 1}
            total={(meal.steps || meal.method || []).length}
          />
        ))}
      </div>
    </div>
  );
}

export default function LittleChefs() {
  const navigate  = useNavigate();
  const { profile } = useAuth();

  const [age,   setAge]   = useState('7to10');
  const [skill, setSkill] = useState('can_help');
  const [view,  setView]  = useState('input');
  const [meals, setMeals] = useState([]);
  const [error, setError] = useState('');

  const handleGenerate = async () => {
    setView('loading'); setError('');
    const selectedAge   = AGE_GROUPS.find(a => a.id === age);
    const selectedSkill = SKILL_LEVELS.find(s => s.id === skill);
    try {
      const meals = await generateMeal({
        ingredients: [],
        time: '30 min', servings: 2, count: 3, kidsMode: true,
        kidsPromptOverride: `You are a fun cooking teacher for children. Generate exactly 3 simple recipes for a child aged ${selectedAge?.label||'7-10 yrs'}, skill level: ${selectedSkill?.label||'can help'}. Age notes: ${selectedAge?.note||''}. Mark heat/knife steps with [ASK AN ADULT]. Use short encouraging steps. Return ONLY this JSON, no other text: {"meals":[{"name":"Name","time":"15 min","servings":2,"description":"Short fun description","ingredients":["1 cup item"],"method":["Step text"],"nutrition":{"calories":200,"protein":"5g","carbs":"30g","fat":"8g"}}]}`,
      }, profile);
      setMeals(meals);
      setView('results');
    } catch {
      setError('Could not load recipes. Please try again.');
      setView('error');
    }
  };

  return (
    <div style={{ minHeight:'100vh', background:C.cream, fontFamily:"'DM Sans',sans-serif", paddingBottom:80 }}>
      <PageHeader title="🧑‍🍳 Little Chefs" backTo='/plan' backLabel='← Plan' />

      <div style={{ padding:'24px 20px', maxWidth:520, margin:'0 auto' }}>

        {view === 'input' && (
          <>
            <div style={{ fontFamily:"'Fraunces',serif", fontSize:22, fontWeight:900, color:C.ink, marginBottom:6 }}>
              Let's cook together! 🧑‍🍳
            </div>
            <div style={{ fontSize:13, color:C.muted, fontWeight:300, marginBottom:24, lineHeight:1.6 }}>
              Recipes written for kids to follow — simple steps, safety tips, and lots of encouragement.
            </div>

            <div style={{ fontSize:11, letterSpacing:'1.5px', textTransform:'uppercase', color:C.muted, fontWeight:600, marginBottom:10 }}>How old is your little chef?</div>
            <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:24 }}>
              {AGE_GROUPS.map(a => (
                <button key={a.id} onClick={() => setAge(a.id)}
                  style={{
                    display:'flex', alignItems:'center', gap:12, padding:'13px 16px',
                    border:'2px solid ' + (age===a.id ? C.purple : C.border),
                    borderRadius:14, background: age===a.id ? 'rgba(124,58,237,0.06)' : 'white',
                    cursor:'pointer', fontFamily:"'DM Sans',sans-serif", transition:'all 0.12s',
                  }}>
                  <span style={{ fontSize:22 }}>{a.emoji}</span>
                  <div style={{ textAlign:'left' }}>
                    <div style={{ fontSize:14, fontWeight: age===a.id ? 600 : 400, color: age===a.id ? C.purple : C.ink }}>{a.label}</div>
                    <div style={{ fontSize:11, color:C.muted, fontWeight:300 }}>{a.note}</div>
                  </div>
                </button>
              ))}
            </div>

            <div style={{ fontSize:11, letterSpacing:'1.5px', textTransform:'uppercase', color:C.muted, fontWeight:600, marginBottom:10 }}>Cooking experience</div>
            <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:28 }}>
              {SKILL_LEVELS.map(s => (
                <button key={s.id} onClick={() => setSkill(s.id)}
                  style={{
                    display:'flex', alignItems:'center', gap:12, padding:'12px 16px',
                    border:'2px solid ' + (skill===s.id ? C.purple : C.border),
                    borderRadius:14, background: skill===s.id ? 'rgba(124,58,237,0.06)' : 'white',
                    cursor:'pointer', fontFamily:"'DM Sans',sans-serif", transition:'all 0.12s',
                  }}>
                  <span style={{ fontSize:18 }}>{s.emoji}</span>
                  <div style={{ textAlign:'left' }}>
                    <div style={{ fontSize:14, fontWeight: skill===s.id ? 600 : 400, color: skill===s.id ? C.purple : C.ink }}>{s.label}</div>
                    <div style={{ fontSize:11, color:C.muted, fontWeight:300 }}>{s.desc}</div>
                  </div>
                </button>
              ))}
            </div>

            <button onClick={handleGenerate}
              style={{
                width:'100%', padding:'15px',
                background:'linear-gradient(135deg,#7C3AED,#FF4500)',
                color:'white', border:'none', borderRadius:14,
                fontSize:15, fontWeight:600, cursor:'pointer',
                fontFamily:"'DM Sans',sans-serif",
              }}>
              Find a recipe to cook →
            </button>
          </>
        )}

        {view === 'loading' && (
          <div style={{ textAlign:'center', padding:'60px 20px' }}>
            <div style={{ fontSize:52, marginBottom:16 }}>🧑‍🍳</div>
            <div style={{ fontFamily:"'Fraunces',serif", fontSize:20, fontWeight:700, color:C.ink, marginBottom:8 }}>
              Finding something fun to cook together…
            </div>
            <div style={{ fontSize:13, color:C.muted, fontWeight:300 }}>
              Writing kid-friendly steps with safety tips
            </div>
          </div>
        )}

        {view === 'error' && (
          <div style={{ textAlign:'center', padding:'60px 20px' }}>
            <div style={{ fontSize:40, marginBottom:12 }}>⚠️</div>
            <div style={{ fontSize:13, color:C.muted, marginBottom:20 }}>{error}</div>
            <button onClick={() => setView('input')} style={{ padding:'10px 20px', background:C.jiff, color:'white', border:'none', borderRadius:10, fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:"'DM Sans',sans-serif" }}>Try again</button>
          </div>
        )}

        {view === 'results' && (
          <>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
              <div style={{ fontFamily:"'Fraunces',serif", fontSize:20, fontWeight:700, color:C.ink }}>
                Ready to cook! 🧑‍🍳
              </div>
              <button onClick={() => setView('input')} style={{ padding:'7px 12px', fontSize:12, background:'none', border:'1px solid ' + (C.border), borderRadius:8, color:C.muted, cursor:'pointer', fontFamily:"'DM Sans',sans-serif" }}>↺ Cook something else</button>
            </div>
            {(Array.isArray(meals) ? meals : []).map((meal, i) => <ChefRecipeCard key={i} meal={meal} />)}
            {meals.length === 0 && (
              <div style={{ textAlign:'center', padding:'40px', color:C.muted }}>No recipes found. Try again.</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
