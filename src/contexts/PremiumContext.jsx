import { createContext, useContext, useState, useCallback } from 'react';
import { trackTrialStart, trackPaywallShown } from '../lib/analytics';

// ── PAYWALL FEATURE FLAG ──────────────────────────────────────────
// Set to false during UX evaluation to remove all premium friction.
// Re-enable before production monetization launch.
// When false: all users treated as premium — no gates, no nudges, no caps.
const PAYWALL_ENABLED = false;

const PremiumContext = createContext(null);
export const usePremium = () => useContext(PremiumContext);

const STORAGE_KEY  = 'jiff-premium';
const TRIAL_KEY    = 'jiff-trial';
const USAGE_KEY    = 'jiff-usage';

const TRIAL_DAYS       = 7;
const TRIAL_RECIPE_CAP = 1;   // recipes per generation during trial
const PAID_RECIPE_CAP  = 5;   // recipes per generation for paid tiers

export const PLAN_IDS = {
  monthly:  { id: 'monthly',  label: 'Monthly',  period: '/month',  saving: null,         price: '₹99' },
  annual:   { id: 'annual',   label: 'Annual',   period: '/year',   saving: 'Save 33%',   price: '₹799' },
  lifetime: { id: 'lifetime', label: 'Lifetime', period: 'one-time',saving: 'Best value', price: '₹2,999' },
};

function today() { return new Date().toISOString().slice(0, 10); }

function loadPremium() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.expiresAt && data.expiresAt < Date.now()) {
      localStorage.removeItem(STORAGE_KEY); return null;
    }
    return data;
  } catch { return null; }
}

function loadTrial() {
  try {
    const raw = localStorage.getItem(TRIAL_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function initTrial(userId) {
  const trial = {
    userId,
    startedAt: Date.now(),
    expiresAt: Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000,
  };
  try { localStorage.setItem(TRIAL_KEY, JSON.stringify(trial)); } catch {}
  return trial;
}

function savePremium(data) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
}

// Sync premium to Supabase profiles (server-authoritative backup)
async function syncPremiumToSupabase(userId, data) {
  const sbUrl = process.env.REACT_APP_SUPABASE_URL;
  const anonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
  if (!sbUrl || !anonKey || !userId) return;
  try {
    await fetch(`${sbUrl}/rest/v1/profiles?id=eq.${userId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': anonKey,
        'Authorization': `Bearer ${anonKey}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        is_premium:         !!data,
        premium_expires_at: data?.expiresAt ? new Date(data.expiresAt).toISOString() : null,
        premium_plan:       data?.planId || null,
      }),
    });
  } catch {}
}

function loadUsage() {
  try {
    const raw = localStorage.getItem(USAGE_KEY);
    if (!raw) return { date: today(), count: 0 };
    const d = JSON.parse(raw);
    if (d.date !== today()) return { date: today(), count: 0 };
    return d;
  } catch { return { date: today(), count: 0 }; }
}

function saveUsage(d) { try { localStorage.setItem(USAGE_KEY, JSON.stringify(d)); } catch {} }

export function PremiumProvider({ children }) {
  const [premium,    setPremiumState] = useState(() => loadPremium());
  const [trial,      setTrialState]   = useState(() => loadTrial());
  const [usage,      setUsageState]   = useState(() => loadUsage());
  const [showGate,   setShowGate]     = useState(false);
  const [gateReason, setGateReason]   = useState('');

  // When PAYWALL_ENABLED=false, all users get full access — no gates
  const isPremium    = !PAYWALL_ENABLED || !!premium;
  const trialActive  = PAYWALL_ENABLED && !isPremium && !!trial && trial.expiresAt > Date.now();
  const trialExpired = PAYWALL_ENABLED && !isPremium && !!trial && trial.expiresAt <= Date.now();
  const hasNoAccess  = PAYWALL_ENABLED && !isPremium && !trialActive;

  // How many recipes to return per generation
  const recipeCount = (!PAYWALL_ENABLED || isPremium) ? PAID_RECIPE_CAP : trialActive ? TRIAL_RECIPE_CAP : 0;

  // Days remaining in trial
  const trialDaysLeft = trialActive
    ? Math.max(0, Math.ceil((trial.expiresAt - Date.now()) / (24 * 60 * 60 * 1000)))
    : 0;

  // Start trial for a newly signed-in user
  const startTrial = useCallback((userId) => {
    const existing = loadTrial();
    if (existing) { setTrialState(existing); return existing; }
    const t = initTrial(userId);
    setTrialState(t);
    trackTrialStart(userId);
    // Trial tracked via GA4 (trial_started_at not in profiles schema)
    return t;
  }, []);

  // Gate check before every generation
  const checkAccess = useCallback((reason = 'generation') => {
    if (!PAYWALL_ENABLED) return true;   // paywall disabled — full access
    if (isPremium) return true;
    if (trialExpired || hasNoAccess) {
      setGateReason(trialExpired ? 'trial_expired' : reason);
      setShowGate(true);
      trackPaywallShown(trialExpired ? 'trial_expired' : reason);
      return false;
    }
    return true; // trial active
  }, [isPremium, trialExpired, hasNoAccess]);

  // Track usage
  const recordUsage = useCallback(() => {
    const next = { date: today(), count: usage.count + 1 };
    setUsageState(next); saveUsage(next);
  }, [usage]);

  // Razorpay checkout
  const openCheckout = useCallback(async (planId, userId) => {
    const keyId = process.env.REACT_APP_RAZORPAY_KEY_ID;
    if (!keyId) { activateTestPremium(); return; }

    await new Promise((resolve, reject) => {
      if (window.Razorpay) { resolve(); return; }
      const s = document.createElement('script');
      s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });

    const orderRes = await fetch('/api/payments?action=create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId }),
    });
    const { orderId, amount, currency, error } = await orderRes.json();
    if (error) throw new Error(error);

    return new Promise((resolve, reject) => {
      const rzp = new window.Razorpay({
        key: keyId, amount, currency,
        name: 'Jiff', description: `Jiff ${PLAN_IDS[planId]?.label}`,
        order_id: orderId, theme: { color: '#FF4500' },
        handler: async (response) => {
          try {
            const verifyRes = await fetch('/api/payments?action=verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...response, planId }),
            });
            const v = await verifyRes.json();
            if (!v.verified) throw new Error('Verification failed');
            const pd = { planId, paymentId: response.razorpay_payment_id, activatedAt: Date.now(), expiresAt: v.expiresAt };
            savePremium(pd); setPremiumState(pd); setShowGate(false);
            syncPremiumToSupabase(userId, pd).catch(()=>{});
            resolve(pd);
          } catch (err) { reject(err); }
        },
        modal: { ondismiss: () => reject(new Error('dismissed')) },
      });
      rzp.open();
    });
  }, []);

  const activateTestPremium = () => {
    const data = { planId: 'monthly', paymentId: 'test', activatedAt: Date.now(), expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, test: true };
    savePremium(data); setPremiumState(data); setShowGate(false);
  };

  const clearPremium = () => { localStorage.removeItem(STORAGE_KEY); setPremiumState(null); };
  const clearTrial   = () => { localStorage.removeItem(TRIAL_KEY);   setTrialState(null);   };

  const value = {
    isPremium, premium,
    trial, trialActive, trialExpired, trialDaysLeft,
    hasNoAccess, recipeCount,
    plans: PLAN_IDS,
    checkAccess, recordUsage, startTrial,
    openCheckout, activateTestPremium,
    clearPremium, clearTrial,
    showGate, setShowGate, gateReason,
    razorpayEnabled: !!process.env.REACT_APP_RAZORPAY_KEY_ID,
    TRIAL_DAYS, TRIAL_RECIPE_CAP, PAID_RECIPE_CAP,
  };

  return <PremiumContext.Provider value={value}>{children}</PremiumContext.Provider>;
}
