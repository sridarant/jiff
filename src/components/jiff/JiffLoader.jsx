// src/components/jiff/JiffLoader.jsx — v23.41
//
// CONSTITUTION: Loading states use skeleton screens, not spinners.
// Wordmark pulse only — no rotating microcopy ("thinking... / planning...")
// Rotating copy creates anxiety by suggesting the app is struggling.
// Silence + gentle pulse = calm confidence.

const PULSE_CSS = `
  @keyframes jiff-pulse {
    0%,100% { opacity:0.45; }
    50%      { opacity:1;    }
  }
  .jiff-pulse { animation: jiff-pulse 900ms ease-in-out infinite; }
`;

export default function JiffLoader() {
  return (
    <>
      <style>{PULSE_CSS}</style>
      <div
        role="status"
        aria-label="Loading"
        style={{
          position: 'fixed', inset: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          background: '#FFFAF5', zIndex: 9999,
          fontFamily: "'DM Sans', sans-serif",
        }}>
        {/* Wordmark — gentle pulse only, no text below */}
        <div className="jiff-pulse" style={{ display: 'flex', alignItems: 'center' }}>
          <span style={{
            fontFamily: "'Fraunces', serif",
            fontWeight: 900, fontSize: 44,
            color: '#FF4500', letterSpacing: '-1px',
          }}>
            {'jiff'}
          </span>
        </div>
      </div>
    </>
  );
}
