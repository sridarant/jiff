// src/components/profile/TasteTab.jsx
import { useRef } from 'react';
import CuisineSelector from './CuisineSelector';

const DIET_OPTS = [
  { id:'veg',          label:'Vegetarian',   emoji:'🥦' },
  { id:'non-veg',      label:'Non-veg',       emoji:'🍗' },
  { id:'vegan',        label:'Vegan',         emoji:'🌱' },
  { id:'eggetarian',   label:'Eggetarian',    emoji:'🥚' },
  { id:'jain',         label:'Jain',          emoji:'🪷' },
];
const SPICE = [
  { id:'mild',    label:'Mild',    emoji:'😌' },
  { id:'medium',  label:'Medium',  emoji:'🙂' },
  { id:'hot',     label:'Hot',     emoji:'🌶️' },
  { id:'extra',   label:'Extra hot',emoji:'🔥' },
];
const SKILL = [
  { id:'beginner',   label:'Beginner',       emoji:'🌱' },
  { id:'home_cook',  label:'Home cook',      emoji:'🍳' },
  { id:'confident',  label:'Confident cook', emoji:'👨‍🍳' },
  { id:'advanced',   label:'Advanced',       emoji:'⭐' },
];

export default function TasteTab({
  foodType, setFoodType,
  spiceLevel, setSpiceLevel,
  skillLevel, setSkillLevel,
  allergies = [], setAllergies,
  allergyInput, setAllergyInput,
  prefCuisines, setPrefCuisines,
  pill, C,
}) {
  const allergyRef = useRef(null);
  return (
    <div>
      <SectionLabel C={C}>Diet type</SectionLabel>
      <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:24 }}>
        {DIET_OPTS.map(opt => (
          <button key={opt.id} onClick={() => setFoodType([opt.id])}
            style={{ ...pill(foodType.includes(opt.id)), display:'flex', alignItems:'center', gap:5 }}>
            <span>{opt.emoji}</span>{opt.label}
          </button>
        ))}
      </div>

      <SectionLabel C={C}>Spice level</SectionLabel>
      <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:24 }}>
        {SPICE.map(s => (
          <button key={s.id} onClick={() => setSpiceLevel(s.id)}
            style={{ ...pill(spiceLevel === s.id), display:'flex', alignItems:'center', gap:5 }}>
            <span>{s.emoji}</span>{s.label}
          </button>
        ))}
      </div>

      <SectionLabel C={C}>Cooking skill</SectionLabel>
      <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:24 }}>
        {SKILL.map(s => (
          <button key={s.id} onClick={() => setSkillLevel(s.id)}
            style={{ ...pill(skillLevel === s.id), display:'flex', alignItems:'center', gap:5 }}>
            <span>{s.emoji}</span>{s.label}
          </button>
        ))}
      </div>

      <SectionLabel C={C}>Allergies / foods to avoid</SectionLabel>
      <div onClick={() => allergyRef.current?.focus()}
        style={{ border:'1.5px solid ' + C.borderMid, borderRadius:12, padding:'10px 12px', background:C.cream, minHeight:50, display:'flex', flexWrap:'wrap', gap:6, alignItems:'flex-start', cursor:'text', marginBottom:24 }}>
        {allergies.map(a => (
          <span key={a} style={{ background:C.ink, color:'white', padding:'4px 10px 4px 12px', borderRadius:20, fontSize:12, display:'flex', alignItems:'center', gap:5 }}>
            {a}
            <button onClick={() => setAllergies(p => p.filter(x => x !== a))}
              style={{ background:'none', border:'none', color:'rgba(255,255,255,0.7)', cursor:'pointer', padding:0, fontSize:14, lineHeight:1 }}>{'✕'}</button>
          </span>
        ))}
        <input ref={allergyRef} value={allergyInput} onChange={e => setAllergyInput(e.target.value)}
          onKeyDown={e => {
            if ((e.key === 'Enter' || e.key === ',') && allergyInput.trim()) {
              e.preventDefault();
              setAllergies(p => [...p, allergyInput.trim()]);
              setAllergyInput('');
            }
          }}
          placeholder="e.g. peanuts, shellfish…"
          style={{ border:'none', outline:'none', fontSize:13, fontFamily:"'DM Sans',sans-serif", flex:1, minWidth:140, background:'transparent', padding:'3px 0' }}
        />
      </div>

      <SectionLabel C={C}>Cuisine preferences</SectionLabel>
      <div style={{ fontSize:12, color:C.muted, marginBottom:12, fontWeight:300 }}>
        These form your pool — used across all journey tiles and the per-session picker
      </div>
      <CuisineSelector selected={prefCuisines} onChange={setPrefCuisines} />
    </div>
  );
}

function SectionLabel({ children, C }) {
  return (
    <div style={{ fontSize:10, letterSpacing:'1.5px', textTransform:'uppercase', color:C.jiff, fontWeight:700, marginBottom:10, display:'flex', alignItems:'center', gap:8 }}>
      {children}
      <div style={{ flex:1, height:1, background:C.border }} />
    </div>
  );
}
