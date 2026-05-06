// api/planner.js — Jiff weekly meal planner with meal type selection

// ── Rate limiter (shared pattern) ────────────────────────────────
const RL_WINDOW_P = 60 * 1000;
const RL_LIMIT_P  = 10; // 10 planner calls/min per IP
const _rlP = new Map();
function rateLimitPlanner(ip) {
  const now = Date.now();
  const hits = (_rlP.get(ip) || []).filter(t => now - t < RL_WINDOW_P);
  hits.push(now);
  _rlP.set(ip, hits);
  if (_rlP.size > 1000) for (const [k,v] of _rlP) if (v.every(t=>now-t>=RL_WINDOW_P)) _rlP.delete(k);
  return { allowed: hits.length <= RL_LIMIT_P, remaining: Math.max(0, RL_LIMIT_P - hits.length) };
}


module.exports = async function handler(req, res) {
  const cIp = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const rl  = rateLimitPlanner(cIp);
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests. Please wait a moment.', retryAfter: 60 });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured.' });

  try {
    const {
      ingredients, diet, cuisine,
      mealTypes = ['breakfast', 'lunch', 'dinner'], // which meals to plan
      servings = 2,
      tasteProfile,
      language = 'en',
      units = 'metric',
    } = req.body;

    if (!ingredients?.length) return res.status(400).json({ error: 'Please provide at least one ingredient.' });
    if (!mealTypes?.length)   return res.status(400).json({ error: 'Select at least one meal type.' });

    const dietLabel    = (!diet || diet === 'none') ? 'no dietary restrictions' : diet;
    const cuisineLabel = (!cuisine || cuisine === 'any') ? null : cuisine;
    const cuisineRule  = cuisineLabel
      ? `All meals should follow ${cuisineLabel} cuisine.`
      : 'Mix cuisines freely — variety is encouraged.';

    const unitsRule = units === 'imperial'
      ? 'Use imperial measurements only: oz, lbs, cups, tbsp, tsp.'
      : 'Use metric measurements only: g, kg, ml, l.';

    const langMap = { en: 'English', hi: 'Hindi', ta: 'Tamil', es: 'Spanish' };
    const langName = langMap[language] || 'English';
    const langRule = langName !== 'English'
      ? `IMPORTANT: Respond ENTIRELY in ${langName}.`
      : '';

    const tp = tasteProfile || {};
    const profileLines = [];
    if (tp.spice_level && tp.spice_level !== 'medium') profileLines.push(`Spice level: ${tp.spice_level}.`);
    if (tp.allergies?.length) profileLines.push(`NEVER include: ${tp.allergies.join(', ')}.`);
    if (tp.skill_level === 'beginner') profileLines.push('Keep techniques simple — beginner cook.');
    if (tp.skill_level === 'advanced') profileLines.push('Advanced cook — complex techniques welcome.');
    const profileInstruction = profileLines.length
      ? `\nUser taste profile:\n${profileLines.map(l => `- ${l}`).join('\n')}`
      : '';

    // Build meal type slots
    const mealSlotExamples = mealTypes.map(type => {
      const emojis = { breakfast: '🍳', lunch: '🥗', dinner: '🍲', snack: '🍎' };
      const times  = { breakfast: '15 min', lunch: '25 min', dinner: '35 min', snack: '10 min' };
      const cals   = { breakfast: '320', lunch: '450', dinner: '580', snack: '180' };
      return `      "${type}": { "name": "...", "emoji": "${emojis[type]||'🍽️'}", "time": "${times[type]||'20 min'}", "description": "...", "ingredients": [], "steps": [], "calories": "${cals[type]||'400'}", "protein": "15g" }`;
    }).join(',\n');

    const mealTypeDesc = {
      breakfast: 'energising breakfast (under 20 min)',
      lunch:     'satisfying practical lunch',
      dinner:    'complete dinner',
      snack:     'light snack or bite (under 10 min, small portion)',
    };
    const mealTypeRules = mealTypes.map(t => `- ${t}: ${mealTypeDesc[t] || t}`).join('\n');

    const prompt = `You are a professional meal planner. Create a complete 7-day meal plan.

Available ingredients: ${ingredients.join(', ')}.
Dietary preference: ${dietLabel}.
Cuisine style: ${cuisineRule}
Servings: Each recipe should serve ${servings} people.
Measurements: ${unitsRule}
Meal types to include each day: ${mealTypes.join(', ')}
${mealTypeRules}
${langRule}${profileInstruction}

Rules:
- Generate exactly 7 days (Monday through Sunday)
- Each day must include ONLY these meal types: ${mealTypes.join(', ')}
- No meal repeats across the entire week
- Vary proteins, textures, and cooking methods throughout
- Mark pantry extras with *

Respond ONLY with a valid JSON array — no markdown, no explanation:

[
  {
    "day": "Monday",
    "meals": {
${mealSlotExamples}
    }
  }
]

Generate all 7 days.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 9000, messages: [{ role: 'user', content: prompt }] }),
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message || 'API error' });

    const rawText = data.content?.map(c => c.text || '').join('') || '';
    let plan = null;
    try {
      const cleaned = rawText.replace(/```json|```/g, '').trim();
      const match = cleaned.match(/\[[\s\S]*\]/);
      if (match) plan = JSON.parse(match[0]);
    } catch { return res.status(500).json({ error: 'Could not parse meal plan.' }); }

    if (!plan || plan.length < 7) return res.status(500).json({ error: 'Incomplete plan. Please try again.' });
    return res.status(200).json({ plan });
  } catch (err) {
    console.error('Planner error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}
