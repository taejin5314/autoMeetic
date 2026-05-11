import type { WhiteboardElement } from "./types";

const MIN_TERM_LENGTH = 3;
const DEFAULT_MAX_PROMPT_CHARS = 500;
const PROMPT_PREFIX = "Domain vocabulary that may appear: ";
const PROMPT_SUFFIX = ".";

/**
 * Extract keywords from whiteboard elements for vocabulary biasing.
 * From autopreso: whiteboard-keywords.js
 */
export function extractWhiteboardKeywords(elements: unknown): string[] {
  if (!Array.isArray(elements)) return [];
  const seen = new Map<string, string>();

  for (const element of elements) {
    if (!element || typeof element !== "object") continue;
    const el = element as WhiteboardElement;
    const sources: string[] = [];

    if (el.type === "text" && typeof el.text === "string") {
      sources.push(el.text);
    }
    if (el.label && typeof el.label.text === "string") {
      sources.push(el.label.text);
    }

    for (const source of sources) {
      for (const line of source.split(/\r?\n/)) {
        const term = line.trim();
        if (term.length < MIN_TERM_LENGTH) continue;
        if (!/[a-zA-Z]/.test(term)) continue;
        const key = term.toLowerCase();
        if (!seen.has(key)) seen.set(key, term);
      }
    }
  }

  return [...seen.values()].sort((a, b) => b.length - a.length);
}

/**
 * Build transcription vocabulary prompt from whiteboard keywords.
 * From autopreso: whiteboard-keywords.js
 */
export function buildTranscriptionVocabularyPrompt(
  keywords: string[],
  { maxChars = DEFAULT_MAX_PROMPT_CHARS } = {}
): string {
  if (!Array.isArray(keywords) || keywords.length === 0) return "";

  const terms: string[] = [];
  let total = PROMPT_PREFIX.length + PROMPT_SUFFIX.length;

  for (const term of keywords) {
    const needed = (terms.length > 0 ? 2 : 0) + term.length; // ", " or first item
    if (total + needed > maxChars) break;
    terms.push(term);
    total += needed;
  }

  if (terms.length === 0) return "";

  return `${PROMPT_PREFIX}${terms.join(", ")}${PROMPT_SUFFIX}`;
}
