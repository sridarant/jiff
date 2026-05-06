import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/common/PageHeader';
import { useAuth } from '../contexts/AuthContext';
import { fetchHistory, deleteHistoryEntry } from '../services/historyService';

const C = {
  jiff:'#FF4500', jiffDark:'#CC3700', ink:'#1C0A00',
  cream:'#FFFAF5', warm:'#FFF0E5', muted:'#7C6A5E',
  border:'rgba(28,10,0,0.10)', borderMid:'rgba(28,10,0,0.18)',
  shadow:'0 4px 28px rgba(28,10,0,0.08)',
  green:'#1D9E75', greenBg:'rgba(29,158,117,0.08)',
};

const MEAL_COLORS = {
  breakfast:{ bg:'#FFF3E0', text:'#E65100', dot:'#FF9800' },
  lunch:    { bg:'#E8F5E9', text:'#1B5E20', dot:'#4CAF50' },
  dinner:   { bg:'#EDE7F6', text:'#311B92', dot:'#673AB7' },
  snack:    { bg:'#FCE4EC', text:'#880E4F', dot:'#E91E63' },
  any:      { bg:'#FFF0E5', text:'#CC3700', dot:'#FF4500' },
};

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins  < 60)  return mins + 'm ago';
  if (hours < 24)  return hours + 'h ago';
  if (days  < 7)   return days + 'd ago';
  return new Date(iso).toLocaleDateString('en-IN', { day:'numeric', month:'short' });
}

export default function History() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [history,  setHistory]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState('');
  const [filter,   setFilter]   = useState('all');  // all | breakfast | lunch | dinner | snack
  const [expanded, setExpanded] = useState(null);
  const [deleting, setDeleting] = useState(null);

  useEffect(() => {
    // Always load localStorage history first (instant, works offline)
    const local = JSON.parse(localStorage.getItem('jiff-history') || '[]');
    if (local.length) setHistory(local);

    if (!user) { setLoading(false); return; }
    // Also fetch from server if available
    fetchHistory(user.id)
      .then(serverHistory => {
        if (serverHistory.length) {
          const serverIds = new Set(serverHistory.map(h => h.id));
          const merged = [...serverHistory, ...local.filter(h => !serverIds.has(h.id))];
          merged.sort((a, b) => new Date(b.generated_at) - new Date(a.generated_at));
          setHistory(merged);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [user]);

  const handleDelete = async (id) => {
    setDeleting(id);
    await deleteHistoryEntry(id, user.id);
    setHistory(prev => prev.filter(h => h.id !== id));
    setDeleting(null);
  };

  const handleReGenerate = (entry) => {
    // Navigate to app with pre-filled ingredients
    const params = new URLSearchParams({
      ingredients: (entry.ingredients || []).join(','),
      cuisine:     entry.cuisine || 'any',
      mealType:    entry.meal_type || 'any',
    });
    navigate(`/app?prefill=${encodeURIComponent(params.toString())}`);
  };

  // Filter + search
  const filtered = history.filter(h => {
    const mealNames = Array.isArray(h.meal)
      ? (Array.isArray(h.meal) ? h.meal : h.meals || [h.meal]).filter(Boolean).map(m => m?.name||'').join(' ')
      : (h.meal?.name || '');
    const matchSearch = !search || (typeof mealNames === "string" ? mealNames : mealNames.join(" ")).toLowerCase().includes(search.toLowerCase())
      || (h.ingredients || []).some(i => i.toLowerCase().includes(search.toLowerCase()));
    const matchFilter = filter === 'all' || h.meal_type === filter;
    return matchSearch && matchFilter;
  });

  const s = {
    page:    { minHeight:'100vh', background:C.cream, fontFamily:"'DM Sans', sans-serif", color:C.ink },
    header:  { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'16px 28px', borderBottom:'1px solid ' + C.border, position:'sticky', top:0, zIndex:10, background:'rgba(255,250,245,0.95)', backdropFilter:'blur(12px)' },
    logo:    { display:'flex', alignItems:'center', gap:8, cursor:'pointer' },
    logoName:{ fontFamily:"'Fraunces', serif", fontSize:22, fontWeight:900, color:C.ink, letterSpacing:'-0.5px' },
    backBtn: { fontSize:13, fontWeight:500, color:C.muted, background:'none', border:'1.5px solid ' + C.borderMid, borderRadius:8, padding:'6px 12px', cursor:'pointer', fontFamily:"'DM Sans', sans-serif" },
    wrap:    { maxWidth:780, margin:'0 auto', padding:'32px 24px 60px' },
    title:   { fontFamily:"'Fraunces', serif", fontSize:'clamp(26px,4vw,38px)', fontWeight:900, color:C.ink, letterSpacing:'-1px', marginBottom:4 },
    sub:     { fontSize:13, color:C.muted, fontWeight:300, marginBottom:24 },
    toolbar: { display:'flex', gap:10, marginBottom:20, flexWrap:'wrap', alignItems:'center' },
    search:  { flex:1, minWidth:180, border:'1.5px solid ' + C.borderMid, borderRadius:10, padding:'9px 14px', fontSize:13, fontFamily:"'DM Sans', sans-serif", color:C.ink, outline:'none', background:'white' },
    filterPill: (active) => ({ border:'1.5px solid ' + (active ? C.jiff : C.borderMid), background: active ? C.jiff : 'white', color: active ? 'white' : C.muted, borderRadius:20, padding:'6px 14px', fontSize:12, cursor:'pointer', fontWeight: active ? 500 : 400, fontFamily:"'DM Sans', sans-serif", transition:'all 0.15s' }),
    emptyBox:{ textAlign:'center', padding:'56px 24px', border:'2px dashed ' + C.borderMid, borderRadius:18 },
    card:    { background:'white', border:'1px solid ' + C.border, borderRadius:16, overflow:'hidden', marginBottom:10, boxShadow:C.shadow },
    cardHdr: { padding:'14px 16px', cursor:'pointer', display:'flex', alignItems:'center', gap:12 },
    cardBody:{ padding:'0 16px 14px', borderTop:'1px solid ' + C.border },
    meal:    { padding:'10px 0', borderBottom:'1px solid rgba(0,0,0,0.05)', display:'flex', alignItems:'center', gap:10 },
    mealName:{ fontSize:14, fontWeight:500, color:C.ink },
    mealMeta:{ fontSize:12, color:C.muted, fontWeight:300, marginTop:2 },
    chip:    (color) => ({ display:'inline-block', fontSize:10, fontWeight:500, padding:'2px 8px', borderRadius:20, background:color.bg, color:color.text }),
    actions: { display:'flex', gap:8, marginTop:12, flexWrap:'wrap' },
    actBtn:  { fontSize:12, fontWeight:500, padding:'7px 14px', borderRadius:8, cursor:'pointer', fontFamily:"'DM Sans', sans-serif", border:'1.5px solid ' + C.borderMid, background:'white', color:C.ink, transition:'all 0.15s' },
    delBtn:  { fontSize:12, fontWeight:500, padding:'7px 14px', borderRadius:8, cursor:'pointer', fontFamily:"'DM Sans', sans-serif", border:'1.5px solid rgba(229,62,62,0.3)', background:'#FFF5F5', color:'#E53E3E', transition:'all 0.15s' },
    ingList: { display:'flex', flexWrap:'wrap', gap:5, marginTop:8 },
    ingTag:  { background:C.warm, borderRadius:20, padding:'3px 10px', fontSize:11, color:C.muted },
    stat:    { background:C.cream, borderRadius:10, padding:'10px 14px', textAlign:'center', minWidth:80 },
    statN:   { fontFamily:"'Fraunces', serif", fontSize:22, fontWeight:900, color:C.ink },
    statL:   { fontSize:11, color:C.muted, marginTop:2 },
  };

  const totalMeals = history.reduce((acc, h) => acc + (Array.isArray(h.meal) ? h.meal.length : 1), 0);
  const cuisines   = [...new Set(history.map(h => h.cuisine).filter(c => c && c !== 'any'))];
  const streakDays = history.length > 0 ? Math.min(history.length, 7) : 0;

  // Behaviour insight — "You've been cooking quick meals lately"
  const behaviorInsight = useMemo(() => {
    if (history.length < 3) return null;
    const recent = history.slice(0, 5);
    const quickCount  = recent.filter(h => (h.meal?.effortMins || h.effort_mins || 30) <= 15).length;
    const lightCount  = recent.filter(h => (h.meal?.tags || []).includes('light')).length;
    const topCuisine  = cuisines[0];
    if (quickCount >= 3) return "You've been cooking quick meals lately";
    if (lightCount >= 3) return "You've been choosing lighter meals recently";
    if (topCuisine && recent.filter(h => h.cuisine === topCuisine).length >= 3) {
      const label = topCuisine.replace(/_/g,' ').replace(/\w/g, c => c.toUpperCase());
      return "You've been making a lot of " + label + " dishes";
    }
    return null;
  }, [history, cuisines]);

  return (
    <div style={s.page}>
      <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,700;0,900;1,700&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet"/>

<PageHeader title="Cooking history" />

      <div style={s.wrap}>
        <div style={s.title}>🕐 Meal history</div>
        <div style={s.sub}>Every meal you've generated — tap any to see the recipes again or cook them with different serving sizes.</div>

        {/* Stats row */}
        {/* Behaviour insight */}
        {behaviorInsight && (
          <div style={{ margin:'0 0 16px', padding:'10px 14px', borderRadius:11, background:'rgba(29,158,117,0.06)', border:'1px solid rgba(29,158,117,0.18)', fontSize:12, color:'#065F46', fontWeight:500 }}>
            {'💡 '}{behaviorInsight}
          </div>
        )}

        {history.length > 0 && (
          <div style={{display:'flex', gap:10, marginBottom:24, flexWrap:'wrap'}}>
            <div style={s.stat}><div style={s.statN}>{history.length}</div><div style={s.statL}>sessions</div></div>
            <div style={s.stat}><div style={s.statN}>{totalMeals}</div><div style={s.statL}>recipes seen</div></div>
            <div style={s.stat}><div style={s.statN}>{cuisines.length || 1}</div><div style={s.statL}>cuisines tried</div></div>
            <div style={s.stat}><div style={s.statN}>{streakDays}</div><div style={s.statL}>day streak</div></div>
          </div>
        )}

        {/* Toolbar */}
        <div style={s.toolbar}>
          <input
            style={s.search}
            placeholder="Search by meal name or ingredient…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {['all','breakfast','lunch','dinner','snack'].map(f => (
            <button key={f} style={s.filterPill(filter===f)} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {loading && (
          <div style={{textAlign:'center', padding:'48px 0', color:C.muted, fontSize:14}}>
            Loading your history…
          </div>
        )}

        {!loading && !user && (
          <div style={s.emptyBox}>
            <div style={{fontSize:36, marginBottom:12}}>🔐</div>
            <div style={{fontFamily:"'Fraunces', serif", fontSize:20, fontWeight:700, color:C.ink, marginBottom:6}}>Sign in to see your history</div>
            <div style={{fontSize:14, color:C.muted, fontWeight:300}}>Your meal history is saved to your account.</div>
          </div>
        )}

        {!loading && user && filtered.length === 0 && (
          <div style={s.emptyBox}>
            <div style={{fontSize:36, marginBottom:12}}>🍽️</div>
            <div style={{fontFamily:"'Fraunces', serif", fontSize:20, fontWeight:700, color:C.ink, marginBottom:6}}>
              {history.length === 0 ? 'No history yet' : 'No results found'}
            </div>
            <div style={{fontSize:14, color:C.muted, fontWeight:300, marginBottom:20}}>
              {history.length === 0
                ? 'Generate your first meal and it will appear here automatically.'
                : 'Try a different search or filter.'}
            </div>
            {history.length === 0 && (
              <button onClick={() => navigate('/app')} style={{background:C.jiff, color:'white', border:'none', borderRadius:10, padding:'12px 28px', fontSize:14, fontWeight:500, cursor:'pointer', fontFamily:"'DM Sans', sans-serif"}}>
                ⚡ Generate a meal
              </button>
            )}
          </div>
        )}

        {/* History cards */}
        {filtered.map(entry => {
          const meals    = Array.isArray(entry.meal) ? entry.meal : entry.meals ? entry.meals : [entry.meal].filter(Boolean);
          const mt       = entry.meal_type || 'any';
          const color    = MEAL_COLORS[mt] || MEAL_COLORS.any;
          const isOpen   = expanded === entry.id;

          return (
            <div key={entry.id} style={{ ...s.card, cursor:'pointer' }} onClick={() => navigate('/app', { state: { generateContext: { dish: Array.isArray(entry.meal) ? entry.meal[0]?.name : entry.meal?.name, cuisine: entry.cuisine, mealType: entry.meal_type } } })}>
              {/* Card header */}
              <div style={s.cardHdr} onClick={() => setExpanded(isOpen ? null : entry.id)}>
                <div style={{width:36, height:36, borderRadius:10, background:color.bg, display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, flexShrink:0}}>
                  {mt==='breakfast'?'🌅':mt==='lunch'?'☀️':mt==='dinner'?'🌙':mt==='snack'?'🍎':'🍽️'}
                </div>
                <div style={{flex:1, minWidth:0}}>
                  <div style={{fontSize:13, fontWeight:500, color:C.ink, marginBottom:3}}>
                    {meals.slice(0,3).map(m => m?.name||'').filter(Boolean).join(' · ')}
                    {meals.length > 3 && <span style={{color:C.muted}}> +{meals.length-3} more</span>}
                  </div>
                  <div style={{display:'flex', gap:8, flexWrap:'wrap', alignItems:'center'}}>
                    <span style={s.chip(color)}>{mt}</span>
                    {entry.cuisine && entry.cuisine !== 'any' && <span style={{fontSize:11, color:C.muted}}>{entry.cuisine}</span>}
                    <span style={{fontSize:11, color:C.muted}}>👥 {entry.servings || 2}</span>
                    <span style={{fontSize:11, color:C.muted, marginLeft:'auto'}}>{timeAgo(entry.generated_at)}</span>
                  </div>
                </div>
                <span style={{fontSize:12, color:C.muted, flexShrink:0}}>{isOpen ? '▲' : '▼'}</span>
              </div>

              {/* Expanded body */}
              {isOpen && (
                <div style={s.cardBody}>
                  {/* Meal list */}
                  {(Array.isArray(meals) ? meals : []).map((meal, i) => (
                    <div key={i} style={{...s.meal, borderBottom: i < meals.length-1 ? '1px solid rgba(0,0,0,0.05)' : 'none'}}>
                      <span style={{fontSize:20}}>{meal.emoji}</span>
                      <div>
                        <div style={s.mealName}>{meal.name}</div>
                        <div style={s.mealMeta}>⏱ {meal.time} · 🔥 {meal.calories} cal · 💪 {meal.protein}</div>
                      </div>
                    </div>
                  ))}

                  {/* Ingredients used */}
                  {entry.ingredients?.length > 0 && (
                    <div style={{marginTop:12}}>
                      <div style={{fontSize:11, letterSpacing:'1.5px', textTransform:'uppercase', color:C.jiff, fontWeight:500, marginBottom:6}}>Ingredients used</div>
                      <div style={s.ingList}>
                        {(entry.ingredients || []).map((ing, i) => <span key={i} style={s.ingTag}>{ing}</span>)}
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div style={s.actions}>
                    <button style={s.actBtn} onClick={() => handleReGenerate(entry)}>
                      ⚡ Cook again with these ingredients
                    </button>
                    <button
                      style={{...s.delBtn, opacity: deleting===entry.id ? 0.6 : 1}}
                      onClick={() => handleDelete(entry.id)}
                      disabled={deleting===entry.id}
                    >
                      {deleting===entry.id ? 'Removing…' : '✕ Remove'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
