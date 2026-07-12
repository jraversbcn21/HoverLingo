# HoverLingo — AGENTS.md

## Overview

HoverLingo is a Chrome Extension (Manifest V3) that translates words/phrases on hover using Groq API. The tooltip appears near the cursor showing the translation with context-aware disambiguation.

**Current state:** Post-Fase 4 bug fix complete (2026-07-12). 16 pre-production bugs fixed + 2 found during manual QA (Quick mode token truncation, Learning explanation language). 49 unit tests. Ready for Chrome Web Store submission.

---

## Tech Stack

| Tool | Purpose |
|------|---------|
| TypeScript 5.x | All source code (`strict: true`, zero `any` types) |
| Vite 6.x | Build tool (`minify: true`) |
| @crxjs/vite-plugin 2.0.0-beta.28 | Chrome extension plugin for Vite |
| @floating-ui/dom 1.6.x | Tooltip positioning (flip, shift, offset) |
| vitest 3.x | Unit testing (jsdom for DOM tests) |
| Groq API | LLM translation backend |

**No runtime dependencies:** No React, no i18next, no lodash. Only Floating UI (~5KB).

---

## Project Structure

```
hoverlingo/
├── manifest.json                         # MV3 manifest (at project root)
├── package.json
├── tsconfig.json                         # strict: true, target ES2022
├── vite.config.ts                        # Vite + CRXJS (minify: true)
├── public/icons/                         # Placeholder PNG icons (16, 48, 128)
├── src/
│   ├── shared/
│   │   ├── types.ts                      # Interfaces + TARGET_LANGUAGES (30 langs) + StorageData
│   │   ├── constants.ts                  # DEFAULTS, GROQ_API_URL, GROQ_MODEL, AVAILABLE_MODELS (7)
│   │   ├── prompts.ts                    # buildSystemPrompt(), buildUserPrompt()
│   │   ├── cache-key.ts                  # buildCacheKey() with sentence context hash + model
│   │   ├── extract-json.ts               # Robust JSON parser: <think> strip, balanced braces, fences
│   │   └── settings-validation.ts        # sanitizeImportedSettings() with type guards
│   ├── background/
│   │   ├── service-worker.ts             # Message router + Groq API + GET_TAB_HOST + commands + callGroqWithRetry
│   │   └── cache-l2.ts                   # L2 cache: chrome.storage.local, LRU, 5000 entries, TTL 24h
│   ├── content/
│   │   ├── index.ts                      # Entry point, orchestrator, retry (6x exp backoff), delta stats, request gen guard
│   │   ├── hover-detector.ts             # Debounce 300ms, mouse/keyboard/scroll events, state machine, MutationObserver
│   │   ├── text-extractor.ts             # caretRangeFromPoint, word expansion, sentence extraction, selection with hit test
│   │   ├── tooltip-renderer.ts           # Floating UI positioning, dark/light/RTL, skeleton, error feedback, accessibility
│   │   ├── cache-l1.ts                   # L1 cache: Map, key-based API, LRU, 1000 entries, TTL 30min, dedup
│   │   ├── word-highlight.ts             # Yellow overlay highlighting on hovered word via Range.getClientRects()
│   │   └── styles.css                    # Tooltip styles: animations, themes, RTL, errors, scrollbar
│   ├── popup/
│   │   ├── index.html                    # Settings UI: model, language, mode, delay, toggles, stats, export/import
│   │   ├── popup.ts                      # Direct storage access, dynamic shortcut, guarded API key writes
│   │   └── popup.css                     # Dark theme popup styles + toggle switch + stats cards + action buttons
│   └── __tests__/
│       ├── cache-l1.test.ts              # 8 tests: key-based API, lang/mode/context isolation, TTL, LRU, dedup
│       ├── cache-l2.test.ts              # 4 tests: get/set, eviction on overflow, key prefix isolation
│       ├── prompts.test.ts               # 11 tests: system prompt, user prompt (quick + learning), language fallback, explanation language
│       ├── text-extractor.test.ts        # 6 tests: selection hit test, truncation, caretRangeFromPoint absence
│       ├── cache-key.test.ts             # 5 tests: determinism, context/model/lang/mode isolation, empty hash
│       ├── extract-json.test.ts          # 8 tests: think blocks, fences, nested braces, trailing text, truncated
│       └── settings-validation.test.ts   # 7 tests: valid shapes, type rejection, clamping, allowlist
└── dist/                                 # Build output (loaded as unpacked extension)
```

---

## Architecture — Data Flow

```
User hovers over text
  │
  ▼
Content Script (index.ts)
  ├── HoverDetector: respects enabled flag + per-site blacklist, debounce 300ms → onHoverReady(x, y)
  ├── TextExtractor: caretRangeFromPoint → word expansion → sentence context | selection with hit test
  ├── WordHighlight: yellow overlay on hovered word via Range.getClientRects()
  ├── Request generation guard: discards stale responses from previous hovers
  ├── L1 Cache (Map): check if already translated (key = text|hash(sentence)|lang|mode|model, TTL 30min)
  │     ├── HIT → render tooltip immediately, record cache hit stat (delta)
  │     └── MISS →
  │           ├── Dedup check: is same key already in-flight?
  │           │     └── YES → subscribe to existing Promise, count as cache hit
  │           └── NO →
  │                 ├── Show skeleton tooltip
  │                 ├── chrome.runtime.sendMessage({ type: "TRANSLATE", payload })
  │                 │     └── Retry up to 6 times (300ms base, exponential backoff)
  │                 │         on "Extension context invalidated", "receiving end does not exist", "message port closed"
  │                 └── On success → L1 set → update tooltip, record translation stat (delta)
  │                       On error → show error message in tooltip (API key, timeout, generic)
  │
  ▼
Service Worker (service-worker.ts)
  ├── Receive TRANSLATE message
  ├── L2 Cache (chrome.storage.local): key = text|hash(sentence)|lang|mode|model (TTL 24h, 5000 entries)
  │     ├── HIT → return cached result (propagates cached:true to content script)
  │     └── MISS →
  │           ├── Read API key + model from chrome.storage.local
  │           ├── Build prompts: buildSystemPrompt(targetLang) + buildUserPrompt(...)
  │           ├── POST https://api.groq.com/openai/v1/chat/completions
  │           │     { model, temperature: 0.0, max_tokens: 2048, stream: false }
  │           │     Qwen models: reasoning_format = "hidden"
  │           │     └── Timeout 30s (AbortController) + retry 429 (1x, capped 10s Retry-After) + retry 5xx (2x)
  │           ├── extractJson() with <think> strip + balanced brace extraction
  │           ├── confidence: defaults to 0.5 if missing; always runs validateTranslationScript()
  │           ├── L2 set → persist
  │           └── sendResponse to content script
  │
  ▼
Popup (popup.ts)
  ├── Reads/writes directly to chrome.storage.local (no SW dependency)
  ├── Saves on: input (debounce 500ms, only if settingsLoaded + apiKeyDirty), change, blur, pagehide (guarded)
  ├── Settings: groqApiKey, groqModel (7 options), targetLang, translationMode, hoverDelay, enabled, disableSiteToggle
  ├── Import: validates types via sanitizeImportedSettings(); Export: includes all 6 defaults
  ├── Model fallback: resets to default if stored model absent from catalog
  ├── Stats: words translated, cache hit rate %, top 3 source languages
  └── Dynamic shortcut hint read from chrome.commands
```

---

## Prompt Design

### System Prompt
Built dynamically per target language:
> "You are a Spanish translator. Your sole job is to translate the user's text into Spanish. Always respond with valid JSON only. Never output text in any language other than Spanish in the 'translation' field."

### User Prompt (Quick mode)
> "Translate the following word into Spanish.
>
> WORD: "bank"
> CONTEXT: "The bank is near the river."
>
> The translation must be in Spanish. Return JSON: {...}
>
> RULES:
> - "translation" MUST be in Spanish. Never return the original word.
> - "direction": "rtl" only if the TRANSLATION text uses Arabic, Hebrew, Persian, or Urdu script.
> - "confidence": 0.0 to 1.0. Lower if context doesn't help.
> - Include alternatives only if truly ambiguous."

### JSON Response
```json
{
  "translation": "orilla",
  "sourceLanguage": "en",
  "direction": "ltr",
  "confidence": 0.96,
  "alternatives": ["ribera"]
}
```

Learning mode adds: `pronunciation`, `partOfSpeech`, `explanation`, `example`.

### API Parameters
- `temperature: 0.0` — deterministic for caching
- `max_tokens: 2048` (both modes) — reasoning models spend part of the budget on hidden `<think>` reasoning; 1024 was truncating Quick-mode responses before any visible content was emitted
- `stream: false`
- **No `response_format`** — removed (not supported by Qwen). Relies on `extractJson()` with balanced brace extraction.
- **Qwen models** get `reasoning_format: "hidden"` to suppress `<think>` blocks.

---

## Available Models (selector in popup)

| Model ID | Display Name |
|---|---|
| `qwen/qwen3.6-27b` | Qwen 3.6 27B (default) |
| `qwen/qwen3-32b` | Qwen 3 32B |
| `openai/gpt-oss-120b` | GPT OSS 120B |
| `openai/gpt-oss-20b` | GPT OSS 20B |
| `llama-3.3-70b-versatile` | Llama 3.3 70B |
| `meta-llama/llama-4-scout-17b-16e-instruct` | Llama 4 Scout 17B |
| `llama-3.1-8b-instant` | Llama 3.1 8B |

Defined in `src/shared/constants.ts` → `AVAILABLE_MODELS`. Model ID format: `provider/model-name`.

---

## Key Design Decisions

1. **No backend** — SW calls Groq directly. No CORS issues (SW is exempt).
2. **API key per user** — stored in chrome.storage.local, set via popup. Never hardcoded, never exported.
3. **Popup writes storage directly** — avoids SW lifecycle dependency for saving settings.
4. **Two-level cache** — L1 (Map, memory) for instant hits; L2 (chrome.storage) for persistence across sessions/tabs. Cache key includes `text|hash(sentence)|targetLang|mode|model` for proper disambiguation.
5. **Retry on SW invalidation** — MV3 terminates SW aggressively. Content script retries up to 6x with exponential backoff (300ms base). Also retries on "message port closed".
6. **Model selector in popup** — user picks from 7 Groq models. Stored model validated on popup open; reset to default if absent from catalog.
7. **Toggle on/off** — popup has an Enabled switch. HoverDetector.setEnabled() stops all event processing.
8. **Per-site disable** — blacklist stored as `disabledSites: string[]`. Uses top-level hostname via same-origin check + SW fallback for cross-origin iframes. Toast only in top frame.
9. **Floating UI only** — no Tippy.js, no Popper. Minimal deps.
10. **No `response_format`** — removed (causes 400 on Qwen). Uses `extractJson()` with balanced brace extraction.
11. **High `max_tokens`** — 2048 for both modes to prevent JSON truncation; reasoning models (Qwen) consume part of the budget on hidden reasoning even with `reasoning_format: "hidden"`, so Quick mode's lower 1024 was truncating responses before any visible content.
12. **Unified Quick+Context** — sentence context always sent (~30 extra tokens, huge disambiguation value).
13. **Request timeout (30s)** — `fetchWithTimeout()` with AbortController.
14. **API-level retry** — `callGroqWithRetry()`: 429 (1x, capped 10s Retry-After), 5xx (2x exp backoff).
15. **Keyboard shortcut** — `Ctrl+Shift+K` toggles HoverLingo on/off via `chrome.commands`. Popup reads actual shortcut dynamically.
16. **MutationObserver** — watches DOM with 500ms debounce, resets tooltip on SPA navigations.
17. **Translation script validation** — validates Unicode script against target language, sets confidence to 0 on mismatch. Always runs (confidence may be absent from model).
18. **Local usage stats** — delta-based counters flushed every 10 events and on pagehide, with read-modify-write merge.
19. **Export/Import settings** — JSON file with all 6 settings (API key excluded). Import validates types; export includes defaults.
20. **Accessibility** — tooltip uses `role="tooltip"` and `aria-live="polite"`. RTL via `dir="rtl"`.
21. **Word highlight** — yellow overlay behind hovered word via `Range.getClientRects()` + `position: fixed`.
22. **Error feedback** — tooltip shows descriptive error instead of disappearing (API key, timeout, generic).
23. **Request generation guard** — stale responses from previous hovers are discarded; cache is populated regardless.

---

## Storage Schema

All data in `chrome.storage.local`:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `groqApiKey` | `string` | `""` | User's Groq API key (never exported) |
| `groqModel` | `string` | `qwen/qwen3.6-27b` | Active Groq model ID |
| `targetLang` | `string` | `es` | ISO 639-1 target language code |
| `translationMode` | `string` | `quick` | `"quick"` or `"learning"` |
| `hoverDelay` | `number` | `300` | Debounce delay in ms (100-1000) |
| `enabled` | `boolean` | `true` | Global on/off toggle |
| `disabledSites` | `string[]` | `[]` | Hostnames where extension is disabled |
| `usageStats` | `{wordsTranslated, cacheHits, topLanguages}` | `{}` | Accumulated usage counters |
| `hl_cache_*` | `{response, timestamp}` | — | L2 cache entries (5000 max) |

---

## Known Issues & Fixes Applied

| Issue | Status | Fix |
|-------|--------|-----|
| Model ID wrong (`qwen-3.6-27b`) | Fixed | Correct ID is `qwen/qwen3.6-27b` |
| `response_format` not supported | Fixed | Removed; uses `extractJson()` with balanced brace extraction |
| JSON truncated (max_tokens: 150) | Fixed | Bumped to 1024/2048 |
| Non-JSON preamble from model | Fixed | `extractJson()` strips `<think>`, fences, balanced braces |
| "Extension context invalidated" persistent | Fixed | Retry 6x with exp backoff; close+reopen tabs after reload |
| Content script stale after build | Fixed | Must close + reopen tabs (hard refresh not enough) |
| No on/off control | Fixed | Toggle switch in popup, wired via storage.onChanged |
| "API key not configured" | Fixed | Popup saves on input/blur/change/pagehide (guarded) |
| Tooltip ignores target language | Fixed | System prompt names target language 3x |
| No request timeout | Fixed | `fetchWithTimeout()` with 30s AbortController |
| No retry on Groq errors | Fixed | 429 (capped 10s) + 5xx (2x exp backoff) |
| No keyboard shortcut | Fixed | `Ctrl+Shift+K` via `chrome.commands`; dynamic popup hint |
| Tooltip floats on SPA navigation | Fixed | MutationObserver resets to idle on DOM changes |
| Stale responses overwrite wrong tooltip | Fixed | Request generation counter; stale callbacks skipped |
| SW errors silently hide tooltip | Fixed | Error message rendered in tooltip (API key/timeout/generic) |
| Import has no type validation | Fixed | `sanitizeImportedSettings()` validates types and clamps ranges |
| Selection hijacks all hovers | Fixed | Selection only applies when cursor is inside its bounding rect |
| `pagehide`/blur wipes API key | Fixed | Guarded with `settingsLoaded` + `apiKeyDirty` flags |
| 429 Retry-After unbounded | Fixed | Capped at 10s; "message port closed" added to retry allowlist |
| Qwen `<think>` blocks break JSON | Fixed | `extractJson()` strips `<think>...</think>`; `reasoning_format: "hidden"` |
| Cache key missing context + model | Fixed | Key = `text\|hash(sentence)\|lang\|mode\|model` |
| Stats: read-modify-write race | Fixed | Delta-based flush every 10 events + pagehide; L2/dedup hits counted |
| Per-site disable broken in iframes | Fixed | Top-level hostname via same-origin + SW GET_TAB_HOST fallback |
| Model absent from catalog | Fixed | Popup resets to default on open if stored model not in select |
| `confidence` absent from response | Fixed | Defaults to 0.5; script validation always runs |
| Export empty on fresh install | Fixed | Export fuses defaults; round-trip from empty storage works |
| Hardcoded shortcut hint | Fixed | Reads actual shortcut from `chrome.commands.getAll()` |
| `StorageData.enabledSites` drift | Fixed | Schema corrected to `disabledSites`; added `usageStats` |
| Dead "translating" state | Fixed | Removed from hover-detector type and `notifyTranslationComplete()` |
| Quick mode always fails ("Empty response"/truncated JSON) | Fixed | `max_tokens` was 1024; reasoning model's hidden `<think>` spent the whole budget before emitting content (confirmed via `finish_reason: "length"`). Raised to 2048 for both modes. |
| Learning mode explanation returned in English despite target language | Fixed | Prompt only required `translation` to be in the target language; added explicit rule requiring `explanation` in `${langName}` too |

---

## How to Build & Load

```powershell
cd C:\repositorio\hoverlingo
npm run build
```

Then in Chrome:
1. `chrome://extensions`
2. Enable "Developer mode"
3. "Load unpacked" → select `C:\repositorio\hoverlingo\dist`
4. **After every rebuild:** click the reload icon on the HoverLingo card, then **close and reopen all tabs** (content scripts only inject on page load — hard refresh is NOT enough)

---

## How to Test

```powershell
npm test              # Run all 49 unit tests once
npm run test:watch    # Watch mode
```

Tests use vitest with jsdom for DOM-dependent modules. No browser or extension environment needed.

---

## How to Debug

1. **Page console** (F12): content script runtime errors
2. **SW console** (chrome://extensions → click "service worker" link on HoverLingo card): service worker runtime errors
3. **Extension errors** (chrome://extensions → HoverLingo card → "Errors" button if present)
4. **Verify chunk versions** — page console shows which content script chunk is loaded. Must match build output.

Note: All `console.log/error/warn` statements removed from production build.

---

## Vite config

- `minify: true`
- Build target: `es2022`
- Output dir: `dist`

---

## Completed Phases

- [x] **Fase 1 — Polish:** Debug logs removed, minification enabled
- [x] **Fase 2 — Robustez:** Timeout, retry (429/5xx), script validation, MutationObserver
- [x] **Fase 3 — Pulido UX:** Text selection, per-site toggle, keyboard shortcut, skeleton, accessibility, dark mode
- [x] **Fase 4 — Avanzadas:** Learning mode, usage stats, export/import
- [x] **Fase 5 — Bug Fix (2026-07-12):** 16 pre-production bugs fixed (3 high, 8 medium, 5 low). 22 new tests. See commits `0622b6a..bf83940`.
- [x] **Fase 6 — Manual QA Fix (2026-07-12):** 2 bugs found during manual verification of the Fase 5 build: Quick mode `max_tokens` truncation and Learning mode explanation language. 1 new test.

---

## Future Work

- [ ] Cross-tab cache sharing via SW (request collapsing across tabs)
- [ ] Proper extension icons (replace placeholder PNGs)
- [ ] Chrome Web Store listing preparation
- [ ] i18n for extension UI (popup strings in multiple languages)
- [ ] Stats reset button
- [ ] Integration test for SW message handling
- [ ] Migrate to `@crxjs/vite-plugin` stable release when available
