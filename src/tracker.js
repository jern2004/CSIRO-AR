// src/tracker.js
const DEFAULTS = {
  wasmUrl: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm',
  modelAssetPath:
    'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task',
  maxFps: 30,
  video: {
    width: 960,
    height: 540,
    facingMode: 'user'
  },
  numHands: 1
}

export async function initGestureRecognizer(videoEl, options) {
  const callbacks = typeof options === 'function' ? { onResult: options } : options ?? {}
  const {
    onResult,
    onError,
    onStatus,
    config: userConfig = {}
  } = callbacks

  const config = {
    ...DEFAULTS,
    ...userConfig,
    video: {
      ...DEFAULTS.video,
      ...(userConfig.video ?? {})
    }
  }

  const signalError = err => {
    onStatus?.('error', err)
    onError?.(err)
  }

  let stream
  try {
    const constraints = {
      audio: false,
      video: {
        width: config.video.width,
        height: config.video.height,
        facingMode: config.video.facingMode,
        frameRate: config.maxFps
      }
    }
    stream = await navigator.mediaDevices.getUserMedia(constraints)
  } catch (err) {
    signalError({ type: 'camera', error: err })
    throw err
  }

  videoEl.srcObject = stream
  videoEl.muted = true
  videoEl.playsInline = true
  onStatus?.('camera-streaming')

  try {
    await videoEl.play()
  } catch (err) {
    signalError({ type: 'video-play', error: err })
    throw err
  }

  const { FilesetResolver, GestureRecognizer } = window
  if (!FilesetResolver || !GestureRecognizer) {
    const err = new Error('MediaPipe vision_bundle is not loaded')
    signalError({ type: 'bundle-missing', error: err })
    throw err
  }

  let vision
  try {
    vision = await FilesetResolver.forVisionTasks(config.wasmUrl)
  } catch (err) {
    signalError({ type: 'wasm-load', error: err })
    throw err
  }

  let recognizer
  try {
    recognizer = await GestureRecognizer.createFromOptions(vision, {
      baseOptions: { modelAssetPath: config.modelAssetPath },
      runningMode: 'VIDEO',
      numHands: config.numHands
    })
  } catch (err) {
    signalError({ type: 'model-load', error: err })
    throw err
  }

  onStatus?.('recognizer-ready')

  const useRVFC = typeof videoEl.requestVideoFrameCallback === 'function'
  const minFrameDelta = config.maxFps > 0 ? 1000 / config.maxFps : 0
  let lastTimestamp = 0
  let running = true
  let frameHandle = null

  const normalizeResult = result => {
    const hands = []
    const landmarksList = result?.landmarks ?? result?.handLandmarks ?? []
    const handednesses = result?.handednesses ?? []
    const gestures = result?.gestures ?? []

    const count = Math.max(landmarksList.length, handednesses.length, gestures.length)
    for (let i = 0; i < count; i += 1) {
      const lmRaw = landmarksList[i] ?? []
      const lm = Array.isArray(lmRaw) ? lmRaw : Array.from(lmRaw ?? [])
      const handedness = handednesses[i]?.[0]?.categoryName ?? null
      const gestureCategory = gestures[i]?.[0]?.categoryName ?? null
      const gestureScore = gestures[i]?.[0]?.score
      hands.push({
        landmarks: lm,
        handedness,
        category: gestureCategory ?? null,
        score: typeof gestureScore === 'number' ? gestureScore : null
      })
    }
    return { hands }
  }

  const deliverResult = (result, ts, metadata) => {
    try {
      onResult?.(result, ts, metadata)
    } catch (err) {
      signalError({ type: 'result-handler', error: err })
    }
  }

  const recognizeFrame = (timestampMs, metadata) => {
    if (!running) return
    if (minFrameDelta && timestampMs - lastTimestamp < minFrameDelta - 1) {
      scheduleNext()
      return
    }
    lastTimestamp = timestampMs
    try {
      const result = recognizer.recognizeForVideo(videoEl, timestampMs)
      const payload = normalizeResult(result)
      deliverResult(payload, timestampMs, metadata)
    } catch (err) {
      signalError({ type: 'recognize', error: err })
    }
    scheduleNext()
  }

  const scheduleNext = () => {
    if (!running) return
    if (useRVFC) {
      frameHandle = videoEl.requestVideoFrameCallback((now, metadata) => {
        const ts = metadata?.mediaTime ? metadata.mediaTime * 1000 : now
        recognizeFrame(ts, metadata)
      })
    } else {
      frameHandle = requestAnimationFrame(now => recognizeFrame(now))
    }
  }

  scheduleNext()

  const stop = () => {
    running = false
    if (useRVFC && frameHandle !== null && videoEl.cancelVideoFrameCallback) {
      videoEl.cancelVideoFrameCallback(frameHandle)
    } else if (!useRVFC && frameHandle !== null) {
      cancelAnimationFrame(frameHandle)
    }
    try {
      recognizer.close()
    } catch {}
    const tracks = stream?.getTracks?.() ?? []
    tracks.forEach(track => track.stop())
    videoEl.srcObject = null
    onStatus?.('stopped')
  }

  return stop
}
