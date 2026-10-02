<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { MessagePlugin } from 'tdesign-vue-next';
import { useTokenStore } from '../store';
import { THEMES, PLATFORMS, TOKEN_META_BY_ID, type ThemeId, type PlatformId, type LayerId } from '../layers';

const store = useTokenStore();
const { stalePins } = storeToRefs(store);

const themeOptions = THEMES.map((t) => ({ label: t.label, value: t.id }));
const platformOptions = PLATFORMS.map((p) => ({ label: p.label, value: p.id }));

const editing = ref<{ key: string; value: string } | null>(null);
const conflictChoices = ref<Record<string, 'mine' | 'theirs'>>({});

onMounted(async () => {
  await store.refreshHashes();
  // 进入页面即演示：另一位维护员已先保存品牌层
  if (!store.peerSimulated) await store.simulatePeer();
});

const brandRows = computed(() =>
  Object.values(TOKEN_META_BY_ID)
    .filter((m) => store.tree.brand.entries[m.id])
    .map((m) => ({ id: m.id, name: m.name, category: m.category, value: store.tree.brand.entries[m.id].value ?? '' }))
);

const themeRows = computed(() =>
  Object.values(TOKEN_META_BY_ID).map((m) => {
    const entry = store.tree.theme[store.activeTheme as ThemeId].entries[m.id];
    const resolved = store.tokens.find((t) => t.id === m.id)?.value ?? '';
    return {
      id: m.id,
      name: m.name,
      category: m.category,
      raw: entry?.value ?? '',
      resolved,
      overridden: entry?.value !== undefined && entry?.value !== null && entry?.value !== ''
    };
  })
);

const platformRows = computed(() => {
  const staleMap = new Map(stalePins.value.filter((p) => p.platform === store.activePlatform).map((p) => [p.tokenId, p]));
  return Object.values(TOKEN_META_BY_ID).map((m) => {
    const entry = store.tree.platform[store.activePlatform as PlatformId].entries[m.id];
    const resolved = store.tokens.find((t) => t.id === m.id)?.value ?? '';
    const isRef = entry?.value?.startsWith('{');
    return {
      id: m.id,
      name: m.name,
      category: m.category,
      raw: entry?.value ?? '',
      resolved,
      pin: !!entry?.value && !isRef,
      following: !!isRef,
      inherited: !entry?.value,
      stale: staleMap.get(m.id)
    };
  });
});

const conflict = computed(() => store.conflict);
const conflictItems = computed(() => conflict.value?.items ?? []);
const conflictLayerLabel = computed(() => (conflict.value ? layerLabel(conflict.value.layer, conflict.value.scope) : ''));

watch(conflict, (c) => {
  if (c) {
    conflictChoices.value = {};
    for (const item of c.items) conflictChoices.value[item.tokenId] = 'mine';
  }
});

function layerLabel(layer: LayerId, scope: string): string {
  if (layer === 'brand') return '品牌基础层';
  if (layer === 'theme') return `主题层 · ${THEMES.find((t) => t.id === scope)?.label ?? scope}`;
  return `平台层 · ${PLATFORMS.find((p) => p.id === scope)?.label ?? scope}`;
}

function startEdit(key: string, value: string) {
  editing.value = { key, value };
}
function commitEdit(layer: LayerId, scope: string, id: string) {
  if (!editing.value) return;
  store.editEntry(layer, scope, id, editing.value.value.trim());
  editing.value = null;
}
function revertEntry(layer: LayerId, scope: string, id: string) {
  store.editEntry(layer, scope, id, null);
}

function isDirty(key: string): boolean {
  return store.dirtyScopes.includes(key);
}

async function submitConflict() {
  await store.applyConflict(conflictChoices.value);
}

function tokenName(id: string) {
  return TOKEN_META_BY_ID[id]?.name ?? id;
}
function tokenCategory(id: string) {
  return TOKEN_META_BY_ID[id]?.category ?? 'color';
}
</script>

<template>
  <div class="layers-page">
    <div class="panel chain-panel">
      <div class="panel-head">
        <div>
          <strong>品牌 → 主题 → 平台 继承链</strong>
          <span>下层只重算没有显式覆盖的值；固定值覆盖随品牌基础值变更进入重新确认</span>
        </div>
        <div class="chain-flow">
          <span class="chain-node brand">品牌基础层</span><t-icon name="arrow-right" />
          <span class="chain-node theme">主题变体层</span><t-icon name="arrow-right" />
          <span class="chain-node platform">平台变体层</span>
        </div>
      </div>
      <div class="chain-controls">
        <label>主题<t-select v-model="store.activeTheme" :options="themeOptions" style="width: 130px" /></label>
        <label>平台<t-select v-model="store.activePlatform" :options="platformOptions" style="width: 150px" /></label>
        <div class="chain-hint">
          <t-icon name="info-circle" />
          <span>引用（<code>{'{...}'}</code>）自动跟随上游；字面量为固定值，上游变更后需重新确认。</span>
        </div>
      </div>
    </div>

    <div class="layer-columns">
      <!-- 品牌基础层 -->
      <section class="panel layer-col">
        <div class="panel-head">
          <div>
            <strong>品牌基础层</strong>
            <span>品牌令牌的唯一事实源</span>
          </div>
          <t-tag v-if="isDirty('brand:brand')" theme="warning" variant="light">有未保存修改</t-tag>
        </div>
        <div class="layer-rows">
          <div v-for="row in brandRows" :key="row.id" class="layer-row">
            <i :class="row.category" />
            <div class="row-main">
              <strong>{{ row.name }}</strong>
              <span>{{ row.id }}</span>
            </div>
            <template v-if="editing?.key === `brand:${row.id}`">
              <t-input v-model="editing.value" size="small" class="row-input" @keyup.enter="commitEdit('brand', 'brand', row.id)" />
              <t-button size="small" @click="editing = null">取消</t-button>
              <t-button size="small" theme="primary" @click="commitEdit('brand', 'brand', row.id)">确定</t-button>
            </template>
            <template v-else>
              <code class="row-value">{{ row.value }}</code>
              <t-button size="small" variant="text" @click="startEdit(`brand:${row.id}`, row.value)">编辑</t-button>
            </template>
          </div>
        </div>
        <div class="layer-foot">
          <t-button size="small" variant="outline" @click="store.simulatePeer()">模拟周序同时保存</t-button>
          <t-button size="small" theme="primary" @click="store.saveScope('brand', 'brand')">保存品牌层</t-button>
        </div>
      </section>

      <!-- 主题变体层 -->
      <section class="panel layer-col">
        <div class="panel-head">
          <div>
            <strong>主题变体层</strong>
            <span>{{ THEMES.find((t) => t.id === store.activeTheme)?.label }}主题 · 引用品牌令牌</span>
          </div>
          <t-tag v-if="isDirty(`theme:${store.activeTheme}`)" theme="warning" variant="light">有未保存修改</t-tag>
        </div>
        <div class="layer-rows">
          <div v-for="row in themeRows" :key="row.id" class="layer-row">
            <i :class="row.category" />
            <div class="row-main">
              <strong>{{ row.name }}</strong>
              <span>{{ row.id }}</span>
            </div>
            <t-tag size="small" :theme="row.overridden ? 'primary' : 'default'" variant="light">{{ row.overridden ? '主题赋值' : '品牌继承' }}</t-tag>
            <template v-if="editing?.key === `theme:${row.id}`">
              <t-input v-model="editing.value" size="small" class="row-input" @keyup.enter="commitEdit('theme', store.activeTheme, row.id)" />
              <t-button size="small" @click="editing = null">取消</t-button>
              <t-button size="small" theme="primary" @click="commitEdit('theme', store.activeTheme, row.id)">确定</t-button>
            </template>
            <template v-else>
              <code class="row-value">{{ row.raw || row.resolved }}</code>
              <t-button size="small" variant="text" @click="startEdit(`theme:${row.id}`, row.raw || row.resolved)">编辑</t-button>
              <t-button v-if="row.overridden" size="small" variant="text" @click="revertEntry('theme', store.activeTheme, row.id)">恢复继承</t-button>
            </template>
          </div>
        </div>
        <div class="layer-foot">
          <t-button size="small" theme="primary" @click="store.saveScope('theme', store.activeTheme)">保存主题层</t-button>
        </div>
      </section>

      <!-- 平台变体层 -->
      <section class="panel layer-col">
        <div class="panel-head">
          <div>
            <strong>平台变体层</strong>
            <span>{{ PLATFORMS.find((p) => p.id === store.activePlatform)?.label }} · 仅显式覆盖</span>
          </div>
          <t-tag v-if="isDirty(`platform:${store.activePlatform}`)" theme="warning" variant="light">有未保存修改</t-tag>
        </div>
        <div class="layer-rows">
          <div v-for="row in platformRows" :key="row.id" class="layer-row" :class="{ stale: row.stale }">
            <i :class="row.category" />
            <div class="row-main">
              <strong>{{ row.name }}</strong>
              <span>{{ row.id }}</span>
            </div>
            <t-tag v-if="row.stale" size="small" theme="danger" variant="light">待重新确认</t-tag>
            <t-tag v-else-if="row.pin" size="small" theme="warning" variant="light">平台固定</t-tag>
            <t-tag v-else-if="row.following" size="small" theme="success" variant="light">跟随引用</t-tag>
            <t-tag v-else size="small" variant="light">继承</t-tag>
            <template v-if="editing?.key === `platform:${row.id}`">
              <t-input v-model="editing.value" size="small" class="row-input" @keyup.enter="commitEdit('platform', store.activePlatform, row.id)" />
              <t-button size="small" @click="editing = null">取消</t-button>
              <t-button size="small" theme="primary" @click="commitEdit('platform', store.activePlatform, row.id)">确定</t-button>
            </template>
            <template v-else>
              <code class="row-value">{{ row.raw || row.resolved }}</code>
              <t-button size="small" variant="text" @click="startEdit(`platform:${row.id}`, row.raw || '')">{{ row.raw ? '编辑' : '覆盖' }}</t-button>
              <t-button v-if="row.raw" size="small" variant="text" @click="revertEntry('platform', store.activePlatform, row.id)">恢复继承</t-button>
            </template>
          </div>
        </div>
        <div class="layer-foot">
          <t-button size="small" theme="primary" @click="store.saveScope('platform', store.activePlatform)">保存平台层</t-button>
        </div>
      </section>
    </div>

    <!-- 并发保存冲突对话框：后到者先看冲突，逐令牌选择保留版本 -->
    <t-dialog
      v-if="conflict"
      :visible="!!conflict"
      header="保存冲突：你是后到者"
      :confirm-btn="{ content: '合并并保存', onClick: submitConflict }"
      :cancel-btn="{ content: '采用先到者版本', onClick: () => store.acceptTheirs() }"
      width="760px"
      @update:visible="(v: boolean) => { if (!v) store.acceptTheirs(); }"
    >
      <div class="conflict-box">
        <div class="conflict-banner">
          <t-icon name="error-circle" />
          <div>
            <strong>{{ conflictLayerLabel }}在你编辑期间已被另一位维护员（周序 · 运营设计组）保存。</strong>
            <span>共 {{ conflictItems.length }} 处双方都修改的令牌需要逐处确认保留版本；先到者单独修改的 {{ conflict?.serverOnly.length ?? 0 }} 处已自动合并。未确认前不会覆盖线上版本。</span>
          </div>
        </div>
        <div v-if="!conflictItems.length" class="conflict-empty">
          双方没有修改同一令牌，先到者的 {{ conflict?.serverOnly.length ?? 0 }} 处变更将自动合并，你可以直接保存。
        </div>
        <div v-for="item in conflictItems" :key="item.tokenId" class="conflict-item">
          <div class="conflict-token">
            <i :class="tokenCategory(item.tokenId)" />
            <div>
              <strong>{{ tokenName(item.tokenId) }}</strong>
              <span>{{ item.tokenId }}</span>
            </div>
          </div>
          <div class="conflict-versions">
            <label :class="{ active: conflictChoices[item.tokenId] === 'mine' }">
              <input type="radio" :name="`conflict-${item.tokenId}`" value="mine" v-model="conflictChoices[item.tokenId]" />
              <div><em>你的版本（后到）</em><code>{{ item.mine ?? '—' }}</code></div>
            </label>
            <label :class="{ active: conflictChoices[item.tokenId] === 'theirs' }">
              <input type="radio" :name="`conflict-${item.tokenId}`" value="theirs" v-model="conflictChoices[item.tokenId]" />
              <div><em>先到者版本（周序）</em><code>{{ item.theirs ?? '—' }}</code></div>
            </label>
          </div>
        </div>
      </div>
    </t-dialog>
  </div>
</template>
