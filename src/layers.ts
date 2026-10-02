// 品牌主题 → 平台变体的继承链模型与纯函数解析器。
// 关键约定：
// 1. 每个令牌在每一层只有两种状态——显式覆盖(override)或继承(inherit)。
// 2. 上级改值后，下级继承值即时重算；显式覆盖不会被静默改写，
//    而是通过 confirmedUpstreamResolved 快照判定是否需要“再确认”。
// 3. 所有写入都带 revision，后保存者靠 revision 发现冲突，必须显式仲裁。

export type LayerId = 'brand' | 'ios' | 'android' | 'web';
export type LayerKind = 'brand' | 'platform';

export interface Layer {
  id: LayerId;
  name: string;
  short: string;
  kind: LayerKind;
  parentId: LayerId | null;
  platform: string;
}

export const LAYERS: Layer[] = [
  { id: 'brand', name: '品牌基础层', short: '品牌', kind: 'brand', parentId: null, platform: '设计系统核心品牌' },
  { id: 'ios', name: 'iOS 平台变体', short: 'iOS', kind: 'platform', parentId: 'brand', platform: 'iOS · iPadOS' },
  { id: 'android', name: 'Android 平台变体', short: 'Android', kind: 'platform', parentId: 'brand', platform: 'Android · 鸿蒙' },
  { id: 'web', name: 'Web 平台变体', short: 'Web', kind: 'platform', parentId: 'brand', platform: '桌面 Web · 移动 H5' }
];

export const LAYER_BY_ID: Record<LayerId, Layer> = LAYERS.reduce((acc, layer) => {
  acc[layer.id] = layer;
  return acc;
}, {} as Record<LayerId, Layer>);

/** 从根到当前层的继承链。 */
export function ancestorChain(layerId: LayerId): Layer[] {
  const chain: Layer[] = [];
  let current: Layer | undefined = LAYER_BY_ID[layerId];
  const guard = new Set<LayerId>();
  while (current) {
    if (guard.has(current.id)) break; // 防御性环检测
    guard.add(current.id);
    chain.unshift(current);
    current = current.parentId ? LAYER_BY_ID[current.parentId] : undefined;
  }
  return chain;
}

export interface StoredValue {
  value: string;
  revision: number;
  updatedAt: string;
  updatedBy: string;
}

export interface Override extends StoredValue {
  /** 上次显式确认时，上级（解析后）的值；与当前上游不一致即“待再确认”。 */
  confirmedUpstreamResolved: string;
}

export interface LayerModel {
  base: Record<string, StoredValue>;
  overrides: Record<string, Partial<Record<LayerId, Override>>>;
}

export interface Resolution extends StoredValue {
  /** 该层该令牌的原始值（可能是 {ref} 引用）。 */
  raw: string;
  /** 递归解析引用后的最终值。 */
  resolved: string;
  /** 值实际来自哪一层。 */
  sourceLayerId: LayerId;
  /** 当前层是否显式覆盖。 */
  overridden: boolean;
  /** 覆盖值所对应的上游快照是否过期（品牌基础值已变、尚未再确认）。 */
  stale: boolean;
  confirmedUpstreamResolved?: string;
}

const REF_PATTERN = /^\{([^{}]+)\}$/;

function effectiveRaw(model: LayerModel, layerId: LayerId, tokenId: string): { raw: string; sourceLayerId: LayerId; stored: StoredValue } {
  if (layerId === 'brand') {
    const stored = model.base[tokenId];
    return { raw: stored?.value ?? '', sourceLayerId: 'brand', stored: stored ?? EMPTY_VALUE };
  }
  const own = model.overrides[tokenId]?.[layerId];
  if (own) return { raw: own.value, sourceLayerId: layerId, stored: own };
  const parentId = LAYER_BY_ID[layerId].parentId;
  return effectiveRaw(model, parentId ?? 'brand', tokenId);
}

const EMPTY_VALUE: StoredValue = { value: '', revision: 0, updatedAt: '', updatedBy: '' };

/** 在指定层上下文中把 {token.id} 引用递归解析成字面值。 */
export function materialize(model: LayerModel, contextLayer: LayerId, tokenId: string, seen: Set<string> = new Set()): string {
  if (seen.has(tokenId)) return `{循环:${tokenId}}`;
  seen.add(tokenId);
  const { raw, sourceLayerId } = effectiveRaw(model, contextLayer, tokenId);
  const match = raw.match(REF_PATTERN);
  if (!match) return raw;
  return materialize(model, sourceLayerId, match[1], new Set(seen));
}

export function resolveCell(model: LayerModel, layerId: LayerId, tokenId: string): Resolution {
  const { raw, sourceLayerId, stored } = effectiveRaw(model, layerId, tokenId);
  const resolved = materialize(model, sourceLayerId, tokenId);
  const overridden = layerId !== 'brand' && sourceLayerId === layerId;
  let stale = false;
  let confirmedUpstreamResolved: string | undefined;
  if (overridden) {
    const parentId = LAYER_BY_ID[layerId].parentId ?? 'brand';
    const own = model.overrides[tokenId]?.[layerId];
    confirmedUpstreamResolved = own?.confirmedUpstreamResolved;
    stale = confirmedUpstreamResolved !== resolveCell(model, parentId, tokenId).resolved;
  }
  return {
    raw,
    resolved,
    sourceLayerId,
    overridden,
    stale,
    confirmedUpstreamResolved,
    value: stored.value,
    revision: stored.revision,
    updatedAt: stored.updatedAt,
    updatedBy: stored.updatedBy
  };
}

export function upstreamResolution(model: LayerModel, layerId: LayerId, tokenId: string): Resolution | null {
  const parentId = LAYER_BY_ID[layerId].parentId;
  return parentId ? resolveCell(model, parentId, tokenId) : null;
}

// ── 组件绑定：受影响组件预览与依赖链 ──────────────────────────────────────────

export interface BoundToken {
  role: string;
  tokenId: string;
}

export interface BoundComponent {
  id: string;
  name: string;
  group: string;
  tokens: BoundToken[];
}

export const COMPONENTS: BoundComponent[] = [
  {
    id: 'button-primary',
    name: '主按钮 Button',
    group: '基础组件',
    tokens: [
      { role: '背景', tokenId: 'component.button.primary.bg' },
      { role: '文字', tokenId: 'component.button.primary.text' },
      { role: '圆角', tokenId: 'radius.control' }
    ]
  },
  {
    id: 'input',
    name: '输入框 Input',
    group: '表单组件',
    tokens: [
      { role: '正文', tokenId: 'color.text.primary' },
      { role: '占位符', tokenId: 'color.text.secondary' },
      { role: '圆角', tokenId: 'radius.control' }
    ]
  },
  {
    id: 'card',
    name: '卡片 Card',
    group: '容器组件',
    tokens: [
      { role: '背景', tokenId: 'color.surface.canvas' },
      { role: '阴影', tokenId: 'shadow.raised' },
      { role: '圆角', tokenId: 'radius.control' }
    ]
  },
  {
    id: 'dropdown-menu',
    name: '浮层菜单 Menu',
    group: '浮层组件',
    tokens: [
      { role: '面板背景', tokenId: 'color.surface.canvas' },
      { role: '阴影', tokenId: 'shadow.raised' },
      { role: '圆角', tokenId: 'radius.control' }
    ]
  }
];

export function componentsUsingToken(tokenId: string, descendants: Set<string>): BoundComponent[] {
  const result: BoundComponent[] = [];
  for (const component of COMPONENTS) {
    if (component.tokens.some((bind) => bind.tokenId === tokenId || descendants.has(bind.tokenId))) {
      if (!result.some((item) => item.id === component.id)) result.push(component);
    }
  }
  return result;
}

// ── 种子数据（品牌基础值，取自现有 light 主题基线） ────────────────────────────

export const SEED_BASE: Record<string, StoredValue> = {
  'color.base.blue.600': { value: '#2864dc', revision: 1, updatedAt: '2026-09-01 10:02', updatedBy: '顾清 · Core DS' },
  'color.semantic.primary': { value: '{color.base.blue.600}', revision: 1, updatedAt: '2026-09-01 10:02', updatedBy: '顾清 · Core DS' },
  'color.base.blue.400': { value: '#6f96ff', revision: 1, updatedAt: '2026-09-01 10:02', updatedBy: '顾清 · Core DS' },
  'color.base.blue.800': { value: '#0b4dba', revision: 1, updatedAt: '2026-09-01 10:02', updatedBy: '顾清 · Core DS' },
  'color.base.green.600': { value: '#24786a', revision: 1, updatedAt: '2026-09-01 10:02', updatedBy: '顾清 · Core DS' },
  'color.text.primary': { value: '#17202b', revision: 1, updatedAt: '2026-09-01 10:02', updatedBy: '顾清 · Core DS' },
  'color.text.secondary': { value: '#667582', revision: 1, updatedAt: '2026-09-01 10:02', updatedBy: '顾清 · Core DS' },
  'color.surface.canvas': { value: '#f2f5f7', revision: 1, updatedAt: '2026-09-01 10:02', updatedBy: '顾清 · Core DS' },
  'font.family.sans': { value: '"Noto Sans SC", sans-serif', revision: 1, updatedAt: '2026-09-01 10:02', updatedBy: '顾清 · Core DS' },
  'font.size.body': { value: '14px', revision: 1, updatedAt: '2026-09-01 10:02', updatedBy: '顾清 · Core DS' },
  'spacing.base.2': { value: '8px', revision: 1, updatedAt: '2026-09-01 10:02', updatedBy: '顾清 · Core DS' },
  // 品牌层已于 09-21 把圆角从 8px 统一为 6px（CR-423），iOS 的 8px 覆盖因此进入“待再确认”。
  'radius.control': { value: '6px', revision: 2, updatedAt: '2026-09-21 15:40', updatedBy: '顾清 · Core DS' },
  'shadow.raised': { value: '0 8px 28px rgba(22,35,48,.14)', revision: 1, updatedAt: '2026-09-01 10:02', updatedBy: '顾清 · Core DS' },
  'component.button.primary.bg': { value: '{color.semantic.primary}', revision: 1, updatedAt: '2026-09-01 10:02', updatedBy: '顾清 · Core DS' },
  'component.button.primary.text': { value: '#ffffff', revision: 1, updatedAt: '2026-09-01 10:02', updatedBy: '顾清 · Core DS' }
};

export interface SeedOverride extends Override {
  layerId: LayerId;
  tokenId: string;
}

export function buildSeedOverrides(): Record<string, Partial<Record<LayerId, Override>>> {
  const model: LayerModel = { base: SEED_BASE, overrides: {} };
  const put = (
    overrides: Record<string, Partial<Record<LayerId, Override>>>,
    layerId: LayerId,
    tokenId: string,
    value: string,
    updatedAt: string,
    updatedBy: string
  ) => {
    const parentId = LAYER_BY_ID[layerId].parentId ?? 'brand';
    const snapshot = resolveCell(model, parentId, tokenId).resolved;
    if (!overrides[tokenId]) overrides[tokenId] = {};
    overrides[tokenId][layerId] = { value, revision: 1, updatedAt, updatedBy, confirmedUpstreamResolved: snapshot };
  };
  const overrides: Record<string, Partial<Record<LayerId, Override>>> = {};
  put(overrides, 'ios', 'color.semantic.primary', '{color.base.blue.400}', '2026-09-05 11:20', '林澜 · iOS 平台组');
  // 故意保留旧快照 8px：品牌层 09-21 改成 6px 后此覆盖尚未再确认。
  overrides['radius.control'] = {
    ios: { value: '8px', revision: 3, updatedAt: '2026-09-12 09:30', updatedBy: '林澜 · iOS 平台组', confirmedUpstreamResolved: '8px' }
  };
  put(overrides, 'android', 'radius.control', '10dp', '2026-09-10 16:42', '周序 · Android 平台组');
  put(overrides, 'web', 'color.semantic.primary', '{color.base.green.600}', '2026-09-18 10:12', '顾清 · Core DS');
  put(overrides, 'ios', 'font.size.body', '15px', '2026-09-08 14:05', '林澜 · iOS 平台组');
  // 高对比诉求曾让 Web 正文停在 14px，确认快照为旧品牌值 14px；
  // 若品牌正文字号变更，此覆盖同样需要再确认。
  overrides['font.size.body']!.web = { value: '14px', revision: 1, updatedAt: '2026-09-06 09:18', updatedBy: '顾清 · Core DS', confirmedUpstreamResolved: '14px' };
  return overrides;
}

export const SEED_HISTORY: Record<string, HistoryEntry[]> = {
  'brand::radius.control': [
    { at: '2026-09-21 15:40', by: '顾清 · Core DS', value: '6px', note: '统一浮层圆角（CR-423 接受）' },
    { at: '2026-09-01 10:02', by: '顾清 · Core DS', value: '8px', note: '品牌基线初始化' }
  ],
  'ios::radius.control': [
    { at: '2026-09-12 09:30', by: '林澜 · iOS 平台组', value: '8px', note: '与 iOS HIG 视觉节奏对齐' },
    { at: '2026-09-02 11:15', by: '林澜 · iOS 平台组', value: '10px', note: '跟随 iOS 16 控件规范' }
  ],
  'ios::color.semantic.primary': [
    { at: '2026-09-05 11:20', by: '林澜 · iOS 平台组', value: '{color.base.blue.400}', note: '暗色/亮蓝体系改用 400 阶' }
  ],
  'android::radius.control': [
    { at: '2026-09-10 16:42', by: '周序 · Android 平台组', value: '10dp', note: 'Material 形状令牌映射' }
  ],
  'web::color.semantic.primary': [
    { at: '2026-09-18 10:12', by: '顾清 · Core DS', value: '{color.base.green.600}', note: '运营产品品牌切换（CR-412 试点）' }
  ]
};

export interface HistoryEntry {
  at: string;
  by: string;
  value: string;
  note?: string;
}

export function historyKey(layerId: LayerId, tokenId: string): string {
  return `${layerId}::${tokenId}`;
}
