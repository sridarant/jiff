// src/pages/Landing.jsx — v23.41
//
// CONSTITUTION: Single confident entry point. Not a marketing site.
// Emotional goal: "Dinner is already handled."
//
// STRUCTURE (one viewport on mobile):
//   Nav    — wordmark + Sign in (receded)
//   Hero   — headline + ONE CTA
//   Trust  — 3 brief trust signals (no scroll required)
//
// REMOVED vs previous:
//   ✕ "Where do you want to start?" entry cards section (choice before value)
//   ✕ "How it works" 3-step section (onboarding-site energy)
//   ✕ "Why Jiff" anti-reasons section (defensive marketing)
//   ✕ second bottom CTA section
//   ✕ "Decide in seconds" pill badge (chip noise in decision zone)
//   ✕ scroll-heavy layout (4 sections → 1 viewport)

import { useState } from 'react';
import JiffLogo from '../components/JiffLogo';
import { useNavigate } from 'react-router-dom';

const C = {
  jiff: '#FF4500', ember: '#CC3700', ink: '#1C0A00',
  cream: '#FFFAF5', muted: '#7C6A5E', border: 'rgba(28,10,0,0.08)',
};
const F     = "'DM Sans', sans-serif";
const SERIF = "'Fraunces', serif";

function PrimaryBtn({ children, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: hov ? C.ember : C.jiff,
        color: 'white', border: 'none', borderRadius: 14,
        padding: '18px 48px', fontSize: 17, fontFamily: F,
        fontWeight: 700, cursor: 'pointer',
        transition: 'background 0.15s', touchAction: 'manipulation',
        letterSpacing: '0.01em',
      }}>
      {children}
    </button>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const goApp = () => navigate('/app');

  return (
    <div style={{
      minHeight: '100vh', background: C.cream,
      fontFamily: F, display: 'flex', flexDirection: 'column',
    }}>

      {/* ── NAV — wordmark + receded sign in ── */}
      <nav style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '18px clamp(20px,4vw,48px)',
        borderBottom: '1px solid ' + C.border,
        position: 'sticky', top: 0, zIndex: 100,
        background: 'rgba(255,250,245,0.97)',
        backdropFilter: 'blur(12px)',
      }}>
        <JiffLogo size="md" onClick={() => window.scrollTo({ top:0, behavior:'smooth' })} />
        <button
          onClick={() => navigate('/login')}
          style={{
            background: 'none', border: 'none', fontSize: 13,
            color: C.muted, cursor: 'pointer', fontFamily: F, padding: '8px 12px',
          }}>
          {'Sign in'}
        </button>
      </nav>

      {/* ── HERO — single viewport, one CTA ── */}
      <main style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        textAlign: 'center',
        padding: 'clamp(48px,8vh,96px) clamp(20px,6vw,80px) clamp(40px,6vh,72px)',
        maxWidth: 640, margin: '0 auto', width: '100%', boxSizing: 'border-box',
      }}>

        {/* Headline — emotionally confident, not a feature claim */}
        <h1 style={{
          fontFamily: SERIF,
          fontSize: 'clamp(40px,9vw,80px)',
          fontWeight: 900, lineHeight: 1.0,
          color: C.ink, marginBottom: 24,
          letterSpacing: '-2px',
        }}>
          {"Don't think."}<br />
          <span style={{ color: C.jiff, fontStyle: 'italic' }}>{"Just cook."}</span>
        </h1>

        {/* Sub — single calm sentence */}
        <p style={{
          fontSize: 'clamp(15px,2vw,18px)', color: C.muted,
          lineHeight: 1.7, fontWeight: 300,
          maxWidth: 420, margin: '0 auto 40px',
        }}>
          {'Jiff decides what to cook tonight — based on your taste, your time, and what you have.'}
        </p>

        {/* ONE primary CTA */}
        <PrimaryBtn onClick={goApp}>{'Start cooking →'}</PrimaryBtn>

        {/* Trust row — 3 quiet signals, no scroll required */}
        <div style={{
          display: 'flex', gap: 'clamp(12px,3vw,28px)',
          justifyContent: 'center', flexWrap: 'wrap',
          marginTop: 32,
        }}>
          {['No account needed', 'Ready in seconds', 'Works on any device'].map((t, i) => (
            <span key={i} style={{
              fontSize: 12, color: C.muted,
              display: 'flex', alignItems: 'center', gap: 5,
            }}>
              <span style={{ color: C.jiff }}>{'✓'}</span>{t}
            </span>
          ))}
        </div>
      </main>

      {/* ── FOOTER — minimal ── */}
      <footer style={{
        borderTop: '1px solid ' + C.border,
        padding: '18px clamp(20px,4vw,48px)',
        display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
      }}>
        <JiffLogo size="sm" />
        <span style={{ fontSize: 12, color: C.muted }}>{"Don't think. Just cook."}</span>
        <div style={{ display: 'flex', gap: 16 }}>
          {[{ l: 'Privacy', p: '/privacy' }, { l: 'Terms', p: '/terms' }].map(({ l, p }) => (
            <button key={l} onClick={() => navigate(p)}
              style={{
                background: 'none', border: 'none',
                fontSize: 12, color: C.muted, cursor: 'pointer', fontFamily: F,
              }}>
              {l}
            </button>
          ))}
        </div>
      </footer>
    </div>
  );
}
