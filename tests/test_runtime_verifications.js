// ============================================================================
// SUITE DE PRUEBAS DE EJECUCIÓN EN TIEMPO REAL (RUNTIME) - ASISTENTE COMERCIAL
// Archivo: tests/test_runtime_verifications.js
// ============================================================================
// Ejecuta el código real de los módulos para validar:
// 1. Caché disponible y receptor devuelve error 401 -> 401 (sin fallback a 200).
// 2. Caché caducada (> 5 min) y fallo del receptor -> 502 (sin fallback).
//    (Caché fresca <= 5 min y fallo transitorio -> 200 STALE).
// 3. Ausencia de hoja de ranking en Apps Script -> Error 503 explícito (sin fixtures).
// 4. Aprovisionamiento sin argumento --confirm-staging -> Exit code 1 (bloqueo preventivo).
// 5. Validación completa en staging aislado de los 6 usuarios sintéticos y accesos:
//    - Inicio de sesión y consulta de ranking.
//    - Retención por cambio obligatorio pendiente.
//    - Cambio efectivo de contraseña en api/update-password.
//    - Aislamiento y scoping estricto en api/comisiones.
//    - Permisos administrativos de gerente.
//    - Bloqueo de Evaria e Inactivo con HTTP 403.
//    - Denegación de acceso anónimo con HTTP 401.
// ============================================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

let testsPassed = 0;
let testsFailed = 0;

function report(name, condition, details = "") {
  if (condition) {
    console.log(` \x1b[32m[PASS]\x1b[0m ${name}`);
    if (details) console.log(`        \x1b[90m${details}\x1b[0m`);
    testsPassed++;
  } else {
    console.log(` \x1b[31m[FAIL]\x1b[0m ${name}`);
    if (details) console.log(`        \x1b[33m${details}\x1b[0m`);
    testsFailed++;
  }
}

// Helper para crear objetos simulados de request y response compatibles con Vercel
function createMockHttp(options = {}) {
  const headersSent = {};
  const res = {
    statusCode: 200,
    headers: headersSent,
    _jsonData: null,
    _ended: false,
    setHeader(key, value) {
      headersSent[key.toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this._jsonData = data;
      this._ended = true;
      return this;
    },
    end() {
      this._ended = true;
      return this;
    }
  };

  const req = {
    method: options.method || 'GET',
    headers: options.headers !== undefined ? options.headers : {
      'authorization': 'Bearer valid-test-token'
    },
    query: options.query || {},
    body: options.body || null
  };

  return { req, res };
}

console.log("\x1b[36m==================================================================\x1b[0m");
console.log("\x1b[36m PRUEBAS DE EJECUCIÓN REAL (RUNTIME) - ASISTENTE COMERCIAL\x1b[0m");
console.log("\x1b[36m==================================================================\x1b[0m\n");

// Configurar variables de entorno mínimas requeridas por los endpoints de servidor
process.env.SUPABASE_URL = "https://mock-staging.supabase.co";
process.env.SUPABASE_ANON_KEY = "mock-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "mock-service-role-key";
process.env.RANKING_APPS_SCRIPT_URL = "https://script.google.com/macros/s/mock-script/exec";
process.env.RANKING_SHARED_SECRET = "mock-secret-64-chars-very-safe-and-entropy-long";
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "mock-sa@project.iam.gserviceaccount.com";
process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC...\n-----END PRIVATE KEY-----\n";
process.env.GOOGLE_SHEET_ID = "mock-google-sheet-id";

const apiRanking = require('../api/ranking');
const apiComisiones = require('../api/comisiones');
const apiUpdatePassword = require('../api/update-password');
const apiGerenteCredentials = require('../api/gerente-credentials');

// ----------------------------------------------------------------------------
// CASO 1: Caché disponible y receptor devuelve error 401
// ----------------------------------------------------------------------------
console.log("\x1b[37m=== CASO 1: Caché disponible y receptor devuelve error 401 ===\x1b[0m");

(function testCacheAvailableAndReceiver401() {
  apiRanking._setVerifySupabaseTokenForTesting((token, cb) => {
    cb(null, { id: 'user-comercial-1', email: '00000001a@asistente.internal' });
  });
  apiRanking._setFetchUserProfileForTesting((token, user, cb) => {
    cb(null, {
      dni: '00000001A',
      nombre: 'COMERCIAL TEST A',
      rol: 'comercial',
      activo: true,
      must_change_password: false
    });
  });

  // Sembrar la caché con datos válidos existentes
  const cachedRanking = [{ posicion: 1, nombre: "COMERCIAL CACHED", puntos: 500, objetivo: 16, pendientes: 0 }];
  apiRanking.setMemoryCache(cachedRanking, Date.now() - 10000); // Hace 10s

  // Simular que Apps Script responde con error explícito de autorización 401
  apiRanking._setFetchPrivateRankingForTesting((url, secret, cb) => {
    cb(new Error("APPS_SCRIPT_ERROR:401:Acceso no autorizado: credencial inválida"));
  });

  const { req, res } = createMockHttp({ query: { force: 'true' } });
  apiRanking(req, res);

  const statusIs401 = res.statusCode === 401;
  const noDataReturned = !Array.isArray(res._jsonData);
  const errorMatches = res._jsonData && res._jsonData.code === 401 && res._jsonData.success === false;

  report(
    "Receptor devuelve error 401 -> api/ranking responde HTTP 401 sin fallback a caché",
    statusIs401 && noDataReturned && errorMatches,
    `Status recibido: ${res.statusCode} (esperado 401) | Payload: ${JSON.stringify(res._jsonData)}`
  );
})();

// ----------------------------------------------------------------------------
// CASO 2: Caché caducada (> 5 min) y fallo del receptor
// ----------------------------------------------------------------------------
console.log("\n\x1b[37m=== CASO 2: Caché caducada y fallo del receptor ===\x1b[0m");

(function testCacheExpiredAndReceiverFails() {
  // Sembrar la caché con datos caducados (6 minutos de antigüedad, superando MAX_STALE_CACHE_MS = 5 min)
  const staleData = [{ posicion: 1, nombre: "COMERCIAL ANTIGUO", puntos: 100, objetivo: 16, pendientes: 0 }];
  const sixMinutesAgo = Date.now() - (6 * 60 * 1000);
  apiRanking.setMemoryCache(staleData, sixMinutesAgo);

  // Simular fallo transitorio de red (timeout / socket hangup)
  apiRanking._setFetchPrivateRankingForTesting((url, secret, cb) => {
    cb(new Error("ETIMEDOUT: upstream connection timed out"));
  });

  const { req, res } = createMockHttp({ query: { force: 'true' } });
  apiRanking(req, res);

  const statusIs502 = res.statusCode === 502;
  const noStaleDataReturned = !Array.isArray(res._jsonData);
  const errorIs502 = res._jsonData && res._jsonData.code === 502 && res._jsonData.success === false;

  report(
    "Caché caducada (> 5 min) con fallo transitorio -> api/ranking responde HTTP 502 (sin fallback caducado)",
    statusIs502 && noStaleDataReturned && errorIs502,
    `Status recibido: ${res.statusCode} (esperado 502) | Payload: ${JSON.stringify(res._jsonData)}`
  );
})();

(function testCacheWithinStaleLimitReturnsStale() {
  // Sembrar la caché con datos de 2 minutos de antigüedad (dentro del límite de 5 min)
  const staleData = [{ posicion: 1, nombre: "COMERCIAL SEMI-FRESCO", puntos: 200, objetivo: 16, pendientes: 0 }];
  const twoMinutesAgo = Date.now() - (2 * 60 * 1000);
  apiRanking.setMemoryCache(staleData, twoMinutesAgo);

  apiRanking._setFetchPrivateRankingForTesting((url, secret, cb) => {
    cb(new Error("ECONNRESET: connection reset by peer"));
  });

  const { req, res } = createMockHttp({ query: {} });
  apiRanking(req, res);

  const statusIs200 = res.statusCode === 200;
  const dataReturned = Array.isArray(res._jsonData) && res._jsonData[0].nombre === "COMERCIAL SEMI-FRESCO";
  const headerStale = res.headers['x-cache-status'] === 'STALE';
  const headerFallback = res.headers['x-cache-fallback'] === 'true';
  const headerWarning = Boolean(res.headers['warning'] && res.headers['warning'].includes('110'));

  report(
    "Caché dentro del límite transitorio (<= 5 min) -> api/ranking entrega caché marcada como STALE",
    statusIs200 && dataReturned && headerStale && headerFallback && headerWarning,
    `Status: ${res.statusCode} | X-Cache-Status: ${res.headers['x-cache-status']} | Warning: ${res.headers['warning']}`
  );
})();

(function testRecentCacheWithInvalidFormatReturns502Never200() {
  // Sembrar la memoria con caché reciente (1 minuto de antigüedad: dentro de los 5 min de fallback pero fuera de los 30s de HIT directo)
  const freshData = [{ posicion: 1, nombre: "COMERCIAL CACHE RECIENTE", puntos: 999, objetivo: 16, pendientes: 0 }];
  const oneMinuteAgo = Date.now() - (60 * 1000);
  apiRanking.setMemoryCache(freshData, oneMinuteAgo);

  // Simular error no transitorio de formato de respuesta inválido (p.ej. schema corrupto de Apps Script)
  apiRanking._setFetchPrivateRankingForTesting((url, secret, cb) => {
    cb(new apiRanking.RankingError("Formato de respuesta de ranking no válido", {
      category: apiRanking.ERROR_CATEGORIES.INVALID_FORMAT,
      isTransient: false,
      httpStatus: 502
    }));
  });

  // Petición estándar (sin force=true) donde un fallo transitorio sí dispararía fallback
  const { req, res } = createMockHttp({ query: {} });
  apiRanking(req, res);

  const statusIs502 = res.statusCode === 502;
  const never200 = res.statusCode !== 200;
  const noCachedDataReturned = !Array.isArray(res._jsonData);
  const errorMatches = res._jsonData &&
                       res._jsonData.success === false &&
                       res._jsonData.code === 502 &&
                       res._jsonData.category === apiRanking.ERROR_CATEGORIES.INVALID_FORMAT;

  report(
    "Caché reciente y respuesta de formato inválido -> responde HTTP 502 (NUNCA 200 ni fallback)",
    statusIs502 && never200 && noCachedDataReturned && errorMatches,
    `Status recibido: ${res.statusCode} (esperado 502, nunca 200) | Categoría: ${res._jsonData?.category}`
  );
})();

(function testRecentCacheWithInvalidJsonReturns502Never200() {
  // Sembrar la memoria con caché reciente (1 minuto de antigüedad)
  const freshData = [{ posicion: 1, nombre: "COMERCIAL CACHE RECIENTE", puntos: 888, objetivo: 16, pendientes: 0 }];
  const oneMinuteAgo = Date.now() - (60 * 1000);
  apiRanking.setMemoryCache(freshData, oneMinuteAgo);

  // Simular error no transitorio de JSON malformado
  apiRanking._setFetchPrivateRankingForTesting((url, secret, cb) => {
    cb(new apiRanking.RankingError("Error parseando respuesta JSON de Google Apps Script: Unexpected token <", {
      category: apiRanking.ERROR_CATEGORIES.INVALID_JSON,
      isTransient: false,
      httpStatus: 502
    }));
  });

  const { req, res } = createMockHttp({ query: {} });
  apiRanking(req, res);

  const statusIs502 = res.statusCode === 502;
  const never200 = res.statusCode !== 200;
  const noCachedDataReturned = !Array.isArray(res._jsonData);
  const errorMatches = res._jsonData &&
                       res._jsonData.success === false &&
                       res._jsonData.code === 502 &&
                       res._jsonData.category === apiRanking.ERROR_CATEGORIES.INVALID_JSON;

  report(
    "Caché reciente y JSON inválido -> responde HTTP 502 (NUNCA 200 ni fallback)",
    statusIs502 && never200 && noCachedDataReturned && errorMatches,
    `Status recibido: ${res.statusCode} (esperado 502, nunca 200) | Categoría: ${res._jsonData?.category}`
  );
})();

// ----------------------------------------------------------------------------
// CASO 3: Ausencia de hoja de ranking en Google Apps Script
// ----------------------------------------------------------------------------
console.log("\n\x1b[37m=== CASO 3: Ausencia de hoja de ranking en Apps Script ===\x1b[0m");

(function testAbsenceOfRankingSheet() {
  const gasCode = fs.readFileSync(path.resolve(__dirname, '../google_apps_script/ranking_receiver.gs'), 'utf8');

  const sandbox = {
    SpreadsheetApp: {
      openById: () => null,
      getActiveSpreadsheet: () => null
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => {
          if (key === 'RANKING_SHARED_SECRET') return 'test-secret';
          if (key === 'SPREADSHEET_ID') return 'sheet-id-no-existente';
          return null;
        }
      })
    },
    LockService: {
      getScriptLock: () => ({
        releaseLock: () => {}
      })
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (content) => ({
        _content: content,
        setMimeType: () => {},
        getContent: () => content
      })
    },
    console: console
  };

  vm.createContext(sandbox);
  vm.runInContext(gasCode, sandbox);

  // 1. Probar getRankingFromSheet directamente con hoja inexistente
  const resultFromSheet = sandbox.getRankingFromSheet("sheet-id-no-existente");
  const isErrorObject = resultFromSheet && resultFromSheet.error && resultFromSheet.code === 503;
  const noMockFixtures = !Array.isArray(resultFromSheet);

  report(
    "getRankingFromSheet sin hoja vinculada -> retorna objeto con error 503 (cero fixtures ficticias)",
    isErrorObject && noMockFixtures,
    `Resultado: ${JSON.stringify(resultFromSheet)}`
  );

  // 2. Probar doPost(e) con credencial correcta pero hoja ausente
  const postEvent = {
    postData: {
      contents: JSON.stringify({
        action: 'getRanking',
        secret: 'test-secret'
      })
    }
  };

  const doPostOutput = sandbox.doPost(postEvent);
  const parsedPost = JSON.parse(doPostOutput.getContent());

  const doPostReturns503 = parsedPost.ok === false && parsedPost.code === 503;
  const messageIndicatesMissingSheet = parsedPost.error.includes("no vinculada o no disponible");

  report(
    "doPost(e) sin hoja vinculada -> emite respuesta { ok: false, code: 503 } sin fixtures de prueba",
    doPostReturns503 && messageIndicatesMissingSheet,
    `Respuesta doPost: ${JSON.stringify(parsedPost)}`
  );
})();

// ----------------------------------------------------------------------------
// CASO 4: Aprovisionamiento sin argumento de confirmación
// ----------------------------------------------------------------------------
console.log("\n\x1b[37m=== CASO 4: Aprovisionamiento sin argumento de confirmacion ===\x1b[0m");

(function testProvisioningWithoutConfirmStaging() {
  const scriptPath = path.resolve(__dirname, '../scripts/provision_identities.js');

  // Ejecución 1: Sin argumentos (incluso pasando NODE_ENV=staging)
  const runWithoutArg = spawnSync(process.execPath, [scriptPath], {
    env: Object.assign({}, process.env, {
      NODE_ENV: 'staging',
      SUPABASE_URL: 'https://staging.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'secret-key'
    }),
    encoding: 'utf8'
  });

  const exitCodeIs1 = runWithoutArg.status === 1;
  const stderrMentionsFlag = (runWithoutArg.stderr || '').includes('--confirm-staging') || (runWithoutArg.stdout || '').includes('--confirm-staging');
  const preventsExecution = (runWithoutArg.stderr || '').includes('[BLOQUEO PREVENTIVO]');

  report(
    "provision_identities.js sin --confirm-staging -> detiene con Exit Code 1 y mensaje preventivo",
    exitCodeIs1 && stderrMentionsFlag && preventsExecution,
    `Exit code: ${runWithoutArg.status} | Contiene aviso de bloqueo preventivo: ${preventsExecution}`
  );

  // Ejecución 2: Con --confirm-staging pero URL destino no coincide con el staging configurado
  const runWithMismatchedUrl = spawnSync(process.execPath, [scriptPath, '--confirm-staging'], {
    env: Object.assign({}, process.env, {
      SUPABASE_URL: 'https://mismatched-project.supabase.co',
      EXPECTED_STAGING_URL: 'https://real-staging-target.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'secret-key'
    }),
    encoding: 'utf8'
  });

  const exitCodeMismatchedIs1 = runWithMismatchedUrl.status === 1;
  const mentionsDiscrepancy = (runWithMismatchedUrl.stderr || '').includes('DISCREPANCIA EN EL DESTINO DE STAGING');

  report(
    "provision_identities.js con URL no coincidente -> aborta con Exit Code 1 por discrepancia de destino",
    exitCodeMismatchedIs1 && mentionsDiscrepancy,
    `Exit code: ${runWithMismatchedUrl.status} | Detecta discrepancia de destino antes de escribir: ${mentionsDiscrepancy}`
  );
})();

// ----------------------------------------------------------------------------
// CASO 5: Validación completa en staging aislado de los 6 perfiles sintéticos
// ----------------------------------------------------------------------------
console.log("\n\x1b[37m=== CASO 5: Validación completa de perfiles en staging aislado ===\x1b[0m");

(function testStagingIdentitiesScenarios() {
  const STAGING_USERS = [
    { dni: "00000001A", nombre: "COMERCIAL TEST A", rol: "comercial", activo: true, must_change: false },
    { dni: "00000002B", nombre: "COMERCIAL TEST B", rol: "comercial", activo: true, must_change: false },
    { dni: "00000003G", nombre: "GERENTE TEST", rol: "gerente", activo: true, must_change: false },
    { dni: "00000004E", nombre: "EVARIA TEST", rol: "evaria", activo: true, must_change: false },
    { dni: "00000005I", nombre: "INACTIVO TEST", rol: "comercial", activo: false, must_change: false },
    { dni: "00000006X", nombre: "CAMBIO PENDIENTE TEST", rol: "comercial", activo: true, must_change: true }
  ];

  // Datos simulados de hoja de comisiones para pruebas de scoping
  const sampleSheetRows = [
    ["AGENTE", "COMI"],
    ["COMERCIAL TEST A", "350.50"],
    ["COMERCIAL TEST B", "420.00"],
    ["GERENTE TEST", "0.00"]
  ];

  function setupAuth(user) {
    const authFn = (token, cb) => {
      if (token === 'anon' || !token) return cb(new Error("Token inválido"));
      cb(null, { id: 'uid-' + user.dni, email: user.dni.toLowerCase() + '@asistente.internal' });
    };
    const profileFn = (token, u, cb) => {
      cb(null, {
        dni: user.dni,
        nombre: user.nombre,
        rol: user.rol,
        activo: user.activo,
        must_change_password: user.must_change
      });
    };

    apiRanking._setVerifySupabaseTokenForTesting(authFn);
    apiRanking._setFetchUserProfileForTesting(profileFn);
    apiRanking._setFetchPrivateRankingForTesting((url, secret, cb) => {
      cb(null, [
        { posicion: 1, nombre: "COMERCIAL TEST A", puntos: 1540, objetivo: 16, pendientes: 2 },
        { posicion: 2, nombre: "COMERCIAL TEST B", puntos: 1320, objetivo: 16, pendientes: 0 }
      ]);
    });

    apiComisiones._setVerifySupabaseTokenForTesting(authFn);
    apiComisiones._setFetchUserProfileForTesting((token, u, cb) => {
      // Para comisiones u es el usuario devuelto por verifySupabaseToken
      cb(null, {
        dni: user.dni,
        nombre: user.nombre,
        rol: user.rol,
        activo: user.activo,
        must_change_password: user.must_change
      });
    });
    apiComisiones._setGetGoogleAccessTokenForTesting((email, key, cb) => cb(null, "mock-access-token"));
    apiComisiones._setFetchPrivateSheetValuesForTesting((token, sheetId, cb) => cb(null, sampleSheetRows));
  }

  // 5.1 Comercial Activo (00000001A): Ranking permitido y Scoping estricto de comisiones
  setupAuth(STAGING_USERS[0]);
  apiRanking.resetMemoryCache();
  const c1Rk = createMockHttp();
  apiRanking(c1Rk.req, c1Rk.res);

  const c1Com = createMockHttp();
  apiComisiones(c1Com.req, c1Com.res);

  report(
    "Comercial Activo (00000001A) -> Acceso permitido a ranking y comisión propia aislada (350.5)",
    c1Rk.res.statusCode === 200 && c1Com.res.statusCode === 200 && c1Com.res._jsonData.comision === 350.5 && c1Com.res._jsonData.isGerente === false,
    `Comisión: ${c1Com.res._jsonData ? c1Com.res._jsonData.comision : null} | isGerente: ${c1Com.res._jsonData ? c1Com.res._jsonData.isGerente : null}`
  );

  // 5.2 Aislamiento entre Comerciales (00000002B no ve la comisión de 00000001A)
  setupAuth(STAGING_USERS[1]);
  const c2Com = createMockHttp();
  apiComisiones(c2Com.req, c2Com.res);

  const c2Data = c2Com.res._jsonData || {};
  const c2Isolated = c2Com.res.statusCode === 200 && c2Data.comision === 420.0 && c2Data.dni === "00000002B" && !c2Data.data;

  report(
    "Aislamiento entre Comerciales -> 00000002B recibe solo su comisión (420.0) y no accede a mapa de equipo",
    c2Isolated,
    `Comisión 00000002B: ${c2Data.comision} | No expone comisionesMap: ${!c2Data.data}`
  );

  // 5.3 Gerente (00000003G): Acceso a ranking y mapa consolidado de comisiones
  setupAuth(STAGING_USERS[2]);
  apiRanking.resetMemoryCache();
  const gRk = createMockHttp();
  apiRanking(gRk.req, gRk.res);

  const gCom = createMockHttp();
  apiComisiones(gCom.req, gCom.res);

  const gData = gCom.res._jsonData || {};
  const gAuthorized = gRk.res.statusCode === 200 && gCom.res.statusCode === 200 && gData.isGerente === true && Boolean(gData.data);

  report(
    "Gerente (00000003G) -> Acceso a ranking de equipo y comisiones consolidadas (isGerente=true)",
    gAuthorized,
    `Ranking: HTTP ${gRk.res.statusCode} | Comisiones: HTTP ${gCom.res.statusCode} | isGerente: ${gData.isGerente}`
  );

  // 5.4 Evaria (00000004E): Bloqueado en ranking y comisiones con HTTP 403
  setupAuth(STAGING_USERS[3]);
  const eRk = createMockHttp();
  apiRanking(eRk.req, eRk.res);

  const eCom = createMockHttp();
  apiComisiones(eCom.req, eCom.res);

  const evariaBlocked = eRk.res.statusCode === 403 && eCom.res.statusCode === 403;
  report(
    "Evaria (00000004E) -> Acceso denegado con HTTP 403 Forbidden en Ranking y Comisiones",
    evariaBlocked,
    `Ranking: HTTP ${eRk.res.statusCode} | Comisiones: HTTP ${eCom.res.statusCode}`
  );

  // 5.5 Inactivo (00000005I): Bloqueado con HTTP 403 (cuenta desactivada)
  setupAuth(STAGING_USERS[4]);
  const iRk = createMockHttp();
  apiRanking(iRk.req, iRk.res);

  const iCom = createMockHttp();
  apiComisiones(iCom.req, iCom.res);

  const inactiveBlocked = iRk.res.statusCode === 403 && iCom.res.statusCode === 403;
  report(
    "Inactivo (00000005I) -> Cuenta desactivada rechazada con HTTP 403 Forbidden",
    inactiveBlocked,
    `Ranking: HTTP ${iRk.res.statusCode} | Comisiones: HTTP ${iCom.res.statusCode}`
  );

  // 5.6 Cambio pendiente (00000006X): Bloqueado en recursos y cambio efectivo en api/update-password
  setupAuth(STAGING_USERS[5]);
  const mRk = createMockHttp();
  apiRanking(mRk.req, mRk.res);

  const mCom = createMockHttp();
  apiComisiones(mCom.req, mCom.res);

  const changeBlocked = mRk.res.statusCode === 403 && mRk.res._jsonData.mustChangePassword === true &&
                        mCom.res.statusCode === 403 && mCom.res._jsonData.mustChangePassword === true;

  report(
    "Cambio pendiente (00000006X) -> Bloqueado en ranking y comisiones con mustChangePassword=true",
    changeBlocked,
    `Ranking: HTTP ${mRk.res.statusCode} | Comisiones: HTTP ${mCom.res.statusCode}`
  );

  // 5.7 Cambio efectivo de contraseña para 00000006X vía api/update-password
  let updatedAuthPassword = null;
  let dbRestrictionLifted = false;

  apiUpdatePassword._setVerifySupabaseTokenForTesting((token, cb) => {
    cb(null, { id: 'uid-00000006X', email: '00000006x@asistente.internal' });
  });
  apiUpdatePassword._setFetchUserProfileForTesting((userId, cb) => {
    cb(null, {
      dni: '00000006X',
      nombre: 'CAMBIO PENDIENTE TEST',
      rol: 'comercial',
      activo: true,
      must_change_password: true
    });
  });
  apiUpdatePassword._setUpdateSupabaseAuthPasswordForTesting((userId, newPass, cb) => {
    updatedAuthPassword = newPass;
    cb(null);
  });
  apiUpdatePassword._setLiftRestrictionInDatabaseForTesting((userId, cb) => {
    dbRestrictionLifted = true;
    cb(null, {
      dni: '00000006X',
      rol: 'comercial',
      must_change_password: false
    });
  });

  // Intento 1: Misma contraseña que DNI -> Debe fallar con HTTP 400
  const badPwdHttp = createMockHttp({
    method: 'POST',
    body: { newPassword: '00000006X' }
  });
  apiUpdatePassword(badPwdHttp.req, badPwdHttp.res);
  const rejectsDniPassword = badPwdHttp.res.statusCode === 400;

  report(
    "api/update-password -> Rechaza contraseña idéntica al DNI con HTTP 400",
    rejectsDniPassword,
    `Status: ${badPwdHttp.res.statusCode} | Error: ${badPwdHttp.res._jsonData ? badPwdHttp.res._jsonData.error : null}`
  );

  // Verificaciones específicas para usuario 78105180D (FRANCISCO JAVIER AGUILAR CHAVES)
  apiUpdatePassword._setVerifySupabaseTokenForTesting((token, cb) => {
    cb(null, { id: 'uid-78105180D', email: '78105180d@asistente.internal' });
  });
  apiUpdatePassword._setFetchUserProfileForTesting((userId, cb) => {
    cb(null, {
      dni: '78105180D',
      nombre: 'FRANCISCO JAVIER AGUILAR CHAVES',
      rol: 'comercial',
      activo: true,
      must_change_password: true
    });
  });

  // Caso 1: Rechazo de DNI mayúsculas exacto (78105180D)
  const reqDniUpper = createMockHttp({ method: 'POST', body: { newPassword: '78105180D', confirmPassword: '78105180D' } });
  apiUpdatePassword(reqDniUpper.req, reqDniUpper.res);
  report(
    "api/update-password -> Rechaza 78105180D (DNI exacto mayúsculas) con HTTP 400",
    reqDniUpper.res.statusCode === 400,
    `Status: ${reqDniUpper.res.statusCode} | Error: ${reqDniUpper.res._jsonData?.error}`
  );

  // Caso 2: Rechazo de DNI minúsculas (78105180d)
  const reqDniLower = createMockHttp({ method: 'POST', body: { newPassword: '78105180d', confirmPassword: '78105180d' } });
  apiUpdatePassword(reqDniLower.req, reqDniLower.res);
  report(
    "api/update-password -> Rechaza 78105180d (DNI en minúsculas) con HTTP 400",
    reqDniLower.res.statusCode === 400,
    `Status: ${reqDniLower.res.statusCode} | Error: ${reqDniLower.res._jsonData?.error}`
  );

  // Caso 3: Rechazo de números del DNI sin la letra (78105180)
  const reqDniDigits = createMockHttp({ method: 'POST', body: { newPassword: '78105180', confirmPassword: '78105180' } });
  apiUpdatePassword(reqDniDigits.req, reqDniDigits.res);
  report(
    "api/update-password -> Rechaza 78105180 (números sin letra) con HTTP 400",
    reqDniDigits.res.statusCode === 400,
    `Status: ${reqDniDigits.res.statusCode} | Error: ${reqDniDigits.res._jsonData?.error}`
  );

  // Caso 4: Rechazo de longitud inferior al límite técnico de 6 caracteres (ej. '12345')
  const reqShortPwd = createMockHttp({ method: 'POST', body: { newPassword: '12345', confirmPassword: '12345' } });
  apiUpdatePassword(reqShortPwd.req, reqShortPwd.res);
  report(
    "api/update-password -> Rechaza longitud inferior a 6 caracteres con HTTP 400",
    reqShortPwd.res.statusCode === 400,
    `Status: ${reqShortPwd.res.statusCode} | Error: ${reqShortPwd.res._jsonData?.error}`
  );

  // Caso 5: Rechazo de confirmación que no coincide
  const reqMismatchPwd = createMockHttp({ method: 'POST', body: { newPassword: 'simpletodo6', confirmPassword: 'otraPassword' } });
  apiUpdatePassword(reqMismatchPwd.req, reqMismatchPwd.res);
  report(
    "api/update-password -> Rechaza confirmación discordante con HTTP 400",
    reqMismatchPwd.res.statusCode === 400,
    `Status: ${reqMismatchPwd.res.statusCode} | Error: ${reqMismatchPwd.res._jsonData?.error}`
  );

  // Caso 6: Aceptación de contraseña válida sin composición (ej. 'simpletodo6', sin mayúsculas/números/símbolos obligatorios)
  let updatedAguilarPassword = null;
  let dbRestrictionAguilarLifted = false;
  apiUpdatePassword._setUpdateSupabaseAuthPasswordForTesting((userId, newPass, cb) => {
    updatedAguilarPassword = newPass;
    cb(null);
  });
  apiUpdatePassword._setLiftRestrictionInDatabaseForTesting((userId, cb) => {
    dbRestrictionAguilarLifted = true;
    cb(null, { dni: '78105180D', rol: 'comercial', must_change_password: false });
  });

  const reqValidSimple = createMockHttp({ method: 'POST', body: { newPassword: 'simpletodo6', confirmPassword: 'simpletodo6' } });
  apiUpdatePassword(reqValidSimple.req, reqValidSimple.res);
  const simpleSuccess = reqValidSimple.res.statusCode === 200 &&
                        reqValidSimple.res._jsonData?.success === true &&
                        updatedAguilarPassword === 'simpletodo6' &&
                        dbRestrictionAguilarLifted === true;
  report(
    "api/update-password -> Acepta contraseña válida sin composición ('simpletodo6') con HTTP 200",
    simpleSuccess,
    `Status: ${reqValidSimple.res.statusCode} | Desbloqueado: ${dbRestrictionAguilarLifted}`
  );

  // Intento 2: Nueva contraseña válida para 00000006X -> Debe actualizar en Auth y levantar restricción en BD
  apiUpdatePassword._setVerifySupabaseTokenForTesting((token, cb) => {
    cb(null, { id: 'uid-00000006X', email: '00000006x@asistente.internal' });
  });
  apiUpdatePassword._setFetchUserProfileForTesting((userId, cb) => {
    cb(null, {
      dni: '00000006X',
      nombre: 'CAMBIO PENDIENTE TEST',
      rol: 'comercial',
      activo: true,
      must_change_password: true
    });
  });
  apiUpdatePassword._setUpdateSupabaseAuthPasswordForTesting((userId, newPass, cb) => {
    updatedAuthPassword = newPass;
    cb(null);
  });
  apiUpdatePassword._setLiftRestrictionInDatabaseForTesting((userId, cb) => {
    dbRestrictionLifted = true;
    cb(null, {
      dni: '00000006X',
      rol: 'comercial',
      must_change_password: false
    });
  });
  const goodPwdHttp = createMockHttp({
    method: 'POST',
    body: { newPassword: 'MiNuevoPasswordSeguro2026!' }
  });
  apiUpdatePassword(goodPwdHttp.req, goodPwdHttp.res);

  const pwdChangeSuccess = goodPwdHttp.res.statusCode === 200 &&
                           goodPwdHttp.res._jsonData &&
                           goodPwdHttp.res._jsonData.success === true &&
                           goodPwdHttp.res._jsonData.profile.mustChangePassword === false &&
                           updatedAuthPassword === 'MiNuevoPasswordSeguro2026!' &&
                           dbRestrictionLifted === true;

  report(
    "api/update-password -> Actualiza contraseña en Auth y levanta must_change_password en BD (HTTP 200)",
    pwdChangeSuccess,
    `Status: ${goodPwdHttp.res.statusCode} | mustChangePassword en BD: ${goodPwdHttp.res._jsonData?.profile?.mustChangePassword}`
  );

  // 5.8 Acceso anónimo o sin token: Rechazado en todos los endpoints con HTTP 401
  const anonRk = createMockHttp({ headers: {} });
  apiRanking(anonRk.req, anonRk.res);

  const anonCom = createMockHttp({ headers: {} });
  apiComisiones(anonCom.req, anonCom.res);

  const anonPwd = createMockHttp({ method: 'POST', headers: {}, body: { newPassword: 'pass' } });
  apiUpdatePassword(anonPwd.req, anonPwd.res);

  const anonRejected = anonRk.res.statusCode === 401 &&
                       anonCom.res.statusCode === 401 &&
                       anonPwd.res.statusCode === 401;

  report(
    "Acceso anónimo (sin sesión) -> Denegado con HTTP 401 en Ranking, Comisiones y Update-Password",
    anonRejected,
    `Ranking: ${anonRk.res.statusCode} | Comisiones: ${anonCom.res.statusCode} | UpdatePwd: ${anonPwd.res.statusCode}`
  );
})();

// ----------------------------------------------------------------------------
// CASO 6: Alta y correspondencias de FRANCISCO JAVIER AGUILAR CHAVES (78105180D)
// ----------------------------------------------------------------------------
console.log("\n\x1b[37m=== CASO 6: Alta y correspondencias de FRANCISCO JAVIER AGUILAR CHAVES ===\x1b[0m");

(function testAltaAguilarChaves() {
  const sheetRows = [
    ["AGENTE", "COMI"],
    ["FRANCISCO JAVIER MORA ANDREU", "510.00"],
    ["FRANCISCO JAVIER AGUILAR CHAVES", "640.50"],
    ["COMERCIAL TEST A", "350.50"]
  ];

  // 6.1 Desambiguación y emparejamiento exacto de comisiones
  apiComisiones._setVerifySupabaseTokenForTesting((token, cb) => {
    cb(null, { id: 'uid-78105180D', email: '78105180d@asistente.internal' });
  });
  apiComisiones._setFetchUserProfileForTesting((token, u, cb) => {
    cb(null, {
      dni: '78105180D',
      nombre: 'FRANCISCO JAVIER AGUILAR CHAVES',
      rol: 'comercial',
      activo: true,
      must_change_password: false
    });
  });
  apiComisiones._setGetGoogleAccessTokenForTesting((email, key, cb) => cb(null, "mock-token"));
  apiComisiones._setFetchPrivateSheetValuesForTesting((token, sheetId, cb) => cb(null, sheetRows));

  const reqAguilar = createMockHttp();
  apiComisiones(reqAguilar.req, reqAguilar.res);

  const dataAguilar = reqAguilar.res._jsonData || {};
  const matchesAguilar = reqAguilar.res.statusCode === 200 &&
                         dataAguilar.isGerente === false &&
                         dataAguilar.dni === "78105180D" &&
                         dataAguilar.comision === 640.50;

  report(
    "FRANCISCO JAVIER AGUILAR CHAVES (78105180D) -> Emparejamiento correcto en comisiones (640.50 €) e isGerente=false",
    matchesAguilar,
    `Comisión: ${dataAguilar.comision} | DNI: ${dataAguilar.dni} | isGerente: ${dataAguilar.isGerente}`
  );

  // 6.2 Desambiguación: MORA ANDREU no colisiona y recibe su propia comisión
  apiComisiones._setVerifySupabaseTokenForTesting((token, cb) => {
    cb(null, { id: 'uid-53770728V', email: '53770728v@asistente.internal' });
  });
  apiComisiones._setFetchUserProfileForTesting((token, u, cb) => {
    cb(null, {
      dni: '53770728V',
      nombre: 'FRANCISCO JAVIER MORA ANDREU',
      rol: 'comercial',
      activo: true,
      must_change_password: false
    });
  });

  const reqMora = createMockHttp();
  apiComisiones(reqMora.req, reqMora.res);

  const dataMora = reqMora.res._jsonData || {};
  const matchesMora = reqMora.res.statusCode === 200 &&
                      dataMora.isGerente === false &&
                      dataMora.dni === "53770728V" &&
                      dataMora.comision === 510.00;

  report(
    "Desambiguación Francisco Javier -> MORA ANDREU (53770728V) recibe 510.00 € sin colisión con AGUILAR CHAVES",
    matchesMora,
    `Comisión Mora: ${dataMora.comision} | DNI: ${dataMora.dni}`
  );

  // 6.3 Script provision_alta_aguilar.js bloquea si faltan variables de entorno
  const scriptPath = path.resolve(__dirname, '../scripts/provision_alta_aguilar.js');
  const runNoEnv = spawnSync(process.execPath, [scriptPath], {
    env: Object.assign({}, process.env, {
      SUPABASE_URL: '',
      SUPABASE_SERVICE_ROLE_KEY: ''
    }),
    encoding: 'utf8'
  });

  const blocksWithoutEnv = runNoEnv.status === 1 && (runNoEnv.stderr || '').includes('[BLOQUEO DE ENTORNO]');
  report(
    "provision_alta_aguilar.js -> Bloquea con Exit Code 1 si faltan variables administrativas de servidor",
    blocksWithoutEnv,
    `Exit code: ${runNoEnv.status} | Bloqueo preventivo: ${blocksWithoutEnv}`
  );

  // 6.4 Script provision_alta_aguilar.js bloquea con Exit Code 2 ante esquema destino no migrado (sin agentes_perfiles)
  const runLegacyDest = spawnSync(process.execPath, [scriptPath], {
    env: Object.assign({}, process.env, {
      SUPABASE_URL: 'https://bxgdtdzlijeaetlekbub.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'sb_publishable_DlLT2Rz1npEXSuxpM9__tQ_WF-Q0-Ap'
    }),
    encoding: 'utf8'
  });

  const blocksLegacy = runLegacyDest.status === 2 && (runLegacyDest.stderr || '').includes('[BLOQUEO TÉCNICO] ESQUEMA DESTINO NO COMPATIBLE');
  report(
    "provision_alta_aguilar.js -> Bloquea con Exit Code 2 ante base no migrada (protege contra contraseñas en texto plano)",
    blocksLegacy,
    `Exit code: ${runLegacyDest.status} | Detección de esquema incompatible: ${blocksLegacy}`
  );
})();

// ----------------------------------------------------------------------------
// CASO 7: Consulta autorizada de credenciales para Gerencia (api/gerente-credentials)
// ----------------------------------------------------------------------------
console.log("\n\x1b[37m=== CASO 7: Consulta autorizada de credenciales para Gerencia (api/gerente-credentials) ===\x1b[0m");

(function testGerenteCredentialsEndpoint() {
  // 7.1 Acceso anónimo denegado con HTTP 401
  const anonHttp = createMockHttp({ headers: {} });
  apiGerenteCredentials(anonHttp.req, anonHttp.res);
  report(
    "api/gerente-credentials -> Denegado con HTTP 401 para petición sin token",
    anonHttp.res.statusCode === 401,
    `Status: ${anonHttp.res.statusCode} | Error: ${anonHttp.res._jsonData?.error}`
  );

  // 7.2 Acceso de Comercial denegado con HTTP 403
  apiGerenteCredentials._setVerifySupabaseTokenForTesting((token, cb) => {
    cb(null, { id: 'user-comercial-1', email: 'comercial@asistente.internal' });
  });
  apiGerenteCredentials._setFetchUserProfileForTesting((userId, cb) => {
    cb(null, {
      id: 'p-1',
      dni: '00000001A',
      nombre: 'COMERCIAL TEST',
      rol: 'comercial',
      activo: true,
      must_change_password: false
    });
  });

  const comercialHttp = createMockHttp();
  apiGerenteCredentials(comercialHttp.req, comercialHttp.res);
  report(
    "api/gerente-credentials -> Denegado con HTTP 403 para perfil Comercial",
    comercialHttp.res.statusCode === 403,
    `Status: ${comercialHttp.res.statusCode} | Error: ${comercialHttp.res._jsonData?.error}`
  );

  // 7.3 Acceso de Evaria denegado con HTTP 403
  apiGerenteCredentials._setFetchUserProfileForTesting((userId, cb) => {
    cb(null, {
      id: 'p-evaria',
      dni: '00000004E',
      nombre: 'EVARIA TEST',
      rol: 'evaria',
      activo: true,
      must_change_password: false
    });
  });

  const evariaHttp = createMockHttp();
  apiGerenteCredentials(evariaHttp.req, evariaHttp.res);
  report(
    "api/gerente-credentials -> Denegado con HTTP 403 para perfil Evaria",
    evariaHttp.res.statusCode === 403,
    `Status: ${evariaHttp.res.statusCode} | Error: ${evariaHttp.res._jsonData?.error}`
  );

  // 7.4 Acceso autorizado de Gerente -> HTTP 200 con credenciales desocultadas y protección de hashes personales
  apiGerenteCredentials._setVerifySupabaseTokenForTesting((token, cb) => {
    cb(null, { id: 'user-gerente-fran', email: '77860623b@asistente.internal' });
  });
  apiGerenteCredentials._setFetchUserProfileForTesting((userId, cb) => {
    cb(null, {
      id: 'p-gerente',
      dni: '77860623B',
      nombre: 'FRANCISCO MORENTE',
      rol: 'gerente',
      activo: true,
      must_change_password: false
    });
  });

  apiGerenteCredentials._setFetchAllProfilesForTesting((cb) => {
    cb(null, [
      { dni: '47539234M', nombre: 'ANA ROCIO GALERA MORILLO', rol: 'comercial', activo: true, must_change_password: true },
      { dni: '78105180D', nombre: 'FRANCISCO JAVIER AGUILAR CHAVES', rol: 'comercial', activo: true, must_change_password: false }
    ]);
  });

  apiGerenteCredentials._setFetchTempCredentialsForTesting((cb) => {
    cb(null, [
      { dni: '47539234M', temp_password: 'TempPassword47539!' },
      { dni: '78105180D', temp_password: 'OldTempPass78105!' }
    ]);
  });

  const gerenteHttp = createMockHttp();
  apiGerenteCredentials(gerenteHttp.req, gerenteHttp.res);

  const credsData = gerenteHttp.res._jsonData?.credentials || {};
  const is200 = gerenteHttp.res.statusCode === 200;
  const anaHasTemp = credsData['47539234M']?.password === 'TempPassword47539!' && credsData['47539234M']?.mustChangePassword === true;
  const aguilarHasPersonal = credsData['78105180D']?.password === 'Contraseña personal ya establecida' && credsData['78105180D']?.isPersonal === true;

  report(
    "api/gerente-credentials -> Autorizado con HTTP 200 para Gerente (desoculta temporales y preserva personales)",
    is200 && anaHasTemp && aguilarHasPersonal,
    `Ana (must_change=true): ${credsData['47539234M']?.password} | Aguilar (must_change=false): ${credsData['78105180D']?.password}`
  );
})();

// ----------------------------------------------------------------------------
// RESUMEN FINAL
// ----------------------------------------------------------------------------
console.log("\n\x1b[36m==================================================================\x1b[0m");
const summaryColor = testsFailed === 0 ? "\x1b[32m" : "\x1b[31m";
console.log(` ${summaryColor}TOTAL PRUEBAS RUNTIME: ${testsPassed} superadas, ${testsFailed} fallidas\x1b[0m`);
console.log("\x1b[36m==================================================================\x1b[0m");

if (testsFailed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
