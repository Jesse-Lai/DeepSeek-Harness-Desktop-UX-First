// Research-only, dependency-free extractive view. Never writes to model history.
// The text is quoted from input, not paraphrased or represented as a complete summary.
const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });

export function spans(text) {
  const result = [];
  const paragraphs = /[^\n]+(?:\n(?!\n)[^\n]+)*/g;
  for (const match of text.matchAll(paragraphs)) {
    for (const part of segmenter.segment(match[0])) {
      const leading = part.segment.length - part.segment.trimStart().length;
      const quote = part.segment.trim();
      if (!quote) continue;
      const start = match.index + part.index + leading;
      result.push({ start, end: start + quote.length, text: quote });
    }
  }
  return result;
}

// Character n-grams work without domain dictionaries or language-specific labels.
// They measure textual overlap, NOT truth, entailment, importance, or simplicity.
function features(text) {
  const chars = Array.from(text.normalize('NFKC').toLocaleLowerCase());
  const map = new Map();
  for (let i = 0; i < chars.length - 2; i++) {
    const gram = chars.slice(i, i + 3).join('');
    map.set(gram, (map.get(gram) ?? 0) + 1);
  }
  return map;
}

function cosine(a, b) {
  let dot = 0, aa = 0, bb = 0;
  for (const [k, v] of a) { aa += v * v; dot += v * (b.get(k) ?? 0); }
  for (const v of b.values()) bb += v * v;
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

export function project(text, { count = 3, window = 48 } = {}) {
  const all = spans(text);
  const candidates = all.slice(-window);
  if (candidates.length <= count) return candidates;
  const vectors = candidates.map(x => features(x.text));
  const edges = vectors.map((a, i) => vectors.map((b, j) => i === j ? 0 : cosine(a, b)));
  const sums = edges.map(row => row.reduce((a, b) => a + b, 0));
  const n = candidates.length;
  let score = Array(n).fill(1 / n);
  for (let round = 0; round < 12; round++) {
    score = score.map((_, i) => 0.15 / n + 0.85 * score.reduce((s, v, j) =>
      s + (sums[j] ? v * edges[j][i] / sums[j] : v / n), 0));
  }
  // Keep the newest complete statement to reduce stale-only excerpts. This is a
  // structural heuristic, not a guarantee that corrections/negation are retained.
  const selected = new Set([n - 1]);
  const ranked = score.map((value, index) => ({ value, index }))
    .sort((a, b) => b.value - a.value || a.index - b.index);
  for (const { index } of ranked) { if (selected.size >= count) break; selected.add(index); }
  return [...selected].sort((a, b) => a - b).map(i => candidates[i]);
}

export function view(text, mode) {
  if (mode === 'hidden') return [];
  if (mode === 'full') return [{ start: 0, end: text.length, text }];
  return project(text, { count: mode === 'brief' ? 2 : 4 });
}
