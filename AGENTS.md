# HoverLingo — AGENTS.md

## Overview

HoverLingo is a Chrome Extension (Manifest V3) that translates words/phrases on hover using Groq API. The tooltip appears near the cursor showing the translation with context-aware disambiguation.

**Current state:** Fase 4 (2026-07-03). All 4 implementation phases complete. 26 unit tests passing. Remaining tasks are future improvements (icons, i18n, web store, cross-tab cache, crxjs stable).

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
│   │   └── prompts.ts                    # buildSystemPrompt(), buildUserPrompt()
│   ├── background/
│   │   ├── service-worker.ts             # Message router + Groq API (timeout 30s, 429/5xx retry) + commands listener + extractJson() + validateTranslationScript()
│   │   └── cache-l2.ts                   # L2 cache: chrome.storage.local, LRU, 5000 entries, TTL 24h
│   ├── content/
│   │   ├── index.ts                      # Entry point, orchestrator, retry logic (6 attempts, exp backoff), stats tracking, word highlight
│   │   ├── hover-detector.ts             # Debounce 300ms, mouse/keyboard/scroll events, state machine, setEnabled(), MutationObserver (SPA support)
│   │   ├── text-extractor.ts             # caretRangeFromPoint, word expansion, sentence extraction, text selection, getWordRangeAt()
│   │   ├── tooltip-renderer.ts           # Floating UI positioning, dark/light/RTL, skeleton loader, accessibility
│   │   ├── cache-l1.ts                   # L1 cache: Map, LRU, 1000 entries, TTL 30min, dedup of in-flight requests
│   │   ├── word-highlight.ts             # Yellow overlay highlighting on hovered word via Range.getClientRects()
│   │   └── styles.css                    # Tooltip styles: animations, themes, RTL, scrollbar
│   ├── popup/
│   │   ├── index.html                    # Settings UI: model, language, mode, delay, toggles (global + per-site), stats cards, export/import buttons
│   │   ├── popup.ts                      # Direct chrome.storage.local read/write (no SW dep), stats display, export/import
│   │   └── popup.css                     # Dark theme popup styles + toggle switch + stats cards + action buttons
│   └── __tests__/
│       ├── cache-l1.test.ts              # 7 tests: get/set, lang/mode isolation, TTL expiry, LRU eviction, dedup cleanup
│       ├── cache-l2.test.ts              # 4 tests: get/set, eviction on overflow, key prefix isolation
│       ├── prompts.test.ts               # 10 tests: system prompt, user prompt (quick + learning), language fallback
│       └── text-extractor.test.ts        # 5 tests: selection extraction, truncation, caretRangeFromPoint absence, empty node
└── dist/                                 # Build output (loaded as unpacked extension)
```

### File sizes
- Content script: ~27.2KB minified (~10.2KB gzipped)
- Service worker: ~6.5KB minified (~2.8KB gzipped)
- Popup: ~5.3KB minified (~1.9KB gzipped)
- Total extension: ~45KB minified

---

## Architecture — Data Flow

```
User hovers over text
  │
  ▼
Content Script (index.ts)
  ├── HoverDetector: respects enabled flag + per-site blacklist, debounce 300ms → onHoverReady(x, y)
  ├── TextExtractor: caretRangeFromPoint → word expansion → sentence context | text selection support
  ├── WordHighlight: yellow overlay on hovered word via Range.getClientRects()
  ├── L1 Cache (Map): check if already translated (TTL 30min, 1000 entries)
  │     ├── HIT → render tooltip immediately, record cache hit stat
  │     └── MISS →
  │           ├── Dedup check: is same word+lang+mode already in-flight?
  │           │     └── YES → subscribe to existing Promise
  │           └── NO →
  │                 ├── Show skeleton tooltip
  │                 ├── chrome.runtime.sendMessage({ type: "TRANSLATE", payload })
  │                 │     └── Retry up to 6 times (300ms base, exponential backoff)
  │                 │         if "Extension context invalidated"
  │                 └── On success → L1 set → update tooltip, record translation stat
  │                       On error → hide tooltip
  │
  ▼
Service Worker (service-worker.ts)
  ├── Receive TRANSLATE message
  ├── L2 Cache (chrome.storage.local): check persistent cache (TTL 24h, 5000 entries, LRU eviction)
  │     ├── HIT → return cached result
  │     └── MISS →
  │           ├── Read API key + model from chrome.storage.local
  │           ├── Build prompts: buildSystemPrompt(targetLang) + buildUserPrompt(...)
  │           ├── POST https://api.groq.com/openai/v1/chat/completions
  │           │     { model, temperature: 0.0, max_tokens: 1024/2048, stream: false }
  │           │     └── Timeout 30s (AbortController) + retry 429 (1x, Retry-After) + retry 5xx (2x, exp backoff)
  │           │     NO response_format — not supported by all models (e.g., Qwen)
  │           ├── extractJson() with regex fallback → validate required fields
  │           ├── validateTranslationScript() → Unicode script check against target language (confidence → 0 if mismatch)
  │           ├── L2 set → persist
  │           └── sendResponse to content script
  │
  ▼
Popup (popup.ts)
  ├── Reads/writes directly to chrome.storage.local (no SW dependency)
  ├── Saves on: input (debounce 500ms), change, blur, pagehide
  ├── Settings: groqApiKey, groqModel (7 options), targetLang, translationMode, hoverDelay, enabled (global toggle), disableSiteToggle (per-site blacklist)
  ├── Stats: words translated, cache hit rate %, top 3 source languages
  ├── Actions: export settings to JSON file, import settings from JSON file (API key excluded)
  └── Shows keyboard shortcut hint: "Shortcut: Ctrl+Shift+K"
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
- `max_tokens: 1024` (quick) / `2048` (learning) — generous to avoid truncation without response_format
- `stream: false`
- **No `response_format`** — removed because not all Groq models support it (Qwen, etc.). Relies on prompt JSON instructions + `extractJson()` fallback.

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
2. **API key per user** — stored in chrome.storage.local, set via popup. Never hardcoded.
3. **Popup writes storage directly** — avoids SW lifecycle dependency for saving settings.
4. **Two-level cache** — L1 (Map, memory) for instant hits; L2 (chrome.storage) for persistence across sessions/tabs.
5. **Retry on SW invalidation** — MV3 terminates SW aggressively. Content script retries `sendMessage` up to 6 times with exponential backoff (300ms base, max ~19s total wait).
6. **Model selector in popup** — user picks from 7 Groq models, stored in `chrome.storage.local.groqModel`.
7. **Toggle on/off** — popup has an Enabled switch. HoverDetector.setEnabled() stops all event processing instantly across all tabs.
8. **Per-site disable** — blacklist stored as `disabledSites: string[]`. Content script checks `window.location.hostname` against the list. Site section hidden when global toggle is off.
9. **Floating UI only** — no Tippy.js, no Popper. Minimal deps.
10. **No `response_format`** — removed after discovering it causes 400 errors on unsupported models (Qwen) and intermittent 400s even on supported ones. Uses `extractJson()` with regex fallback instead.
11. **High `max_tokens`** — 1024/2048 to prevent JSON truncation when model outputs preamble text without `response_format`.
12. **Unified Quick+Context** — sentence context always sent (~30 extra tokens, huge disambiguation value).
13. **Request timeout (30s)** — `fetchWithTimeout()` wrapper with `AbortController` prevents hanging on unresponsive API.
14. **API-level retry** — `callGroqWithRetry()` handles 429 (Retry-After, 1 retry) and 5xx (exponential backoff, 2 retries). Non-retriable errors (AbortError/timeout, 400, 401) pass through immediately.
15. **Keyboard shortcut** — `Ctrl+Shift+K` (`Cmd+Shift+K` on Mac) toggles HoverLingo on/off via `chrome.commands`. No need to open popup.
16. **MutationObserver** — watches DOM mutations with 500ms debounce and threshold of 20 nodes. Resets tooltip on SPA navigations (Gmail, Twitter, YouTube).
17. **Translation script validation** — `validateTranslationScript()` checks that translation characters match the target language's expected Unicode script. Reduces confidence to 0 on mismatch (e.g., Latin characters for Arabic target). Only catches cross-script errors; same-script language confusion (French vs Spanish) is not detectable.
18. **Local usage stats** — counters tracked in content script (`wordsTranslated`, `cacheHits`, `topLanguages`), persisted to storage every 10 events. Displayed as cards in popup.
19. **Export/Import settings** — JSON file with all settings (API key excluded). Enables backup and cross-device sync.
20. **Accessibility** — tooltip uses `role="tooltip"` and `aria-live="polite"` for screen readers. RTL support via `dir="rtl"`.
21. **Word highlight** — yellow overlay (`rgba(255, 230, 50, 0.35)`) appears behind the hovered word using `Range.getClientRects()` + `position: fixed` overlays. `pointer-events: none` prevents interaction interference.

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
| Model 404 — wrong ID `qwen-3.6-27b` | Fixed | Correct ID is `qwen/qwen3.6-27b`. Format: `provider/model-name`. |
| Groq 400 — response_format not supported | Fixed | Removed `response_format: json_object`. Not supported by Qwen, intermittent on GPT OSS. |
| JSON truncated (max_tokens: 150) | Fixed | Bumped to 1024 (quick) / 2048 (learning). Without response_format, models may add preamble. |
| JSON parse failures — model outputs non-JSON preamble | Fixed | Added `extractJson()` — tries `JSON.parse` first, then regex extraction of `{...}`. |
| "Extension context invalidated" persistent | Fixed | Retry count 2→6 with exponential backoff (300ms base). Also proper reload process documented. |
| Content script stale after build | Fixed | Must close + reopen tabs after reloading extension. Hard refresh (Ctrl+Shift+R) not enough. |
| No on/off control | Fixed | Toggle switch in popup, wired to HoverDetector.setEnabled() via storage.onChanged. |
| "API key not configured" | Fixed | Popup saves on input (debounced), change, blur, and pagehide. Writes directly to storage. |
| Tooltip always in Arabic (ignoring target lang) | Fixed | System prompt includes target language name 3x + "Never output in any other language." |
| No request timeout — hanging tooltip on slow API | Fixed | `fetchWithTimeout()` with 30s AbortController. Throws clear error on timeout. |
| No retry on Groq errors (429, 5xx) | Fixed | `callGroqWithRetry()`: 429 → 1 retry with `Retry-After` header; 5xx → 2 retries exponential backoff. |
| No keyboard shortcut to toggle | Fixed | `Ctrl+Shift+K` via `chrome.commands` API. SW listens and toggles `enabled` in storage. |
| Tooltip floats on SPA navigation (Gmail, Twitter) | Fixed | `MutationObserver` in HoverDetector — resets state to idle on >20 DOM mutations, hiding tooltip. |

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
4. **After every rebuild:** click the reload icon on the HoverLingo card, then **close and reopen all tabs** (content scripts only inject on page load — hard refresh is NOT enough to get the new content script)

---

## How to Test

```powershell
npm test              # Run all 26 unit tests once
npm run test:watch    # Watch mode
```

Tests use vitest with jsdom for DOM-dependent modules. No browser or extension environment needed.

---

## How to Debug

1. **Page console** (F12): content script runtime errors
2. **SW console** (chrome://extensions → click "service worker" link on HoverLingo card): service worker runtime errors
3. **Extension errors** (chrome://extensions → HoverLingo card → "Errors" button if present)
4. **Verify chunk versions** — page console shows which content script chunk is loaded (`index.ts-XXXXXXXX.js`). Must match the build output. If it's stale, close and reopen the tab.

Note: All `console.log/error/warn` statements have been removed from the production build. Re-add them temporarily if you need debug output.

---

## Vite config

- `minify: true`
- Build target: `es2022`
- Output dir: `dist`

---

## Completed Phases

- [x] **Fase 1 — Polish:** Debug logs removed, minification enabled
- [x] **Fase 2 — Robustez:** Timeout, retry (429/5xx), script validation, MutationObserver, site testing, memory leak test
- [x] **Fase 3 — Pulido UX:** Text selection, per-site toggle, keyboard shortcut, skeleton loader, accessibility, dark mode, scroll/resize
- [x] **Fase 4 — Avanzadas:** Learning mode, usage stats, export/import
- [x] **Tech Debt (partial):** Unit tests (26 tests, 4 modules), TypeScript strict mode

---

## Future Work

- [ ] Cross-tab cache sharing via SW (request collapsing across tabs)
- [ ] Proper extension icons (replace placeholder PNGs)
- [ ] Chrome Web Store listing preparation
- [ ] i18n for extension UI (popup strings in multiple languages)
- [ ] Stats reset button
- [ ] Integration test for SW message handling
- [ ] Migrate to `@crxjs/vite-plugin` stable release when available
