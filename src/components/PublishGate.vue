<script setup lang="ts">
import { computed, ref } from 'vue';
import { MessagePlugin } from 'tdesign-vue-next';
import { useGovernanceStore } from '../governance';
import { COMPONENTS, LAYER_BY_ID, type LayerId } from '../layers';

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{ 'update:visible': [value: boolean] }>();

const store = useGovernanceStore();
const version = ref('4.6.0');
const publishing = ref(false);

const blockers = computed(() => store.publishBlockers());
const blocked = computed(() => blockers.value.stale.length > 0 || blockers.value.conflicts.length > 0);

const expanded = ref<Record<string, boolean>>({});
function toggle(key: string) {
  expanded.value[key] = !expanded.value[key];
}

function staleKey(row: { layerId: string; tokenId: string }) {
  return `${row.layerId}::${row.tokenId}`;
}

/** 一条过期覆盖影响的组件（在该平台层做材质化预览）。 */
function impactedComponents(tokenId: string) {
  const descendantSet = store.descendants(tokenId);
  return COMPONENTS.filter((component) =>
    component.tokens.some((bind) => bind.tokenId === tokenId || descendantSet.has(bind.tokenId))
  );
}

function swatch(layerId: LayerId, tokenId: string) {
  return store.cellOf(layerId, tokenId).resolved;
}

function isColor(tokenId: string) {
  return tokenId.startsWith('color.') || store.cellOf('brand', tokenId).resolved.startsWith('#');
}

function close() {
  emit('update:visible', false);
}

async function runPublish() {
  if (blocked.value) return;
  publishing.value = true;
  await new Promise((resolve) => setTimeout(resolve, 320));
  const ok = store.publish(version.value);
  publishing.value = false;
  if (ok) {
    MessagePlugin.success(`DS ${version.value} 已锁定发布，产品使用方可按固定版本拉取`);
    close();
  }
}
</script>

<template>
  <t-dialog
    :visible="props.visible"
    header="主题发布门禁"
    width="780px"
    :footer="false"
    @close="close"
  >
    <div class="gate">
      <div class="gate-version">
        <label><span>发布版本</span><t-input v-model="version" style="width: 180px" /></label>
        <div class="gate-chain">
          <span>继承链</span>
          <template v-for="(layer, index) in store.layers" :key="layer.id">
            <strong :class="layer.kind">{{ layer.short }}</strong>
            <t-icon v-if="index < store.layers.length - 1" name="chevron-right" />
          </template>
        </div>
      </div>

      <!-- 未再确认的平台覆盖：发布必须停下来 -->
      <div v-if="blockers.stale.length" class="gate-block">
        <div class="block-banner">
          <t-icon name="error-circle" size="22px" theme="danger" />
          <div>
            <strong>发布已暂停：{{ blockers.stale.length }} 个平台覆盖需要再确认</strong>
            <p>品牌基础值发生变化，以下平台令牌仍保留旧值。必须由平台维护者显式选择「保留覆盖」或「跟随品牌」后才能继续。</p>
          </div>
        </div>

        <div v-for="row in blockers.stale" :key="staleKey(row)" class="stale-card">
          <div class="stale-head" @click="toggle(staleKey(row))">
            <t-tag size="small" theme="danger" variant="light">{{ LAYER_BY_ID[row.layerId].short }} 待再确认</t-tag>
            <div class="stale-title">
              <strong>{{ store.tokenMeta.find(m => m.id === row.tokenId)?.name ?? row.tokenId }}</strong>
              <code>{{ row.tokenId }}</code>
            </div>
            <t-icon :name="expanded[staleKey(row)] ? 'chevron-up' : 'chevron-down'" />
          </div>
          <div class="stale-values">
            <div class="value-pill old">
              <span>平台覆盖值</span>
              <i v-if="isColor(row.tokenId)" :style="{ background: row.overrideValue }" />
              <code>{{ row.overrideValue }}</code>
              <small>{{ row.overrideBy }} · {{ row.overrideAt }}</small>
            </div>
            <t-icon name="arrow-right" />
            <div class="value-pill new">
              <span>品牌基础现值</span>
              <i v-if="isColor(row.tokenId)" :style="{ background: row.upstreamValue }" />
              <code>{{ row.upstreamValue }}</code>
              <small>确认时的快照为 {{ row.confirmedUpstreamResolved }}</small>
            </div>
          </div>
          <div class="stale-actions">
            <t-button size="small" variant="outline" @click="store.adoptUpstream(row.layerId, row.tokenId)">跟随品牌（放弃覆盖）</t-button>
            <t-button size="small" theme="primary" @click="store.keepOverride(row.layerId, row.tokenId)">保留平台覆盖并再确认</t-button>
          </div>

          <div v-if="expanded[staleKey(row)]" class="stale-impact">
            <div class="impact-col">
              <h5>依赖链</h5>
              <div v-for="(path, i) in store.chains(row.tokenId)" :key="i" class="chain-path">
                <template v-for="(node, j) in path" :key="node">
                  <code :class="{ root: j === 0 }">{{ node }}</code>
                  <t-icon v-if="j < path.length - 1" name="chevron-right" size="13px" />
                </template>
              </div>
              <p v-if="!store.descendants(row.tokenId).size" class="muted">该令牌没有下游引用。</p>
            </div>
            <div class="impact-col">
              <h5>受影响组件预览 · {{ LAYER_BY_ID[row.layerId].short }}</h5>
              <div v-for="component in impactedComponents(row.tokenId)" :key="component.id" class="impact-component">
                <div class="cmp-label"><strong>{{ component.name }}</strong><span>{{ component.group }}</span></div>
                <!-- 按钮 -->
                <button
                  v-if="component.id === 'button-primary'"
                  class="mock-primary-btn"
                  :style="{
                    background: swatch(row.layerId, 'component.button.primary.bg'),
                    color: swatch(row.layerId, 'component.button.primary.text'),
                    borderRadius: swatch(row.layerId, 'radius.control')
                  }"
                >确认提交</button>
                <!-- 输入框 -->
                <div
                  v-else-if="component.id === 'input'"
                  class="mock-input"
                  :style="{ borderRadius: swatch(row.layerId, 'radius.control') }"
                >
                  <span :style="{ color: swatch(row.layerId, 'color.text.secondary') }">请输入内容</span>
                </div>
                <!-- 卡片 / 浮层 -->
                <div
                  v-else
                  class="mock-mini-card"
                  :style="{
                    background: swatch(row.layerId, 'color.surface.canvas'),
                    boxShadow: swatch(row.layerId, 'shadow.raised'),
                    borderRadius: swatch(row.layerId, 'radius.control')
                  }"
                >
                  <span :style="{ background: swatch(row.layerId, 'component.button.primary.bg') }" />
                  <span :style="{ background: swatch(row.layerId, 'color.text.secondary') }" />
                </div>
                <div class="cmp-bindings">
                  <span v-for="bind in component.tokens" :key="bind.tokenId" :class="{ hit: bind.tokenId === row.tokenId || store.descendants(row.tokenId).has(bind.tokenId) }">
                    {{ bind.role }}: {{ swatch(row.layerId, bind.tokenId) }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 未仲裁的并发冲突同样拦截发布 -->
      <div v-if="blockers.conflicts.length" class="gate-block">
        <div class="block-banner warn">
          <t-icon name="info-circle" size="22px" theme="warning" />
          <div>
            <strong>还有 {{ blockers.conflicts.length }} 个并发保存冲突等待仲裁</strong>
            <p>后保存者必须先查看冲突并选择保留哪一层的值，系统不会静默覆盖任何一方。</p>
          </div>
        </div>
        <t-button variant="outline" size="small" @click="close">前往冲突中心处理</t-button>
      </div>

      <div v-if="!blocked" class="gate-clear">
        <t-icon name="check-circle" size="22px" theme="success" />
        <div>
          <strong>所有平台覆盖均已确认，无待处理冲突</strong>
          <p>品牌基础 → iOS / Android / Web 的继承值已重算完毕，发布后各产品按固定版本拉取。</p>
        </div>
      </div>

      <div class="gate-footer">
        <span class="last-publish">上次发布：{{ store.publishedAt }}</span>
        <div>
          <t-button variant="outline" @click="close">取消</t-button>
          <t-button theme="primary" :loading="publishing" :disabled="blocked" @click="runPublish">校验并锁定发布</t-button>
        </div>
      </div>
    </div>
  </t-dialog>
</template>

<style scoped>
.gate { display: grid; gap: 14px; }
.gate-version { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.gate-version label span { display: block; font-size: 10px; color: #71808d; margin-bottom: 5px; font-weight: 700; }
.gate-chain { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #71808d; }
.gate-chain strong { padding: 3px 9px; border-radius: 4px; background: #e9f0fd; color: #245dc8; font-size: 10px; }
.gate-chain strong.brand { background: #e7f5ef; color: #17664b; }
.block-banner { display: flex; gap: 12px; align-items: flex-start; padding: 14px; background: #fdeceb; border: 1px solid #f2c2c0; border-radius: 6px; }
.block-banner.warn { background: #fdf6e9; border-color: #ecd7a8; }
.block-banner strong { font-size: 13px; display: block; }
.block-banner p { margin: 5px 0 0; font-size: 11px; color: #71808d; line-height: 1.5; }
.gate-block { display: grid; gap: 10px; }
.stale-card { border: 1px solid #f0c9c7; border-radius: 6px; overflow: hidden; background: #fff; }
.stale-head { display: flex; align-items: center; gap: 10px; padding: 10px 13px; cursor: pointer; }
.stale-title { flex: 1; min-width: 0; }
.stale-title strong { font-size: 12px; display: block; }
.stale-title code { font-size: 9.5px; color: #71808d; }
.stale-values { display: flex; align-items: center; gap: 10px; padding: 0 13px 10px; }
.value-pill { flex: 1; border: 1px solid #dce2e7; border-radius: 5px; padding: 8px 10px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.value-pill.old { background: #fdf3f3; }
.value-pill.new { background: #f0f8f4; }
.value-pill span { font-size: 9px; color: #71808d; width: 100%; }
.value-pill i { width: 16px; height: 16px; border-radius: 3px; border: 1px solid rgba(0,0,0,.12); }
.value-pill code { font-size: 11px; }
.value-pill small { width: 100%; font-size: 9px; color: #93a0ab; }
.stale-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 0 13px 12px; }
.stale-impact { border-top: 1px dashed #e2e7eb; padding: 12px 13px; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); gap: 14px; background: #fafcfd; }
.impact-col h5 { margin: 0 0 8px; font-size: 10px; color: #52626f; letter-spacing: .04em; }
.chain-path { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin-bottom: 6px; }
.chain-path code { font-size: 9px; background: #eef3f8; border: 1px solid #dce5ee; border-radius: 3px; padding: 2px 6px; color: #344a5c; }
.chain-path code.root { background: #fdeceb; border-color: #f0c9c7; color: #a34a48; }
.muted { font-size: 10px; color: #93a0ab; }
.impact-component { padding: 9px 0; border-bottom: 1px solid #edf1f3; display: grid; grid-template-columns: 1fr 108px; gap: 8px; align-items: center; }
.impact-component:last-child { border-bottom: 0; }
.cmp-label strong { font-size: 10.5px; display: block; }
.cmp-label span { font-size: 8.5px; color: #93a0ab; }
.cmp-bindings { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 5px; }
.cmp-bindings span { font-size: 8px; color: #93a0ab; background: #f1f4f7; border-radius: 3px; padding: 2px 6px; }
.cmp-bindings span.hit { background: #fdeceb; color: #a34a48; font-weight: 700; }
.mock-primary-btn { border: 0; padding: 7px 14px; font-size: 10px; justify-self: end; }
.mock-input { border: 1px solid #c6d0d8; padding: 8px 10px; background: #fff; font-size: 10px; justify-self: stretch; }
.mock-input span { font-size: 10px; }
.mock-mini-card { height: 44px; border: 1px solid #dce2e7; padding: 8px; display: flex; flex-direction: column; gap: 5px; justify-self: stretch; }
.mock-mini-card span:first-child { height: 6px; width: 55%; border-radius: 3px; }
.mock-mini-card span:last-child { height: 5px; width: 75%; border-radius: 3px; }
.gate-clear { display: flex; gap: 12px; align-items: flex-start; padding: 14px; background: #eef9f3; border: 1px solid #bfe3d3; border-radius: 6px; }
.gate-clear strong { font-size: 13px; display: block; }
.gate-clear p { margin: 5px 0 0; font-size: 11px; color: #71808d; }
.gate-footer { display: flex; align-items: center; justify-content: space-between; border-top: 1px solid #edf1f3; padding-top: 12px; }
.last-publish { font-size: 10px; color: #93a0ab; }
.gate-footer > div { display: flex; gap: 8px; }
@media (max-width: 720px) {
  .stale-impact, .impact-component { grid-template-columns: 1fr; }
}
</style>
