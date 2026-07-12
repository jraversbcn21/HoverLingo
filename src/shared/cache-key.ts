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
