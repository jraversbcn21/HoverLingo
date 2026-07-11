# Plan de Corrección de Bugs Pre-Producción — HoverLingo

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corregir los 16 bugs verificados en la revisión pre-producción (2026-07-11) de la extensión HoverLingo, ordenados por severidad, dejando la extensión lista para subir a producción.

**Architecture:** Chrome Extension MV3. Content script (hover → extracción → tooltip) ↔ Service worker (caché L2 + Groq API) ↔ Popup (settings en `chrome.storage.local`). Las correcciones no cambian la arquitectura; añaden guardas de concurrencia, validación de datos externos y módulos compartidos testeables (`src/shared/`).

**Tech Stack:** TypeScript 5 (`strict: true`, cero `any`), Vite 6 + @crxjs/vite-plugin, vitest 3 (jsdom), sin dependencias runtime nuevas (solo @floating-ui/dom existente).

## Global Constraints

- `npm test` (26 tests actuales + los nuevos) y `npm run build` deben pasar tras CADA tarea.
- TypeScript `strict: true` — prohibido `any`; usar type guards.
- NO añadir dependencias runtime nuevas.
- Los tests corren en jsdom sin entorno de extensión: la lógica testeable va en módulos puros de `src/shared/` o `src/content/` sin `chrome.*`.
- Mensajes de commit en inglés, formato `fix: ...` / `refactor: ...` / `test: ...`.
- Tras cambios en content script, la verificación manual exige: `npm run build` → recargar extensión en `chrome://extensions` → **cerrar y reabrir pestañas** (hard refresh NO basta — ver AGENTS.md).
- Referencias de línea = estado del repo en commit `88f1d90`. Si una tarea previa movió líneas, buscar por el fragmento de código citado.

---

## Resumen de hallazgos verificados (orden de severidad)

Todos los hallazgos fueron verificados línea a línea contra el código fuente. Los hallazgos provienen de 2 revisores paralelos (integración transversal; popup+manifest) más revisión directa de content scripts y service worker.

| # | Sev. | Hallazgo | Ubicación | Tarea |
|---|------|----------|-----------|-------|
| 1 | ALTA | Respuestas en vuelo sin ligar al hover actual: una traducción tardía de la palabra A sobrescribe el tooltip de B; un error tardío de A destruye el skeleton de B (B nunca se renderiza) | `src/content/index.ts:203-216, 178-185, 233-235` | T1 |
| 2 | ALTA | Todos los errores del SW (sin API key, timeout 30s, 4xx/5xx, parse) terminan en desaparición silenciosa del tooltip; `err.message` se descarta. Mata la primera ejecución (sin key configurada no hay ninguna pista) | `src/content/index.ts:210-216` ↔ `src/background/service-worker.ts:305,156,327` | T2 |
| 3 | ALTA | Import de settings valida solo nombres de clave, no tipos: `{"disabledSites":{}}` rompe el toggle per-site persistentemente (TypeError sin recuperación); `disabledSites` string activa matching por substring; `hoverDelay` objeto → delay 0 (spam de llamadas API) | `src/popup/popup.ts:147-162`; lecturas sin guardas en `popup.ts:46,238` y `src/content/index.ts:103,106,126,135` | T3 |
| 4 | MEDIA | Una selección activa en la página (p. ej. doble clic previo) secuestra TODOS los hovers: `extractTextAt` ignora x,y si hay selección; además la selección no se trunca como `word` (el test "truncates to 500" es vacuo: asserts ≤600 sobre input de 600) | `src/content/text-extractor.ts:107-117`, `src/__tests__/text-extractor.test.ts:48` | T4 |
| 5 | MEDIA | `pagehide`/`blur` del popup escriben `apiKeyInput.value` incondicionalmente: si el popup se cierra antes de que `loadSettings()` resuelva, la API key guardada se borra en silencio | `src/popup/popup.ts:253-256, 203-206` | T5 |
| 6 | MEDIA | `Retry-After` sin tope: un 429 con `Retry-After: 60` deja al SW en un `setTimeout` que Chrome puede matar (~30s idle MV3) → puerto cerrado; y "message port closed" NO está en la allowlist de reintentos del content script → rechazo inmediato silencioso | `src/background/service-worker.ts:42-57, 266-272` ↔ `src/content/index.ts:255` | T6 |
| 7 | MEDIA | Modelos Qwen razonadores (`qwen/qwen3-32b` seleccionable) emiten `<think>...</think>` en `content`; el regex greedy `/\{[\s\S]*\}/` de `extractJson` falla si el bloque think contiene llaves (probable: el modelo borra JSON en el think) → traducción falla | `src/background/service-worker.ts:226-240, 183-192` | T7 |
| 8 | MEDIA | La clave de caché L1/L2 es `text\|lang\|mode`: no incluye contexto (la desambiguación por contexto — feature central — se sirve mal durante 24h: "bank" del río cacheado se sirve en contexto financiero) ni modelo (cambiar de modelo no surte efecto hasta 24h) | `src/background/service-worker.ts:295`, `src/content/cache-l1.ts:24-26` | T8 |
| 9 | MEDIA | Stats: read-modify-write absoluto multi-pestaña pierde actualizaciones; sin flush en `pagehide` se pierden hasta 9 eventos por navegación; hits L2 se cuentan como traducciones frescas (flag `cached` del SW nunca se lee); la ruta dedup no cuenta nada | `src/content/index.ts:39-64, 93-109, 178-185, 203-208, 239` ↔ `src/background/service-worker.ts:299` | T9 |
| 10 | MEDIA | `all_frames: true` + comparación con `window.location.hostname` del frame: deshabilitar un sitio no cubre sus iframes cross-origin, y deshabilitar `youtube.com` mata los embeds de YouTube en TODOS los sitios; el toast de activado/desactivado se duplica por cada iframe | `manifest.json:25` ↔ `src/content/index.ts:107,136,132` ↔ `src/popup/popup.ts:25-34` | T10 |
| 11 | MEDIA | Modelo guardado fuera del catálogo (modelo decomisionado por Groq o import corrupto): el `<select>` muestra otra cosa mientras el SW sigue usando el guardado → 400 en cada traducción, indiagnosticable | `src/popup/popup.ts:110-111` ↔ `src/background/service-worker.ts:141-143` | T11 |
| 12 | BAJA | `confidence` ausente en la respuesta del modelo: `undefined > 0` es false → se salta `validateTranslationScript`, y el tooltip lo muestra sin el prefijo "~" de baja confianza | `src/background/service-worker.ts:219,319` ↔ `src/content/tooltip-renderer.ts:121` | T12 |
| 13 | BAJA | Export en instalación fresca produce `{}` (storage.get de claves nunca escritas) que el propio import rechaza como "Invalid settings file" | `src/popup/popup.ts:119-137, 157` | T13 |
| 14 | BAJA | Hint de atajo hardcodeado "Ctrl+Shift+K": incorrecto en macOS (`Command+Shift+K`), tras rebinding, o si Chrome no asignó la tecla por conflicto | `src/popup/popup.ts:267` ↔ `manifest.json:11-13` | T14 |
| 15 | BAJA | Drift de tipos: `StorageData.enabledSites` no existe en runtime (la clave real es `disabledSites`, no declarada); falta `usageStats`; `TranslationResponse` duplicada en `cache-l1.ts` y `types.ts` | `src/shared/types.ts:25-33`, `src/content/cache-l1.ts:6-16` | T15 |
| 16 | BAJA | Estado "translating" muerto: nada lo establece jamás; `notifyTranslationComplete()` es un no-op permanente | `src/content/hover-detector.ts:5,142-146` ↔ `src/content/index.ts:207` | T16 |

**Verificados como NO-bugs** (no tocar): contrato de mensajes TRANSLATE correcto (`return true` presente, cada rama llama `sendResponse` una vez); sin XSS (popup usa `textContent`; tooltip escapa todo con `esc()`); sin prototype pollution en import; permisos del manifest mínimos y suficientes; expiración L2 aplicada en lectura; build de producción funcional.

**Backlog no bloqueante** (documentar, no ejecutar en este plan): expansión de palabra en CJK toma la cláusula entera (sin separadores `\p{L}` engulle todo hasta puntuación); `l2Cache.set` hace `storage.get(null)` (lee TODO el storage) en cada escritura — O(storage) por traducción; toast puede quedar huérfano si `animationend` no dispara en pestaña oculta; dedup de peticiones entre pestañas (ya en Future Work de AGENTS.md).

---

## Estructura de archivos

**Nuevos:**
- `src/shared/extract-json.ts` — parser JSON robusto (movido del SW, con extracción balanceada y limpieza de `<think>`/fences)
- `src/shared/cache-key.ts` — `buildCacheKey()` + `hashContext()` compartidos por L1 y L2
- `src/shared/settings-validation.ts` — `sanitizeImportedSettings()` para el import del popup
- `src/__tests__/extract-json.test.ts`, `src/__tests__/cache-key.test.ts`, `src/__tests__/settings-validation.test.ts`

**Modificados:** `src/content/index.ts` (T1,T2,T3,T8,T9,T10), `src/content/tooltip-renderer.ts` (T2), `src/content/styles.css` (T2), `src/content/text-extractor.ts` (T4), `src/content/cache-l1.ts` (T8,T15), `src/content/hover-detector.ts` (T16), `src/background/service-worker.ts` (T6,T7,T8,T10,T12), `src/popup/popup.ts` (T3,T5,T11,T13,T14), `src/shared/types.ts` (T15), `src/__tests__/text-extractor.test.ts` (T4), `src/__tests__/cache-l1.test.ts` (T8).

---

### Task 1: Guard de generación de peticiones (stale responses) — ALTA

**Files:**
- Modify: `src/content/index.ts:8, 149-224`

**Interfaces:**
- Produces: variable de módulo `requestGeneration: number`; patrón `const gen = requestGeneration;` capturado en `onHoverReady` y comprobado en cada callback asíncrono. T2 y T9 reutilizan este guard (`gen !== requestGeneration`).

No hay test unitario viable (requiere mock completo de chrome.runtime + DOM de hover); la verificación es manual con red lenta.

- [ ] **Step 1: Añadir el contador de generación e incrementarlo en cada abort**

En `src/content/index.ts`, junto a las variables de módulo (tras la línea `let currentAbortController ...`):

```ts
let requestGeneration = 0;
```

Reemplazar `abortCurrentRequest` (líneas 219-224) por:

```ts
function abortCurrentRequest(): void {
  requestGeneration++;
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }
}
```

- [ ] **Step 2: Capturar la generación en onHoverReady y proteger todos los callbacks**

En `onHoverReady`, inmediatamente después de `abortCurrentRequest();` (línea 150), añadir:

```ts
const gen = requestGeneration;
```

Reemplazar el bloque de `existingPromise` (líneas 178-185) por:

```ts
existingPromise
  .then((result) => {
    if (gen !== requestGeneration) return;
    renderer.updateContent(extracted.word, result);
  })
  .catch(() => {
    if (gen !== requestGeneration) return;
    renderer.hide();
    wordHighlight.hide();
  });
```

Reemplazar el bloque `promise.then/.catch` (líneas 203-216) por (nota: la caché se puebla SIEMPRE, aunque la respuesta sea obsoleta — el trabajo ya está pagado):

```ts
promise
  .then((result) => {
    l1Cache.set(extracted.word, currentTargetLang, currentMode, result);
    recordTranslation(result.sourceLanguage);
    if (gen !== requestGeneration) return;
    renderer.updateContent(extracted.word, result);
    hoverDetector.notifyTranslationComplete();
  })
  .catch((err) => {
    if (err instanceof DOMException && err.name === "AbortError") {
      return;
    }
    if (gen !== requestGeneration) return;
    renderer.hide();
    wordHighlight.hide();
  });
```

- [ ] **Step 3: Verificar compilación y tests**

Run: `npm test` → Expected: 26 passed. Run: `npm run build` → Expected: build sin errores.

- [ ] **Step 4: Verificación manual**

Cargar `dist/` en Chrome, DevTools → Network → throttling "Slow 3G". Hover sobre la palabra A; antes de que llegue la respuesta, hover sobre la palabra B. Expected: el tooltip de B nunca es reemplazado por la traducción de A; si A falla, el skeleton de B no desaparece.

- [ ] **Step 5: Commit**

```bash
git add src/content/index.ts
git commit -m "fix: discard stale translation responses with request generation guard"
```

---

### Task 2: Feedback de errores en el tooltip — ALTA

**Files:**
- Modify: `src/content/tooltip-renderer.ts` (nuevo método tras `updateContent`, línea 88)
- Modify: `src/content/index.ts` (los dos `.catch` introducidos en T1)
- Modify: `src/content/styles.css` (al final del bloque de tooltip, antes de `.hoverlingo-toast`)

**Interfaces:**
- Consumes: guard `gen !== requestGeneration` de T1.
- Produces: `TooltipRenderer.updateError(originalText: string, message: string): void`.

- [ ] **Step 1: Añadir `updateError` al renderer**

En `src/content/tooltip-renderer.ts`, después de `updateContent` (línea 88):

```ts
updateError(originalText: string, message: string): void {
  if (!this.tooltip) return;
  this.tooltip.innerHTML = `
    <div class="hl-original">"${esc(originalText)}"</div>
    <div class="hl-error">${esc(message)}</div>
  `;
}
```

- [ ] **Step 2: Añadir estilos del error**

En `src/content/styles.css`, tras el bloque `@keyframes hl-blink` (línea 123):

```css
[data-hl-tooltip] .hl-error {
  font-size: 13px;
  color: #c0392b;
}

[data-hl-tooltip].hl-dark .hl-error {
  color: #ff8a80;
}
```

- [ ] **Step 3: Usar `updateError` en los catch de index.ts**

Reemplazar el `.catch` del bloque `promise` (escrito en T1) por:

```ts
.catch((err) => {
  if (err instanceof DOMException && err.name === "AbortError") {
    return;
  }
  if (gen !== requestGeneration) return;
  wordHighlight.hide();
  const msg = err instanceof Error ? err.message : "";
  if (msg.includes("API key not configured")) {
    renderer.updateError(extracted.word, "Configura tu API key de Groq en el popup de HoverLingo");
  } else if (msg.includes("timed out")) {
    renderer.updateError(extracted.word, "La traducción tardó demasiado. Inténtalo de nuevo.");
  } else {
    renderer.updateError(extracted.word, "No se pudo traducir. Inténtalo de nuevo.");
  }
});
```

Y el `.catch` del bloque `existingPromise` (escrito en T1) por:

```ts
.catch(() => {
  if (gen !== requestGeneration) return;
  wordHighlight.hide();
  renderer.updateError(extracted.word, "No se pudo traducir. Inténtalo de nuevo.");
});
```

- [ ] **Step 4: Verificar**

Run: `npm test` → 26 passed. Run: `npm run build` → OK.
Manual: borrar la API key en el popup, hover sobre una palabra → Expected: el tooltip muestra "Configura tu API key de Groq..." en vez de desaparecer.

- [ ] **Step 5: Commit**

```bash
git add src/content/tooltip-renderer.ts src/content/index.ts src/content/styles.css
git commit -m "fix: surface service-worker errors in tooltip instead of silent hide"
```

---

### Task 3: Validación de import de settings — ALTA

**Files:**
- Create: `src/shared/settings-validation.ts`
- Test: `src/__tests__/settings-validation.test.ts`
- Modify: `src/popup/popup.ts:139-171, 45-47, 236-239`
- Modify: `src/content/index.ts:101-107, 125-137`

**Interfaces:**
- Produces: `sanitizeImportedSettings(data: unknown): Record<string, unknown>` — devuelve solo claves válidas y tipadas; objeto vacío si nada es válido.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/__tests__/settings-validation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sanitizeImportedSettings } from "../shared/settings-validation";

describe("sanitizeImportedSettings", () => {
  it("accepts a fully valid settings object", () => {
    const out = sanitizeImportedSettings({
      groqModel: "llama-3.1-8b-instant",
      targetLang: "fr",
      translationMode: "learning",
      hoverDelay: 500,
      enabled: false,
      disabledSites: ["example.com", "foo.org"],
    });
    expect(out).toEqual({
      groqModel: "llama-3.1-8b-instant",
      targetLang: "fr",
      translationMode: "learning",
      hoverDelay: 500,
      enabled: false,
      disabledSites: ["example.com", "foo.org"],
    });
  });

  it("rejects non-object input", () => {
    expect(sanitizeImportedSettings(null)).toEqual({});
    expect(sanitizeImportedSettings("x")).toEqual({});
    expect(sanitizeImportedSettings([1, 2])).toEqual({});
  });

  it("drops disabledSites that is not a string array", () => {
    expect(sanitizeImportedSettings({ disabledSites: {} })).toEqual({});
    expect(sanitizeImportedSettings({ disabledSites: "example.com" })).toEqual({});
    expect(sanitizeImportedSettings({ disabledSites: ["a.com", 42, null] })).toEqual({
      disabledSites: ["a.com"],
    });
  });

  it("clamps hoverDelay to [100, 1000] and drops non-numbers", () => {
    expect(sanitizeImportedSettings({ hoverDelay: 5 })).toEqual({ hoverDelay: 100 });
    expect(sanitizeImportedSettings({ hoverDelay: 99999 })).toEqual({ hoverDelay: 1000 });
    expect(sanitizeImportedSettings({ hoverDelay: {} })).toEqual({});
    expect(sanitizeImportedSettings({ hoverDelay: "300" })).toEqual({});
  });

  it("drops unknown models and languages", () => {
    expect(sanitizeImportedSettings({ groqModel: "evil/model" })).toEqual({});
    expect(sanitizeImportedSettings({ targetLang: "xx" })).toEqual({});
  });

  it("drops invalid translationMode and non-boolean enabled", () => {
    expect(sanitizeImportedSettings({ translationMode: "fast" })).toEqual({});
    expect(sanitizeImportedSettings({ enabled: "true" })).toEqual({});
  });

  it("ignores keys outside the allowlist", () => {
    expect(sanitizeImportedSettings({ groqApiKey: "sk-123", evil: 1 })).toEqual({});
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run src/__tests__/settings-validation.test.ts`
Expected: FAIL — "Cannot find module '../shared/settings-validation'".

- [ ] **Step 3: Implementar el módulo**

Crear `src/shared/settings-validation.ts`:

```ts
import { AVAILABLE_MODELS } from "./constants";
import { TARGET_LANGUAGES } from "./types";

export function sanitizeImportedSettings(data: unknown): Record<string, unknown> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return {};
  }
  const d = data as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  if (typeof d.groqModel === "string" && d.groqModel in AVAILABLE_MODELS) {
    out.groqModel = d.groqModel;
  }
  if (typeof d.targetLang === "string" && d.targetLang in TARGET_LANGUAGES) {
    out.targetLang = d.targetLang;
  }
  if (d.translationMode === "quick" || d.translationMode === "learning") {
    out.translationMode = d.translationMode;
  }
  if (typeof d.hoverDelay === "number" && Number.isFinite(d.hoverDelay)) {
    out.hoverDelay = Math.min(1000, Math.max(100, Math.round(d.hoverDelay)));
  }
  if (typeof d.enabled === "boolean") {
    out.enabled = d.enabled;
  }
  if (Array.isArray(d.disabledSites)) {
    out.disabledSites = d.disabledSites
      .filter((s): s is string => typeof s === "string" && s.length > 0 && s.length <= 253)
      .slice(0, 1000);
  }
  return out;
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npx vitest run src/__tests__/settings-validation.test.ts` → Expected: PASS (7 tests).

- [ ] **Step 5: Usarlo en el import del popup**

En `src/popup/popup.ts`, añadir el import arriba:

```ts
import { sanitizeImportedSettings } from "../shared/settings-validation";
```

Dentro de `importSettings` (líneas 147-162), reemplazar desde `const allowedKeys = ...` hasta el `if (Object.keys(toSave)...)` inclusive por:

```ts
      const toSave = sanitizeImportedSettings(data);

      if (Object.keys(toSave).length === 0) {
        showStatus("Invalid settings file", "error");
        return;
      }
```

- [ ] **Step 6: Lecturas defensivas de disabledSites y hoverDelay**

En `src/popup/popup.ts:46` y `:238`, reemplazar ambas apariciones de:

```ts
  const disabledSites: string[] = data.disabledSites || [];
```

por:

```ts
  const disabledSites: string[] = Array.isArray(data.disabledSites) ? data.disabledSites : [];
```

En `src/content/index.ts:103`, reemplazar `debounceMs = data.hoverDelay || 300;` por:

```ts
    debounceMs = typeof data.hoverDelay === "number" ? data.hoverDelay : 300;
```

En `src/content/index.ts:106`, reemplazar `const disabledSites: string[] = data.disabledSites || [];` por:

```ts
    const disabledSites: string[] = Array.isArray(data.disabledSites) ? data.disabledSites : [];
```

En el listener `storage.onChanged` (`index.ts:125-137`), reemplazar los bloques de `hoverDelay` y `disabledSites` por:

```ts
  if (changes.hoverDelay) {
    const nv = changes.hoverDelay.newValue;
    debounceMs = typeof nv === "number" ? nv : 300;
    hoverDetector.setDebounceMs(debounceMs);
  }
```

```ts
  if (changes.disabledSites) {
    const nv = changes.disabledSites.newValue;
    const disabledSites: string[] = Array.isArray(nv) ? nv : [];
    currentSiteDisabled = disabledSites.includes(window.location.hostname);
    updateDetectorEnabled();
  }
```

- [ ] **Step 7: Verificar todo**

Run: `npm test` → Expected: 33 passed (26 + 7). Run: `npm run build` → OK.
Manual: importar un archivo con `{"disabledSites": {}, "hoverDelay": "abc"}` → Expected: "Invalid settings file"; el toggle per-site sigue funcionando.

- [ ] **Step 8: Commit**

```bash
git add src/shared/settings-validation.ts src/__tests__/settings-validation.test.ts src/popup/popup.ts src/content/index.ts
git commit -m "fix: validate imported settings types and harden storage reads"
```

---

### Task 4: La selección solo aplica si el cursor está sobre ella + truncado real — MEDIA

**Files:**
- Modify: `src/content/text-extractor.ts:107-117`
- Modify: `src/__tests__/text-extractor.test.ts:18-50`

**Interfaces:**
- Produces: `extractTextAt(x, y)` mantiene su firma; ahora `isSelection: true` solo cuando (x,y) cae dentro de los rects de la selección, y `word` de selección se trunca a 500 chars.

- [ ] **Step 1: Actualizar los tests (fallarán con el código actual)**

En `src/__tests__/text-extractor.test.ts`, reemplazar los dos tests de selección (líneas 18-50) por:

```ts
  const originalGetClientRects = Range.prototype.getClientRects;

  afterEach(() => {
    Range.prototype.getClientRects = originalGetClientRects;
  });

  function mockSelectionRect(left: number, top: number, right: number, bottom: number): void {
    Range.prototype.getClientRects = function () {
      const rect = {
        left, top, right, bottom,
        width: right - left,
        height: bottom - top,
        x: left, y: top,
        toJSON: () => ({}),
      } as DOMRect;
      return [rect] as unknown as DOMRectList;
    };
  }

  it("returns selected text when hovering inside the selection", () => {
    const div = document.createElement("div");
    div.textContent = "Hello world";
    document.body.appendChild(div);

    const range = document.createRange();
    range.selectNodeContents(div);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    mockSelectionRect(0, 0, 100, 20);

    const result = extractTextAt(10, 10);
    expect(result).not.toBeNull();
    expect(result!.isSelection).toBe(true);
    expect(result!.word).toContain("Hello");
  });

  it("ignores the selection when hovering outside it", () => {
    const div = document.createElement("div");
    div.textContent = "Hello world";
    document.body.appendChild(div);

    const range = document.createRange();
    range.selectNodeContents(div);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    mockSelectionRect(0, 0, 100, 20);

    // (300, 300) está fuera del rect de la selección; jsdom no tiene
    // caretRangeFromPoint, así que el fallback devuelve null.
    const result = extractTextAt(300, 300);
    expect(result).toBeNull();
  });

  it("truncates long selections to 500 chars", () => {
    const div = document.createElement("div");
    div.textContent = "x".repeat(600);
    document.body.appendChild(div);

    const range = document.createRange();
    range.selectNodeContents(div);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    mockSelectionRect(0, 0, 100, 20);

    const result = extractTextAt(10, 10);
    expect(result).not.toBeNull();
    expect(result!.word.length).toBeLessThanOrEqual(500);
    expect(result!.sentence.length).toBeLessThanOrEqual(500);
  });
```

Añadir `afterEach` al import de vitest en la línea 5: `import { describe, it, expect, beforeEach, afterEach } from "vitest";`

- [ ] **Step 2: Verificar que fallan**

Run: `npx vitest run src/__tests__/text-extractor.test.ts`
Expected: FAIL — "ignores the selection when hovering outside it" (devuelve la selección) y "truncates long selections" (word.length = 600).

- [ ] **Step 3: Implementar**

En `src/content/text-extractor.ts`, añadir antes de `extractTextAt` (línea 107):

```ts
function isPointInSelection(selection: Selection, x: number, y: number): boolean {
  for (let i = 0; i < selection.rangeCount; i++) {
    const rects = selection.getRangeAt(i).getClientRects();
    for (let j = 0; j < rects.length; j++) {
      const r = rects[j];
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        return true;
      }
    }
  }
  return false;
}
```

Reemplazar el bloque de selección dentro de `extractTextAt` (líneas 108-117) por:

```ts
  const selection = window.getSelection();
  if (
    selection &&
    !selection.isCollapsed &&
    selection.toString().trim().length > 0 &&
    isPointInSelection(selection, x, y)
  ) {
    const selectedText = selection.toString().trim().slice(0, 500);
    return {
      word: selectedText,
      sentence: selectedText,
      isSelection: true,
    };
  }
```

- [ ] **Step 4: Verificar que pasan**

Run: `npx vitest run src/__tests__/text-extractor.test.ts` → Expected: PASS (6 tests). Run: `npm test` → todos verdes.

- [ ] **Step 5: Commit**

```bash
git add src/content/text-extractor.ts src/__tests__/text-extractor.test.ts
git commit -m "fix: selection only hijacks hover when cursor is inside it; truncate selection to 500 chars"
```

---

### Task 5: No borrar la API key al cerrar el popup prematuramente — MEDIA

**Files:**
- Modify: `src/popup/popup.ts:22-23, 98-117, 178-182, 193-206, 253-256`

**Interfaces:**
- Produces: flags de módulo `settingsLoaded: boolean` y `apiKeyDirty: boolean`; `saveApiKey()` es no-op hasta que ambos sean coherentes.

- [ ] **Step 1: Añadir flags y guardas**

En `src/popup/popup.ts`, junto a `let apiKeyDebounce ...` (línea 22):

```ts
let settingsLoaded = false;
let apiKeyDirty = false;
```

Al FINAL de `loadSettings()` (tras la línea 116), añadir:

```ts
  settingsLoaded = true;
```

Reemplazar `saveApiKey` (líneas 178-182) por:

```ts
async function saveApiKey(): Promise<void> {
  if (!settingsLoaded || !apiKeyDirty) return;
  const value = apiKeyInput.value.trim();
  await chrome.storage.local.set({ groqApiKey: value });
  showStatus("Saved", "success");
}
```

En el listener `input` de `apiKeyInput` (líneas 193-196), añadir `apiKeyDirty = true;` como primera línea del callback:

```ts
apiKeyInput.addEventListener("input", () => {
  apiKeyDirty = true;
  if (apiKeyDebounce) clearTimeout(apiKeyDebounce);
  apiKeyDebounce = setTimeout(saveApiKey, 500);
});
```

Reemplazar el listener `pagehide` (líneas 253-256) por:

```ts
window.addEventListener("pagehide", () => {
  if (apiKeyDebounce) clearTimeout(apiKeyDebounce);
  if (settingsLoaded && apiKeyDirty) {
    chrome.storage.local.set({ groqApiKey: apiKeyInput.value.trim() });
  }
});
```

- [ ] **Step 2: Verificar**

Run: `npm test` → verdes. Run: `npm run build` → OK.
Manual: guardar una API key, cerrar el popup, abrir y cerrar el popup inmediatamente varias veces, reabrir → Expected: la key sigue presente.

- [ ] **Step 3: Commit**

```bash
git add src/popup/popup.ts
git commit -m "fix: prevent popup pagehide/blur from wiping stored API key before settings load"
```

---

### Task 6: Tope a Retry-After y reintento de "message port closed" — MEDIA

**Files:**
- Modify: `src/background/service-worker.ts:266-272`
- Modify: `src/content/index.ts:255`

- [ ] **Step 1: Capar la espera de 429 en el SW**

En `src/background/service-worker.ts`, dentro de `callGroqWithRetry`, reemplazar (líneas 266-272):

```ts
      if (err.status === 429) {
        if (attempt === 0) {
          const waitMs = parseRetryAfter(err.headers) || 5000;
          await sleep(waitMs);
          continue;
        }
        throw err;
      }
```

por:

```ts
      if (err.status === 429) {
        if (attempt === 0) {
          const waitMs = Math.min(parseRetryAfter(err.headers) ?? 5000, 10000);
          await sleep(waitMs);
          continue;
        }
        throw err;
      }
```

- [ ] **Step 2: Añadir "message port closed" a los errores reintenables del content script**

En `src/content/index.ts:255`, reemplazar la condición:

```ts
if (attempt < 6 && (msg.includes("Extension context invalidated") || msg.includes("receiving end does not exist"))) {
```

por:

```ts
if (
  attempt < 6 &&
  (msg.includes("Extension context invalidated") ||
    msg.includes("receiving end does not exist") ||
    msg.includes("message port closed"))
) {
```

- [ ] **Step 3: Verificar**

Run: `npm test` → verdes. Run: `npm run build` → OK.

- [ ] **Step 4: Commit**

```bash
git add src/background/service-worker.ts src/content/index.ts
git commit -m "fix: cap 429 Retry-After wait at 10s and retry on closed message port"
```

---

### Task 7: extractJson robusto (bloques think, fences, llaves anidadas) — MEDIA

**Files:**
- Create: `src/shared/extract-json.ts`
- Test: `src/__tests__/extract-json.test.ts`
- Modify: `src/background/service-worker.ts:213-240` (eliminar la función local, importar), `:183-192` (reasoning_format)

**Interfaces:**
- Produces: `extractJson<T>(content: string): T | null` en `src/shared/extract-json.ts`. El SW la importa; la firma es idéntica a la función local actual.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `src/__tests__/extract-json.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { extractJson } from "../shared/extract-json";

interface Payload {
  translation: string;
}

describe("extractJson", () => {
  it("parses plain JSON", () => {
    expect(extractJson<Payload>('{"translation":"casa"}')).toEqual({ translation: "casa" });
  });

  it("parses JSON with text preamble", () => {
    expect(extractJson<Payload>('Here is the JSON:\n{"translation":"casa"}')).toEqual({
      translation: "casa",
    });
  });

  it("strips <think> blocks even when they contain braces", () => {
    const content =
      '<think>Draft: {"translation":"wrong"} no, better...</think>\n{"translation":"casa"}';
    expect(extractJson<Payload>(content)).toEqual({ translation: "casa" });
  });

  it("strips markdown code fences", () => {
    expect(extractJson<Payload>('```json\n{"translation":"casa"}\n```')).toEqual({
      translation: "casa",
    });
  });

  it("handles trailing text after the JSON object", () => {
    expect(extractJson<Payload>('{"translation":"casa"}\nHope this helps!')).toEqual({
      translation: "casa",
    });
  });

  it("handles nested braces inside string values", () => {
    expect(extractJson<Payload>('{"translation":"casa {x}"}')).toEqual({
      translation: "casa {x}",
    });
  });

  it("returns null for content without JSON", () => {
    expect(extractJson<Payload>("no json here")).toBeNull();
    expect(extractJson<Payload>("")).toBeNull();
  });

  it("returns null for truncated JSON", () => {
    expect(extractJson<Payload>('{"translation":"cas')).toBeNull();
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run src/__tests__/extract-json.test.ts` → Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementar**

Crear `src/shared/extract-json.ts`:

```ts
export function extractJson<T>(content: string): T | null {
  const cleaned = content
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // seguimos con extracción balanceada
  }

  const start = cleaned.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = inString;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1)) as T;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npx vitest run src/__tests__/extract-json.test.ts` → Expected: PASS (8 tests).

- [ ] **Step 5: Usarlo en el service worker y ocultar el razonamiento de Qwen**

En `src/background/service-worker.ts`:

1. Añadir al import block: `import { extractJson } from "../shared/extract-json";`
2. ELIMINAR la función local `extractJson` (líneas 226-240).
3. En `callGroq`, reemplazar la construcción del body (líneas 183-192) por:

```ts
  const requestBody: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.0,
    max_tokens: mode === "learning" ? 2048 : 1024,
    stream: false,
  };
  // Los modelos qwen3 de Groq son razonadores: sin esto emiten <think>...</think>
  // en content. Si Groq devolviera 400 por este parámetro, retirarlo — extractJson
  // ya limpia los bloques <think> como defensa.
  if (model.startsWith("qwen/")) {
    requestBody.reasoning_format = "hidden";
  }
```

y en la llamada a `fetchWithTimeout`, usar `body: JSON.stringify(requestBody),`.

- [ ] **Step 6: Verificar**

Run: `npm test` → verdes. Run: `npm run build` → OK.
Manual (requiere API key): seleccionar el modelo "Qwen 3 32B" en el popup y traducir varias palabras → Expected: traducciones normales, sin fallos de parseo (ver consola del SW).

- [ ] **Step 7: Commit**

```bash
git add src/shared/extract-json.ts src/__tests__/extract-json.test.ts src/background/service-worker.ts
git commit -m "fix: robust JSON extraction (think blocks, fences, nested braces) and hide qwen reasoning"
```

---

### Task 8: Clave de caché con contexto y modelo — MEDIA

**Files:**
- Create: `src/shared/cache-key.ts`
- Test: `src/__tests__/cache-key.test.ts`
- Modify: `src/content/cache-l1.ts` (API basada en clave)
- Modify: `src/__tests__/cache-l1.test.ts` (nueva API)
- Modify: `src/content/index.ts` (construir clave, trackear modelo)
- Modify: `src/background/service-worker.ts:293-295`

**Interfaces:**
- Produces: `buildCacheKey(text, sentence, targetLang, mode, model): string` y `hashContext(s: string): string` en `src/shared/cache-key.ts`. `l1Cache` pasa a API por clave: `get(key)`, `set(key, response)`, `getPending(key)`, `setPending(key, promise)`.
- Nota: las claves L1 (content) y L2 (SW) son espacios independientes; no necesitan ser idénticas entre sí, solo consistentes internamente. Las entradas L2 antiguas quedan huérfanas y expiran solas en 24h (aceptado).

- [ ] **Step 1: Test de cache-key que falla**

Crear `src/__tests__/cache-key.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildCacheKey, hashContext } from "../shared/cache-key";

describe("cache key", () => {
  it("is deterministic for identical inputs", () => {
    expect(buildCacheKey("bank", "The bank of the river.", "es", "quick", "m1")).toBe(
      buildCacheKey("bank", "The bank of the river.", "es", "quick", "m1")
    );
  });

  it("differs when the sentence context differs", () => {
    const a = buildCacheKey("bank", "The bank of the river.", "es", "quick", "m1");
    const b = buildCacheKey("bank", "The bank raised rates.", "es", "quick", "m1");
    expect(a).not.toBe(b);
  });

  it("differs when the model differs", () => {
    const a = buildCacheKey("bank", "ctx", "es", "quick", "m1");
    const b = buildCacheKey("bank", "ctx", "es", "quick", "m2");
    expect(a).not.toBe(b);
  });

  it("differs by target language and mode", () => {
    const base = buildCacheKey("bank", "ctx", "es", "quick", "m1");
    expect(buildCacheKey("bank", "ctx", "fr", "quick", "m1")).not.toBe(base);
    expect(buildCacheKey("bank", "ctx", "es", "learning", "m1")).not.toBe(base);
  });

  it("hashContext handles the empty string", () => {
    expect(typeof hashContext("")).toBe("string");
    expect(hashContext("").length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run src/__tests__/cache-key.test.ts` → Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementar cache-key**

Crear `src/shared/cache-key.ts`:

```ts
export function hashContext(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

export function buildCacheKey(
  text: string,
  sentence: string,
  targetLang: string,
  mode: string,
  model: string
): string {
  return `${text}|${hashContext(sentence)}|${targetLang}|${mode}|${model}`;
}
```

Run: `npx vitest run src/__tests__/cache-key.test.ts` → Expected: PASS (5 tests).

- [ ] **Step 4: Cambiar cache-l1 a API por clave**

Reemplazar en `src/content/cache-l1.ts` la función `buildKey` (líneas 24-26) — ELIMINARLA — y el objeto `l1Cache` completo (líneas 50-88) por:

```ts
export const l1Cache = {
  get(key: string): TranslationResponse | null {
    const entry = cache.get(key);

    if (!entry) return null;
    if (isExpired(entry)) {
      cache.delete(key);
      return null;
    }

    entry.timestamp = Date.now();
    return entry.response;
  },

  set(key: string, response: TranslationResponse): void {
    if (cache.has(key)) {
      cache.get(key)!.timestamp = Date.now();
      return;
    }

    evictLRU();
    cache.set(key, { response, timestamp: Date.now() });
  },

  getPending(key: string): Promise<TranslationResponse> | null {
    return pendingRequests.get(key) || null;
  },

  setPending(key: string, promise: Promise<TranslationResponse>): void {
    pendingRequests.set(key, promise);
    promise.finally(() => {
      pendingRequests.delete(key);
    });
  },
};
```

- [ ] **Step 5: Actualizar los tests de cache-l1**

En `src/__tests__/cache-l1.test.ts`, añadir el import y reemplazar TODAS las llamadas de 3-4 argumentos por claves construidas. Archivo completo resultante del bloque `describe`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildCacheKey } from "../shared/cache-key";

let l1Cache: typeof import("../content/cache-l1").l1Cache;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  const mod = await import("../content/cache-l1");
  l1Cache = mod.l1Cache;
});

function makeResponse() {
  return {
    translation: "casa",
    sourceLanguage: "en",
    direction: "ltr" as const,
    confidence: 0.95,
  };
}

const key = (text: string, lang: string, mode: string) =>
  buildCacheKey(text, "ctx", lang, mode, "test-model");

describe("L1 Cache", () => {
  it("returns null for missing key", () => {
    expect(l1Cache.get(key("hello", "es", "quick"))).toBeNull();
  });

  it("stores and retrieves a translation", () => {
    const resp = makeResponse();
    l1Cache.set(key("hello", "es", "quick"), resp);
    expect(l1Cache.get(key("hello", "es", "quick"))).toEqual(resp);
  });

  it("distinguishes by target language", () => {
    l1Cache.set(key("hello", "es", "quick"), makeResponse());
    expect(l1Cache.get(key("hello", "fr", "quick"))).toBeNull();
  });

  it("distinguishes by mode", () => {
    l1Cache.set(key("hello", "es", "quick"), makeResponse());
    expect(l1Cache.get(key("hello", "es", "learning"))).toBeNull();
  });

  it("distinguishes by sentence context", () => {
    l1Cache.set(buildCacheKey("bank", "river ctx", "es", "quick", "m"), makeResponse());
    expect(l1Cache.get(buildCacheKey("bank", "money ctx", "es", "quick", "m"))).toBeNull();
  });

  it("expires entry after TTL", () => {
    l1Cache.set(key("hello", "es", "quick"), makeResponse());

    vi.advanceTimersByTime(31 * 60 * 1000);

    expect(l1Cache.get(key("hello", "es", "quick"))).toBeNull();
  });

  it("evicts LRU entry when cache is full", () => {
    for (let i = 0; i < 1000; i++) {
      l1Cache.set(key(`word${i}`, "es", "quick"), makeResponse());
    }

    l1Cache.set(key("overflow", "es", "quick"), makeResponse());

    expect(l1Cache.get(key("word0", "es", "quick"))).toBeNull();
    expect(l1Cache.get(key("word1", "es", "quick"))).not.toBeNull();
  });

  it("deduplicates in-flight requests", async () => {
    let resolvePromise!: (v: ReturnType<typeof makeResponse>) => void;
    const promise = new Promise<ReturnType<typeof makeResponse>>((resolve) => {
      resolvePromise = resolve;
    });

    l1Cache.setPending(key("hello", "es", "quick"), promise);
    expect(l1Cache.getPending(key("hello", "es", "quick"))).toBe(promise);

    resolvePromise(makeResponse());
    await promise;

    expect(l1Cache.getPending(key("hello", "es", "quick"))).toBeNull();
  });
});
```

Run: `npx vitest run src/__tests__/cache-l1.test.ts` → Expected: PASS (8 tests).

- [ ] **Step 6: Content script — trackear modelo y construir la clave**

En `src/content/index.ts`:

1. Añadir imports: `import { buildCacheKey } from "../shared/cache-key";` y `import { GROQ_MODEL } from "../shared/constants";`
2. Junto a las variables de módulo: `let currentModel = GROQ_MODEL;`
3. En `loadSettings`, añadir `"groqModel"` al array de `chrome.storage.local.get` y tras la línea de `currentMode`:

```ts
    currentModel = typeof data.groqModel === "string" ? data.groqModel : GROQ_MODEL;
```

4. En el listener `storage.onChanged`, añadir:

```ts
  if (changes.groqModel) {
    const nv = changes.groqModel.newValue;
    currentModel = typeof nv === "string" ? nv : GROQ_MODEL;
  }
```

5. En `onHoverReady`, tras obtener `extracted`, construir la clave UNA vez y usarla en las cuatro llamadas a caché:

```ts
  const cacheKey = buildCacheKey(
    extracted.word,
    extracted.sentence,
    currentTargetLang,
    currentMode,
    currentModel
  );

  const cached = l1Cache.get(cacheKey);
```

`getPending(cacheKey)`, `setPending(cacheKey, promise)` y `l1Cache.set(cacheKey, result)` reemplazan las llamadas de múltiples argumentos.

- [ ] **Step 7: Service worker — misma composición de clave**

En `src/background/service-worker.ts`, añadir `import { buildCacheKey } from "../shared/cache-key";` y en `handleTranslate` reemplazar (líneas 293-295):

```ts
    const targetLang = request.targetLang || (await getTargetLang());
    const mode = request.mode || (await getMode());
    const cacheKey = `${request.text}|${targetLang}|${mode}`;
```

por:

```ts
    const targetLang = request.targetLang || (await getTargetLang());
    const mode = request.mode || (await getMode());
    const model = await getModel();
    const cacheKey = buildCacheKey(request.text, request.sentence || "", targetLang, mode, model);
```

Y ELIMINAR la línea `const model = await getModel();` que estaba más abajo (tras el check de API key) para no leerla dos veces.

- [ ] **Step 8: Verificar todo**

Run: `npm test` → Expected: todos verdes (los 4 archivos + los 3 nuevos). Run: `npm run build` → OK.

- [ ] **Step 9: Commit**

```bash
git add src/shared/cache-key.ts src/__tests__/cache-key.test.ts src/content/cache-l1.ts src/__tests__/cache-l1.test.ts src/content/index.ts src/background/service-worker.ts
git commit -m "fix: include sentence context and model in L1/L2 cache keys"
```

---

### Task 9: Stats correctas (deltas, flush, conteo de hits L2 y dedup) — MEDIA

**Files:**
- Modify: `src/content/index.ts:33-64, 91-109, 169-216, 226-272`

**Interfaces:**
- Consumes: guard `gen` (T1), `cacheKey` (T8).
- Produces: `requestTranslation` pasa a devolver `Promise<{ result: TranslationResponse; cached: boolean }>`; `flushStats(): Promise<void>` con merge read-modify-write por deltas.

- [ ] **Step 1: Reescribir el bloque de stats por deltas**

En `src/content/index.ts`, reemplazar TODO el bloque de stats (líneas 33-64: interfaz `UsageStats`, `stats`, `statsWriteCount`, `STATS_PERSIST_INTERVAL`, `loadStats`, `recordCacheHit`, `recordTranslation`, `persistStats`) por:

```ts
interface UsageStats {
  wordsTranslated: number;
  cacheHits: number;
  topLanguages: Record<string, number>;
}

let pendingStats: UsageStats = { wordsTranslated: 0, cacheHits: 0, topLanguages: {} };
let pendingStatsCount = 0;
const STATS_PERSIST_INTERVAL = 10;

function recordCacheHit(): void {
  pendingStats.cacheHits++;
  pendingStats.wordsTranslated++;
  maybeFlushStats();
}

function recordTranslation(sourceLang: string): void {
  pendingStats.wordsTranslated++;
  pendingStats.topLanguages[sourceLang] = (pendingStats.topLanguages[sourceLang] || 0) + 1;
  maybeFlushStats();
}

function maybeFlushStats(): void {
  pendingStatsCount++;
  if (pendingStatsCount >= STATS_PERSIST_INTERVAL) {
    void flushStats();
  }
}

async function flushStats(): Promise<void> {
  if (pendingStats.wordsTranslated === 0 && pendingStats.cacheHits === 0) return;
  const deltas = pendingStats;
  pendingStats = { wordsTranslated: 0, cacheHits: 0, topLanguages: {} };
  pendingStatsCount = 0;
  try {
    const data = await chrome.storage.local.get("usageStats");
    const stored = data.usageStats as UsageStats | undefined;
    const merged: UsageStats =
      stored && typeof stored.wordsTranslated === "number"
        ? { ...stored, topLanguages: stored.topLanguages || {} }
        : { wordsTranslated: 0, cacheHits: 0, topLanguages: {} };
    merged.wordsTranslated += deltas.wordsTranslated;
    merged.cacheHits += deltas.cacheHits;
    for (const [lang, count] of Object.entries(deltas.topLanguages)) {
      merged.topLanguages[lang] = (merged.topLanguages[lang] || 0) + count;
    }
    await chrome.storage.local.set({ usageStats: merged });
  } catch {
    // storage inaccesible (contexto invalidado): se descartan estos deltas
  }
}

window.addEventListener("pagehide", () => {
  void flushStats();
});
```

En `loadSettings`, ELIMINAR `"usageStats"` del array de `get` y la línea `loadStats(data.usageStats);` (ya no se carga estado absoluto).

- [ ] **Step 2: Propagar el flag `cached` del SW**

Reemplazar `requestTranslation` completa (líneas 226-272) por (nota: solo cambian el tipo de retorno y el handler; los reintentos quedan igual, incluida la adición de T6):

```ts
interface TranslationOutcome {
  result: TranslationResponse;
  cached: boolean;
}

async function requestTranslation(
  text: string,
  sentence: string,
  targetLang: string,
  mode: "quick" | "learning",
  signal: AbortSignal
): Promise<TranslationOutcome> {
  const sendWithRetry = async (attempt: number): Promise<TranslationOutcome> => {
    if (signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    return new Promise((resolve, reject) => {
      const handler = (message: {
        success: boolean;
        data?: TranslationResponse;
        error?: string;
        cached?: boolean;
      }) => {
        if (message.success && message.data) {
          resolve({ result: message.data, cached: message.cached === true });
        } else {
          reject(new Error(message.error || "Translation failed"));
        }
      };

      chrome.runtime.sendMessage(
        {
          type: "TRANSLATE",
          payload: { text, sentence, targetLang, mode },
        },
        (response) => {
          if (chrome.runtime.lastError) {
            const msg = chrome.runtime.lastError.message || "";
            if (
              attempt < 6 &&
              (msg.includes("Extension context invalidated") ||
                msg.includes("receiving end does not exist") ||
                msg.includes("message port closed"))
            ) {
              const delay = 300 * Math.pow(2, attempt);
              setTimeout(() => {
                sendWithRetry(attempt + 1).then(resolve).catch(reject);
              }, delay);
              return;
            }
            reject(new Error(msg));
            return;
          }
          handler(response);
        }
      );
    });
  };

  return sendWithRetry(0);
}
```

- [ ] **Step 3: Adaptar onHoverReady al nuevo tipo y contar la ruta dedup**

En `onHoverReady`, el bloque dedup (`existingPromise`) pasa a contar como cache hit:

```ts
  if (existingPromise) {
    renderer.show(x, y, extracted.word, {} as TranslationResponse, true);

    existingPromise
      .then((result) => {
        recordCacheHit();
        if (gen !== requestGeneration) return;
        renderer.updateContent(extracted.word, result);
      })
      .catch(() => {
        if (gen !== requestGeneration) return;
        wordHighlight.hide();
        renderer.updateError(extracted.word, "No se pudo traducir. Inténtalo de nuevo.");
      });
    return;
  }
```

Y el bloque principal (integrando T1, T2 y T8):

```ts
  currentAbortController = new AbortController();

  renderer.show(x, y, extracted.word, {} as TranslationResponse, true);

  const outcomePromise = requestTranslation(
    extracted.word,
    extracted.sentence,
    currentTargetLang,
    currentMode,
    currentAbortController.signal
  );

  const resultPromise = outcomePromise.then((o) => o.result);
  resultPromise.catch(() => {
    // evita "unhandled rejection" cuando nadie está suscrito al pending
  });
  l1Cache.setPending(cacheKey, resultPromise);

  outcomePromise
    .then(({ result, cached }) => {
      l1Cache.set(cacheKey, result);
      if (cached) {
        recordCacheHit();
      } else {
        recordTranslation(result.sourceLanguage);
      }
      if (gen !== requestGeneration) return;
      renderer.updateContent(extracted.word, result);
    })
    .catch((err) => {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      if (gen !== requestGeneration) return;
      wordHighlight.hide();
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("API key not configured")) {
        renderer.updateError(extracted.word, "Configura tu API key de Groq en el popup de HoverLingo");
      } else if (msg.includes("timed out")) {
        renderer.updateError(extracted.word, "La traducción tardó demasiado. Inténtalo de nuevo.");
      } else {
        renderer.updateError(extracted.word, "No se pudo traducir. Inténtalo de nuevo.");
      }
    });
```

(La llamada a `hoverDetector.notifyTranslationComplete()` desaparece aquí; T16 elimina el método.)

- [ ] **Step 4: Verificar**

Run: `npm test` → verdes. Run: `npm run build` → OK.
Manual: traducir 3 palabras en una pestaña, navegar a otra página, abrir el popup → Expected: "words translated" incluye las 3 (flush en pagehide). Repetir una palabra tras >30 min o desde otra pestaña incrementa el hit rate.

- [ ] **Step 5: Commit**

```bash
git add src/content/index.ts
git commit -m "fix: delta-based stats with pagehide flush; count L2 and dedup hits as cache hits"
```

---

### Task 10: Per-site disable coherente en iframes + toast único — MEDIA

**Files:**
- Modify: `src/background/service-worker.ts:242-248`
- Modify: `src/content/index.ts:27-29, 107, 132, 136`

**Interfaces:**
- Produces: mensaje `{ type: "GET_TAB_HOST" }` → respuesta `{ host: string }` (hostname de la URL top-level de la pestaña, `""` si no disponible); variable de módulo `effectiveHostname` en el content script.

- [ ] **Step 1: Responder GET_TAB_HOST en el SW**

En `src/background/service-worker.ts`, reemplazar el listener `onMessage` (líneas 242-248) por:

```ts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "TRANSLATE") {
    handleTranslate(message.payload, sendResponse);
    return true;
  }
  if (message.type === "GET_TAB_HOST") {
    let host = "";
    try {
      if (sender.tab?.url) {
        host = new URL(sender.tab.url).hostname;
      }
    } catch {
      // URL no parseable: devolvemos ""
    }
    sendResponse({ host });
    return false;
  }
  return false;
});
```

- [ ] **Step 2: Resolver el hostname efectivo en el content script**

En `src/content/index.ts`:

1. Añadir junto a las variables de módulo:

```ts
let effectiveHostname = window.location.hostname;

async function resolveEffectiveHostname(): Promise<void> {
  if (window === window.top) return;
  try {
    // frame same-origin: podemos leer el top directamente
    effectiveHostname = window.top!.location.hostname;
    return;
  } catch {
    // cross-origin: se lo pedimos al service worker
  }
  try {
    const resp = (await chrome.runtime.sendMessage({ type: "GET_TAB_HOST" })) as
      | { host?: string }
      | undefined;
    if (resp && typeof resp.host === "string" && resp.host) {
      effectiveHostname = resp.host;
    }
  } catch {
    // SW no disponible: conservamos el hostname del frame
  }
}
```

2. Reemplazar el arranque (líneas 27-29):

```ts
resolveEffectiveHostname()
  .then(loadSettings)
  .then(() => {
    hoverDetector.init();
  });
```

3. Reemplazar las DOS comparaciones `disabledSites.includes(window.location.hostname)` (en `loadSettings` y en el listener `onChanged`) por `disabledSites.includes(effectiveHostname)`.

4. Mostrar el toast solo en el frame principal — en el branch `changes.enabled` del listener:

```ts
  if (changes.enabled) {
    currentEnabled = changes.enabled.newValue;
    updateDetectorEnabled();
    if (window === window.top) {
      showToast(currentEnabled ? "HoverLingo: Activado" : "HoverLingo: Desactivado");
    }
  }
```

- [ ] **Step 3: Verificar**

Run: `npm test` → verdes. Run: `npm run build` → OK.
Manual: en una página con un iframe cross-origin (p. ej. un embed de YouTube), deshabilitar el sitio desde el popup → Expected: el hover deja de traducir también dentro del iframe. Ctrl+Shift+K → Expected: un único toast.

- [ ] **Step 4: Commit**

```bash
git add src/background/service-worker.ts src/content/index.ts
git commit -m "fix: per-site disable uses top-level hostname in all frames; single toast per tab"
```

---

### Task 11: Fallback cuando el modelo guardado no está en el catálogo — MEDIA

**Files:**
- Modify: `src/popup/popup.ts:108-117`

- [ ] **Step 1: Detectar y corregir la asignación silenciosa del select**

En `loadSettings` de `src/popup/popup.ts`, reemplazar (líneas 110-111):

```ts
  modelSelect.value = data.groqModel || GROQ_MODEL;
  targetLangSelect.value = data.targetLang || "es";
```

por:

```ts
  const storedModel: string = data.groqModel || GROQ_MODEL;
  modelSelect.value = storedModel;
  if (modelSelect.value !== storedModel) {
    // el modelo guardado ya no existe en el catálogo: volvemos al default y lo persistimos
    modelSelect.value = GROQ_MODEL;
    await chrome.storage.local.set({ groqModel: GROQ_MODEL });
  }

  const storedLang: string = data.targetLang || "es";
  targetLangSelect.value = storedLang;
  if (targetLangSelect.value !== storedLang) {
    targetLangSelect.value = "es";
    await chrome.storage.local.set({ targetLang: "es" });
  }
```

- [ ] **Step 2: Verificar**

Run: `npm test` → verdes. Run: `npm run build` → OK.
Manual: con DevTools del popup, `chrome.storage.local.set({groqModel: "modelo/inexistente"})`, reabrir popup → Expected: select muestra "Qwen 3.6 27B" y el storage queda corregido (el SW ya no usará el modelo inexistente).

- [ ] **Step 3: Commit**

```bash
git add src/popup/popup.ts
git commit -m "fix: reset stored model/language to default when absent from catalog"
```

---

### Task 12: `confidence` ausente — normalizar y validar siempre el script — BAJA

**Files:**
- Modify: `src/background/service-worker.ts:219-223, 319-321`

- [ ] **Step 1: Normalizar confidence al parsear**

En `callGroq`, tras el check de campos requeridos (líneas 219-221), añadir:

```ts
  if (typeof parsed.confidence !== "number" || Number.isNaN(parsed.confidence)) {
    parsed.confidence = 0.5;
  }
```

- [ ] **Step 2: Validar el script SIEMPRE**

En `handleTranslate`, reemplazar (líneas 319-321):

```ts
    if (result.confidence > 0 && !validateTranslationScript(result.translation, targetLang)) {
      result.confidence = 0;
    }
```

por:

```ts
    if (!validateTranslationScript(result.translation, targetLang)) {
      result.confidence = 0;
    }
```

- [ ] **Step 3: Verificar y commit**

Run: `npm test` → verdes. Run: `npm run build` → OK.

```bash
git add src/background/service-worker.ts
git commit -m "fix: default missing confidence and always run script validation"
```

---

### Task 13: Export con defaults completos — BAJA

**Files:**
- Modify: `src/popup/popup.ts:119-137`

- [ ] **Step 1: Fusionar defaults en el objeto exportado**

Reemplazar el cuerpo del `.then` de `exportSettings` (líneas 127-136) por:

```ts
    const full = {
      groqModel: GROQ_MODEL,
      targetLang: "es",
      translationMode: "quick",
      hoverDelay: 300,
      enabled: true,
      disabledSites: [] as string[],
      ...data,
    };
    const blob = new Blob([JSON.stringify(full, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "hoverlingo-settings.json";
    a.click();
    URL.revokeObjectURL(url);
    showStatus("Exported", "success");
```

- [ ] **Step 2: Verificar y commit**

Run: `npm run build` → OK. Manual: en instalación fresca, Export → el JSON contiene los 6 campos; Import del mismo archivo → "Imported".

```bash
git add src/popup/popup.ts
git commit -m "fix: export complete settings snapshot so fresh exports round-trip"
```

---

### Task 14: Hint de atajo dinámico — BAJA

**Files:**
- Modify: `src/popup/popup.ts:267`

- [ ] **Step 1: Leer el atajo real de chrome.commands**

Reemplazar la línea final `shortcutHint.textContent = "Shortcut: Ctrl+Shift+K";` por:

```ts
chrome.commands.getAll((commands) => {
  const cmd = commands.find((c) => c.name === "toggle-hoverlingo");
  shortcutHint.textContent = cmd && cmd.shortcut
    ? `Shortcut: ${cmd.shortcut}`
    : "Shortcut: sin asignar (chrome://extensions/shortcuts)";
});
```

- [ ] **Step 2: Verificar y commit**

Run: `npm run build` → OK. Manual: popup muestra el atajo real; tras desasignarlo en chrome://extensions/shortcuts muestra "sin asignar".

```bash
git add src/popup/popup.ts
git commit -m "fix: display actual keyboard shortcut from chrome.commands"
```

---

### Task 15: Limpieza de tipos compartidos — BAJA

**Files:**
- Modify: `src/shared/types.ts:25-33`
- Modify: `src/content/cache-l1.ts:1-16`

- [ ] **Step 1: Corregir StorageData**

En `src/shared/types.ts`, reemplazar la interfaz `StorageData` (líneas 25-33) por:

```ts
export interface StorageData {
  groqApiKey?: string;
  groqModel?: string;
  targetLang?: string;
  translationMode?: TranslationMode;
  disabledSites?: string[];
  hoverDelay?: number;
  enabled?: boolean;
  usageStats?: {
    wordsTranslated: number;
    cacheHits: number;
    topLanguages: Record<string, number>;
  };
}
```

- [ ] **Step 2: Unificar TranslationResponse**

En `src/content/cache-l1.ts`, ELIMINAR la interfaz local `TranslationResponse` (líneas 6-16) y reemplazar la cabecera del archivo por:

```ts
import type { TranslationResponse } from "../shared/types";

export type { TranslationResponse } from "../shared/types";

interface CachedEntry {
  response: TranslationResponse;
  timestamp: number;
}
```

(El re-export mantiene funcionando los imports existentes de `index.ts` y `tooltip-renderer.ts` sin tocarlos.)

- [ ] **Step 3: Verificar y commit**

Run: `npm test` → verdes. Run: `npm run build` → OK (strict detectaría cualquier import roto).

```bash
git add src/shared/types.ts src/content/cache-l1.ts
git commit -m "refactor: fix StorageData schema drift and deduplicate TranslationResponse"
```

---

### Task 16: Eliminar el estado muerto "translating" — BAJA

**Files:**
- Modify: `src/content/hover-detector.ts:5, 142-146`
- Modify: `src/content/index.ts` (verificar que no queda ninguna llamada)

- [ ] **Step 1: Eliminar el estado y el método no-op**

En `src/content/hover-detector.ts`:

1. Línea 5: `export type HoverState = "idle" | "hovering";`
2. ELIMINAR el método `notifyTranslationComplete` (líneas 142-146).

En `src/content/index.ts`: confirmar que ya no existe ninguna llamada a `hoverDetector.notifyTranslationComplete()` (T9 la eliminó al reescribir el bloque; si queda alguna, borrarla).

- [ ] **Step 2: Verificar y commit**

Run: `npm test` → verdes. Run: `npm run build` → OK (el compilador falla si quedó alguna referencia).

```bash
git add src/content/hover-detector.ts src/content/index.ts
git commit -m "refactor: remove dead translating state and no-op notifyTranslationComplete"
```

---

## Verificación global final

- [ ] `npm test` → todos los tests pasan (26 originales ajustados + ~20 nuevos).
- [ ] `npm run build` → build de producción sin errores ni warnings de TypeScript.
- [ ] Cargar `dist/` como unpacked, recargar la extensión y **cerrar/reabrir pestañas**.
- [ ] Smoke test manual:
  - Sin API key: hover → tooltip muestra el mensaje de configuración (no desaparición silenciosa).
  - Con API key: hover traduce; hover rápido A→B nunca muestra la traducción de A sobre B.
  - Seleccionar texto y hover FUERA de la selección → traduce la palabra bajo el cursor, no la selección.
  - Cambiar de modelo en el popup y re-traducir la misma palabra → la traducción se regenera (clave de caché nueva).
  - Ctrl+Shift+K → un solo toast por pestaña; el popup y el toggle reflejan el estado.
  - Deshabilitar un sitio con iframes → el hover muere también dentro de los iframes.
  - Export → Import del archivo exportado → "Imported"; import de `{"disabledSites":{}}` → "Invalid settings file".
  - Traducir 3 palabras, navegar, abrir popup → stats las incluyen.
- [ ] Revisión final de la rama: `git log --oneline` muestra ~16 commits atómicos.
