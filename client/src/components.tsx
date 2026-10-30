import { useState } from 'react';
import type { DieFace } from '@shared/types';
import { BADGE_CATALOG, DICE_CATALOG } from './catalog';

// ============ SVG 骰子（原创绘制） ============

const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[26, 26], [50, 50], [74, 74]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
  6: [[28, 24], [72, 24], [28, 50], [72, 50], [28, 76], [72, 76]],
};

export function DiceFace({
  face,
  size = 56,
  selected = false,
  highlighted = false,
  dimmed = false,
  onClick,
}: {
  face: DieFace;
  size?: number;
  selected?: boolean;
  highlighted?: boolean;
  dimmed?: boolean;
  onClick?: () => void;
}) {
  const numeric = typeof face === 'number' ? face : null;
  const cls = [
    'die',
    selected ? 'die-sel' : '',
    highlighted && !selected ? 'die-hot' : '',
    dimmed ? 'die-dim' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={cls}
      style={{ width: size, height: size }}
      onClick={onClick}
      disabled={!onClick}
      aria-label={numeric === null ? '恶魔面' : `${numeric} 点`}
      title={selected ? '已勾选' : highlighted ? '可计入组合' : undefined}
    >
      <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">
        <rect x="4" y="4" width="92" height="92" rx="18" className="die-body" />
        <rect x="9" y="9" width="82" height="82" rx="14" className="die-inner" />
        {numeric !== null &&
          (PIPS[numeric] ?? []).map(([cx, cy], i) => <circle key={i} cx={cx} cy={cy} r="9" className="die-pip" />)}
        {numeric === null && <DevilGlyph />}
      </svg>
    </button>
  );
}

/** 原创简笔恶魔脸：双角 + 尖耳 + 横瞳 + 獠牙 */
function DevilGlyph() {
  return (
    <g className="die-devil">
      <path d="M22 26 L14 8 L32 18 Z" />
      <path d="M78 26 L86 8 L68 18 Z" />
      <path d="M50 88 C28 88 20 70 22 52 C24 34 36 24 50 24 C64 24 76 34 78 52 C80 70 72 88 50 88 Z" className="devil-head" />
      <path d="M31 50 L46 55 L31 58 Z" />
      <path d="M69 50 L54 55 L69 58 Z" />
      <path d="M38 70 Q50 78 62 70" className="devil-mouth" />
      <path d="M42 72 L44 78 L46 72 Z" />
      <path d="M54 72 L56 78 L58 72 Z" />
    </g>
  );
}

// ============ 6 格骰子选择器 ============

export function DicePicker({
  value,
  onChange,
}: {
  value: (string | null)[];
  onChange: (v: (string | null)[]) => void;
}) {
  const setSlot = (i: number, id: string | null) => {
    const next = value.slice();
    next[i] = id;
    onChange(next);
  };
  return (
    <div className="picker-grid">
      {value.map((id, i) => (
        <select
          key={i}
          className="slot-select"
          value={id ?? ''}
          onChange={(e) => setSlot(i, e.target.value === '' ? null : e.target.value)}
          aria-label={`第 ${i + 1} 格骰子`}
        >
          <option value="">（空·普通骰）</option>
          {DICE_CATALOG.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      ))}
      <p className="hint">{DICE_CATALOG.find((d) => d.id === value[0])?.desc ?? DICE_CATALOG[0].desc}</p>
    </div>
  );
}

export function makeEmptyDiceSlots(): (string | null)[] {
  return [null, null, null, null, null, null];
}

export function diceSlotsToSet(slots: (string | null)[]): string[] {
  return slots.filter((s): s is string => s !== null);
}

// ============ 徽章选择器 ============

export function BadgePicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  return (
    <div className="badge-row">
      <button type="button" className={value === null ? 'badge-chip badge-on' : 'badge-chip'} onClick={() => onChange(null)}>
        不佩戴
      </button>
      {BADGE_CATALOG.map((b) => (
        <button
          key={b.id}
          type="button"
          className={value === b.id ? `badge-chip badge-${b.tier} badge-on` : `badge-chip badge-${b.tier}`}
          onClick={() => onChange(b.id)}
          title={b.desc}
        >
          {b.name}
        </button>
      ))}
      <p className="hint">{BADGE_CATALOG.find((b) => b.id === value)?.desc ?? '徽章每局可用次数由服务器裁定。'}</p>
    </div>
  );
}

// ============ Toast ============ ============

export function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-copy"
      onClick={() => {
        navigator.clipboard
          ?.writeText(code)
          .then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          })
          .catch(() => setCopied(false));
      }}
    >
      {copied ? '已复制' : '复制房间码'}
    </button>
  );
}
