// api/suggest.js — Jiff meal suggestion API
// CommonJS — module.exports pattern, no ESM import/export
// Rebuilt clean: no triple-backtick patterns, no legacy dead paths

const DEBUG_VERSION = 'v1.23.38-clean';
console.log('[suggest] FILE_LOADED', DEBUG_VERSION);

// ── Rate limiter ───────────────────────────────────────────────────
const RL_WINDOW = 60 * 1000;
const RL_LIMITS = { suggest: 20, default: 30 };
const _rlStore  = new Map();

function rateLimit(ip) {
  const key   = 'suggest:' + ip;
  const now   = Date.now();
  const limit = RL_LIMITS.suggest;
  const entry = _rlStore.get(key) || { hits: [] };
  entry.hits  = entry.hits.filter(t => now - t < RL_WINDOW);
  entry.hits.push(now);
  _rlStore.set(key, entry);
  if (_rlStore.size > 2000) {
    for (const [k, v] of _rlStore) {
      if (v.hits.every(t => now - t >= RL_WINDOW)) _rlStore.delete(k);
    }
  }
  return { allowed: entry.hits.length <= limit, remaining: Math.max(0, limit - entry.hits.length) };
}

// ── Safe JSON extraction (no backtick/markdown patterns) ──────────
// Step 3: extract first [...] or {...} from raw AI text without any markdown cleanup
function extractJSON(text, type) {
  if (!text) return null;
  const open  = type === 'array' ? '[' : '{';
  const close = type === 'array' ? ']' : '}';

  // Strategy 1: first open bracket to last close bracket (standard case)
  const start1 = text.indexOf(open);
  const end1   = text.lastIndexOf(close);
  if (start1 !== -1 && end1 > start1) {
    try { return JSON.parse(text.slice(start1, end1 + 1)); } catch {}
  }

  // Strategy 2: try parsing the full text directly (AI sometimes returns pure JSON)
  try { const p = JSON.parse(text.trim()); if (p) return p; } catch {}

  // Strategy 3: find JSON by scanning for the pattern more aggressively
  // Handles cases where AI adds trailing commas or minor syntax issues
  const match = text.match(type === 'array' ? /\[[\s\S]*\]/ : /\{[\s\S]*\}/);
  if (match) {
    // Light cleanup: trailing commas before ] or }
    const cleaned = match[0]
      .replace(/,(\s*[}\]])/g, '$1')   // trailing commas
      .replace(/:\s*undefined/g, ':null'); // undefined values
    try { return JSON.parse(cleaned); } catch {}
  }

  return null;
}

// ── Token logger (fire-and-forget) ────────────────────────────────
function logTokens(inputTokens, outputTokens) {
  const url = process.env.REACT_APP_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  fetch(url + '/rest/v1/token_usage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': key, 'Authorization': 'Bearer ' + key, 'Prefer': 'return=minimal' },
    body: JSON.stringify({ endpoint: 'suggest', model: 'claude-sonnet-4-6', input_tokens: inputTokens || 0, output_tokens: outputTokens || 0, total_tokens: (inputTokens || 0) + (outputTokens || 0), logged_at: new Date().toISOString() }),
  }).catch(() => {});
}

// ── Main handler ───────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  console.log('[suggest] HANDLER_ENTERED method=' + req.method + ' version=' + DEBUG_VERSION);

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(200).json({ ok: false, meals: [], error: 'Service not configured', stage: 'apikey' });
  }

  // Rate limit
  const ip = ((req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0]).trim();
  const rl = rateLimit(ip);
  res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
  if (!rl.allowed) {
    return res.status(429).json({ ok: false, error: 'Too many requests. Please wait a moment.', retryAfter: 60 });
  }

  // Parse body safely
  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {};
  console.log('[suggest] BODY_PARSED keys=' + Object.keys(body).join(','));

  // ── Kids mode with custom prompt — handled first ─────────────────
  const kidsMode          = Boolean(body.kidsMode);
  const kidsPromptOverride = body.kidsPromptOverride || null;
  if (kidsMode && kidsPromptOverride) {
    try {
      const aiRes  = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 2500, messages: [{ role: 'user', content: kidsPromptOverride }] }),
      });
      const aiData = await aiRes.json();
      const raw    = (aiData.content || []).map(c => c.text || '').join('');
      const parsed = extractJSON(raw, 'object') || extractJSON(raw, 'array');
      if (parsed && parsed.meals) return res.status(200).json(parsed);
      if (Array.isArray(parsed))  return res.status(200).json({ ok: true, meals: parsed, debugVersion: DEBUG_VERSION });
      return res.status(200).json({ ok: false, meals: [], error: 'Could not parse kids response', debugVersion: DEBUG_VERSION });
    } catch (err) {
      console.error('[suggest] KIDS_ERROR', err && err.message);
      return res.status(200).json({ ok: false, meals: [], error: 'Kids recipe error', debugVersion: DEBUG_VERSION });
    }
  }

  // ── Standard generation path ─────────────────────────────────────
  try {
    // Inputs — all with safe defaults
    const rawIngredients = Array.isArray(body.ingredients) ? body.ingredients : [];
    const ingredients    = rawIngredients.filter(i => typeof i === 'string' && i.trim().length > 0);
    const diet           = (body.diet && body.diet !== 'none') ? body.diet : 'any';
    const cuisine        = body.cuisine || 'any';
    const mealType       = body.mealType || 'any';
    const time           = body.time || '30 min';
    const servings       = body.defaultServings || body.servings || 2;
    const count          = Math.min(Number(body.count) || 3, 5);
    const language       = body.language || 'en';
    const units          = body.units || 'metric';
    const tp             = (body.tasteProfile && typeof body.tasteProfile === 'object') ? body.tasteProfile : {};
    const familyRaw      = Array.isArray(body.familyMembers) ? body.familyMembers : [];
    const moodContext    = body.moodContext || null;
    const weatherContext = body.weatherContext || null;
    const dish           = body.dish || null;

    // Context check — ingredients OR any preference signal required
    const hasContext = ingredients.length > 0
      || (cuisine && cuisine !== 'any')
      || (mealType && mealType !== 'any')
      || (Array.isArray(tp.preferred_cuisines) && tp.preferred_cuisines.length > 0)
      || Boolean(tp.spice_level)
      || (diet && diet !== 'any');

    if (!hasContext) {
      return res.status(200).json({ ok: false, meals: [], error: 'Provide ingredients or preferences.', stage: 'context', debugVersion: DEBUG_VERSION });
    }

    // Diet rules
    const hasEggs       = ingredients.some(i => ['egg','eggs','boiled egg'].includes(i.toLowerCase().trim()));
    let effectiveDiet   = diet;
    let dietRule        = '';
    if (diet === 'vegetarian' && hasEggs) {
      effectiveDiet = 'eggetarian';
      dietRule      = 'User is eggetarian — eggs OK, no meat or fish.';
    } else if (diet === 'vegetarian') {
      dietRule = 'STRICT vegetarian — NO eggs, meat, fish, or seafood.';
    } else if (diet === 'vegan') {
      dietRule = 'STRICTLY vegan — NO eggs, dairy, meat, fish, honey.';
    } else if (diet === 'jain') {
      dietRule = 'Jain diet — NO meat, eggs, fish, or root vegetables (onion, garlic, potato, carrot, beetroot).';
    }

    // Cuisine + meal type rules
    const cuisineLabel = (cuisine && cuisine !== 'any') ? cuisine : null;
    const cuisineRule  = cuisineLabel
      ? 'All ' + count + ' meals MUST be authentic ' + cuisineLabel + ' cuisine.'
      : 'Suggest the ' + count + ' most practical meals for this context.';

    const mealTypeDescriptions = {
      breakfast: 'breakfast dishes — quick (under 20 min), energising, morning-appropriate',
      lunch:     'lunch dishes — satisfying, practical, midday-suitable',
      dinner:    'dinner dishes — more complete, suitable for the evening',
      snack:     'snack or light bite recipes — small portions, quick to prepare',
      any:       'meals suitable for any time of day',
    };
    const mealTypeRule = 'All suggestions must be ' + (mealTypeDescriptions[mealType] || mealTypeDescriptions.any) + '.';
    const unitsRule    = units === 'imperial'
      ? 'Use imperial measurements: oz, lbs, cups, tbsp, tsp.'
      : 'Use metric measurements: g, kg, ml, l, tbsp, tsp.';

    const langNames = { en:'English', hi:'Hindi', ta:'Tamil', es:'Spanish', fr:'French', de:'German' };
    const langName  = langNames[language] || 'English';
    const langRule  = langName !== 'English'
      ? 'IMPORTANT: Respond ENTIRELY in ' + langName + '. All names, descriptions, ingredients, steps in ' + langName + '.'
      : '';

    // Profile lines
    const profile = [];
    if (tp.spice_level && tp.spice_level !== 'medium') profile.push('Spice level: ' + tp.spice_level + ' — adjust heat accordingly.');
    if (Array.isArray(tp.allergies) && tp.allergies.length)             profile.push('Allergies — NEVER include: ' + tp.allergies.join(', ') + '.');
    if (Array.isArray(tp.preferred_cuisines) && tp.preferred_cuisines.length && !cuisineLabel) profile.push('User prefers: ' + tp.preferred_cuisines.join(', ') + ' — favour these styles.');
    if (tp.skill_level === 'beginner') profile.push('Beginner cook — keep techniques simple.');
    if (tp.skill_level === 'advanced') profile.push('Advanced cook — sophisticated techniques welcome.');

    // Family mode
    if (familyRaw.length > 0) {
      const restrictions = [...new Set(familyRaw.map(m => m.dietary).filter(Boolean))];
      const allergies    = [...new Set(familyRaw.flatMap(m => m.allergies || []))];
      const names        = familyRaw.map(m => m.name || 'member').join(', ');
      if (restrictions.length) profile.push('Family (' + names + ') — accommodate ALL: ' + restrictions.join(', ') + '. Use most restrictive diet.');
      if (allergies.length)    profile.push('Family allergies — NEVER include: ' + allergies.join(', ') + '.');
    }

    const profileBlock = profile.length > 0 ? '\nUser taste profile:\n' + profile.map(l => '- ' + l).join('\n') : '';

    // Optional context lines
    const moodLine    = moodContext    ? 'Mood context: ' + (moodContext.prompt || '') + '.'  : '';
    const weatherLine = weatherContext ? 'Weather: ' + (weatherContext.temp || '') + 'C ' + (weatherContext.condition || '') + '.' : '';
    const dishLine    = dish           ? 'Feature this dish: ' + dish + '.'                   : '';
    const contextLine = [moodLine, weatherLine, dishLine].filter(Boolean).join(' ');

    const ingrLine = ingredients.length > 0
      ? 'Available ingredients: ' + ingredients.join(', ') + '.'
      : 'No specific ingredients — generate based on cuisine, meal type, and preferences.';

    const rulesLine = ingredients.length > 0
      ? 'Rules: use given ingredients as base; mark pantry staples with *; keep steps concise; each meal must be distinct.'
      : 'Rules: create authentic recipes for the cuisine and meal type; keep steps concise; each meal must be distinct.';

    // Build prompt — no template literal with backticks inside the string itself
    // Steps 3+7: zero markdown-fence patterns in any string used to parse responses
    const promptParts = [
      'You are a creative, practical chef with deep knowledge of world cuisines.',
      '',
      ingrLine,
      'Time available: ' + time + '.',
      'Dietary preference: ' + effectiveDiet + '. ' + dietRule,
      'Meal type: ' + mealTypeRule,
      'Cuisine requirement: ' + cuisineRule,
      'Serving size: Each recipe should serve ' + servings + ' people.',
      'Measurements: ' + unitsRule,
      contextLine,
      langRule,
      profileBlock,
      '',
      'Suggest exactly ' + count + ' meal' + (count > 1 ? 's' : '') + '. Respond ONLY with a valid JSON array — no markdown, no explanation:',
      '',
      '[',
      '  {',
      '    "name": "Meal Name",',
      '    "emoji": "...",',
      '    "time": "25 min",',
      '    "servings": ' + servings + ',',
      '    "difficulty": "Easy",',
      '    "description": "One enticing sentence.",',
      '    "ingredients": ["200g pasta", "2 cloves garlic"],',
      '    "steps": ["Step 1", "Step 2"],',
      '    "calories": "420",',
      '    "protein": "18g",',
      '    "carbs": "52g",',
      '    "fat": "14g"',
      '  }',
      ']',
      '',
      rulesLine,
    ];
    const prompt = promptParts.filter(l => l !== null).join('\n');

    console.log('[suggest] ANTHROPIC_REQUEST count=' + count + ' diet=' + effectiveDiet + ' cuisine=' + (cuisineLabel || 'any') + ' apiKey_exists=' + Boolean(apiKey));

    const aiResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':         'application/json',
        'x-api-key':            apiKey,
        'anthropic-version':    '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 2500,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    const rawBody = await aiResponse.text();
    let aiData;
    try { aiData = JSON.parse(rawBody); } catch { aiData = {}; }

    if (!aiResponse.ok) {
      console.error('[suggest] ANTHROPIC_ERROR status=' + aiResponse.status + ' error=' + (aiData.error && aiData.error.message));
      return res.status(200).json({ ok: false, meals: [], error: aiData.error && aiData.error.message || 'AI service error', stage: 'anthropic', debugVersion: DEBUG_VERSION });
    }

    const rawText = (aiData.content || []).map(c => c.text || '').join('');

    // Step 3: Safe JSON extraction — no backtick/markdown patterns
    const meals = extractJSON(rawText, 'array');
    console.log('[suggest] RESPONSE_PARSED meals=' + (meals ? meals.length : 'null') + ' rawLen=' + rawText.length);

    if (!meals) {
      return res.status(200).json({ ok: false, meals: [], error: 'Could not parse meal suggestions', stage: 'parse', debugVersion: DEBUG_VERSION });
    }

    // Token logging — fire-and-forget
    const usage = aiData.usage || {};
    logTokens(usage.input_tokens, usage.output_tokens);

    console.log('[suggest] SUCCESS meals=' + meals.length);
    return res.status(200).json({ ok: true, meals: meals, debugVersion: DEBUG_VERSION });

  } catch (err) {
    console.error('[suggest] FATAL error=' + (err && err.message || String(err)));
    if (err && err.stack) console.error(err.stack);
    return res.status(200).json({ ok: false, meals: [], error: err && err.message || 'Internal error', stage: 'fatal', debugVersion: DEBUG_VERSION });
  }
};
