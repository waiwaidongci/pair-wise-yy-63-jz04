import { defineStore } from 'pinia';
import {
  LAYERS,
  LAYER_BY_ID,
  SEED_BASE,
  SEED_HISTORY,
  ancestorChain,
  buildSeedOverrides,
  componentsUsingToken,
  historyKey,
  materialize,
  resolveCell,
  upstreamResolution,
  type HistoryEntry,
  type LayerId,
  type LayerModel,
  type Override
} from './layers';

export interface TokenMeta {
  id: string;
  name: string;
  category: 'color' | 'font' | 'spacing' | 'radius' | 'shadow' | 'component';
  description: string;
}

const TOKEN_META: TokenMeta[] = [
  { id: 'color.base.blue.600', name: '品牌主色 600', category: 'color', description: '主操作、链接和重点状态' },
  { id: 'color.semantic.primary', name: '语义主色', category: 'color', description: '组件库统一主色别名' },
  { id: 'color.base.blue.400', name: '品牌蓝 400', category: 'color', description: '暗色主题主色' },
  { id: 'color.base.blue.800', name: '品牌蓝 800', category: 'color', description: '高对比主题主色' },
  { id: 'color.base.green.600', name: '运营绿 600', category: 'color', description: '运营产品品牌替换色' },
  { id: 'color.text.primary', name: '正文主色', category: 'color', description: '主要正文和标题' },
  { id: 'color.text.secondary', name: '正文次色', category: 'color', description: '辅助信息和说明' },
  { id: 'color.surface.canvas', name: '页面背景', category: 'color', description: '应用一级背景' },
  { id: 'font.family.sans', name: '无衬线字体', category: 'font', description: '产品界面默认字体' },
  { id: 'font.size.body', name: '正文字号', category: 'font', description: '正文与表单文本' },
  { id: 'spacing.base.2', name: '基础间距 2', category: 'spacing', description: '紧凑布局基础间距' },
  { id: 'radius.control', name: '控件圆角', category: 'radius', description: '按钮、输入框和卡片' },
  { id: 'shadow.raised', name: '浮层阴影', category: 'shadow', description: '菜单、弹窗和浮层' },
  { id: 'component.button.primary.bg', name: '主按钮背景', category: 'component', description: '主要操作按钮' },
  { id: 'component.button.primary.text', name: '主按钮文字', category: 'component', description: '主要操作按钮文字' }
];

/** 每个“单元格”的引用后继（token → 直接引用它的令牌集合）。 */
function buildReverseRefs(model: LayerModel): Map<string, Set<string>> {
  const refs = new Map<string, Set<string>>();
  TOKEN_META.forEach((meta) => {
    const cell = resolveCell(model, 'brand', meta.id);
    const match = cell.raw.match(/^\{([^{}]+)\}$/);
    if (match) {
      if (!refs.has(match[1])) refs.set(match[1], new Set());
      refs.get(match[1])!.add(meta.id);
    }
  });
  // 平台层覆盖也可能改写成引用别的令牌（如 iOS 语义主色 → blue.400）。
  LAYERS.forEach((layer) => {
    if (layer.kind !== 'platform') return;
    TOKEN_META.forEach((meta) => {
      const cell = resolveCell(model, layer.id, meta.id);
      if (!cell.overridden) return;
      const match = cell.raw.match(/^\{([^{}]+)\}$/);
      if (match) {
        if (!refs.has(match[1])) refs.set(match[1], new Set());
        refs.get(match[1])!.add(meta.id);
      }
    });
  });
  return refs;
}

/** 所有（传递）依赖某令牌的令牌 id。 */
export function descendantsOf(model: LayerModel, tokenId: string): Set<string> {
  const refs = buildReverseRefs(model);
  const result = new Set<string>();
  const walk = (id: string) => {
    refs.get(id)?.forEach((next) => {
      if (!result.has(next)) {
        result.add(next);
        walk(next);
      }
    });
  };
  walk(tokenId);
  return result;
}

/** 从某令牌到组件别名的依赖链路径（取最短的若干条）。 */
export function dependencyChains(model: LayerModel, tokenId: string, maxPaths = 4): string[][] {
  const refs = buildReverseRefs(model);
  const paths: string[][] = [];
  const walk = (current: string[], visited: Set<string>) => {
    if (paths.length >= maxPaths) return;
    const tail = current[current.length - 1];
    const nextSet = refs.get(tail);
    if (!nextSet || nextSet.size === 0) {
      paths.push([...current]);
      return;
    }
    let extended = false;
    nextSet.forEach((next) => {
      if (paths.length >= maxPaths) return;
      if (visited.has(next)) return;
      extended = true;
      walk([...current, next], new Set(visited).add(next));
    });
    if (!extended) paths.push([...current]);
  };
  walk([tokenId], new Set([tokenId]));
  return paths;
}

export interface ConflictEntry {
  tokenId: string;
  layerId: LayerId;
  /** 你开始编辑时读到的 revision。 */
  baseRevision: number;
  /** 你草稿里的值。 */
  incomingValue: string;
  incomingBy: string;
  /** 服务器/他人已落库的值与 revision。 */
  currentValue: string;
  currentRevision: number;
  currentBy: string;
  upstreamValue: string;
  note?: string;
}

export interface StaleOverrideRow {
  tokenId: string;
  layerId: LayerId;
  overrideValue: string;
  overrideBy: string;
  overrideAt: string;
  confirmedUpstreamResolved: string;
  upstreamValue: string;
}

const storageKey = 'yy63-layer-governance';

interface PersistedState {
  base: LayerModel['base'];
  overrides: LayerModel['overrides'];
  history: Record<string, HistoryEntry[]>;
  publishedAt: string;
}

function seedState(): PersistedState {
  return { base: structuredClone(SEED_BASE), overrides: buildSeedOverrides(), history: structuredClone(SEED_HISTORY), publishedAt: 'DS 4.5.2 · 2026-09-24 17:20' };
}

function loadState(): PersistedState {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedState;
      if (parsed.base && parsed.overrides) return parsed;
    }
  } catch {
    // 损坏的存档回退到种子。
  }
  return seedState();
}

export const useGovernanceStore = defineStore('layer-governance', {
  state: () => {
    const persisted = loadState();
    return {
      ...persisted,
      tokenMeta: TOKEN_META,
      layers: LAYERS,
      activeLayerId: 'brand' as LayerId,
      selectedTokenId: 'radius.control',
      search: '',
      category: '全部',
      // 当前操作者可切换，用来演示“另一位维护员先保存”。
      actor: '顾清 · Core DS',
      conflicts: [] as ConflictEntry[],
      resolvedConflictKeys: [] as string[],
      publishBlockedDialog: false
    };
  },
  getters: {
    model(state): LayerModel {
      return { base: state.base, overrides: state.overrides };
    },
    activeLayer(state) {
      return LAYER_BY_ID[state.activeLayerId];
    },
    selectedMeta(state): TokenMeta | undefined {
      return state.tokenMeta.find((meta) => meta.id === state.selectedTokenId);
    },
    filteredMeta(state): TokenMeta[] {
      const query = state.search.trim().toLowerCase();
      return state.tokenMeta.filter((meta) => {
        const matchSearch = !query || meta.id.toLowerCase().includes(query) || meta.name.toLowerCase().includes(query);
        const matchCategory = state.category === '全部' || meta.category === state.category;
        return matchSearch && matchCategory;
      });
    },
    /** 表格矩阵：每个令牌 × 每层的解析结果。 */
    matrix(state) {
      const model: LayerModel = { base: state.base, overrides: state.overrides };
      return state.tokenMeta.map((meta) => ({
        meta,
        cells: LAYERS.map((layer) => resolveCell(model, layer.id, meta.id))
      }));
    },
    staleOverrides(state): StaleOverrideRow[] {
      const model: LayerModel = { base: state.base, overrides: state.overrides };
      const rows: StaleOverrideRow[] = [];
      Object.entries(state.overrides).forEach(([tokenId, perLayer]) => {
        (Object.entries(perLayer) as [LayerId, Override][]).forEach(([layerId, override]) => {
          const upstream = upstreamResolution(model, layerId, tokenId);
          if (upstream && override.confirmedUpstreamResolved !== upstream.resolved) {
            rows.push({
              tokenId,
              layerId,
              overrideValue: override.value,
              overrideBy: override.updatedBy,
              overrideAt: override.updatedAt,
              confirmedUpstreamResolved: override.confirmedUpstreamResolved,
              upstreamValue: upstream.resolved
            });
          }
        });
      });
      return rows;
    },
    pendingConflicts(state): ConflictEntry[] {
      return state.conflicts.filter((conflict) => !state.resolvedConflictKeys.includes(conflictKey(conflict)));
    },
    /** 受影响组件（按令牌聚合，不做跨调用缓存，避免数据更新后过期）。 */
    impactFor(state) {
      return (tokenId: string) => {
        const model: LayerModel = { base: state.base, overrides: state.overrides };
        return buildImpact(model, tokenId);
      };
    }
  },
  actions: {
    setLayer(layerId: LayerId) {
      this.activeLayerId = layerId;
    },
    selectToken(tokenId: string) {
      this.selectedTokenId = tokenId;
    },
    setSearch(value: string) {
      this.search = value;
    },
    setCategory(value: string) {
      this.category = value;
    },
    setActor(actor: string) {
      this.actor = actor;
    },

    cellOf(layerId: LayerId, tokenId: string) {
      return resolveCell(this.model, layerId, tokenId);
    },
    chainOf(layerId: LayerId) {
      return ancestorChain(layerId);
    },
    historyOf(layerId: LayerId, tokenId: string): HistoryEntry[] {
      return this.history[historyKey(layerId, tokenId)] ?? [];
    },
    descendants(tokenId: string) {
      return descendantsOf(this.model, tokenId);
    },
    chains(tokenId: string) {
      return dependencyChains(this.model, tokenId);
    },
    components(tokenId: string) {
      return componentsUsingToken(tokenId, descendantsOf(this.model, tokenId));
    },

    /**
     * 保存一个单元格。
     * @param baseRevision 调用方编辑前读到的 revision；与当前 revision 不一致即并发冲突，
     *                     拒绝写入并挂起一条待仲裁冲突，绝不静默覆盖。
     */
    saveCell(input: { layerId: LayerId; tokenId: string; value: string; baseRevision: number; note?: string }): 'saved' | 'conflict' {
      const { layerId, tokenId, value, baseRevision } = input;
      const existing = this.readStored(layerId, tokenId);
      if (existing && existing.revision !== baseRevision) {
        const upstream = layerId === 'brand' ? null : upstreamResolution(this.model, layerId, tokenId);
        this.pushConflict({
          tokenId,
          layerId,
          baseRevision,
          incomingValue: value,
          incomingBy: this.actor,
          currentValue: existing.value,
          currentRevision: existing.revision,
          currentBy: existing.updatedBy,
          upstreamValue: upstream?.resolved ?? '—',
          note: input.note
        });
        return 'conflict';
      }

      this.writeStored(layerId, tokenId, value, existing?.revision ?? 0, input.note);
      this.persist();
      return 'saved';
    },

    /** 把某层覆盖恢复为继承（删除显式覆盖）。 */
    clearOverride(layerId: LayerId, tokenId: string) {
      const perLayer = this.overrides[tokenId];
      if (perLayer?.[layerId]) {
        delete perLayer[layerId];
        this.appendHistory(layerId, tokenId, '（恢复继承）', '移除平台覆盖，改回继承上级值');
        this.persist();
      }
    },

    /**
     * 再确认：品牌基础值变化后，平台维护者显式选择保留自己的覆盖，
     * 并把确认快照刷新为当前上游解析值；之后该覆盖不再阻塞发布。
     */
    keepOverride(layerId: LayerId, tokenId: string, note?: string) {
      const override = this.overrides[tokenId]?.[layerId];
      if (!override) return;
      const upstream = upstreamResolution(this.model, layerId, tokenId);
      override.confirmedUpstreamResolved = upstream?.resolved ?? '';
      override.revision += 1;
      override.updatedAt = nowStamp();
      override.updatedBy = this.actor;
      this.appendHistory(layerId, tokenId, override.value, note ?? `再确认保留平台覆盖（上游现为 ${override.confirmedUpstreamResolved}）`);
      this.persist();
    },

    /** 接受上游新值：覆盖值被替换为当前上游解析值，覆盖单元自然消失（转为继承）。 */
    adoptUpstream(layerId: LayerId, tokenId: string) {
      const upstream = upstreamResolution(this.model, layerId, tokenId);
      if (!upstream) return;
      this.appendHistory(layerId, tokenId, upstream.resolved, `放弃平台覆盖，跟随品牌基础值（原覆盖已存档）`);
      this.clearOverride(layerId, tokenId);
      this.persist();
    },

    /**
     * 模拟另一位维护员的客户端已把提交写进服务端：直接推进 revision，
     * 不经过当前编辑会话的 baseRevision 校验。真实系统里来自服务端推送/刷新。
     */
    remoteCommit(input: { layerId: LayerId; tokenId: string; value: string; by: string; note?: string }) {
      const actorBefore = this.actor;
      this.actor = input.by;
      const previous = this.readStored(input.layerId, input.tokenId)?.revision ?? 0;
      this.writeStored(input.layerId, input.tokenId, input.value, previous, input.note ?? '其他维护会话已保存');
      this.actor = actorBefore;
      this.persist();
    },

    /** 冲突仲裁：保留本层已落库值（后到者放弃自己的草稿）。 */
    resolveKeepCurrent(conflict: ConflictEntry) {
      this.markConflictResolved(conflict);
    },

    /** 冲突仲裁：用我的草稿覆盖，并把 revision 推进到当前版本之后。 */
    resolveKeepIncoming(conflict: ConflictEntry) {
      const existing = this.readStored(conflict.layerId, conflict.tokenId);
      this.writeStored(
        conflict.layerId,
        conflict.tokenId,
        conflict.incomingValue,
        existing?.revision ?? conflict.currentRevision,
        `并发保存仲裁：${conflict.incomingBy} 的草稿覆盖 ${conflict.currentBy} 的值`
      );
      this.markConflictResolved(conflict);
      this.persist();
    },

    /** 冲突仲裁：逐格合并在真实系统里需要三方合并，这里保留双方值到备注，供后续人工处理。 */
    resolveMerge(conflict: ConflictEntry) {
      const merged = `/* 合并待定 */ 当前:${conflict.currentValue} | 草稿:${conflict.incomingValue}`;
      const existing = this.readStored(conflict.layerId, conflict.tokenId);
      this.writeStored(
        conflict.layerId,
        conflict.tokenId,
        merged,
        existing?.revision ?? conflict.currentRevision,
        `并发保存仲裁：${conflict.incomingBy} 与 ${conflict.currentBy} 的值均保留，待人工合并`
      );
      this.markConflictResolved(conflict);
      this.persist();
    },

    /** 发布门禁：任何未再确认的过期覆盖都会拦下发布。 */
    canPublish(): boolean {
      return this.staleOverrides.length === 0 && this.pendingConflicts.length === 0;
    },
    publishBlockers(): { stale: StaleOverrideRow[]; conflicts: ConflictEntry[] } {
      return { stale: this.staleOverrides, conflicts: this.pendingConflicts };
    },

    publish(version: string): boolean {
      if (!this.canPublish()) return false;
      this.publishedAt = `DS ${version} · ${nowStamp()}`;
      this.persist();
      return true;
    },

    resetDemo() {
      const seeded = seedState();
      this.base = seeded.base;
      this.overrides = seeded.overrides;
      this.history = seeded.history;
      this.publishedAt = seeded.publishedAt;
      this.conflicts = [];
      this.resolvedConflictKeys = [];
      this.persist();
    },

    // ── 内部工具 ──────────────────────────────────────────────────────────────
    readStored(layerId: LayerId, tokenId: string) {
      if (layerId === 'brand') return this.base[tokenId];
      return this.overrides[tokenId]?.[layerId];
    },
    writeStored(layerId: LayerId, tokenId: string, value: string, previousRevision: number, note?: string) {
      const stamp = nowStamp();
      if (layerId === 'brand') {
        const previous = this.base[tokenId];
        this.base[tokenId] = { value, revision: previousRevision + 1, updatedAt: stamp, updatedBy: this.actor };
        this.appendHistory('brand', tokenId, value, note);
        return;
      }
      // 平台层：写入覆盖并记录确认快照（编辑时看到的上游解析值）。
      const upstream = upstreamResolution(this.model, layerId, tokenId);
      const previous = this.overrides[tokenId]?.[layerId];
      if (!this.overrides[tokenId]) this.overrides[tokenId] = {};
      this.overrides[tokenId]![layerId] = {
        value,
        revision: previousRevision + 1,
        updatedAt: stamp,
        updatedBy: this.actor,
        confirmedUpstreamResolved: upstream?.resolved ?? ''
      };
      this.appendHistory(layerId, tokenId, value, note ?? '平台层显式覆盖');
    },
    appendHistory(layerId: LayerId, tokenId: string, value: string, note?: string) {
      const key = historyKey(layerId, tokenId);
      const list = this.history[key] ?? [];
      list.unshift({ at: nowStamp(), by: this.actor, value, note });
      this.history[key] = list.slice(0, 12);
    },
    pushConflict(conflict: ConflictEntry) {
      const key = conflictKey(conflict);
      this.conflicts = this.conflicts.filter((item) => conflictKey(item) !== key);
      this.conflicts.unshift(conflict);
      this.resolvedConflictKeys = this.resolvedConflictKeys.filter((item) => item !== key);
    },
    markConflictResolved(conflict: ConflictEntry) {
      const key = conflictKey(conflict);
      if (!this.resolvedConflictKeys.includes(key)) this.resolvedConflictKeys.push(key);
    },
    persist() {
      const payload: PersistedState = { base: this.base, overrides: this.overrides, history: this.history, publishedAt: this.publishedAt };
      localStorage.setItem(storageKey, JSON.stringify(payload));
    }
  }
});

function conflictKey(conflict: ConflictEntry): string {
  return `${conflict.layerId}::${conflict.tokenId}::${conflict.baseRevision}::${conflict.currentRevision}`;
}

function buildImpact(model: LayerModel, tokenId: string) {
  const descendants = descendantsOf(model, tokenId);
  return {
    descendants: [...descendants],
    chains: dependencyChains(model, tokenId),
    components: componentsUsingToken(tokenId, descendants)
  };
}

function nowStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 让模板可以直接调用 materialize 做组件预览。
export function previewColor(model: LayerModel, layerId: LayerId, tokenId: string): string {
  return materialize(model, layerId, tokenId);
}
