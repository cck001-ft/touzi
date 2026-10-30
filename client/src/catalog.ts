import { BADGE_CATALOG, DICE_CATALOG } from '@shared/index';

/**
 * 骰子与徽章目录的唯一真源是规则引擎（@shared），本文件只做 re-export，
 * 客户端不得在此定义本地骰子/徽章，也不得引入任何规则或概率逻辑。
 * 客户端只用 id / name / desc 做选择器展示。
 */
export { BADGE_CATALOG, DICE_CATALOG };

export const TARGET_SCORES = [2000, 4000, 6000];

export function dieName(id: string): string {
  return DICE_CATALOG.find((d) => d.id === id)?.name ?? id;
}

export function badgeName(id: string | null | undefined): string {
  if (!id) return '无徽章';
  return BADGE_CATALOG.find((b) => b.id === id)?.name ?? id;
}
