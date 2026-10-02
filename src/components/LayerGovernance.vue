<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { MessagePlugin } from 'tdesign-vue-next';
import { useGovernanceStore } from '../governance';
import { LAYERS, LAYER_BY_ID, type LayerId } from '../layers';
import ConflictCenter from './ConflictCenter.vue';
import PublishGate from './PublishGate.vue';

const store = useGovernanceStore();

const ACTORS = ['顾清 · Core DS', '林澜 · iOS 平台组', '周序 · Android 平台组'];
const editing = reactive<{ layerId: LayerId | null; tokenId: string | null; value: string; baseRevision: number }>({
  layerId: null,
  tokenId: null,
  value: '',
  baseRevision: 0
});

const conflictVisible = ref(false);
const gateVisible = ref(false);
const remoteTokenId = ref('');
const remoteLayerId = ref<LayerId>('brand');
const remoteValue = ref('');
const categories = computed(() => ['全部', ...new Set(store.tokenMeta.map((meta) => meta.category))]);
const selectedMeta = computed(() => store.selectedMeta);
const selectedCell = computed(() =>
  selectedMeta.value ? store.cellOf(store.activeLayerId, selectedMeta.value.id) : null
);

const staleTokenIds = computed(() => new Set(store.staleOverrides.map((row) => row.tokenId)));
const conflictTokenIds = computed(() => new Set(store.pendingConflicts.map((row) => row.tokenId)));

const impact = computed(() => (selectedMeta.value ? store.impactFor(selectedMeta.value.id) : null));
const selectedHistory = computed(() =>
  selectedMeta.value ? store.historyOf(store.activeLayerId, selectedMeta.value.id) : []
);

const layerChain = computed(() => store.chainOf(store.activeLayerId));

function beginEdit(layerId: LayerId, tokenId: string) {
  const cell = store.cellOf(layerId, tokenId);
  editing.layerId = layerId;
  editing.tokenId = tokenId;
  editing.value = cell.raw;
  // 记录编辑开始时读到的 revision —— 保存时据此发现并发写入。
  editing.baseRevision = cell.sourceLayerId === layerId ? cell.revision : 0;
}

function cancelEdit() {
  editing.layerId = null;
  editing.tokenId = null;
}

function isEditing(layerId: LayerId, tokenId: string) {
  return editing.layerId === layerId && editing.tokenId === tokenId;
}

function saveEdit() {
  if (!editing.layerId || !editing.tokenId) return;
  const result = store.saveCell({
    layerId: editing.layerId,
    tokenId: editing.tokenId,
    value: editing.value.trim(),
    baseRevision: editing.baseRevision,
    note: '工作区手工保存'
  });
  if (result === 'conflict') {
    conflictVisible.value = true;
    MessagePlugin.warning('检测到并发修改，保存已暂停，请先仲裁冲突');
  } else {
    MessagePlugin.success('已保存，下级未覆盖值已按继承链重算');
  }
  cancelEdit();
}

function clearOverride(layerId: LayerId, tokenId: string) {
  store.clearOverride(layerId, tokenId);
  if (isEditing(layerId, tokenId)) cancelEdit();
  MessagePlugin.info('已移除平台覆盖，该格恢复继承上级');
}

function reconfirm(layerId: LayerId, tokenId: string) {
  store.keepOverride(layerId, tokenId);
  MessagePlugin.success('已再确认：平台覆盖保留，确认快照刷新为当前品牌值');
}

function adopt(layerId: LayerId, tokenId: string) {
  store.adoptUpstream(layerId, tokenId);
  MessagePlugin.info('平台覆盖已跟随品牌基础值');
}

// ── 并发场景模拟：另一位维护员在你编辑期间先保存 ─────────────────────────────
watch([remoteTokenId, remoteLayerId], () => {
  remoteValue.value = suggestRemoteValue();
}, { immediate: true });

function suggestRemoteValue(): string {
  const cell = store.cellOf(remoteLayerId.value, remoteTokenId.value || store.selectedTokenId);
  const raw = cell.raw;
  if (/^#?[0-9a-fA-F]{6}$/.test(raw)) return '#3d6fb4';
  const num = raw.match(/^(\d+(?:\.\d+)?)(px|dp|sp|em|rem)?$/);
  if (num) return `${Number(num[1]) + (num[1].includes('.') ? 1 : 2)}${num[2] ?? 'px'}`;
  if (raw.startsWith('{') && raw.endsWith('}')) return '{color.base.blue.800}';
  return raw;
}

function simulateRemote() {
  const tokenId = remoteTokenId.value || store.selectedTokenId;
  const by = remoteLayerId.value === 'brand' ? '周序 · Android 平台组' : ACTORS.find((name) => name !== store.actor) ?? '周序 · Android 平台组';
  store.remoteCommit({
    layerId: remoteLayerId.value,
    tokenId,
    value: remoteValue.value,
    by,
    note: '模拟：你的编辑会话期间另一维护员先提交'
  });
  // 如果当前正好在编辑同一格，制造 revision 错配，下一次保存即弹冲突。
  if (editing.layerId === remoteLayerId.value && editing.tokenId === tokenId) {
    MessagePlugin.warning('对方已先保存同格值，你的 revision 已过期');
  } else {
    MessagePlugin.success(`已模拟 ${by} 的提交（revision 已前进）`);
  }
}

function swatch(layerId: LayerId, tokenId: string) {
  return store.cellOf(layerId, tokenId).resolved;
}

function isColorToken(tokenId: string) {
  return tokenId.startsWith('color.') || store.cellOf('brand', tokenId).resolved.startsWith('#');
}

function sourceLabel(layerId: LayerId) {
  return LAYER_BY_ID[layerId].short;
}

function tokenName(id: string) {
  return store.tokenMeta.find((meta) => meta.id === id)?.name ?? id;
}

function openGate() {
  gateVisible.value = true;
}
</script>

<template>
  <div class="lg-page">
    <!-- 继承链总览 -->
    <section class="panel chain-bar">
      <div class="chain-flow">
        <template v-for="(layer, index) in store.layers" :key="layer.id">
          <button
            class="chain-node"
            :class="{ active: store.activeLayerId === layer.id, brand: layer.kind === 'brand' }"
            @click="store.setLayer(layer.id)"
          >
            <strong>{{ layer.name }}</strong>
            <span>{{ layer.platform }}</span>
            <em v-if="layer.kind === 'platform'">继承自 品牌基础层</em>
          </button>
          <t-icon v-if="index < store.layers.length - 1" name="chevron-right" class="chain-arrow" />
        </template>
      </div>
      <div class="chain-status">
        <t-tag :theme="staleTokenIds.size ? 'danger' : 'success'" variant="light">
          待再确认覆盖 {{ store.staleOverrides.length }}
        </t-tag>
        <t-tag :theme="store.pendingConflicts.length ? 'warning' : 'success'" variant="light">
          待仲裁冲突 {{ store.pendingConflicts.length }}
        </t-tag>
        <t-button size="small" variant="outline" @click="conflictVisible = true">冲突中心</t-button>
        <t-button size="small" theme="primary" @click="openGate">发布主题</t-button>
      </div>
    </section>

    <div class="lg-grid">
      <!-- 令牌树 -->
      <aside class="panel lg-tree">
        <div class="panel-head">
          <div><strong>令牌树</strong><span>{{ store.filteredMeta.length }} 个匹配项</span></div>
        </div>
        <t-input
          :model-value="store.search"
          placeholder="搜索令牌 ID 或名称"
          @update:model-value="store.setSearch"
        />
        <div class="lg-categories">
          <button
            v-for="cat in categories"
            :key="cat"
            :class="{ active: store.category === cat }"
            @click="store.setCategory(cat)"
          >{{ cat }}</button>
        </div>
        <div class="lg-tree-list">
          <button
            v-for="meta in store.filteredMeta"
            :key="meta.id"
            :class="{ active: store.selectedTokenId === meta.id }"
            @click="store.selectToken(meta.id)"
          >
            <i :class="meta.category" />
            <div class="lg-tree-text">
              <strong>{{ meta.name }}</strong>
              <span>{{ meta.id }}</span>
              <div class="lg-tree-flags">
                <em v-if="staleTokenIds.has(meta.id)" class="flag stale">待再确认</em>
                <em v-if="conflictTokenIds.has(meta.id)" class="flag conflict">冲突</em>
              </div>
            </div>
          </button>
        </div>
        <div class="actor-switch">
          <span>当前操作者</span>
          <t-select :model-value="store.actor" size="small" @update:model-value="store.setActor">
            <t-option v-for="actor in ACTORS" :key="actor" :value="actor" :label="actor" />
          </t-select>
        </div>
      </aside>

      <!-- 继承矩阵 -->
      <section class="panel lg-matrix">
        <div class="panel-head">
          <div>
            <strong>{{ selectedMeta?.name }} · 全链解析</strong>
            <span>在某层改令牌后，下级只重算没有显式覆盖的值；覆盖格标记“覆”</span>
          </div>
          <t-tag v-if="selectedCell?.stale" theme="danger" variant="light">本格覆盖待再确认</t-tag>
        </div>

        <div class="matrix-table">
          <div class="matrix-row matrix-head-row">
            <div class="matrix-layer-name">层级 / 令牌</div>
            <div class="matrix-cells">
              <span v-for="layer in store.layers" :key="layer.id" :class="{ active: layer.id === store.activeLayerId }">
                {{ layer.short }}
                <small v-if="layer.kind === 'platform'">覆 {{ Object.values(store.overrides).filter(p => p[layer.id]).length }}</small>
              </span>
            </div>
          </div>

          <div v-for="row in store.matrix.filter(r => store.filteredMeta.some(m => m.id === r.meta.id))" :key="row.meta.id" class="matrix-row" :class="{ selected: row.meta.id === store.selectedTokenId }" @click="store.selectToken(row.meta.id)">
            <div class="matrix-layer-name">
              <i :class="row.meta.category" />
              <div><strong>{{ row.meta.name }}</strong><code>{{ row.meta.id }}</code></div>
            </div>
            <div class="matrix-cells">
              <div
                v-for="(cell, idx) in row.cells"
                :key="store.layers[idx].id"
                class="cell"
                :class="{
                  overridden: cell.overridden,
                  stale: cell.stale,
                  selected: store.layers[idx].id === store.activeLayerId && row.meta.id === store.selectedTokenId,
                  editing: isEditing(store.layers[idx].id, row.meta.id)
                }"
                @click.stop
              >
                <template v-if="!isEditing(store.layers[idx].id, row.meta.id)">
                  <div class="cell-line">
                    <i v-if="isColorToken(row.meta.id)" class="color-dot" :style="{ background: cell.resolved }" />
                    <code :title="cell.raw">{{ cell.resolved }}</code>
                  </div>
                  <div class="cell-meta">
                    <span v-if="cell.overridden" class="badge override">覆</span>
                    <span v-else class="badge inherit">↳{{ sourceLabel(cell.sourceLayerId) }}</span>
                    <span v-if="cell.stale" class="badge stale-badge">待再确认</span>
                  </div>
                  <div class="cell-actions">
                    <t-button size="small" variant="text" @click="beginEdit(store.layers[idx].id, row.meta.id)">
                      {{ cell.overridden ? '改覆盖' : store.layers[idx].kind === 'platform' ? '加覆盖' : '编辑' }}
                    </t-button>
                    <t-button v-if="cell.overridden && !cell.stale" size="small" variant="text" @click="clearOverride(store.layers[idx].id, row.meta.id)">恢复继承</t-button>
                    <template v-if="cell.stale">
                      <t-button size="small" variant="text" @click="adopt(store.layers[idx].id, row.meta.id)">跟随品牌</t-button>
                      <t-button size="small" theme="primary" variant="text" @click="reconfirm(store.layers[idx].id, row.meta.id)">再确认</t-button>
                    </template>
                  </div>
                </template>
                <template v-else>
                  <t-input v-model="editing.value" size="small" autofocus @enter="saveEdit" />
                  <div class="edit-actions">
                    <t-button size="small" variant="text" @click="cancelEdit">取消</t-button>
                    <t-button size="small" theme="primary" @click="saveEdit">保存</t-button>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </div>

        <!-- 当前选中令牌的详情与继承轨迹 -->
        <div v-if="selectedMeta" class="selected-detail">
          <div class="detail-chain">
            <h5>{{ store.activeLayer.name }} 的继承轨迹</h5>
            <div class="trace">
              <template v-for="layer in layerChain" :key="layer.id">
                <div class="trace-node" :class="{ source: store.cellOf(layer.id, selectedMeta.id).sourceLayerId === layer.id && layer.id === selectedCell?.sourceLayerId }">
                  <strong>{{ layer.short }}</strong>
                  <code>{{ store.cellOf(layer.id, selectedMeta.id).raw || '—' }}</code>
                  <small>rev {{ store.cellOf(layer.id, selectedMeta.id).sourceLayerId === layer.id ? store.cellOf(layer.id, selectedMeta.id).revision : '继承' }}</small>
                </div>
                <t-icon v-if="layer !== layerChain[layerChain.length - 1]" name="chevron-right" />
              </template>
            </div>
            <p class="muted">
              本层解析值 <strong>{{ selectedCell?.resolved }}</strong>
              <template v-if="selectedCell?.overridden">（显式覆盖，品牌侧改值不会动它，但会要求再确认）</template>
              <template v-else>（继承自 {{ sourceLabel(selectedCell?.sourceLayerId ?? 'brand') }}，上级一改即时重算）</template>
            </p>
          </div>

          <!-- 并发模拟 -->
          <div class="sim-panel">
            <h5>并发保存演练</h5>
            <p class="muted">模拟你打开编辑后，另一位维护员先提交同一单元格。</p>
            <div class="sim-form">
              <t-select v-model="remoteLayerId" size="small" style="width: 150px">
                <t-option v-for="layer in LAYERS" :key="layer.id" :value="layer.id" :label="layer.short" />
              </t-select>
              <t-select v-model="remoteTokenId" size="small" style="width: 240px" :placeholder="'令牌（默认当前选中）'">
                <t-option v-for="meta in store.tokenMeta" :key="meta.id" :value="meta.id" :label="meta.name" />
              </t-select>
              <t-input v-model="remoteValue" size="small" style="width: 150px" placeholder="对方提交的值" />
              <t-button size="small" theme="warning" variant="outline" @click="simulateRemote">模拟他人先保存</t-button>
            </div>
            <ol class="sim-hint">
              <li>点某格「编辑」但先不保存；</li>
              <li>选择同层同令牌，点「模拟他人先保存」；</li>
              <li>再点「保存」——后到者会先看到冲突并逐格选择，系统不静默覆盖。</li>
            </ol>
          </div>
        </div>
      </section>

      <!-- 右栏：依赖链 + 组件预览 + 历史 -->
      <aside class="lg-side">
        <section class="panel">
          <div class="panel-head"><div><strong>依赖链</strong><span>{{ selectedMeta?.id }}</span></div></div>
          <div class="chain-paths">
            <div v-for="(path, i) in impact?.chains ?? []" :key="i" class="chain-path">
              <template v-for="(node, j) in path" :key="node">
                <code :class="{ root: j === 0 }">{{ tokenName(node) }}<small>{{ node }}</small></code>
                <t-icon v-if="j < path.length - 1" name="chevron-right" size="13px" />
              </template>
            </div>
            <p v-if="!impact?.chains.length" class="muted">该令牌没有下游引用。</p>
          </div>
          <div v-if="impact?.descendants.length" class="descendants">
            <span v-for="id in impact.descendants.slice(0, 6)" :key="id" class="desc-chip">{{ tokenName(id) }}</span>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head"><div><strong>组件预览</strong><span>按 {{ store.activeLayer.short }} 层解析值实时渲染</span></div></div>
          <div class="preview-list">
            <div v-for="component in (impact?.components ?? [])" :key="component.id" class="preview-item">
              <div class="preview-label"><strong>{{ component.name }}</strong><span>{{ component.group }}</span></div>
              <button
                v-if="component.id === 'button-primary'"
                class="mock-primary-btn"
                :style="{
                  background: swatch(store.activeLayerId, 'component.button.primary.bg'),
                  color: swatch(store.activeLayerId, 'component.button.primary.text'),
                  borderRadius: swatch(store.activeLayerId, 'radius.control'),
                  fontFamily: swatch(store.activeLayerId, 'font.family.sans'),
                  fontSize: swatch(store.activeLayerId, 'font.size.body')
                }"
              >确认提交</button>
              <div
                v-else-if="component.id === 'input'"
                class="mock-input"
                :style="{
                  borderRadius: swatch(store.activeLayerId, 'radius.control'),
                  fontFamily: swatch(store.activeLayerId, 'font.family.sans'),
                  fontSize: swatch(store.activeLayerId, 'font.size.body')
                }"
              >
                <span :style="{ color: swatch(store.activeLayerId, 'color.text.secondary') }">请输入内容</span>
              </div>
              <div
                v-else
                class="mock-mini-card"
                :style="{
                  background: swatch(store.activeLayerId, 'color.surface.canvas'),
                  boxShadow: swatch(store.activeLayerId, 'shadow.raised'),
                  borderRadius: swatch(store.activeLayerId, 'radius.control')
                }"
              >
                <span :style="{ background: swatch(store.activeLayerId, 'component.button.primary.bg') }" />
                <span :style="{ background: swatch(store.activeLayerId, 'color.text.secondary') }" />
                <span :style="{ background: swatch(store.activeLayerId, 'color.text.primary') }" />
              </div>
            </div>
            <p v-if="!impact?.components.length" class="muted">没有组件直接或间接绑定该令牌。</p>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head"><div><strong>修订历史</strong><span>{{ store.activeLayer.short }} · 含冲突仲裁记录</span></div></div>
          <div class="history-list">
            <div v-for="(entry, i) in selectedHistory" :key="i" class="history-item">
              <i />
              <div>
                <code>{{ entry.value }}</code>
                <strong>{{ entry.by }} · {{ entry.at }}</strong>
                <small v-if="entry.note">{{ entry.note }}</small>
              </div>
            </div>
            <p v-if="!selectedHistory.length" class="muted">本层暂无修订记录（值来自继承）。</p>
          </div>
        </section>
      </aside>
    </div>

    <!-- 待再确认横幅 -->
    <section v-if="store.staleOverrides.length" class="stale-banner panel">
      <t-icon name="error-circle" theme="danger" size="20px" />
      <div>
        <strong>{{ store.staleOverrides.length }} 个平台覆盖在品牌基础值变更后尚未再确认</strong>
        <p>未确认前主题发布会被拦下。可在发布门禁中查看受影响组件预览与依赖链，逐格选择保留或跟随。</p>
      </div>
      <t-button size="small" theme="primary" @click="openGate">打开发布门禁</t-button>
    </section>

    <ConflictCenter v-model:visible="conflictVisible" />
    <PublishGate v-model:visible="gateVisible" />
  </div>
</template>

<style scoped>
.lg-page { display: grid; gap: 13px; }
.chain-bar { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 12px 16px; flex-wrap: wrap; }
.chain-flow { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.chain-node { text-align: left; border: 1px solid #dce2e7; background: #f8fafb; border-radius: 6px; padding: 8px 14px; cursor: pointer; min-width: 150px; }
.chain-node strong { display: block; font-size: 12px; color: #344a5c; }
.chain-node span { display: block; font-size: 9px; color: #93a0ab; margin-top: 3px; }
.chain-node em { display: block; font-style: normal; font-size: 8px; color: #b3a07a; margin-top: 3px; }
.chain-node.active { border-color: #2864dc; background: #e9f0fd; box-shadow: 0 0 0 1px #2864dc inset; }
.chain-node.brand strong { color: #17664b; }
.chain-arrow { color: #93a0ab; }
.chain-status { display: flex; align-items: center; gap: 8px; }
.lg-grid { display: grid; grid-template-columns: 262px minmax(0, 1fr) 320px; gap: 13px; align-items: start; }
.lg-tree { display: flex; flex-direction: column; max-height: calc(100vh - 230px); min-height: 560px; }
.lg-tree > .t-input { margin: 11px; width: calc(100% - 22px); }
.lg-categories { display: flex; gap: 5px; overflow-x: auto; padding: 0 11px 8px; }
.lg-categories button { flex: none; border: 1px solid #dce2e7; background: #f8fafb; color: #657582; border-radius: 4px; padding: 4px 8px; font-size: 9px; cursor: pointer; }
.lg-categories button.active { background: #e9f0fd; color: #245dc8; border-color: #a9c0ed; font-weight: 700; }
.lg-tree-list { overflow: auto; border-top: 1px solid #edf1f3; flex: 1; }
.lg-tree-list > button { width: 100%; border: 0; border-bottom: 1px solid #f1f4f7; background: #fff; display: flex; gap: 9px; text-align: left; padding: 10px 11px; cursor: pointer; }
.lg-tree-list > button:hover, .lg-tree-list > button.active { background: #f0f5fd; }
.lg-tree-list > button > i { width: 6px; border-radius: 4px; background: #8b9aa5; flex: none; }
.lg-tree-list > button > i.color { background: #4c83e6; }
.lg-tree-list > button > i.component { background: #8b5ac9; }
.lg-tree-list > button > i.font { background: #b37a39; }
.lg-tree-list > button > i.spacing, .lg-tree-list > button > i.radius { background: #3f8f7d; }
.lg-tree-text { min-width: 0; flex: 1; }
.lg-tree-text strong { font-size: 11px; display: block; }
.lg-tree-text > span { font-size: 8.5px; color: #71808d; font-family: ui-monospace, monospace; display: block; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lg-tree-flags { display: flex; gap: 4px; margin-top: 4px; }
.flag { font-style: normal; font-size: 8px; border-radius: 3px; padding: 1px 5px; }
.flag.stale { background: #fdeceb; color: #a34a48; }
.flag.conflict { background: #fdf6e9; color: #a5681a; }
.actor-switch { border-top: 1px solid #edf1f3; padding: 10px 11px; display: grid; gap: 6px; }
.actor-switch span { font-size: 9px; color: #93a0ab; }

.lg-matrix { padding-bottom: 6px; }
.matrix-table { overflow-x: auto; }
.matrix-row { display: grid; grid-template-columns: 210px minmax(0, 1fr); border-bottom: 1px solid #f1f4f7; }
.matrix-row.selected { background: #f7faff; }
.matrix-head-row { border-bottom: 1px solid #dce2e7; background: #f8fafb; }
.matrix-layer-name { display: flex; gap: 8px; align-items: center; padding: 10px 12px; border-right: 1px solid #edf1f3; cursor: pointer; min-width: 0; }
.matrix-layer-name > i { width: 5px; align-self: stretch; border-radius: 3px; background: #8b9aa5; }
.matrix-layer-name > i.color { background: #4c83e6; }
.matrix-layer-name > i.component { background: #8b5ac9; }
.matrix-layer-name > i.font { background: #b37a39; }
.matrix-layer-name > i.spacing, .matrix-layer-name > i.radius { background: #3f8f7d; }
.matrix-layer-name strong { font-size: 11px; display: block; }
.matrix-layer-name code { font-size: 8.5px; color: #93a0ab; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.matrix-cells { display: grid; grid-template-columns: repeat(4, minmax(132px, 1fr)); }
.matrix-head-row .matrix-cells span { padding: 9px 10px; font-size: 10px; color: #52626f; display: flex; align-items: baseline; gap: 5px; border-left: 1px solid #edf1f3; }
.matrix-head-row .matrix-cells span.active { color: #245dc8; font-weight: 700; }
.matrix-head-row .matrix-cells small { font-size: 8px; color: #b0bbc5; }
.cell { border-left: 1px solid #f1f4f7; padding: 8px 10px; display: grid; gap: 4px; cursor: default; min-width: 0; }
.cell.overridden { background: #fdfaf2; }
.cell.stale { background: #fdf1f0; box-shadow: inset 3px 0 0 #d04c4c; }
.cell.selected { outline: 1px solid #2864dc; outline-offset: -1px; }
.cell-line { display: flex; align-items: center; gap: 6px; min-width: 0; }
.cell-line code { font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.color-dot { width: 11px; height: 11px; border-radius: 3px; border: 1px solid rgba(0,0,0,.15); flex: none; }
.cell-meta { display: flex; gap: 4px; flex-wrap: wrap; }
.badge { font-size: 8px; border-radius: 3px; padding: 1px 5px; line-height: 1.5; }
.badge.inherit { background: #eef3f8; color: #6d7d8c; }
.badge.override { background: #f3e7d3; color: #8a6324; font-weight: 700; }
.badge.stale-badge { background: #fdeceb; color: #a34a48; font-weight: 700; }
.cell-actions { display: flex; gap: 2px; flex-wrap: wrap; margin-top: -2px; }
.cell-actions .t-button { padding: 0 4px; font-size: 9px; height: 22px; }
.edit-actions { display: flex; justify-content: flex-end; gap: 2px; }
.edit-actions .t-button { padding: 0 6px; height: 22px; font-size: 9px; }

.selected-detail { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; padding: 14px 16px; border-top: 1px solid #edf1f3; background: #fafcfd; }
.selected-detail h5, .sim-panel h5 { margin: 0 0 8px; font-size: 10px; color: #52626f; }
.trace { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.trace-node { border: 1px solid #dce2e7; border-radius: 5px; padding: 6px 9px; background: #fff; min-width: 92px; }
.trace-node.source { border-color: #2864dc; background: #eef4fd; }
.trace-node strong { font-size: 9px; color: #52626f; display: block; }
.trace-node code { font-size: 10px; display: block; margin: 3px 0; overflow-wrap: anywhere; }
.trace-node small { font-size: 8px; color: #a3aeba; }
.muted { font-size: 10px; color: #93a0ab; margin: 6px 0 0; line-height: 1.5; }
.muted strong { color: #344a5c; }
.sim-panel { border-left: 1px solid #edf1f3; padding-left: 14px; }
.sim-form { display: flex; gap: 6px; flex-wrap: wrap; }
.sim-hint { margin: 8px 0 0; padding-left: 16px; color: #93a0ab; font-size: 9px; line-height: 1.7; }

.lg-side { display: grid; gap: 13px; }
.chain-paths { padding: 10px 12px; display: grid; gap: 6px; }
.chain-path { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.chain-path code { font-size: 9px; background: #eef3f8; border: 1px solid #dce5ee; border-radius: 3px; padding: 3px 7px; color: #344a5c; }
.chain-path code.root { background: #fdeceb; border-color: #f0c9c7; color: #a34a48; }
.chain-path code small { display: block; font-size: 7.5px; color: #93a0ab; }
.descendants { padding: 0 12px 10px; display: flex; gap: 5px; flex-wrap: wrap; }
.desc-chip { font-size: 8.5px; background: #f1f4f7; border-radius: 3px; padding: 2px 7px; color: #52626f; }
.preview-list { padding: 10px 12px; display: grid; gap: 10px; }
.preview-item { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: center; padding-bottom: 10px; border-bottom: 1px solid #f4f6f8; }
.preview-item:last-child { border-bottom: 0; padding-bottom: 0; }
.preview-label strong { font-size: 10.5px; display: block; }
.preview-label span { font-size: 8.5px; color: #93a0ab; }
.mock-primary-btn { border: 0; padding: 7px 15px; font-size: 10px; }
.mock-input { border: 1px solid #c6d0d8; padding: 8px 11px; background: #fff; min-width: 108px; }
.mock-input span { font-size: 10px; }
.mock-mini-card { width: 108px; min-height: 48px; border: 1px solid #dce2e7; padding: 8px; display: flex; flex-direction: column; gap: 5px; }
.mock-mini-card span { height: 5px; border-radius: 3px; }
.mock-mini-card span:nth-child(1) { width: 55%; }
.mock-mini-card span:nth-child(2) { width: 75%; }
.mock-mini-card span:nth-child(3) { width: 40%; }
.history-list { padding: 6px 12px 12px; max-height: 220px; overflow: auto; }
.history-item { display: flex; gap: 8px; padding: 7px 0; border-bottom: 1px dashed #edf1f3; }
.history-item:last-child { border-bottom: 0; }
.history-item > i { width: 7px; height: 7px; border-radius: 50%; background: #2864dc; margin-top: 5px; flex: none; }
.history-item code { font-size: 10px; display: block; }
.history-item strong { font-size: 8.5px; color: #52626f; display: block; margin-top: 3px; font-weight: 600; }
.history-item small { font-size: 8.5px; color: #93a0ab; display: block; margin-top: 2px; line-height: 1.4; }

.stale-banner { display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: #fdf6f6; border-color: #f0c9c7; }
.stale-banner strong { font-size: 12px; display: block; }
.stale-banner p { margin: 3px 0 0; font-size: 10px; color: #71808d; }
.stale-banner .t-button { margin-left: auto; }

@media (max-width: 1380px) {
  .lg-grid { grid-template-columns: 240px minmax(0, 1fr); }
  .lg-side { grid-column: 1 / -1; grid-template-columns: 1fr 1fr 1fr; }
}
@media (max-width: 900px) {
  .lg-grid { grid-template-columns: 1fr; }
  .lg-tree { max-height: 420px; min-height: 0; }
  .lg-side { grid-column: auto; grid-template-columns: 1fr; }
  .selected-detail { grid-template-columns: 1fr; }
  .sim-panel { border-left: 0; padding-left: 0; }
  .matrix-row { grid-template-columns: 150px minmax(520px, 1fr); }
  .matrix-table { overflow-x: auto; }
}
</style>
