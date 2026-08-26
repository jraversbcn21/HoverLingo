# HoverLingo v0.2.0 — Mejoras pre-release — Diseño

**Fecha:** 2026-08-26
**Estado:** Aprobado
**Alcance:** Las 4 mejoras pendientes del Future Work de AGENTS.md (cache cross-tab, i18n popup, reset stats, test integración SW), seguidas de bump a 0.2.0, build, zip y subida a la Chrome Web Store. Fuera de alcance: migración a `@crxjs/vite-plugin` estable (sigue en beta).

## 1. Request collapsing cross-tab

**Archivo:** `src/background/service-worker.ts` (solo este; no se tocan content scripts).

Un `Map<string, Promise<TranslationResponse>>` a nivel de módulo, keyed por el mismo `cacheKey` que ya usa L2 (`buildCacheKey(text, sentence, lang, mode, model)`).

En `handleTranslate`, tras el miss de L2 y el check de API key:

- Si el Map ya tiene una promesa para esa key → esperarla y responder `{ success: true, data, cached: true }`. `cached: true` hace que el content script lo cuente como cache hit — mismo criterio que el dedup L1 existente.
- Si no → crear la promesa (= `callGroqWithRetry` + `validateTranslationScript` + `l2Cache.set`), registrarla en el Map, y borrarla en `finally`.

**Errores:** una promesa rechazada propaga el mismo error a todos los suscritos; cada uno responde su error por su propio `sendResponse`. El manejo de errores existente (RATE_LIMIT para 429, mensaje genérico) no cambia.

**Límite conocido:** si MV3 mata el SW, el Map se pierde y esa vez no colapsa. Best-effort deliberado; L2 cubre la persistencia. No se añade lock por storage.

## 2. i18n del popup (EN base + ES)

Mecanismo nativo `chrome.i18n`:

- `public/_locales/en/messages.json` (base) y `public/_locales/es/messages.json`. Vite copia `public/` a `dist/`, así que `_locales/` queda en la raíz del paquete como exige Chrome.
- `manifest.json`: añadir `"default_locale": "en"`; `name` y `description` pasan a `__MSG_extName__` / `__MSG_extDesc__` (localiza también el listing base).
- **Strings estáticos** (`src/popup/index.html`): atributo `data-i18n="clave"`; un loop en `popup.ts` al arrancar hace `el.textContent = chrome.i18n.getMessage(clave)`. Inputs con placeholder usan `data-i18n-placeholder`.
- **Strings dinámicos** (`popup.ts`): confirmaciones, labels de stats, mensajes de error de import/export → `chrome.i18n.getMessage()` directo.
- **No se traducen:** nombres de modelos (nombres propios) ni el catálogo `TARGET_LANGUAGES` (ya está en nombre nativo de cada idioma).

El idioma lo elige Chrome según el locale del navegador; sin selector propio.

## 3. Botón reset stats

Botón en la sección de stats de `src/popup/index.html` → `confirm()` nativo (string i18n) → `chrome.storage.local.remove("usageStats")` → re-render de la sección de stats.

**Caveat aceptado:** una pestaña abierta puede volcar hasta 9 eventos de delta pendientes después del reset (flush cada 10 eventos). Irrelevante; no se mitiga.

## 4. Test de integración del SW

**Archivo nuevo:** `src/__tests__/service-worker.test.ts` (vitest, mismo estilo que la suite existente).

**Arnés:** mock global de `chrome` (`storage.local` con implementación en memoria, `runtime.onMessage.addListener` que captura el listener) y de `fetch` (`vi.fn`). `vi.resetModules()` + import dinámico del SW en cada test para estado limpio.

**Casos (~7):**
1. Hit L2 → responde `cached: true` sin llamar a `fetch`.
2. Miss → 1 fetch, respuesta parseada, persistida en L2, `cached: false`.
3. Sin API key → `{ success: false, error: "API key not configured" }`.
4. 429 persistente → error `RATE_LIMIT`.
5. Modelo decomisionado guardado en storage → el body del fetch usa el modelo default con `reasoning_effort: "none"`.
6. Collapsing: 2 mensajes TRANSLATE concurrentes con la misma key → 1 solo fetch; el segundo responde `cached: true`.
7. 2 mensajes concurrentes con keys distintas → 2 fetches.

## Cierre de release

1. Suite completa en verde (49 existentes + ~7 nuevos).
2. Bump `0.1.0` → `0.2.0` en `manifest.json` y `package.json`.
3. `npm run build` + zip de `dist/` (los zips están en .gitignore).
4. Actualizar AGENTS.md (Future Work y estado).
5. Commit(s) y entrega del zip al usuario para subirlo a la CWS.
