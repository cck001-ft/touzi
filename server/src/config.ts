import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** server/ 根目录 */
export const SERVER_ROOT = path.resolve(here, '..');

/** 运行时数据目录（默认 server/data，可用环境变量覆盖） */
export const DATA_DIR = process.env.KCD2_DATA_DIR ?? path.join(SERVER_ROOT, 'data');

export const PORT = Number(process.env.PORT ?? 3001);

/** 单回合限时（ms） */
export const TURN_MS = Number(process.env.KCD2_TURN_MS ?? 60_000);

/** 断线重连宽限（ms），超时判负 */
export const RECONNECT_GRACE_MS = Number(process.env.KCD2_RECONNECT_MS ?? 90_000);

export const STARTING_COINS = 500;
export const MIN_WAGER = 10;
export const TARGET_SCORES: readonly number[] = [2000, 4000, 6000];
export const MAX_DICE_IN_SET = 6;
export const ROOM_CODE_LENGTH = 6;

/** 徽章是否要求双方等级一致才生效（false 时任意徽章均可使用） */
export const REQUIRE_BADGE_TIER_MATCH = true;
