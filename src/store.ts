import { defineStore } from 'pinia';
import { MessagePlugin } from 'tdesign-vue-next';
import {
  buildSeedTree,
  initServer,
  currentHashes,
  saveLayer,
  simulatePeerSave,
  findStalePins,
  resolveValue,
  rawEntry,
  parseRef,
  downstreamIds,
  closureSnapshot,
  hashEntries,
  entriesOf,
  setEntries,
  diffEntries,
  scopeKey,
  THEMES,
  PLATFORMS,
  TOKEN_META_BY_ID,
  type LayerTree,
  type LayerId,
  type ThemeId,
  type PlatformId,
  type LayerEntry,
  type SaveConflict
} from './layers';

export type TokenCategory = 'color' | 'font' | 'spacing' | 'radius' | 'shadow' | 'component';
export type Token = {
  id: string;
  name: string;
  category: TokenCategory;
  value: string;
  ref?: string;
  themes: Record<string, string>;
  usage: number;
  status: 'stable' | 'deprecated' | 'proposed';
  description: string;
};

export type ChangeRequest = {
  id: string;
  title: string;
  requester: string;
  scope: string;
  impact: number;
  status: '待评审' | '已接受' | '已退回';
  diff: { token: string; before: string; after: string };
};

const changes: ChangeRequest[] = [
  { id: 'CR-412', title: '运营产品切换语义主色', requester: '运营设计组', scope: '4 个产品 · 238 处引用', impact: 86, status: '待评审', diff: { token: 'color.semantic.primary', before: '{color.base.blue.600}', after: '{color.base.green.600}' } },
  { id: 'CR-418', title: '高对比度正文尺寸调整', requester: '无障碍专项组', scope: '2 个产品 · 74 处引用', impact: 42, status: '待评审', diff: { token: 'font.size.body', before: '14px', after: '16px' } },
  { id: 'CR-423', title: '统一浮层圆角', requester: '组件维护组', scope: '12 个组件 · 36 处引用', impact: 28, status: '待评审', diff: { token: 'radius.control', before: '8px', after: '6px' } }
];

const storageKey = 'yy63-token-governance';
const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(storageKey) : null;
const saved = raw ? JSON.parse(raw) : null;

const seedTree = buildSeedTree();
// 服务端初始与客户端一致
initServer(seedTree);

function cloneTree(tree: LayerTree): LayerTree {
  const cloneEntries = (es: Record<string, LayerEntry>) =>
    Object.fromEntries(Object.entries(es).map(([id, e]) => [id, { ...e, inheritedAtConfirm: e.inheritedAtConfirm ? { ...e.inheritedAtConfirm } : undefined }]));
  return {
    brand: { entries: cloneEntries(tree.brand.entries) },
    theme: Object.fromEntries(THEMES.map((t) => [t.id, { entries: cloneEntries(tree.theme[t.id].entries) }])) as LayerTree['theme'],
    platform: Object.fromEntries(PLATFORMS.map((p) => [p.id, { entries: cloneEntries(tree.platform[p.id].entries) }])) as LayerTree['platform']
  };
}

function now() {
  return new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export type EnrichedStalePin = {
  platform: PlatformId;
  platformLabel: string;
  tokenId: string;
  tokenName: string;
  pinValue: string;
  affectedThemes: ThemeId[];
  affectedThemeLabels: string[];
  changedUpstream: { id: string; name: string; before: string; after: string }[];
  components: { id: string; name: string; usage: number }[];
  chain: { id: string; name: string; layer: string; tone: 'brand' | 'theme' | 'platform' | 'component' }[];
};

export const useTokenStore = defineStore('tokens', {
  state: () => ({
    tree: (saved?.tree as LayerTree) ?? cloneTree(seedTree),
    savedTree: (saved?.savedTree as LayerTree) ?? cloneTree(seedTree),
    hashes: (saved?.hashes as Record<string, string>) ?? ({} as Record<string, string>),
    changes: (saved?.changes as ChangeRequest[]) ?? changes,
    activeTheme: (saved?.activeTheme as ThemeId) ?? 'light',
    activePlatform: (saved?.activePlatform as PlatformId) ?? 'ops',
    selectedTokenId: (saved?.selectedTokenId as string) ?? 'color.semantic.primary',
    search: (saved?.search as string) ?? '',
    category: (saved?.category as string) ?? '全部',
    releaseVersion: '4.6.0-rc.2',
    locked: (saved?.locked as boolean) ?? false,
    lastPublished: (saved?.lastPublished as string) ?? 'DS 4.5.2',
    conflict: null as SaveConflict | null,
    peerSimulated: false
  }),
  getters: {
    /** 按当前平台/主题解析出的令牌视图（继承 + 覆盖后的最终值） */
    tokens(state): Token[] {
      return Object.values(TOKEN_META_BY_ID).map((meta) => {
        const raw = rawEntry(state.tree, state.activePlatform, state.activeTheme, meta.id);
        const themes: Record<string, string> = {};
        for (const t of THEMES) {
          themes[t.id] = resolveValue(state.tree, state.activePlatform, t.id, meta.id);
        }
        return {
          id: meta.id,
          name: meta.name,
          category: meta.category,
          value: resolveValue(state.tree, state.activePlatform, state.activeTheme, meta.id),
          ref: parseRef(raw.value) ?? undefined,
          themes,
          usage: meta.usage,
          status: meta.status,
          description: meta.description
        };
      });
    },
    selectedToken(state): Token | undefined {
      const found = this.tokens.find((token) => token.id === state.selectedTokenId);
      return found ?? this.tokens[0];
    },
    filteredTokens(state): Token[] {
      const query = state.search.toLowerCase();
      return this.tokens.filter((token) => {
        const matchesSearch = !query || token.id.toLowerCase().includes(query) || token.name.includes(state.search);
        const matchesCategory = state.category === '全部' || token.category === state.category;
        return matchesSearch && matchesCategory;
      });
    },
    dependencyEdges(state): { from: string; to: string }[] {
      return this.tokens.filter((token) => token.ref).map((token) => ({ from: token.ref!, to: token.id }));
    },
    cycleNodes(state): string[] {
      const graph = new Map<string, string>();
      this.tokens.filter((token) => token.ref).forEach((token) => graph.set(token.id, token.ref!));
      const cycle = new Set<string>();
      graph.forEach((_, start) => {
        const path: string[] = [];
        let current: string | undefined = start;
        while (current && !path.includes(current)) {
          path.push(current);
          current = graph.get(current);
        }
        if (current && path.includes(current)) path.slice(path.indexOf(current)).forEach((id) => cycle.add(id));
      });
      return [...cycle];
    },
    invalidReferences(state): Token[] {
      const ids = new Set(this.tokens.map((token) => token.id));
      return this.tokens.filter((token) => token.ref && !ids.has(token.ref));
    },
    contrastIssues(state): { title: string; detail: string }[] {
      const text = this.tokens.find((token) => token.id === 'color.text.primary');
      const surface = this.tokens.find((token) => token.id === 'color.surface.canvas');
      const values = [text?.themes[state.activeTheme], surface?.themes[state.activeTheme]].filter(Boolean) as string[];
      if (values.length < 2) return [];
      const ratio = contrastRatio(values[0], values[1]);
      return ratio < 4.5 ? [{ title: '正文与页面背景对比度不足', detail: `当前 ${ratio.toFixed(2)}:1，要求至少 4.5:1。` }] : [];
    },
    diffRows(state): { id: string; before: string; after: string; name: string }[] {
      return Object.values(TOKEN_META_BY_ID).filter((meta) => {
        const base = seedTree.brand.entries[meta.id]?.value ?? '';
        const now = resolveValue(state.tree, state.activePlatform, state.activeTheme, meta.id);
        return !base || base !== now;
      }).map((meta) => ({
        id: meta.id,
        before: seedTree.brand.entries[meta.id]?.value ?? '新增',
        after: resolveValue(state.tree, state.activePlatform, state.activeTheme, meta.id),
        name: meta.name
      }));
    },
    /** 待重新确认的平台固定值覆盖（发布门禁） */
    stalePins(state): EnrichedStalePin[] {
      return findStalePins(state.tree).map((stale) => {
        const meta = TOKEN_META_BY_ID[stale.tokenId];
        const platformLabel = PLATFORMS.find((p) => p.id === stale.platform)!.label;
        const changedUpstream = stale.changedUpstream.map((c) => ({
          ...c,
          name: TOKEN_META_BY_ID[c.id]?.name ?? c.id
        }));
        const componentIds = downstreamIds(state.tree, stale.platform, state.activeTheme, stale.tokenId).filter(
          (id) => TOKEN_META_BY_ID[id]?.category === 'component'
        );
        const components = componentIds.map((id) => ({ id, name: TOKEN_META_BY_ID[id].name, usage: TOKEN_META_BY_ID[id].usage }));
        // 依赖链：品牌基础值 → 主题映射 → 平台固定 → 组件别名
        const chain: EnrichedStalePin['chain'] = [];
        for (const c of stale.changedUpstream) {
          chain.push({ id: c.id, name: TOKEN_META_BY_ID[c.id]?.name ?? c.id, layer: '品牌基础层', tone: 'brand' });
        }
        chain.push({ id: stale.tokenId, name: meta.name, layer: `主题层 · ${THEMES.find((t) => t.id === state.activeTheme)!.label}（继承引用）`, tone: 'theme' });
        chain.push({ id: stale.tokenId, name: meta.name, layer: `平台层 · ${platformLabel}（固定值覆盖）`, tone: 'platform' });
        for (const c of componentIds) {
          chain.push({ id: c, name: TOKEN_META_BY_ID[c].name, layer: '组件别名', tone: 'component' });
        }
        return {
          platform: stale.platform,
          platformLabel,
          tokenId: stale.tokenId,
          tokenName: meta.name,
          pinValue: stale.pinValue,
          affectedThemes: stale.affectedThemes,
          affectedThemeLabels: stale.affectedThemes.map((t) => THEMES.find((th) => th.id === t)!.label),
          changedUpstream,
          components,
          chain
        };
      });
    },
    publishBlocked(): boolean {
      return this.stalePins.length > 0 || this.cycleNodes.length > 0 || this.invalidReferences.length > 0 || this.contrastIssues.length > 0 || this.changes.some((c) => c.status === '待评审');
    },
    dirtyScopes(state): string[] {
      const scopes: { key: string; layer: LayerId; scope: string }[] = [
        { key: scopeKey('brand', 'brand'), layer: 'brand', scope: 'brand' },
        ...THEMES.map((t) => ({ key: scopeKey('theme', t.id), layer: 'theme' as LayerId, scope: t.id })),
        ...PLATFORMS.map((p) => ({ key: scopeKey('platform', p.id), layer: 'platform' as LayerId, scope: p.id }))
      ];
      return scopes
        .filter((s) => Object.keys(diffEntries(entriesOf(state.savedTree, s.layer, s.scope), entriesOf(state.tree, s.layer, s.scope))).length > 0)
        .map((s) => s.key);
    },
    releaseReadiness(): number {
      const base = 100 - this.cycleNodes.length * 25 - this.invalidReferences.length * 20 - this.contrastIssues.length * 15 - this.stalePins.length * 10;
      return Math.max(0, base);
    }
  },
  actions: {
    selectToken(id: string) {
      this.selectedTokenId = id;
      this.persist();
    },
    setTheme(theme: ThemeId) {
      this.activeTheme = theme;
      this.persist();
    },
    setPlatform(platform: PlatformId) {
      this.activePlatform = platform;
      this.persist();
    },
    setSearch(value: string) { this.search = value; this.persist(); },
    setCategory(value: string) { this.category = value; this.persist(); },

    /** 工作区编辑：基础令牌改品牌层，别名/主题值改主题层 */
    updateTokenValue(id: string, value: string) {
      if (seedTree.brand.entries[id]) this.editEntry('brand', 'brand', id, value);
      else this.editEntry('theme', this.activeTheme, id, value);
    },
    addToken(token: Token) {
      if (!this.tokens.some((item) => item.id === token.id)) {
        this.editEntry('brand', 'brand', token.id, token.value);
      }
      this.persist();
    },

    /** 通用条目编辑：layer/scope 定位，value 为 null 表示恢复继承 */
    editEntry(layer: LayerId, scope: string, id: string, value: string | null) {
      const entries = entriesOf(this.tree, layer, scope);
      const next: LayerEntry = { ...entries[id] };
      if (value === null) {
        next.value = null;
      } else {
        next.value = value;
        // 新建固定值覆盖时，记录当前上游闭包作为确认基线
        if (layer === 'platform' && !parseRef(value)) {
          next.inheritedAtConfirm = {};
          for (const t of THEMES) {
            next.inheritedAtConfirm[t.id] = closureSnapshot(this.tree, scope as PlatformId, t.id, id, { inherited: true });
          }
          next.confirmedBy = '顾清 · Core DS';
          next.confirmedAt = now();
        }
      }
      const clone = { ...entries, [id]: next };
      if (value === null) clone[id].value = null;
      setEntries(this.tree, layer, scope, clone);
      this.persist();
    },

    async refreshHashes() {
      this.hashes = await currentHashes();
    },

    /** 保存某一层：携带基线哈希，后到者遇 409 进入冲突合并 */
    async saveScope(layer: LayerId, scope: string) {
      const key = scopeKey(layer, scope);
      const baseEntries = entriesOf(this.savedTree, layer, scope);
      const nextEntries = entriesOf(this.tree, layer, scope);
      const changes = diffEntries(baseEntries, nextEntries);
      if (!Object.keys(changes).length) {
        MessagePlugin.warning('当前层没有未保存的修改');
        return;
      }
      const baseHash = this.hashes[key] ?? hashEntries(baseEntries);
      const result = await saveLayer({ layer, scope, baseHash, changes, actor: '顾清 · Core DS' });
      if (result.ok) {
        setEntries(this.savedTree, layer, scope, JSON.parse(JSON.stringify(nextEntries)));
        this.hashes[key] = result.hash;
        MessagePlugin.success(`${layer === 'brand' ? '品牌基础层' : layer === 'theme' ? '主题层' : '平台层'} 已保存（${result.hash}）`);
        this.persist();
      } else {
        this.conflict = result.conflict;
      }
    },

    /** 冲突合并：按令牌选择保留版本，合并后重新保存 */
    async applyConflict(choices: Record<string, 'mine' | 'theirs'>) {
      const conflict = this.conflict;
      if (!conflict) return;
      const { layer, scope } = conflict;
      const base = entriesOf(this.savedTree, layer, scope);
      const draft = entriesOf(this.tree, layer, scope);
      const merged: Record<string, LayerEntry> = JSON.parse(JSON.stringify(conflict.theirs));
      for (const item of conflict.items) {
        if (choices[item.tokenId] === 'mine' && draft[item.tokenId]) {
          merged[item.tokenId] = JSON.parse(JSON.stringify(draft[item.tokenId]));
        }
      }
      // 先到者未触碰、仅我方修改的条目，随合并一起保留
      for (const [id, entry] of Object.entries(draft)) {
        const changedByMe = JSON.stringify(entry.value ?? null) !== JSON.stringify(base[id]?.value ?? null);
        const untouchedByPeer = JSON.stringify(conflict.theirs[id]?.value ?? null) === JSON.stringify(base[id]?.value ?? null);
        if (changedByMe && untouchedByPeer) merged[id] = JSON.parse(JSON.stringify(entry));
      }
      setEntries(this.tree, layer, scope, merged);
      this.conflict = null;
      const changes = diffEntries(base, merged);
      const result = await saveLayer({ layer, scope, baseHash: conflict.currentHash, changes, actor: '顾清 · Core DS' });
      if (result.ok) {
        setEntries(this.savedTree, layer, scope, JSON.parse(JSON.stringify(merged)));
        this.hashes[scopeKey(layer, scope)] = result.hash;
        MessagePlugin.success('冲突已逐令牌确认，合并版本已保存');
        this.persist();
      } else {
        this.conflict = result.conflict;
      }
    },

    /** 放弃我方草稿，接受先到者版本 */
    acceptTheirs() {
      const conflict = this.conflict;
      if (!conflict) return;
      setEntries(this.tree, conflict.layer, conflict.scope, JSON.parse(JSON.stringify(conflict.theirs)));
      setEntries(this.savedTree, conflict.layer, conflict.scope, JSON.parse(JSON.stringify(conflict.theirs)));
      this.hashes[scopeKey(conflict.layer, conflict.scope)] = conflict.currentHash;
      this.conflict = null;
      MessagePlugin.info('已采用先到者（周序）的保存版本');
      this.persist();
    },

    async simulatePeer() {
      await simulatePeerSave('brand', 'brand');
      this.peerSimulated = true;
      await this.refreshHashes();
      MessagePlugin.warning('周序（运营设计组）刚保存了品牌基础层：3 处变更已上线');
    },

    /** 平台固定值重新确认：以当前上游闭包为新基线 */
    reconfirmPin(platform: PlatformId, tokenId: string) {
      const entries = this.tree.platform[platform].entries;
      const entry = entries[tokenId];
      if (!entry) return;
      const next: LayerEntry = { ...entry, inheritedAtConfirm: {}, confirmedBy: '顾清 · Core DS', confirmedAt: now() };      for (const t of THEMES) {
        next.inheritedAtConfirm![t.id] = closureSnapshot(this.tree, platform, t.id, tokenId, { inherited: true });
      }
      entries[tokenId] = next;
      MessagePlugin.success(`已重新确认 ${TOKEN_META_BY_ID[tokenId].name} 的平台固定值`);
      this.persist();
    },

    /** 撤销平台覆盖，恢复继承上游值 */
    revertPin(platform: PlatformId, tokenId: string) {
      const entries = { ...this.tree.platform[platform].entries };
      delete entries[tokenId];
      this.tree.platform[platform] = { entries };
      MessagePlugin.info(`已撤销 ${TOKEN_META_BY_ID[tokenId].name} 的平台覆盖，恢复继承`);
      this.persist();
    },

    acceptChange(id: string) {
      const change = this.changes.find((item) => item.id === id);
      if (!change) return;
      const token = this.tokens.find((item) => item.id === change.diff.token);
      if (token) this.updateTokenValue(token.id, change.diff.after);
      change.status = '已接受';
      this.persist();
    },
    rejectChange(id: string) {
      const change = this.changes.find((item) => item.id === id);
      if (change) change.status = '已退回';
      this.persist();
    },
    rollback() {
      this.tree = cloneTree(this.savedTree);
      MessagePlugin.info('已回滚未发布的编辑');
      this.persist();
    },
    /** 发布：存在未确认的覆盖固定值时门禁拦截（返回 false） */
    publish(): boolean {
      if (this.publishBlocked) {
        MessagePlugin.error(`发布已暂停：仍有 ${this.stalePins.length} 个平台覆盖等待重新确认`);
        return false;
      }
      this.locked = true;
      this.lastPublished = `DS ${this.releaseVersion}`;
      this.persist();
      return true;
    },
    persist() {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            tree: this.tree,
            savedTree: this.savedTree,
            hashes: this.hashes,
            changes: this.changes,
            activeTheme: this.activeTheme,
            activePlatform: this.activePlatform,
            selectedTokenId: this.selectedTokenId,
            search: this.search,
            category: this.category,
            locked: this.locked,
            lastPublished: this.lastPublished
          })
        );
      }
    }
  }
});

function contrastRatio(a: string, b: string) {
  const luminance = (hex: string) => {
    const clean = hex.replace('#', '');
    if (clean.length !== 6) return 0.5;
    const channels = [0, 2, 4].map((index) => parseInt(clean.slice(index, index + 2), 16) / 255).map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
