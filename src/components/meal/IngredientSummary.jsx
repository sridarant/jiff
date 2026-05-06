// src/components/meal/IngredientSummary.jsx
// Post-decision ingredient check — shown immediately after user taps "Cook this".
//
// Shows:
//   "You're missing 2 ingredients: paneer, cream"
//   OR "You have everything for this recipe!"
//
// Uses buildGroceryList (same as GroceryPanel) for matching.
// Keeps it light — no persistence, no complex inventory.
// "Show alternatives" opens a simple inline suggestion per missing item.

import { useState } from 'react';
import { buildGroceryList } from '../../lib/grocery.js';
import { scaleIngredient } from '../../lib/scaling.js';

// Default staples — pre-selected as "have" in the ingredient check UI.
const DEFAULT_STAPLES = [
  'oil', 'salt', 'water', 'onion', 'garlic', 'ginger',
  'tomato', 'green chilli', 'turmeric', 'cumin', 'mustard seeds',
  'coriander powder', 'red chilli powder', 'garam masala',
  'curry leaves', 'sugar', 'rice', 'dal', 'atta', 'ghee',
];

// Simple substitutions for common missing items
const SUBSTITUTIONS = {
  'paneer':       'tofu or crumbled cottage cheese',
  'cream':        'thick coconut milk or yoghurt',
  'butter':       'ghee or oil',
  'milk':         'thin coconut milk',
  'yoghurt':      'sour cream or buttermilk',
  'curd':         'yoghurt or sour cream',
  'coconut milk': 'cream with a little desiccated coconut',
  'cashews':      'almonds or skip for a lighter dish',
  'almonds':      'cashews or pumpkin seeds',
  'cheese':       'paneer',
  'sour cream':   'thick yoghurt',
  'lemon':        'lime or a little vinegar',
};

function getSubstitution(ingredientName) {
  const name = (ingredientName || '').toLowerCase();
  return Object.entries(SUBSTITUTIONS).find(([key]) => name.includes(key))?.[1] || null;
}

export default function IngredientSummary({ ingredients = [], pantry = [], scale = 1, units, onDismiss }) {
  const [expandedItem, setExpandedItem] = useState(null);

  // Use user's pantry if provided, else fall back to defaults
  const effectivePantry = (pantry && pantry.length > 0) ? pantry : DEFAULT_STAPLES;

  const { need, have } = buildGroceryList(ingredients, effectivePantry);

  if (ingredients.length === 0) return null;

  const allGood = need.length === 0;

  return (
    <div style={{
      borderRadius: 12,
      padding: '12px 14px',
      marginBottom: 14,
      background: allGood ? 'rgba(29,158,117,0.05)' : 'rgba(255,69,0,0.04)',
      border: '1px solid ' + (allGood ? 'rgba(29,158,117,0.2)' : 'rgba(255,69,0,0.18)'),
      fontFamily: "'DM Sans', sans-serif",
      position: 'relative',
    }}>
      {/* Dismiss */}
      <button
        onClick={onDismiss}
        style={{ position:'absolute', top:8, right:10, background:'none', border:'none', cursor:'pointer', fontSize:14, color:'rgba(28,10,0,0.3)', lineHeight:1, padding:'0 2px' }}>
        {'×'}
      </button>

      {allGood ? (
        /* All ingredients available */
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontSize:18 }}>{'✅'}</span>
          <div>
            <div style={{ fontSize:13, fontWeight:600, color:'#065F46' }}>
              {"You have everything for this recipe!"}
            </div>
            <div style={{ fontSize:11, color:'#7C6A5E', marginTop:2 }}>
              {have.length + ' ingredient'+ (have.length !== 1 ? 's' : '') + ' available'}
            </div>
          </div>
        </div>
      ) : (
        /* Some items missing */
        <div>
          {/* Summary line */}
          <div style={{ display:'flex', alignItems:'flex-start', gap:10, marginBottom:10 }}>
            <span style={{ fontSize:18, flexShrink:0 }}>{'🛒'}</span>
            <div>
              <div style={{ fontSize:13, fontWeight:600, color:'#1C0A00' }}>
                {"You're missing "}
                <span style={{ color:'#FF4500' }}>{need.length}</span>
                {' ingredient'+ (need.length !== 1 ? 's' : '') + ':'}
              </div>
              {have.length > 0 && (
                <div style={{ fontSize:11, color:'#7C6A5E', marginTop:2 }}>
                  {have.length + ' already available'}
                </div>
              )}
            </div>
          </div>

          {/* Missing items list */}
          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
            {need.map((item, i) => {
              const sub = getSubstitution(item);
              const isOpen = expandedItem === i;
              return (
                <div key={i}>
                  <div style={{
                    display:'flex', alignItems:'center', justifyContent:'space-between',
                    background:'white', borderRadius:8, padding:'7px 10px',
                    border:'1px solid rgba(255,69,0,0.12)',
                  }}>
                    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                      <span style={{ fontSize:10, color:'#FF4500', fontWeight:700 }}>{'•'}</span>
                      <span style={{ fontSize:12, color:'#1C0A00' }}>{item}</span>
                    </div>
                    {sub && (
                      <button
                        onClick={() => setExpandedItem(isOpen ? null : i)}
                        style={{
                          background:'none', border:'none', cursor:'pointer',
                          fontSize:11, color:'#FF4500', fontWeight:500,
                          fontFamily:"'DM Sans',sans-serif", padding:'0 2px',
                          touchAction:'manipulation', whiteSpace:'nowrap',
                        }}>
                        {isOpen ? 'Hide' : 'Alternative ↓'}
                      </button>
                    )}
                  </div>
                  {isOpen && sub && (
                    <div style={{
                      fontSize:11, color:'#7C6A5E', fontStyle:'italic',
                      padding:'5px 10px 4px 26px', lineHeight:1.5,
                    }}>
                      {'Try: '}<span style={{ color:'#1C0A00', fontWeight:500, fontStyle:'normal' }}>{sub}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Quick summary line */}
          <div style={{ marginTop:10, fontSize:11, color:'#7C6A5E', lineHeight:1.5 }}>
            {need.length === 1
              ? 'Just one item to grab — or try the alternative above.'
              : 'Grab these before you start, or use the alternatives.'}
          </div>
        </div>
      )}
    </div>
  );
}
