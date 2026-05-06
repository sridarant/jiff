// src/components/meal/GroceryPanel.jsx
// Grocery list panel: splits recipe ingredients into "need" and "have"
// based on what's in the user's fridge.

import { useState } from 'react';
import { trackWhatsAppShare, trackGroceryShare } from '../../lib/analytics';
import { useLocale } from '../../contexts/LocaleContext.jsx';
import { buildGroceryList } from '../../lib/grocery.js';

// Inline icons (self-contained — no external icon dep)
const IconCopy  = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>;
const IconCheck = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>;
const IconWA    = () => <svg viewBox="0 0 32 32" fill="currentColor" width="14" height="14"><path d="M16 0C7.164 0 0 7.163 0 16c0 2.824.737 5.469 2.026 7.773L0 32l8.467-2.001A15.938 15.938 0 0016 32c8.836 0 16-7.163 16-16S24.836 0 16 0zm8.278 22.61c-.344.967-1.993 1.841-2.741 1.957-.695.109-1.57.154-2.534-.16-.584-.193-1.334-.45-2.285-.882-4.02-1.744-6.65-5.786-6.85-6.054-.2-.267-1.63-2.17-1.63-4.14 0-1.968 1.033-2.94 1.398-3.34.363-.398.793-.498 1.058-.498.265 0 .53.003.762.014.245.012.574-.093.897.685.344.82 1.168 2.846 1.269 3.053.1.207.167.448.033.715-.134.267-.2.433-.398.667-.2.233-.42.52-.598.7-.2.2-.408.415-.175.815.233.4 1.036 1.71 2.224 2.77 1.527 1.363 2.814 1.784 3.214 1.984.4.2.633.167.867-.1.233-.267 1-.117 1.733-.467.733-.35.533-.267.533.15zm0 0"/></svg>;

export function GroceryPanel({ ingredients: ingredientsProp = [], fridgeIngredients = [], onClose, country: countryProp, meal }) {
  const { country: ctxCountry, t } = useLocale();
  const country = countryProp || ctxCountry;

  const { need, have } = buildGroceryList(ingredientsProp.length ? ingredientsProp : (meal?.ingredients || []), fridgeIngredients);
  const [checked, setChecked] = useState({});
  const [copied,  setCopied]  = useState(false);

  const toggle = k => setChecked(p => ({ ...p, [k]: !p[k] }));

  const handleCopy = async e => {
    e.stopPropagation();
    const text = need.length > 0
      ? `🛒 Shopping list for ${meal?.name || 'this recipe'}\n\n${need.map(i => `• ${i}`).join('\n')}\n\n_From Jiff_`
      : `Nothing to buy for ${meal?.name || 'this recipe'}!`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const waUrl = `https://wa.me/?text=${encodeURIComponent(
    need.length > 0
      ? `🛒 *Shopping list for ${meal?.name || 'this recipe'}*\n\n${need.map(i => `• ${i}`).join('\n')}\n\n_From Jiff_`
      : `I have everything for ${meal?.name || 'this recipe'}! 🎉`
  )}`;

  const stripQty = ing => ing.replace(/^[\d½¼¾⅓⅔⅛]+\s*(?:g|kg|ml|l|tsp|tbsp|cup|cups)?\s*/i, '');

  return (
    <div className="grocery-panel" onClick={e => e.stopPropagation()}>
      <div className="grocery-header">
        <div className="grocery-header-left">
          <span style={{ fontSize: 14 }}>🛒</span>
          <div>
            <div className="grocery-header-title">{t('grocery_title')}</div>
            <div className="grocery-header-sub">
              {need.length === 0
                ? 'You have everything!'
                : need.length + ' to buy · ' + have.length + ' you have'}
            </div>
          </div>
        </div>
        <button className="grocery-close" onClick={e => { e.stopPropagation(); onClose(); }}>×</button>
      </div>

      {/* Need to buy */}
      <div className="grocery-section">
        <div className="grocery-section-title need">
          <span>{t('need_to_buy')}</span>
          <span className="grocery-count need">{need.length}</span>
        </div>
        {need.length === 0
          ? <div className="grocery-empty">🎉 Nothing — you have it all!</div>
          : (
            <div className="grocery-items">
              {need.map((ing, i) => (
                <div key={i} className="grocery-item need" onClick={() => toggle('n-'+i)}>
                  <div className={'grocery-checkbox ' + (checked['n-'+i] ? 'checked' : '')}>
                    <svg viewBox="0 0 12 12"><polyline points="10 2 5 9 2 6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </div>
                  <div className={'grocery-item-text ' + (checked['n-'+i] ? 'checked-text' : '')}>{ing}</div>
                  <a href={'https://blinkit.com/s/?q=' + (encodeURIComponent(stripQty(ing)))}
                    target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                    style={{ marginLeft:'auto', flexShrink:0, fontSize:10, fontWeight:500, color:'#1A8A3E',
                      background:'rgba(26,138,62,0.08)', border:'1px solid rgba(26,138,62,0.22)',
                      borderRadius:6, padding:'2px 7px', textDecoration:'none', whiteSpace:'nowrap',
                      fontFamily:"'DM Sans',sans-serif" }}>
                    Order →
                  </a>
                </div>
              ))}
            </div>
          )}
      </div>

      {/* In fridge */}
      {have.length > 0 && (
        <div className="grocery-section">
          <div className="grocery-section-title have">
            <span>{'You have'}</span>
            <span className="grocery-count have">{have.length}</span>
          </div>
          <div className="grocery-items">
            {have.map((ing, i) => (
              <div key={i} className="grocery-item have">
                <div className="grocery-dot"/>
                <div className="grocery-item-text">{ing}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="grocery-actions">
        <button className={`grocery-action-btn copy ${copied ? 'copied' : ''}`} onClick={() => { handleCopy(); trackGroceryShare('copy'); }}>
          {copied ? <IconCheck/> : <IconCopy/>}
          {copied ? 'Copied!' : 'Copy list'}
        </button>
        <a className="grocery-action-btn wa" href={waUrl} target="_blank" rel="noopener noreferrer"
          onClick={e => { e.stopPropagation(); trackWhatsAppShare('grocery_list'); }}>
          <IconWA/>WhatsApp
        </a>
        {need.length > 0 && (
          <a className="grocery-action-btn"
            href={'https://blinkit.com/s/?q=' + (encodeURIComponent(need.map(stripQty).join(', ')))}
            target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
            style={{ background:'#1A8A3E', color:'white', border:'none',
              textDecoration:'none', display:'flex', alignItems:'center', gap:5 }}>
            🛒 Blinkit
          </a>
        )}
      </div>
    </div>
  );
}
