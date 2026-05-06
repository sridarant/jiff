// src/pages/KidsDishes.jsx — Kid-safe recipe generation (parent flow)
// Age-appropriate, nutritious, fun presentation

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/common/PageHeader';
import { useAuth }     from '../contexts/AuthContext';
import { MealCard }    from '../components/meal/MealCard.jsx';
import { generateMeal } from '../services/recipeService';

const C = {
  jiff:'#FF4500', ink:'#1C0A00', cream:'#FFFAF5',
  muted:'#7C6A5E', border:'rgba(28,10,0,0.08)', gold:'#D97706',
};

const AGES = [
  { id:'2to5',  label:'2–5 yrs',  emoji:'🍼', prompt:'very soft textures, no choking hazards, mild flavours, finger food friendly, fun colours' },
  { id:'6to10', label:'6–10 yrs', emoji:'🧒', prompt:'mild spice, fun shapes or names, hidden vegetables, nutritious, easy to eat'               },
  { id:'11plus',label:'11+ yrs',  emoji:'🧑', prompt:'more variety, slightly bolder flavours, still nutritious, can handle some complexity'       },
];
const OCCASIONS = [
  { id:'everyday', label:'Everyday meal', emoji:'🍽️' },
  { id:'party',    label:'Party or treat', emoji:'🎉' },
  { id:'snack',    label:'Snack time',    emoji:'🍎' },
  { id:'sick',     label:'Not feeling well',emoji:'🤒' },
];

export default function KidsDishes() {
  const navigate = useNavigate();
  const { profile } = useAuth();

  const [age,      setAge]      = useState('6to10');
  const [occasion, setOccasion] = useState('everyday');
  const [view,     setView]     = useState('input');
  const [meals,    setMeals]    = useState([]);
  const [error,    setError]    = useState('');

  const handleGenerate = async () => {
    setView('loading'); setError('');
    const selectedAge = AGES.find(a => a.id === age);
    const selectedOcc = OCCASIONS.find(o => o.id === occasion);
    try {
      const meals = await generateMeal({
        ingredients: [],
        cuisine: 'kid-friendly',
        time: '30 min', servings: 2, count: 4,
        kidsMode: true,
        kidsPromptOverride: `Generate exactly 4 kid-friendly recipes for ${selectedAge?.label||'7-10'} children. Occasion: ${selectedOcc?.label||'any'}. Rules: safe temps, appropriate textures, nutritious, fun names kids love. Return ONLY this JSON: {"meals":[{"name":"Fun Name","time":"20 min","servings":2,"description":"Yummy description","ingredients":["1 cup item"],"method":["Step text"],"nutrition":{"calories":250,"protein":"8g","carbs":"35g","fat":"10g"}}]}`,
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
      <PageHeader title="👶 Dishes for Kids" backTo='/plan' backLabel='← Plan' />

      <div style={{ padding:'24px 20px', maxWidth:520, margin:'0 auto' }}>

        {view === 'input' && (
          <>
            <div style={{ fontFamily:"'Fraunces',serif", fontSize:22, fontWeight:900, color:C.ink, marginBottom:6 }}>
              Cooking for the little ones
            </div>
            <div style={{ fontSize:13, color:C.muted, fontWeight:300, marginBottom:24 }}>
              Age-appropriate, nutritious, and actually kid-approved.
            </div>

            <div style={{ fontSize:11, letterSpacing:'1.5px', textTransform:'uppercase', color:C.muted, fontWeight:600, marginBottom:10 }}>Age group</div>
            <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:24 }}>
              {AGES.map(a => (
                <button key={a.id} onClick={() => setAge(a.id)}
                  style={{
                    display:'flex', alignItems:'center', gap:12, padding:'13px 16px',
                    border:'2px solid ' + (age===a.id ? C.jiff : C.border),
                    borderRadius:14, background: age===a.id ? 'rgba(255,69,0,0.06)' : 'white',
                    cursor:'pointer', fontFamily:"'DM Sans',sans-serif", transition:'all 0.12s',
                  }}>
                  <span style={{ fontSize:22 }}>{a.emoji}</span>
                  <span style={{ fontSize:14, fontWeight: age===a.id ? 600 : 400, color: age===a.id ? C.jiff : C.ink }}>
                    {a.label}
                  </span>
                </button>
              ))}
            </div>

            <div style={{ fontSize:11, letterSpacing:'1.5px', textTransform:'uppercase', color:C.muted, fontWeight:600, marginBottom:10 }}>Occasion</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:8, marginBottom:28 }}>
              {OCCASIONS.map(o => (
                <button key={o.id} onClick={() => setOccasion(o.id)}
                  style={{
                    padding:'13px 12px', border:'2px solid ' + (occasion===o.id ? C.jiff : C.border),
                    borderRadius:14, background: occasion===o.id ? 'rgba(255,69,0,0.06)' : 'white',
                    cursor:'pointer', fontFamily:"'DM Sans',sans-serif", transition:'all 0.12s',
                    display:'flex', flexDirection:'column', alignItems:'flex-start', gap:6, minHeight:70,
                  }}>
                  <span style={{ fontSize:22 }}>{o.emoji}</span>
                  <span style={{ fontSize:12, fontWeight: occasion===o.id ? 600 : 400, color: occasion===o.id ? C.jiff : C.ink }}>
                    {o.label}
                  </span>
                </button>
              ))}
            </div>

            <button onClick={handleGenerate}
              style={{
                width:'100%', padding:'15px', background:C.jiff, color:'white',
                border:'none', borderRadius:14, fontSize:15, fontWeight:600,
                cursor:'pointer', fontFamily:"'DM Sans',sans-serif",
              }}>
              Find kid-friendly recipes →
            </button>
          </>
        )}

        {view === 'loading' && (
          <div style={{ textAlign:'center', padding:'60px 20px' }}>
            <div style={{ fontSize:52, marginBottom:16 }}>👶</div>
            <div style={{ fontFamily:"'Fraunces',serif", fontSize:20, fontWeight:700, color:C.ink, marginBottom:8 }}>
              Finding kid-friendly ideas…
            </div>
            <div style={{ fontSize:13, color:C.muted, fontWeight:300 }}>
              Making sure everything is safe and delicious
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
                Kid-approved recipes 👶
              </div>
              <button onClick={() => setView('input')} style={{ padding:'7px 12px', fontSize:12, background:'none', border:'1px solid ' + (C.border), borderRadius:8, color:C.muted, cursor:'pointer', fontFamily:"'DM Sans',sans-serif" }}>↺ Cook something else</button>
            </div>
            {(Array.isArray(meals) ? meals : []).map((meal, i) => (
              <MealCard key={i} meal={meal} isFav={false} onToggleFav={()=>{}} rating={0} onRate={()=>{}} pantry={[]} />
            ))}
            {meals.length === 0 && (
              <div style={{ textAlign:'center', padding:'40px 20px', color:C.muted }}>No recipes found. Try again.</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
