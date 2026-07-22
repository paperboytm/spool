/* Hero background: agent Sessions streaming from many machines into one
 * shared space — WebGL edition.
 *
 * The shared space is a galaxy: Sessions are soft additive particles
 * (no hard-edged geometry) swirling with differential rotation inside a
 * glowing ring, over a volumetric core faked with stacked glow sprites.
 * Laptops on a ground ring emit Session comets that fly along 3D arcs
 * and join the galaxy on arrival. UnrealBloom + exponential fog carry
 * the look; thin CSS light beams sweep the band on top (see .hs-band)
 * while the base stays the same void black as the rest of the
 * page, so scrolling out of the hero has no color jump.
 *
 * three.js loads lazily inside the effect so the initial page chunk
 * stays lean. prefers-reduced-motion renders one settled frame; the
 * loop pauses offscreen; everything disposes on unmount. On wide
 * viewports the camera's view offset shifts the scene right so the
 * copy owns the left column.
 */
import { useEffect, useRef, useState } from 'react'

/* Colors come from the CSS design tokens at init (see readPalette), so
 * retheming the site retunes the whole scene. All accent tints are
 * derived from the single --accent value. */
interface Rgb {
  r: number
  g: number
  b: number
}

function parseCssColor(value: string, fallback: Rgb): Rgb {
  const v = value.trim()
  const hex = /^#([0-9a-f]{6})$/i.exec(v)
  if (hex) {
    const n = parseInt(hex[1]!, 16)
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
  }
  const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(v)
  if (rgb) return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) }
  return fallback
}

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  }
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 }
const VOID_BLACK: Rgb = { r: 0, g: 0, b: 0 }

function rgbaOf(c: Rgb, a: number): string {
  return `rgba(${c.r},${c.g},${c.b},${a})`
}

function hexIntOf(c: Rgb): number {
  return (c.r << 16) | (c.g << 8) | c.b
}

function readPalette(el: Element) {
  const css = getComputedStyle(el)
  const read = (name: string, fallback: Rgb) => parseCssColor(css.getPropertyValue(name), fallback)
  const accent = read('--accent', { r: 19, g: 135, b: 255 })
  const bgc = read('--bg', VOID_BLACK)
  const dark = bgc.r + bgc.g + bgc.b < 3 * 128
  return {
    accent,
    claude: read('--src-claude', { r: 232, g: 154, b: 124 }),
    codex: read('--src-codex', { r: 124, g: 201, b: 162 }),
    gemini: read('--src-gemini', { r: 138, g: 176, b: 229 }),
    /* Scene neutrals follow the active design system. */
    bg: read('--bg', VOID_BLACK),
    surface: read('--surface', { r: 9, g: 9, b: 9 }),
    border: read('--border', { r: 31, g: 31, b: 31 }),
    border2: read('--border2', { r: 46, g: 46, b: 46 }),
    muted: read('--muted', { r: 166, g: 166, b: 166 }),
    /* Derived tints: toward white on dark themes; saturated and deep on
     * light so particles read as ink, not haze. */
    bright: mixRgb(accent, dark ? WHITE : { r: 0, g: 40, b: 110 }, dark ? 0.3 : 0.2),
    soft: mixRgb(accent, dark ? WHITE : { r: 0, g: 40, b: 110 }, dark ? 0.55 : 0.35),
    sparkle: mixRgb(accent, dark ? WHITE : { r: 0, g: 40, b: 110 }, dark ? 0.45 : 0.1),
    pale: mixRgb(accent, dark ? WHITE : bgc, dark ? 0.82 : 0.3),
    dimmed: mixRgb(accent, dark ? VOID_BLACK : WHITE, 0.45),
  }
}
type Palette = ReturnType<typeof readPalette>

const MACHINE_RING = 285
const SPACE_RADIUS = 132
const SPACE_BASE = 46
const SPACE_TOP = 206

function seededRandom(seed: number) {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

/** Radial soft-dot sprite texture shared by every particle system. */
function makeSoftDot(THREE: typeof import('three')) {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Radial accent glow for the floor under the space. */
function makeFloorGlow(THREE: typeof import('three'), accent: Rgb) {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128)
  grad.addColorStop(0, rgbaOf(accent, 0.22))
  grad.addColorStop(0.45, rgbaOf(accent, 0.07))
  grad.addColorStop(1, rgbaOf(accent, 0))
  g.fillStyle = grad
  g.fillRect(0, 0, 256, 256)
  return new THREE.CanvasTexture(c)
}

/** Terminal screen texture: a void display running an agent
 * session — glowing code lines in the machine's source color, a divider,
 * and a bright cursor block. Reads as "an agent at work", not flat color. */
function makeScreenTexture(THREE: typeof import('three'), color: Rgb, seed: number) {
  const rnd = seededRandom(seed)
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 160
  const g = c.getContext('2d')!
  g.fillStyle = '#090909'
  g.fillRect(0, 0, 256, 160)
  /* Soft glow pooling at the bottom of the display. */
  const r = color.r
  const gr = color.g
  const b = color.b
  const pool = g.createLinearGradient(0, 0, 0, 160)
  pool.addColorStop(0, 'rgba(0,0,0,0)')
  pool.addColorStop(1, `rgba(${r},${gr},${b},0.14)`)
  g.fillStyle = pool
  g.fillRect(0, 0, 256, 160)
  /* Code lines: indented segments of varying width and brightness. */
  let y = 16
  for (let row = 0; row < 9 && y < 138; row++) {
    const indent = 14 + Math.floor(rnd() * 3) * 16
    let x = indent
    const segs = 1 + Math.floor(rnd() * 3)
    for (let sN = 0; sN < segs; sN++) {
      const wSeg = 18 + rnd() * 52
      const bright = 0.28 + rnd() * 0.5
      const dim = rnd() > 0.72
      g.fillStyle = dim
        ? `rgba(166,166,166,${0.3 + rnd() * 0.2})`
        : `rgba(${r},${gr},${b},${bright})`
      g.beginPath()
      g.roundRect(x, y, wSeg, 7, 3.5)
      g.fill()
      x += wSeg + 10
      if (x > 210) break
    }
    y += 14
  }
  /* Prompt line + cursor. */
  g.fillStyle = `rgba(${r},${gr},${b},0.95)`
  g.beginPath()
  g.roundRect(14, y + 2, 8, 9, 2)
  g.fill()
  g.fillStyle = 'rgba(255,255,255,0.8)'
  g.beginPath()
  g.roundRect(28, y + 2, 30, 9, 3)
  g.fill()
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Soft annulus texture: a gaussian-profile ring with no hard edge. */
function makeRingTexture(THREE: typeof import('three'), pal: Palette, dark: boolean) {
  const c = document.createElement('canvas')
  c.width = c.height = 512
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(256, 256, 0, 256, 256, 256)
  const a1 = dark ? 0.34 : 0.5
  const a2 = dark ? 0.85 : 1
  grad.addColorStop(0, rgbaOf(pal.bright, 0))
  grad.addColorStop(0.62, rgbaOf(pal.bright, 0))
  grad.addColorStop(0.72, rgbaOf(pal.bright, a1))
  grad.addColorStop(0.78, rgbaOf(pal.soft, a2))
  grad.addColorStop(0.84, rgbaOf(pal.bright, a1))
  grad.addColorStop(0.96, rgbaOf(pal.bright, 0))
  grad.addColorStop(1, rgbaOf(pal.bright, 0))
  g.fillStyle = grad
  g.fillRect(0, 0, 512, 512)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export function HeroSpace({
  align = 'right',
  scrim = true,
}: {
  /** 'right' leaves the left column to overlay copy; 'center' for frames. */
  align?: 'right' | 'center'
  /** Disable the copy-readability scrim when used as a framed panel. */
  scrim?: boolean
} = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  /* Rebuild the scene when the site theme flips so the palette, blend
   * modes, and calibrated clear color all follow light/dark. */
  const [themeTick, setThemeTick] = useState(0)
  useEffect(() => {
    const mo = new MutationObserver(() => setThemeTick((t) => t + 1))
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class'],
    })
    return () => mo.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let alive = true
    let cleanup: (() => void) | undefined

    void (async () => {
      const [THREE, { EffectComposer }, { RenderPass }, { UnrealBloomPass }] = await Promise.all([
        import('three'),
        import('three/addons/postprocessing/EffectComposer.js'),
        import('three/addons/postprocessing/RenderPass.js'),
        import('three/addons/postprocessing/UnrealBloomPass.js'),
      ])
      if (!alive) return

      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const rand = seededRandom(20260722)
      const pal = readPalette(canvas)
      const darkMode = pal.bg.r + pal.bg.g + pal.bg.b < 3 * 128
      /* Monochrome-blue family derived from the accent: deep, base, and
       * airy variants keep variety without leaving the brand hue. */
      const blueDeep = mixRgb(pal.accent, { r: 8, g: 28, b: 88 }, darkMode ? 0.35 : 0.45)
      const blueSoft = mixRgb(pal.accent, WHITE, darkMode ? 0.4 : 0.12)
      const bluePale = mixRgb(pal.accent, WHITE, darkMode ? 0.72 : 0.3)
      /* Additive glow reads beautifully on dark; on light it whites out,
       * so particles switch to normal blending with deeper tints. */
      const glowBlend = darkMode ? THREE.AdditiveBlending : THREE.NormalBlending
      const ACCENT = hexIntOf(pal.accent)
      const machineColors = [pal.accent, blueSoft, blueDeep, pal.accent, blueSoft, blueDeep]
      const starPalette = [
        hexIntOf(pal.accent),
        hexIntOf(pal.accent),
        hexIntOf(blueSoft),
        hexIntOf(blueDeep),
        hexIntOf(pal.sparkle),
        hexIntOf(bluePale),
      ]

      let renderer: import('three').WebGLRenderer
      try {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
      } catch {
        return
      }
      /* The composer chain (tone map + double sRGB encode) shifts flat
       * colors, so numerically invert it per channel to find the raw clear
       * value that displays exactly as the theme background. */
      const aces = (x: number) => (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)
      const toSrgb = (x: number) =>
        x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055
      const chain = (x: number) => toSrgb(toSrgb(Math.min(1, darkMode ? aces(1.24 * x) : x)))
      const solveChannel = (target: number) => {
        let lo = 0
        let hi = 8
        for (let i = 0; i < 40; i++) {
          const mid = (lo + hi) / 2
          if (chain(mid) < target) lo = mid
          else hi = mid
        }
        return (lo + hi) / 2
      }
      const clearColor = new THREE.Color(
        solveChannel(pal.bg.r / 255),
        solveChannel(pal.bg.g / 255),
        solveChannel(pal.bg.b / 255),
      )
      clearColor.convertLinearToSRGB()
      clearColor.convertSRGBToLinear()
      renderer.setClearColor(clearColor, 1)
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.toneMappingExposure = 1.24

      const scene = new THREE.Scene()
      scene.fog = new THREE.FogExp2(
        clearColor.getHex(THREE.LinearSRGBColorSpace),
        darkMode ? 0.00095 : 0.00024,
      )

      const camera = new THREE.PerspectiveCamera(30, 2, 10, 4000)
      const lookAt = new THREE.Vector3(0, 92, 0)

      scene.add(new THREE.AmbientLight(hexIntOf(mixRgb(pal.muted, pal.bg, 0.35)), 2.6))
      const spaceLight = new THREE.PointLight(ACCENT, 68000, 1400, 2)
      spaceLight.position.set(0, 130, 0)
      scene.add(spaceLight)
      const rim = new THREE.DirectionalLight(hexIntOf(mixRgb(pal.muted, WHITE, 0.12)), 1.2)
      rim.position.set(-300, 400, 500)
      scene.add(rim)

      const softDot = makeSoftDot(THREE)
      const disposables: Array<{ dispose: () => void }> = [softDot]

      /* ── Ground ring under the machines ── */
      const ringMat = new THREE.LineBasicMaterial({
        color: hexIntOf(pal.border),
        transparent: true,
        opacity: 0.9,
      })
      const ringPts: import('three').Vector3[] = []
      for (let i = 0; i <= 96; i++) {
        const a = (i / 96) * Math.PI * 2
        ringPts.push(new THREE.Vector3(Math.cos(a) * MACHINE_RING, 0, Math.sin(a) * MACHINE_RING))
      }
      const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPts)
      scene.add(new THREE.Line(ringGeo, ringMat))
      disposables.push(ringGeo, ringMat)

      /* ── Floor glow ── */
      const glowTex = makeFloorGlow(THREE, pal.accent)
      const glowMat = new THREE.MeshBasicMaterial({
        map: glowTex,
        transparent: true,
        blending: glowBlend,
        depthWrite: false,
      })
      const glowGeo = new THREE.PlaneGeometry(SPACE_RADIUS * 3.2, SPACE_RADIUS * 3.2)
      const glow = new THREE.Mesh(glowGeo, glowMat)
      glow.rotation.x = -Math.PI / 2
      glow.position.y = 0.5
      scene.add(glow)
      disposables.push(glowTex, glowMat, glowGeo)

      /* ── Volumetric core: stacked soft glow sprites along the axis ── */
      const coreMat = new THREE.SpriteMaterial({
        map: softDot,
        color: 0xf07020,
        transparent: true,
        opacity: darkMode ? 0.055 : 0.12,
        blending: glowBlend,
        depthWrite: false,
      })
      disposables.push(coreMat)
      for (let i = 0; i < 3; i++) {
        const sprite = new THREE.Sprite(coreMat)
        const t = i / 2
        sprite.position.set(0, 44 + t * 145, 0)
        const sc = 110 + Math.sin(0.3 + t * 2.2) * 55
        sprite.scale.set(sc, sc, 1)
        scene.add(sprite)
      }

      /* ── Top ring: soft glow annulus + jittered particle ring + a bright
       * pulse orbiting the rim. No hard-edged geometry. ── */
      const ringTex = makeRingTexture(THREE, pal, darkMode)
      const ringGlowMat = new THREE.MeshBasicMaterial({
        map: ringTex,
        transparent: true,
        blending: glowBlend,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
      const ringHalf = SPACE_RADIUS / 0.78
      const ringGlowGeo = new THREE.PlaneGeometry(ringHalf * 2, ringHalf * 2)
      const ringGlow = new THREE.Mesh(ringGlowGeo, ringGlowMat)
      ringGlow.rotation.x = -Math.PI / 2
      ringGlow.position.y = SPACE_TOP
      scene.add(ringGlow)
      disposables.push(ringTex, ringGlowMat, ringGlowGeo)

      const ringGroup = new THREE.Group()
      ringGroup.position.y = SPACE_TOP
      scene.add(ringGroup)
      const RING_COLORS = [hexIntOf(pal.bright), hexIntOf(pal.soft), ACCENT, hexIntOf(pal.pale)]
      const ringParticleColor = new THREE.Color()
      const makeRingParticles = (size: number, count: number) => {
        const pos = new Float32Array(count * 3)
        const col = new Float32Array(count * 3)
        for (let i = 0; i < count; i++) {
          const a = rand() * Math.PI * 2
          const r = SPACE_RADIUS + (rand() + rand() - 1) * 7
          pos[i * 3] = Math.cos(a) * r
          pos[i * 3 + 1] = (rand() + rand() - 1) * 3.5
          pos[i * 3 + 2] = Math.sin(a) * r
          ringParticleColor.setHex(RING_COLORS[Math.floor(rand() * RING_COLORS.length)]!)
          ringParticleColor.multiplyScalar(0.6 + rand() * 0.5)
          col[i * 3] = ringParticleColor.r
          col[i * 3 + 1] = ringParticleColor.g
          col[i * 3 + 2] = ringParticleColor.b
        }
        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
        const mat = new THREE.PointsMaterial({
          map: softDot,
          size,
          vertexColors: true,
          transparent: true,
          opacity: 0.8,
          depthWrite: false,
          blending: glowBlend,
          sizeAttenuation: true,
        })
        ringGroup.add(new THREE.Points(geo, mat))
        disposables.push(geo, mat)
      }
      makeRingParticles(4.6, 150)
      makeRingParticles(8.5, 55)

      const pulseMat = new THREE.SpriteMaterial({
        map: softDot,
        color: hexIntOf(pal.soft),
        transparent: true,
        opacity: 0.9,
        blending: glowBlend,
        depthWrite: false,
      })
      disposables.push(pulseMat)
      const pulse = new THREE.Sprite(pulseMat)
      pulse.scale.set(30, 30, 1)
      pulse.position.set(SPACE_RADIUS, SPACE_TOP, 0)
      scene.add(pulse)

      const basePts: import('three').Vector3[] = []
      for (let i = 0; i <= 96; i++) {
        const a = (i / 96) * Math.PI * 2
        basePts.push(
          new THREE.Vector3(Math.cos(a) * SPACE_RADIUS, SPACE_BASE, Math.sin(a) * SPACE_RADIUS),
        )
      }
      const baseGeo = new THREE.BufferGeometry().setFromPoints(basePts)
      const baseMat = new THREE.LineBasicMaterial({
        color: hexIntOf(pal.dimmed),
        transparent: true,
        opacity: 0.4,
      })
      scene.add(new THREE.Line(baseGeo, baseMat))
      disposables.push(baseGeo, baseMat)

      /* ── The galaxy: Sessions as soft swirling star particles.
       * Three Points groups give three particle sizes; each star keeps
       * cylindrical coords and rotates with differential speed (inner
       * stars faster) for galactic shear. Arrivals join the mid group. ── */
      interface StarGroup {
        size: number
        cap: number
        count: number
        write: number
        radius: Float32Array
        height: Float32Array
        angle: Float32Array
        speed: Float32Array
        pos: Float32Array
        geo: import('three').BufferGeometry
      }
      const starColor = new THREE.Color()
      const midHeight = (SPACE_BASE + SPACE_TOP) / 2
      const makeStarGroup = (size: number, cap: number, seedN: number): StarGroup => {
        const g: StarGroup = {
          size,
          cap,
          count: 0,
          write: 0,
          radius: new Float32Array(cap),
          height: new Float32Array(cap),
          angle: new Float32Array(cap),
          speed: new Float32Array(cap),
          pos: new Float32Array(cap * 3),
          geo: new THREE.BufferGeometry(),
        }
        const col = new Float32Array(cap * 3)
        for (let i = 0; i < seedN; i++) {
          const r = SPACE_RADIUS * Math.sqrt(rand()) * 0.96
          /* Lens profile: thick near the axis, thin at the rim. */
          const halfThick = (SPACE_TOP - SPACE_BASE) * 0.5 * (1 - (r / SPACE_RADIUS) * 0.55)
          const spread = (rand() + rand() + rand()) / 3 - 0.5
          g.radius[i] = r
          g.height[i] = midHeight + spread * 2 * halfThick
          g.angle[i] = rand() * Math.PI * 2
          g.speed[i] = (0.35 + rand() * 0.3) * (46 / (r + 34))
          starColor.setHex(starPalette[Math.floor(rand() * starPalette.length)]!)
          starColor.multiplyScalar(0.7 + rand() * 0.5)
          col[i * 3] = starColor.r
          col[i * 3 + 1] = starColor.g
          col[i * 3 + 2] = starColor.b
        }
        g.count = seedN
        g.write = seedN
        g.geo.setAttribute('position', new THREE.BufferAttribute(g.pos, 3))
        g.geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
        g.geo.setDrawRange(0, g.count)
        const mat = new THREE.PointsMaterial({
          map: softDot,
          size,
          vertexColors: true,
          transparent: true,
          opacity: darkMode ? 0.78 : 1,
          depthWrite: false,
          blending: glowBlend,
          sizeAttenuation: true,
        })
        const points = new THREE.Points(g.geo, mat)
        scene.add(points)
        disposables.push(g.geo, mat)
        return g
      }
      const sizeBoost = darkMode ? 1 : 1.2
      const galaxy: StarGroup[] = [
        makeStarGroup(9 * sizeBoost, 900, reduced ? 820 : 680),
        makeStarGroup(15 * sizeBoost, 620, reduced ? 500 : 380),
        makeStarGroup(24 * sizeBoost, 200, reduced ? 150 : 110),
      ]
      const addStar = (group: StarGroup, x: number, y: number, z: number, colorHex: number) => {
        const i = group.count < group.cap ? group.count : group.write % group.cap
        if (group.count < group.cap) group.count++
        group.write++
        group.radius[i] = Math.hypot(x, z)
        group.height[i] = y
        group.angle[i] = Math.atan2(z, x)
        group.speed[i] = (0.35 + rand() * 0.3) * (46 / (group.radius[i]! + 34))
        starColor.setHex(colorHex)
        const col = group.geo.attributes['color'] as import('three').BufferAttribute
        col.setXYZ(i, starColor.r, starColor.g, starColor.b)
        col.needsUpdate = true
        group.geo.setDrawRange(0, group.count)
      }
      const syncGalaxy = (dt: number) => {
        for (const g of galaxy) {
          for (let i = 0; i < g.count; i++) {
            g.angle[i]! += g.speed[i]! * dt
            g.pos[i * 3] = Math.cos(g.angle[i]!) * g.radius[i]!
            g.pos[i * 3 + 1] = g.height[i]!
            g.pos[i * 3 + 2] = Math.sin(g.angle[i]!) * g.radius[i]!
          }
          ;(g.geo.attributes['position'] as import('three').BufferAttribute).needsUpdate = true
        }
      }
      syncGalaxy(0)

      /* ── Ambient dust ── */
      const dustCount = 520
      const dustPos = new Float32Array(dustCount * 3)
      for (let i = 0; i < dustCount; i++) {
        const a = rand() * Math.PI * 2
        const r = 340 + rand() * 620
        dustPos[i * 3] = Math.cos(a) * r
        dustPos[i * 3 + 1] = -30 + rand() * 480
        dustPos[i * 3 + 2] = Math.sin(a) * r
      }
      const dustGeo = new THREE.BufferGeometry()
      dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3))
      const dustMat = new THREE.PointsMaterial({
        map: softDot,
        color: hexIntOf(mixRgb(pal.muted, pal.accent, 0.35)),
        size: 5,
        transparent: true,
        opacity: darkMode ? 0.26 : 0.12,
        depthWrite: false,
        blending: glowBlend,
        sizeAttenuation: true,
      })
      const dust = new THREE.Points(dustGeo, dustMat)
      scene.add(dust)
      disposables.push(dustGeo, dustMat)

      /* ── Sparks rising through the core ── */
      const sparkCount = 190
      const sparkPos = new Float32Array(sparkCount * 3)
      const sparkVel = new Float32Array(sparkCount)
      const resetSpark = (i: number, y?: number) => {
        const a = rand() * Math.PI * 2
        const r = rand() * (SPACE_RADIUS * 0.5)
        sparkPos[i * 3] = Math.cos(a) * r
        sparkPos[i * 3 + 1] = y ?? rand() * SPACE_TOP
        sparkPos[i * 3 + 2] = Math.sin(a) * r
        sparkVel[i] = 12 + rand() * 26
      }
      for (let i = 0; i < sparkCount; i++) resetSpark(i)
      const sparkGeo = new THREE.BufferGeometry()
      sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3))
      const sparkMat = new THREE.PointsMaterial({
        map: softDot,
        color: hexIntOf(pal.bright),
        size: 3.2,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        blending: glowBlend,
      })
      const sparks = new THREE.Points(sparkGeo, sparkMat)
      scene.add(sparks)
      disposables.push(sparkGeo, sparkMat)

      /* ── Laptops ── */
      const laptopBody = new THREE.MeshStandardMaterial({
        color: hexIntOf(darkMode ? pal.border : pal.muted),
        roughness: 0.5,
        metalness: 0.45,
      })
      const baseBoxGeo = new THREE.BoxGeometry(76, 3, 52)
      const lidGeo = new THREE.BoxGeometry(76, 50, 2.4)
      const screenGeo = new THREE.PlaneGeometry(68, 42)
      const edgeMat = new THREE.LineBasicMaterial({
        color: hexIntOf(
          darkMode ? mixRgb(pal.border2, WHITE, 0.18) : mixRgb(pal.muted, VOID_BLACK, 0.3),
        ),
        transparent: true,
        opacity: 0.5,
      })
      const baseEdgeGeo = new THREE.EdgesGeometry(baseBoxGeo)
      const lidEdgeGeo = new THREE.EdgesGeometry(lidGeo)
      disposables.push(laptopBody, baseBoxGeo, lidGeo, screenGeo, edgeMat, baseEdgeGeo, lidEdgeGeo)

      interface MachineNode {
        angle: number
        color: number
        pos: import('three').Vector3
        nextEmit: number
        screenMat: import('three').MeshBasicMaterial
      }
      const machines: MachineNode[] = []
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2 + 0.35
        const colorRgb = machineColors[i % machineColors.length]!
        const color = hexIntOf(colorRgb)
        const pos = new THREE.Vector3(
          Math.cos(angle) * MACHINE_RING,
          0,
          Math.sin(angle) * MACHINE_RING,
        )
        const group = new THREE.Group()
        group.position.copy(pos)
        group.lookAt(0, 0, 0)

        const base = new THREE.Mesh(baseBoxGeo, laptopBody)
        base.position.y = 1.5
        group.add(base)
        const baseEdge = new THREE.LineSegments(baseEdgeGeo, edgeMat)
        baseEdge.position.copy(base.position)
        group.add(baseEdge)

        const lid = new THREE.Mesh(lidGeo, laptopBody)
        lid.position.set(0, 24, -25)
        lid.rotation.x = -0.24
        group.add(lid)
        const lidEdge = new THREE.LineSegments(lidEdgeGeo, edgeMat)
        lidEdge.position.copy(lid.position)
        lidEdge.rotation.copy(lid.rotation)
        group.add(lidEdge)

        const screenTex = makeScreenTexture(THREE, colorRgb, 7 + i * 131)
        const screenMat = new THREE.MeshBasicMaterial({ map: screenTex })
        screenMat.color.setScalar(0.85)
        disposables.push(screenTex, screenMat)
        const screen = new THREE.Mesh(screenGeo, screenMat)
        screen.position.set(0, 24, -23.4)
        screen.rotation.x = -0.24
        group.add(screen)

        const spill = new THREE.PointLight(color, 5200, 260, 2)
        spill.position.set(0, 30, 20)
        group.add(spill)

        scene.add(group)
        machines.push({ angle, color, pos, nextEmit: 500 + i * 480, screenMat })
      }

      /* ── Session comets: soft glow heads + particle-chain tails. Each
       * tail vertex carries its own size and alpha so the trail fades out
       * with no hard line anywhere. ── */
      const TRAIL_VERT = `
        attribute float aSize;
        attribute float aAlpha;
        uniform float uScale;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (uScale / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `
      const TRAIL_FRAG = `
        uniform vec3 uColor;
        uniform sampler2D uMap;
        varying float vAlpha;
        void main() {
          gl_FragColor = vec4(uColor, vAlpha) * texture2D(uMap, gl_PointCoord);
        }
      `
      interface Flight {
        head: import('three').Sprite
        trail: import('three').Points
        trailGeo: import('three').BufferGeometry
        from: import('three').Vector3
        ctrl: import('three').Vector3
        to: import('three').Vector3
        start: number
        dur: number
        color: import('three').Color
        active: boolean
      }
      const flights: Flight[] = []
      const headMats = new Map<number, import('three').SpriteMaterial>()
      const trailMats = new Map<number, import('three').ShaderMaterial>()
      for (const c of machineColors.map(hexIntOf)) {
        if (!headMats.has(c)) {
          const hm = new THREE.SpriteMaterial({
            map: softDot,
            color: c,
            transparent: true,
            opacity: 0.95,
            blending: glowBlend,
            depthWrite: false,
          })
          headMats.set(c, hm)
          disposables.push(hm)
          const tm = new THREE.ShaderMaterial({
            vertexShader: TRAIL_VERT,
            fragmentShader: TRAIL_FRAG,
            uniforms: {
              uColor: { value: new THREE.Color(c) },
              uMap: { value: softDot },
              uScale: { value: 400 },
            },
            transparent: true,
            depthWrite: false,
            blending: glowBlend,
          })
          trailMats.set(c, tm)
          disposables.push(tm)
        }
      }
      const TRAIL_N = 22
      const spawnFlight = (m: MachineNode, now: number) => {
        const toAngle = m.angle + (rand() - 0.5) * 1.2
        const toR = SPACE_RADIUS - 12
        const toH = SPACE_BASE + 18 + rand() * (SPACE_TOP - SPACE_BASE - 36)
        const from = new THREE.Vector3(m.pos.x * 0.94, 30, m.pos.z * 0.94)
        const to = new THREE.Vector3(Math.cos(toAngle) * toR, toH, Math.sin(toAngle) * toR)
        const ctrl = new THREE.Vector3(
          (from.x + to.x) * 0.5,
          Math.max(from.y, to.y) + 120 + rand() * 70,
          (from.z + to.z) * 0.5,
        )
        let f = flights.find((fl) => !fl.active)
        if (!f) {
          const head = new THREE.Sprite(headMats.get(m.color)!)
          head.scale.set(15, 15, 1)
          const trailGeo = new THREE.BufferGeometry()
          trailGeo.setAttribute(
            'position',
            new THREE.BufferAttribute(new Float32Array(TRAIL_N * 3), 3),
          )
          const tSize = new Float32Array(TRAIL_N)
          const tAlpha = new Float32Array(TRAIL_N)
          for (let k = 0; k < TRAIL_N; k++) {
            const u = k / (TRAIL_N - 1)
            tSize[k] = 2 + Math.pow(u, 1.5) * 9.5
            tAlpha[k] = 0.04 + Math.pow(u, 1.4) * 0.6
          }
          trailGeo.setAttribute('aSize', new THREE.BufferAttribute(tSize, 1))
          trailGeo.setAttribute('aAlpha', new THREE.BufferAttribute(tAlpha, 1))
          const trail = new THREE.Points(trailGeo, trailMats.get(m.color)!)
          scene.add(head)
          scene.add(trail)
          disposables.push(trailGeo)
          f = {
            head,
            trail,
            trailGeo,
            from,
            ctrl,
            to,
            start: now,
            dur: 0,
            color: new THREE.Color(m.color),
            active: false,
          }
          flights.push(f)
        }
        f.head.material = headMats.get(m.color)!
        f.trail.material = trailMats.get(m.color)!
        f.color.set(m.color)
        f.from.copy(from)
        f.ctrl.copy(ctrl)
        f.to.copy(to)
        f.start = now
        f.dur = 1700 + rand() * 800
        f.active = true
        f.head.visible = true
        f.trail.visible = true
      }

      interface Flash {
        sprite: import('three').Sprite
        start: number
      }
      const flashes: Flash[] = []
      const flashMatProto = new THREE.SpriteMaterial({
        map: softDot,
        color: hexIntOf(pal.sparkle),
        transparent: true,
        blending: glowBlend,
        depthWrite: false,
      })
      disposables.push(flashMatProto)
      const spawnFlash = (
        pos: import('three').Vector3,
        color: import('three').Color,
        now: number,
      ) => {
        let fl = flashes.find((x) => !x.sprite.visible)
        if (!fl) {
          const sprite = new THREE.Sprite(flashMatProto.clone())
          scene.add(sprite)
          fl = { sprite, start: now }
          flashes.push(fl)
        }
        const mat = fl.sprite.material as import('three').SpriteMaterial
        mat.color.copy(color).lerp(new THREE.Color(0xffffff), 0.3)
        fl.sprite.position.copy(pos)
        fl.sprite.visible = true
        fl.start = now
      }

      const bez = (f: Flight, t: number, out: import('three').Vector3) => {
        const u = 1 - t
        out.set(
          u * u * f.from.x + 2 * u * t * f.ctrl.x + t * t * f.to.x,
          u * u * f.from.y + 2 * u * t * f.ctrl.y + t * t * f.to.y,
          u * u * f.from.z + 2 * u * t * f.ctrl.z + t * t * f.to.z,
        )
      }

      /* ── Composer: bloom ── */
      const composer = new EffectComposer(renderer)
      composer.addPass(new RenderPass(scene, camera))
      const bloom = new UnrealBloomPass(
        new THREE.Vector2(1, 1),
        darkMode ? 0.5 : 0,
        0.22,
        darkMode ? 0.52 : 1,
      )
      composer.addPass(bloom)

      /* ── Sizing / camera framing ── */
      const dprCap = 2
      const size = () => {
        const rect = canvas.getBoundingClientRect()
        const w = Math.max(2, rect.width)
        const h = Math.max(2, rect.height)
        const dpr = Math.min(dprCap, window.devicePixelRatio || 1)
        renderer.setPixelRatio(dpr)
        renderer.setSize(w, h, false)
        composer.setSize(w, h)
        bloom.setSize(w * dpr, h * dpr)
        camera.aspect = w / h
        if (align === 'right' && w >= 980) {
          camera.setViewOffset(w, h, -w * 0.12, 0, w, h)
        } else {
          camera.clearViewOffset()
        }
        camera.updateProjectionMatrix()
        for (const tm of trailMats.values()) {
          ;(tm.uniforms['uScale'] as { value: number }).value = h * dpr * 0.5
        }
        return rect
      }
      size()
      const ro = new ResizeObserver(() => {
        size()
        if (reduced) frame(0)
      })
      ro.observe(canvas)

      let running = true
      const io = new IntersectionObserver(([entry]) => {
        running = entry?.isIntersecting ?? true
      })
      io.observe(canvas)

      const camPos = new THREE.Vector3()
      const flightPos = new THREE.Vector3()
      let last = 0
      const frame = (now: number) => {
        const dt = Math.min(0.05, (now - last) / 1000)
        last = now
        const yaw = reduced ? 0.5 : 0.5 + Math.sin(now / 16000) * 0.32
        camPos.set(Math.sin(yaw) * 960, 385, Math.cos(yaw) * 960)
        camera.position.copy(camPos)
        camera.lookAt(lookAt)

        if (!reduced) syncGalaxy(dt * 0.55)

        dust.rotation.y = now / 90000
        ringGroup.rotation.y = reduced ? 0.4 : now / 9000
        const pulseA = reduced ? 1.1 : now / 2600
        pulse.position.set(
          Math.cos(pulseA) * SPACE_RADIUS,
          SPACE_TOP,
          Math.sin(pulseA) * SPACE_RADIUS,
        )

        if (!reduced) {
          for (let i = 0; i < sparkCount; i++) {
            sparkPos[i * 3 + 1]! += sparkVel[i]! * dt
            if (sparkPos[i * 3 + 1]! > SPACE_TOP + 40) resetSpark(i, 0)
          }
          sparkGeo.attributes['position']!.needsUpdate = true
        }

        machines.forEach((m, i) => {
          const pulse = reduced ? 1 : 0.9 + 0.14 * Math.sin(now / 1100 + i * 2.1)
          m.screenMat.color.setScalar(0.85 * pulse)
        })

        if (!reduced) {
          for (const f of flights) {
            if (!f.active) continue
            const t = (now - f.start) / f.dur
            if (t >= 1) {
              f.active = false
              f.head.visible = false
              f.trail.visible = false
              addStar(galaxy[1]!, f.to.x, f.to.y, f.to.z, f.color.getHex())
              spawnFlash(f.to, f.color, now)
              continue
            }
            const ease = t * t * (3 - 2 * t)
            bez(f, ease, flightPos)
            f.head.position.copy(flightPos)
            const attr = f.trailGeo.attributes['position'] as import('three').BufferAttribute
            for (let k = 0; k < TRAIL_N; k++) {
              const tt = Math.max(0, ease - 0.14 + (k / (TRAIL_N - 1)) * 0.14)
              bez(f, tt, flightPos)
              attr.setXYZ(k, flightPos.x, flightPos.y, flightPos.z)
            }
            attr.needsUpdate = true
          }

          for (const m of machines) {
            if (now >= m.nextEmit) {
              spawnFlight(m, now)
              m.nextEmit = now + 1700 + rand() * 2400
            }
          }

          for (const fl of flashes) {
            if (!fl.sprite.visible) continue
            const t = (now - fl.start) / 550
            if (t >= 1) {
              fl.sprite.visible = false
              continue
            }
            const s = 10 + t * 30
            fl.sprite.scale.set(s, s, 1)
            ;(fl.sprite.material as import('three').SpriteMaterial).opacity = 0.85 * (1 - t)
          }
        }

        composer.render()
      }

      let raf = 0
      if (reduced) {
        frame(0)
      } else {
        const loop = (now: number) => {
          if (running) frame(now)
          raf = requestAnimationFrame(loop)
        }
        raf = requestAnimationFrame(loop)
      }

      cleanup = () => {
        cancelAnimationFrame(raf)
        ro.disconnect()
        io.disconnect()
        for (const f of flights) f.trailGeo.dispose()
        for (const fl of flashes) (fl.sprite.material as import('three').SpriteMaterial).dispose()
        for (const d of disposables) d.dispose()
        composer.dispose()
        renderer.dispose()
      }
    })()

    return () => {
      alive = false
      cleanup?.()
    }
  }, [align, themeTick])

  return (
    <div className="hs-bg" aria-hidden>
      <canvas ref={canvasRef} className="hs-canvas" />
      <div className="hs-band hs-band-a" />
      <div className="hs-band hs-band-b" />
      {scrim && <div className="hs-scrim" />}
    </div>
  )
}
