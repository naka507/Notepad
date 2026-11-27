<script setup lang="ts">
import type { Category, CategoryScope } from "@notepad/core"
import { ChevronDown, Folder, FolderPlus, Pencil, Trash2 } from "@lucide/vue"
import { ElDialog } from "element-plus/es/components/dialog/index"
import { ElMessage } from "element-plus/es/components/message/index"
import { ElPopover } from "element-plus/es/components/popover/index"
import { computed, ref, type Component } from "vue"
import { api } from "@/api/client"
import { confirmDialog } from "@/components/confirm"
import { t } from "@/i18n"

const props = defineProps<{
  scope: CategoryScope
  modelValue: string // 'all' | 'default' | categoryId
  categories: Category[]
  defaultCount: number
}>()

const emit = defineEmits<{
  "update:modelValue": [value: string]
  changed: []
  created: [category: Category]
}>()

const UiDialog = ElDialog as unknown as Component
const UiPopover = ElPopover as unknown as Component

const open = ref(false)
const dialogOpen = ref(false)
const editing = ref<Category | null>(null)
const formName = ref("")
const saving = ref(false)

const currentLabel = computed(() => {
  if (props.modelValue === "all") return t("common.all")
  if (props.modelValue === "default") return t("common.defaultCategory")
  return props.categories.find((c) => c.id === props.modelValue)?.name ?? t("common.all")
})

function choose(value: string) {
  emit("update:modelValue", value)
  open.value = false
}

function openCreate() {
  open.value = false
  editing.value = null
  formName.value = ""
  dialogOpen.value = true
}

function openEdit(cat: Category) {
  open.value = false
  editing.value = cat
  formName.value = cat.name
  dialogOpen.value = true
}

async function submit() {
  if (!formName.value.trim()) return
  saving.value = true
  try {
    if (editing.value) {
      await api.updateCategory(editing.value.id, { name: formName.value.trim() })
      emit("changed")
    } else {
      const res = await api.createCategory({ scope: props.scope, name: formName.value.trim() })
      emit("changed")
      if (res.category) emit("created", res.category)
    }
    dialogOpen.value = false
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "Error")
  } finally {
    saving.value = false
  }
}

async function remove(cat: Category) {
  open.value = false
  const confirmed = await confirmDialog({
    title: t("ws.deleteCategory"),
    message: t("ws.confirmDeleteCategory", { name: cat.name }),
    confirmText: t("common.delete"),
    tone: "danger"
  })
  if (!confirmed) return
  try {
    await api.deleteCategory(cat.id)
    if (props.modelValue === cat.id) {
      emit("update:modelValue", "all")
    }
    emit("changed")
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "Error")
  }
}

defineExpose({ openCreate })
</script>

<template>
  <UiPopover
    v-model:visible="open"
    trigger="click"
    placement="bottom-start"
    :width="272"
    popper-class="category-popover"
  >
    <template #reference>
      <button class="category-picker" type="button" :title="currentLabel">
        <Folder :size="15" />
        <span>{{ currentLabel }}</span>
        <ChevronDown class="chevron" :class="{ open }" :size="15" />
      </button>
    </template>

    <div class="cat-panel">
      <div class="cat-list">
        <div
          class="cat-row"
          :class="{ active: modelValue === 'all' }"
          role="button"
          tabindex="0"
          @click="choose('all')"
        >
          <span class="cat-name">{{ t("common.all") }}</span>
        </div>

        <div
          class="cat-row"
          :class="{ active: modelValue === 'default' }"
          role="button"
          tabindex="0"
          @click="choose('default')"
        >
          <span class="cat-name-wrap">
            <span class="cat-name">{{ t("common.defaultCategory") }}</span>
            <span class="sys-tag">{{ t("common.system") }}</span>
          </span>
          <span class="cat-count">{{ defaultCount }}</span>
        </div>

        <div
          v-for="cat in categories"
          :key="cat.id"
          class="cat-row custom"
          :class="{ active: modelValue === cat.id }"
          role="button"
          tabindex="0"
          @click="choose(cat.id)"
        >
          <span class="cat-name">{{ cat.name }}</span>
          <span class="cat-count">{{ cat.itemCount ?? 0 }}</span>
          <div class="cat-row-actions">
            <button class="row-mini-btn" type="button" :title="t('ws.rename')" @click.stop="openEdit(cat)">
              <Pencil :size="12" />
            </button>
            <button
              class="row-mini-btn danger"
              type="button"
              :title="t('ws.deleteCategory')"
              @click.stop="remove(cat)"
            >
              <Trash2 :size="12" />
            </button>
          </div>
        </div>
      </div>

      <button class="cat-create" type="button" @click="openCreate">
        <FolderPlus :size="15" />
        <span>{{ t("ws.newCategory") }}</span>
      </button>
    </div>
  </UiPopover>

  <UiDialog v-model="dialogOpen" width="380px" align-center>
    <template #header>
      <div class="dialog-title">
        <FolderPlus :size="18" />
        <span>{{ editing ? t("ws.rename") : t("ws.newCategory") }}</span>
      </div>
    </template>
    <form :id="`cat-form-${scope}`" @submit.prevent="submit">
      <input
        v-model.trim="formName"
        class="input"
        :placeholder="t('ws.categoryName')"
        maxlength="40"
        required
      />
    </form>
    <template #footer>
      <div class="dialog-footer">
        <button class="ghost-button" type="button" @click="dialogOpen = false">{{ t("common.cancel") }}</button>
        <button class="button" type="submit" :form="`cat-form-${scope}`" :disabled="saving">
          {{ editing ? t("common.save") : t("common.create") }}
        </button>
      </div>
    </template>
  </UiDialog>
</template>

<style scoped>
.category-picker {
  width: 100%;
  min-width: 0;
  height: 32px;
  border: 0;
  border-radius: 6px;
  background: var(--surface-subtle);
  color: var(--text);
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;
  padding: 0 9px;
  text-align: left;
  transition: background-color var(--dur-fast) var(--ease-out);
}

.category-picker:hover {
  background: var(--surface-hover);
}

.category-picker span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 650;
}

.chevron {
  color: var(--muted);
  transition: transform var(--dur-fast) var(--ease-out);
}

.chevron.open {
  transform: rotate(180deg);
}

:global(.category-popover) {
  padding: 0 !important;
  border-color: var(--line) !important;
  border-radius: 8px !important;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.12) !important;
}

.cat-panel {
  display: grid;
  overflow: hidden;
  border-radius: 8px;
}

.cat-list {
  max-height: 300px;
  overflow: auto;
}

.cat-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
  min-height: 38px;
  padding: 0 10px;
  border-bottom: 1px solid var(--line);
  font-size: 13px;
  cursor: pointer;
}

.cat-row.custom {
  grid-template-columns: minmax(0, 1fr) auto auto;
}

.cat-row:hover,
.cat-row.active {
  background: var(--surface-hover);
}

.cat-row.active {
  box-shadow: inset 3px 0 0 var(--accent);
  font-weight: 650;
}

.cat-name-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.cat-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sys-tag {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--surface-strong);
  color: var(--muted);
  flex-shrink: 0;
}

.cat-count {
  font-size: 11px;
  color: var(--muted);
}

.cat-row-actions {
  display: inline-flex;
  gap: 2px;
}

.row-mini-btn {
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.row-mini-btn:hover {
  color: var(--text);
  background: var(--surface-strong);
}

.row-mini-btn.danger:hover {
  color: var(--danger);
  background: var(--danger-bg);
}

.cat-create {
  height: 38px;
  border: 0;
  background: var(--panel);
  color: var(--text);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 650;
}

.cat-create:hover {
  background: var(--surface-hover);
}
</style>
