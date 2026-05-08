// src/components/jiff/LoadingView.jsx — v23.47
// Context-aware loader: calm, human, never computational.
// No count wording. No AI-generation language.
// Phase-based message evolution with smooth breathing animation.

import { useState, useEffect } from 'react';

// Messages are calm, decisive, warm — under 36 chars each
// Each set has 4 phases (0.8s apart) — last phrase is the "almost there" reassurance
const MSG_SETS = {
  mood:     ['Reading the vibe…',         'Something good is coming…',  'Almost there…',          'Found it.'],
  hosting:  ['Planning your table…',      'Finding a showstopper…',     'Nearly done…',           'Ready for your guests.'],
  leftover: ['Making the most of it…',    'Turning leftovers around…',  'Almost done…',           'Found something good.'],
  kids:     ['Kid-friendly options…',     'Checking it over…',          'Almost there…',          'Good to go.'],
  surprise: ['Going off the beaten path…','You won\'t expect this…',   'Nearly there…',          'Here we go.'],
  explore:  ['Looking at a few options…', 'Curating what fits…',        'Almost there…',          'Here are some ideas.'],
  default:  ['Looking at your taste…',    'Finding something fitting…', 'Almost there…',          'Got something.'],
};

export default function LoadingView({ loadingMessage, source }) {
  const msgs  = MSG_SETS[source] || MSG_SETS.default;
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    setPhase(0);
    const timers = [
      setTimeout(() => setPhase(1), 900),
      setTimeout(() => setPhase(2), 1900),
      setTimeout(() => setPhase(3), 3100),
    ];
    return () => timers.forEach(clearTimeout);
  }, [source, loadingMessage]);

  const msg = loadingMessage || msgs[Math.min(phase, msgs.length - 1)];

  return (
    <div style={{
      textAlign: 'center', padding: '64px 24px 48px',
      maxWidth: 400, margin: '0 auto',
      fontFamily: "'DM Sans', sans-serif",
    }}>
      {/* Breathing dots — 3 dots, calm sequential fade */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginBottom: 40 }}>
        {[0, 1, 2].map(i => {
          const active = i === phase % 3;
          return (
            <div key={i} style={{
              width: 9, height: 9, borderRadius: '50%',
              background: active ? '#FF4500' : 'rgba(255,69,0,0.15)',
              transform:  active ? 'scale(1.5)' : 'scale(1)',
              transition: 'background 0.3s ease, transform 0.3s ease',
            }} />
          );
        })}
      </div>

      {/* Primary message — Fraunces, confident */}
      <div style={{
        fontFamily: "'Fraunces', serif",
        fontSize: 'clamp(18px, 3.5vw, 23px)',
        fontWeight: 900, letterSpacing: '-0.3px',
        color: '#1C0A00', marginBottom: 8, minHeight: 30,
        transition: 'opacity 0.3s ease',
        opacity: phase >= 0 ? 1 : 0,
      }}>
        {msg}
      </div>

      {/* Sub — calm reassurance, never technical */}
      <div style={{ fontSize: 12, color: '#7C6A5E', fontWeight: 300 }}>
        {phase < 2 ? 'Won\'t be long…' : 'Almost ready for you…'}
      </div>
    </div>
  );
}
