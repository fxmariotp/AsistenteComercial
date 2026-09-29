const https = require('https');

let memoryCache = {
  data: null,
  timestamp: 0
};
const CACHE_TTL_MS = 30 * 1000; // 30 segundos de caché fresca en memoria

module.exports = function (req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Edge CDN cache headers: Vercel CDN cachea 30s y permite servir stale hasta 180s mientras revalida
  res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=180');

  const now = Date.now();
  const isForce = req.query && (req.query.force === 'true' || req.query.fresh === '1');

  // Si hay caché fresca en memoria y no se fuerza recarga, servirla al instante (<50ms)
  if (!isForce && memoryCache.data && (now - memoryCache.timestamp < CACHE_TTL_MS)) {
    res.setHeader('X-Cache-Status', 'HIT');
    return res.status(200).json(memoryCache.data);
  }

  const targetUrl = "https://script.google.com/macros/s/AKfycbzY2EB-cS_DciqXZ4Rfphu1sbyVs4SzVvEVKmkjeaKPoGXDD6UYc-31lNv2K0ti6Bf_eg/exec?json=true";
  let isResolved = false;

  function fetchUrl(url, redirectCount = 0) {
    if (redirectCount > 5) {
      if (memoryCache.data) {
        res.setHeader('X-Cache-Fallback', 'true');
        return res.status(200).json(memoryCache.data);
      }
      return res.status(500).json({ error: "Too many redirects from Google Script" });
    }

    const requestOptions = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*'
      },
      timeout: 14000
    };

    const googleReq = https.get(url, requestOptions, (googleRes) => {
      const { statusCode } = googleRes;

      // Follow redirects
      if (statusCode >= 300 && statusCode < 400 && googleRes.headers.location) {
        return fetchUrl(googleRes.headers.location, redirectCount + 1);
      }

      if (statusCode !== 200) {
        if (memoryCache.data) {
          res.setHeader('X-Cache-Fallback', 'true');
          return res.status(200).json(memoryCache.data);
        }
        return res.status(statusCode).json({ error: `Google Script responded with status ${statusCode}` });
      }

      let rawData = '';
      googleRes.on('data', (chunk) => { rawData += chunk; });
      googleRes.on('end', () => {
        if (isResolved) return;
        isResolved = true;
        try {
          const parsedData = JSON.parse(rawData);
          if (Array.isArray(parsedData) && parsedData.length > 0) {
            memoryCache.data = parsedData;
            memoryCache.timestamp = Date.now();
            res.setHeader('X-Cache-Status', 'MISS');
            return res.status(200).json(parsedData);
          } else {
            throw new Error("Invalid array data format");
          }
        } catch (e) {
          if (memoryCache.data) {
            res.setHeader('X-Cache-Fallback', 'true');
            return res.status(200).json(memoryCache.data);
          }
          return res.status(500).json({ error: "Failed to parse Google Script JSON response", raw: rawData.substring(0, 500) });
        }
      });
    });

    googleReq.on('timeout', () => {
      googleReq.destroy();
      if (isResolved) return;
      isResolved = true;
      if (memoryCache.data) {
        res.setHeader('X-Cache-Fallback', 'true');
        return res.status(200).json(memoryCache.data);
      }
      return res.status(504).json({ error: "Google Apps Script connection timed out" });
    });

    googleReq.on('error', (e) => {
      if (isResolved) return;
      isResolved = true;
      if (memoryCache.data) {
        res.setHeader('X-Cache-Fallback', 'true');
        return res.status(200).json(memoryCache.data);
      }
      return res.status(500).json({ error: e.message });
    });
  }

  fetchUrl(targetUrl);
};
