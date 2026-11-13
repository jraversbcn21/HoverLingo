import type { TranslationResponse } from "../shared/types";
import { DEFAULTS } from "../shared/constants";

const STORAGE_PREFIX = "hl_cache_";

// Al llenarse, se expulsa un lote en vez de una sola entrada: la lectura de
// timestamps es cara (lee todas las entradas), así se paga una vez cada
// EVICT_BATCH escrituras en lugar de en cada una.
const EVICT_BATCH = Math.max(1, Math.floor(DEFAULTS.L2_CACHE_MAX / 10));

interface CacheEntry {
  response: TranslationResponse;
  timestamp: number;
}

// Índice en memoria de las claves de caché presentes en storage. Se carga
// perezosamente una vez por vida del SW (solo claves, sin valores) y evita
// leer todo el storage en cada set(). Si el SW muere se reconstruye.
let keyIndex: Promise<Set<string>> | null = null;

async function listStorageKeys(): Promise<string[]> {
  const local = chrome.storage.local;
  if (typeof local.getKeys === "function") {
    return local.getKeys();
  }
  // Chrome < 130: sin getKeys(), hay que leer valores también.
  return Object.keys(await local.get(null));
}

function getKeyIndex(): Promise<Set<string>> {
  if (!keyIndex) {
    keyIndex = listStorageKeys().then(
      (keys) => new Set(keys.filter((k) => k.startsWith(STORAGE_PREFIX)))
    );
    // Si la carga falla, permitir reintentarla en la próxima escritura.
    keyIndex.catch(() => {
      keyIndex = null;
    });
  }
  return keyIndex;
}

async function evictOldest(index: Set<string>): Promise<void> {
  const entries = await chrome.storage.local.get([...index]);
  const victims = [...index]
    .map((k) => ({ k, t: (entries[k] as CacheEntry | undefined)?.timestamp ?? 0 }))
    .sort((a, b) => a.t - b.t)
    .slice(0, EVICT_BATCH)
    .map((v) => v.k);

  await chrome.storage.local.remove(victims);
  for (const k of victims) index.delete(k);
}

export const l2Cache = {
  async get(key: string): Promise<TranslationResponse | null> {
    const storageKey = STORAGE_PREFIX + key;
    const data = await chrome.storage.local.get(storageKey);
    const entry = data[storageKey] as CacheEntry | undefined;

    if (!entry) return null;

    const age = Date.now() - entry.timestamp;
    if (age > DEFAULTS.L2_CACHE_TTL) {
      await chrome.storage.local.remove(storageKey);
      if (keyIndex) (await keyIndex).delete(storageKey);
      return null;
    }

    return entry.response;
  },

  async set(key: string, response: TranslationResponse): Promise<void> {
    const storageKey = STORAGE_PREFIX + key;
    const entry: CacheEntry = { response, timestamp: Date.now() };

    const index = await getKeyIndex();
    if (!index.has(storageKey) && index.size >= DEFAULTS.L2_CACHE_MAX) {
      await evictOldest(index);
    }

    await chrome.storage.local.set({ [storageKey]: entry });
    index.add(storageKey);
  },
};
