// api/comms.js — Feedback + Email subscribe + Welcome/drip triggers
// Route by ?action=feedback | email | welcome | trial_nudge | premium_confirm
const crypto = require('crypto');

// ── Email templates (sent via Mailchimp Transactional or Automations) ────────
// These are NOT sent directly — they define the TAG that triggers
// the Mailchimp Customer Journey (automation) you build in the dashboard.
// Each tag maps to one automation flow in Mailchimp → Automations → Customer Journeys.
//
// Tag → Journey mapping:
//   jiff-welcome           → Welcome series (Day 0: welcome, Day 2: tips, Day 5: feature tour)
//   jiff-trial-day3        → Trial nudge (Day 3: "3 days in — tried everything?")
//   jiff-trial-expiring    → Trial expiry warning (Day 6: "1 day left")
//   jiff-trial-expired     → Post-trial (Day 8: upgrade offer with discount)
//   jiff-premium-welcome   → Premium welcome (immediate: "You're in!" + what's unlocked)
//   jiff-inactive-7d       → Re-engagement (7 days no login)
//   source:signup          → Tracks acquisition channel
//   source:landing         → Landing page subscribe
//   source:pricing         → Pricing page subscribe

const EMAIL_DRIP_TAGS = {
  signup:          ['jiff-welcome', 'jiff-trial-day3', 'source:signup'],
  landing:         ['jiff-welcome', 'source:landing'],
  pricing:         ['jiff-welcome', 'jiff-trial-day3', 'source:pricing'],
  trial_start:     ['jiff-trial-day3', 'jiff-trial-expiring'],
  trial_expired:   ['jiff-trial-expired'],
  premium_upgrade: ['jiff-premium-welcome'],
  reactivate:      ['jiff-inactive-7d'],
};

async function addToMailchimp(email, tags, mergeFields = {}) {
  const apiKey   = process.env.MAILCHIMP_API_KEY;
  const listId   = process.env.MAILCHIMP_LIST_ID;
  const serverDc = process.env.MAILCHIMP_SERVER_PREFIX;
  if (!apiKey || !listId || !serverDc) return { fallback: true };

  const auth = `Basic ${Buffer.from(`anystring:${apiKey}`).toString('base64')}`;
  const hash = crypto.createHash('md5').update(email.toLowerCase()).digest('hex');

  // Upsert member
  const mcRes = await fetch(`https://${serverDc}.api.mailchimp.com/3.0/lists/${listId}/members/${hash}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': auth },
    body: JSON.stringify({
      email_address: email,
      status_if_new: 'subscribed',
      merge_fields: { SIGNUP: new Date().toISOString().slice(0, 10), ...mergeFields },
    }),
  });
  const data = await mcRes.json();
  if (!mcRes.ok) return { error: data.detail || 'Mailchimp upsert failed' };

  // Apply tags
  if (tags && tags.length > 0) {
    await fetch(`https://${serverDc}.api.mailchimp.com/3.0/lists/${listId}/members/${hash}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': auth },
      body: JSON.stringify({ tags: tags.map(t => ({ name: t, status: 'active' })) }),
    });
  }

  return { ok: true };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const action = req.query.action || req.body?.action;

  // ── Feedback ──────────────────────────────────────────────────────────────
  if (action === 'feedback') {
    try {
      const { userId, email, rating, category, message, page, ua, ts } = req.body;
      if (!message && !rating) return res.status(400).json({ error: 'Provide a message or rating.' });
      const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
      const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (supabaseUrl && serviceKey) {
        await fetch(`${supabaseUrl}/rest/v1/feedback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': serviceKey,
            'Authorization': `Bearer ${serviceKey}`, 'Prefer': 'return=minimal' },
          body: JSON.stringify({
            user_id: userId||null, email: email||null, rating: rating||null,
            category: category||'other', message: message||'', page: page||'/',
            user_agent: ua?.substring(0,200)||'',
            created_at: new Date(ts||Date.now()).toISOString(),
          }),
        });
      }
      return res.status(200).json({ ok: true });
    } catch { return res.status(500).json({ error: 'Could not save feedback.' }); }
  }

  // ── Email subscribe (landing / pricing waitlist) ───────────────────────────
  if (action === 'email') {
    const { email, source = 'landing', tags: extraTags = [] } = req.body;
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required.' });
    try {
      const baseTags = EMAIL_DRIP_TAGS[source] || EMAIL_DRIP_TAGS.landing;
      const allTags  = [...new Set([...baseTags, ...extraTags])];
      const result   = await addToMailchimp(email, allTags, { SOURCE: source });
      if (result.fallback) { console.log(`[EMAIL_CAPTURE fallback] ${email} from ${source}`); }
      if (result.error) return res.status(500).json({ error: result.error });
      return res.status(200).json({ ok: true });
    } catch { return res.status(500).json({ error: 'Internal server error.' }); }
  }

  // ── Welcome trigger (called on first sign-in / signup) ───────────────────
  if (action === 'welcome') {
    const { email, name } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required.' });
    try {
      const tags  = EMAIL_DRIP_TAGS.signup;
      const merge = { FNAME: name || '', SOURCE: 'signup' };
      const result = await addToMailchimp(email, tags, merge);
      if (result.error) return res.status(500).json({ error: result.error });
      return res.status(200).json({ ok: true, tags });
    } catch { return res.status(500).json({ error: 'Welcome trigger failed.' }); }
  }

  // ── Trial started trigger ─────────────────────────────────────────────────
  if (action === 'trial_start') {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required.' });
    try {
      const result = await addToMailchimp(email, EMAIL_DRIP_TAGS.trial_start, {});
      if (result.error) return res.status(500).json({ error: result.error });
      return res.status(200).json({ ok: true });
    } catch { return res.status(500).json({ error: 'Trial trigger failed.' }); }
  }

  // ── Trial expired trigger ─────────────────────────────────────────────────
  if (action === 'trial_expired') {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required.' });
    try {
      const result = await addToMailchimp(email, EMAIL_DRIP_TAGS.trial_expired, {});
      if (result.error) return res.status(500).json({ error: result.error });
      return res.status(200).json({ ok: true });
    } catch { return res.status(500).json({ error: 'Expired trigger failed.' }); }
  }

  // ── Premium upgrade trigger ───────────────────────────────────────────────
  if (action === 'premium_confirm') {
    const { email, plan } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required.' });
    try {
      const tags   = [...EMAIL_DRIP_TAGS.premium_upgrade, `plan:${plan||'unknown'}`];
      const result = await addToMailchimp(email, tags, { PLAN: plan || '' });
      if (result.error) return res.status(500).json({ error: result.error });
      return res.status(200).json({ ok: true });
    } catch { return res.status(500).json({ error: 'Premium trigger failed.' }); }
  }

  // ── Translate ingredient name to English ─────────────────────────
  if (action === 'translate' && req.method === 'POST') {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'text required' });
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 30,
          messages: [{ role:'user', content:`Translate this ingredient name to English. Return ONLY the English name, nothing else: "${text}"` }],
        }),
      });
      const d = await r.json();
      const english = d.content?.[0]?.text?.trim() || text;
      return res.status(200).json({ english, original: text });
    } catch {
      return res.status(500).json({ english: text, original: text });
    }
  }

  return res.status(400).json({
    error: `Unknown action: ${action}`,
    valid: ['feedback', 'email', 'welcome', 'trial_start', 'trial_expired', 'premium_confirm', 'translate'],
  });
}
