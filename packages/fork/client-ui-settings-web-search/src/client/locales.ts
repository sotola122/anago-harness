/** Locale bundles for the Exa and Brave web-search settings cards. */

import type { SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { BraveSafeSearch, ExaSearchType } from './web-search-provider-card-controller.ts'

/** Locale keys the cards render. */
export type WebSearchProvidersLocaleKey =
  | 'titleExa' | 'titleBrave' | 'descriptionExa' | 'descriptionBrave'
  | 'enabledExa' | 'enabledBrave' | 'switchHint' | 'switchUnavailable'
  | 'apiKey' | 'apiKeyHintExa' | 'apiKeyHintBrave' | 'apiKeySet' | 'apiKeyUnset'
  | 'searchType' | 'searchTypeHint' | 'invalidSearchType' | 'numResults' | 'numResultsHint' | 'invalidNumResults'
  | 'maxResults' | 'maxResultsHint' | 'invalidMaxResults'
  | 'safesearch' | 'safesearchHint' | 'invalidSafesearch'
  | 'searchTypeAuto' | 'searchTypeKeyword' | 'searchTypeNeural'
  | 'safesearchOff' | 'safesearchModerate' | 'safesearchStrict'
  | 'overridden' | 'reset' | 'readOnly' | 'unavailable' | 'save' | 'saving' | 'saveFailed'

/** English copy. */
export const en: Record<WebSearchProvidersLocaleKey, string> = {
  titleExa: 'Exa search',
  titleBrave: 'Brave Search',
  descriptionExa: 'Set up Exa as the web-search provider.',
  descriptionBrave: 'Set up Brave Search as the web-search provider.',
  enabledExa: 'Use Exa for web search',
  enabledBrave: 'Use Brave for web search',
  switchHint: 'The two providers are exclusive; saving writes this choice to the web service.',
  switchUnavailable: 'The web service is not loaded, so the provider selection cannot be changed right now.',
  apiKey: 'API key',
  apiKeyHintExa: 'Stored outside the settings file. Leave blank to keep the current key. Create one at https://dashboard.exa.ai/api-keys.',
  apiKeyHintBrave: 'Stored outside the settings file. Leave blank to keep the current key. Create one at https://api.search.brave.com/app/keys.',
  apiKeySet: 'A key is configured.',
  apiKeyUnset: 'No key is configured.',
  searchType: 'Search type',
  searchTypeHint: 'The retrieval mode Exa uses for each query.',
  invalidSearchType: 'Choose auto, keyword, or neural.',
  numResults: 'Results per search',
  numResultsHint: 'How many results Exa requests per query: a positive integer. Leave blank to use the provider default.',
  invalidNumResults: 'Enter a positive integer, or leave blank to use the default.',
  maxResults: 'Results per search',
  maxResultsHint: 'How many results Brave requests per query: an integer from 1 to 20. Leave blank to use the default.',
  invalidMaxResults: 'Enter an integer from 1 to 20, or leave blank to use the default.',
  safesearch: 'Safe search',
  safesearchHint: 'The content filter Brave applies to results.',
  invalidSafesearch: 'Choose off, moderate, or strict.',
  searchTypeAuto: 'Auto',
  searchTypeKeyword: 'Keyword',
  searchTypeNeural: 'Neural',
  safesearchOff: 'Off',
  safesearchModerate: 'Moderate',
  safesearchStrict: 'Strict',
  overridden: 'Overridden',
  reset: 'Reset to default',
  readOnly: 'This deployment stores settings read-only.',
  unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
  save: 'Save',
  saving: 'Saving…',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
}

/** Simplified Chinese copy. */
export const zh: Record<WebSearchProvidersLocaleKey, string> = {
  titleExa: 'Exa 搜索',
  titleBrave: 'Brave 搜索',
  descriptionExa: '将 Exa 设为网页搜索提供方。',
  descriptionBrave: '将 Brave Search 设为网页搜索提供方。',
  enabledExa: '使用 Exa 进行网页搜索',
  enabledBrave: '使用 Brave 进行网页搜索',
  switchHint: '两个提供方互斥；保存后会把该选择写入网页服务。',
  switchUnavailable: '网页服务未加载，暂时无法更改提供方选择。',
  apiKey: 'API Key',
  apiKeyHintExa: '不写入设置文件。留空表示保持当前密钥。可在 https://dashboard.exa.ai/api-keys 创建。',
  apiKeyHintBrave: '不写入设置文件。留空表示保持当前密钥。可在 https://api.search.brave.com/app/keys 创建。',
  apiKeySet: '已配置密钥。',
  apiKeyUnset: '未配置密钥。',
  searchType: '检索类型',
  searchTypeHint: 'Exa 对每次查询使用的检索模式。',
  invalidSearchType: '请选择自动、关键词或神经网络。',
  numResults: '每次搜索结果数',
  numResultsHint: 'Exa 每次查询请求的结果数，须为正整数；留空表示使用提供方默认值。',
  invalidNumResults: '请填正整数；留空表示使用默认值。',
  maxResults: '每次搜索结果数',
  maxResultsHint: 'Brave 每次查询请求的结果数，须为 1–20 的整数；留空表示使用默认值。',
  invalidMaxResults: '请填 1–20 的整数；留空表示使用默认值。',
  safesearch: '安全搜索',
  safesearchHint: 'Brave 对结果应用的内容过滤级别。',
  invalidSafesearch: '请选择关闭、适中或严格。',
  searchTypeAuto: '自动',
  searchTypeKeyword: '关键词',
  searchTypeNeural: '神经网络',
  safesearchOff: '关闭',
  safesearchModerate: '适中',
  safesearchStrict: '严格',
  overridden: '已覆盖',
  reset: '恢复默认',
  readOnly: '本部署的设置为只读。',
  unavailable: '该插件当前未加载，暂时无法配置。',
  save: '保存',
  saving: '保存中…',
  saveFailed: '本部署没有接受这些值，已保留供你修改。',
}

/** The select options' localized labels, keyed by stored value. */
export const EXA_SEARCH_TYPE_LABELS: Record<ExaSearchType, WebSearchProvidersLocaleKey> = {
  auto: 'searchTypeAuto',
  keyword: 'searchTypeKeyword',
  neural: 'searchTypeNeural',
}

/** The select options' localized labels, keyed by stored value. */
export const BRAVE_SAFESEARCH_LABELS: Record<BraveSafeSearch, WebSearchProvidersLocaleKey> = {
  off: 'safesearchOff',
  moderate: 'safesearchModerate',
  strict: 'safesearchStrict',
}

/**
 * The form frame's copy, read from this package's dictionary.
 * @param t - the cards' locale reader.
 * @returns the labels the shared settings form renders.
 */
export function formLabels(t: (key: WebSearchProvidersLocaleKey) => string): SettingsFormLabels {
  return {
    unavailable: t('unavailable'), readOnly: t('readOnly'), saveFailed: t('saveFailed'),
    save: t('save'), saving: t('saving'),
  }
}
