const WORD_REGEX = /\p{L}[\p{L}\p{M}'-]*/u;
const PUNCTUATION_STRIP = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu;

export interface ExtractedText {
  word: string;
  sentence: string;
  isSelection: boolean;
}

function getTextNodeAt(x: number, y: number): Text | null {
  if (document.caretRangeFromPoint) {
    const range = document.caretRangeFromPoint(x, y);
    if (range && range.startContainer.nodeType === Node.TEXT_NODE) {
      return range.startContainer as Text;
    }
  }

  return null;
}

function getCursorOffsetInNode(x: number, y: number, textNode: Text): number {
  if (document.caretRangeFromPoint) {
    const range = document.caretRangeFromPoint(x, y);
    if (range && range.startContainer === textNode) {
      return range.startOffset;
    }
  }

  const rect = document.createRange();
  rect.setStart(textNode, 0);
  rect.setEnd(textNode, textNode.length);
  const rects = rect.getClientRects();

  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      const ratio = (x - r.left) / r.width;
      const length = textNode.length;
      const sliceLength = Math.max(1, Math.floor(length / rects.length));
      const start = i * sliceLength;
      const end = Math.min(start + sliceLength, length);
      const offset = start + Math.floor((end - start) * ratio);
      return Math.max(0, Math.min(offset, length));
    }
  }

  return 0;
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

export function extractTextAt(x: number, y: number): ExtractedText | null {
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed && selection.toString().trim().length > 0) {
    const selectedText = selection.toString().trim();
    const sentence = selectedText.length > 500 ? selectedText.slice(0, 500) : selectedText;
    return {
      word: selectedText,
      sentence,
      isSelection: true,
    };
  }

  const textNode = getTextNodeAt(x, y);
  if (!textNode) return null;

  const offset = getCursorOffsetInNode(x, y, textNode);
  const text = textNode.textContent || "";

  const { word, start, end } = expandToWord(text, offset);

  if (!word || word.length === 0) return null;

  const normalizedWord = word.replace(PUNCTUATION_STRIP, "").trim();
  if (!normalizedWord || normalizedWord.length === 0) return null;

  const sentence = extractSentence(text, start, end);

  return {
    word: normalizedWord,
    sentence: sentence || normalizedWord,
    isSelection: false,
  };
}

export function getWordRangeAt(x: number, y: number): Range | null {
  if (document.caretRangeFromPoint) {
    const range = document.caretRangeFromPoint(x, y);
    if (range && range.startContainer.nodeType === Node.TEXT_NODE) {
      const textNode = range.startContainer as Text;
      const offset = range.startOffset;
      const text = textNode.textContent || "";
      const { start, end } = expandToWord(text, offset);

      if (start < end) {
        const wordRange = document.createRange();
        wordRange.setStart(textNode, start);
        wordRange.setEnd(textNode, end);
        return wordRange;
      }
    }
  }
  return null;
}
