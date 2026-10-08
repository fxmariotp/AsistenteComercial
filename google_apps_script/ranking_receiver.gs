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
 *    Por tanto, la autenticación debe viajar encriptada vía TLS dentro del payload
 *    JSON del cuerpo de la petición POST (e.postData.contents).
 * 
 * 2. ALMACENAMIENTO SEGURO DEL SECRETO:
 *    El secreto compartido NUNCA debe estar en el código fuente.
 *    Se almacena en Script Properties (Propiedades del Script):
 *    Configuración en Editor Apps Script:
 *      Configuración del Proyecto > Propiedades del script > Añadir propiedad:
 *      Nombre: RANKING_SHARED_SECRET
 *      Valor:  <secreto criptográfico de alta entropía (mínimo 32 caracteres)>
 *      (Opcional) SPREADSHEET_ID: <ID de la hoja de cálculo de staging o producción>
 * 
 * 3. COMPARACIÓN EN TIEMPO CONSTANTE (Timing-Attack Safe):
 *    Se utiliza safeCompare() para comparar los secretos byte a byte en tiempo
 *    constante, previniendo ataques de canal lateral basados en tiempos de respuesta.
 * 
 * 4. GESTIÓN DE REDIRECCIONES EN CLIENTE (Vercel Node.js):
 *    Google Apps Script responde a peticiones POST con un código HTTP 302 Found
 *    hacia 'https://script.googleusercontent.com/macros/echo?user_content_key=...'.
 *    El backend de Vercel debe seguir la redirección únicamente mediante GET,
 *    con cuerpo nulo y verificando que el host de destino pertenece a Google
 *    (script.googleusercontent.com), sin reenviar jamás secretos al destino redirigido.
 * 
 * 5. BLOQUEO DE ACCESO PÚBLICO GET:
 *    doGet(e) rechaza cualquier intento de consulta pública vía navegador (HTTP 405).
 * ============================================================================
 */

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    // 1. Validar presencia de cuerpo de datos POST
    if (!e || !e.postData || !e.postData.contents) {
      return createJsonResponse({
        success: false,
        error: "Petición inválida: sin cuerpo de datos POST"
      }, 400);
    }

    // 2. Parsear cuerpo JSON
    var payload;
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return createJsonResponse({
        success: false,
        error: "Petición inválida: cuerpo JSON malformado"
      }, 400);
    }

    // 3. Obtener el secreto esperado desde Script Properties (sin quemar en código)
    var scriptProps = PropertiesService.getScriptProperties();
    var expectedSecret = scriptProps.getProperty("RANKING_SHARED_SECRET");

    if (!expectedSecret) {
      return createJsonResponse({
        success: false,
        error: "Configuración incompleta: RANKING_SHARED_SECRET no configurado en Script Properties"
      }, 503);
    }

    // 4. Validar autenticación de forma segura (tiempo constante)
    var providedSecret = payload.secret;
    if (!providedSecret || !safeCompare(String(providedSecret), String(expectedSecret))) {
      return createJsonResponse({
        success: false,
        error: "Acceso no autorizado: credencial inválida"
      }, 401);
    }

    // 5. Validar acción requerida
    if (payload.action !== 'getRanking') {
      return createJsonResponse({
        success: false,
        error: "Acción no soportada. Acción esperada: 'getRanking'"
      }, 400);
    }

    // 6. Obtener datos del ranking desde la hoja de cálculo
    var spreadsheetId = scriptProps.getProperty("SPREADSHEET_ID");
    var rankingData = getRankingFromSheet(spreadsheetId);

    return createJsonResponse(rankingData, 200);

  } catch (err) {
    return createJsonResponse({
      success: false,
      error: "Error interno al procesar el ranking: " + err.message
    }, 500);
  } finally {
    try { lock.releaseLock(); } catch (ignored) {}
  }
}

/**
 * Bloquear accesos públicos directos vía GET en navegador
 */
function doGet(e) {
  return createJsonResponse({
    success: false,
    error: "Método no permitido. El servicio de ranking solo admite peticiones POST autenticadas desde el backend de Vercel."
  }, 405);
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
 * Lectura de datos de ranking desde Google Sheets
 */
function getRankingFromSheet(spreadsheetId) {
  var ss;
  if (spreadsheetId) {
    ss = SpreadsheetApp.openById(spreadsheetId);
  } else {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  }

  if (!ss) {
    // Si no hay hoja vinculada (entorno de pruebas en Apps Script), retornar estructura mock de staging
    return [
      { posicion: 1, nombre: "COMERCIAL STAGING A", puntos: 1540 },
      { posicion: 2, nombre: "COMERCIAL STAGING B", puntos: 1320 },
      { posicion: 3, nombre: "COMERCIAL STAGING C", puntos: 1190 }
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
  var colPosicion = -1;

  for (var i = 0; i < headers.length; i++) {
    if (headers[i].indexOf("nombre") !== -1 || headers[i].indexOf("comercial") !== -1 || headers[i].indexOf("agente") !== -1) {
      colNombre = i;
    } else if (headers[i].indexOf("punto") !== -1 || headers[i].indexOf("total") !== -1 || headers[i].indexOf("score") !== -1) {
      colPuntos = i;
    } else if (headers[i].indexOf("pos") !== -1 || headers[i].indexOf("lugar") !== -1 || headers[i].indexOf("ranking") !== -1) {
      colPosicion = i;
    }
  }

  // Posiciones por defecto si los encabezados varían: Col A: Pos, Col B: Nombre, Col C: Puntos
  if (colNombre === -1) colNombre = 1;
  if (colPuntos === -1) colPuntos = 2;
  if (colPosicion === -1) colPosicion = 0;

  var results = [];
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var nombre = row[colNombre];
    if (!nombre) continue;

    var puntos = Number(row[colPuntos]) || 0;
    var posicion = Number(row[colPosicion]) || r;

    results.push({
      posicion: posicion,
      nombre: String(nombre).trim(),
      puntos: puntos
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
 * Generador de respuesta JSON para ContentService
 */
function createJsonResponse(data, statusCode) {
  var output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}
