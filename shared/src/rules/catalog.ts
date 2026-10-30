import type { BadgeSpec, DieSpec } from '../types';

/** 特殊骰目录（probs 长度 6，依次为面 1..6 的概率；使用时会归一化） */
export const DICE_CATALOG: DieSpec[] = [
  {
    id: 'ordinary',
    name: '普通骰',
    desc: '六面等概率的标准骰子。',
    probs: [1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6],
  },
  {
    id: 'devils-head',
    name: '恶魔之首',
    desc: '掷出 1 时记为万能面 devil，可补齐顺子或三同点。',
    probs: [1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6],
    devilOnOne: true,
  },
  {
    id: 'lucky',
    name: '幸运骰',
    desc: '计分面 1 与 5 的概率最高，容易攒分。',
    probs: [0.273, 0.046, 0.091, 0.136, 0.182, 0.273],
  },
  {
    id: 'odd',
    name: '奇数骰',
    desc: '偏向奇数面，1/3/5 合计约 80%。',
    probs: [0.267, 0.067, 0.267, 0.067, 0.267, 0.067],
  },
  {
    id: 'even',
    name: '偶数骰',
    desc: '偏向偶数面，2/4/6 合计约 80%。',
    probs: [0.067, 0.267, 0.067, 0.267, 0.067, 0.267],
  },
  {
    id: 'heavenly',
    name: '天堂骰',
    desc: '1 面概率最高，6 面次之。',
    probs: [0.368, 0.105, 0.105, 0.105, 0.105, 0.211],
  },
  {
    id: 'aranka',
    name: '阿兰卡骰',
    desc: '奇数面合计约 86%，几乎不掷出偶数。',
    probs: [0.286, 0.048, 0.286, 0.048, 0.286, 0.048],
  },
  {
    id: 'trinity',
    name: '三一骰',
    desc: '3 面概率显著偏高。',
    probs: [0.182, 0.091, 0.364, 0.091, 0.182, 0.091],
  },
  {
    id: 'misfortune',
    name: '不幸骰',
    desc: '计分面 1 与 5 的概率最低，最容易爆掉。',
    probs: [0.046, 0.227, 0.227, 0.227, 0.227, 0.046],
  },
  {
    id: 'lu',
    name: '路之骰',
    desc: '六面偏重，其余面均等。',
    probs: [0.143, 0.143, 0.143, 0.143, 0.143, 0.286],
  },
  {
    id: 'cautious',
    name: '谨慎作弊骰',
    desc: '1 与 5 概率偏高，3 面最低。',
    probs: [0.238, 0.143, 0.095, 0.143, 0.238, 0.143],
  },
];

/** 徽章目录：锡/银/金 每级各 1 种 */
export const BADGE_CATALOG: BadgeSpec[] = [
  {
    id: 'tin-resurrection',
    tier: 'tin',
    name: '锡·复活徽章',
    desc: '每局 1 次：本回合爆掉时可保留本回合已得分数，避免归零。',
    effect: 'resurrection',
    usesPerGame: 1,
    multiplier: 1,
  },
  {
    id: 'silver-warlord',
    tier: 'silver',
    name: '银·军阀徽章',
    desc: '每局 1 次：本回合得分按 1.5 倍结算。',
    effect: 'warlord',
    usesPerGame: 1,
    multiplier: 1.5,
  },
  {
    id: 'gold-warlord',
    tier: 'gold',
    name: '金·军阀徽章',
    desc: '每局 1 次：本回合得分按 2 倍结算。',
    effect: 'warlord',
    usesPerGame: 1,
    multiplier: 2,
  },
];

export function getDieSpec(id: string): DieSpec | undefined {
  return DICE_CATALOG.find((d) => d.id === id);
}

export function getBadgeSpec(id: string): BadgeSpec | undefined {
  return BADGE_CATALOG.find((b) => b.id === id);
}
