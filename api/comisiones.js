const https = require('https');

const RENOSUR_AGENTS = [
  {
    dni: "28727453Q",
    name: "BEGOÑA CABANILLAS PIQUERO",
    keywords: ["BEGOÑA", "BEGONA", "CABANILLAS", "PIQUERO", "BEGO"]
  },
  {
    dni: "47269867Z",
    name: "CHRISTIAN CABRERA MARQUEZ",
    keywords: ["CHRISTIAN", "CRISTIAN", "CABRERA MARQUEZ"]
  },
  {
    dni: "77976681B",
    name: "CLARA TORREÑO RUIZ",
    keywords: ["CLARA", "TORREÑO", "TORRENO", "RUIZ"]
  },
  {
    dni: "28818524F",
    name: "CRISTINA SANTOS LARIOS",
    keywords: ["CRISTINA", "SANTOS", "LARIOS", "CRIS"]
  },
  {
    dni: "47269866J",
    name: "JOSE MIGUEL CABRERA MARQUEZ",
    keywords: ["JOSE MIGUEL", "JOSE M", "JOSEMI", "JOSÉ MIGUEL"]
  },
  {
    dni: "51997096F",
    name: "MANUELA SALAZAR CORTES",
    keywords: ["MANUELA", "SALAZAR", "CORTES", "MANOLI"]
  },
  {
    dni: "29537747C",
    name: "MARINA MARTINEZ DE LA ROSA",
    keywords: ["MARINA", "MARTINEZ", "DE LA ROSA", "ROSA"]
  },
  {
    dni: "77822813J",
    name: "MARIO TIBURCIO PORRAS",
    keywords: ["MARIO", "TIBURCIO", "PORRAS"]
  },
  {
    dni: "30369873Y",
    name: "MERCEDES TERRON DIEZ",
    keywords: ["MERCEDES", "TERRON", "DIEZ", "MERCHE"]
  },
  {
    dni: "53283415M",
    name: "MÓNICA CEJUDO HIDALGO",
    keywords: ["MONICA", "MÓNICA", "CEJUDO", "HIDALGO"]
  }
];

function cleanStr(str) {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

function findMatchingAgent(rawAgent) {
  if (!rawAgent) return null;
  const cleanInput = cleanStr(rawAgent);
  if (!cleanInput) return null;

  // 1. Exact match on full name
  for (const agent of RENOSUR_AGENTS) {
    if (cleanStr(agent.name) === cleanInput) return agent;
  }

  // 2. Disambiguate CABRERA brothers first: "JOSE MIGUEL" vs "CHRISTIAN"
  if (cleanInput.includes("JOSE MIGUEL") || cleanInput.includes("JOSE M") || cleanInput.includes("JOSEMI") || cleanInput.includes("JOSÉ MIGUEL")) {
    return RENOSUR_AGENTS.find(a => a.dni === "47269866J");
  }
  if (cleanInput.includes("CHRISTIAN") || cleanInput.includes("CRISTIAN")) {
    return RENOSUR_AGENTS.find(a => a.dni === "47269867Z");
  }

  // 3. Match on unique first name or keyword
  for (const agent of RENOSUR_AGENTS) {
    for (const kw of agent.keywords) {
      const cleanKw = cleanStr(kw);
      if (cleanInput === cleanKw || cleanInput.startsWith(cleanKw + " ") || cleanInput.endsWith(" " + cleanKw) || cleanInput.includes(cleanKw)) {
        return agent;
      }
    }
  }

  return null;
}

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
        while (row.length < 35) row.push('');
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
      while (row.length < 35) row.push('');
      lines.push(row);
    }
  }
  return lines;
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
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const sheetId = "1ZFTf8S0Gvsq1UNOhhZ5cUbwyKpVTpAdlbbvyhUcp1lI";
  const targetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&t=${Date.now()}`;

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

          // Detectar columnas y fila de cabecera si existe
          let startRow = 0;
          let colAgente = 0; // Col A por defecto (0)
          let colComi = 1;   // Col B por defecto (1) o Col T (19)

          for (let i = 0; i < Math.min(rows.length, 5); i++) {
            const r = rows[i];
            for (let j = 0; j < r.length; j++) {
              const val = cleanStr(r[j]);
              if (val === 'AGENTE' || val === 'AGENTES' || val.includes('AGENTE')) {
                colAgente = j;
                startRow = i + 1;
              }
              if (val === 'COMI' || val === 'COMISION' || val === 'COMISIONES' || val.includes('COMI')) {
                colComi = j;
              }
            }
          }

          const comisionesMap = {};
          const matchedDetails = [];

          for (let i = startRow; i < rows.length; i++) {
            const r = rows[i];
            if (!r) continue;

            const rawAgent = (r[colAgente] !== undefined && r[colAgente] !== '' ? r[colAgente] : (r[0] || '')).trim();
            const cleanAgent = cleanStr(rawAgent);

            if (!rawAgent || cleanAgent === 'AGENTES' || cleanAgent === 'AGENTE' || cleanAgent === 'TOTAL' || cleanAgent === 'TOTALES' || cleanAgent === 'MEDIA' || cleanAgent === 'PROMEDIO') {
              continue;
            }

            // Buscar valor en colComi, Col B (índice 1) o Col T (índice 19)
            let rawVal = 0;
            if (r[colComi] !== undefined && r[colComi] !== '') {
              rawVal = r[colComi];
            } else if (r[1] !== undefined && r[1] !== '') {
              rawVal = r[1];
            } else if (r[19] !== undefined && r[19] !== '') {
              rawVal = r[19];
            }

            const val = parseComisionValue(rawVal);

            // Mapeo universal para el comercial de Renosur
            const matchedAgent = findMatchingAgent(rawAgent);
            if (matchedAgent) {
              comisionesMap[matchedAgent.dni] = val;
              comisionesMap[matchedAgent.name] = val;
              comisionesMap[cleanStr(matchedAgent.name)] = val;
              matchedDetails.push({
                dni: matchedAgent.dni,
                nombre: matchedAgent.name,
                rawNameInSheet: rawAgent,
                comision: val,
                filaExcel: i + 1
              });
            }

            comisionesMap[cleanAgent] = val;
            comisionesMap[rawAgent] = val;
          }

          return res.status(200).json({
            success: true,
            sheetId,
            headerRow: startRow,
            colAgente,
            colComi,
            matchedDetails,
            totalEmparejados: matchedDetails.length,
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
