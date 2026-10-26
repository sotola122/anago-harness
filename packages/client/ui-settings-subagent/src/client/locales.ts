/** Locale bundles for the Subagent settings page. */

import type { SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'

/** Locale keys the page renders. */
export type SubagentSettingsLocaleKey =
  | 'overridden' | 'reset' | 'readOnly' | 'unavailable'
  | 'save' | 'saving' | 'saveFailed'
  | 'subagentTitle' | 'subagentDescription' | 'subagentLimitsTitle'
  | 'subagentMaxDepth'
  | 'subagentDepthHelpLabel' | 'subagentDepthHelp'
  | 'subagentDepthZero' | 'subagentDepthOne' | 'subagentDepthOverride'
  | 'subagentMaxActive'
  | 'subagentCapacityHelpLabel' | 'subagentCapacityHelp'
  | 'subagentDepthInvalid'
  | 'subagentCapacityInvalid'
  | 'subagentModelSelectionTitle'
  | 'subagentModelSelectionToggle' | 'subagentModelSelectionChoose' | 'subagentModelSelectionAllowed'
  | 'subagentModelSelectionLoading' | 'subagentModelSelectionLoadFailed' | 'subagentModelSelectionRetry'
  | 'subagentModelSelectionPartial' | 'subagentModelSelectionUnavailable'
  | 'subagentModelSelectionUnavailableGroup' | 'subagentModelSelectionEmpty'
  | 'subagentModelSelectionRequired' | 'subagentModelSelectionConflict' | 'subagentModelSelectionOff'
  | 'purposeRoutes.title' | 'purposeRoutes.description' | 'purposeRoutes.appliesNextDelegation' | 'purposeRoutes.notConfigured'
  | 'purposeRoutes.primary' | 'purposeRoutes.addReviewer' | 'purposeRoutes.removeReviewer'
  | 'purposeRoutes.moveEarlier' | 'purposeRoutes.moveLater'
  | 'purposeRoutes.provider' | 'purposeRoutes.model' | 'purposeRoutes.effort'
  | 'purposeRoutes.chooseProvider' | 'purposeRoutes.chooseModel' | 'purposeRoutes.chooseEffort'
  | 'purposeRoutes.slot.light.label' | 'purposeRoutes.slot.light.hint'
  | 'purposeRoutes.slot.medium.label' | 'purposeRoutes.slot.medium.hint'
  | 'purposeRoutes.slot.deep.label' | 'purposeRoutes.slot.deep.hint'
  | 'purposeRoutes.slot.review.label' | 'purposeRoutes.slot.review.hint'
  | 'purposeRoutes.slot.writing.label' | 'purposeRoutes.slot.writing.hint'
  | 'purposeRoutes.slot.default.label' | 'purposeRoutes.slot.default.hint'
  | 'purposeRoutes.errors.duplicateRoute' | 'purposeRoutes.errors.effortUnsupported'
  | 'purposeRoutes.errors.missingRoute' | 'purposeRoutes.errors.extraRoute'
  | 'purposeRoutes.warnings.providerUnavailable' | 'purposeRoutes.emptySlot'

/** English copy. */
export const en: Record<SubagentSettingsLocaleKey, string> = {
  overridden: 'Overridden',
  reset: 'Reset to default',
  readOnly: 'This deployment stores settings read-only.',
  unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
  save: 'Save',
  saving: 'Saving…',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
  subagentTitle: 'Subagent',
  subagentDescription: 'Set Subagent recursion depth, count, models, and purpose routes.',
  subagentLimitsTitle: 'Limits',
  subagentMaxDepth: 'Maximum recursion depth',
  subagentDepthHelpLabel: 'About maximum recursion depth',
  subagentDepthHelp: 'Limits how many levels of Subagents an Agent can create.',
  subagentDepthZero: 'Disable Subagents',
  subagentDepthOne: 'Only the main Agent can create Subagents',
  subagentDepthOverride: 'If a tool defines its own maximum recursion depth, that setting takes precedence.',
  subagentMaxActive: 'Subagent parallelism limit',
  subagentCapacityHelpLabel: 'About the Subagent parallelism limit',
  subagentCapacityHelp: 'Total live Subagents under the same main Agent, across all recursion levels. The main Agent is excluded. New start requests are rejected when the limit is reached.',
  subagentDepthInvalid: 'Enter a whole number of 0 or more.',
  subagentCapacityInvalid: 'Enter a whole number of 1 or more.',
  subagentModelSelectionTitle: 'Model selection',
  subagentModelSelectionToggle: 'Allow agents to choose models for Subagents',
  subagentModelSelectionChoose: 'When enabled, agents can choose a provider, model, and reasoning effort for each Subagent from the authorized models below. Applies only to new sessions.',
  subagentModelSelectionAllowed: 'Models agents may choose',
  subagentModelSelectionLoading: 'Loading models…',
  subagentModelSelectionLoadFailed: 'Models could not be loaded.',
  subagentModelSelectionRetry: 'Retry',
  subagentModelSelectionPartial: 'Some model providers could not be loaded; saved choices remain removable.',
  subagentModelSelectionUnavailable: 'Currently unavailable',
  subagentModelSelectionUnavailableGroup: 'Saved but currently unavailable',
  subagentModelSelectionEmpty: 'No model provider currently advertises a model.',
  subagentModelSelectionRequired: 'Select at least one model before saving.',
  subagentModelSelectionConflict: 'Settings changed elsewhere. Discard your draft and try again.',
  subagentModelSelectionOff: 'Subagents use configured defaults or inherit the parent agent\'s model. Saved model choices are retained.',
  'purposeRoutes.title': 'Purpose routes',
  'purposeRoutes.description': 'Model authorization still applies only to a newly composed session.',
  'purposeRoutes.appliesNextDelegation': 'A saved table applies on the next delegation.',
  'purposeRoutes.notConfigured': 'This deployment has no purpose routing table.',
  'purposeRoutes.primary': 'Route',
  'purposeRoutes.addReviewer': 'Add reviewer',
  'purposeRoutes.removeReviewer': 'Remove reviewer',
  'purposeRoutes.moveEarlier': 'Move earlier',
  'purposeRoutes.moveLater': 'Move later',
  'purposeRoutes.provider': 'Provider',
  'purposeRoutes.model': 'Model',
  'purposeRoutes.effort': 'Reasoning effort',
  'purposeRoutes.chooseProvider': 'Choose a provider',
  'purposeRoutes.chooseModel': 'Choose a model',
  'purposeRoutes.chooseEffort': 'Choose an effort',
  'purposeRoutes.slot.light.label': 'Light',
  'purposeRoutes.slot.light.hint': 'Quick lookups, small edits, and short summaries.',
  'purposeRoutes.slot.medium.label': 'Standard',
  'purposeRoutes.slot.medium.hint': 'Ordinary implementation or investigation.',
  'purposeRoutes.slot.deep.label': 'Deep',
  'purposeRoutes.slot.deep.hint': 'Hard debugging, design, or long reasoning.',
  'purposeRoutes.slot.review.label': 'Review',
  'purposeRoutes.slot.review.hint': 'Independent review. Several reviewers can run together.',
  'purposeRoutes.slot.writing.label': 'Writing',
  'purposeRoutes.slot.writing.hint': 'Documentation, pull requests, issues, and other prose.',
  'purposeRoutes.slot.default.label': 'Default',
  'purposeRoutes.slot.default.hint': 'Used when a delegation does not name a purpose.',
  'purposeRoutes.errors.duplicateRoute': 'This route is already listed for this purpose.',
  'purposeRoutes.errors.effortUnsupported': 'This model does not offer that effort.',
  'purposeRoutes.errors.missingRoute': 'Choose a provider, model, and effort.',
  'purposeRoutes.errors.extraRoute': 'This purpose accepts one route.',
  'purposeRoutes.warnings.providerUnavailable': 'Saved but currently unavailable. A later login can still use this route.',
  'purposeRoutes.emptySlot': 'No route is set for this purpose.',
}

/** Simplified Chinese copy. */
export const zh: Record<SubagentSettingsLocaleKey, string> = {
  overridden: '已覆盖',
  reset: '恢复默认',
  readOnly: '本部署的设置为只读。',
  unavailable: '该插件当前未加载，暂时无法配置。',
  save: '保存',
  saving: '保存中…',
  saveFailed: '本部署没有接受这些值，已保留供你修改。',
  subagentTitle: '子智能体',
  subagentDescription: '设置子智能体的递归层级、数量、模型和用途路由。',
  subagentLimitsTitle: '运行限制',
  subagentMaxDepth: '最大递归深度',
  subagentDepthHelpLabel: '最大递归深度说明',
  subagentDepthHelp: '限制 Agent 创建子智能体的递归层级。',
  subagentDepthZero: '禁用子智能体',
  subagentDepthOne: '仅允许主 Agent 创建子智能体',
  subagentDepthOverride: '如果某个工具单独设置了最大递归深度，以该工具的设置为准。',
  subagentMaxActive: '子智能体并行数量上限',
  subagentCapacityHelpLabel: '子智能体并行数量上限说明',
  subagentCapacityHelp: '同一主 Agent 下，所有递归层级同时存活的子智能体总数，主 Agent 不计入。达到上限时，新的启动请求会被拒绝。',
  subagentDepthInvalid: '请输入不小于 0 的整数。',
  subagentCapacityInvalid: '请输入不小于 1 的整数。',
  subagentModelSelectionTitle: '模型选择',
  subagentModelSelectionToggle: '允许 Agent 为子智能体选择模型',
  subagentModelSelectionChoose: '开启后，Agent 可以从下方授权模型中，为每个子智能体选择提供方、模型和推理强度。仅影响新会话。',
  subagentModelSelectionAllowed: 'Agent 可选择的模型',
  subagentModelSelectionLoading: '正在加载模型…',
  subagentModelSelectionLoadFailed: '无法加载模型。',
  subagentModelSelectionRetry: '重试',
  subagentModelSelectionPartial: '部分模型提供方暂时无法加载；已保存的选择仍可移除。',
  subagentModelSelectionUnavailable: '当前不可用',
  subagentModelSelectionUnavailableGroup: '已保存但当前不可用',
  subagentModelSelectionEmpty: '当前没有模型提供方公布模型。',
  subagentModelSelectionRequired: '保存前请至少选择一个模型。',
  subagentModelSelectionConflict: '设置已在其他位置更新。请放弃修改后重试。',
  subagentModelSelectionOff: '关闭后，子智能体使用配置的默认模型或继承父 Agent 的模型；已选模型会保留。',
  'purposeRoutes.title': '用途路由',
  'purposeRoutes.description': '模型授权仍只作用于新组成的会话',
  'purposeRoutes.appliesNextDelegation': '保存后的路由表在下次委派时生效',
  'purposeRoutes.notConfigured': '本部署没有用途路由表',
  'purposeRoutes.primary': '路由',
  'purposeRoutes.addReviewer': '添加审阅者',
  'purposeRoutes.removeReviewer': '移除审阅者',
  'purposeRoutes.moveEarlier': '上移',
  'purposeRoutes.moveLater': '下移',
  'purposeRoutes.provider': '提供方',
  'purposeRoutes.model': '模型',
  'purposeRoutes.effort': '推理强度',
  'purposeRoutes.chooseProvider': '选择提供方',
  'purposeRoutes.chooseModel': '选择模型',
  'purposeRoutes.chooseEffort': '选择推理强度',
  'purposeRoutes.slot.light.label': '轻量',
  'purposeRoutes.slot.light.hint': '快速查找、小改动和短摘要',
  'purposeRoutes.slot.medium.label': '标准',
  'purposeRoutes.slot.medium.hint': '常规实现或调查',
  'purposeRoutes.slot.deep.label': '深入',
  'purposeRoutes.slot.deep.hint': '困难调试、设计或长推理',
  'purposeRoutes.slot.review.label': '审阅',
  'purposeRoutes.slot.review.hint': '独立审阅，可以同时启动多名审阅者',
  'purposeRoutes.slot.writing.label': '写作',
  'purposeRoutes.slot.writing.hint': '文档、拉取请求、议题和其他面向读者的文字',
  'purposeRoutes.slot.default.label': '默认',
  'purposeRoutes.slot.default.hint': '委派未指定用途时使用',
  'purposeRoutes.errors.duplicateRoute': '同一用途中已有这条路由',
  'purposeRoutes.errors.effortUnsupported': '所选模型不提供这个推理强度',
  'purposeRoutes.errors.missingRoute': '请选择提供方、模型和推理强度',
  'purposeRoutes.errors.extraRoute': '此用途只能有一条路由',
  'purposeRoutes.warnings.providerUnavailable': '已保存但当前不可用，登录后仍可使用',
  'purposeRoutes.emptySlot': '此用途还没有路由',
}

/**
 * The form frame's copy, read from this page's dictionary.
 * @param t - the page's locale reader.
 * @returns the labels the shared settings form renders.
 */
export function formLabels(t: (key: SubagentSettingsLocaleKey) => string): SettingsFormLabels {
  return { unavailable: t('unavailable'), readOnly: t('readOnly'), saveFailed: t('saveFailed'), save: t('save'), saving: t('saving') }
}
