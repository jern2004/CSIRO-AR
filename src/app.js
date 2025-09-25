// src/app.js
import { initGestureRecognizer } from './tracker.js'
import { normalizeGesture } from './gesture.js'
import { FeatureAccumulator } from './features.js'
import { initHud } from './hud.js'

const DEFAULT_CONFIG = {
  stable_ms: 900,
  debounce_ms: 120,
  reset_ms: 250,
  score_grace_ms: 180,
  score_smoothing: 0.35,
  max_fps: 30,
  min_score: 0.6,
  min_score_by_category: {
    Thumb_Up: 0.65,
    Thumb_Down: 0.65
  },
  deny_list: [],
  empty_gesture_timeout_ms: 1800,
  features: {
    window_ms: 1200
  },
  backend: {
    log_endpoint: '/api/log'
  },
  video: {
    width: 960,
    height: 540,
    facingMode: 'user'
  },
  participant_id: null,
  session_id: null,
  item_id: null
}

const $ = sel => document.querySelector(sel)

const els = {
  video: $('#cam'),
  hudCanvas: $('#hud'),
  statusGesture: $('#status-gesture'),
  statusHold: $('#status-hold'),
  statusConf: $('#status-conf'),
  ring: $('#ring'),
  ringProgress: document.querySelector('.ring-progress'),
  starFlash: $('#starFlash'),
  btnUp: $('#btn-up'),
  btnDown: $('#btn-down'),
  btnNeutral: $('#btn-neutral'),
  toggleLandmarks: $('#toggle-landmarks')
}

let ringVisible = false
const RING_LEN = 339.292
let hud = null
let showLandmarks = true

function ringShow() {
  if (ringVisible) return
  ringVisible = true
  els.ring.classList.add('show')
}

function ringHide() {
  if (!ringVisible) return
  ringVisible = false
  els.ring.classList.remove('show')
  els.ringProgress.style.strokeDashoffset = RING_LEN
}

function ringTick(ms, duration) {
  const d = Math.max(duration, 1)
  const p = Math.max(0, Math.min(1, ms / d))
  els.ringProgress.style.strokeDashoffset = String(RING_LEN * (1 - p))
}

function flashStars() {
  els.starFlash.classList.remove('show')
  void els.starFlash.offsetWidth
  els.starFlash.classList.add('show')
}

const state = {
  config: { ...DEFAULT_CONFIG },
  frame: {
    label: 'neutral',
    since: performance.now(),
    score: 0,
    name: null,
    reason: 'init'
  },
  candidate: {
    label: 'neutral',
    since: performance.now(),
    score: 0,
    name: null,
    accepted: false
  },
  holdMs: 0,
  awaitingReset: false,
  resetSince: null,
  lastCommit: null,
  noGestureSince: null,
  trialMeta: {
    trial: 0,
    participant_id: null,
    session_id: null,
    item_id: null,
    probe_shown: false,
    probeShownAt: null,
    implicit_conf: null,
    explicit_conf: null
  },
  stopRecognizer: null
}

let featureTracker = new FeatureAccumulator(DEFAULT_CONFIG.features.window_ms)

function mergeConfig(base, override) {
  if (!override) return { ...base }
  const merged = { ...base, ...override }
  merged.video = { ...base.video, ...(override.video ?? {}) }
  merged.min_score_by_category = {
    ...base.min_score_by_category,
    ...(override.min_score_by_category ?? {})
  }
  merged.features = { ...base.features, ...(override.features ?? {}) }
  merged.backend = { ...base.backend, ...(override.backend ?? {}) }
  return merged
}

async function loadConfig() {
  try {
    const res = await fetch('/config.json', { cache: 'no-store' })
    if (res.ok) {
      const payload = await res.json()
      state.config = mergeConfig(DEFAULT_CONFIG, payload)
      const maxFpsOverride = payload.max_fps ?? payload.maxFps
      if (Number.isFinite(maxFpsOverride)) {
        state.config.max_fps = maxFpsOverride
      }
    } else {
      state.config = { ...DEFAULT_CONFIG }
    }
  } catch (err) {
    console.warn('config.json unavailable, using defaults', err)
    state.config = { ...DEFAULT_CONFIG }
  }

  if (!state.config.features) state.config.features = { ...DEFAULT_CONFIG.features }
  if (!Number.isFinite(state.config.features.window_ms)) {
    state.config.features.window_ms = DEFAULT_CONFIG.features.window_ms
  }
  if (!Number.isFinite(state.config.max_fps)) state.config.max_fps = DEFAULT_CONFIG.max_fps
  if (!Number.isFinite(state.config.score_smoothing)) state.config.score_smoothing = DEFAULT_CONFIG.score_smoothing
  if (!Number.isFinite(state.config.score_grace_ms)) state.config.score_grace_ms = DEFAULT_CONFIG.score_grace_ms
  if (!Number.isFinite(state.config.debounce_ms)) state.config.debounce_ms = DEFAULT_CONFIG.debounce_ms
  if (!Number.isFinite(state.config.reset_ms)) state.config.reset_ms = DEFAULT_CONFIG.reset_ms
  if (!Number.isFinite(state.config.stable_ms)) state.config.stable_ms = DEFAULT_CONFIG.stable_ms
  if (!Array.isArray(state.config.deny_list)) state.config.deny_list = [...DEFAULT_CONFIG.deny_list]
  if (!Number.isFinite(state.config.min_score)) state.config.min_score = DEFAULT_CONFIG.min_score
  state.config.min_score_by_category = {
    ...DEFAULT_CONFIG.min_score_by_category,
    ...(state.config.min_score_by_category ?? {})
  }

  featureTracker = new FeatureAccumulator(state.config.features.window_ms)

  state.trialMeta.participant_id = state.config.participant_id
  state.trialMeta.session_id = state.config.session_id
  state.trialMeta.item_id = state.config.item_id
}

function mix(current, next, alpha) {
  if (!Number.isFinite(current)) return next
  return current + alpha * (next - current)
}

function updateStatusPanel(label, holdMs, score) {
  els.statusGesture.textContent = label
  els.statusHold.textContent = String(Math.max(0, Math.round(holdMs)))
  els.statusConf.textContent = score.toFixed(2)
}

function getDisplayLabel(now) {
  if (state.noGestureSince && now - state.noGestureSince > state.config.empty_gesture_timeout_ms) {
    return 'no hand'
  }
  return state.candidate.label
}

function renderHUD(now) {
  const label = getDisplayLabel(now)
  const holdMs = state.awaitingReset ? 0 : state.holdMs
  const score = state.candidate.score ?? state.frame.score ?? 0
  updateStatusPanel(label, holdMs, score)

  if (!state.awaitingReset && state.candidate.label !== 'neutral') {
    ringShow()
    ringTick(holdMs, state.config.stable_ms)
  } else {
    ringHide()
  }
}

function pickTopGesture(hands) {
  if (!Array.isArray(hands) || !hands.length) return null
  let best = null
  hands.forEach(hand => {
    if (!hand?.category) return
    const score = typeof hand?.score === 'number' ? hand.score : null
    if (!Number.isFinite(score)) return
    if (!best || score > best.score) {
      best = {
        categoryName: hand.category,
        score,
        handedness: hand.handedness ?? null
      }
    }
  })
  return best
}

function handleCommit(timestampMs) {
  const label = state.candidate.label
  const holdMs = state.holdMs
  const packet = buildTrialPacket({
    label,
    start: state.candidate.since,
    end: timestampMs,
    holdMs
  })

  state.awaitingReset = true
  state.resetSince = null
  state.lastCommit = { label, at: timestampMs }
  state.holdMs = 0

  flashStars()
  ringHide()
  sendLog(packet)
}

function buildTrialPacket({ label, start, end, holdMs }) {
  const features = featureTracker.summarize(end - state.config.features.window_ms)
  const trialMeta = state.trialMeta
  const rtOrigin = trialMeta.probeShownAt ?? start
  const rtMs = Math.max(0, Math.round(end - rtOrigin))
  const holdRounded = Math.max(0, Math.round(holdMs))

  trialMeta.trial += 1
  const packet = {
    participant_id: trialMeta.participant_id ?? state.config.participant_id ?? null,
    session_id: trialMeta.session_id ?? state.config.session_id ?? null,
    trial: trialMeta.trial,
    item_id: trialMeta.item_id ?? state.config.item_id ?? null,
    gesture: label,
    t_start: start,
    t_end: end,
    rt_ms: rtOrigin ? rtMs : null,
    hold_ms: holdRounded,
    amplitude: features.amplitude,
    jitter: features.jitter,
    stability: features.stability,
    repetitions: features.repetitions,
    implicit_conf: trialMeta.implicit_conf,
    probe_shown: trialMeta.probe_shown,
    explicit_conf: trialMeta.explicit_conf
  }

  trialMeta.probe_shown = false
  trialMeta.probeShownAt = null
  trialMeta.implicit_conf = null
  trialMeta.explicit_conf = null

  return packet
}

async function sendLog(packet) {
  try {
    const res = await fetch(state.config.backend.log_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(packet)
    })
    if (!res.ok) {
      console.warn('log endpoint responded with', res.status)
    }
  } catch (err) {
    console.warn('failed to log trial packet', err)
  }
}

function updateTrialMeta(partial) {
  Object.assign(state.trialMeta, partial)
  if (partial.probe_shown) {
    state.trialMeta.probeShownAt = performance.now()
  }
}

function updateLiveState(entry, now) {
  if (entry.name) {
    state.noGestureSince = null
  } else if (!state.noGestureSince) {
    state.noGestureSince = now
  }

  const smoothing = state.config.score_smoothing
  const prevFrame = state.frame
  let frameLabel = prevFrame.label
  let frameSince = prevFrame.since ?? now
  let frameScore = prevFrame.score ?? entry.score

  if (entry.label !== frameLabel) {
    frameLabel = entry.label
    frameSince = now
    frameScore = entry.score
  } else {
    frameScore = mix(frameScore, entry.score, smoothing)
  }

  state.frame = {
    label: frameLabel,
    since: frameSince,
    score: frameScore,
    name: entry.name,
    reason: entry.reason
  }

  const timeInFrame = now - frameSince
  const needsGrace =
    frameLabel === 'neutral' &&
    state.candidate.label !== 'neutral' &&
    ['below-threshold', 'missing-name', 'deny-list', 'no-gesture'].includes(entry.reason)
  const transitionThreshold = needsGrace
    ? state.config.score_grace_ms
    : state.config.debounce_ms

  if (frameLabel !== state.candidate.label) {
    if (timeInFrame >= transitionThreshold) {
      state.candidate = {
        label: frameLabel,
        since: frameSince,
        score: entry.score,
        name: entry.name,
        accepted: entry.accepted
      }
    }
  } else {
    state.candidate.score = mix(state.candidate.score, entry.score, smoothing)
    state.candidate.name = entry.name
    state.candidate.accepted = entry.accepted
  }

  if (state.candidate.label === 'neutral') {
    state.holdMs = 0
  } else if (state.awaitingReset) {
    state.holdMs = 0
  } else {
    state.holdMs = now - state.candidate.since
  }

  if (state.awaitingReset) {
    if (state.candidate.label === 'neutral') {
      if (!state.resetSince) state.resetSince = now
      if (now - state.resetSince >= state.config.reset_ms) {
        state.awaitingReset = false
        state.resetSince = null
      }
    } else {
      state.resetSince = null
    }
  }

  if (!state.awaitingReset && state.candidate.accepted && state.candidate.label !== 'neutral') {
    if (state.holdMs >= state.config.stable_ms) {
      handleCommit(now)
    }
  }
}

function handleRecognizerResult(result, timestampMs) {
  const now = typeof timestampMs === 'number' ? timestampMs : performance.now()
  const hands = result?.hands ?? []

  hud?.drawHands(hands, showLandmarks)
  featureTracker.capture(result, now)

  const topCategory = pickTopGesture(hands)
  if (!topCategory) {
    const entry = {
      label: 'neutral',
      name: null,
      score: 0,
      accepted: false,
      reason: hands.length ? 'no-gesture' : 'no-gesture'
    }
    updateLiveState(entry, now)
    renderHUD(now)
    return
  }

  const normalized = normalizeGesture({
    categoryName: topCategory.categoryName,
    score: topCategory.score
  }, {
    minScore: state.config.min_score,
    minScoreByCategory: state.config.min_score_by_category,
    denyList: state.config.deny_list
  })

  const entry = {
    label: normalized.label,
    name: normalized.name ?? topCategory.categoryName,
    score: topCategory.score ?? 0,
    accepted: normalized.accepted,
    reason: normalized.reason
  }

  updateLiveState(entry, now)
  renderHUD(now)
}

function handleRecognizerError(detail) {
  console.error('gesture recognizer error', detail)
  els.statusGesture.textContent = detail?.type === 'camera' ? 'camera blocked' : 'recognizer error'
  ringHide()
}

function handleRecognizerStatus(status) {
  if (status === 'camera-streaming') {
    els.statusGesture.textContent = 'initializing'
  }
  if (status === 'recognizer-ready') {
    els.statusGesture.textContent = 'neutral'
  }
  if (status === 'stopped') {
    els.statusGesture.textContent = 'stopped'
  }
}

function simulate(label) {
  const now = performance.now()
  state.awaitingReset = false
  state.candidate = {
    label,
    since: now - state.config.stable_ms,
    score: 1,
    name: label,
    accepted: label !== 'neutral'
  }
  state.holdMs = state.config.stable_ms
  renderHUD(now)
  handleCommit(now)
}

function wireSim() {
  els.btnUp?.addEventListener('click', () => simulate('up'))
  els.btnDown?.addEventListener('click', () => simulate('down'))
  els.btnNeutral?.addEventListener('click', () => simulate('neutral'))
  window.addEventListener('keydown', e => {
    if (e.key === '1') simulate('up')
    if (e.key === '2') simulate('down')
    if (e.key === '3') simulate('neutral')
  })

  const toggle = els.toggleLandmarks
  if (toggle) {
    const updateLabel = () => {
      toggle.textContent = showLandmarks ? 'Hide Landmarks' : 'Show Landmarks'
    }
    updateLabel()
    toggle.addEventListener('click', () => {
      showLandmarks = !showLandmarks
      updateLabel()
      if (!showLandmarks) {
        hud?.clear()
      }
    })
  }
}

async function main() {
  hud = initHud(els.hudCanvas)
  wireSim()
  await loadConfig()

  try {
    const stop = await initGestureRecognizer(els.video, {
      onResult: handleRecognizerResult,
      onError: handleRecognizerError,
      onStatus: handleRecognizerStatus,
      config: {
        maxFps: state.config.max_fps,
        video: state.config.video
      }
    })
    state.stopRecognizer = stop
  } catch (err) {
    console.error('failed to start recognizer', err)
  }
}

document.addEventListener('DOMContentLoaded', main)

export { sendLog, updateTrialMeta }
