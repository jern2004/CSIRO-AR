// src/features.js
export class FeatureAccumulator {
  constructor(windowMs = 1200) {
    this.windowMs = windowMs
    this.samples = []
  }

  setWindow(windowMs) {
    this.windowMs = windowMs
  }

  capture(result, timestamp) {
    const hand = result?.hands?.find(h => (h?.landmarks?.length ?? 0) > 0)
    const normalized = hand?.landmarks
    if (!normalized || !normalized.length) return

    const thumbTip = normalized[4]
    const wrist = normalized[0]
    if (!thumbTip || !wrist) return

    const dx = thumbTip.x - wrist.x
    const dy = thumbTip.y - wrist.y
    const dz = (thumbTip.z ?? 0) - (wrist.z ?? 0)
    const distance = Math.hypot(dx, dy, dz)

    this.samples.push({
      timestamp,
      distance,
      thumbY: thumbTip.y,
      wristY: wrist.y
    })

    this.prune(timestamp - this.windowMs)
  }

  prune(minTimestamp) {
    if (!this.samples.length) return
    while (this.samples.length && this.samples[0].timestamp < minTimestamp) {
      this.samples.shift()
    }
  }

  summarize(windowStart) {
    if (!this.samples.length) {
      return zeroFeatures()
    }

    const start = windowStart ?? (this.samples[this.samples.length - 1].timestamp - this.windowMs)
    this.prune(start)

    const windowed = this.samples.filter(sample => sample.timestamp >= start)
    if (!windowed.length) {
      return zeroFeatures()
    }

    const distances = windowed.map(s => s.distance)
    const amplitude = Math.max(...distances) - Math.min(...distances)
    const mean = distances.reduce((acc, v) => acc + v, 0) / distances.length
    const variance = distances.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / distances.length
    const jitter = Math.sqrt(Math.max(variance, 0))
    const stabilityBase = amplitude > 0 ? Math.max(0, 1 - jitter / amplitude) : 0

    const repetitions = countRepetitions(windowed)

    return {
      amplitude: Number(amplitude.toFixed(4)),
      jitter: Number(jitter.toFixed(4)),
      stability: Number(stabilityBase.toFixed(4)),
      repetitions
    }
  }
}

function zeroFeatures() {
  return {
    amplitude: 0,
    jitter: 0,
    stability: 0,
    repetitions: 0
  }
}

function countRepetitions(samples) {
  if (samples.length < 3) return 0
  let reps = 0
  let prevDelta = 0
  for (let i = 1; i < samples.length; i += 1) {
    const delta = samples[i].thumbY - samples[i - 1].thumbY
    if (Math.sign(delta) !== Math.sign(prevDelta) && Math.abs(delta) > 0.02 && Math.abs(prevDelta) > 0.02) {
      reps += 1
    }
    if (delta !== 0) prevDelta = delta
  }
  return reps
}
