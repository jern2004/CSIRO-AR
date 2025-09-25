// src/hud.js
const DEFAULT_LEFT_COLOR = '#ff3366'
const DEFAULT_RIGHT_COLOR = '#00b2ff'
const DEFAULT_LINE_WIDTH = 4
const HAND_CONNECTIONS_FALLBACK = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [0, 17]
]

export function initHud(canvas) {
  const ctx = canvas?.getContext?.('2d') ?? null
  if (!canvas || !ctx) {
    return {
      clear() {},
      drawHands() {}
    }
  }

  const ensureSize = () => {
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const renderWidth = Math.max(1, Math.round(rect.width * dpr))
    const renderHeight = Math.max(1, Math.round(rect.height * dpr))
    if (canvas.width !== renderWidth || canvas.height !== renderHeight) {
      canvas.width = renderWidth
      canvas.height = renderHeight
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.scale(dpr, dpr)
    return { width: rect.width || canvas.width, height: rect.height || canvas.height }
  }

  const clear = () => {
    const { width, height } = ensureSize()
    ctx.clearRect(0, 0, width, height)
  }

  const drawingUtils = window.DrawingUtils ? new window.DrawingUtils(ctx) : null

  const drawHands = (hands, show = true) => {
    const surface = ensureSize()
    ctx.clearRect(0, 0, surface.width, surface.height)
    if (!show || !hands?.length) return

    const drawConnectors = window.drawConnectors
    const drawLandmarks = window.drawLandmarks
    const HAND_CONNECTIONS =
      window.GestureRecognizer?.HAND_CONNECTIONS ||
      window.Hands?.HAND_CONNECTIONS ||
      window.HAND_CONNECTIONS ||
      HAND_CONNECTIONS_FALLBACK

    if (!drawingUtils && (!drawConnectors || !drawLandmarks)) {
      return
    }

    const { width, height } = surface

    hands.forEach(hand => {
      const landmarks = Array.isArray(hand?.landmarks) ? hand.landmarks : []
      if (!landmarks.length) return

      const isRight = (hand?.handedness ?? '').toLowerCase() === 'right'
      const strokeStyle = isRight ? DEFAULT_RIGHT_COLOR : DEFAULT_LEFT_COLOR

      let anchorPixel = { x: width * 0.5, y: height * 0.5 }

      if (drawingUtils) {
        drawingUtils.drawConnectors(landmarks, HAND_CONNECTIONS, {
          color: strokeStyle,
          lineWidth: DEFAULT_LINE_WIDTH
        })
        drawingUtils.drawLandmarks(landmarks, {
          color: strokeStyle,
          fillColor: '#fff',
          radius: point => Math.max(3, (point?.z ?? 0) * -10 + 4)
        })
        const anchor = landmarks[0]
        if (anchor) {
          anchorPixel = {
            x: (anchor.x ?? 0.5) * width,
            y: (anchor.y ?? 0.5) * height
          }
        }
      } else {
        const pixels = landmarks.map(l => ({
          x: (l.x ?? 0.5) * width,
          y: (l.y ?? 0.5) * height,
          z: l.z ?? 0
        }))

        drawConnectors(ctx, pixels, HAND_CONNECTIONS, {
          color: strokeStyle,
          lineWidth: DEFAULT_LINE_WIDTH
        })
        drawLandmarks(ctx, pixels, {
          color: strokeStyle,
          fillColor: '#fff',
          radius: point => Math.max(3, (point?.z ?? 0) * -10 + 4)
        })
        if (pixels[0]) {
          anchorPixel = { x: pixels[0].x, y: pixels[0].y }
        }
      }

      if (hand?.handedness || hand?.category) {
        const label = buildLabel(hand)
        if (label) {
          ctx.save()
          ctx.font = '14px "Inter", system-ui, sans-serif'
          ctx.fillStyle = 'rgba(17, 24, 33, 0.75)'
          const padding = 6
          const metrics = ctx.measureText(label)
          const boxWidth = metrics.width + padding * 2
          const boxHeight = 22
          const x = anchorPixel.x - boxWidth / 2
          const y = anchorPixel.y - boxHeight - 10

          ctx.fillStyle = 'rgba(255, 255, 255, 0.88)'
          ctx.strokeStyle = strokeStyle
          ctx.lineWidth = 1
          ctx.fillRect(x, y, boxWidth, boxHeight)
          ctx.strokeRect(x, y, boxWidth, boxHeight)

          ctx.fillStyle = strokeStyle
          ctx.fillText(label, x + padding, y + boxHeight - padding)
          ctx.restore()
        }
      }
    })
  }

  return { clear, drawHands }
}

function buildLabel(hand) {
  const parts = []
  if (hand?.handedness) parts.push(hand.handedness)
  if (hand?.category) {
    const score = typeof hand?.score === 'number' ? hand.score : null
    const suffix = Number.isFinite(score) ? ` (${score.toFixed(2)})` : ''
    parts.push(`${hand.category}${suffix}`)
  }
  return parts.join(' – ')
}
