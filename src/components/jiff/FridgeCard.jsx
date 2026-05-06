// src/components/jiff/FridgeCard.jsx
// Fridge / leftover input card — polished UI v2
// Modes: 'fridge' (cool green) | 'leftover' (amber) | 'direct' (neutral)

import IngredientInput   from '../IngredientInput';
import FridgePhotoUpload from '../FridgePhotoUpload';
import { QUICK_ADD_STAPLES, ALL_CUISINES } from '../../lib/cuisine.js';

const LEFTOVER_CHIPS = [
  'Leftover rice', 'Cooked dal', 'Rotis', 'Cooked chicken',
  'Boiled potato', 'Leftover curry', 'Cooked pasta', 'Bread slices',
];

const MODE_CONFIG = {
  fridge: {
    gradient: 'linear-gradient(135deg,rgba(29,158,117,0.10),rgba(29,158,117,0.04))',
    border:   'rgba(29,158,117,0.22)',
    accent:   '#1D9E75',
    icon:     '\u{1F9CA}',
    title:    "Cook with what I have",
    sub:      'Add what you have \u00b7 Jiff finds what to make',
    chipLabel:'Quick add',
  },
  leftover: {
    gradient: 'linear-gradient(135deg,rgba(217,119,6,0.10),rgba(251,191,36,0.05))',
    border:   'rgba(217,119,6,0.25)',
    accent:   '#D97706',
    icon:     '\u267b\ufe0f',
    title:    'Rescue your leftovers',
    sub:      "Tell Jiff what's left \u2014 it will turn it into something great",
    chipLabel:'Common leftovers',
  },
  direct: {
    gradient: 'linear-gradient(135deg,rgba(255,69,0,0.06),rgba(255,69,0,0.02))',
    border:   'rgba(255,69,0,0.15)',
    accent:   '#FF4500',
    icon:     '\u26a1',
    title:    "What's cooking?",
    sub:      'Add your ingredients \u00b7 Jiff does the rest',
    chipLabel:'Quick add',
  },
};

export default function FridgeCard({
  inputMode = 'fridge',
  fridgeItems, setFridgeItems,
  diet, setDiet, time, setTime, cuisine, setCuisine,
  defaultServings, setDefaultServings,
  profile, lang, user,
  isPremium, trialActive, PAID_RECIPE_CAP,
  ingredients, handleSubmit, setGateDismissed,
  navigate, t,
}) {
  const cfg = MODE_CONFIG[inputMode] || MODE_CONFIG.fridge;

  const quickAddItems = inputMode === 'leftover'
    ? LEFTOVER_CHIPS
        : QUICK_ADD_STAPLES.filter(s => !fridgeItems.includes(s)));

  const addItem = item => setFridgeItems(prev => [...new Set([...prev, item])]);

  const btnActive = ingredients.length > 0 && !!user;
  const btnLabel  = !user ? 'Sign in to cook'
    : !ingredients.length ? 'Add ingredients first'
    : inputMode === 'leftover' ? 'Rescue these leftovers'
    : 'Jiff it now!';

  return (
    <div style={{ background:'white', borderRadius:24, border:'1.5px solid ' + cfg.border, overflow:'hidden', boxShadow:'0 6px 28px rgba(28,10,0,0.08)' }}>

      {/* Mode header */}
      <div style={{ background:cfg.gradient, borderBottom:'1px solid ' + cfg.border, padding:'18px 20px 14px', display:'flex', alignItems:'flex-start', justifyContent:'space-between' }}>
        <div>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
            <span style={{ fontSize:22 }}>{cfg.icon}</span>
            <span style={{ fontFamily:"'Fraunces',serif", fontSize:18, fontWeight:900, color:'#1C0A00', letterSpacing:'-0.3px' }}>
              {cfg.title}
            </span>
          </div>
          <div style={{ fontSize:12, color:'#7C6A5E', fontWeight:300, paddingLeft:30 }}>{cfg.sub}</div>
        </div>
        <FridgePhotoUpload
          onIngredients={detected => setFridgeItems(prev => [...new Set([...prev, ...detected])])}
          existingIngredients={fridgeItems}
        />
      </div>

      {/* Ingredient input */}
      <div style={{ padding:'16px 18px 0' }}>
        <IngredientInput
          ingredients={fridgeItems}
          onChange={setFridgeItems}
          pantryIngredients={[]}
          placeholder={
            inputMode === 'leftover' ? 'leftover rice, dal, rotis, chicken...' :
            inputMode === 'fridge'   ? 'spinach, eggs, chicken, tomatoes...'  :
            'ingredients you have...'
          }
          lang={lang}
        />
      </div>

      {/* Quick-add chips */}
      <div style={{ padding:'10px 18px 0' }}>
        <div style={{ fontSize:9, letterSpacing:'1.5px', textTransform:'uppercase', color:cfg.accent, fontWeight:700, marginBottom:8 }}>
          {cfg.chipLabel}
        </div>
        <div style={{ display:'flex', gap:6, overflowX:'auto', paddingBottom:6, scrollbarWidth:'none', msOverflowStyle:'none' }}>
          {quickAddItems.filter(item => !fridgeItems.includes(item)).map(item => (
            <button key={item} onClick={() => addItem(item)}
              style={{ padding:'6px 13px', borderRadius:20, whiteSpace:'nowrap', border:'1.5px solid rgba(28,10,0,0.10)', background:'rgba(255,250,245,0.95)', fontSize:12, color:'#7C6A5E', cursor:'pointer', fontFamily:"'DM Sans',sans-serif", flexShrink:0, transition:'all 0.12s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor=cfg.accent; e.currentTarget.style.color=cfg.accent; e.currentTarget.style.background='white'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor='rgba(28,10,0,0.10)'; e.currentTarget.style.color='#7C6A5E'; e.currentTarget.style.background='rgba(255,250,245,0.95)'; }}>
              {'+ '}{item}
            </button>
          ))}
        </div>
      </div>


      {/* Filters */}
      <div style={{ padding:'14px 18px 0', display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10 }}>
        <div>
          <div style={{ fontSize:8, letterSpacing:'1.5px', textTransform:'uppercase', color:cfg.accent, fontWeight:700, marginBottom:6 }}>{'Diet'}</div>
          <select value={diet||'none'} onChange={e=>setDiet(e.target.value)}
            style={{ width:'100%', padding:'8px 6px', border:'1.5px solid rgba(28,10,0,0.10)', borderRadius:10, fontSize:12, fontFamily:"'DM Sans',sans-serif", background:'white', outline:'none', cursor:'pointer', color:'#1C0A00' }}>
            <option value="none">Any</option>
            <option value="vegetarian">Veg only</option>
            <option value="vegan">Vegan</option>
            <option value="jain">Jain</option>
            <option value="non-vegetarian">Non-veg</option>
          </select>
        </div>
        <div>
          <div style={{ fontSize:8, letterSpacing:'1.5px', textTransform:'uppercase', color:cfg.accent, fontWeight:700, marginBottom:6 }}>{'Serves'}</div>
          <div style={{ display:'flex', alignItems:'center', border:'1.5px solid rgba(28,10,0,0.10)', borderRadius:10, background:'white', overflow:'hidden', height:36 }}>
            <button onClick={()=>setDefaultServings(s=>Math.max(1,s-1))} disabled={defaultServings<=1}
              style={{ flex:1, border:'none', background:'none', fontSize:18, cursor:'pointer', color:'#7C6A5E', lineHeight:1, padding:0 }}>{'\u2212'}</button>
            <span style={{ flex:1, textAlign:'center', fontSize:14, fontWeight:700, color:'#1C0A00' }}>{defaultServings}</span>
            <button onClick={()=>setDefaultServings(s=>Math.min(12,s+1))} disabled={defaultServings>=12}
              style={{ flex:1, border:'none', background:'none', fontSize:18, cursor:'pointer', color:'#7C6A5E', lineHeight:1, padding:0 }}>{'+'}</button>
          </div>
        </div>
        <div>
          <div style={{ fontSize:8, letterSpacing:'1.5px', textTransform:'uppercase', color:cfg.accent, fontWeight:700, marginBottom:6 }}>{'Time'}</div>
          <select value={time} onChange={e=>setTime(e.target.value)}
            style={{ width:'100%', padding:'8px 6px', border:'1.5px solid rgba(28,10,0,0.10)', borderRadius:10, fontSize:12, fontFamily:"'DM Sans',sans-serif", background:'white', outline:'none', cursor:'pointer', color:'#1C0A00' }}>
            <option value="20 min">20 min</option>
            <option value="30 min">30 min</option>
            <option value="45 min">45 min</option>
            <option value="60 min">1 hour</option>
            <option value="any">Any time</option>
          </select>
        </div>
      </div>

      {/* Cuisine chips */}
      {profile?.preferred_cuisines?.length > 0 && (
        <div style={{ padding:'12px 18px 0' }}>
          <div style={{ fontSize:8, letterSpacing:'1.5px', textTransform:'uppercase', color:cfg.accent, fontWeight:700, marginBottom:8 }}>{'Cuisine'}</div>
          <div style={{ display:'flex', gap:6, overflowX:'auto', paddingBottom:4, scrollbarWidth:'none', msOverflowStyle:'none' }}>
            {profile.preferred_cuisines.map(id => {
              const label = ALL_CUISINES?.find(c=>c.id===id)?.label || id;
              const isActive = cuisine===id || (profile.preferred_cuisines.indexOf(id)===0 && cuisine==='any');
              return (
                <button key={id} onClick={()=>setCuisine(isActive?'any':id)}
                  style={{ padding:'6px 13px', borderRadius:20, whiteSpace:'nowrap', flexShrink:0, border:'1.5px solid ' + (isActive?cfg.accent:'rgba(28,10,0,0.10)'), background:isActive?cfg.accent+'15':'white', color:isActive?cfg.accent:'#7C6A5E', fontSize:12, cursor:'pointer', fontFamily:"'DM Sans',sans-serif", fontWeight:isActive?600:400, transition:'all 0.12s' }}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* CTA */}
      <div style={{ padding:'18px 18px 20px', textAlign:'center' }}>
        <button
          onClick={!user ? ()=>setGateDismissed(false) : handleSubmit}
          disabled={!btnActive}
          style={{ width:'100%', padding:'15px 24px', background:btnActive?cfg.accent:'rgba(28,10,0,0.08)', color:btnActive?'white':'#7C6A5E', border:'none', borderRadius:14, fontSize:16, fontFamily:"'DM Sans',sans-serif", fontWeight:600, cursor:btnActive?'pointer':'not-allowed', transition:'all 0.2s', display:'flex', alignItems:'center', justifyContent:'center', gap:10 }}>
          <span style={{ fontSize:20 }}>{'\u26a1'}</span>
          <span>{btnLabel}</span>
        </button>

        {!ingredients.length && user && (
          <p style={{ fontSize:12, color:'#7C6A5E', marginTop:8, fontWeight:300 }}>{t('cta_note')}</p>
        )}



        {trialActive && !isPremium && (
          <p style={{ fontSize:11, color:'#854F0B', marginTop:10, background:'rgba(255,184,0,0.10)', borderRadius:8, padding:'6px 12px', display:'inline-block' }}>
            {'\ud83c\udf81 Trial mode \u00b7 1 recipe preview \u00b7 '}
            <button onClick={()=>navigate('/pricing')} style={{ background:'none', border:'none', color:'#854F0B', cursor:'pointer', fontWeight:600, fontFamily:"'DM Sans',sans-serif", fontSize:'inherit', textDecoration:'underline' }}>
              {'Upgrade for '}{PAID_RECIPE_CAP}{' recipes \u2192'}
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
