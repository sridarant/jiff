// src/pages/Jiff.jsx
// Main app page — orchestration only. Business logic lives in hooks/services.
//
// ROUTING CONTRACT:
//   /app → user lands here. If user is logged in, show JourneyTiles (decision
//   screen) immediately — journeyMode defaults TRUE. Onboarding redirect fires
//   once if profile.onboarding_done is false.
//   After login (OAuth/magic-link), Supabase redirects to /app via redirectTo.

import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth }    from '../contexts/AuthContext';
import { usePremium } from '../contexts/PremiumContext';
import { useLocale, getCurrentSeason } from '../contexts/LocaleContext';
import { useRecipes }       from '../hooks/useRecipes';
import { useRetention }     from '../hooks/useRetention';
import { useNotifications } from '../hooks/useNotifications';
import { JourneyTiles } from '../components/common/JourneyTiles.jsx';
import AuthGate         from '../components/jiff/AuthGate';
import JiffHeader       from '../components/jiff/JiffHeader';
import JiffLoader       from '../components/jiff/JiffLoader';
import FridgeCard       from '../components/jiff/FridgeCard';
import LoadingView      from '../components/jiff/LoadingView';
import ResultsView      from '../components/jiff/ResultsView';
import styles           from '../styles/jiffStyles';
import { mealKey }      from '../lib/mealKey.js';
import { fetchHistory, trackStapleUsage, getStapleSuggestions } from '../services/historyService';

export default function Jiff() {
  const navigate  = useNavigate();
  const location  = useLocation();
  const genCtxNav    = location.state?.generateContext || null;
  const navJourneyCtx = location.state?.journeyContext   || null;

  const {
    user, profile, updateProfile, toggleFavourite, isFav,
    signInWithGoogle, signInWithEmail, signOut, supabaseEnabled, authLoading,
  } = useAuth();

  const {
    isPremium, trial, trialActive, trialDaysLeft, plans,
    checkAccess, recordUsage, startTrial, openCheckout,
    activateTestPremium, showGate, setShowGate, gateReason,
    razorpayEnabled, TRIAL_DAYS, PAID_RECIPE_CAP,
  } = usePremium();

  const { lang, units, setLang, setUnits, t, country, setCountry, CUISINE_OPTIONS } = useLocale();
  const season = getCurrentSeason();

  // ── Input state ────────────────────────────────────────────────
  const [fridgeItems,     setFridgeItems]     = useState([]);
  const [time,            setTime]            = useState('30 min');
  const [diet,            setDiet]            = useState('none');
  const [cuisine,         setCuisine]         = useState('any');
  const [mealType,        setMealType]        = useState(() => {
    const h = new Date().getHours();
    if (h >= 5  && h < 11) return 'breakfast';
    if (h >= 11 && h < 15) return 'lunch';
    if (h >= 15 && h < 18) return 'snack';
    if (h >= 18 && h < 22) return 'dinner';
    return 'any';
  });
  const [defaultServings, setDefaultServings] = useState(2);
  const [profileLoaded,   setProfileLoaded]   = useState(false);

  // journeyMode = true  → show JourneyTiles (decision screen)
  // journeyMode = false → show FridgeCard (ingredient input)
  // Logged-in users always start on the decision screen.
  const [journeyMode,     setJourneyMode]     = useState(true);

  const [inputMode,       setInputMode]       = useState('direct');
  const [gatePlan,        setGatePlan]        = useState('annual');
  const [gateLoading,     setGateLoading]     = useState(false);
  const [gateDismissed,   setGateDismissed]   = useState(false);
  const [emailInput,      setEmailInput]      = useState('');
  const [emailSent,       setEmailSent]       = useState(false);
  const [showUserMenu,    setShowUserMenu]    = useState(false);
  const [showNotifPanel,  setShowNotifPanel]  = useState(false);
  const [streak,          setStreak]          = useState(0);
  const [mealHistory,     setMealHistory]     = useState([]);
  const [stapleSuggestion,setStapleSuggestion]= useState(null);

  const ingredients = [...new Set([...fridgeItems])];

  // ── Business logic via hooks ───────────────────────────────────
  const {
    meals, view, errorMsg, loadingMessage, factIdx, ratings, tileContext,
    setView, setErrorMsg, setFactIdx, setRatings, setTileContext,
    handleSubmit, handleGenerateDirect, handleSurprise, handleRate,
    syncRatings, reset: resetRecipes,
  } = useRecipes({
    user, profile,
    isPremium, PAID_RECIPE_CAP, checkAccess, recordUsage,
    time, diet, cuisine, mealType, defaultServings,
    lang, units, country,
    setCuisine, setMealType, setJourneyMode,
    mealHistory,
  });

  const { notifications, unreadCount, markAllRead } = useNotifications({
    user, supabaseEnabled, streak,
  });

  const {
    didYouCookNudge, continuityNudge, weekCookCount,
    weeklyDigest, welcomeBack, challenge, milestone,
    upgradeNudge, setUpgradeNudge,
    confirmCooked, onNotYet, dismissNudge, recordGeneration, recordRating,
  } = useRetention({ mealHistory, ratings, user, isPremium });

  // ── Effects ────────────────────────────────────────────────────


  useEffect(() => {
    if (profile && !profileLoaded) {
      const ft = Array.isArray(profile.food_type) ? profile.food_type[0] : profile.food_type;
      // Store raw food_type value — must match what the API expects ('veg','vegan','jain',etc.)
      if (ft && ft !== 'none') setDiet(ft);
      if (profile.preferred_cuisines?.length) setCuisine(profile.preferred_cuisines[0]);
      if (profile.family_size > 4) setDefaultServings(6);
      else if (profile.family_size > 2) setDefaultServings(4);
      setProfileLoaded(true);
    }
  }, [profile, profileLoaded]);

  useEffect(() => {
    if (user && !trial && !isPremium) startTrial(user.id);
  }, [user, trial, isPremium, startTrial]);

  // Preference nudge — replaces onboarding redirect
  // Non-blocking: shown inline via JourneyTiles nudge, never navigates away
  const showPrefNudge = !!(user && profile && !profile.spice_level && !localStorage.getItem('jiff-pref-nudge-dismissed'));

  // Handle navigation-state generate context (e.g. from plan page)
  useEffect(() => {
    if (genCtxNav && user && profileLoaded) handleGenerateDirect(genCtxNav);
  }, []); // eslint-disable-line

  // Streak
  useEffect(() => {
    try {
      if (profile?.streak) { setStreak(profile.streak); return; }
      const d    = JSON.parse(localStorage.getItem('jiff-streak') || '{}');
      const yest = new Date(Date.now() - 86400000).toDateString();
      setStreak((d.lastDate === new Date().toDateString() || d.lastDate === yest) ? (d.count || 1) : 0);
    } catch {}
  }, [profile]);

  useEffect(() => { if (user) syncRatings(user.id); }, [user]); // eslint-disable-line

  useEffect(() => {
    if (view === 'results' && meals.length && user) recordGeneration(meals[0]?.name || 'your meal');
  }, [view]); // eslint-disable-line

  useEffect(() => {
    if (!user) return;
    fetchHistory(user.id).then(h => { if (h.length) setMealHistory(h); }).catch(() => {});
  }, [user]); // eslint-disable-line

  // ── Handlers ───────────────────────────────────────────────────
  const handleEmailSignIn = async () => {
    const { error } = await signInWithEmail(emailInput);
    if (!error) setEmailSent(true);
  };

  const handleGateUpgrade = async () => {
    if (!razorpayEnabled) { activateTestPremium(); return; }
    setGateLoading(true);
    try { await openCheckout(gatePlan); setShowGate(false); }
    catch (e) { if (e.message !== 'dismissed') alert('Payment failed. Please try again.'); }
    finally { setGateLoading(false); }
  };

  const handleLeftoverRescue = () => {
    setJourneyMode(false); setInputMode('leftover');
    setFridgeItems(['leftover rice', 'leftover curry']);
    setTileContext({ emoji:'♻️', color:'#D97706', bg:'rgba(217,119,6,0.08)',
      border:'rgba(217,119,6,0.25)', label:'Leftover rescue',
      sub:'Turning what you have into something great' });
    setView('input');
  };

  const reset = () => {
    resetRecipes(); setFridgeItems([]);
    setInputMode('direct');
    // Return to decision screen, not the fridge card
    setJourneyMode(true); setTileContext(null);
  };

  // ── Loading guard — prevents flash of wrong UI ────────────────
  if (authLoading) return <JiffLoader />;

  const showSignInGate = !authLoading && !user && !gateDismissed;

  // ── View renderer (used when journeyMode=false OR user=null) ───
  const renderView = () => {
    if (view === 'loading') return (
      <LoadingView
        cuisine={cuisine} mealType={mealType} ingredients={ingredients}
        isPremium={isPremium} PAID_RECIPE_CAP={PAID_RECIPE_CAP}
        factIdx={factIdx} loadingMessage={loadingMessage}
      />
    );

    if (view === 'error') return (
      <div className="error-wrap">
        <div className="error-icon">{'😕'}</div>
        <div className="error-title">{t('error_title_app')}</div>
        <div className="error-msg">{errorMsg}</div>
        <button className="cta-btn" onClick={reset}>{'← Try something else'}</button>
      </div>
    );

    if (view === 'results') return (
      <>
        {user && (
          <div style={{ textAlign:'center', padding:'12px 0 4px' }}>
            <button
              onClick={reset}
              style={{ background:'none', border:'none', cursor:'pointer', fontSize:12, color:'var(--muted)', fontFamily:"'DM Sans',sans-serif" }}>
              {'↺ Try something else'}
            </button>
          </div>
        )}
        <ResultsView
          meals={meals} mealType={mealType} cuisine={cuisine} time={time}
          diet={diet} defaultServings={defaultServings} ingredients={ingredients}
          profile={profile} user={user} isPremium={isPremium}
          trialActive={trialActive} PAID_RECIPE_CAP={PAID_RECIPE_CAP}
          ratings={ratings} setRatings={setRatings}
          isFav={isFav} toggleFavourite={toggleFavourite} country={country}
          CUISINE_OPTIONS={CUISINE_OPTIONS} tileContext={tileContext}
          stapleSuggestion={stapleSuggestion}
          onDismissStapleSuggestion={() => setStapleSuggestion(null)}
          onAddStaple={async (items) => {
            const newStaples = [...(profile?.weekly_staples || []), ...items.map(i => i.toLowerCase())];
            await updateProfile?.({ weekly_staples: newStaples });
            setStapleSuggestion(null);
          }}
          handleSurprise={() => handleSurprise(season)}
          onRate={(meal, stars) => { handleRate(meal, stars, user?.id, mealKey); recordRating(); }}
          reset={reset} navigate={navigate} t={t}
        />
      </>
    );

    // Fridge / ingredient input view
    return (
      <div className="main-layout">
        {/* Back to decision screen */}
        {user && (
          <button
            onClick={() => { setJourneyMode(true); setInputMode('direct'); setView('input'); }}
            style={{ display:'inline-flex', alignItems:'center', gap:5, marginBottom:14, background:'none', border:'none', cursor:'pointer', fontSize:12, color:'var(--muted)', fontFamily:"'DM Sans',sans-serif", padding:0 }}>
            {'← Decision screen'}
          </button>
        )}

        {/* First-use heading for non-logged-in users */}
        {!user && inputMode === 'direct' && (
          <>
            <h1 style={{ fontFamily:"'Fraunces',serif", fontSize:'clamp(26px,4vw,40px)', fontWeight:900, color:'var(--ink)', letterSpacing:'-1px', lineHeight:1.05, marginBottom:6 }}>
              {t('main_heading')}
            </h1>
            <p style={{ fontSize:13, color:'var(--muted)', fontWeight:300, marginBottom:20 }}>
              {t('main_sub') || 'Tell me what you have — get a recipe in seconds.'}
            </p>
          </>
        )}

        <FridgeCard
          inputMode={inputMode} fridgeItems={fridgeItems} setFridgeItems={setFridgeItems}
          diet={diet} setDiet={setDiet} time={time} setTime={setTime}
          cuisine={cuisine} setCuisine={setCuisine}
          defaultServings={defaultServings} setDefaultServings={setDefaultServings}
          profile={profile} lang={lang} user={user}
          isPremium={isPremium} trialActive={trialActive} PAID_RECIPE_CAP={PAID_RECIPE_CAP}
          ingredients={ingredients}
          handleSubmit={() => {
            if (fridgeItems.length) {
              trackStapleUsage(fridgeItems);
              const suggestions = getStapleSuggestions([]);
              if (suggestions.length) setStapleSuggestion({ items: suggestions, shown: false });
            }
            handleSubmit(ingredients, () => setGateDismissed(false));
          }}
          setGateDismissed={setGateDismissed}
          navigate={navigate} t={t}
        />
      </div>
    );
  };

  // ── Render ─────────────────────────────────────────────────────
  return (
    <>
      <style>{styles}</style>
      <div className="app">

        <AuthGate
          showSignInGate={showSignInGate} showGate={showGate}
          TRIAL_DAYS={TRIAL_DAYS} emailInput={emailInput} emailSent={emailSent}
          supabaseEnabled={supabaseEnabled} gateReason={gateReason}
          gatePlan={gatePlan} gateLoading={gateLoading} plans={plans}
          razorpayEnabled={razorpayEnabled} PAID_RECIPE_CAP={PAID_RECIPE_CAP}
          setEmailInput={setEmailInput} setGateDismissed={setGateDismissed}
          setGatePlan={setGatePlan} setShowGate={setShowGate}
          signInWithGoogle={signInWithGoogle}
          handleEmailSignIn={handleEmailSignIn}
          handleGateUpgrade={handleGateUpgrade}
          activateTestPremium={activateTestPremium}
          navigate={navigate} t={t}
        />

        <JiffHeader
          view={view} user={user} profile={profile}
          isPremium={isPremium} trialActive={trialActive} trialDaysLeft={trialDaysLeft}
          showNotifications={showNotifPanel} setShowNotifications={setShowNotifPanel}
          notifications={notifications} unreadCount={unreadCount}
          showUserMenu={showUserMenu} setShowUserMenu={setShowUserMenu}
          markAllRead={markAllRead} signOut={signOut}
          navigate={navigate} t={t}
        />

        {/* Error toast — shown on journey home if generation fails */}
        {journeyMode && user && view === 'input' && errorMsg && (
          <div style={{ margin:'8px 16px', padding:'10px 14px', background:'rgba(229,62,62,0.08)', border:'1px solid rgba(229,62,62,0.25)', borderRadius:10, fontSize:13, color:'#C53030', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            {errorMsg}
            <button onClick={() => setErrorMsg('')} style={{ background:'none', border:'none', cursor:'pointer', color:'#C53030', fontSize:16, lineHeight:1 }}>{'×'}</button>
          </div>
        )}

        {/* Profile nudge handled by JourneyTiles via showPrefNudge prop */}

        {journeyMode && user && view === 'input' && (
          <JourneyTiles
            user={user} profile={profile} profileLoaded={profileLoaded} season={season} streak={streak}
            country={profile?.country || 'IN'}
            ratings={ratings} mealHistory={mealHistory}
            didYouCookNudge={didYouCookNudge}
            weeklyDigest={weeklyDigest}
            welcomeBack={welcomeBack}
            challenge={challenge}
            milestone={milestone}
            upgradeNudge={upgradeNudge}
            onDismissUpgrade={() => setUpgradeNudge(null)}
            continuityNudge={continuityNudge}
            weekCookCount={weekCookCount}
            showPrefNudge={showPrefNudge}
            onConfirmCooked={confirmCooked}
            onNotYet={onNotYet}
            onShowSomethingElse={() => { /* re-run recommendations */ }}
            onDismissNudge={dismissNudge}
            navJourneyCtx={navJourneyCtx}
            onSelectFridge={() => { setJourneyMode(false); setInputMode('fridge'); }}
            onGenerateDirect={handleGenerateDirect}
            onLeftoverRescue={handleLeftoverRescue}
          />
        )}

        {/* Fridge input / results / loading — shown when not in journey mode */}

        {(!journeyMode || !user) && renderView()}

      </div>
    </>
  );
}
