// api/videos.js — YouTube recipe video search with Supabase cache (7-day TTL)
// Cache key: recipe name (normalised). Ranking: views 40% + engagement 30% + recency 20% + lang 10%

const YT_KEY   = process.env.YOUTUBE_API_KEY;
const YT_URL   = 'https://www.googleapis.com/youtube/v3';
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // ── Diagnostic endpoint: ?check=true ─────────────────────────
  if (req.query.check === 'true') {
    return res.status(200).json({
      youtube_key_set:   !!process.env.YOUTUBE_API_KEY,
      supabase_url_set:  !!process.env.REACT_APP_SUPABASE_URL,
      supabase_key_set:  !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      key_preview:       process.env.YOUTUBE_API_KEY
        ? process.env.YOUTUBE_API_KEY.slice(0,8) + '…'
        : null,
    });
  }

  const { recipe, cuisine = '', lang = 'en' } = req.query;
  if (!recipe?.trim()) return res.status(400).json({ error: 'recipe query param required' });

  const cacheKey = `${recipe.toLowerCase().trim()}_${lang}`;

  // ── Check Supabase cache first ─────────────────────────────────
  const sbUrl = process.env.REACT_APP_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const sbH   = sbUrl && sbKey ? { 'Content-Type':'application/json','apikey':sbKey,'Authorization':`Bearer ${sbKey}` } : null;

  if (sbH) {
    try {
      const cacheR = await fetch(`${sbUrl}/rest/v1/video_cache?cache_key=eq.${encodeURIComponent(cacheKey)}&limit=1`, { headers: sbH });
      const cached = await cacheR.json();
      if (Array.isArray(cached) && cached.length && cached[0]?.videos) {
        const age = Date.now() - new Date(cached[0].cached_at).getTime();
        if (age < CACHE_TTL) return res.status(200).json({ videos: cached[0].videos, cached: true });
      }
    } catch {}
  }

  if (!YT_KEY) return res.status(200).json({ videos: [], error: 'YouTube API not configured' });

  try {
    // ── Search YouTube ────────────────────────────────────────────
    const langHints = { hi:'हिंदी', ta:'tamil', te:'telugu', kn:'kannada', mr:'marathi' };
    const langHint  = langHints[lang] ? ` ${langHints[lang]}` : '';
    const q  = encodeURIComponent(`how to make ${recipe}${cuisine ? ' '+cuisine : ''}${langHint}`);
    const q2 = encodeURIComponent(`${recipe} recipe${langHint}`); // fallback query
    const searchR = await fetch(
      `${YT_URL}/search?part=snippet&q=${q}&type=video&maxResults=12&key=${YT_KEY}&relevanceLanguage=${lang}&safeSearch=strict`
    );
    const searchData = await searchR.json();
    // Fallback: try secondary query if primary returns nothing
    let searchItems = searchData.items || [];
    if (!searchR.ok || !searchItems.length) {
      const search2R = await fetch(`${YT_URL}/search?part=snippet&q=${q2}&type=video&maxResults=8&key=${YT_KEY}&safeSearch=strict`);
      const search2Data = await search2R.json();
      searchItems = search2Data.items || [];
    }
    if (!searchItems.length) return res.status(200).json({ videos: [], noResults: true });

    const ids = searchItems.map(i => i.id.videoId).join(',');

    // ── Get video stats for ranking ───────────────────────────────
    const statsR = await fetch(`${YT_URL}/videos?part=statistics,contentDetails&id=${ids}&key=${YT_KEY}`);
    const statsData = await statsR.json();
    const statsMap = {};
    (statsData.items || []).forEach(v => { statsMap[v.id] = { stats: v.statistics, details: v.contentDetails }; });

    // ── Rank videos ───────────────────────────────────────────────
    const now = Date.now();
    const ranked = searchItems.map(item => {
      const id = item.id.videoId;
      const st = statsMap[id]?.stats || {};
      const views     = parseInt(st.viewCount || 0);
      const likes     = parseInt(st.likeCount || 0);
      const engRate   = views > 0 ? likes / views : 0;
      const pubDate   = new Date(item.snippet.publishedAt).getTime();
      const ageMonths = (now - pubDate) / (30 * 24 * 60 * 60 * 1000);
      const recency   = Math.max(0, 1 - ageMonths / 36); // decay over 3 years
      // Parse duration (PT4M30S → seconds)
      const dur = statsMap[id]?.details?.duration || 'PT0S';
      const durMatch = dur.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
      const durSec = ((parseInt(durMatch?.[1]||0)*60 + parseInt(durMatch?.[2]||0))*60 + parseInt(durMatch?.[3]||0));
      const durScore = durSec >= 120 && durSec <= 1200 ? 1 : (durSec > 0 && durSec < 120 ? 0.7 : 0.4); // prefer 2-20 min

      // Language match bonus
      const titleLower = item.snippet.title.toLowerCase();
      const langBonus  = langHints[lang] && titleLower.includes(langHints[lang].toLowerCase()) ? 1 : 0;

      // Normalise views (log scale)
      const viewScore = views > 0 ? Math.min(1, Math.log10(views) / 7) : 0; // 10M views = 1.0

      const score = viewScore*0.4 + engRate*2*0.3 + recency*0.2 + langBonus*0.1 + durScore*0.1;

      return {
        id, score,
        title:     item.snippet.title,
        channel:   item.snippet.channelTitle,
        thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
        url:       `https://www.youtube.com/watch?v=${id}`,
        embedUrl:  `https://www.youtube.com/embed/${id}?autoplay=1&rel=0`,
        views, duration: durSec, publishedAt: item.snippet.publishedAt,
      };
    }).sort((a,b) => b.score - a.score).slice(0,3);

    // ── Save to Supabase cache ─────────────────────────────────────
    if (sbH) {
      try {
        await fetch(`${sbUrl}/rest/v1/video_cache`, {
          method: 'POST',
          headers: { ...sbH, 'Prefer': 'resolution=merge-duplicates' },
          body: JSON.stringify({ cache_key: cacheKey, videos: ranked, cached_at: new Date().toISOString() }),
        });
      } catch {}
    }

    return res.status(200).json({ videos: ranked, cached: false });
  } catch (err) {
    console.error('videos error:', err);
    return res.status(500).json({ error: 'Video search failed', videos: [] });
  }
}
