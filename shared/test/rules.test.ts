import { describe, expect, it } from 'vitest';
import type { BadgeSpec, DieFace, DieSpec, RulesApi } from '../src/index';
import {
  BADGE_CATALOG,
  DICE_CATALOG,
  getBadgeSpec,
  getDieSpec,
  rules,
} from '../src/index';

const score = (dice: DieFace[]): number => rules.scoreSelected(dice).score;
const valid = (dice: DieFace[]): boolean => rules.scoreSelected(dice).valid;

describe('基础计分', () => {
  it('单个 1 = 100', () => {
    expect(score([1])).toBe(100);
    expect(valid([1])).toBe(true);
  });

  it('单个 5 = 50', () => {
    expect(score([5])).toBe(50);
    expect(valid([5])).toBe(true);
  });

  it('两个 1 = 200', () => {
    expect(score([1, 1])).toBe(200);
    expect(valid([1, 1])).toBe(true);
  });
});

describe('同点计分', () => {
  it('三个 1 = 1000', () => {
    expect(score([1, 1, 1])).toBe(1000);
    expect(valid([1, 1, 1])).toBe(true);
  });

  it('三个 2 = 200', () => {
    expect(score([2, 2, 2])).toBe(200);
    expect(valid([2, 2, 2])).toBe(true);
  });

  it('四个 2 = 400', () => {
    expect(score([2, 2, 2, 2])).toBe(400);
  });

  it('五个 2 = 800', () => {
    expect(score([2, 2, 2, 2, 2])).toBe(800);
  });

  it('六个 2 = 1600', () => {
    expect(score([2, 2, 2, 2, 2, 2])).toBe(1600);
  });
});

describe('顺子', () => {
  it('[1,2,3,4,5] = 500', () => {
    expect(score([1, 2, 3, 4, 5])).toBe(500);
    expect(valid([1, 2, 3, 4, 5])).toBe(true);
  });

  it('[2,3,4,5,6] = 750', () => {
    expect(score([2, 3, 4, 5, 6])).toBe(750);
    expect(valid([2, 3, 4, 5, 6])).toBe(true);
  });

  it('[1,2,3,4,5,6] = 1500', () => {
    expect(score([1, 2, 3, 4, 5, 6])).toBe(1500);
    expect(valid([1, 2, 3, 4, 5, 6])).toBe(true);
  });
});

describe('无效与爆掉', () => {
  it('[2,3,4,6] 无效且 isBust = true', () => {
    const result = rules.scoreSelected([2, 3, 4, 6]);
    expect(result.valid).toBe(false);
    expect(result.score).toBe(0);
    expect(rules.isBust([2, 3, 4, 6])).toBe(true);
  });

  it('含可计分骰时 isBust = false', () => {
    expect(rules.isBust([2, 3, 4, 6, 1])).toBe(false);
  });
});

describe('恶魔之首（devil 万能骰）', () => {
  it('devil 未参与任何组合 => 无效', () => {
    expect(valid(['devil', 2, 3])).toBe(false);
  });

  it('devil 不能单独计分', () => {
    expect(valid(['devil', 1])).toBe(false);
  });

  it('devil 补齐顺子 [devil,2,3,4,6] = 750', () => {
    const result = rules.scoreSelected(['devil', 2, 3, 4, 6]);
    expect(result.valid).toBe(true);
    expect(result.score).toBe(750);
    expect(result.combos[0]!.kind).toBe('straight26');
  });

  it('devil 补齐三同点 [devil,1,1] = 1000', () => {
    const result = rules.scoreSelected(['devil', 1, 1]);
    expect(result.valid).toBe(true);
    expect(result.score).toBe(1000);
    expect(result.combos[0]!.kind).toBe('nOfAKind');
  });

  it('devil 不能当单 1 或单 5 计分', () => {
    const combos = rules.computeCombos(['devil']);
    expect(combos).toHaveLength(0);
    expect(rules.isBust(['devil'])).toBe(true);
  });

  it('分解优先保证覆盖全部所选骰子', () => {
    // 若死守「三同点优先」会拿 devil 组三个 1 得 1000，剩 [2,2] 无法计分 => 误判 invalid
    const result = rules.scoreSelected(['devil', 1, 1, 2, 2]);
    expect(result.valid).toBe(true);
    expect(result.score).toBe(400);
    expect(result.combos.map((c) => c.kind).sort()).toEqual(['nOfAKind', 'single1', 'single1']);
  });

  it('纯 devil 无法形成同点或顺子', () => {
    expect(valid(['devil', 'devil'])).toBe(false);
    expect(rules.isBust(['devil', 'devil'])).toBe(true);
  });
});

describe('computeCombos 提示', () => {
  it('骰池中的单 1 / 单 5 / 同点 / 顺子都被列出', () => {
    const combos = rules.computeCombos([1, 5, 2, 2, 2, 3, 4]);
    const kinds = combos.map((c) => c.kind);
    expect(kinds).toContain('single1');
    expect(kinds).toContain('single5');
    expect(kinds).toContain('nOfAKind');
  });

  it('顺子 1-6 出现在组合列表', () => {
    const combos = rules.computeCombos([1, 2, 3, 4, 5, 6]);
    const straight = combos.find((c) => c.kind === 'straight16');
    expect(straight).toBeDefined();
    expect(straight!.score).toBe(1500);
    expect(straight!.diceIndices).toHaveLength(6);
  });

  it('diceIndices 指向传入数组下标', () => {
    const dice: DieFace[] = [2, 1];
    const combos = rules.computeCombos(dice);
    const single = combos.find((c) => c.kind === 'single1');
    expect(single!.diceIndices).toEqual([1]);
  });

  it('同点组合的 diceIndices 长度等于该组合骰子数', () => {
    const dice: DieFace[] = [2, 2, 2, 2, 'devil'];
    const combos = rules.computeCombos(dice);
    const nOfAKind = combos.filter((c) => c.kind === 'nOfAKind');
    expect(nOfAKind.map((c) => c.diceIndices.length)).toEqual([3, 4, 5]);
    expect(nOfAKind.map((c) => c.score)).toEqual([200, 400, 800]);
    for (const combo of nOfAKind) {
      expect(new Set(combo.diceIndices).size).toBe(combo.diceIndices.length);
      for (const i of combo.diceIndices) {
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(dice.length);
      }
    }
  });

  it('含 devil 的同点组合至少含 1 颗真实面骰', () => {
    const combos = rules.computeCombos(['devil', 'devil', 'devil']);
    expect(combos.filter((c) => c.kind === 'nOfAKind')).toHaveLength(0);
  });
});

describe('rollDicePool', () => {
  it('specs 不足时用普通骰补齐', () => {
    const ordinary = getDieSpec('ordinary')!;
    const result = rules.rollDicePool([ordinary], 3);
    expect(result).toHaveLength(3);
    for (const face of result) {
      expect([1, 2, 3, 4, 5, 6]).toContain(face);
    }
  });

  it('ordinary 掷 6000 次各面出现率在 1/6 ± 0.03 内', () => {
    const ordinary = getDieSpec('ordinary')!;
    const counts = new Map<string, number>();
    const total = 6000;
    for (let i = 0; i < total; i += 1) {
      const [face] = rules.rollDicePool([ordinary], 1);
      counts.set(String(face), (counts.get(String(face)) ?? 0) + 1);
    }
    for (const face of [1, 2, 3, 4, 5, 6]) {
      const rate = (counts.get(String(face)) ?? 0) / total;
      expect(Math.abs(rate - 1 / 6)).toBeLessThanOrEqual(0.03);
    }
  });

  it('devils-head 掷出 1 时返回 devil', () => {
    const devilsHead = getDieSpec('devils-head')!;
    const seen = new Set<string>();
    for (let i = 0; i < 600; i += 1) {
      const [face] = rules.rollDicePool([devilsHead], 1);
      seen.add(String(face));
    }
    expect(seen.has('devil')).toBe(true);
    expect(seen.has('1')).toBe(false);
  });

  it('count = 0 返回空数组', () => {
    expect(rules.rollDicePool([], 0)).toEqual([]);
  });
});

describe('契约一致性', () => {
  it('rules 满足 RulesApi 且四个方法都是函数', () => {
    const api: RulesApi = rules;
    expect(typeof api.scoreSelected).toBe('function');
    expect(typeof api.computeCombos).toBe('function');
    expect(typeof api.isBust).toBe('function');
    expect(typeof api.rollDicePool).toBe('function');
  });

  it('目录元素满足 DieSpec / BadgeSpec 形状', () => {
    for (const spec of DICE_CATALOG as DieSpec[]) {
      expect(typeof spec.id).toBe('string');
      expect(typeof spec.name).toBe('string');
      expect(typeof spec.desc).toBe('string');
    }
    for (const badge of BADGE_CATALOG as BadgeSpec[]) {
      expect(['tin', 'silver', 'gold']).toContain(badge.tier);
      expect(['resurrection', 'warlord']).toContain(badge.effect);
      expect(typeof badge.usesPerGame).toBe('number');
      expect(typeof badge.multiplier).toBe('number');
    }
  });
});

describe('骰子目录', () => {
  it('包含 11 种骰子且 id 唯一', () => {
    expect(DICE_CATALOG).toHaveLength(11);
    const ids = new Set(DICE_CATALOG.map((d) => d.id));
    expect(ids.size).toBe(11);
  });

  it('每个 spec 的 probs 长度为 6 且为正', () => {
    for (const spec of DICE_CATALOG) {
      expect(spec.probs).toHaveLength(6);
      for (const p of spec.probs) expect(p).toBeGreaterThan(0);
    }
  });

  it('getDieSpec 命中与未命中', () => {
    expect(getDieSpec('devils-head')!.devilOnOne).toBe(true);
    expect(getDieSpec('ordinary')!.devilOnOne).toBeUndefined();
    expect(getDieSpec('nope')).toBeUndefined();
  });

  it('按契约给出的概率值', () => {
    const expected: Record<string, number[]> = {
      lucky: [0.273, 0.046, 0.091, 0.136, 0.182, 0.273],
      odd: [0.267, 0.067, 0.267, 0.067, 0.267, 0.067],
      even: [0.067, 0.267, 0.067, 0.267, 0.067, 0.267],
      heavenly: [0.368, 0.105, 0.105, 0.105, 0.105, 0.211],
      aranka: [0.286, 0.048, 0.286, 0.048, 0.286, 0.048],
      trinity: [0.182, 0.091, 0.364, 0.091, 0.182, 0.091],
      misfortune: [0.046, 0.227, 0.227, 0.227, 0.227, 0.046],
      lu: [0.143, 0.143, 0.143, 0.143, 0.143, 0.286],
      cautious: [0.238, 0.143, 0.095, 0.143, 0.238, 0.143],
    };
    for (const [id, probs] of Object.entries(expected)) {
      const spec = getDieSpec(id);
      expect(spec, id).toBeDefined();
      expect(spec!.probs, id).toEqual(probs);
    }
  });
});

describe('徽章目录', () => {
  it('包含 3 种徽章且每级 1 种', () => {
    expect(BADGE_CATALOG).toHaveLength(3);
    expect(BADGE_CATALOG.map((b) => b.tier).sort()).toEqual(['gold', 'silver', 'tin']);
  });

  it('锡·复活徽章字段', () => {
    const badge = getBadgeSpec('tin-resurrection')!;
    expect(badge.effect).toBe('resurrection');
    expect(badge.usesPerGame).toBe(1);
    expect(badge.multiplier).toBe(1);
  });

  it('银·军阀徽章字段', () => {
    const badge = getBadgeSpec('silver-warlord')!;
    expect(badge.effect).toBe('warlord');
    expect(badge.usesPerGame).toBe(1);
    expect(badge.multiplier).toBe(1.5);
  });

  it('金·军阀徽章字段', () => {
    const badge = getBadgeSpec('gold-warlord')!;
    expect(badge.effect).toBe('warlord');
    expect(badge.usesPerGame).toBe(1);
    expect(badge.multiplier).toBe(2);
  });

  it('getBadgeSpec 未命中返回 undefined', () => {
    expect(getBadgeSpec('nope')).toBeUndefined();
  });
});
