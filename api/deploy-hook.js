// api/deploy-hook.js — Vercel deploy webhook → writes to Supabase releases table
// Setup: Vercel Dashboard → Project → Settings → Git → Deploy Hooks
// Create hook → copy URL → paste in Vercel's "Notify on Deploy" field
// Or use Vercel's Integrations → Webhook → select "deployment.succeeded" event

module.exports = async function handler(req, res) {
  // Accept POST from Vercel webhook
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const url  = process.env.REACT_APP_SUPABASE_URL;
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return res.status(503).json({ error: 'Supabase not configured' });

  // Vercel sends: { type, createdAt, payload: { meta: { githubCommitMessage }, ... } }
  const body = req.body || {};
  const meta = body.payload?.meta || body.payload?.deployment || body;

  // Read version from package.json deployed
  // Vercel includes commit info — use that to identify the release
  const version    = meta.version || body.version || 'unknown';
  const commitMsg  = meta.githubCommitMessage || meta.commitMessage || '';
  const commitSha  = meta.githubCommitSha || meta.commitSha || '';
  const deployedAt = new Date().toISOString();
  const deployUrl  = meta.url || body.url || 'jiff-ecru.vercel.app';

  const h = {
    'Content-Type': 'application/json',
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Prefer': 'return=minimal',
  };

  // Write to Supabase releases table
  const r = await fetch(`${url}/rest/v1/releases`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({
      version:     version || `deploy-${deployedAt.slice(0,10)}`,
      title:       commitMsg.split('\n')[0].slice(0, 120) || 'Automated deploy',
      summary:     commitSha ? `Commit: ${commitSha.slice(0,7)}` : '',
      status:      'deployed',
      deployed_at: deployedAt,
      deploy_url:  deployUrl,
    }),
  });

  if (!r.ok) {
    const err = await r.text();
    console.error('releases insert error:', err);
    return res.status(500).json({ error: 'Failed to log release' });
  }

  console.log(`Release logged: ${version} at ${deployedAt}`);
  return res.status(200).json({ ok: true, version, deployedAt });
}
