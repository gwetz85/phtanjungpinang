const express = require('express');
const router = express.Router();
const https = require('https');

// In-memory cache for news items
let newsCache = {
  data: [],
  lastFetched: 0,
  ttl: 10 * 60 * 1000 // 10 minutes cache
};

// Fetch RSS via HTTPS with redirect handling and timeout
function fetchRSS(url, maxRedirects = 3) {
  return new Promise((resolve, reject) => {
    if (maxRedirects < 0) return reject(new Error('Too many redirects'));

    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*'
      },
      timeout: 10000
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchRSS(res.headers.location, maxRedirects - 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP status ${res.statusCode}`));
      }
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

// Decode HTML entities and CDATA
function decodeHtml(html) {
  return (html || '')
    .replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

// Format relative time in Indonesian
function formatRelativeTime(dateStr) {
  try {
    const pubDate = new Date(dateStr);
    if (isNaN(pubDate.getTime())) return '';

    const diffMs = Date.now() - pubDate.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHours = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) return `${diffDays} hari lalu`;
    if (diffHours > 0) return `${diffHours} jam lalu`;
    if (diffMin > 0) return `${diffMin} menit lalu`;
    return 'Baru saja';
  } catch (_) {
    return '';
  }
}

// Parse RSS XML content
function parseRSS(xml) {
  const items = [];
  const itemRegex = /<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?<pubDate>([\s\S]*?)<\/pubDate>([\s\S]*?<source[^>]*>([\s\S]*?)<\/source>)?[\s\S]*?<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null && items.length < 20) {
    let rawTitle = decodeHtml(match[1]);
    const link = decodeHtml(match[2]);
    const pubDate = decodeHtml(match[3]);
    let rawSource = decodeHtml(match[5]);

    if (!rawSource && rawTitle.includes(' - ')) {
      const idx = rawTitle.lastIndexOf(' - ');
      rawSource = rawTitle.substring(idx + 3).trim();
      rawTitle = rawTitle.substring(0, idx).trim();
    } else if (rawSource && rawTitle.endsWith(' - ' + rawSource)) {
      rawTitle = rawTitle.substring(0, rawTitle.length - rawSource.length - 3).trim();
    }

    if (rawTitle && rawTitle.length > 5) {
      items.push({
        title: rawTitle,
        source: rawSource || 'Kabar Tanjungpinang',
        link: link || '#',
        pubDate: pubDate,
        timeAgo: formatRelativeTime(pubDate)
      });
    }
  }

  return items;
}

// Fetch live Tanjungpinang news from internet feeds
async function fetchTanjungpinangNews() {
  const now = Date.now();
  // Return memory cache if still valid
  if (newsCache.data.length > 0 && (now - newsCache.lastFetched) < newsCache.ttl) {
    return newsCache.data;
  }

  const primaryUrl = 'https://news.google.com/rss/search?q=Tanjungpinang&hl=id&gl=ID&ceid=ID:id';
  const fallbackUrl = 'https://kepri.antaranews.com/rss/terkini.xml';

  try {
    const xml = await fetchRSS(primaryUrl);
    const items = parseRSS(xml);
    if (items.length > 0) {
      newsCache.data = items;
      newsCache.lastFetched = now;
      return items;
    }
  } catch (err) {
    console.warn('[NewsService] Primary feed error, trying fallback:', err.message);
  }

  try {
    const xml = await fetchRSS(fallbackUrl);
    const items = parseRSS(xml);
    if (items.length > 0) {
      newsCache.data = items;
      newsCache.lastFetched = now;
      return items;
    }
  } catch (err) {
    console.warn('[NewsService] Fallback feed error:', err.message);
  }

  // If both failed but we have stale cache, return stale cache
  if (newsCache.data.length > 0) {
    return newsCache.data;
  }

  // Default fallback items if completely offline
  return [
    {
      title: 'Selamat Datang di Pelangi Hotel Tanjungpinang - Layanan Database Terpadu',
      source: 'Pelangi Hotel',
      link: '#',
      pubDate: new Date().toISOString(),
      timeAgo: 'Hari ini'
    },
    {
      title: 'Informasi dan Warta Seputar Daerah Kota Tanjungpinang dan Kepulauan Riau',
      source: 'Info Tanjungpinang',
      link: '#',
      pubDate: new Date().toISOString(),
      timeAgo: 'Hari ini'
    }
  ];
}

// GET /api/news - Get live Tanjungpinang news
router.get('/', async (req, res) => {
  try {
    const news = await fetchTanjungpinangNews();
    res.json({
      success: true,
      city: 'Kota Tanjungpinang',
      total: news.length,
      updatedAt: new Date(newsCache.lastFetched || Date.now()).toISOString(),
      news
    });
  } catch (err) {
    console.error('[News API Error]', err);
    res.status(500).json({
      success: false,
      message: 'Gagal memuat berita terkini: ' + err.message
    });
  }
});

module.exports = router;
