/**
 * ============================================================================
 * GOOGLE APPS SCRIPT: RECEPTOR PRIVADO DE RANKING (SERVIDOR A SERVIDOR)
 * Archivo: google_apps_script/ranking_receiver.gs
 * ============================================================================
 * 
 * MEDIDAS DE SEGURIDAD Y COMPATIBILIDAD CON GOOGLE APPS SCRIPT:
 * 
 * 1. LIMITACIÓN TÉCNICA DE APPS SCRIPT (EVENT OBJECT 'e'):
 *    El entorno de ejecución de Google Apps Script Web Apps (doPost / doGet)
 *    NO expone cabeceras HTTP de la petición (como X-Ranking-Secret o Authorization).
 *    Google Apps Script únicamente expone en el parámetro evento 'e':
 *    - e.postData.contents: Cadena en texto plano con el cuerpo POST (JSON).
 *    - e.parameter: Parámetros URL de consulta (query string).
 *    - e.queryString: Cadena de consulta cruda.
 *    Por tanto, la autenticación viaja encriptada vía TLS dentro del payload
 *    JSON del cuerpo de la petición POST (e.postData.contents).
 * 
 * 2. CONTRATO DE ERROR Y CÓDIGOS DE ESTADO JSON:
 *    ContentService.createTextOutput() en Google Apps Script NO permite configurar
 *    códigos de estado HTTP reales (siempre emite HTTP 200 o redirección 302).
 *    Por ello, se define un contrato JSON explícito:
 *      { ok: true, success: true, code: 200, ranking: [...] }
 *      { ok: false, success: false, code: 401|400|503, error: "..." }
 *    El backend de Vercel (api/ranking.js) interpreta este contrato y traduce
 *    el valor 'code' al código de estado HTTP real entregado al cliente.
 * 
 * 3. CONTRATO UNIFICADO DE DATOS DE RANKING:
 *    Cada registro contiene todos los datos utilizados por el frontend para
 *    ranking, objetivos diarios, pendientes y recuentos de sala:
 *      - posicion: number (1, 2, 3...)
 *      - nombre: string (Nombre del comercial)
 *      - puntos: number (Puntuación actual)
 *      - objetivo: number (Meta asignada)
 *      - pendientes: number (Ventas o puntos en proceso)
 * 
 * 4. ALMACENAMIENTO SEGURO DEL SECRETO:
 *    El secreto compartido NUNCA debe estar en el código fuente.
 *    Se almacena en Script Properties (Propiedades del Script):
 *    Configuración en Editor Apps Script:
 *      Configuración del Proyecto > Propiedades del script > Añadir propiedad:
 *      Nombre: RANKING_SHARED_SECRET
 *      Valor:  <secreto criptográfico de alta entropía (mínimo 32 caracteres)>
 *      (Opcional) SPREADSHEET_ID: <ID de la hoja de cálculo de staging o producción>
 * 
 * 5. COMPARACIÓN EN TIEMPO CONSTANTE (Timing-Attack Safe):
 *    Se utiliza safeCompare() para comparar los secretos byte a byte en tiempo
 *    constante, previniendo ataques de canal lateral basados en tiempos de respuesta.
 * 
 * 6. BLOQUEO DE ACCESO PÚBLICO GET:
 *    doGet(e) rechaza cualquier intento de consulta pública vía navegador (code 405).
 * ============================================================================
 */

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    // 1. Validar presencia de cuerpo de datos POST
    if (!e || !e.postData || !e.postData.contents) {
      return createErrorResponse(400, "Petición inválida: sin cuerpo de datos POST");
    }

    // 2. Parsear cuerpo JSON
    var payload;
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return createErrorResponse(400, "Petición inválida: cuerpo JSON malformado");
    }

    // 3. Obtener el secreto esperado desde Script Properties (sin quemar en código)
    var scriptProps = PropertiesService.getScriptProperties();
    var expectedSecret = scriptProps.getProperty("RANKING_SHARED_SECRET");

    if (!expectedSecret) {
      return createErrorResponse(503, "Configuración incompleta: RANKING_SHARED_SECRET no configurado en Script Properties");
    }

    // 4. Validar autenticación de forma segura (tiempo constante)
    var providedSecret = payload.secret;
    if (!providedSecret || !safeCompare(String(providedSecret), String(expectedSecret))) {
      return createErrorResponse(401, "Acceso no autorizado: credencial inválida");
    }

    // 5. Validar acción requerida
    if (payload.action !== 'getRanking') {
      return createErrorResponse(400, "Acción no soportada. Acción esperada: 'getRanking'");
    }

    // 6. Obtener datos del ranking desde la hoja de cálculo con el contrato unificado completo
    var spreadsheetId = scriptProps.getProperty("SPREADSHEET_ID");
    var rankingData = getRankingFromSheet(spreadsheetId);

    return createSuccessResponse(rankingData);

  } catch (err) {
    return createErrorResponse(500, "Error interno al procesar el ranking: " + err.message);
  } finally {
    try { lock.releaseLock(); } catch (ignored) {}
  }
}

/**
 * Bloquear accesos públicos directos vía GET en navegador
 */
function doGet(e) {
  return createErrorResponse(405, "Método no permitido. El servicio de ranking solo admite peticiones POST autenticadas desde el backend.");
}

/**
 * Comparación segura de cadenas en tiempo constante (protección contra timing attacks)
 */
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  var result = 0;
  for (var i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Lectura de datos de ranking preservando el contrato unificado:
 * [ { posicion, nombre, puntos, objetivo, pendientes }, ... ]
 */
function getRankingFromSheet(spreadsheetId) {
  var ss;
  if (spreadsheetId) {
    ss = SpreadsheetApp.openById(spreadsheetId);
  } else {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  }

  if (!ss) {
    // Si no hay hoja vinculada (entorno de pruebas/desarrollo), retornar datos estructurados de staging
    return [
      { posicion: 1, nombre: "COMERCIAL TEST A", puntos: 1540.0, objetivo: 16.0, pendientes: 2.0 },
      { posicion: 2, nombre: "COMERCIAL TEST B", puntos: 1320.0, objetivo: 16.0, pendientes: 0.0 },
      { posicion: 3, nombre: "GERENTE TEST", puntos: 1190.0, objetivo: 16.0, pendientes: 1.0 }
    ];
  }

  var sheet = ss.getSheetByName("Ranking") || ss.getSheets()[0];
  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) {
    return [];
  }

  var headers = data[0].map(function (h) { return String(h).trim().toLowerCase(); });
  var colNombre = -1;
  var colPuntos = -1;
  var colObjetivo = -1;
  var colPendientes = -1;
  var colPosicion = -1;

  for (var i = 0; i < headers.length; i++) {
    var h = headers[i];
    if (h.indexOf("nombre") !== -1 || h.indexOf("comercial") !== -1 || h.indexOf("agente") !== -1) {
      colNombre = i;
    } else if (h.indexOf("punto") !== -1 || h.indexOf("total") !== -1 || h.indexOf("score") !== -1) {
      colPuntos = i;
    } else if (h.indexOf("objetivo") !== -1 || h.indexOf("meta") !== -1 || h.indexOf("target") !== -1) {
      colObjetivo = i;
    } else if (h.indexOf("pendiente") !== -1 || h.indexOf("proceso") !== -1 || h.indexOf("pend") !== -1) {
      colPendientes = i;
    } else if (h.indexOf("pos") !== -1 || h.indexOf("lugar") !== -1 || h.indexOf("ranking") !== -1) {
      colPosicion = i;
    }
  }

  // Posiciones por defecto si los encabezados varían: Col 0: Pos, Col 1: Nombre, Col 2: Puntos, Col 3: Objetivo, Col 4: Pendientes
  if (colNombre === -1) colNombre = 1;
  if (colPuntos === -1) colPuntos = 2;
  if (colObjetivo === -1) colObjetivo = 3;
  if (colPendientes === -1) colPendientes = 4;
  if (colPosicion === -1) colPosicion = 0;

  var results = [];
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var nombre = row[colNombre];
    if (!nombre) continue;

    var puntos = parseFloat(row[colPuntos]) || 0;
    var objetivo = (colObjetivo < row.length && row[colObjetivo] !== "") ? (parseFloat(row[colObjetivo]) || 16.0) : 16.0;
    var pendientes = (colPendientes < row.length && row[colPendientes] !== "") ? (parseFloat(row[colPendientes]) || 0) : 0;
    var posicion = Number(row[colPosicion]) || r;

    results.push({
      posicion: posicion,
      nombre: String(nombre).trim(),
      puntos: puntos,
      objetivo: objetivo,
      pendientes: pendientes
    });
  }

  // Ordenar por puntos de forma descendente
  results.sort(function(a, b) {
    return b.puntos - a.puntos;
  });

  // Reasignar posiciones tras ordenar
  for (var k = 0; k < results.length; k++) {
    results[k].posicion = k + 1;
  }

  return results;
}

/**
 * Generador de respuesta exitosa con contrato JSON explícito
 */
function createSuccessResponse(rankingArray) {
  var output = ContentService.createTextOutput(JSON.stringify({
    ok: true,
    success: true,
    code: 200,
    ranking: rankingArray
  }));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

/**
 * Generador de respuesta de error con contrato JSON explícito
 */
function createErrorResponse(code, errorMessage) {
  var output = ContentService.createTextOutput(JSON.stringify({
    ok: false,
    success: false,
    code: code,
    error: errorMessage
  }));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}
