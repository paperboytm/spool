/* A receipt-like agent Session that is continuously printed from a moving
 * paper roll. The shared atlas is rotated at draw time so every TUI row runs
 * across the paper width while new rows advance along the paper's length.
 * Three.js is loaded only when this closing section approaches the viewport.
 */
import { useEffect, useRef, useState } from 'react'

export const SESSION_TAPE_RECORD = {
  author: '@maya',
  published: 'published 2h ago',
  provider: 'Claude Code',
  visibility: 'Public',
  evidence: 'auth-store.ts · +214 −63 · repeat=5 · 5/5 passed',
  lineage: '@arjun · Codex CLI · from claude_7a55b1ee',
} as const

type TuiLineKind = 'frame' | 'meta' | 'prompt' | 'agent' | 'tool' | 'evidence' | 'lineage'

interface TuiLine {
  text: string
  kind: TuiLineKind
}

const TUI_INNER_COLUMNS = 18

function tuiRow(content: string, kind: TuiLineKind): TuiLine {
  const length = Array.from(content).length
  return {
    text: `│${content}${' '.repeat(Math.max(0, TUI_INNER_COLUMNS - length))}│`,
    kind,
  }
}

function tuiRule(start = '│', end = '│'): TuiLine {
  return { text: `${start}${'─'.repeat(TUI_INNER_COLUMNS)}${end}`, kind: 'frame' }
}

/* Every row is exactly 20 monospace columns. On the atlas, each row is
 * rotated 90°: glyphs cross the paper while rows advance with the feed. */
export const SESSION_TUI_LINES: readonly TuiLine[] = [
  tuiRule('┌', '┐'),
  tuiRow('SESSION · PUBLIC', 'meta'),
  tuiRow('@maya · 2h ago', 'meta'),
  tuiRow('Claude Code', 'meta'),
  tuiRow('auth-refresh', 'meta'),
  tuiRule(),
  tuiRow('PROMPT', 'prompt'),
  tuiRow('> Keep refresh', 'prompt'),
  tuiRow('> single-flight', 'prompt'),
  tuiRow('> when two tabs', 'prompt'),
  tuiRow('> expire together.', 'prompt'),
  tuiRule(),
  tuiRow('CLAUDE CODE', 'agent'),
  tuiRow('Tracing refresh', 'agent'),
  tuiRow('owners + callers.', 'agent'),
  tuiRow('TOOL · SEARCH', 'tool'),
  tuiRow('$ rg refreshToken', 'tool'),
  tuiRow('auth-store.ts:118', 'tool'),
  tuiRule(),
  tuiRow('CLAUDE CODE', 'agent'),
  tuiRow('Lock is per tab.', 'agent'),
  tuiRow('Move ownership', 'agent'),
  tuiRow('to coordinator.', 'agent'),
  tuiRow('TOOL · EDIT', 'tool'),
  tuiRow('auth-store.ts', 'tool'),
  tuiRow('+214  −63', 'evidence'),
  tuiRow('TOOL · VERIFY', 'tool'),
  tuiRow('$ pnpm test auth', 'tool'),
  tuiRow('42 pass · 0 fail', 'evidence'),
  tuiRow('EVIDENCE', 'evidence'),
  tuiRow('repeat5 · 5/5 pass', 'evidence'),
  tuiRow('auth-store.ts', 'evidence'),
  tuiRule(),
  tuiRow('GOAL REACHED', 'evidence'),
  tuiRow('turn 14 · Public', 'evidence'),
  tuiRow('LINEAGE', 'lineage'),
  tuiRow('continued by', 'lineage'),
  tuiRow('@arjun · Codex CLI', 'lineage'),
  tuiRow('from claude_7a55b1', 'lineage'),
  tuiRule('└', '┘'),
]

/* 4096 / 560 keeps paper-width / roll-radius at ~.86, matching the
 * broad, recognisable paper-roll silhouette instead of a long thin tube. */
const ATLAS_WIDTH = 4096
const ATLAS_HEIGHT = 560
const PAPER_WIDTH = 1.5

export function getSessionTapeRenderPolicy(reducedMotion: boolean) {
  return {
    animate: !reducedMotion,
    renderOnce: reducedMotion,
    transparentCanvas: true,
  }
}

export interface SessionTapeMotionPolicy {
  compact: boolean
  horizontalRadius: number
  depthRadius: number
  cycleSeconds: number
}

export function getSessionTapeMotionPolicy(width: number, height: number): SessionTapeMotionPolicy {
  const aspect = Math.max(1, width) / Math.max(1, height)
  const compact = width <= 900 || aspect < 1.45
  return {
    compact,
    horizontalRadius: compact
      ? Math.min(4.2, Math.max(0.7, aspect * 5.5 - 1.7))
      : Math.min(5.5, aspect * 2.9),
    depthRadius: compact ? 1.8 : 2.4,
    cycleSeconds: compact ? 26 : 32,
  }
}

export function getSessionTapeMotionTarget(time: number, policy: SessionTapeMotionPolicy) {
  const phase = -Math.PI / 3 + (time / policy.cycleSeconds) * Math.PI * 2
  return {
    x: policy.horizontalRadius * Math.sin(phase),
    z: policy.depthRadius * Math.cos(phase),
  }
}

export function getTapeGeometryPolicy(
  atlasWidth = ATLAS_WIDTH,
  atlasHeight = ATLAS_HEIGHT,
  paperWidth = PAPER_WIDTH,
) {
  const atlasSpan = paperWidth * (atlasWidth / atlasHeight)
  return {
    paperWidth,
    atlasSpan,
    rollRadius: atlasSpan / (Math.PI * 2),
  }
}

function fract(value: number) {
  return value - Math.floor(value)
}

/* CylinderGeometry's bottom is u=.75 after its axis is rotated onto X.
 * A fixed .25 atlas phase makes its contact U identical to the flat paper. */
export function getTapeContactPhases(distance: number, atlasSpan: number) {
  const phase = distance / atlasSpan
  return {
    ribbon: fract(phase),
    barrelBottom: fract(0.75 + 0.25 + phase),
  }
}

export function getTapeCurlSample(theta: number, rollRadius: number, lift = 0.012) {
  const visualRadius = rollRadius + lift
  return {
    forward: Math.sin(theta) * visualRadius,
    height: (1 - Math.cos(theta)) * visualRadius,
    normalForward: -Math.sin(theta),
    normalUp: Math.cos(theta),
    surfaceDistance: theta * rollRadius,
  }
}

interface TapePalette {
  bg: string
  surface: string
  surface2: string
  border: string
  border2: string
  text: string
  muted: string
  faint: string
  accent: string
}

function readPalette(el: Element): TapePalette {
  const css = getComputedStyle(el)
  const read = (token: string, fallback: string) => css.getPropertyValue(token).trim() || fallback
  return {
    bg: read('--bg', '#000000'),
    surface: read('--surface', '#090909'),
    surface2: read('--surface2', '#111111'),
    border: read('--border', '#1f1f1f'),
    border2: read('--border2', '#2e2e2e'),
    text: read('--text', '#ffffff'),
    muted: read('--muted', '#a6a6a6'),
    faint: read('--faint', '#555555'),
    accent: read('--accent', '#5bb1f0'),
  }
}

function isDarkPalette(palette: TapePalette) {
  const match = /^#([0-9a-f]{6})$/i.exec(palette.bg)
  if (!match) return false
  const value = Number.parseInt(match[1]!, 16)
  return ((value >> 16) & 255) + ((value >> 8) & 255) + (value & 255) < 384
}

function fillBand(
  ctx: CanvasRenderingContext2D,
  x: number,
  width: number,
  color: string,
  alpha: number,
) {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.fillStyle = color
  ctx.fillRect(x, 12, width, ATLAS_HEIGHT - 24)
  ctx.restore()
}

function makeSessionAtlas(palette: TapePalette) {
  const canvas = document.createElement('canvas')
  canvas.width = ATLAS_WIDTH
  canvas.height = ATLAS_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D is unavailable')

  ctx.fillStyle = palette.surface
  ctx.fillRect(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT)
  ctx.strokeStyle = palette.border2
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(0, 4)
  ctx.lineTo(ATLAS_WIDTH, 4)
  ctx.moveTo(0, ATLAS_HEIGHT - 4)
  ctx.lineTo(ATLAS_WIDTH, ATLAS_HEIGHT - 4)
  ctx.stroke()

  const pitch = ATLAS_WIDTH / SESSION_TUI_LINES.length
  for (let index = 0; index < SESSION_TUI_LINES.length; index++) {
    const line = SESSION_TUI_LINES[index]!
    const x = index * pitch
    if (line.kind === 'prompt') fillBand(ctx, x + 6, pitch - 12, palette.accent, 0.07)
    else if (line.kind === 'agent') fillBand(ctx, x + 6, pitch - 12, palette.surface2, 0.72)
    else if (line.kind === 'tool') fillBand(ctx, x + 6, pitch - 12, palette.border2, 0.48)
    else if (line.kind === 'evidence') fillBand(ctx, x + 6, pitch - 12, palette.accent, 0.1)
    else if (line.kind === 'lineage') fillBand(ctx, x + 6, pitch - 12, palette.accent, 0.07)

    ctx.save()
    ctx.translate(x + pitch / 2, 48)
    ctx.rotate(Math.PI / 2)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    const weight = line.kind === 'frame' ? 400 : line.kind === 'agent' ? 600 : 500
    ctx.font = `${weight} 64px 'Geist Mono', monospace`
    ctx.fillStyle =
      line.kind === 'prompt' || line.kind === 'evidence' || line.kind === 'lineage'
        ? palette.accent
        : line.kind === 'frame'
          ? palette.faint
          : line.kind === 'meta' || line.kind === 'tool'
            ? palette.muted
            : palette.text
    ctx.fillText(line.text, 0, 0, ATLAS_HEIGHT - 96)
    ctx.restore()
  }

  return canvas
}

function makeBlobTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D is unavailable')
  const gradient = ctx.createRadialGradient(128, 128, 8, 128, 128, 128)
  gradient.addColorStop(0, 'rgba(0,0,0,0.34)')
  gradient.addColorStop(0.55, 'rgba(0,0,0,0.13)')
  gradient.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 256, 256)
  return canvas
}

const FALLBACK_TUI = SESSION_TUI_LINES.map((line) => line.text).join('\n')

export function SessionTape() {
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [nearViewport, setNearViewport] = useState(false)
  const [ready, setReady] = useState(false)
  const [themeTick, setThemeTick] = useState(0)
  const [motionTick, setMotionTick] = useState(0)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    if (typeof IntersectionObserver === 'undefined') {
      setNearViewport(true)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        setNearViewport(true)
        observer.disconnect()
      },
      { rootMargin: '640px 0px' },
    )
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const observer = new MutationObserver(() => setThemeTick((tick) => tick + 1))
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setMotionTick((tick) => tick + 1)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (!nearViewport) return
    const root = rootRef.current
    const canvas = canvasRef.current
    if (!root || !canvas) return

    let alive = true
    let cleanup: (() => void) | undefined
    setReady(false)

    void (async () => {
      try {
        const THREE = await import('three')
        await document.fonts.ready
        if (!alive) return

        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        const policy = getSessionTapeRenderPolicy(reducedMotion)
        const palette = readPalette(root)
        const darkTheme = isDarkPalette(palette)
        const renderer = new THREE.WebGLRenderer({
          canvas,
          antialias: true,
          alpha: policy.transparentCanvas,
          powerPreference: 'high-performance',
        })
        renderer.outputColorSpace = THREE.SRGBColorSpace
        renderer.setClearColor(new THREE.Color(palette.bg), 0)

        const resources: Array<{ dispose: () => void }> = []
        let animationFrame = 0
        let resizeObserver: ResizeObserver | undefined
        let viewportObserver: IntersectionObserver | undefined
        let listeningForWindowResize = false
        let inViewport = true
        let pageVisible = !document.hidden
        let disposed = false
        const onVisibilityChange = () => {
          pageVisible = !document.hidden
          syncLoop()
        }
        const onContextLost = (event: Event) => {
          event.preventDefault()
          setReady(false)
          if (animationFrame) cancelAnimationFrame(animationFrame)
          animationFrame = 0
        }
        const onContextRestored = () => setThemeTick((tick) => tick + 1)
        const disposeScene = () => {
          if (disposed) return
          disposed = true
          if (animationFrame) cancelAnimationFrame(animationFrame)
          document.removeEventListener('visibilitychange', onVisibilityChange)
          canvas.removeEventListener('webglcontextlost', onContextLost)
          canvas.removeEventListener('webglcontextrestored', onContextRestored)
          if (listeningForWindowResize) window.removeEventListener('resize', resize)
          resizeObserver?.disconnect()
          viewportObserver?.disconnect()
          for (const resource of resources) resource.dispose()
          renderer.dispose()
        }
        cleanup = disposeScene

        const scene = new THREE.Scene()
        const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100)
        const initialRect = root.getBoundingClientRect()
        let motionPolicy = getSessionTapeMotionPolicy(initialRect.width, initialRect.height)
        const atlasCanvas = makeSessionAtlas(palette)
        const atlasTexture = new THREE.CanvasTexture(atlasCanvas)
        atlasTexture.wrapS = THREE.RepeatWrapping
        atlasTexture.wrapT = THREE.ClampToEdgeWrapping
        atlasTexture.colorSpace = THREE.SRGBColorSpace
        atlasTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
        resources.push(atlasTexture)

        const barrelTexture = atlasTexture.clone()
        resources.push(barrelTexture)
        barrelTexture.needsUpdate = true
        barrelTexture.wrapS = THREE.RepeatWrapping
        barrelTexture.wrapT = THREE.ClampToEdgeWrapping
        barrelTexture.repeat.set(1, 1)
        barrelTexture.offset.x = 0.25
        barrelTexture.colorSpace = THREE.SRGBColorSpace
        barrelTexture.anisotropy = atlasTexture.anisotropy

        const { atlasSpan, rollRadius } = getTapeGeometryPolicy()
        const historyCapacity =
          motionPolicy.compact && motionPolicy.horizontalRadius < 2
            ? 100
            : motionPolicy.compact
              ? 160
              : 220
        const curlSections = 22
        const maxCrossSections = historyCapacity + curlSections + 2
        const vertexCount = maxCrossSections * 2
        const positions = new Float32Array(vertexCount * 3)
        const normals = new Float32Array(vertexCount * 3)
        const uvs = new Float32Array(vertexCount * 2)
        const indices = new Uint32Array((maxCrossSections - 1) * 6)
        for (let section = 0; section < maxCrossSections - 1; section++) {
          const vertex = section * 2
          const offset = section * 6
          indices[offset] = vertex
          indices[offset + 1] = vertex + 1
          indices[offset + 2] = vertex + 2
          indices[offset + 3] = vertex + 1
          indices[offset + 4] = vertex + 3
          indices[offset + 5] = vertex + 2
        }

        const ribbonGeometry = new THREE.BufferGeometry()
        ribbonGeometry.setAttribute(
          'position',
          new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage),
        )
        ribbonGeometry.setAttribute(
          'normal',
          new THREE.BufferAttribute(normals, 3).setUsage(THREE.DynamicDrawUsage),
        )
        ribbonGeometry.setAttribute(
          'uv',
          new THREE.BufferAttribute(uvs, 2).setUsage(THREE.DynamicDrawUsage),
        )
        ribbonGeometry.setIndex(new THREE.BufferAttribute(indices, 1))
        const ribbonMaterial = new THREE.MeshStandardMaterial({
          map: atlasTexture,
          roughness: 0.92,
          metalness: 0,
          side: THREE.DoubleSide,
        })
        const ribbon = new THREE.Mesh(ribbonGeometry, ribbonMaterial)
        ribbon.frustumCulled = false
        scene.add(ribbon)
        resources.push(ribbonGeometry, ribbonMaterial)

        const rollGroup = new THREE.Group()
        const spinner = new THREE.Group()
        rollGroup.add(spinner)
        scene.add(rollGroup)

        const barrelGeometry = new THREE.CylinderGeometry(
          rollRadius,
          rollRadius,
          PAPER_WIDTH,
          96,
          1,
          true,
        )
        barrelGeometry.rotateZ(Math.PI / 2)
        resources.push(barrelGeometry)
        const barrelMaterial = new THREE.MeshStandardMaterial({
          map: barrelTexture,
          roughness: 0.92,
          metalness: 0,
        })
        resources.push(barrelMaterial)
        spinner.add(new THREE.Mesh(barrelGeometry, barrelMaterial))

        const innerRadius = rollRadius * 0.19
        const capGeometry = new THREE.RingGeometry(innerRadius, rollRadius, 96)
        resources.push(capGeometry)
        const capMaterial = new THREE.MeshStandardMaterial({
          color: new THREE.Color(palette.surface2),
          roughness: 0.96,
          metalness: 0,
          side: THREE.DoubleSide,
        })
        resources.push(capMaterial)
        const capRight = new THREE.Mesh(capGeometry, capMaterial)
        capRight.rotation.y = Math.PI / 2
        capRight.position.x = PAPER_WIDTH / 2 + 0.002
        const capLeft = new THREE.Mesh(capGeometry, capMaterial)
        capLeft.rotation.y = -Math.PI / 2
        capLeft.position.x = -PAPER_WIDTH / 2 - 0.002
        spinner.add(capRight, capLeft)

        const coreGeometry = new THREE.CylinderGeometry(
          innerRadius,
          innerRadius,
          PAPER_WIDTH * 1.01,
          40,
          1,
          true,
        )
        coreGeometry.rotateZ(Math.PI / 2)
        resources.push(coreGeometry)
        const coreMaterial = new THREE.MeshStandardMaterial({
          color: new THREE.Color(palette.border2),
          roughness: 1,
          metalness: 0,
          side: THREE.DoubleSide,
        })
        resources.push(coreMaterial)
        spinner.add(new THREE.Mesh(coreGeometry, coreMaterial))

        const blobTexture = new THREE.CanvasTexture(makeBlobTexture())
        resources.push(blobTexture)
        const blobGeometry = new THREE.PlaneGeometry(rollRadius * 3.5, PAPER_WIDTH * 2.2)
        resources.push(blobGeometry)
        const blobMaterial = new THREE.MeshBasicMaterial({
          map: blobTexture,
          transparent: true,
          opacity: darkTheme ? 0.55 : 0.72,
          depthWrite: false,
        })
        resources.push(blobMaterial)
        const blob = new THREE.Mesh(blobGeometry, blobMaterial)
        blob.rotation.x = -Math.PI / 2
        blob.renderOrder = -1
        scene.add(blob)

        scene.add(new THREE.AmbientLight(0xffffff, darkTheme ? 1.05 : 0.88))
        const keyLight = new THREE.DirectionalLight(0xffffff, darkTheme ? 1.3 : 0.48)
        keyLight.position.set(5, 9, 7)
        scene.add(keyLight)
        const accentLight = new THREE.PointLight(palette.accent, darkTheme ? 5 : 2.4, 16, 2)
        scene.add(accentLight)

        const historyX = new Float32Array(historyCapacity)
        const historyZ = new Float32Array(historyCapacity)
        const historyS = new Float32Array(historyCapacity)
        let historyHead = -1
        let historyCount = 0
        const preRollFrames = motionPolicy.compact ? 420 : 520
        let simulationTime = -preRollFrames / 60
        const initialTarget = getSessionTapeMotionTarget(simulationTime, motionPolicy)
        let positionX = initialTarget.x
        let positionZ = initialTarget.z
        let velocityX = 0
        let velocityZ = 0
        let yaw = 0
        let totalDistance = 0
        const sampleGap = 0.095

        const historyIndex = (order: number) =>
          (historyHead - (historyCount - 1) + order + historyCapacity * 2) % historyCapacity
        const pushHistory = (x: number, z: number, distance: number) => {
          historyHead = (historyHead + 1) % historyCapacity
          historyX[historyHead] = x
          historyZ[historyHead] = z
          historyS[historyHead] = distance
          if (historyCount < historyCapacity) historyCount++
        }
        pushHistory(positionX, positionZ, totalDistance)

        const lerpAngle = (from: number, to: number, amount: number) => {
          let delta = to - from
          while (delta > Math.PI) delta -= Math.PI * 2
          while (delta < -Math.PI) delta += Math.PI * 2
          return from + delta * amount
        }

        const advanceMotion = (delta: number) => {
          simulationTime += delta
          const target = getSessionTapeMotionTarget(simulationTime, motionPolicy)
          velocityX += ((target.x - positionX) * 3.2 - velocityX * 3.6) * delta
          velocityZ += ((target.z - positionZ) * 3.2 - velocityZ * 3.6) * delta
          const speed = Math.hypot(velocityX, velocityZ)
          const maxSpeed = motionPolicy.compact ? 1.25 : 1.8
          if (speed > maxSpeed) {
            velocityX *= maxSpeed / speed
            velocityZ *= maxSpeed / speed
          }

          const previousX = positionX
          const previousZ = positionZ
          positionX += velocityX * delta
          positionZ += velocityZ * delta
          const moved = Math.hypot(positionX - previousX, positionZ - previousZ)
          totalDistance += moved
          if (speed > 0.05) {
            const targetYaw = Math.atan2(velocityX, velocityZ)
            yaw = lerpAngle(yaw, targetYaw, 1 - Math.exp(-3.2 * delta))
          }

          let lastX = historyX[historyHead]!
          let lastZ = historyZ[historyHead]!
          let remaining = Math.hypot(positionX - lastX, positionZ - lastZ)
          while (remaining >= sampleGap) {
            const ratio = sampleGap / remaining
            lastX += (positionX - lastX) * ratio
            lastZ += (positionZ - lastZ) * ratio
            remaining -= sampleGap
            pushHistory(lastX, lastZ, totalDistance - remaining)
          }
        }

        for (let index = 0; index < preRollFrames; index++) advanceMotion(1 / 60)

        const writeCrossSection = (
          section: number,
          x: number,
          y: number,
          z: number,
          sideX: number,
          sideZ: number,
          halfWidth: number,
          normalX: number,
          normalY: number,
          normalZ: number,
          u: number,
        ) => {
          const vertex = section * 2
          const positionOffset = vertex * 3
          const uvOffset = vertex * 2
          positions[positionOffset] = x + sideX * halfWidth
          positions[positionOffset + 1] = y
          positions[positionOffset + 2] = z + sideZ * halfWidth
          positions[positionOffset + 3] = x - sideX * halfWidth
          positions[positionOffset + 4] = y
          positions[positionOffset + 5] = z - sideZ * halfWidth
          normals[positionOffset] = normalX
          normals[positionOffset + 1] = normalY
          normals[positionOffset + 2] = normalZ
          normals[positionOffset + 3] = normalX
          normals[positionOffset + 4] = normalY
          normals[positionOffset + 5] = normalZ
          uvs[uvOffset] = u
          uvs[uvOffset + 1] = 0
          uvs[uvOffset + 2] = u
          uvs[uvOffset + 3] = 1
        }

        const smoothstep = (edge0: number, edge1: number, value: number) => {
          const amount = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)))
          return amount * amount * (3 - 2 * amount)
        }

        const rebuildRibbon = () => {
          if (historyCount < 2) return
          const tailIndex = historyIndex(0)
          const tailDistance = historyS[tailIndex]!
          const uBase = Math.floor(tailDistance / atlasSpan) * atlasSpan
          const halfPaper = PAPER_WIDTH / 2
          let section = 0
          let previousTangentX = Math.sin(yaw)
          let previousTangentZ = Math.cos(yaw)

          for (let order = 0; order < historyCount; order++) {
            const current = historyIndex(order)
            const before = historyIndex(Math.max(0, order - 1))
            const after = historyIndex(Math.min(historyCount - 1, order + 1))
            let tangentX =
              order === historyCount - 1 ? Math.sin(yaw) : historyX[after]! - historyX[before]!
            let tangentZ =
              order === historyCount - 1 ? Math.cos(yaw) : historyZ[after]! - historyZ[before]!
            const tangentLength = Math.hypot(tangentX, tangentZ)
            if (tangentLength > 0.0001) {
              tangentX /= tangentLength
              tangentZ /= tangentLength
            } else {
              tangentX = previousTangentX
              tangentZ = previousTangentZ
            }
            if (tangentX * previousTangentX + tangentZ * previousTangentZ < 0) {
              tangentX = previousTangentX
              tangentZ = previousTangentZ
            }
            previousTangentX = tangentX
            previousTangentZ = tangentZ
            const sideX = tangentZ
            const sideZ = -tangentX
            const fromTail = historyS[current]! - tailDistance
            const width = halfPaper * smoothstep(0, 2.5, fromTail)
            const paperY = 0.018 + fromTail * 0.00035
            writeCrossSection(
              section++,
              historyX[current]!,
              paperY,
              historyZ[current]!,
              sideX,
              sideZ,
              width,
              0,
              1,
              0,
              (historyS[current]! - uBase) / atlasSpan,
            )
          }

          const forwardX = Math.sin(yaw)
          const forwardZ = Math.cos(yaw)
          const sideX = forwardZ
          const sideZ = -forwardX
          const contactY = 0.018 + (totalDistance - tailDistance) * 0.00035
          writeCrossSection(
            section++,
            positionX,
            contactY,
            positionZ,
            sideX,
            sideZ,
            halfPaper,
            0,
            1,
            0,
            (totalDistance - uBase) / atlasSpan,
          )

          const curlMax = 0.88
          for (let curl = 1; curl <= curlSections; curl++) {
            const theta = (curl / curlSections) * curlMax
            const sample = getTapeCurlSample(theta, rollRadius)
            writeCrossSection(
              section++,
              positionX + forwardX * sample.forward,
              contactY + sample.height,
              positionZ + forwardZ * sample.forward,
              sideX,
              sideZ,
              halfPaper,
              forwardX * sample.normalForward,
              sample.normalUp,
              forwardZ * sample.normalForward,
              (totalDistance + sample.surfaceDistance - uBase) / atlasSpan,
            )
          }

          ribbonGeometry.setDrawRange(0, (section - 1) * 6)
          ;(ribbonGeometry.attributes['position'] as import('three').BufferAttribute).needsUpdate =
            true
          ;(ribbonGeometry.attributes['normal'] as import('three').BufferAttribute).needsUpdate =
            true
          ;(ribbonGeometry.attributes['uv'] as import('three').BufferAttribute).needsUpdate = true

          rollGroup.position.set(positionX, contactY + rollRadius, positionZ)
          rollGroup.rotation.y = yaw
          spinner.rotation.x = (totalDistance % atlasSpan) / rollRadius
          blob.position.set(positionX, 0.007, positionZ)
          blob.rotation.z = yaw - Math.PI / 2
          keyLight.position.set(positionX + 5, 9, positionZ + 7)
          accentLight.position.set(positionX - 2, 3.4, positionZ + 2)
        }

        const updateCamera = () => {
          if (motionPolicy.compact) {
            camera.position.set(0, 8.5, 12.1)
            camera.lookAt(0, 1.7, 0)
          } else {
            camera.position.set(0, 8.2, 11.8)
            camera.lookAt(0, 1.7, 0)
          }
        }

        const resize = () => {
          const rect = root.getBoundingClientRect()
          const width = Math.max(2, rect.width)
          const height = Math.max(2, rect.height)
          motionPolicy = getSessionTapeMotionPolicy(width, height)
          const dpr = Math.min(window.devicePixelRatio || 1, motionPolicy.compact ? 1.5 : 2)
          renderer.setPixelRatio(dpr)
          renderer.setSize(width, height, false)
          camera.aspect = width / height
          camera.fov = motionPolicy.compact ? 42 : 35
          camera.updateProjectionMatrix()
          updateCamera()
        }

        const renderFrame = (delta: number) => {
          if (policy.animate) advanceMotion(delta)
          rebuildRibbon()
          renderer.render(scene, camera)
        }

        let lastTime = 0
        const loop = (now: number) => {
          const delta = lastTime ? Math.min(1 / 30, (now - lastTime) / 1000) : 0
          lastTime = now
          renderFrame(delta)
          animationFrame = requestAnimationFrame(loop)
        }
        const syncLoop = () => {
          const shouldRun = policy.animate && inViewport && pageVisible
          if (shouldRun && animationFrame === 0) {
            lastTime = performance.now()
            animationFrame = requestAnimationFrame(loop)
          } else if (!shouldRun && animationFrame !== 0) {
            cancelAnimationFrame(animationFrame)
            animationFrame = 0
            lastTime = 0
          }
        }

        resize()
        rebuildRibbon()
        renderer.render(scene, camera)
        setReady(true)

        if (typeof ResizeObserver === 'undefined') {
          listeningForWindowResize = true
          window.addEventListener('resize', resize)
        } else {
          resizeObserver = new ResizeObserver(() => {
            resize()
            renderFrame(0)
          })
          resizeObserver.observe(root)
        }
        if (typeof IntersectionObserver !== 'undefined') {
          viewportObserver = new IntersectionObserver(([entry]) => {
            inViewport = entry?.isIntersecting ?? true
            syncLoop()
          })
          viewportObserver.observe(root)
        }
        document.addEventListener('visibilitychange', onVisibilityChange)
        canvas.addEventListener('webglcontextlost', onContextLost)
        canvas.addEventListener('webglcontextrestored', onContextRestored)
        syncLoop()
      } catch {
        cleanup?.()
        cleanup = undefined
        if (alive) setReady(false)
      }
    })()

    return () => {
      alive = false
      cleanup?.()
    }
  }, [motionTick, nearViewport, themeTick])

  return (
    <div ref={rootRef} className={`session-tape${ready ? ' is-ready' : ''}`} aria-hidden>
      <canvas ref={canvasRef} className="session-tape__canvas" />
      <div className="session-tape__fallback">
        <pre>{FALLBACK_TUI}</pre>
      </div>
      <div className="session-tape__vignette" />
    </div>
  )
}
