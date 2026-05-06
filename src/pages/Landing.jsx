// src/pages/Landing.jsx — v1.23.00
// Conversion-focused landing. Minimal scroll. Strong single CTA.
// Structure:
//   Nav    — wordmark + CTA
//   Hero   — headline + sub + Start cooking button
//   Entry  — 3 clickable context shortcuts
//   How    — 3 steps
//   Why    — 3 anti-reasons (no scroll, no plan, no indecision)
//   Footer — minimal

import { useState } from 'react';
import JiffLogo    from '../components/JiffLogo';
import { useNavigate } from 'react-router-dom';

const C = {
  jiff:'#FF4500', ember:'#CC3700', ink:'#1C0A00',
  cream:'#FFFAF5', muted:'#7C6A5E', border:'rgba(28,10,0,0.1)',
};

// ── Primary button ──────────────────────────────────────────────
function PrimaryBtn({ children, onClick, large }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ background:hov?C.ember:C.jiff, color:'white', border:'none', borderRadius:14, padding:large?'18px 44px':'12px 28px', fontSize:large?17:14, fontFamily:"'DM Sans',sans-serif", fontWeight:600, cursor:'pointer', transition:'background 0.15s', touchAction:'manipulation', letterSpacing:'0.1px' }}>
      {children}
    </button>
  );
}

// ── Context entry card ──────────────────────────────────────────
function EntryCard({ emoji, label, sub, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ display:'flex', flexDirection:'column', alignItems:'flex-start', gap:6, padding:'20px 20px', borderRadius:16, border:'1.5px solid '+(hov?C.jiff:C.border), background:hov?'rgba(255,69,0,0.04)':'white', cursor:'pointer', fontFamily:"'DM Sans',sans-serif", textAlign:'left', transition:'all 0.13s', flex:'1 1 160px', minWidth:0 }}>
      <span style={{ fontSize:28 }}>{emoji}</span>
      <span style={{ fontSize:14, fontWeight:600, color:C.ink, lineHeight:1.3 }}>{label}</span>
      {sub && <span style={{ fontSize:12, color:C.muted, fontWeight:300 }}>{sub}</span>}
    </button>
  );
}

export default function Landing() {
  const navigate = useNavigate();

  const goApp = (state) => navigate('/app', state ? { state } : undefined);

  return (
    <div style={{ minHeight:'100vh', background:C.cream, fontFamily:"'DM Sans',sans-serif", overflowX:'hidden' }}>

      {/* ── NAV ── */}
      <nav style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'18px clamp(16px,4vw,48px)', borderBottom:'1px solid '+C.border, position:'sticky', top:0, zIndex:100, background:'rgba(255,250,245,0.96)', backdropFilter:'blur(12px)' }}>
        <JiffLogo size="md" onClick={() => window.scrollTo({top:0, behavior:'smooth'})} />
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <button onClick={() => navigate('/login')}
            style={{ background:'none', border:'none', fontSize:13, color:C.muted, cursor:'pointer', fontFamily:"'DM Sans',sans-serif", padding:'8px 12px' }}>
            {'Sign in'}
          </button>
          <PrimaryBtn onClick={() => goApp()}>{'Start cooking'}</PrimaryBtn>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section style={{ maxWidth:720, margin:'0 auto', padding:'clamp(60px,10vh,100px) clamp(16px,4vw,40px) 60px', textAlign:'center' }}>
        {/* Pill */}
        <div style={{ display:'inline-flex', alignItems:'center', gap:7, background:'rgba(255,69,0,0.09)', border:'1px solid rgba(255,69,0,0.2)', borderRadius:20, padding:'5px 14px', marginBottom:28 }}>
          <span style={{ width:7, height:7, borderRadius:'50%', background:C.jiff, flexShrink:0 }}/>
          <span style={{ fontSize:12, fontWeight:500, color:C.jiff }}>{'Decide in seconds'}</span>
        </div>

        {/* H1 */}
        <h1 style={{ fontFamily:"'Fraunces',serif", fontSize:'clamp(42px,8vw,84px)', fontWeight:900, lineHeight:1.0, color:C.ink, marginBottom:24, letterSpacing:'-2px' }}>
          {"Don't think."}<br/>
          <span style={{ color:C.jiff, fontStyle:'italic' }}>{'Just cook.'}</span>
        </h1>

        {/* Sub */}
        <p style={{ fontSize:'clamp(15px,2vw,18px)', color:C.muted, lineHeight:1.75, fontWeight:300, maxWidth:480, margin:'0 auto 40px' }}>
          {'Jiff turns what you have, your taste, and your time into a meal you\'ll actually want to cook.'}
        </p>

        {/* CTA */}
        <PrimaryBtn large onClick={() => goApp()}>{'Start cooking →'}</PrimaryBtn>

        {/* Trust row */}
        <div style={{ display:'flex', gap:20, justifyContent:'center', flexWrap:'wrap', marginTop:32 }}>
          {['No account needed', 'Ready in seconds', 'Works on any device'].map((t, i) => (
            <span key={i} style={{ fontSize:12, color:C.muted, display:'flex', alignItems:'center', gap:5 }}>
              <span style={{ color:C.jiff }}>{'✓'}</span>{t}
            </span>
          ))}
        </div>
      </section>

      {/* ── SECTION 2: CONTEXT ENTRY ── */}
      <section style={{ maxWidth:720, margin:'0 auto', padding:'0 clamp(16px,4vw,40px) 72px' }}>
        <div style={{ fontSize:11, letterSpacing:'2px', textTransform:'uppercase', color:C.muted, fontWeight:600, textAlign:'center', marginBottom:20 }}>
          {'Where do you want to start?'}
        </div>
        <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
          <EntryCard
            emoji="🍳"
            label="Breakfast in 20 mins"
            sub="Quick, filling, no fuss"
            onClick={() => goApp({ generateContext:{ mealType:'breakfast', time:'20 min' } })}
          />
          <EntryCard
            emoji="👨‍👩‍👧"
            label="Guests tonight"
            sub="A menu that impresses"
            onClick={() => goApp({ generateContext:{ hosting:true, servings:6 } })}
          />
          <EntryCard
            emoji="🥦"
            label="Cook with what I have"
            sub="Pick your meal, then check what you need"
            onClick={() => goApp()}
          />
        </div>
      </section>

      {/* ── SECTION 3: HOW IT WORKS ── */}
      <section style={{ background:'#F5EFE8', padding:'72px clamp(16px,4vw,48px)' }}>
        <div style={{ maxWidth:720, margin:'0 auto' }}>
          <div style={{ fontSize:11, letterSpacing:'2px', textTransform:'uppercase', color:C.muted, fontWeight:600, textAlign:'center', marginBottom:12 }}>{'How it works'}</div>
          <h2 style={{ fontFamily:"'Fraunces',serif", fontSize:'clamp(26px,4vw,40px)', fontWeight:900, color:C.ink, textAlign:'center', marginBottom:48, letterSpacing:'-1px', lineHeight:1.1 }}>
            {'Decide what to cook. Instantly.'}
          </h2>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:20 }}>
            {[
              { n:'1', emoji:'🧠', title:'Tell Jiff what you feel like', desc:'Mood, ingredients, time — whatever you have.' },
              { n:'2', emoji:'⚡', title:'It finds the best option',     desc:'One clear recommendation. Not a list of 50.' },
              { n:'3', emoji:'🍳', title:'You start cooking instantly',   desc:'Full recipe, timers, shopping list — all in one tap.' },
            ].map(step => (
              <div key={step.n} style={{ background:'white', borderRadius:18, padding:'24px 20px', border:'1px solid '+C.border, position:'relative', overflow:'hidden' }}>
                <div style={{ fontFamily:"'Fraunces',serif", fontSize:72, fontWeight:900, color:'rgba(255,69,0,0.07)', lineHeight:1, position:'absolute', top:8, right:14 }}>{step.n}</div>
                <div style={{ fontSize:26, marginBottom:12 }}>{step.emoji}</div>
                <div style={{ fontFamily:"'Fraunces',serif", fontSize:17, fontWeight:700, color:C.ink, marginBottom:8, lineHeight:1.25 }}>{step.title}</div>
                <div style={{ fontSize:13, color:C.muted, lineHeight:1.65, fontWeight:300 }}>{step.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECTION 4: WHY JIFF ── */}
      <section style={{ maxWidth:720, margin:'0 auto', padding:'72px clamp(16px,4vw,40px)' }}>
        <h2 style={{ fontFamily:"'Fraunces',serif", fontSize:'clamp(26px,4vw,40px)', fontWeight:900, color:C.ink, textAlign:'center', marginBottom:48, letterSpacing:'-1px', lineHeight:1.1 }}>
          {'Why Jiff'}
        </h2>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:16 }}>
          {[
            { emoji:'🚫', title:'No endless scrolling', desc:'One suggestion. Decided for you.' },
            { emoji:'📋', title:'No complicated planning', desc:'Just the next meal. Nothing more.' },
            { emoji:'✅', title:'Just one good meal, right now', desc:'Open Jiff, done in 10 seconds.' },
          ].map(item => (
            <div key={item.title} style={{ border:'1px solid '+C.border, borderRadius:16, padding:'22px 18px', background:'white' }}>
              <div style={{ fontSize:22, marginBottom:10 }}>{item.emoji}</div>
              <div style={{ fontSize:14, fontWeight:600, color:C.ink, marginBottom:6 }}>{item.title}</div>
              <div style={{ fontSize:13, color:C.muted, lineHeight:1.6, fontWeight:300 }}>{item.desc}</div>
            </div>
          ))}
        </div>

        {/* Bottom CTA */}
        <div style={{ textAlign:'center', marginTop:56 }}>
          <div style={{ fontFamily:"'Fraunces',serif", fontSize:'clamp(20px,3vw,28px)', fontWeight:700, color:C.ink, marginBottom:20, letterSpacing:'-0.5px' }}>
            {"What are you cooking today?"}
          </div>
          <PrimaryBtn large onClick={() => goApp()}>{'Let Jiff decide →'}</PrimaryBtn>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{ borderTop:'1px solid '+C.border, padding:'24px clamp(16px,4vw,48px)', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:12 }}>
        <JiffLogo size="sm" />
        <span style={{ fontSize:12, color:C.muted }}>{"Don't think. Just cook."}</span>
        <div style={{ display:'flex', gap:16 }}>
          {[{l:'Privacy', p:'/privacy'},{l:'Terms', p:'/terms'}].map(({l,p}) => (
            <button key={l} onClick={() => navigate(p)}
              style={{ background:'none', border:'none', fontSize:12, color:C.muted, cursor:'pointer', fontFamily:"'DM Sans',sans-serif" }}>
              {l}
            </button>
          ))}
        </div>
      </footer>

    </div>
  );
}
