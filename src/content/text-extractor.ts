const WORD_REGEX = /\p{L}[\p{L}\p{M}'-]*/u;
const PUNCTUATION_STRIP = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu;

interface ExtractedText {
  word: string;
  sentence: string;
  isSelection: boolean;
  /** Rango de la palabra bajo el cursor, para el highlight (null si no hay). */
  wordRange: Range | null;
}

interface WordAtPoint {
  textNode: Text;
  word: string;
  start: number;
  end: number;
}

// Un único hit-test (caretRangeFromPoint) por hover: de él salen el nodo,
// la palabra y su rango, compartidos por la traducción y el highlight.
function wordAtPoint(x: number, y: number): WordAtPoint | null {
  if (!document.caretRangeFromPoint) return null;
  const caret = document.caretRangeFromPoint(x, y);
  if (!caret || caret.startContainer.nodeType !== Node.TEXT_NODE) return null;

  const textNode = caret.startContainer as Text;
  const { word, start, end } = expandToWord(textNode.textContent || "", caret.startOffset);
  return { textNode, word, start, end };
}

function rangeOf(hit: WordAtPoint | null): Range | null {
  if (!hit || hit.start >= hit.end) return null;
  const range = document.createRange();
  range.setStart(hit.textNode, hit.start);
  range.setEnd(hit.textNode, hit.end);
  return range;
}

function expandToWord(text: string, offset: number): { word: string; start: number; end: number } {
  let start = offset;
  let end = offset;

  while (start > 0) {
    const ch = text.charAt(start - 1);
    if (WORD_REGEX.test(ch)) {
      start--;
    } else {
      break;
    }
  }

  while (end < text.length) {
    const ch = text.charAt(end);
    if (WORD_REGEX.test(ch)) {
      end++;
    } else {
      break;
    }
  }

  const word = text.slice(start, end);
  return { word, start, end };
}

function extractSentence(text: string, wordStart: number, wordEnd: number): string {
  const sentenceEnders = /[.!?¡¿\n\u3002\uFF1F\uFF01]/;

  let sentenceStart = wordStart;
  while (sentenceStart > 0) {
    const ch = text[sentenceStart - 1];
    if (sentenceEnders.test(ch)) {
      break;
    }
    sentenceStart--;
  }

  let sentenceEnd = wordEnd;
  while (sentenceEnd < text.length) {
    if (sentenceEnders.test(text[sentenceEnd])) {
      sentenceEnd++;
      break;
    }
    sentenceEnd++;
  }

  let sentence = text.slice(sentenceStart, sentenceEnd).trim();
  sentence = sentence.replace(PUNCTUATION_STRIP, "").trim();

  if (sentence.length > 500) {
    sentence = sentence.slice(0, 500);
  }

  return sentence;
}

const BLOCK_TAGS = new Set([
  "P", "DIV", "LI", "TD", "TH", "LABEL", "BLOCKQUOTE", "ARTICLE", "SECTION",
  "ASIDE", "HEADER", "FOOTER", "MAIN", "FIGCAPTION", "CAPTION", "DD", "DT",
  "PRE", "H1", "H2", "H3", "H4", "H5", "H6", "BODY",
]);

// ponytail: cota que acota el recorrido TreeWalker por hover; si el texto
// acumulado la supera, se abandona el recorrido y la frase queda limitada
// al nodo de texto (extractSentence sobre el nodo, no sobre el bloque)
const MAX_BLOCK_TEXT = 5000;

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT"]);

function closestBlock(node: Node): HTMLElement | null {
  let el = node.parentElement;
  while (el) {
    if (BLOCK_TAGS.has(el.tagName)) return el;
    el = el.parentElement;
  }
  return null;
}

export function extractBlockSentence(
  node: Text,
  wordStart: number,
  wordEnd: number
): string {
  const nodeText = node.textContent || "";
  const block = closestBlock(node);

  if (!block) {
    return extractSentence(nodeText, wordStart, wordEnd);
  }

  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
    acceptNode(n: Node): number {
      const parent = n.parentElement;
      if (parent && SKIP_TAGS.has(parent.tagName)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let text = "";
  let base = -1;
  let prevBlock: HTMLElement | null = null;
  let current = walker.nextNode() as Text | null;

  while (current) {
    const ancestor = closestBlock(current);
    if (prevBlock !== null && ancestor !== prevBlock && text.length > 0) {
      text += "\n";
    }
    if (current === node) {
      base = text.length;
    }
    text += current.textContent || "";
    prevBlock = ancestor;

    if (text.length > MAX_BLOCK_TEXT) {
      return extractSentence(nodeText, wordStart, wordEnd);
    }

    current = walker.nextNode() as Text | null;
  }

  if (base === -1) {
    return extractSentence(nodeText, wordStart, wordEnd);
  }

  const sentence = extractSentence(text, base + wordStart, base + wordEnd);
  return sentence.replace(/\s+/g, " ").trim();
}

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

export function extractTextAt(x: number, y: number): ExtractedText | null {
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
      wordRange: rangeOf(wordAtPoint(x, y)),
    };
  }

  const hit = wordAtPoint(x, y);
  if (!hit || !hit.word) return null;

  const normalizedWord = hit.word.replace(PUNCTUATION_STRIP, "").trim();
  if (!normalizedWord) return null;

  const sentence = extractBlockSentence(hit.textNode, hit.start, hit.end);

  return {
    word: normalizedWord,
    sentence: sentence || normalizedWord,
    isSelection: false,
    wordRange: rangeOf(hit),
  };
}
