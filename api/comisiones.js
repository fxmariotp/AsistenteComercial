const https = require('https');

function parseCSV(text) {
  const lines = [];
  let row = [];
  let inQuotes = false;
  let currentField = '';
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];
    
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentField += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(currentField.trim());
      currentField = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') i++;
      row.push(currentField.trim());
      if (row.some(field => field.length > 0)) {
        lines.push(row);
      }
      row = [];
      currentField = '';
    } else {
      currentField += char;
    }
  }
  if (currentField || row.length > 0) {
    row.push(currentField.trim());
    if (row.some(field => field.length > 0)) {
      lines.push(row);
    }
  }
  return lines;
}

function cleanStr(str) {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

function parseComisionValue(raw) {
  if (typeof raw === 'number') return raw;
  if (!raw) return 0;
  let cleaned = String(raw).replace(/[^0-9.,-]/g, '').trim();
  if (!cleaned) return 0;
  if (cleaned.includes('.') && cleaned.includes(',')) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (cleaned.includes(',')) {
    cleaned = cleaned.replace(',', '.');
  }
  const val = parseFloat(cleaned);
  return isNaN(val) ? 0 : val;
}

module.exports = function (req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const sheetId = "1a-GdXo7XH0OZJD2KQAQE0UZaAajGGRWoirtbbt7Q14U";
  const targetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv`;

  function fetchUrl(url, redirectCount = 0) {
    if (redirectCount > 5) {
      return res.status(500).json({ error: "Demasiadas redirecciones de Google Sheets" });
    }

    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (googleRes) => {
      const { statusCode } = googleRes;

      if (statusCode >= 300 && statusCode < 400 && googleRes.headers.location) {
        return fetchUrl(googleRes.headers.location, redirectCount + 1);
      }

      if (statusCode === 401 || statusCode === 403) {
        return res.status(200).json({
          success: false,
          error: "El documento de Google Sheets está en modo privado. Por favor, compártelo con 'Cualquier persona con el enlace puede ser lector'.",
          data: {}
        });
      }

      if (statusCode !== 200) {
        return res.status(statusCode).json({ error: `Google Sheets respondió con código ${statusCode}` });
      }

      let rawData = '';
      googleRes.on('data', (chunk) => { rawData += chunk; });
      googleRes.on('end', () => {
        try {
          const rows = parseCSV(rawData);
          if (!rows || rows.length === 0) {
            return res.status(200).json({ success: false, error: "El archivo CSV está vacío", data: {} });
          }

          // Localizar fila de encabezados buscando AGENTES en col A (0) o cualquier columna, y COMI en col T (19)
          let headerRowIndex = 0;
          let colAgente = 0; // Col A por defecto
          let colComi = 19;  // Col T por defecto (0-indexed: 19)

          for (let i = 0; i < Math.min(rows.length, 10); i++) {
            const r = rows[i];
            for (let j = 0; j < r.length; j++) {
              const val = cleanStr(r[j]);
              if (val.includes('AGENTE')) colAgente = j;
              if (val.includes('COMI')) colComi = j;
            }
            if (r.some(c => cleanStr(c).includes('AGENTE')) || r.some(c => cleanStr(c).includes('COMI'))) {
              headerRowIndex = i;
              break;
            }
          }

          const comisionesMap = {};
          for (let i = headerRowIndex + 1; i < rows.length; i++) {
            const r = rows[i];
            if (!r || r.length <= colAgente) continue;
            const rawAgent = (r[colAgente] || '').trim();
            if (!rawAgent || cleanStr(rawAgent) === 'AGENTES' || cleanStr(rawAgent) === 'TOTAL') continue;

            const rawVal = r[colComi] !== undefined ? r[colComi] : (r[19] || 0);
            const val = parseComisionValue(rawVal);
            const cleanKey = cleanStr(rawAgent);
            comisionesMap[cleanKey] = val;
            comisionesMap[rawAgent] = val;
          }

          return res.status(200).json({
            success: true,
            sheetId,
            headerRow: headerRowIndex + 1,
            colAgente,
            colComi,
            totalAgentes: Object.keys(comisionesMap).length / 2,
            data: comisionesMap
          });
        } catch (e) {
          return res.status(500).json({ error: "Error procesando el CSV de comisiones", details: e.message });
        }
      });
    }).on('error', (e) => {
      return res.status(500).json({ error: e.message });
    });
  }

  fetchUrl(targetUrl);
};
