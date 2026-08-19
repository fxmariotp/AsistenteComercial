const https = require('https');

module.exports = function (req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const targetUrl = "https://script.google.com/macros/s/AKfycbzY2EB-cS_DciqXZ4Rfphu1sbyVs4SzVvEVKmkjeaKPoGXDD6UYc-31lNv2K0ti6Bf_eg/exec?json=true";

  function fetchUrl(url, redirectCount = 0) {
    if (redirectCount > 5) {
      return res.status(500).json({ error: "Too many redirects from Google Script" });
    }

    https.get(url, (googleRes) => {
      const { statusCode } = googleRes;

      // Follow redirects
      if (statusCode >= 300 && statusCode < 400 && googleRes.headers.location) {
        return fetchUrl(googleRes.headers.location, redirectCount + 1);
      }

      if (statusCode !== 200) {
        return res.status(statusCode).json({ error: `Google Script responded with status ${statusCode}` });
      }

      let rawData = '';
      googleRes.on('data', (chunk) => { rawData += chunk; });
      googleRes.on('end', () => {
        try {
          const parsedData = JSON.parse(rawData);
          return res.status(200).json(parsedData);
        } catch (e) {
          return res.status(500).json({ error: "Failed to parse Google Script JSON response", raw: rawData.substring(0, 500) });
        }
      });
    }).on('error', (e) => {
      return res.status(500).json({ error: e.message });
    });
  }

  fetchUrl(targetUrl);
};
