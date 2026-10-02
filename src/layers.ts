/**
 * 品牌主题 → 主题变体 → 平台变体 三层继承模型
 *
 * 规则：
 * 1. 每层只保存“显式覆盖”（value 非空），空值表示继承上层；
 *    下层只重算没有显式覆盖的值。
 * 2. 引用（{token.id}）自动跟随上游闭包传播，不需要重新确认；
 *    字面量覆盖是“固定值”，上游闭包一变就进入待重新确认状态。
 * 3. 保存采用乐观并发：携带基线版本哈希，后到者遇到 409 冲突，
 *    三方合并后逐令牌选择保留版本，绝不静默覆盖。
 */

export type ThemeId = 'light' | 'dark' | 'ops' | 'contrast';
export type PlatformId = 'component' | 'ops' | 'mobile' | 'data';
export type LayerId = 'brand' | 'theme' | 'platform';

export const THEMES: { id: ThemeId; label: string }[] = [
  { id: 'light', label: '明亮' },
  { id: 'dark', label: '暗色' },
  { id: 'ops', label: '运营' },
  { id: 'contrast', label: '高对比' }
];

export const PLATFORMS: { id: PlatformId; label: string; desc: string }[] = [
  { id: 'component', label: '组件库', desc: '通用组件库默认变体（继承全部主题值）' },
  { id: 'ops', label: '运营后台', desc: '运营产品平台变体，固定运营品牌色' },
  { id: 'mobile', label: '移动端', desc: '触屏移动设备变体，更大字号与圆角' },
  { id: 'data', label: '数据平台', desc: '高密度数据界面变体，更深正文色' }
];

export type TokenCategory = 'color' | 'font' | 'spacing' | 'radius' | 'shadow' | 'component';

export type TokenMeta = {
  id: string;
  name: string;
  category: TokenCategory;
  usage: number;
  status: 'stable' | 'deprecated' | 'proposed';
  description: string;
};

/** 单层单条覆盖：value 为 null/空 表示继承上层 */
export type LayerEntry = {
  value: string | null;
  /** 创建该固定值覆盖时，所确认的上游闭包快照（按主题分别记录） */
  inheritedAtConfirm?: Partial<Record<ThemeId, Record<string, string>>>;
  confirmedBy?: string;
  confirmedAt?: string;
};

export type LayerState = { entries: Record<string, LayerEntry> };

export type LayerTree = {
  brand: LayerState;
  theme: Record<ThemeId, LayerState>;
  platform: Record<PlatformId, LayerState>;
};

/* ----------------------------- 种子数据 ----------------------------- */

const TOKEN_META: TokenMeta[] = [
  { id: 'color.base.blue.600', name: '品牌主色 600', category: 'color', usage: 184, status: 'stable', description: '主操作、链接和重点状态' },
  { id: 'color.semantic.primary', name: '语义主色', category: 'color', usage: 126, status: 'stable', description: '组件库统一主色别名' },
  { id: 'color.base.blue.400', name: '品牌蓝 400', category: 'color', usage: 42, status: 'stable', description: '暗色主题主色' },
  { id: 'color.base.blue.800', name: '品牌蓝 800', category: 'color', usage: 31, status: 'stable', description: '高对比主题主色' },
  { id: 'color.base.green.600', name: '运营绿 600', category: 'color', usage: 67, status: 'proposed', description: '运营产品品牌替换色' },
  { id: 'color.text.primary', name: '正文主色', category: 'color', usage: 293, status: 'stable', description: '主要正文和标题' },
  { id: 'color.text.secondary', name: '正文次色', category: 'color', usage: 211, status: 'stable', description: '辅助信息和说明' },
  { id: 'color.surface.canvas', name: '页面背景', category: 'color', usage: 54, status: 'stable', description: '应用一级背景' },
  { id: 'font.family.sans', name: '无衬线字体', category: 'font', usage: 388, status: 'stable', description: '产品界面默认真体' },
  { id: 'font.size.body', name: '正文字号', category: 'font', usage: 255, status: 'stable', description: '正文与表单文本' },
  { id: 'spacing.base.2', name: '基础间距 2', category: 'spacing', usage: 312, status: 'stable', description: '紧凑布局基础间距' },
  { id: 'radius.control', name: '控件圆角', category: 'radius', usage: 167, status: 'stable', description: '按钮、输入框和卡片' },
  { id: 'shadow.raised', name: '浮层阴影', category: 'shadow', usage: 36, status: 'stable', description: '菜单、弹窗和浮层' },
  { id: 'component.button.primary.bg', name: '主按钮背景', category: 'component', usage: 98, status: 'stable', description: '主要操作按钮' },
  { id: 'component.button.primary.text', name: '主按钮文字', category: 'component', usage: 98, status: 'stable', description: '主要操作按钮文字' }
];

/** 品牌层：基础令牌值。运营绿已由 #24786a 调整为 #1f6b5e（品牌基础值变更） */
const BRAND_VALUES: Record<string, string> = {
  'color.base.blue.600': '#2864dc',
  'color.base.blue.400': '#6f96ff',
  'color.base.blue.800': '#0b4dba',
  'color.base.green.600': '#1f6b5e',
  'color.text.primary': '#17202b',
  'color.text.secondary': '#667582',
  'color.surface.canvas': '#f2f5f7',
  'font.family.sans': '"Noto Sans SC", sans-serif',
  'font.size.body': '14px',
  'spacing.base.2': '8px',
  'radius.control': '6px',
  'shadow.raised': '0 8px 28px rgba(22,35,48,.14)'
};

/** 主题层：每个主题对全部令牌的显式赋值（引用或字面量） */
const THEME_VALUES: Record<ThemeId, Record<string, string>> = {
  light: {
    'color.base.blue.600': '#2864dc',
    'color.semantic.primary': '{color.base.blue.600}',
    'color.base.blue.400': '#6f96ff',
    'color.base.blue.800': '#0b4dba',
    'color.text.primary': '#17202b',
    'color.text.secondary': '#667582',
    'color.surface.canvas': '#f2f5f7',
    'font.family.sans': '"Noto Sans SC", sans-serif',
    'font.size.body': '14px',
    'spacing.base.2': '8px',
    'radius.control': '6px',
    'shadow.raised': '0 8px 28px rgba(22,35,48,.14)',
    'component.button.primary.bg': '{color.semantic.primary}',
    'component.button.primary.text': '#ffffff'
  },
  dark: {
    'color.base.blue.600': '#2864dc',
    'color.semantic.primary': '{color.base.blue.400}',
    'color.base.blue.400': '#6f96ff',
    'color.base.blue.800': '#9ab9ff',
    'color.text.primary': '#f5f7fa',
    'color.text.secondary': '#a8b2bd',
    'color.surface.canvas': '#121821',
    'font.family.sans': '"Noto Sans SC", sans-serif',
    'font.size.body': '14px',
    'spacing.base.2': '8px',
    'radius.control': '6px',
    'shadow.raised': '0 8px 28px rgba(0,0,0,.42)',
    'component.button.primary.bg': '{color.semantic.primary}',
    'component.button.primary.text': '#ffffff'
  },
  ops: {
    'color.base.blue.600': '#2864dc',
    'color.semantic.primary': '{color.base.green.600}',
    'color.base.blue.400': '#58a99a',
    'color.base.blue.800': '#145c51',
    'color.text.primary': '#152a25',
    'color.text.secondary': '#62766f',
    'color.surface.canvas': '#f1f6f4',
    'font.family.sans': '"Noto Sans SC", sans-serif',
    'font.size.body': '14px',
    'spacing.base.2': '8px',
    'radius.control': '4px',
    'shadow.raised': '0 8px 28px rgba(21,54,45,.14)',
    'component.button.primary.bg': '{color.semantic.primary}',
    'component.button.primary.text': '#ffffff'
  },
  contrast: {
    'color.base.blue.600': '#2864dc',
    'color.semantic.primary': '{color.base.blue.800}',
    'color.base.blue.400': '#2878e8',
    'color.base.blue.800': '#06358a',
    'color.text.primary': '#000000',
    'color.text.secondary': '#303b46',
    'color.surface.canvas': '#ffffff',
    'font.family.sans': 'system-ui, sans-serif',
    'font.size.body': '16px',
    'spacing.base.2': '8px',
    'radius.control': '4px',
    'shadow.raised': '0 0 0 2px #303b46',
    'component.button.primary.bg': '{color.semantic.primary}',
    'component.button.primary.text': '#ffffff'
  }
};

/** 平台层：仅保存显式覆盖（固定值）。引用型覆盖自动跟随，无需确认 */
const PLATFORM_VALUES: Record<PlatformId, Record<string, LayerEntry>> = {
  component: {},
  ops: {
    // 运营后台固定语义主色为 #24786a；确认时上游运营绿为 #24786a，
    // 品牌基础值现已变更为 #1f6b5e → 待重新确认
    'color.semantic.primary': {
      value: '#24786a',
      inheritedAtConfirm: {
        light: { 'color.base.blue.600': '#2864dc' },
        dark: { 'color.base.blue.400': '#6f96ff' },
        ops: { 'color.base.green.600': '#24786a' },
        contrast: { 'color.base.blue.800': '#06358a' }
      },
      confirmedBy: '顾清 · Core DS',
      confirmedAt: '2026-09-18 10:24'
    }
  },
  mobile: {
    // 移动端固定正文字号 16px；品牌正文字号未变 → 仍然有效
    'font.size.body': {
      value: '16px',
      inheritedAtConfirm: {
        light: { 'font.size.body': '14px' },
        dark: { 'font.size.body': '14px' },
        ops: { 'font.size.body': '14px' },
        contrast: { 'font.size.body': '16px' }
      },
      confirmedBy: '周序 · 移动端',
      confirmedAt: '2026-09-02 15:40'
    }
  },
  data: {
    // 数据平台固定正文主色 #1c2733；品牌正文色未变 → 仍然有效
    'color.text.primary': {
      value: '#1c2733',
      inheritedAtConfirm: {
        light: { 'color.text.primary': '#17202b' },
        dark: { 'color.text.primary': '#f5f7fa' },
        ops: { 'color.text.primary': '#152a25' },
        contrast: { 'color.text.primary': '#000000' }
      },
      confirmedBy: '周序 · 数据平台',
      confirmedAt: '2026-08-21 09:12'
    }
  }
};

export const TOKEN_META_BY_ID: Record<string, TokenMeta> = Object.fromEntries(TOKEN_META.map((t) => [t.id, t]));

export function buildSeedTree(): LayerTree {
  const brand: LayerState = { entries: {} };
  for (const [id, value] of Object.entries(BRAND_VALUES)) {
    brand.entries[id] = { value };
  }
  const theme = {} as Record<ThemeId, LayerState>;
  for (const th of THEMES) {
    const entries: Record<string, LayerEntry> = {};
    for (const [id, value] of Object.entries(THEME_VALUES[th.id])) {
      entries[id] = { value };
    }
    theme[th.id] = { entries };
  }
  const platform = {} as Record<PlatformId, LayerState>;
  for (const p of PLATFORMS) {
    const entries: Record<string, LayerEntry> = {};
    for (const [id, entry] of Object.entries(PLATFORM_VALUES[p.id])) {
      entries[id] = { ...entry, inheritedAtConfirm: entry.inheritedAtConfirm ? { ...entry.inheritedAtConfirm } : undefined };
    }
    platform[p.id] = { entries };
  }
  return { brand, theme, platform };
}

/* ------------------------------- 解析逻辑 ------------------------------- */

export function parseRef(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = value.match(/^\{([^{}]+)\}$/);
  return m ? m[1] : null;
}

/** 取某令牌在指定作用域的原始条目（不解析引用）及来源层 */
export function rawEntry(
  tree: LayerTree,
  platform: PlatformId,
  theme: ThemeId,
  id: string
): { value: string | null; source: LayerId } {
  const p = tree.platform[platform].entries[id];
  if (p && p.value !== null && p.value !== undefined && p.value !== '') return { value: p.value, source: 'platform' };
  const t = tree.theme[theme].entries[id];
  if (t && t.value !== null && t.value !== undefined && t.value !== '') return { value: t.value, source: 'theme' };
  const b = tree.brand.entries[id];
  if (b && b.value !== null && b.value !== undefined && b.value !== '') return { value: b.value, source: 'brand' };
  return { value: null, source: 'brand' };
}

/** 解析引用后的最终值（{x.y} 沿继承链与引用链求值） */
export function resolveValue(
  tree: LayerTree,
  platform: PlatformId,
  theme: ThemeId,
  id: string,
  seen: Set<string> = new Set()
): string {
  const { value } = rawEntry(tree, platform, theme, id);
  if (value === null) return '';
  const ref = parseRef(value);
  if (ref && !seen.has(ref)) {
    seen.add(ref);
    return resolveValue(tree, platform, theme, ref, seen);
  }
  return value;
}

function withoutPlatform(tree: LayerTree, platform: PlatformId, id: string): LayerTree {
  const clone: LayerTree = {
    brand: { entries: { ...tree.brand.entries } },
    theme: { ...tree.theme },
    platform: { ...tree.platform }
  };
  clone.platform[platform] = { entries: { ...tree.platform[platform].entries, [id]: { value: null } } };
  return clone;
}

/** 解析某令牌的引用闭包：闭包内每个令牌的最终值（含自身） */
export function closureSnapshot(
  tree: LayerTree,
  platform: PlatformId,
  theme: ThemeId,
  id: string,
  opts?: { inherited?: boolean }
): Record<string, string> {
  const work = opts?.inherited ? withoutPlatform(tree, platform, id) : tree;
  const out: Record<string, string> = {};
  const seen = new Set<string>();
  const walk = (tid: string) => {
    if (seen.has(tid)) return;
    seen.add(tid);
    out[tid] = resolveValue(work, platform, theme, tid, new Set([...seen]));
    const ref = parseRef(rawEntry(work, platform, theme, tid).value);
    if (ref) walk(ref);
  };
  walk(id);
  return out;
}

/** 引用该令牌的下游（反向依赖，BFS） */
export function downstreamIds(tree: LayerTree, platform: PlatformId, theme: ThemeId, id: string): string[] {
  const dependents = (tid: string) =>
    TOKEN_META.filter((m) => {
      const raw = rawEntry(tree, platform, theme, m.id).value;
      return parseRef(raw) === tid;
    }).map((m) => m.id);
  const out: string[] = [];
  const seen = new Set<string>();
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const d of dependents(cur)) {
      if (!seen.has(d)) {
        seen.add(d);
        out.push(d);
        queue.push(d);
      }
    }
  }
  return out;
}

/* ----------------------------- 固定值过期检测 ----------------------------- */

export type StalePin = {
  platform: PlatformId;
  tokenId: string;
  pinValue: string;
  affectedThemes: ThemeId[];
  changedUpstream: { id: string; before: string; after: string }[];
};

/**
 * 平台固定值覆盖（字面量）在两种情况下需要重新确认：
 * 创建时记录了上游闭包快照，而当前上游闭包的值已经变化。
 * 引用型覆盖自动跟随上游，不进入此列表。
 */
export function findStalePins(tree: LayerTree): StalePin[] {
  const out: StalePin[] = [];
  for (const p of PLATFORMS) {
    for (const [id, entry] of Object.entries(tree.platform[p.id].entries)) {
      if (!entry.value || parseRef(entry.value)) continue;
      const atConfirm = entry.inheritedAtConfirm;
      if (!atConfirm) continue;
      const affectedThemes: ThemeId[] = [];
      const changed = new Map<string, { before: string; after: string }>();
      for (const theme of THEMES) {
        const oldSnap = atConfirm[theme.id];
        if (!oldSnap) continue;
        const newSnap = closureSnapshot(tree, p.id, theme.id, id, { inherited: true });
        let themeChanged = false;
        for (const [upId, oldVal] of Object.entries(oldSnap)) {
          const newVal = newSnap[upId];
          if (newVal !== undefined && newVal !== oldVal) {
            themeChanged = true;
            if (!changed.has(upId)) changed.set(upId, { before: oldVal, after: newVal });
          }
        }
        if (themeChanged) affectedThemes.push(theme.id);
      }
      if (affectedThemes.length) {
        out.push({
          platform: p.id,
          tokenId: id,
          pinValue: entry.value,
          affectedThemes,
          changedUpstream: [...changed].map(([upId, v]) => ({ id: upId, ...v }))
        });
      }
    }
  }
  return out;
}

/* ------------------------------- 哈希与合并 ------------------------------- */

export function hashEntries(entries: Record<string, LayerEntry>): string {
  const body = Object.entries(entries)
    .map(([id, e]) => `${id}=${e.value ?? ''}`)
    .sort()
    .join('|');
  let h = 0;
  for (const ch of body) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `h${h.toString(36)}_${body.length}`;
}

export function scopeKey(layer: LayerId, scope: string): string {
  return `${layer}:${scope}`;
}

export function entriesOf(tree: LayerTree, layer: LayerId, scope: string): Record<string, LayerEntry> {
  if (layer === 'brand') return tree.brand.entries;
  if (layer === 'theme') return tree.theme[scope as ThemeId].entries;
  return tree.platform[scope as PlatformId].entries;
}

export function setEntries(tree: LayerTree, layer: LayerId, scope: string, entries: Record<string, LayerEntry>) {
  if (layer === 'brand') tree.brand = { entries };
  else if (layer === 'theme') tree.theme[scope as ThemeId] = { entries };
  else tree.platform[scope as PlatformId] = { entries };
}

/** 相对基线的差异：值变化或新增/删除 */
export function diffEntries(
  base: Record<string, LayerEntry>,
  next: Record<string, LayerEntry>
): Record<string, string | null> {
  const changes: Record<string, string | null> = {};
  const ids = new Set([...Object.keys(base), ...Object.keys(next)]);
  for (const id of ids) {
    const b = base[id]?.value ?? null;
    const n = next[id]?.value ?? null;
    if (b !== n) changes[id] = n;
  }
  return changes;
}

/* ------------------------------- 模拟服务端 ------------------------------- */

export type ConflictItem = {
  tokenId: string;
  base: string | null;
  mine: string | null;
  theirs: string | null;
};

export type SaveConflict = {
  layer: LayerId;
  scope: string;
  baseHash: string;
  currentHash: string;
  items: ConflictItem[];
  serverOnly: string[];
  theirs: Record<string, LayerEntry>;
};

export type SaveResult = { ok: true; hash: string } | { ok: false; conflict: SaveConflict };

type Head = {
  hash: string;
  entries: Record<string, LayerEntry>;
  history: Map<string, Record<string, LayerEntry>>;
};

const heads = new Map<string, Head>();

function seedHead(tree: LayerTree) {
  heads.clear();
  const all: [LayerId, string, Record<string, LayerEntry>][] = [
    ['brand', 'brand', tree.brand.entries],
    ...THEMES.map((t) => ['theme', t.id, tree.theme[t.id].entries] as [LayerId, string, Record<string, LayerEntry>]),
    ...PLATFORMS.map((p) => ['platform', p.id, tree.platform[p.id].entries] as [LayerId, string, Record<string, LayerEntry>])
  ];
  for (const [layer, scope, entries] of all) {
    const hash = hashEntries(entries);
    heads.set(scopeKey(layer, scope), { hash, entries: cloneEntries(entries), history: new Map([[hash, cloneEntries(entries)]]) });
  }
}

function cloneEntries(entries: Record<string, LayerEntry>): Record<string, LayerEntry> {
  return Object.fromEntries(Object.entries(entries).map(([id, e]) => [id, { ...e }]));
}

function applyChanges(entries: Record<string, LayerEntry>, changes: Record<string, string | null>): Record<string, LayerEntry> {
  const next = cloneEntries(entries);
  for (const [id, value] of Object.entries(changes)) {
    if (value === null) delete next[id];
    else next[id] = { ...next[id], value };
  }
  return next;
}

/** 另一位维护员（周序）已经保存的内容：品牌层 3 处变更 */
export const PEER_SAVE: Record<string, Record<string, string | null>> = {
  brand: {
    'color.base.blue.600': '#2563d6',
    'color.base.green.600': '#1d6357',
    'color.text.secondary': '#5f6f7c'
  }
};

export async function initServer(tree: LayerTree) {
  seedHead(tree);
}

export async function currentHashes(): Promise<Record<string, string>> {
  return Object.fromEntries([...heads.entries()].map(([key, head]) => [key, head.hash]));
}

export async function saveLayer(req: {
  layer: LayerId;
  scope: string;
  baseHash: string;
  changes: Record<string, string | null>;
  actor: string;
}): Promise<SaveResult> {
  const key = scopeKey(req.layer, req.scope);
  const head = heads.get(key)!;
  await new Promise((r) => setTimeout(r, 180));
  if (req.baseHash !== head.hash) {
    const base = head.history.get(req.baseHash) ?? head.entries;
    const mine = applyChanges(base, req.changes);
    const theirs = head.entries;
    const items: ConflictItem[] = [];
    for (const id of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
      const b = base[id]?.value ?? null;
      const m = mine[id]?.value ?? null;
      const t = theirs[id]?.value ?? null;
      if (m !== b && t !== b && m !== t) items.push({ tokenId: id, base: b, mine: m, theirs: t });
    }
    const serverOnly = Object.keys(theirs).filter((id) => {
      const b = base[id]?.value ?? null;
      const m = mine[id]?.value ?? null;
      return theirs[id]?.value !== b && m === b;
    });
    return {
      ok: false,
      conflict: {
        layer: req.layer,
        scope: req.scope,
        baseHash: req.baseHash,
        currentHash: head.hash,
        items,
        serverOnly,
        theirs: cloneEntries(theirs)
      }
    };
  }
  const merged = applyChanges(head.entries, req.changes);
  const hash = hashEntries(merged);
  head.entries = merged;
  head.hash = hash;
  head.history.set(hash, cloneEntries(merged));
  return { ok: true, hash };
}

/** 模拟另一位维护员在品牌层保存（用于演示并发冲突） */
export async function simulatePeerSave(layer: LayerId, scope: string): Promise<void> {
  const key = scopeKey(layer, scope);
  const head = heads.get(key)!;
  const changes = PEER_SAVE[scope] ?? PEER_SAVE.brand;
  const merged = applyChanges(head.entries, changes);
  const hash = hashEntries(merged);
  head.entries = merged;
  head.hash = hash;
  head.history.set(hash, cloneEntries(merged));
}
