// src/hooks/useRetention.js — v1.23.03
// Sprint 3+4 retention + cook feedback storage + continuity.
//
// CHANGES v1.23.03:
//   COOK_HISTORY_KEY: stores array of { mealName, mealType, cooked, liked, timestamp }
//   continuityNudge:  reads cook history → shows "Last time you liked ___"
//   weekCookCount:    count of cooked=true entries in last 7 days
//   confirmCooked:    now accepts { mealName, liked } and persists structured record
//   onNotYet:         stores cooked:false so we stop nagging
//   recentSuccessBoost exported for use by recommendationService

import { useState, useEffect, useCallback } from 'react';
import { logFeedback } from '../services/feedbackService';

const K = {
  lastGenerated:  'jiff-last-generated',   // { mealName, mealType, timestamp, shown }
  lastOpen:       'jiff-last-open',         // ISO date string
  weeklyDigest:   'jiff-weekly-digest',     // { shownWeek }
  challenge:      'jiff-challenge',         // { week, type, target, progress, done }
  milestones:     'jiff-milestones',        // { rating5, rating15 }
  cookHistory:    'jiff-cook-history',      // [{mealName, mealType, cooked, liked, timestamp}]
};

const COOK_HISTORY_MAX = 50;
const CHALLENGES = [
  { type:'variety',   label:'Try 3 different meal types this week',         target:3 },
  { type:'cuisine',   label:'Try a new cuisine this week',                 target:1 },
  { type:'breakfast', label:'Make breakfast at home 3 mornings this week', target:3 },
  { type:'rated',     label:'Rate 3 recipes this week',                    target:3 },
  { type:'leftover',  label:'Rescue leftovers at least once this week',    target:1 },
];

function getWeekKey() {
  const d   = new Date();
  const jan = new Date(d.getFullYear(), 0, 1);
  const wk  = Math.ceil(((d - jan) / 86400000 + jan.getDay() + 1) / 7);
  return d.getFullYear() + '-W' + String(wk).padStart(2, '0');
}
function daysSince(isoStr) {
  if (!isoStr) return 999;
  return Math.floor((Date.now() - new Date(isoStr).getTime()) / 86400000);
}
function isMonday() { return new Date().getDay() === 1; }
function safe(key)       { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function save(key, val)  { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

// ── Cook history helpers ──────────────────────────────────────────
function loadCookHistory() {
  return safe(K.cookHistory) || [];
}
function saveCookRecord(record) {
  const hist = loadCookHistory();
  hist.unshift(record);
  save(K.cookHistory, hist.slice(0, COOK_HISTORY_MAX));
}

// Returns the last N cooked (cooked:true) entries
function getRecentCooked(n = 5) {
  return loadCookHistory().filter(r => r.cooked).slice(0, n);
}

// Returns the most recently LIKED meal that was cooked > 0 days ago but ≤ 7 days
function getLastLiked() {
  const cutoff = Date.now() - 7 * 86400000;
  return loadCookHistory().find(r =>
    r.liked && r.cooked &&
    new Date(r.timestamp).getTime() > cutoff
  ) || null;
}

// ── Exported: used by recommendationService for "recent success boost" ──
export function getRecentSuccessBoostMap() {
  const liked = getRecentCooked(10).filter(r => r.liked);
  const map   = {};
  liked.forEach(r => {
    const key = (r.mealName || '').toLowerCase().trim();
    if (key) map[key] = (map[key] || 0) + 0.1; // each like adds 0.1 to score
  });
  return map;
}

export function useRetention({ mealHistory = [], ratings = {}, user, isPremium = false }) {
  const [didYouCookNudge, setDidYouCookNudge] = useState(null);
  const [continuityNudge, setContinuityNudge] = useState(null);
  const [weekCookCount,   setWeekCookCount]   = useState(0);
  const [weeklyDigest,    setWeeklyDigest]    = useState(null);
  const [welcomeBack,     setWelcomeBack]     = useState(null);
  const [challenge,       setChallenge]       = useState(null);
  const [milestone,       setMilestone]       = useState(null);
  const [upgradeNudge,    setUpgradeNudge]    = useState(null);

  const ratingCount = Object.keys(ratings).length;

  // ── Mount evaluation ─────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;

    const now      = new Date().toISOString();
    const lastOpen = safe(K.lastOpen);
    const days     = daysSince(lastOpen);
    save(K.lastOpen, now);

    // 1. Welcome back — only after 5+ days away (3 days is a normal weekend)
    if (days >= 5 && lastOpen) setWelcomeBack({ daysAway: days });

    // 2. Did-you-cook nudge — only ask if it was yesterday or 2 days ago (not stale)
    const lastGen = safe(K.lastGenerated);
    const daysSinceGen = daysSince(lastGen?.timestamp);
    if (lastGen && !lastGen.shown && daysSinceGen >= 1 && daysSinceGen <= 2) {
      setDidYouCookNudge({ mealName: lastGen.mealName, mealType: lastGen.mealType });
      save(K.lastGenerated, { ...lastGen, shown: true });
    }

    // 3. Continuity — "Last time you liked ___"
    if (!lastGen || lastGen.shown) {
      const liked = getLastLiked();
      if (liked) {
        const daysAgo = daysSince(liked.timestamp);
        if (daysAgo >= 1 && daysAgo <= 7) {
          const { getDaypart: _gdp } = require('../lib/daypart.js') || {};
          const _dp = typeof getDaypart !== 'undefined' ? getDaypart() : (new Date().getHours() >= 17 ? 'tonight' : new Date().getHours() >= 11 ? 'today' : 'this morning');
          const period = _dp === 'evening' || _dp === 'night' ? 'tonight' : _dp === 'afternoon' ? 'today' : 'this morning';
          setContinuityNudge({ mealName: liked.mealName, daysAgo, period });
        }
      }
    }

    // 4. Weekly cook count from cook history (cooked:true, last 7 days)
    const weekAgo = Date.now() - 7 * 86400000;
    const wcc = loadCookHistory().filter(r => r.cooked && new Date(r.timestamp).getTime() > weekAgo).length;
    setWeekCookCount(wcc);

    // 5. Weekly digest (Monday only)
    if (isMonday()) {
      const digest   = safe(K.weeklyDigest);
      const thisWeek = getWeekKey();
      if (digest?.shownWeek !== thisWeek && Array.isArray(mealHistory) && mealHistory.length) {
        const weekMeals = mealHistory.filter(h => new Date(h.generated_at) > new Date(weekAgo));
        if (weekMeals.length >= 2) {
          const cuisines = [...new Set(weekMeals.map(h => h.cuisine).filter(Boolean))];
          setWeeklyDigest({ cooks: weekMeals.length, cuisines: cuisines.slice(0, 2), rated: weekMeals.filter(h => h.rating).length });
          save(K.weeklyDigest, { shownWeek: thisWeek });
        }
      }
    }

    // 6. Challenge
    const stored   = safe(K.challenge);
    const thisWeek = getWeekKey();
    if (!stored || stored.week !== thisWeek) {
      const weekNum = parseInt(thisWeek.split('-W')[1], 10);
      const ch = CHALLENGES[weekNum % CHALLENGES.length];
      const nc = { week: thisWeek, ...ch, progress: 0, done: false };
      save(K.challenge, nc);
      setChallenge(nc);
    } else {
      setChallenge(stored);
    }

    // 7. Milestones
    const ms = safe(K.milestones) || {};
    if (ratingCount >= 15 && !ms.rating15) {
      setMilestone({ type: 'rating15' });
      save(K.milestones, { ...ms, rating5: true, rating15: true });
    } else if (ratingCount >= 5 && !ms.rating5) {
      setMilestone({ type: 'rating5' });
      save(K.milestones, { ...ms, rating5: true });
    }
  }, [user]); // eslint-disable-line

  // Upgrade nudge
  useEffect(() => {
    if (!user || isPremium) return;
    if (ratingCount >= 3) {
      const shown = localStorage.getItem('jiff-upgrade-nudge-shown');
      if (!shown) {
        setUpgradeNudge({ reason: 'engaged', ratingCount });
        localStorage.setItem('jiff-upgrade-nudge-shown', '1');
      }
    }
  }, [user, isPremium, ratings]); // eslint-disable-line

  // ── Event triggers ───────────────────────────────────────────────

  // Called after generation — store for did-you-cook nudge next session
  const recordGeneration = useCallback((mealName, mealType) => {
    save(K.lastGenerated, {
      mealName, mealType: mealType || 'any',
      timestamp: new Date().toISOString(), shown: false,
    });
  }, []);

  // Called when user taps "Yes 👍" — stores cooked:true, liked:true
  const confirmCooked = useCallback(({ mealName, liked = true } = {}) => {
    const name = mealName || (safe(K.lastGenerated)?.mealName) || 'unknown';
    const type = safe(K.lastGenerated)?.mealType || 'any';

    // Persist structured cook record
    saveCookRecord({
      mealName: name,
      mealType: type,
      cooked:   true,
      liked:    liked,
      timestamp: new Date().toISOString(),
    });

    // Update weekly cook count
    setWeekCookCount(prev => prev + 1);

    // Log to feedbackService for engine learning
    logFeedback({
      meal: {
        id:         name.toLowerCase().replace(/\s+/g, '_'),
        name,
        cuisine:    'any',
        effortMins: 30,
      },
      action: 'completed',
      userId: null,
    });

    setDidYouCookNudge(null);
    setContinuityNudge(null);

    // Challenge progress
    const ch = safe(K.challenge);
    if (ch && !ch.done) {
      const updated = { ...ch, progress: Math.min(ch.progress + 1, ch.target) };
      if (updated.progress >= updated.target) updated.done = true;
      save(K.challenge, updated);
      setChallenge(updated);
    }
  }, []);

  // Called when user taps "Not yet" — stores cooked:false so we stop re-asking
  const onNotYet = useCallback(() => {
    const lastGen = safe(K.lastGenerated);
    if (lastGen?.mealName) {
      saveCookRecord({
        mealName:  lastGen.mealName,
        mealType:  lastGen.mealType || 'any',
        cooked:    false,
        liked:     false,
        timestamp: new Date().toISOString(),
      });
    }
    setDidYouCookNudge(null);
  }, []);

  const dismissNudge = useCallback((type) => {
    if (type === 'did-you-cook')  setDidYouCookNudge(null);
    if (type === 'welcome-back')  setWelcomeBack(null);
    if (type === 'weekly-digest') setWeeklyDigest(null);
    if (type === 'milestone')     setMilestone(null);
    if (type === 'continuity')    setContinuityNudge(null);
  }, []);

  const recordRating = useCallback(() => {
    const ch = safe(K.challenge);
    if (ch?.type === 'rated' && !ch.done) {
      const updated = { ...ch, progress: Math.min(ch.progress + 1, ch.target) };
      if (updated.progress >= updated.target) updated.done = true;
      save(K.challenge, updated);
      setChallenge(updated);
    }
  }, []);

  return {
    didYouCookNudge, continuityNudge, weekCookCount,
    weeklyDigest, welcomeBack, challenge, milestone, upgradeNudge,
    setDidYouCookNudge, setContinuityNudge, setWeekCookCount,
    setWeeklyDigest, setWelcomeBack,
    setChallenge, setMilestone, setUpgradeNudge,
    recordGeneration, confirmCooked, onNotYet, dismissNudge, recordRating,
  };
}
