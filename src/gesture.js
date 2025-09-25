// src/gesture.js
const NAME_TO_LABEL = {
  Thumb_Up: 'up',
  Thumb_Down: 'down'
}

const BASE_DENY = new Set(['None', 'Closed_Fist', 'Open_Palm', 'Victory', 'Thumb_Up_Left', 'Thumb_Down_Left'])

const DEFAULT_MIN_SCORE = 0.6
const DEFAULT_MIN_SCORE_BY_CATEGORY = {
  Thumb_Up: 0.65,
  Thumb_Down: 0.65
}

export function mapCategoryToLabel(categoryName) {
  if (!categoryName) return 'neutral'
  return NAME_TO_LABEL[categoryName] ?? 'neutral'
}

export function extractTopCategory(result) {
  const gestureLists = result?.gestures
  if (!gestureLists || !gestureLists.length) return null
  const primary = gestureLists[0]
  if (!primary || !primary.length) return null
  return primary[0] ?? null
}

export function normalizeGesture(category, options = {}) {
  const name = category?.categoryName ?? null
  const score = category?.score ?? 0

  const deny = new Set([...(options.denyList ?? []), ...BASE_DENY])
  if (!name) {
    return { label: 'neutral', name: null, score, accepted: false, reason: 'missing-name' }
  }
  if (deny.has(name)) {
    return { label: 'neutral', name, score, accepted: false, reason: 'deny-list' }
  }

  const minScoreByCategory = {
    ...DEFAULT_MIN_SCORE_BY_CATEGORY,
    ...(options.minScoreByCategory ?? {})
  }
  const minScore = minScoreByCategory[name] ?? options.minScore ?? DEFAULT_MIN_SCORE
  if (score < minScore) {
    return {
      label: 'neutral',
      name,
      score,
      accepted: false,
      reason: 'below-threshold',
      minScore
    }
  }

  const label = NAME_TO_LABEL[name] ?? 'neutral'
  if (label === 'neutral') {
    return { label: 'neutral', name, score, accepted: false, reason: 'not-mapped' }
  }
  return { label, name, score, accepted: true, reason: 'accepted' }
}

export const DEFAULT_DENY_LIST = [...BASE_DENY]
export const DEFAULT_MIN_SCORE_SETTINGS = {
  minScore: DEFAULT_MIN_SCORE,
  minScoreByCategory: { ...DEFAULT_MIN_SCORE_BY_CATEGORY }
}
