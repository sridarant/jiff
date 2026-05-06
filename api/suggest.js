// api/suggest.js — Internal suggest + Public API v1 (?v=1 + X-API-Key)

// ── RUNTIME INSTRUMENTATION (safe to leave in production) ────────
const DEBUG_VERSION = 'v1.23.35-debug';
console.log('[suggest] FILE_LOADED', DEBUG_VERSION);

const DAILY_LIMITS = { free: 10, starter: 500, pro: 5000 };

// ── Token usage logger (fire-and-forget, never blocks response) ────
async function logTokenUsage({ endpoint, model, inputTokens, outputTokens, sbUrl, sbKey }) {
  if (!sbUrl || !sbKey) return;
  try {
    await fetch(`${sbUrl}/rest/v1/token_usage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': sbKey,
        'Authorization': `Bearer ${sbKey}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        endpoint,
        model,
        input_tokens:  inputTokens  || 0,
        output_tokens: outputTokens || 0,
        total_tokens:  (inputTokens || 0) + (outputTokens || 0),
        logged_at: new Date().toISOString(),
      }),
    });
  } catch {} // never block the main response
}

// ── In-memory rate limiter (per IP, sliding window) ────────────────
const RL_WINDOW  = 60 * 1000;  // 1 minute
const RL_LIMITS  = { suggest: 20, planner: 10, default: 30 };
const _rlStore   = new Map();

function rateLimit(ip, endpoint = 'default') {
  const key  = `${endpoint}:${ip}`;
  const now  = Date.now();
  const limit = RL_LIMITS[endpoint] || RL_LIMITS.default;
  const entry = _rlStore.get(key) || { hits: [], blocked: false };

  // Evict expired hits
  entry.hits = entry.hits.filter(t => now - t < RL_WINDOW);
  entry.hits.push(now);
  _rlStore.set(key, entry);

  // Cleanup old keys every ~500 calls to prevent unbounded growth
  if (_rlStore.size > 2000) {
    for (const [k, v] of _rlStore) {
      if (v.hits.every(t => now - t >= RL_WINDOW)) _rlStore.delete(k);
    }
  }

  const remaining = limit - entry.hits.length;
  return { allowed: remaining >= 0, remaining: Math.max(0, remaining), limit };
}


async function validateApiKey(apiKey, supabaseUrl, serviceKey) {
  if (!supabaseUrl || !serviceKey) return { ok: false, error: 'Key validation unavailable' };
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/api_keys?key=eq.${encodeURIComponent(apiKey)}&limit=1`, {
      headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` },
    });
    const keys = await r.json();
    if (!Array.isArray(keys) || !keys.length) return { ok: false, error: 'Invalid API key.' };
    const rec = keys[0];
    const today = new Date().toISOString().slice(0, 10);
    const limit = DAILY_LIMITS[rec.tier] || 10;
    if (rec.usage_date === today && rec.usage_count >= limit) {
      return { ok: false, error: `Daily limit reached (${limit}/day for ${rec.tier} tier).`, status: 429 };
    }
    // Increment usage
    const newCount = rec.usage_date === today ? (rec.usage_count || 0) + 1 : 1;
    await fetch(`${supabaseUrl}/rest/v1/api_keys?id=eq.${rec.id}`, {
      method: 'PATCH',
      headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ usage_count: newCount, usage_date: today }),
    });
    return { ok: true, record: rec, remaining: limit - newCount };
  } catch { return { ok: false, error: 'Key validation error.' }; }
}

export default async function handler(req, res) {
  console.log('[suggest] HANDLER_ENTERED method=' + req.method + ' version=' + DEBUG_VERSION);
  try {
    return await _suggestHandler(req, res);
  } catch (err) {
    console.error('[suggest] FATAL_UNHANDLED stage=outer error=' + (err?.message || String(err)));
    console.error(err?.stack || '(no stack)');
    return res.status(200).json({ ok: false, meals: [], error: err?.message || 'Internal server error', stage: 'outer', debugVersion: DEBUG_VERSION });
  }
}

async function _suggestHandler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const isPublicV1 = req.query.v === '1';

  // ── Public API v1 path ──────────────────────────────────────────
  if (isPublicV1) {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) return res.status(401).json({ error: 'Missing X-API-Key header.', docs: 'https://jiff-ecru.vercel.app/api-docs' });

    const validation = await validateApiKey(apiKey, process.env.REACT_APP_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    if (!validation.ok) return res.status(validation.status || 401).json({ error: validation.error });

    const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {};
    const {
      ingredients = [], time = '30 min', diet = 'none', cuisine = 'any',
      mealType = 'any', servings = 2, count = 3, language = 'en',
      units = 'metric', kidsMode = false, kidsPromptOverride = null,
      tasteProfile = null, familyMembers = [], moodContext = null,
      weatherContext = null, dish = null,
      lastCooked = null, likedMealNames = [],
    } = body;
    const safeIngredients = Array.isArray(ingredients)
      ? ingredients.filter(i => typeof i === 'string' && i.trim().length > 0)
      : [];
    const maxCount = Math.min(count, validation.record?.tier === 'pro' ? 5 : 3);
    const cuisineLabel = (!cuisine || cuisine === 'any') ? null : cuisine;
    // ── Kids mode prompt override — checked BEFORE ingredients requirement ──
    if (kidsMode && kidsPromptOverride) {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return res.status(200).json({ ok: false, meals: [], error: 'Service not configured' });
      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method:'POST',
        headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01'},
        body: JSON.stringify({ model:'claude-haiku-4-5-20251001', max_tokens:2000,
          messages:[{role:'user',content:kidsPromptOverride}] }),
      });
      const aiData = await aiRes.json();
      const raw = (aiData.content||[]).map(c=>c.text||'').join('');
      const m = raw.replace(/```json|```/g,'').trim().match(/\{[\s\S]*\}/);
      if (m) { try { const parsed=JSON.parse(m[0]); return res.status(200).json(parsed); } catch {} }
      return res.status(200).json({ ok: false, meals: [], error: 'Could not parse response' });
    }

    const dietLabel    = (!diet    || diet    === 'none') ? 'no dietary restrictions' : diet;
    const langMap = { en:'English', hi:'Hindi', ta:'Tamil', es:'Spanish', fr:'French', de:'German' };
    const langName = langMap[language] || 'English';
    // Token-efficient context additions
const moodLine    = moodContext    ? `Mood: ${moodContext.prompt}.` : '';
const weatherLine = weatherContext ? `Weather: ${weatherContext.temp||'?'}°C ${weatherContext.condition||''}.` : '';
const dishLine    = dish           ? `Feature this dish: ${dish}.` : '';
const familyLine  = familyMembers?.length > 0 ? `Family: ${familyMembers.map(m=>m.name||m).join(', ')}.` : '';

const prompt = `Creative chef. Suggest ${maxCount} ${mealType!=='any'?mealType+' ':' '}meals.
Ingredients: ${safeIngredients.join(', ')}.
${time} prep. Diet: ${dietLabel}. ${cuisineLabel?'Cuisine: '+cuisineLabel+'.':''} Servings: ${servings}. ${units==='imperial'?'Imperial.':'Metric.'} ${moodLine} ${weatherLine} ${dishLine} ${familyLine} ${langName!=='English'?'Language: '+langName+'.':''}
JSON only — ${maxCount} objects:
[{"name":"..","emoji":"..","time":"..","servings":${servings},"diet":"..","description":"..","ingredients":["qty unit item"],"steps":["step text"],"calories":"..","protein":"..","carbs":"..","fat":".."}]`;
    try {
      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 2000, messages: [{ role: 'user', content: prompt }] }),
      });
      const data = await aiRes.json();
      if (!aiRes.ok) return res.status(aiRes.status).json({ error: data.error?.message || 'AI error' });
      const match = data.content?.map(c=>c.text||'').join('').replace(/```json|```/g,'').trim().match(/\[[\s\S]*\]/);
      const meals = match ? JSON.parse(match[0]) : null;
      return res.status(200).json({ meals, meta: { count: meals?.length||0, language, cuisine: cuisine||'any', generated: new Date().toISOString(), tier: validation.record?.tier||'free', remaining: validation.remaining } });
    } catch (e) { console.error('[suggest/v1]', e?.message); return res.status(200).json({ ok: false, meals: [], error: 'Internal server error' }); }
  }

  // ── Ingredient translation (?action=translate) ────────────────
  if (req.query.action === 'translate') {
    const _tb = (req.body && typeof req.body === 'object') ? req.body : {};
    const { term, lang = 'en' } = _tb;
    if (!term?.trim()) return res.status(400).json({ error: 'term required' });
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(200).json({ ok: false, meals: [], error: 'Service not configured' });
    const langHints = { ta:'Tamil', hi:'Hindi', te:'Telugu', kn:'Kannada', ml:'Malayalam' };
    const langHint = langHints[lang] ? ` The user may be using ${langHints[lang]} names.` : '';
    const prompt = `You are an expert in Indian culinary ingredients and regional names.\nUser typed: "${term.trim()}"${langHint}\n\nIdentify this ingredient. Respond ONLY with JSON (no markdown):\n{"found":true,"english":"spinach","local_name":"ponangani keerai (Tamil)","also_known_as":["water amaranth"],"emoji":"🥬","tip":"Rich in iron, great for stir-fries"}\n\nIf unknown: {"found":false,"message":"Could not identify this ingredient"}\nThe "english" field must be the common English grocery store name.`;
    try {
      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 300, messages: [{ role: 'user', content: prompt }] }),
      });
      const data = await aiRes.json();
      const raw = (data.content || []).map(c => c.text || '').join('');
      const m = raw.replace(/```json|```/g, '').trim().match(/\{[\s\S]*\}/);
      if (!m) return res.status(200).json({ found: false, message: 'Could not identify ingredient' });
      return res.status(200).json(JSON.parse(m[0]));
    } catch (e) { return res.status(200).json({ found: false, message: 'Translation service error' }); }
  }


  // ── ?action=detect — fridge photo ingredient detection ──────────
  if (req.query.action === 'detect') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { imageBase64, mediaType = 'image/jpeg' } = req.body || {};
    if (!imageBase64) return res.status(400).json({ error: 'No image provided.' });
    const validTypes = ['image/jpeg','image/jpg','image/png','image/gif','image/webp'];
    if (!validTypes.includes(mediaType)) return res.status(400).json({ error: 'Invalid image type.' });
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type':'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version':'2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6', max_tokens: 500,
          messages: [{ role:'user', content: [
            { type:'image', source:{ type:'base64', media_type: mediaType, data: imageBase64 } },
            { type:'text', text: `Determine if this image shows food, ingredients, a fridge, pantry, or kitchen. If not, respond: {"error":"not_food"}\n\nIf food-related, list all food ingredients visible.\nRules: common simple names only; max 20 items; skip non-food items.\nRespond ONLY with valid JSON: {"error":"not_food"} or ["ingredient1","ingredient2"]` }
          ]}],
        }),
      });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: data.error?.message || 'API error' });
      const raw = (data.content||[]).map(c=>c.text||'').join('');
      if (raw.includes('"not_food"')) return res.status(400).json({ error: 'Photo does not show food ingredients.', code:'not_food' });
      let ingredients = [];
      try {
        const cleaned = raw.replace(/```json|```/g,'').trim();
        const m = cleaned.match(/\[[\s\S]*\]/);
        if (m) ingredients = JSON.parse(m[0]);
      } catch (e) { return res.status(200).json({ ingredients: [], count: 0, error: 'Parse error' }); }
      const normalised = [...new Set(ingredients.filter(i=>typeof i==='string'&&i.trim()).map(i=>i.toLowerCase().trim()).slice(0,20))];
      return res.status(200).json({ ingredients: normalised, count: normalised.length });
    } catch (err) { return res.status(200).json({ ingredients: [], count: 0, error: 'Internal error' }); }
  }

  // ── Internal app path (existing logic below) ────────────────────

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── Rate limiting ─────────────────────────────────────────────────
  const clientIp = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const rl = rateLimit(clientIp, 'suggest');
  res.setHeader('X-RateLimit-Limit',     String(rl.limit));
  res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
  if (!rl.allowed) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment before trying again.', retryAfter: 60 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(200).json({ ok: false, meals: [], error: 'Service not configured' });

  // ── Kids mode — handled FIRST before ingredients check ────────────
  const { kidsMode, kidsPromptOverride } = req.body || {};
  if (kidsMode && kidsPromptOverride) {
    try {
      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 2500,
          messages: [{ role: 'user', content: kidsPromptOverride }] }),
      });
      const aiData = await aiRes.json();
      if (!aiRes.ok) return res.status(200).json({ ok: false, meals: [], error: 'AI service error' });
      const raw = (aiData.content || []).map(c => c.text || '').join('');
      const clean = raw.replace(/```json|```/g, '').trim();
      // Try object first {meals:[]}, then flat array []
      const objMatch = clean.match(/\{[\s\S]*\}/);
      const arrMatch = clean.match(/\[[\s\S]*\]/);
      if (objMatch) {
        try { const parsed = JSON.parse(objMatch[0]); return res.status(200).json(parsed); } catch {}
      }
      if (arrMatch) {
        try { const meals = JSON.parse(arrMatch[0]); return res.status(200).json({ meals }); } catch {}
      }
      return res.status(200).json({ ok: false, meals: [], error: 'Could not parse response' });
    } catch (err) {
      console.error('Kids mode error:', err);
      return res.status(200).json({ ok: false, meals: [], error: 'Kids recipe generation failed' });
    }
  }

  // Ingredients are OPTIONAL — recommendation-first flows generate from cuisine/mealType/profile only

  try {
    console.log('[suggest] STAGE_1 body_parse req.body type=' + typeof req.body);
    const safeBody2 = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {};
    const {
      ingredients: _ingredients,
      time         = '30 min',
      diet         = 'any',
      cuisine      = 'any',
      mealType     = 'any',
      defaultServings = 2,
      tasteProfile,
      language     = 'en',
      units        = 'metric',
      count        = 5,
      lastCooked   = null,
      likedMealNames = [],
    } = safeBody2;

    // Sanitize ingredients — must be non-empty strings
    const safeIngredients = Array.isArray(_ingredients)
      ? _ingredients.filter(i => typeof i === 'string' && i.trim().length > 0)
      : [];

    // Check: do we have enough context to generate (ingredients OR cuisine/mealType/profile)?
    // NOTE: tasteProfile (not tp) used here because tp is declared later
    const _tp = (tasteProfile && typeof tasteProfile === 'object') ? tasteProfile : {};
    console.log('[suggest] STAGE_2 ingredients=' + safeIngredients.length + ' cuisine=' + cuisine + ' mealType=' + mealType + ' diet=' + diet);
    const hasContext = safeIngredients.length > 0
      || (cuisine && cuisine !== 'any')
      || (mealType && mealType !== 'any')
      || (_tp.preferred_cuisines?.length > 0 || Boolean(_tp.spice_level))
      || (diet && diet !== 'any' && diet !== 'none');

    console.log('[suggest] STAGE_3 hasContext=' + hasContext);
    if (!hasContext) {
      console.log('[suggest] NO_CONTEXT returning empty');
      return res.status(200).json({ ok: false, meals: [], error: 'Please provide ingredients or preferences.', debugVersion: DEBUG_VERSION });
    }

    const dietLabel    = (!diet || diet === 'none') ? 'no dietary restrictions' : diet;

    // ── Egg + vegetarian conflict fix (item u) ────────────────
    // If diet is vegetarian and ingredients contain eggs, treat as eggetarian
    // This prevents AI from returning egg dishes for strict vegetarian
    const hasEggs = safeIngredients.some(i => ['egg','eggs','boiled egg'].includes(i.toLowerCase().trim()));
    let effectiveDiet = dietLabel;
    let eggRule = '';
    if (diet === 'vegetarian' && hasEggs) {
      effectiveDiet = 'eggetarian (vegetarian who eats eggs)';
      eggRule = 'User is eggetarian — recipes CAN include eggs but must have NO meat or fish.';
    } else if (diet === 'vegetarian') {
      eggRule = 'STRICT vegetarian — absolutely NO eggs, meat, fish, or seafood in any recipe. Even if eggs appear in the ingredient list, do NOT use them.';
    } else if (diet === 'vegan') {
      eggRule = 'STRICTLY vegan — NO eggs, dairy, meat, fish, honey, or any animal products.';
    } else if (diet === 'jain') {
      eggRule = 'Jain diet — NO meat, eggs, fish, or root vegetables (onion, garlic, potato, carrot, beetroot, turnip). Use only above-ground vegetables.';
    }
    const cuisineLabel = (!cuisine || cuisine === 'any') ? null : cuisine;
    const cuisineRule  = cuisineLabel
      ? `All ${count} meals MUST be authentic ${cuisineLabel} cuisine.`
      : `Suggest the ${count} most practical meals regardless of cuisine.`;

    // Meal type instruction
    const mealTypeMap = {
      breakfast: 'breakfast dishes — quick to prepare (under 20 min), energising, and appropriate for the morning',
      lunch:     'lunch dishes — satisfying, practical, and suitable for midday',
      dinner:    'dinner dishes — more complete meals suitable for the evening',
      snack:     'snack or light bite recipes — small portions, quick to prepare, suitable as between-meal snacks',
      any:       'meals suitable for any time of day — vary the meal types across the suggestions',
    };
    const mealTypeRule = `All suggestions must be ${mealTypeMap[mealType] || mealTypeMap.any}.`;

    const unitsRule = units === 'imperial'
      ? 'Use imperial measurements only: oz, lbs, cups, tbsp, tsp, fl oz. Never use grams or ml.'
      : 'Use metric measurements only: g, kg, ml, l, tbsp, tsp.';

    const langMap = { en: 'English', hi: 'Hindi', ta: 'Tamil', es: 'Spanish' };
    const langName = langMap[language] || 'English';
    const langRule = langName !== 'English'
      ? `IMPORTANT: Respond ENTIRELY in ${langName}. All meal names, descriptions, ingredients, and steps must be in ${langName}.`
      : '';

    const tp = tasteProfile || {};
    const profileLines = [];
    if (tp.spice_level && tp.spice_level !== 'medium') profileLines.push(`Spice level: ${tp.spice_level} — adjust heat accordingly.`);
    if (tp.allergies?.length) profileLines.push(`Allergies — NEVER include: ${(Array.isArray(tp.allergies) ? tp.allergies : []).join(', ')}.`);
    if (tp.preferred_cuisines?.length && !cuisineLabel) profileLines.push(`User prefers: ${(Array.isArray(tp.preferred_cuisines) ? tp.preferred_cuisines : []).join(', ')} — favour these styles.`);
    if (tp.skill_level === 'beginner') profileLines.push('User is a beginner cook — keep techniques simple.');
    if (tp.skill_level === 'advanced') profileLines.push('Advanced cook — feel free to use sophisticated techniques.');

    // Family mode — merge dietary restrictions from all eating members
    const familyMembers = Array.isArray(safeBody2.familyMembers) ? safeBody2.familyMembers : [];
    if (familyMembers.length > 0) {
      const allRestrictions = [...new Set(familyMembers.map(m => m.dietary).filter(Boolean))];
      const allAllergies = [...new Set(familyMembers.flatMap(m => m.allergies || []))];
      const names = familyMembers.map(m => m.name).join(', ');
      if (allRestrictions.length) profileLines.push(`Family eating tonight (${names}). Must accommodate ALL: ${allRestrictions.join(', ')}. Use the most restrictive diet.`);
      if (allAllergies.length) profileLines.push(`Family allergies — NEVER include: ${allAllergies.join(', ')}.`);
    }

    const profileInstruction = profileLines.length
      ? `\nUser taste profile:\n${profileLines.map(l => `- ${l}`).join('\n')}`
      : '';

    const promptDiet = eggRule || effectiveDiet;

    const prompt = `You are a creative, practical chef with deep knowledge of world cuisines.

${safeIngredients.length > 0 ? 'Available ingredients: ' + safeIngredients.join(', ') + '.' : 'No specific ingredients — generate based on cuisine, meal type, and preferences.'}
Time available: ${time}.
Dietary preference: ${effectiveDiet}. ${eggRule}
Meal type: ${mealTypeRule}
Cuisine requirement: ${cuisineRule}
Serving size: Each recipe should serve ${defaultServings} people.
Measurements: ${unitsRule}
${langRule}${profileInstruction}

Suggest exactly ${count} meal${count > 1 ? 's' : ''}. Respond ONLY with a valid JSON array — no markdown, no explanation, no backticks:

[
  {
    "name": "Meal Name",
    "emoji": "🍝",
    "time": "25 min",
    "servings": "${defaultServings}",
    "difficulty": "Easy",
    "description": "One enticing sentence describing this dish.",
    "ingredients": ["200g pasta", "2 cloves garlic", "olive oil*"],
    "steps": ["Step 1", "Step 2", "Step 3"],
    "calories": "420",
    "protein": "18g",
    "carbs": "52g",
    "fat": "14g"
  }
]

${safeIngredients.length > 0 ? 'Rules: use given ingredients as base; mark pantry staples with *; keep steps concise; each meal must be distinct.' : 'Rules: create authentic recipes for the cuisine and meal type; keep steps concise; each meal must be distinct.'}\`;

    console.log('[suggest] STAGE_4 prompt_built len=' + prompt.length + ' apiKey_exists=' + Boolean(apiKey));
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 2500, messages: [{ role: 'user', content: prompt }] }),
    });

    console.log('[suggest] STAGE_5 anthropic_response status=' + response.status);
    const rawBody = await response.text();
    let data;
    try { data = JSON.parse(rawBody); } catch { data = {}; }
    if (!response.ok) return res.status(200).json({ ok: false, meals: [], error: data.error?.message || 'AI service error' });

    const rawText = data.content?.map(c => c.text || '').join('') || '';
    console.log('[suggest] STAGE_6 parsing raw length=' + rawText.length);
    let meals = null;
    try {
      const cleaned = rawText.replace(/```json|```/g, '').trim();
      const match = cleaned.match(/\[[\s\S]*\]/);
      if (match) meals = JSON.parse(match[0]);
    } catch (e) { console.error('[suggest/parse]', e?.message); return res.status(200).json({ ok: false, meals: [], error: 'Could not parse suggestions' }); }

    // Log token usage (async, fire-and-forget)
    const usage = data.usage || {};
    logTokenUsage({
      endpoint: 'suggest',
      model: 'claude-sonnet-4-6',
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      sbUrl: process.env.REACT_APP_SUPABASE_URL,
      sbKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    });

    console.log('[suggest] STAGE_7 success meals=' + (meals ? meals.length : 0));
    return res.status(200).json({ ok: true, meals: meals || [], debugVersion: DEBUG_VERSION });
  } catch (err) {
    console.error('[suggest/internal] STAGE_FAIL error=' + (err?.message || String(err)));
    console.error(err?.stack || '(no stack)');
    return res.status(200).json({ ok: false, meals: [], error: err?.message || 'Internal server error', debugVersion: DEBUG_VERSION });
  }
}
