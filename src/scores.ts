// Local high-score table, kept in localStorage. Storage can be missing or blocked, so every access
// is guarded and the game simply runs without a saved table in that case.

export interface ScoreEntry {
  name: string;   // three initials
  score: number;
  dist: number;   // metres
  style: number;
}

const KEY = 'skii.scores';
export const MAX_SCORES = 10;

export function loadScores(): ScoreEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((e) => e && typeof e.name === 'string' && Number.isFinite(e.score))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SCORES);
  } catch {
    return [];
  }
}

export function qualifies(score: number): boolean {
  if (score <= 0) return false;
  const list = loadScores();
  return list.length < MAX_SCORES || score > list[list.length - 1].score;
}

/** Insert an entry and return its rank (0-based) in the saved table, or -1 if it didn't make it. */
export function insertScore(entry: ScoreEntry): number {
  const list = loadScores();
  let i = list.findIndex((e) => entry.score > e.score);
  if (i < 0) i = list.length;
  if (i >= MAX_SCORES) return -1;
  list.splice(i, 0, entry);
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_SCORES)));
  } catch { /* ignore */ }
  return i;
}
