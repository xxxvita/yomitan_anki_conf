// Этапы S4a/S4b (клипы) — порт internal/placement/model/session_s4.go.
import { alignTokens } from './align';
import { sigmoid } from './params';
import { bucketOf, FLAG_FLOOR, type Item, type Response, type Session } from './session';

export interface S4State {
  lemmaIdx: Map<string, number>; // лемма → индекс слова банка
  usedClip: Set<number>;
  curClip: number;
  curChips: string[];
  tapShown: number; // лемм клипа среди чипов S4a
  tapHit: number; // из них отмечено
  issuedA: number;
  issuedB: number;
}

export function newS4State(): S4State {
  return { lemmaIdx: new Map(), usedClip: new Set(), curClip: 0, curChips: [], tapShown: 0, tapHit: 0, issuedA: 0, issuedB: 0 };
}

const sumOf = (xs: number[]) => xs.reduce((t, x) => t + x, 0);

/** S4 пропускается при floor (из S1 или по ΣP* < floorWords, как в результате) и без клипов. */
export function enterS4(s: Session): void {
  const clips = s.b.clips ?? [];
  if (s.hasFlag(FLAG_FLOOR) || clips.length === 0) {
    s.stage = 'done';
    return;
  }
  const sum = sumOf(s.pStarPosterior(s.mMean()));
  s.emit('s4_floor', sum, sum - s.p.floorWords);
  if (sum < s.p.floorWords) {
    s.stage = 'done';
    return;
  }
  s.s4.lemmaIdx = new Map();
  s.b.words.forEach((w, i) => s.s4.lemmaIdx.set(w.lemma, i));
  s.s4.usedClip = new Set();
  s.stage = 'S4a';
}

/** К печати (S4b) — только если доля отмеченных лемм клипа ≥ s4bGate. */
export function leaveS4a(s: Session): void {
  if (s.s4.tapShown > 0) {
    const ratio = s.s4.tapHit / s.s4.tapShown;
    s.emit('s4b_gate', ratio, ratio - s.p.s4bGate);
    if (ratio >= s.p.s4bGate) {
      s.stage = 'S4b';
      return;
    }
  }
  s.stage = 'done';
}

export function issueS4(s: Session): Item | null {
  const b = s.stage === 'S4b';
  const limit = b ? s.p.s4bClips : s.p.s4aClips;
  const n = b ? s.s4.issuedB : s.s4.issuedA;
  if (n >= limit) return null;
  const c = chooseClip(s);
  if (c < 0) return null;
  s.s4.usedClip.add(c);
  s.s4.curClip = c;
  const it = s.newItem(b ? 'clip_type' : 'clip_tap', '');
  it.clipId = s.b.clips![c].id;
  if (!b) {
    it.chips = buildChips(s, c);
    s.s4.curChips = it.chips;
  }
  return it;
}

/** Неиспользованный клип, у которого средняя b лемм банка ближе всего к θ̂. */
function chooseClip(s: Session): number {
  const th = s.q.meanSDTheta()[0];
  let best = -1;
  let bestD = Infinity;
  let second = Infinity;
  const clips = s.b.clips ?? [];
  for (let c = 0; c < clips.length; c++) {
    if (s.s4.usedClip.has(c)) continue;
    let sum = 0;
    let k = 0;
    for (const l of clips[c].lemmas) {
      const w = s.s4.lemmaIdx.get(l);
      if (w !== undefined) {
        sum += s.diff[w];
        k++;
      }
    }
    if (k === 0) continue;
    const d = Math.abs(sum / k - th);
    if (d < bestD) {
      second = bestD;
      best = c;
      bestD = d;
    } else if (d < second) {
      second = d;
    }
  }
  if (best >= 0) s.emit('s4_clip', bestD, Number.isFinite(second) ? second - bestD : null, best);
  return best;
}

/** До 4 лемм клипа + дистракторы того же диапазона, не звучащие в клипе; всего 6, перемешаны. */
function buildChips(s: Session, c: number): string[] {
  const cl = s.b.clips![c];
  const inClip = new Set<string>();
  const chips: string[] = [];
  let bk = -1;
  for (const l of cl.lemmas) {
    inClip.add(l);
    const w = s.s4.lemmaIdx.get(l);
    if (w !== undefined && chips.length < 4) {
      chips.push(l);
      if (bk < 0) bk = bucketOf(s.b.words[w].rank);
    }
  }
  const [lo, hi] = s.bucketRange(Math.max(bk, 0));
  const pool: number[] = [];
  for (let i = lo; i < hi; i++) if (!inClip.has(s.b.words[i].lemma)) pool.push(i);
  while (chips.length < 6 && pool.length > 0) {
    const k = s.rng.intN(pool.length);
    chips.push(s.b.words[pool[k]].lemma);
    pool.splice(k, 1);
  }
  s.rng.shuffle(chips.length, (i, j) => {
    const t = chips[i];
    chips[i] = chips[j];
    chips[j] = t;
  });
  return chips;
}

export function answerS4(s: Session, it: Item, r: Response): void {
  const cl = s.b.clips![s.s4.curClip];
  const inClip = new Set(cl.lemmas);
  if (it.stage === 'S4a') {
    s.s4.issuedA++;
    const marked = new Set(r.marked ?? []);
    for (const c of s.s4.curChips) {
      if (!inClip.has(c)) {
        if (marked.has(c)) s.gA++;
        else s.gB++;
        continue;
      }
      s.s4.tapShown++;
      if (marked.has(c)) s.s4.tapHit++;
      updateHeard(s, s.s4.lemmaIdx.get(c)!, marked.has(c));
    }
    return;
  }
  s.s4.issuedB++;
  alignTokens(cl.tokens, r.text ?? '').forEach((ok, k) => {
    const w = s.s4.lemmaIdx.get(cl.tokens[k]);
    if (w !== undefined) updateHeard(s, w, ok);
  });
}

/** «Расслышал слово w в клипе» — σ(slope(θ−b−δ)). */
function updateHeard(s: Session, w: number, heard: boolean): void {
  const b = s.diff[w];
  const a = s.p.slope;
  s.q.update((th, d) => {
    const ph = sigmoid(a * (th - b - d));
    return heard ? ph : 1 - ph;
  });
}
