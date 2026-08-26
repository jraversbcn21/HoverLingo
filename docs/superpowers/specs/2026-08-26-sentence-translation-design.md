# Traducción de frase completa desde el tooltip — Diseño

**Fecha:** 2026-08-26
**Estado:** aprobado por el usuario (conversación de brainstorming)

## Problema

Al hacer hover sobre una palabra, HoverLingo traduce solo esa palabra. El usuario
quiere poder obtener también la traducción de la frase/línea completa que la
contiene (ej.: una línea sobre políticas de privacidad en árabe — el hover da
"guardar" pero no el sentido de la línea entera).

Además, la extracción de frase actual (`extractSentence` en
`src/content/text-extractor.ts`) opera sobre un único nodo de texto: si la línea
contiene elementos inline (enlaces, negritas, labels con checkbox), la frase sale
truncada.

## Decisiones

- **Interacción:** botón/enlace "→ frase completa" dentro del tooltip. La
  traducción de frase solo se pide al pulsarlo (on-demand). Motivo: el plan
  gratuito de Groq tiene TPM limitado y ya causó 429s en el pasado; traducir
  siempre palabra+frase duplicaría el consumo por hover.
- **Sin cambios en service worker ni prompts:** se reutiliza el mensaje
  `TRANSLATE` existente con `text = sentence`, igual que hace hoy el camino de
  selección manual (`isSelection`). Caché L1/L2 y request-collapsing funcionan
  sin tocar nada.
- **Modo:** la frase se traduce siempre en modo `quick`, aunque el usuario esté
  en `learning` (partOfSpeech/pronunciación no aplican a frases).
- **Texto del botón fijo en español** ("→ frase completa"), siguiendo el patrón
  existente del tooltip (p.ej. "También:"). i18n del tooltip queda fuera de
  alcance.

## Cambios

### 1. `src/content/text-extractor.ts` — extracción a nivel de bloque

`extractSentence` pasa a operar sobre el ancestro de bloque más cercano al nodo
de texto (parar en `<p>`, `<li>`, `<label>`, `<div>`, `<td>`, headings…, o en
`document.body`), usando su `innerText`. Se localiza la posición de la palabra
dentro de ese texto y se corta por los delimitadores de frase actuales
(`.!?¡¿\n`, CJK). Límite de 500 chars se mantiene.

Localización de la palabra: se calcula el offset del nodo de texto dentro del
bloque recorriendo los text nodes previos (TreeWalker), no buscando la palabra
por string (evita ambigüedad si la palabra aparece varias veces).

Esto también mejora el CONTEXT que recibe el LLM para la traducción de palabra.

### 2. `src/content/tooltip-renderer.ts` + `styles.css` — botón y sección de frase

- `renderContent` añade, tras la traducción, un enlace `hl-sentence-btn`
  ("→ frase completa") solo si `sentence` difiere de `word` (y no es selección).
- Al pulsar: el botón se sustituye por el skeleton de puntos existente; cuando
  llega la respuesta, se muestra sección `hl-sentence`: frase original en
  pequeño + traducción. En error, mensaje de error estándar en esa sección.
- CSS: tooltip pasa a `pointer-events: auto`; estilos para botón y sección.

### 3. `src/content/index.ts` + `hover-detector.ts` — tooltip interactivo

- El `HoverDetector` ignora eventos de ratón cuyo target esté dentro de
  `[data-hl-tooltip]` (no resetea timer, no pasa a `idle` al entrar al tooltip).
- `index.ts` pasa un callback `onTranslateSentence(sentence)` al renderer que
  construye la cacheKey (`buildCacheKey(sentence, sentence, targetLang, "quick",
  model)`), consulta L1/pending y llama a `requestTranslation` con
  `mode: "quick"`, reutilizando la misma lógica de generación/abort que el flujo
  de palabra.

## Manejo de errores

- Error de la petición de frase → mensaje de error en la sección `hl-sentence`
  usando `tooltipErrorFor` existente; la traducción de palabra ya mostrada no se
  pierde.
- Frase vacía o igual a la palabra → no se muestra el botón.

## Tests

- `text-extractor` a nivel de bloque: frase que cruza elementos inline
  (`<label>guardar <b>datos</b> de la tarjeta.</label>`), palabra repetida en el
  bloque, delimitadores, límite 500, fallback a comportamiento actual si no hay
  ancestro de bloque razonable.
- Los 56 tests existentes deben seguir en verde (los de `text-extractor`
  se actualizan si el nuevo comportamiento cambia expectativas).

## Fuera de alcance

- i18n del tooltip (textos fijos en ES hoy).
- Traducción automática de frase en cada hover.
- Cambios en service worker, prompts o popup.
