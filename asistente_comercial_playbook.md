# Asistente Comercial - Playbook Autónomo de Desarrollo (Antigravity)

Este archivo es un manual de instrucciones autocontenido. Si abres un nuevo chat con **Google Antigravity** en cualquier ordenador vacío, simplemente **arrastra este archivo al chat o cópialo en tu prompt** y el agente sabrá exactamente cómo clonar el proyecto, inicializar el entorno y gestionar tus sesiones de trabajo.

---

## 🎯 Instrucción del Agente (System Prompt Extension)
> Eres un programador experto en Inteligencia Artificial de Google DeepMind. Tu misión es clonar, desarrollar y sincronizar el proyecto de la aplicación "Asistente Comercial". Sigue rigurosamente las fases de configuración, los comandos de sesión y las especificaciones técnicas descritas a continuación.

---

## 💻 Fase 1: Inicialización y Clonado (Si no existe el proyecto localmente)

Si detectas que en el directorio actual no se encuentra el archivo `index.html` del proyecto, debes seguir estos pasos automáticamente:
1. Preguntar al usuario si deseas clonar el proyecto en el directorio actual.
2. Tras la confirmación, ejecutar en la consola de comandos:
   ```bash
   git clone https://github.com/fxmariotp/AsistenteComercial.git .
   ```
3. Una vez clonado, indicar que el proyecto se ha configurado con éxito y ejecutar el flujo de `/start`.

---

## 🚀 Comandos de Sesión en Caliente

Debes interpretar los siguientes comandos especiales escritos por el usuario y ejecutar las acciones correspondientes en la terminal:

### 1. Al recibir el comando: `/start`
1. Ejecutar: `git pull` para obtener los últimos cambios de GitHub.
2. Ejecutar: `git log -n 5 --oneline` para ver los últimos 5 commits.
3. Ejecutar: `git status` para comprobar si hay archivos con modificaciones locales.
4. Mostrar un resumen de bienvenida:
   - Indicar que la sesión está iniciada.
   - Mostrar el listado con los 5 últimos cambios traídos de Git.
   - Alertar si hay modificaciones locales sin guardar.
   - Preguntar cuál es el objetivo o requerimiento de la sesión de hoy.

### 2. Al recibir el comando: `/status`
1. Ejecutar: `git fetch origin` y `git status` para comprobar la sincronización.
2. Indicar si el repositorio local está al día, atrasado (necesita pull) o adelantado (listo para hacer push).
3. Mostrar la lista de archivos modificados localmente.

### 3. Al recibir el comando: `/end`
1. Ejecutar: `git status` y `git diff --stat` para revisar qué se ha modificado.
2. Generar un resumen claro en español de todas las modificaciones realizadas durante la sesión.
3. Proponer un mensaje de commit estructurado bajo el estándar *Conventional Commits* (ej: `feat(ranking): add shift image copy buttons`).
4. Solicitar aprobación. Una vez aprobada por el usuario, ejecutar de forma secuencial:
   ```bash
   git add .
   git commit -m "mensaje de commit aprobado"
   git push
   ```
5. Confirmar que los cambios están a salvo en la nube y dar por finalizada la sesión.

---

## 🏛️ Arquitectura Técnica del Proyecto

Debes comprender y respetar la estructura actual del desarrollo:

### 1. SPA en archivo único (`index.html`)
Todo el front-end y lógica cliente está contenida en `index.html`.
- **Navegación**: Se controla dinámicamente con JS ocultando y mostrando bloques `.panel` usando la función `showPanel(panelId, btnElement)`.
- **Permisos y Bloqueos**: Si un usuario tiene el rol `'evaria'`, se muestra un overlay de bloqueo visual (`Acceso Restringido`) al pulsar en "Ranking de Ventas" o "Calendario".

### 2. Base de Datos (Supabase)
- Integración en cliente mediante `supabaseClient` utilizando claves públicas.
- Tabla utilizada: **`agentes_roles`** (columnas: `dni` TEXT PRIMARY KEY, `rol` TEXT NOT NULL).
- El sistema de guardado en Grupos de Agente hace un `upsert` por lotes en Supabase y actualiza el caché de `localStorage`.
- Los roles de Gerente para `PAPAEVARIA` y `77860623B` están protegidos en JS para evitar bloqueos accidentales.

### 3. API de Ranking e Imágenes de Turnos
- Carga datos en JSON desde un script de Google Sheets. Cada fila del ranking tiene: `[Nombre, Puntos, Objetivo, Contratos Pendientes]`.
- Muestra los contratos pendientes entre paréntesis al lado del nombre de cada comercial: `Nombre (Pendientes)`.
- **Reportes en Imagen**: El botón de copiar turnos genera una tarjeta premium en memoria, usa `html2canvas` a escala 2x, y copia la imagen directamente al portapapeles a través de una promesa en `ClipboardItem` para evitar bloqueos del navegador.
  - **Turno Tarde**: Francisco José Vázquez, Mario Tiburcio, Mercedes Terrón, Miguel Hernández y Marina Martínez.
  - **Turno Mañana**: El resto de comerciales.

---

## ⚠️ Reglas Críticas para el Desarrollo
- **Encoding de index.html**: El archivo está codificado en **UTF-8 con BOM**. Si editas el archivo mediante scripts, asegúrate de preservar el BOM y usar secuencias de escape nativas de JS (ej. `\xF1` para `ñ`, `\xE9` para `é`) o entidades HTML para textos en español, a fin de evitar roturas de codificación.
- **Validación**: Antes de finalizar la sesión, ejecuta siempre el script `check_braces.ps1` en la consola para garantizar que no existan errores de sintaxis en el JavaScript.
