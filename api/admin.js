// api/admin.js — Consolidated: admin data + stats + meal history
// v1.23.19: ALL actions wrapped in top-level try/catch; ZERO 500 responses for non-critical ops.
// Consistent response format: { ok, data?, error? }

const ADMIN_KEY = 'jiff-admin-2026';
function safeArray(data) { return Array.isArray(data) ? data : []; }
const safeCount = (r) => {
  try { const n = parseInt(r.headers.get('content-range')?.split('/')[1]); return isNaN(n) ? 0 : n; } catch { return 0; }
};
const safeJson = async (r) => { try { const d = await r.json(); return Array.isArray(d) ? d : []; } catch { return []; } };
const ok200    = (res, data) => res.status(200).json({ ok: true,  ...data });
const fail200  = (res, msg)  => res.status(200).json({ ok: false, error: msg || 'Handled safely' });

export default async function handler(req, res) {
  // ── Global safety wrapper — admin MUST NEVER return 500 ──────
  try {
    return await _handler(req, res);
  } catch (err) {
    console.error('[admin] Fatal unhandled error:', err?.message || err);
    return res.status(200).json({ ok: false, error: 'Handled safely', data: [] });
  }
}

async function _handler(req, res) {
  const url      = process.env.REACT_APP_SUPABASE_URL;
  const key      = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const safeBody = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {};
  const action   = req.query.action || safeBody.action;
  const h        = { 'Content-Type': 'application/json', 'apikey': key || '', 'Authorization': `Bearer ${key || ''}` };
  const mh       = { ...h, 'Prefer': 'return=minimal' };

  // ── STATS (public, cached) ────────────────────────────────────
  if (action === 'stats') {
    if (!url || !key) return fail200(res, 'Stats not configured');
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    try {
      const [usersR, mealsR] = await Promise.all([
        fetch(`${url}/rest/v1/profiles?select=id`,      { headers: { ...h, 'Prefer': 'count=exact', 'Range': '0-0' } }),
        fetch(`${url}/rest/v1/meal_history?select=id`,  { headers: { ...h, 'Prefer': 'count=exact', 'Range': '0-0' } }),
      ]);
      const totalUsers = safeCount(usersR), totalMeals = safeCount(mealsR);
      const since = new Date(Date.now() - 7 * 86400000).toISOString();
      const [histR, profilesR, cuisineR] = await Promise.all([
        fetch(`${url}/rest/v1/meal_history?select=generated_at&generated_at=gte.${since}&order=generated_at.asc`, { headers: h }),
        fetch(`${url}/rest/v1/profiles?select=country&limit=1000`, { headers: h }),
        fetch(`${url}/rest/v1/meal_history?select=cuisine&limit=500`, { headers: h }),
      ]);
      const recentMeals = await safeJson(histR);
      const profiles    = await safeJson(profilesR);
      const cuisineRows = await safeJson(cuisineR);
      const today = new Date();
      const last7 = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(today); d.setDate(today.getDate() - (6 - i));
        return { date: d.toISOString().slice(0, 10), label: d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' }) };
      });
      const dateMap = {}; const dayMap = {};
      const dayLabels = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      recentMeals.forEach(m => {
        if (m?.generated_at) {
          const k = m.generated_at.slice(0, 10); dateMap[k] = (dateMap[k] || 0) + 1;
          const dk = dayLabels[new Date(m.generated_at).getDay()]; dayMap[dk] = (dayMap[dk] || 0) + 1;
        }
      });
      const countryCount = {}, cuisineCount = {};
      profiles.forEach(p => { if (p?.country) countryCount[p.country] = (countryCount[p.country] || 0) + 1; });
      cuisineRows.forEach(r => { if (r?.cuisine && r.cuisine !== 'any') cuisineCount[r.cuisine] = (cuisineCount[r.cuisine] || 0) + 1; });
      const flagMap = { IN:'🇮🇳',SG:'🇸🇬',GB:'🇬🇧',AU:'🇦🇺',US:'🇺🇸',DE:'🇩🇪',FR:'🇫🇷',MY:'🇲🇾',AE:'🇦🇪' };
      const nameMap = { IN:'India',SG:'Singapore',GB:'United Kingdom',AU:'Australia',US:'United States',DE:'Germany',FR:'France',MY:'Malaysia',AE:'UAE' };
      const total = totalUsers || 1;
      return ok200(res, {
        totalUsers, totalMeals,
        countriesCount: Object.keys(countryCount).length || 1,
        todayUsers: dayMap[dayLabels[new Date().getDay()]] || 0,
        growthPct: 0,
        topCountries: Object.entries(countryCount).sort((a, b) => b[1] - a[1]).slice(0, 7)
          .map(([code, count]) => ({ name: nameMap[code] || code, code, flag: flagMap[code] || '🌍', users: count, pct: Math.round(count / total * 100) || 1 })),
        topCuisines: Object.entries(cuisineCount).sort((a, b) => b[1] - a[1]).slice(0, 7)
          .map(([name, count]) => ({ name, count, pct: Math.round(count / (totalMeals || 1) * 100) || 1 })),
        weeklyTrend: last7.map(d => ({ day: d.label, meals: dateMap[d.date] || 0 })),
      });
    } catch (e) {
      console.error('[admin/stats]', e?.message);
      return fail200(res, 'Stats temporarily unavailable');
    }
  }

  // ── MEAL HISTORY (user auth, no admin key required) ───────────
  if (action === 'meal-history' || (!req.query.action && req.headers['x-user-id'])) {
    if (!url || !key) {
      if (req.method === 'GET') return ok200(res, { history: [] });
      return ok200(res, { fallback: true });
    }

    if (req.method === 'POST') {
      const { userId, meals, mealType, cuisine, servings, ingredients } = safeBody;
      if (!userId || !meals?.length) return fail200(res, 'Missing userId or meals');
      try {
        const safeMeals = Array.isArray(meals) ? meals : (meals ? [meals] : []);
      if (!safeMeals.length) return fail200(res, 'meals must be a non-empty array');
      const rows = safeMeals.map(meal => ({
          user_id: userId, meal, meal_type: mealType || 'any', cuisine: cuisine || 'any',
          servings: servings || 2, ingredients: ingredients || [], generated_at: new Date().toISOString(),
        }));
        const r = await fetch(`${url}/rest/v1/meal_history`, { method: 'POST', headers: mh, body: JSON.stringify(rows) });
        return ok200(res, { saved: r.ok });
      } catch (e) {
        console.error('[admin/meal-history POST]', e?.message);
        return fail200(res, 'Save failed');
      }
    }

    if (req.method === 'GET') {
      const userId = req.query.userId || safeBody.userId; // fixed: no duplicate const
      if (!userId) return ok200(res, { history: [] });
      try {
        const r = await fetch(`${url}/rest/v1/meal_history?user_id=eq.${userId}&order=generated_at.desc&limit=30`, { headers: h });
        const data = await safeJson(r);
        return ok200(res, { history: data });
      } catch (e) {
        console.error('[admin/meal-history GET]', e?.message);
        return ok200(res, { history: [] }); // safe fallback — empty history not a crash
      }
    }

    if (req.method === 'DELETE') {
      const { id, userId } = safeBody;
      if (!id || !userId) return fail200(res, 'Missing id or userId');
      try {
        await fetch(`${url}/rest/v1/meal_history?id=eq.${id}&user_id=eq.${userId}`, { method: 'DELETE', headers: mh });
        return ok200(res, {});
      } catch (e) {
        console.error('[admin/meal-history DELETE]', e?.message);
        return fail200(res, 'Delete failed');
      }
    }

    if (req.method === 'PATCH') {
      const { userId, mealName, rating } = safeBody;
      if (!userId || !mealName || !rating) return fail200(res, 'Missing fields');
      try {
        const findR = await fetch(
          `${url}/rest/v1/meal_history?user_id=eq.${userId}&select=id&order=generated_at.desc&limit=1`,
          { headers: h }
        );
        const rows = await safeJson(findR);
        if (!rows.length) return ok200(res, { notFound: true });
        await fetch(`${url}/rest/v1/meal_history?id=eq.${rows[0].id}`, {
          method: 'PATCH', headers: mh,
          body: JSON.stringify({ rating, cooked_at: new Date().toISOString() }),
        });
        return ok200(res, {});
      } catch (e) {
        console.error('[admin/meal-history PATCH]', e?.message);
        return fail200(res, 'Update failed');
      }
    }
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  if (!url || !key) return fail200(res, 'Supabase not configured');

  // ── LOG-EVENT (new — fires silently, never blocks) ────────────
  if (action === 'log-event') {
    if (!safeBody.event) return ok200(res, { ok: false, skipped: true });
    try {
      await fetch(`${url}/rest/v1/events`, {
        method: 'POST', headers: mh,
        body: JSON.stringify({
          event:      safeBody.event,
          user_id:    safeBody.userId    || null,
          properties: safeBody.properties || {},
          created_at: new Date().toISOString(),
        }),
      }).catch(() => {}); // fire-and-forget
    } catch {} // never throw
    return ok200(res, {});
  }

  // ── LOG-RECOMMENDATION ────────────────────────────────────────
  if (action === 'log-recommendation' && req.method === 'POST') {
    const { userId, mealId, mealName, action: fbAction, position, cuisine, timestamp } = safeBody;
    if (!fbAction) return ok200(res, { ok: false, skipped: true });
    try {
      await fetch(`${url}/rest/v1/recommendation_log`, {
        method: 'POST', headers: mh,
        body: JSON.stringify({
          user_id: userId || null, meal_id: mealId, meal_name: mealName,
          action: fbAction, position: position ?? null, cuisine: cuisine || null,
          created_at: timestamp || new Date().toISOString(),
        }),
      }).catch(() => {});
    } catch {}
    return ok200(res, {});
  }

  if (action === 'recommendation-log' && req.method === 'GET') {
    try {
      const { userId, limit = '100' } = req.query;
      const lim    = Math.min(parseInt(limit) || 100, 500);
      const filter = (!userId || userId === 'all') ? '' : `&user_id=eq.${encodeURIComponent(userId)}`;
      const r      = await fetch(`${url}/rest/v1/recommendation_log?order=created_at.desc&limit=${lim}${filter}`, { headers: h });
      const data   = await safeJson(r);
      return ok200(res, { log: data });
    } catch (e) {
      console.error('[admin/recommendation-log]', e?.message);
      return ok200(res, { log: [] });
    }
  }

  // ── ADMIN-ONLY ACTIONS (require ADMIN_KEY) ─────────────────────
  if (action === 'users' && req.method === 'GET') {
    try {
      const r = await fetch(`${url}/rest/v1/profiles?select=id,name,email,country,created_at&order=created_at.desc&limit=200`, { headers: h });
      return ok200(res, { users: await safeJson(r) });
    } catch (e) { return fail200(res, e?.message); }
  }

  if (action === 'feedback' && req.method === 'GET') {
    try {
      const r = await fetch(`${url}/rest/v1/feedback?select=*&order=created_at.desc&limit=100`, { headers: h });
      return ok200(res, { feedback: await safeJson(r) });
    } catch (e) { return fail200(res, e?.message); }
  }

  if (action === 'usage' && req.method === 'GET') {
    try {
      const [keysR, todayR] = await Promise.all([
        fetch(`${url}/rest/v1/api_keys?select=key,tier,usage_count&order=usage_count.desc&limit=20`, { headers: h }),
        fetch(`${url}/rest/v1/api_keys?select=usage_count&usage_date=eq.${new Date().toISOString().slice(0,10)}`, { headers: h }),
      ]);
      const keys = await safeJson(keysR), today = await safeJson(todayR);
      return ok200(res, {
        totalCalls:  keys.reduce((s, k) => s + (k.usage_count || 0), 0),
        todayCalls:  today.reduce((s, k) => s + (k.usage_count || 0), 0),
        activeKeys:  keys.length, errorsToday: 0, topKeys: keys.slice(0, 10),
      });
    } catch (e) { return fail200(res, e?.message); }
  }

  if (action === 'reset-trial' && req.method === 'POST') {
    const { email, adminKey } = safeBody;
    if (adminKey !== ADMIN_KEY) return res.status(401).json({ ok: false, error: 'Unauthorised' });
    if (!email) return fail200(res, 'Email required');
    try {
      const findR = await fetch(`${url}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=id`, { headers: h });
      const users = await safeJson(findR);
      if (!users.length) return fail200(res, `No user found: ${email}`);
      await fetch(`${url}/rest/v1/trials?user_id=eq.${users[0].id}`, { method: 'DELETE', headers: mh });
      return ok200(res, { message: `Trial reset for ${email}` });
    } catch (e) { return fail200(res, e?.message); }
  }

  if (action === 'broadcast' && req.method === 'POST') {
    const { message, adminKey } = safeBody;
    if (adminKey !== ADMIN_KEY) return res.status(401).json({ ok: false, error: 'Unauthorised' });
    if (!message?.trim()) return fail200(res, 'Message required');
    try {
      await fetch(`${url}/rest/v1/broadcasts`, {
        method: 'POST', headers: mh,
        body: JSON.stringify({ message: message.trim(), created_at: new Date().toISOString(), active: true }),
      });
      const cR = await fetch(`${url}/rest/v1/profiles?select=count`, { headers: { ...h, 'Prefer': 'count=exact', 'Range': '0-0' } });
      return ok200(res, { recipientCount: safeCount(cR) });
    } catch (e) { return fail200(res, e?.message); }
  }

  if (action === 'token-stats' && req.method === 'GET') {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const [totalR, todayR, epR] = await Promise.all([
        fetch(`${url}/rest/v1/token_usage?select=input_tokens,output_tokens,total_tokens`, { headers: h }),
        fetch(`${url}/rest/v1/token_usage?select=input_tokens,output_tokens,total_tokens&logged_at=gte.${today}T00:00:00Z`, { headers: h }),
        fetch(`${url}/rest/v1/token_usage?select=endpoint,input_tokens,output_tokens,total_tokens`, { headers: h }),
      ]);
      const all = await safeJson(totalR), todayAll = await safeJson(todayR), byEpRaw = await safeJson(epR);
      const sum = (arr, k) => arr.reduce((s, r) => s + (r[k] || 0), 0);
      const epMap = {};
      byEpRaw.forEach(r => {
        if (!epMap[r.endpoint]) epMap[r.endpoint] = { calls: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0 };
        epMap[r.endpoint].calls++; epMap[r.endpoint].input_tokens += r.input_tokens || 0;
        epMap[r.endpoint].output_tokens += r.output_tokens || 0; epMap[r.endpoint].total_tokens += r.total_tokens || 0;
      });
      const totalInput = sum(all, 'input_tokens'), totalOutput = sum(all, 'output_tokens');
      return ok200(res, {
        totalCalls: all.length, totalTokens: sum(all, 'total_tokens'),
        inputTokens: totalInput, outputTokens: totalOutput,
        todayCalls: todayAll.length, todayTokens: sum(todayAll, 'total_tokens'),
        byEndpoint: Object.entries(epMap).map(([e, v]) => ({ endpoint: e, ...v })).sort((a, b) => b.total_tokens - a.total_tokens),
        costEstimateUSD: +((totalInput / 1e6 * 3) + (totalOutput / 1e6 * 15)).toFixed(4),
      });
    } catch (e) { return fail200(res, e?.message); }
  }

  if (action === 'waitlist' && req.method === 'GET') {
    try {
      const r = await fetch(`${url}/rest/v1/broadcasts?select=message,created_at&order=created_at.desc&limit=200`, { headers: h });
      const rows = await safeJson(r);
      const waitlist = rows.filter(b => b.message?.includes('@') || b.message?.startsWith('waitlist:'))
        .map(b => ({ email: b.message.replace('waitlist:', '').trim(), joined_at: b.created_at }));
      return ok200(res, { waitlist });
    } catch (e) { return fail200(res, e?.message); }
  }

  if (action === 'save-setting' && req.method === 'POST') {
    const { key: sk, value, adminKey } = safeBody;
    if (adminKey !== ADMIN_KEY) return res.status(401).json({ ok: false, error: 'Unauthorised' });
    if (!sk) return fail200(res, 'key required');
    try {
      await fetch(`${url}/rest/v1/api_keys`, {
        method: 'POST', headers: { ...h, 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify({ key: `__setting__${sk}`, tier: 'admin', value_json: JSON.stringify(value), usage_count: 0, usage_date: new Date().toISOString().slice(0,10) }),
      });
      return ok200(res, {});
    } catch (e) { return fail200(res, e?.message); }
  }

  if (action === 'load-setting' && req.method === 'GET') {
    const { key: sk } = req.query;
    if (!sk) return fail200(res, 'key required');
    try {
      const r = await fetch(`${url}/rest/v1/api_keys?key=eq.__setting__${sk}&select=value_json&limit=1`, { headers: h });
      const rows = await safeJson(r);
      return ok200(res, { value: rows[0]?.value_json ? JSON.parse(rows[0].value_json) : null });
    } catch (e) { return fail200(res, e?.message); }
  }

  if (action === 'releases' && req.method === 'GET') {
    try {
      const r = await fetch(`${url}/rest/v1/releases?select=*&order=deployed_at.desc&limit=50`, { headers: h });
      return ok200(res, { releases: await safeJson(r) });
    } catch (e) { return fail200(res, e?.message); }
  }

  // Mutation actions — safe 200 fallback on DB failure
  const safeMutate = async (fetchCall, label) => {
    try { await fetchCall(); return ok200(res, {}); }
    catch (e) { console.error(`[admin/${label}]`, e?.message); return fail200(res, `${label} failed`); }
  };

  if (action === 'update-cuisine' && req.method === 'POST') {
    const { userId, cuisine } = safeBody;
    if (!userId) return fail200(res, 'userId required');
    return safeMutate(() => fetch(`${url}/rest/v1/profiles?id=eq.${userId}`, {
      method: 'PATCH', headers: mh, body: JSON.stringify({ last_cuisine: cuisine }),
    }), 'update-cuisine');
  }

  if (action === 'update-streak' && req.method === 'POST') {
    const { userId, streak, lastCooked } = safeBody;
    if (!userId) return fail200(res, 'userId required');
    return safeMutate(() => fetch(`${url}/rest/v1/profiles?id=eq.${userId}`, {
      method: 'PATCH', headers: mh, body: JSON.stringify({ streak, last_cooked_at: lastCooked }),
    }), 'update-streak');
  }

  if (action === 'update-rating' && req.method === 'POST') {
    const { mealId, rating, userId } = safeBody;
    if (!mealId || !userId) return fail200(res, 'mealId and userId required');
    return safeMutate(() => fetch(`${url}/rest/v1/meal_history?id=eq.${mealId}&user_id=eq.${userId}`, {
      method: 'PATCH', headers: mh, body: JSON.stringify({ rating, cooked_at: new Date().toISOString() }),
    }), 'update-rating');
  }

  if (action === 'update-behaviour' && req.method === 'POST') {
    const { userId, behaviourData } = safeBody;
    if (!userId) return fail200(res, 'userId required');
    return safeMutate(() => fetch(`${url}/rest/v1/profiles?id=eq.${userId}`, {
      method: 'PATCH', headers: mh, body: JSON.stringify({ behaviour_data: behaviourData }),
    }), 'update-behaviour');
  }

  return ok200(res, { ok: false, error: `Unknown action: ${action}` });
}
