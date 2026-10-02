<script setup lang="ts">
import { computed } from 'vue';
import { LAYER_BY_ID } from '../layers';
import { useGovernanceStore } from '../governance';

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{ 'update:visible': [value: boolean] }>();

const store = useGovernanceStore();
const pending = computed(() => store.pendingConflicts);
const current = computed(() => pending.value[0] ?? null);

function close() {
  emit('update:visible', false);
}

function keepCurrent() {
  if (!current.value) return;
  store.resolveKeepCurrent(current.value);
}
function keepIncoming() {
  if (!current.value) return;
  store.resolveKeepIncoming(current.value);
}
function merge() {
  if (!current.value) return;
  store.resolveMerge(current.value);
}
</script>

<template>
  <t-dialog
    :visible="props.visible"
    :header="current ? '保存冲突 · 请选择保留哪一层' : '保存冲突'"
    width="640px"
    :footer="false"
    :close-on-overlay-click="false"
    @close="close"
  >
    <div v-if="current" class="conflict">
      <div class="conflict-banner">
        <t-icon name="error-circle" size="24px" theme="warning" />
        <div>
          <strong>你（后保存者）打开该单元格后，已有另一位维护员先提交</strong>
          <p>为避免静默覆盖，本次保存已被拦下。请逐格比较双方值后选择保留方式；未处理完不能发布。</p>
        </div>
      </div>

      <div class="conflict-meta">
        <t-tag variant="light">{{ LAYER_BY_ID[current.layerId].name }}</t-tag>
        <code>{{ current.tokenId }}</code>
        <small>{{ store.tokenMeta.find(m => m.id === current.tokenId)?.name }}</small>
      </div>

      <div class="conflict-grid">
        <div class="conflict-side server">
          <header>
            <t-tag size="small" theme="success" variant="light">先保存 · 已落库</t-tag>
            <span>revision {{ current.currentRevision }}</span>
          </header>
          <code>{{ current.currentValue }}</code>
          <small>{{ current.currentBy }}</small>
        </div>
        <div class="vs"><t-icon name="swap" /></div>
        <div class="conflict-side mine">
          <header>
            <t-tag size="small" theme="warning" variant="light">后保存 · 你的草稿</t-tag>
            <span>基于 revision {{ current.baseRevision }}</span>
          </header>
          <code>{{ current.incomingValue }}</code>
          <small>{{ current.incomingBy }}</small>
        </div>
      </div>

      <div class="conflict-upstream">
        <span>该层继承链上游现值</span>
        <code>{{ current.upstreamValue }}</code>
      </div>

      <div class="conflict-actions">
        <t-button variant="outline" @click="keepCurrent">保留先保存者（放弃我的草稿）</t-button>
        <t-button variant="outline" @click="merge">双方保留 · 标记待人工合并</t-button>
        <t-button theme="primary" @click="keepIncoming">用我的草稿覆盖（revision 前进）</t-button>
      </div>
      <p v-if="pending.length > 1" class="remaining">本次还有 {{ pending.length - 1 }} 个冲突等待逐个仲裁。</p>
    </div>

    <div v-else class="conflict-done">
      <t-icon name="check-circle" size="34px" theme="success" />
      <strong>所有冲突已仲裁</strong>
      <p>每一格的取舍都记录在该单元格的修订历史中。</p>
      <t-button theme="primary" @click="close">完成</t-button>
    </div>
  </t-dialog>
</template>

<style scoped>
.conflict { display: grid; gap: 14px; }
.conflict-banner { display: flex; gap: 12px; align-items: flex-start; padding: 13px; background: #fdf6e9; border: 1px solid #ecd7a8; border-radius: 6px; }
.conflict-banner strong { font-size: 13px; display: block; }
.conflict-banner p { margin: 5px 0 0; font-size: 11px; color: #71808d; line-height: 1.5; }
.conflict-meta { display: flex; align-items: center; gap: 10px; }
.conflict-meta code { font-size: 11px; background: #f1f4f7; border-radius: 3px; padding: 3px 8px; }
.conflict-meta small { font-size: 10px; color: #93a0ab; }
.conflict-grid { display: grid; grid-template-columns: 1fr 36px 1fr; gap: 8px; align-items: stretch; }
.conflict-side { border: 1px solid #dce2e7; border-radius: 6px; padding: 11px; display: grid; gap: 8px; align-content: start; }
.conflict-side.server { background: #f0f8f4; border-color: #bfe3d3; }
.conflict-side.mine { background: #fdf6e9; border-color: #ecd7a8; }
.conflict-side header { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.conflict-side header span { font-size: 8.5px; color: #93a0ab; }
.conflict-side code { font-size: 12px; background: rgba(255,255,255,.8); border-radius: 4px; padding: 9px; display: block; overflow-wrap: anywhere; min-height: 38px; }
.conflict-side small { font-size: 9px; color: #71808d; }
.vs { display: grid; place-items: center; color: #93a0ab; }
.conflict-upstream { display: flex; align-items: center; gap: 10px; font-size: 10px; color: #71808d; background: #f8fafb; border: 1px dashed #dce2e7; border-radius: 5px; padding: 8px 11px; }
.conflict-upstream code { font-size: 11px; }
.conflict-actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
.remaining { text-align: right; font-size: 10px; color: #a5681a; margin: 0; }
.conflict-done { text-align: center; display: grid; gap: 10px; justify-items: center; padding: 18px 0 6px; }
.conflict-done p { color: #71808d; font-size: 11px; margin: 0; }
</style>
