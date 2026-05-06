// api/payments.js — Consolidated: create-order + verify-payment (Razorpay)
// Route by ?action=create | verify

const crypto = require('crypto');

const PLANS = {
  monthly:  { amount: 9900,   currency: 'INR', description: 'Jiff Premium — Monthly' },
  annual:   { amount: 79900,  currency: 'INR', description: 'Jiff Premium — Annual' },
  lifetime: { amount: 299900, currency: 'INR', description: 'Jiff Premium — Lifetime' },
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const action    = req.query.action || req.body?.action;
  const keyId     = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  // ── Create order ──────────────────────────────────────────────────
  if (action === 'create') {
    if (!keyId || !keySecret) return res.status(500).json({ error: 'Razorpay not configured.' });
    try {
      const { planId } = req.body;
      const plan = PLANS[planId];
      if (!plan) return res.status(400).json({ error: 'Invalid plan.' });

      const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
      const response = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${auth}` },
        body: JSON.stringify({ amount: plan.amount, currency: plan.currency, receipt: `jiff_${planId}_${Date.now()}`, notes: { plan: planId, product: 'Jiff Premium' } }),
      });
      const order = await response.json();
      if (!response.ok) return res.status(response.status).json({ error: order.error?.description || 'Order creation failed.' });
      return res.status(200).json({ orderId: order.id, amount: plan.amount, currency: plan.currency, keyId, description: plan.description });
    } catch (err) {
      return res.status(500).json({ error: 'Internal server error.' });
    }
  }

  // ── Verify payment ────────────────────────────────────────────────
  if (action === 'verify') {
    if (!keySecret) return res.status(500).json({ error: 'Razorpay not configured.' });
    try {
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature, planId } = req.body;
      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({ error: 'Missing payment verification fields.' });
      }
      const expectedSig = crypto
        .createHmac('sha256', keySecret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex');

      if (expectedSig !== razorpay_signature) {
        return res.status(400).json({ error: 'Payment signature verification failed.' });
      }
      return res.status(200).json({ ok: true, planId, paymentId: razorpay_payment_id, verified: true, timestamp: new Date().toISOString() });
    } catch (err) {
      return res.status(500).json({ error: 'Internal server error.' });
    }
  }

  return res.status(400).json({ error: `Unknown action: ${action}. Use ?action=create or ?action=verify` });
}
