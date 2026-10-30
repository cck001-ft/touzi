import type { Combo, DieFace, DieSpec, RulesApi, ScoredResult } from '../types';
import { DICE_CATALOG } from './catalog';

type RealFace = 1 | 2 | 3 | 4 | 5 | 6;

interface Entry {
  index: number;
  face: DieFace;
  isDevil: boolean;
}

type StraightKind = 'straight15' | 'straight26' | 'straight16';

/** 顺子按分值降序尝试（1500 > 750 > 500） */
const STRAIGHTS: { kind: StraightKind; faces: RealFace[]; score: number }[] = [
  { kind: 'straight16', faces: [1, 2, 3, 4, 5, 6], score: 1500 },
  { kind: 'straight26', faces: [2, 3, 4, 5, 6], score: 750 },
  { kind: 'straight15', faces: [1, 2, 3, 4, 5], score: 500 },
];

function toEntries(dice: DieFace[]): Entry[] {
  return dice.map((face, index) => ({ index, face, isDevil: face === 'devil' }));
}

/** 三同点基础分：三个 1 = 1000，其余点数 ×100 */
function nOfAKindBase(face: RealFace): number {
  return face === 1 ? 1000 : face * 100;
}

/** count >= 3 时每多一颗翻倍 */
function nOfAKindScore(face: RealFace, count: number): number {
  return nOfAKindBase(face) * 2 ** Math.max(0, count - 3);
}

function splitFaces(entries: Entry[]): { byFace: Map<RealFace, Entry[]>; devils: Entry[] } {
  const byFace = new Map<RealFace, Entry[]>();
  const devils: Entry[] = [];
  for (const e of entries) {
    if (e.isDevil) {
      devils.push(e);
      continue;
    }
    const list = byFace.get(e.face as RealFace) ?? [];
    list.push(e);
    byFace.set(e.face as RealFace, list);
  }
  return { byFace, devils };
}

/**
 * 当前剩余骰能组成的全部合法组合。
 * devil 只能补齐顺子或 3+ 同点，且该组合必须含至少 1 颗真实面骰；
 * devil 不能单独计分，也不能充当单 1 / 单 5。
 */
function buildCombos(entries: Entry[]): Combo[] {
  const combos: Combo[] = [];
  const { byFace, devils } = splitFaces(entries);

  for (const straight of STRAIGHTS) {
    const picked: Entry[] = [];
    let needDevil = 0;
    for (const face of straight.faces) {
      const list = byFace.get(face);
      if (list && list.length > 0) picked.push(list[0]!);
      else needDevil += 1;
    }
    if (picked.length === 0) continue;
    if (needDevil > devils.length) continue;
    combos.push({
      kind: straight.kind,
      score: straight.score,
      diceIndices: picked.map((e) => e.index).concat(devils.slice(0, needDevil).map((e) => e.index)),
    });
  }

  for (const [face, list] of byFace) {
    const maxCount = list.length + devils.length;
    for (let count = 3; count <= maxCount; count += 1) {
      const realUsed = list.slice(0, Math.min(count, list.length));
      const indices = realUsed
        .map((e) => e.index)
        .concat(devils.slice(0, Math.max(0, count - realUsed.length)).map((e) => e.index));
      combos.push({ kind: 'nOfAKind', score: nOfAKindScore(face, count), diceIndices: indices });
    }
  }

  for (const e of entries) {
    if (e.isDevil) continue;
    if (e.face === 1) combos.push({ kind: 'single1', score: 100, diceIndices: [e.index] });
    if (e.face === 5) combos.push({ kind: 'single5', score: 50, diceIndices: [e.index] });
  }

  return combos;
}

function consume(remaining: Entry[], combo: Combo): Entry[] {
  const taken = new Set(combo.diceIndices);
  return remaining.filter((e) => !taken.has(e.index));
}

interface Best {
  covered: number;
  score: number;
  combos: Combo[];
}

/** 覆盖骰子数优先、总分其次的最优分解 */
function search(remaining: Entry[], memo: Map<string, Best>): Best {
  const key = remaining.map((e) => e.index).join(',');
  const cached = memo.get(key);
  if (cached) return cached;

  let best: Best = { covered: 0, score: 0, combos: [] };
  if (remaining.length > 0) {
    for (const combo of buildCombos(remaining)) {
      const rest = consume(remaining, combo);
      const sub = search(rest, memo);
      const covered = combo.diceIndices.length + sub.covered;
      const score = combo.score + sub.score;
      const better =
        covered > best.covered || (covered === best.covered && score > best.score);
      if (better) best = { covered, score, combos: [combo, ...sub.combos] };
    }
  }
  memo.set(key, best);
  return best;
}

/** 契约规定的贪心顺序：顺子 → 3+同点 → 单 1 → 单 5，循环直到无法继续 */
function greedyDecompose(entries: Entry[]): Combo[] {
  const kindRank = (kind: Combo['kind']): number => {
    switch (kind) {
      case 'straight15':
      case 'straight26':
      case 'straight16':
        return 0;
      case 'nOfAKind':
        return 1;
      case 'single1':
        return 2;
      case 'single5':
        return 3;
    }
  };
  const combos: Combo[] = [];
  let rest = entries;
  for (;;) {
    const ranked = buildCombos(rest)
      .slice()
      .sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || b.score - a.score);
    const pick = ranked[0];
    if (!pick) return combos;
    combos.push(pick);
    rest = consume(rest, pick);
  }
}

function coveredAll(combos: Combo[], total: number): boolean {
  const scored = new Set<number>();
  for (const c of combos) for (const i of c.diceIndices) scored.add(i);
  return scored.size === total;
}

export function scoreSelected(dice: DieFace[]): ScoredResult {
  if (dice.length === 0) return { valid: false, score: 0, combos: [] };
  const entries = toEntries(dice);
  const greedy = greedyDecompose(entries);
  const greedyScore = greedy.reduce((sum, c) => sum + c.score, 0);
  if (coveredAll(greedy, dice.length)) {
    return { valid: true, score: greedyScore, combos: greedy };
  }
  // 贪心漏掉的骰子若存在能全覆盖的其它分解，则采用它（「尽量分解」）
  const best = search(entries, new Map());
  if (best.covered === dice.length) {
    return { valid: true, score: best.score, combos: best.combos };
  }
  return { valid: false, score: greedyScore, combos: greedy };
}

/** 骰池中所有可选的合法组合（供 UI 提示，互不排斥） */
export function computeCombos(dice: DieFace[]): Combo[] {
  return buildCombos(toEntries(dice));
}

export function isBust(dice: DieFace[]): boolean {
  return computeCombos(dice).length === 0;
}

/** 归一化到长度 6 的权重；非法输入退回均匀分布 */
function normalizeProbs(probs: number[] | undefined): number[] {
  const uniform = [1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6];
  if (!probs || probs.length !== 6) return uniform;
  const safe = probs.map((p) => (Number.isFinite(p) && p > 0 ? p : 0));
  const total = safe.reduce((a, b) => a + b, 0);
  if (total <= 0) return uniform;
  return safe.map((p) => p / total);
}

function rollOne(spec: DieSpec): DieFace {
  const weights = normalizeProbs(spec.probs);
  const r = Math.random();
  let acc = 0;
  for (let i = 0; i < 6; i += 1) {
    acc += weights[i]!;
    if (r < acc) {
      const face = (i + 1) as RealFace;
      return spec.devilOnOne && face === 1 ? 'devil' : face;
    }
  }
  return 6;
}

export function rollDicePool(specs: DieSpec[], count: number): DieFace[] {
  const ordinary = DICE_CATALOG.find((d) => d.id === 'ordinary')!;
  const n = Math.max(0, Math.floor(count));
  const result: DieFace[] = [];
  for (let i = 0; i < n; i += 1) {
    result.push(rollOne(specs[i] ?? ordinary));
  }
  return result;
}

export const rules: RulesApi = {
  scoreSelected,
  computeCombos,
  isBust,
  rollDicePool,
};
