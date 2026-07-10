---
name: asistente-comercial-dev
description: Agente especializado en el desarrollo del Asistente Comercial. Define comandos de inicio (/start) y cierre (/end) de sesion, integracion con Git, base de datos Supabase, integracion de Google Sheets API y rendering de imagenes.
---

# Asistente Comercial - Guía de Desarrollo para Antigravity

Este archivo de Skill configura el comportamiento de **Google Antigravity** cuando se trabaja en este proyecto en cualquier ordenador. Al estar guardado en la carpeta `.agents/skills/asistente_comercial/`, se carga de forma automática.

---

## 🚀 Flujo de Trabajo y Comandos de Sesión

Para mantener el proyecto sincronizado y llevar un control estricto de los cambios, debes responder y ejecutar flujos específicos cuando el usuario introduzca los comandos `/start` o `/end`.

### 1. Comando: `/start` (Iniciar Sesión de Trabajo)
Cuando el usuario introduzca `/start`, debes realizar exactamente las siguientes acciones de forma autónoma:
1. **Ejecutar** `git pull` en la consola para sincronizar los últimos cambios de la nube.
2. **Consultar el historial**: Ejecutar `git log -n 5 --oneline` para ver los últimos 5 commits realizados.
3. **Analizar el estado local**: Ejecutar `git status` para comprobar si hay cambios pendientes no guardados de sesiones previas.
4. **Generar un Resumen de Inicio**:
   - Saludar al usuario confirmando que la sesión ha iniciado.
   - Presentar una lista de los últimos 5 cambios del historial de Git.
   - Indicar si el entorno local está limpio o tiene archivos pendientes de clasificar.
   - Preguntar cuál es la tarea o requerimiento en el que nos enfocaremos hoy.

### 2. Comando: `/end` (Finalizar y Subir Cambios)
Cuando el usuario introduzca `/end`, debes realizar las siguientes acciones para empaquetar e informar sobre el trabajo:
1. **Consultar cambios locales**: Ejecutar `git status` and `git diff --stat` para recopilar qué archivos han sido modificados.
2. **Generar Resumen de Cambios**:
   - Redactar un listado legible y estructurado con viñetas de todas las modificaciones realizadas durante la sesión de trabajo.
   - Proponer un mensaje de commit claro bajo el estándar *Conventional Commits* (ej. `feat(ranking): add shift image copy buttons`).
3. **Confirmar con el usuario** para realizar el guardado. Si el usuario da el visto bueno (o si está configurado en piloto automático):
   - Proponer/ejecutar: `git add .`
   - Proponer/ejecutar: `git commit -m "mensaje"`
   - Proponer/ejecutar: `git push`
4. **Despedida**: Confirmar que los cambios ya se encuentran seguros en la nube y la sesión ha finalizado.

### 3. Comando: `/status` (Ver Estado de Sincronización)
Cuando el usuario introduzca `/status`, debes:
1. Comprobar diferencias con el servidor (`git fetch origin`, luego `git status -uno` o `git status`).
2. Indicar si el repositorio local está al día, por delante (listo para hacer push) o por detrás (necesita pull).
3. Mostrar una tabla rápida de archivos modificados en la sesión actual.

---

## 🏛️ Arquitectura del Proyecto

Al modificar el código del proyecto, debes respetar rigurosamente su arquitectura:

### 1. Archivo Único SPA (`index.html`)
El proyecto es una **Single Page Application (SPA)** de gran tamaño escrita en un único archivo `index.html`. 
- **Estilos (CSS)**: Se definen en la etiqueta `<style>` y usan variables CSS personalizadas para cambiar entre tema claro y oscuro de manera elegante.
- **Navegación**: Se realiza de forma dinámica ocultando y mostrando bloques contenedores con clase `.panel` mediante la función `showPanel(panelId, btnElement)`.
- **Estructura**: Las secciones de la web se dividen en pestañas (Dashboard, Calendario, Ranking, Grupos de Agentes, etc.).

### 2. Base de Datos (Supabase)
- La aplicación se conecta directamente a **Supabase** usando su cliente Javascript oficial (`supabaseClient`).
- La tabla principal para los permisos es **`agentes_roles`**, que tiene las columnas `dni` (TEXT PRIMARY KEY) y `rol` (TEXT NOT NULL).
- **Importante**: Los roles de Gerencia (`'77860623B'` y `'PAPAEVARIA'`) se fuerzan y protegen en el cliente JS para garantizar acceso constante, incluso si falla la sincronización con la nube.

### 3. API del Ranking (Google Sheets)
- La información de rendimiento se obtiene mediante `fetch()` desde un Google Apps Script que devuelve un JSON estructurado con la información de los comerciales.
- Cada registro devuelto consta de 4 columnas:
  1. `Nombre` (Texto)
  2. `Puntos acumulados` (Número)
  3. `Objetivo diario` (Número)
  4. `Contratos pendientes` (Número/Vacio)

### 4. Generador de Reportes de Turnos (`copyShiftReport`)
- Genera imágenes a resolución 2x usando la librería **`html2canvas`** desde una tarjeta HTML renderizada de forma invisible.
- Clasifica a los comerciales en dos turnos:
  - **Tarde**: Francisco José Vázquez, Mario Tiburcio, Mercedes Terrón, Miguel Hernández y Marina Martínez.
  - **Mañana**: Todos los demás (excluyendo a gerentes).
- Escribe la imagen directamente al portapapeles utilizando `new ClipboardItem` con paso de promesa para evitar los bloqueos de seguridad del navegador.

---

## ⚠️ Reglas Críticas de Edición

1. **Codificación de caracteres (Encoding)**:
   - Al realizar ediciones de código en `index.html`, asegúrate de mantener la codificación en **UTF-8 con BOM** para que los acentos en español no se rompan.
   - Si creas scripts de PowerShell para editar código, utiliza secuencias de escape nativas de JavaScript (como `\xF1` para la `ñ` o `\xE9` para la `é`) o entidades HTML (como `&ntilde;` o `&eacute;`) para los textos dentro de `index.html`.
2. **Revisión de Sintaxis**:
   - Tras realizar cualquier cambio, ejecuta siempre el validador de sintaxis (`check_braces.ps1`) para garantizar que todas las llaves, corchetes y paréntesis estén balanceados.
