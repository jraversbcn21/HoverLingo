import { describe, it, expect, beforeEach, vi } from "vitest";
import type { TranslationResponse } from "../shared/types";
import { buildCacheKey } from "../shared/cache-key";

const mockStore = new Map<string, unknown>();

type Listener = (
  message: { type: string; payload?: unknown },
  sender: unknown,
  sendResponse: (response: unknown) => void
) => boolean;

let listener: Listener;

vi.stubGlobal("chrome", {
  storage: {
    local: {
      get: vi.fn((keys: string | string[] | null) => {
        const result: Record<string, unknown> = {};
        if (keys === null) {
          for (const [k, v] of mockStore) result[k] = v;
        } else if (Array.isArray(keys)) {
          for (const k of keys) {
            if (mockStore.has(k)) result[k] = mockStore.get(k);
          }
        } else if (typeof keys === "string") {
          if (mockStore.has(keys)) result[keys] = mockStore.get(keys);
        }
        return Promise.resolve(result);
      }),
      set: vi.fn((items: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(items)) mockStore.set(k, v);
        return Promise.resolve();
      }),
      remove: vi.fn((keys: string | string[]) => {
        for (const k of Array.isArray(keys) ? keys : [keys]) mockStore.delete(k);
        return Promise.resolve();
      }),
    },
  },
  runtime: {
    onMessage: {
      addListener: vi.fn((fn: Listener) => {
        listener = fn;
      }),
    },
  },
  commands: {
    onCommand: {
      addListener: vi.fn(),
    },
  },
});

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

interface SWResponse {
  success: boolean;
  data?: TranslationResponse;
  error?: string;
  cached?: boolean;
}

function sendTranslate(payload: {
  text: string;
  sentence: string;
  targetLang: string;
  mode: "quick" | "learning";
}): Promise<SWResponse> {
  return new Promise((resolve) => {
    listener({ type: "TRANSLATE", payload }, {}, (r) => resolve(r as SWResponse));
  });
}

function groqResponse(json: object): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(json) } }] }),
    { status: 200 }
  );
}

const TRANSLATION = {
  translation: "casa",
  sourceLanguage: "en",
  direction: "ltr",
  confidence: 0.95,
};

const PAYLOAD = {
  text: "house",
  sentence: "The house is big.",
  targetLang: "es",
  mode: "quick" as const,
};

const DEFAULT_MODEL = "qwen/qwen3.6-27b";

beforeEach(async () => {
  vi.resetModules();
  mockStore.clear();
  fetchMock.mockReset();
  mockStore.set("groqApiKey", "gsk_test");
  await import("../background/service-worker");
});

describe("Service worker integration", () => {
  it("answers from L2 cache without calling fetch", async () => {
    const key = buildCacheKey(PAYLOAD.text, PAYLOAD.sentence, "es", "quick", DEFAULT_MODEL);
    mockStore.set(`hl_cache_${key}`, { response: TRANSLATION, timestamp: Date.now() });

    const res = await sendTranslate(PAYLOAD);

    expect(res.success).toBe(true);
    expect(res.cached).toBe(true);
    expect(res.data).toEqual(TRANSLATION);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("on L2 miss calls Groq once, persists to L2 and answers cached:false", async () => {
    fetchMock.mockResolvedValue(groqResponse(TRANSLATION));

    const res = await sendTranslate(PAYLOAD);

    expect(res.success).toBe(true);
    expect(res.cached).toBe(false);
    expect(res.data?.translation).toBe("casa");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const key = buildCacheKey(PAYLOAD.text, PAYLOAD.sentence, "es", "quick", DEFAULT_MODEL);
    const stored = mockStore.get(`hl_cache_${key}`) as { response: TranslationResponse };
    expect(stored.response.translation).toBe("casa");
  });

  it("fails cleanly when no API key is configured", async () => {
    mockStore.delete("groqApiKey");

    const res = await sendTranslate(PAYLOAD);

    expect(res.success).toBe(false);
    expect(res.error).toBe("API key not configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps persistent 429 to RATE_LIMIT error", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response('{"error":{"message":"rate limit"}}', {
          status: 429,
          headers: { "Retry-After": "0" },
        })
      )
    );
    // El SW reintenta una vez el 429 (con Retry-After 0 la espera es
    // instantánea); ambos intentos devuelven 429 → error RATE_LIMIT.
    const res = await sendTranslate(PAYLOAD);

    expect(res.success).toBe(false);
    expect(res.error).toBe("RATE_LIMIT");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to default model when stored model is decommissioned", async () => {
    mockStore.set("groqModel", "llama-3.3-70b-versatile");
    fetchMock.mockResolvedValue(groqResponse(TRANSLATION));

    const res = await sendTranslate(PAYLOAD);

    expect(res.success).toBe(true);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.model).toBe(DEFAULT_MODEL);
    expect(body.reasoning_effort).toBe("none");
  });

  it("collapses concurrent identical requests into one fetch", async () => {
    let resolveFetch!: (r: Response) => void;
    fetchMock.mockImplementation(
      () => new Promise<Response>((res) => { resolveFetch = res; })
    );

    const p1 = sendTranslate(PAYLOAD);
    const p2 = sendTranslate(PAYLOAD);

    // Esperar a que ambos mensajes lleguen al punto de fetch/espera
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    resolveFetch(groqResponse(TRANSLATION));

    const [r1, r2] = await Promise.all([p1, p2]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    // Exactamente uno de los dos es el dueño de la llamada (cached:false);
    // el otro se suma a la promesa en vuelo (cached:true).
    expect([r1.cached, r2.cached].sort()).toEqual([false, true]);
  });

  it("does not collapse concurrent requests with different keys", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(groqResponse(TRANSLATION)));

    const [r1, r2] = await Promise.all([
      sendTranslate(PAYLOAD),
      sendTranslate({ ...PAYLOAD, text: "river" }),
    ]);

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
