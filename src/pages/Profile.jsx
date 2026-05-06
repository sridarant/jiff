// src/pages/Profile.jsx — "Your Preferences" merged settings screen.
// Single scrollable page, 5 sections, sticky save. Max-width 480px.
// Cuisine model: 6 primary groups; sub-cuisines revealed only when a primary is selected.

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth }   from '../contexts/AuthContext';
import { useLocale } from '../contexts/LocaleContext';
import { parseFoodTypeIds } from '../lib/dietary';
import { requestPermission, isNotificationsEnabled, setNotificationsEnabled } from '../lib/notificationService.js';

const C = {
  jiff:'#FF4500', jiffDark:'#CC3700', ink:'#1C0A00',
  cream:'#FFFAF5', muted:'#7C6A5E',
  border:'rgba(28,10,0,0.08)', borderMid:'rgba(28,10,0,0.15)',
};

// ── Cuisine model ─────────────────────────────────────────────────
// 6 primary groups — labels EXACTLY as specified
const PRIMARY_CUISINES = [
  { id:'south_indian', label:'South Indian',  emoji:'🥥' },
  { id:'north_indian', label:'North Indian',  emoji:'🌾' },
  { id:'west_indian',  label:'Western India', emoji:'🌶️' },
  { id:'east_indian',  label:'Eastern India', emoji:'🐟' },
  { id:'northeast',    label:'North-East India', emoji:'🍃' },
  { id:'global',       label:'Global',        emoji:'🌍' },
];

// Sub-cuisines keyed by primary ID — EXACT mapping as specified
const SUB_CUISINE_MAP = {
  south_indian: [
    { id:'tamil_nadu', label:'Tamil Nadu'   },
    { id:'kerala',     label:'Kerala'       },
    { id:'karnataka',  label:'Karnataka'    },
    { id:'andhra',     label:'Andhra'       },
  ],
  north_indian: [
    { id:'punjabi',    label:'Punjabi'      },
    { id:'rajasthani', label:'Rajasthani'   },
  ],
  west_indian: [
    { id:'gujarati',      label:'Gujarati'     },
    { id:'maharashtrian', label:'Maharashtrian' },
  ],
  east_indian: [
    { id:'bengali',    label:'Bengali'      },
  ],
  northeast: [
    { id:'assamese',   label:'Assamese'     },
    { id:'manipuri',   label:'Manipuri'     },
  ],
  global: [
    { id:'italian',    label:'Italian'      },
    { id:'chinese',    label:'Chinese'      },
    { id:'mexican',    label:'Mexican'      },
  ],
};

const MAX_CUISINES = 4;

const DIET_OPTS = [
  { id:'veg',        label:'Vegetarian', emoji:'🥦' },
  { id:'non-veg',    label:'Non-veg',    emoji:'🍗' },
  { id:'vegan',      label:'Vegan',      emoji:'🌱' },
  { id:'eggetarian', label:'Eggetarian', emoji:'🥚' },
  { id:'jain',       label:'Jain',       emoji:'🪷' },
];

const SPICE_OPTS = [
  { id:'mild',   label:'Mild'   },
  { id:'medium', label:'Medium' },
  { id:'hot',    label:'Hot'    },
];

const STYLE_OPTS = [
  { id:'beginner',  label:'Quick',        sub:'Under 20 min' },
  { id:'home_cook', label:'Balanced',      sub:'20–35 min'   },
  { id:'advanced',  label:'Enjoy cooking', sub:'Any time'    },
];

const GOAL_OPTS = [
  { id:'eat_healthier',  label:'Eat healthy',      emoji:'🥗' },
  { id:'cook_faster',    label:'Save time',         emoji:'⚡' },
  { id:'family',         label:'Cook for family',   emoji:'👨‍👩‍👧' },
  { id:'try_new_things', label:'Try something new', emoji:'🌍' },
];

const LANG_OPTS = [
  { code:'en', label:'English' },
  { code:'hi', label:'हिन्दी' },
  { code:'ta', label:'தமிழ்'  },
  { code:'bn', label:'বাংলা'  },
  { code:'te', label:'తెలుగు' },
  { code:'kn', label:'ಕನ್ನಡ'  },
];

const REGION_OPTS = [
  { id:'IN', label:'India 🇮🇳'     },
  { id:'GB', label:'UK 🇬🇧'        },
  { id:'US', label:'US 🇺🇸'        },
  { id:'AU', label:'Australia 🇦🇺' },
  { id:'SG', label:'Singapore 🇸🇬' },
  { id:'AE', label:'UAE 🇦🇪'       },
];

// ── UI primitives ─────────────────────────────────────────────────
function SectionLabel({ children }) {
  return (
    <div style={{ fontSize:10, letterSpacing:'2px', textTransform:'uppercase', color:C.muted, fontWeight:600, marginBottom:12, marginTop:4 }}>
      {children}
    </div>
  );
}

function RadioRow({ options, selected, onSelect }) {
  return (
    <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
      {options.map(opt => {
        const active = selected === opt.id;
        return (
          <button key={opt.id} onClick={() => onSelect(opt.id)}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 14px', borderRadius:20, border:'1.5px solid '+(active?C.jiff:C.border), background:active?'rgba(255,69,0,0.07)':'white', color:active?C.jiff:C.ink, fontSize:13, fontWeight:active?600:400, cursor:'pointer', fontFamily:"'DM Sans',sans-serif", transition:'all 0.12s' }}>
            {opt.emoji && <span>{opt.emoji}</span>}
            <span>{opt.label}</span>
            {opt.sub && <span style={{ fontSize:10, color:active?C.jiff:C.muted }}>{'· '+opt.sub}</span>}
          </button>
        );
      })}
    </div>
  );
}

function ChipRow({ options, selected, onToggle, max = 99 }) {
  return (
    <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
      {options.map(opt => {
        const active   = Array.isArray(selected) ? selected.includes(opt.id) : selected === opt.id;
        const disabled = !active && Array.isArray(selected) && selected.length >= max;
        return (
          <button key={opt.id} onClick={() => !disabled && onToggle(opt.id)}
            style={{ display:'flex', alignItems:'center', gap:5, padding:'6px 13px', borderRadius:20, border:'1.5px solid '+(active?C.jiff:C.border), background:active?'rgba(255,69,0,0.07)':'white', color:active?C.jiff:(disabled?C.border:C.ink), fontSize:12, fontWeight:active?600:400, cursor:disabled?'default':'pointer', fontFamily:"'DM Sans',sans-serif", opacity:disabled?0.45:1, transition:'all 0.12s' }}>
            {opt.emoji && <span>{opt.emoji}</span>}
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function Toggle({ value, onChange, label, sub }) {
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 0', borderBottom:'1px solid '+C.border }}>
      <div>
        <div style={{ fontSize:13, fontWeight:500, color:C.ink }}>{label}</div>
        {sub && <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>{sub}</div>}
      </div>
      <button onClick={() => onChange(!value)}
        style={{ width:44, height:24, borderRadius:12, background:value?C.jiff:'rgba(28,10,0,0.12)', border:'none', cursor:'pointer', position:'relative', transition:'background 0.2s', flexShrink:0 }}>
        <div style={{ position:'absolute', top:2, left:value?22:2, width:20, height:20, borderRadius:'50%', background:'white', transition:'left 0.2s', boxShadow:'0 1px 4px rgba(0,0,0,0.18)' }} />
      </button>
    </div>
  );
}

function Collapsible({ label, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom:24 }}>
      <button onClick={() => setOpen(v => !v)}
        style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 0', background:'none', border:'none', borderBottom:'1px solid '+C.border, cursor:'pointer', fontFamily:"'DM Sans',sans-serif" }}>
        <span style={{ fontSize:13, fontWeight:600, color:C.ink }}>{label}</span>
        <span style={{ fontSize:13, color:C.muted, display:'inline-block', transform:open?'rotate(180deg)':'none', transition:'transform 0.2s' }}>{'▾'}</span>
      </button>
      {open && <div style={{ paddingTop:14 }}>{children}</div>}
    </div>
  );
}

// ── CuisineSelector ───────────────────────────────────────────────
// Step 1: user selects a primary group (South Indian, North Indian, etc.)
// Step 2: sub-cuisines for THAT group appear below — no other sub-cuisines visible
// Step 3: user picks up to MAX_CUISINES total across all selections
// Deselecting a primary collapses its sub-cuisines and removes them from selection
function CuisineSelector({ selected, onChange }) {
  // Which primary group is currently expanded for sub-cuisine selection
  // null = none expanded
  const [expandedPrimary, setExpandedPrimary] = useState(null);

  const togglePrimary = (id) => {
    if (expandedPrimary === id) {
      // Collapse — also deselect the primary and any of its sub-cuisines
      const subIds = (SUB_CUISINE_MAP[id] || []).map(s => s.id);
      onChange(selected.filter(c => c !== id && !subIds.includes(c)));
      setExpandedPrimary(null);
    } else {
      // Expand this primary
      setExpandedPrimary(id);
      // Add the primary ID to selection if room and not already selected
      if (!selected.includes(id) && selected.length < MAX_CUISINES) {
        onChange([...selected, id]);
      }
    }
  };

  const toggleSub = (subId, primaryId) => {
    if (selected.includes(subId)) {
      // Remove sub — also remove primary if it was only there as a placeholder
      onChange(selected.filter(c => c !== subId));
    } else {
      if (selected.length >= MAX_CUISINES) return;
      // Replace the parent primary placeholder with the specific sub
      const withoutParent = selected.filter(c => c !== primaryId);
      onChange([...withoutParent, subId]);
    }
  };

  const isPrimaryActive = (id) => {
    const subIds = (SUB_CUISINE_MAP[id] || []).map(s => s.id);
    return selected.includes(id) || subIds.some(s => selected.includes(s));
  };

  const totalSelected = selected.length;

  return (
    <div>
      {/* Label — EXACT copy as specified */}
      <div style={{ fontSize:12, color:C.muted, marginBottom:10 }}>
        {'What do you usually enjoy? (pick up to 4)'}
      </div>

      {/* Step 1: primary groups — always visible */}
      <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:12 }}>
        {PRIMARY_CUISINES.map(opt => {
          const active   = isPrimaryActive(opt.id);
          const expanded = expandedPrimary === opt.id;
          const disabled = !active && totalSelected >= MAX_CUISINES;
          return (
            <button
              key={opt.id}
              onClick={() => !disabled && togglePrimary(opt.id)}
              style={{
                display:'flex', alignItems:'center', gap:5,
                padding:'7px 14px', borderRadius:20,
                border:'1.5px solid '+(active?C.jiff:C.border),
                background:active?'rgba(255,69,0,0.07)':'white',
                color:active?C.jiff:(disabled?C.border:C.ink),
                fontSize:12, fontWeight:active?600:400,
                cursor:disabled?'default':'pointer',
                fontFamily:"'DM Sans',sans-serif",
                opacity:disabled?0.45:1,
                transition:'all 0.12s',
              }}>
              <span>{opt.emoji}</span>
              <span>{opt.label}</span>
              {(SUB_CUISINE_MAP[opt.id] || []).length > 0 && (
                <span style={{ fontSize:9, color:active?C.jiff:C.muted, transition:'transform 0.15s', display:'inline-block', transform:expanded?'rotate(180deg)':'none' }}>{'▾'}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Step 2: sub-cuisines — ONLY shown for the currently expanded primary */}
      {expandedPrimary && SUB_CUISINE_MAP[expandedPrimary] && (
        <div style={{
          background:'rgba(255,69,0,0.03)',
          border:'1px solid rgba(255,69,0,0.12)',
          borderRadius:12,
          padding:'12px 14px',
          marginBottom:8,
        }}>
          <div style={{ fontSize:10, color:C.muted, marginBottom:10, letterSpacing:'1px', textTransform:'uppercase', fontWeight:600 }}>
            {PRIMARY_CUISINES.find(p => p.id === expandedPrimary)?.label}
          </div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
            {SUB_CUISINE_MAP[expandedPrimary].map(sub => {
              const active   = selected.includes(sub.id);
              const disabled = !active && totalSelected >= MAX_CUISINES;
              return (
                <button
                  key={sub.id}
                  onClick={() => !disabled && toggleSub(sub.id, expandedPrimary)}
                  style={{
                    padding:'5px 12px', borderRadius:20,
                    border:'1.5px solid '+(active?C.jiff:'rgba(28,10,0,0.12)'),
                    background:active?'rgba(255,69,0,0.07)':'white',
                    color:active?C.jiff:(disabled?C.border:C.ink),
                    fontSize:12, fontWeight:active?600:400,
                    cursor:disabled?'default':'pointer',
                    fontFamily:"'DM Sans',sans-serif",
                    opacity:disabled?0.45:1,
                    transition:'all 0.12s',
                  }}>
                  {sub.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Selection counter */}
      {totalSelected > 0 && (
        <div style={{ fontSize:11, color:C.muted, marginTop:4 }}>
          {totalSelected}{' of '}{MAX_CUISINES}{' selected'}
          {totalSelected >= MAX_CUISINES && (
            <span style={{ color:C.jiff, marginLeft:6 }}>{'— max reached'}</span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main screen ───────────────────────────────────────────────────
export default function Profile() {
  const navigate  = useNavigate();
  const { user, profile, updateProfile } = useAuth();
  const { lang, setLang, country, setCountry } = useLocale();

  const [diet,        setDiet]        = useState('veg');
  const [spice,       setSpice]       = useState('medium');
  const [style,       setStyle]       = useState('home_cook');
  const [goal,        setGoal]        = useState('');
  const [hasKids,     setHasKids]     = useState(false);
  const [allergies,   setAllergies]   = useState('');
  const [cuisines,    setCuisines]    = useState([]);
  const [region,      setRegion]      = useState('IN');
  const [notifsOn,    setNotifsOn]    = useState(isNotificationsEnabled());
  const [notifBreakfast, setNotifBreakfast] = useState(() => { try { return localStorage.getItem('jiff-notif-breakfast') !== 'false'; } catch { return true; } });
  const [notifLunch,     setNotifLunch]     = useState(() => { try { return localStorage.getItem('jiff-notif-lunch')     !== 'false'; } catch { return true; } });
  const [notifDinner,    setNotifDinner]    = useState(() => { try { return localStorage.getItem('jiff-notif-dinner')    !== 'false'; } catch { return true; } });
  const [saving,      setSaving]      = useState(false);
  const [saved,       setSaved]       = useState(false);

  // Load from profile
  useEffect(() => {
    if (!profile) return;
    const ids = parseFoodTypeIds(profile.food_type);
    if (ids.length) setDiet(ids[0] || 'veg');
    if (profile.spice_level)                setSpice(profile.spice_level);
    if (profile.skill_level)                setStyle(profile.skill_level);
    if (profile.active_goal)                setGoal(profile.active_goal);
    if (profile.has_kids !== undefined)     setHasKids(!!profile.has_kids);
    if (profile.allergies?.length)          setAllergies(profile.allergies.join(', '));
    if (profile.preferred_cuisines?.length) setCuisines(profile.preferred_cuisines);
    if (profile.country)                    setRegion(profile.country);
  }, [profile]);



  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    const allergyList = allergies.split(',').map(a => a.trim()).filter(Boolean);
    try {
      await updateProfile({
        food_type:          [diet],
        spice_level:        spice,
        skill_level:        style,
        active_goal:        goal,
        has_kids:           hasKids,
        allergies:          allergyList,
        preferred_cuisines: cuisines,
        country:            region,
      });
      setCountry(region);
      setNotificationsEnabled(notifsOn);
      try { localStorage.setItem('jiff-notif-breakfast', notifBreakfast ? 'true' : 'false'); } catch {}
      try { localStorage.setItem('jiff-notif-lunch',     notifLunch     ? 'true' : 'false'); } catch {}
      try { localStorage.setItem('jiff-notif-dinner',    notifDinner    ? 'true' : 'false'); } catch {}
      if (notifsOn) await requestPermission();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {}
    setSaving(false);
  };



  return (
    <div style={{ minHeight:'100vh', background:C.cream, fontFamily:"'DM Sans',sans-serif", color:C.ink, paddingBottom:90 }}>

      {/* Header */}
      <header style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 16px', borderBottom:'1px solid '+C.border, position:'sticky', top:0, zIndex:10, background:'rgba(255,250,245,0.97)', backdropFilter:'blur(10px)' }}>
        <button onClick={() => navigate('/app')}
          style={{ background:'none', border:'none', cursor:'pointer', fontSize:20, color:C.muted, padding:'4px 2px', lineHeight:1 }}>
          {'←'}
        </button>
        <span style={{ fontFamily:"'Fraunces',serif", fontSize:17, fontWeight:700, color:C.ink }}>{'Your Preferences'}</span>
        <div style={{ width:40 }} />
      </header>

      <div style={{ maxWidth:480, margin:'0 auto', padding:'20px 16px' }}>

        {/* ── SECTION 1: Quick Setup ───────────────────────── */}
        <div style={{ marginBottom:28 }}>
          <SectionLabel>{'Quick setup'}</SectionLabel>

          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:12, color:C.muted, marginBottom:8 }}>{'Diet'}</div>
            <RadioRow options={DIET_OPTS} selected={diet} onSelect={setDiet} />
          </div>

          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:12, color:C.muted, marginBottom:8 }}>{'Spice level'}</div>
            <RadioRow options={SPICE_OPTS} selected={spice} onSelect={setSpice} />
          </div>

          <div style={{ marginBottom:4 }}>
            <div style={{ fontSize:12, color:C.muted, marginBottom:8 }}>{'Cooking style'}</div>
            <RadioRow options={STYLE_OPTS} selected={style} onSelect={setStyle} />
          </div>
        </div>

        {/* ── SECTION 2: Goal ──────────────────────────────── */}
        <div style={{ marginBottom:28 }}>
          <SectionLabel>{'My goal'}</SectionLabel>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
            {GOAL_OPTS.map(opt => {
              const active = goal === opt.id;
              return (
                <button key={opt.id} onClick={() => setGoal(active ? '' : opt.id)}
                  style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 14px', borderRadius:12, border:'1.5px solid '+(active?C.jiff:C.border), background:active?'rgba(255,69,0,0.07)':'white', cursor:'pointer', fontFamily:"'DM Sans',sans-serif", textAlign:'left', transition:'all 0.12s' }}>
                  <span style={{ fontSize:20 }}>{opt.emoji}</span>
                  <span style={{ fontSize:13, fontWeight:active?600:400, color:active?C.jiff:C.ink }}>{opt.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── SECTION 3: Tell Jiff more (collapsible) ─────── */}
        <Collapsible label="Tell Jiff more">
          <Toggle value={hasKids} onChange={setHasKids}
            label="Kids in the household"
            sub="Suggests mild, easy-to-eat options" />

          <div style={{ paddingTop:14, marginBottom:14 }}>
            <div style={{ fontSize:12, color:C.muted, marginBottom:8 }}>{'Allergies or avoids (comma separated)'}</div>
            <input
              value={allergies} onChange={e => setAllergies(e.target.value)}
              placeholder="e.g. peanuts, shellfish"
              style={{ width:'100%', padding:'9px 12px', borderRadius:10, border:'1px solid '+C.border, fontSize:13, fontFamily:"'DM Sans',sans-serif", color:C.ink, background:'white', boxSizing:'border-box', outline:'none' }}
            />
          </div>

          <CuisineSelector selected={cuisines} onChange={setCuisines} />
        </Collapsible>

        
        {/* ── SECTION 5: Language / Region / Notifications ─── */}
        <div style={{ marginBottom:28 }}>
          <SectionLabel>{'Language & region'}</SectionLabel>

          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:12, color:C.muted, marginBottom:8 }}>{'Language'}</div>
            <ChipRow
              options={LANG_OPTS.map(l => ({ id:l.code, label:l.label }))}
              selected={[lang]}
              onToggle={(code) => { if (typeof setLang === 'function') setLang(code); }}
            />
          </div>

          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:12, color:C.muted, marginBottom:8 }}>{'Region'}</div>
            <ChipRow options={REGION_OPTS} selected={[region]} onToggle={setRegion} />
          </div>

          <Toggle
            value={notifsOn}
            onChange={async (val) => { setNotifsOn(val); setNotificationsEnabled(val); if (val) await requestPermission(); }}
            label="Enable meal reminders"
            sub="Master toggle — turn all on or off"
          />
          {notifsOn && (
            <div style={{ marginTop:8, paddingLeft:4 }}>
              <Toggle value={notifBreakfast} onChange={setNotifBreakfast} label="Breakfast reminder" sub="7–9 AM" />
              <Toggle value={notifLunch}     onChange={setNotifLunch}     label="Lunch reminder"     sub="12–2 PM" />
              <Toggle value={notifDinner}    onChange={setNotifDinner}    label="Dinner reminder"    sub="6–8 PM" />
            </div>
          )}
        </div>

      </div>

      {/* Sticky save button */}
      <div style={{ position:'fixed', bottom:0, left:0, right:0, background:'rgba(255,250,245,0.97)', borderTop:'1px solid '+C.border, padding:'12px 16px', zIndex:50 }}>
        <div style={{ maxWidth:480, margin:'0 auto' }}>
          <button onClick={handleSave} disabled={saving || !user}
            style={{ width:'100%', padding:'13px', borderRadius:13, background:saved?'#1D9E75':(saving||!user)?C.muted:C.jiff, color:'white', border:'none', fontSize:14, fontWeight:700, cursor:(saving||!user)?'default':'pointer', fontFamily:"'DM Sans',sans-serif", transition:'background 0.2s' }}>
            {saving ? 'Saving…' : saved ? '✔ Saved' : user ? 'Save preferences' : 'Sign in to save'}
          </button>
        </div>
      </div>

    </div>
  );
}
