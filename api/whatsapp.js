// api/whatsapp.js — WhatsApp Business Cloud API webhook
// Handles incoming messages and responds with recipe suggestions
// Setup: see WHATSAPP_SETUP.md

module.exports = async function handler(req, res) {
  // ── Webhook verification (GET) ─────────────────────────────────
  if (req.method === 'GET') {
    const mode      = req.query['hub.mode'];
    const token     = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'jiff-whatsapp-2026';
    if (mode === 'subscribe' && token === verifyToken) {
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: 'Verification failed' });
  }

  // ── Incoming message (POST) ────────────────────────────────────
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return res.status(200).json({ ok: true });

    const entry   = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value   = changes?.value;
    const message = value?.messages?.[0];

    if (!message || message.type !== 'text') return res.status(200).json({ ok: true });

    const from = message.from;
    const text = (message.text?.body || '').trim();
    const phoneNumberId = value?.metadata?.phone_number_id;

    // Parse the message for ingredients
    // Accepts: "Hi Jiff! rice, dal, onion" or "What can I make with rice and dal?"
    const jiffTrigger = /jiff|recipe|make|cook|suggest|what.*with/i.test(text);
    if (!jiffTrigger) {
      await sendWhatsAppMessage(phoneNumberId, from, getHelpMessage());
      return res.status(200).json({ ok: true });
    }

    // Extract ingredients from message
    const cleaned = text
      .replace(/hi\s*jiff\s*[!,.]*/gi, '')
      .replace(/what can i make with/gi, '')
      .replace(/suggest.*with/gi, '')
      .replace(/recipe.*with/gi, '')
      .replace(/cook.*with/gi, '')
      .trim();
    const ingredients = cleaned.split(/[,&/\n]+|and\s+/i)
      .map(s => s.replace(/[^\w\s]/g, '').trim().toLowerCase())
      .filter(s => s.length >= 2);

    if (ingredients.length === 0) {
      await sendWhatsAppMessage(phoneNumberId, from,
        "🤔 I couldn't find any ingredients in your message. Try: *\"Hi Jiff! rice, dal, onion\"*");
      return res.status(200).json({ ok: true });
    }

    // Send typing indicator
    await sendTypingIndicator(phoneNumberId, from);

    // Get recipe suggestion
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) {
      await sendWhatsAppMessage(phoneNumberId, from, "⚠️ Jiff is temporarily unavailable. Please try the app instead: https://jiff-ecru.vercel.app");
      return res.status(200).json({ ok: true });
    }

    const prompt = `You are a practical chef assistant for a WhatsApp bot. The user has: ${ingredients.join(', ')}.
Suggest ONE quick recipe. Respond in this exact format — concise, WhatsApp-friendly:

🍽️ *[Recipe Name]*
⏱ [Time] | 👥 Serves 2

📝 *Ingredients:*
• [item 1]
• [item 2]
(max 6 items)

👨‍🍳 *Steps:*
1. [Step]
2. [Step]
(max 5 steps, keep each under 15 words)

_Powered by ⚡ Jiff — jiff-ecru.vercel.app_`;

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 400, messages: [{ role:'user', content: prompt }] }),
    });
    const aiData = await aiRes.json();
    const recipe = aiData.content?.map(c => c.text || '').join('') || 'Sorry, could not generate a recipe right now.';

    await sendWhatsAppMessage(phoneNumberId, from, recipe);
    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('WhatsApp webhook error:', err);
    return res.status(200).json({ ok: true }); // Always 200 to avoid Meta retries
  }
}

function getHelpMessage() {
  return `👋 Hi! I'm *Jiff*, your AI cooking assistant.\n\nSend me a message like:\n*"Hi Jiff! rice, dal, onion"*\nor\n*"What can I make with chicken and tomatoes?"*\n\nI'll suggest a recipe instantly! 🍳\n\n_For more features: https://jiff-ecru.vercel.app_`;
}

async function sendWhatsAppMessage(phoneNumberId, to, text) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token || !phoneNumberId) return;
  await fetch(`https://graph.facebook.com/v18.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text, preview_url: false } }),
  }).catch(() => {});
}

async function sendTypingIndicator(phoneNumberId, to) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token || !phoneNumberId) return;
  // Mark message as read to show typing
  await fetch(`https://graph.facebook.com/v18.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: to }),
  }).catch(() => {});
}
