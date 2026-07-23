# HoverLingo

Hover over any word on any webpage and get instant translations. HoverLingo uses Groq AI to deliver context-aware translations in 30 languages directly in a tooltip next to your cursor. No clicks, no new tabs, no interruptions.

## Features

- **Hover to translate.** Point at a word for 300ms and the translation appears.
- **Context-aware.** The surrounding sentence is sent for better disambiguation. "bank" near "river" translates differently than "bank" near "money."
- **30 target languages.** Spanish, French, German, Japanese, Arabic, Russian, and more.
- **7 AI models.** Pick from Qwen, Llama, and GPT models via the popup.
- **Two modes.** Quick mode gives you the translation and alternatives. Learning mode adds pronunciation, part of speech, explanation, and example usage.
- **Instant cache.** Already translated a word? It appears instantly from local cache with no API call.
- **Text selection.** Select any phrase and hover to translate the whole thing.
- **Per-site control.** Disable HoverLingo on specific websites with one click.
- **Keyboard shortcut.** Press `Ctrl+Shift+K` (`Cmd+Shift+K` on Mac) to toggle on and off.
- **Dark mode.** Tooltip adapts to your system theme automatically.
- **Export and import.** Backup your settings as a JSON file and restore them anywhere.
- **No tracking, no ads, no backend.** Everything runs locally in your browser.

## Installation

### Prerequisites

You need a free Groq API key. Get one at [console.groq.com/keys](https://console.groq.com/keys).

### Build from source

1. Clone the repository:
   ```
   git clone https://github.com/jraversbcn21/HoverLingo.git
   cd HoverLingo
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Build the extension:
   ```
   npm run build
   ```

### Load in Chrome

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode** (toggle in the top right).
3. Click **Load unpacked** and select the `dist` folder inside the project.
4. Click the HoverLingo icon in your toolbar, paste your Groq API key, and pick your target language.

### After every rebuild

Click the reload icon on the HoverLingo card in `chrome://extensions`, then close and reopen all your tabs. Content scripts only inject on page load.

## Usage

1. Set your Groq API key, target language, and preferred model in the popup.
2. Hover over any word on any webpage.
3. The translation appears in a tooltip near your cursor.
4. Press `Ctrl+Shift+K` to toggle HoverLingo on and off anytime.

## Settings

Open the popup by clicking the HoverLingo icon in your browser toolbar.

| Setting | Description |
|---------|-------------|
| Groq API Key | Your free API key from console.groq.com |
| Model | Choose from 7 Groq models (Llama 3.3 70B is the default) |
| Target Language | The language you want translations in |
| Translation Mode | Quick (fast, minimal) or Learning (detailed with pronunciation and examples) |
| Hover Delay | How long you need to hover before the tooltip appears (100ms to 1000ms) |
| Enabled | Global on/off toggle |
| Disable on this site | Turn off HoverLingo for the current website only |

## Tech Stack

TypeScript, Vite, @crxjs/vite-plugin, @floating-ui/dom, Groq API. No React, no jQuery, no runtime bloat. The entire extension is about 45KB minified.

## Development

Run tests:
```
npm test
```

Watch mode:
```
npm run test:watch
```

26 unit tests cover cache logic, prompt building, text extraction, and cache persistence.
