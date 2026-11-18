/**
 * vessel.js — #vessel (1,000 → 4,000 m). Vesper, in real-time 3D.
 *
 * One pinned stage, three acts, scrubbed by scroll:
 *   Drawn  the submersible appears as a lines plan (stations, waterlines,
 *          buttocks) sliced from her own geometry, drawing outward from the
 *          pressure sphere, because everything on her is built around it.
 *   Built  surfaces grow out of the sphere through a noisy radial front with a
 *          photophore edge; the title fills in step with it; the camera orbits.
 *   Lit    22 lamps switch on bank by bank; additive beams, and marine snow
 *          that only shows where a beam catches it. One sonar ping.
 * Spec callouts are anchored to 3D points and projected every frame.
 * After the pin, a builder's plate with a side elevation drawn from the same
 * profile data. Vesper is procedural: no model files, no images.
 *
 * Emits: 'sonar' { x, y, strength: 0.5 } once, when the lamps are all on.
 * DOM hooks: .vessel--nogl (no WebGL → SVG elevation), .vessel--static
 * (reduced motion), .vessel--mobile. data-cursor="drag" on the 3D view.
 */
import '../styles/vessel.css'
import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  Group,
  Mesh,
  InstancedMesh,
  LineSegments,
  Points,
  BufferGeometry,
  BufferAttribute,
  SphereGeometry,
  CylinderGeometry,
  TorusGeometry,
  TubeGeometry,
  LatheGeometry,
  BoxGeometry,
  ConeGeometry,
  CircleGeometry,
  PlaneGeometry,
  ExtrudeGeometry,
  Shape,
  Vector2,
  Vector3,
  Vector4,
  Matrix4,
  Quaternion,
  Color,
  Plane,
  CatmullRomCurve3,
  MeshPhysicalMaterial,
  MeshBasicMaterial,
  ShaderMaterial,
  DirectionalLight,
  SpotLight,
  PMREMGenerator,
  CanvasTexture,
  ACESFilmicToneMapping,
  SRGBColorSpace,
  AdditiveBlending,
  DoubleSide,
  BackSide,
} from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

const DEG = Math.PI / 180
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const lerp = (a, b, t) => a + (b - a) * t
const range = (p, a, b) => clamp((p - a) / (b - a))
const ease = (t) => t * t * (3 - 2 * t)
const UP = new Vector3(0, 1, 0)
const v3 = (a) => new Vector3(a[0], a[1], a[2])

const PHOTOPHORE = '#6cf8e8'
const PHOTOPHORE_2 = '#3aa8ff'

/* ==========================================================================
   Vesper, in metres. x = fore, y = up, z = starboard.
   ========================================================================== */

const SPHERE = { x: 1.0, y: -0.5, r: 0.84, inner: 0.75 }
const CORE = new Vector3(SPHERE.x, SPHERE.y, 0)
const HULL = { depth: 0.9, bevelT: 0.32, bevelS: 0.2, cradle: 1.09 }
// Linear in x and y, so the flat side panels stay planar after the taper.
const widthAt = (x, y) => 0.93 + 0.055 * x - 0.06 * y
const sideZ = (x, y) => (HULL.depth / 2 + HULL.bevelT) * widthAt(x, y)

const SKID = [
  [-1.86, -1.34],
  [-1.25, -1.5],
  [0.6, -1.53],
  [1.48, -1.49],
  [1.8, -1.33],
  [1.88, -1.06],
]
const SKID_Z = 0.62
const POST = { a: [1.88, -1.08], b: [2.02, -0.02] }
const BROW_BAR = [
  [2.02, -0.02, -0.64],
  [2.1, -0.02, -0.32],
  [2.125, -0.02, 0],
  [2.1, -0.02, 0.32],
  [2.02, -0.02, 0.64],
]
const ARM = [
  [1.56, -1.4, 0.38],
  [1.96, -1.02, 0.44],
  [2.26, -1.3, 0.42],
]
const VIEWPORT_DIRS = [
  [0.93, -0.36, 0.0],
  [0.68, -0.5, 0.54],
  [0.68, -0.5, -0.54],
].map((d) => v3(d).normalize())

const THRUSTERS = [
  // aft cluster, two tail bars, ducts facing aft
  { p: [-2.02, 0.46, 0.8], d: [-1, 0, 0], s: 1.15 },
  { p: [-2.02, 0.46, -0.8], d: [-1, 0, 0], s: 1.15 },
  { p: [-1.92, -0.3, 0.76], d: [-1, 0, 0], s: 1.0 },
  { p: [-1.92, -0.3, -0.76], d: [-1, 0, 0], s: 1.0 },
  // vertical, recessed into the deck (y and tilt are resolved from the profile)
  { p: [-1.36, 0, 0.24], d: [0, 1, 0], s: 0.82, deck: true },
  { p: [-1.36, 0, -0.24], d: [0, 1, 0], s: 0.82, deck: true },
  { p: [-0.52, 0, 0.24], d: [0, 1, 0], s: 0.82, deck: true },
  { p: [-0.52, 0, -0.24], d: [0, 1, 0], s: 0.82, deck: true },
  // lateral tunnels, set into the side panels
  { p: [-1.38, 0.0, 0], d: [0, 0, 1], s: 0.9, side: 1 },
  { p: [-1.38, 0.0, 0], d: [0, 0, -1], s: 0.9, side: -1 },
]

// Lamp banks: 10 on the brow bar, 8 low (frame posts + arm), 4 on the boom.
const LAMPS = (() => {
  const L = []
  for (let i = 0; i < 10; i++) {
    const z = -0.58 + (1.16 * i) / 9
    const x = 2.11 - 0.1 * (z / 0.6) ** 2
    L.push({ p: [x + 0.02, -0.075, z], d: [0.82, -0.5, 0.28 * z], bank: 0 })
  }
  for (const s of [1, -1]) {
    for (let i = 0; i < 3; i++) {
      const t = 0.22 + i * 0.2
      const y = lerp(POST.a[1], POST.b[1], t)
      const x = lerp(POST.a[0], POST.b[0], t)
      L.push({ p: [x + 0.06, y, s * (SKID_Z + 0.02)], d: [0.9, -0.28, 0.12 * s], bank: 1 })
    }
  }
  L.push({ p: [2.1, -1.08, 0.5], d: [0.9, -0.4, 0.1], bank: 1 })
  L.push({ p: [2.1, -1.08, 0.36], d: [0.9, -0.4, 0.0], bank: 1 })
  for (let i = 0; i < 4; i++) {
    const z = -0.35 + (i - 1.5) * 0.085
    L.push({ p: [2.2, 1.11, z], d: [0.78, -0.62, 0], bank: 2 })
  }
  return L.map((l) => ({ ...l, p: v3(l.p), d: v3(l.d).normalize() }))
})()

const BEAMS = [
  { o: [2.1, -0.09, -0.36], d: [0.8, -0.5, -0.13], a: 19, len: 9, bank: 0 },
  { o: [2.14, -0.09, 0.0], d: [0.84, -0.5, 0.0], a: 21, len: 10, bank: 0 },
  { o: [2.1, -0.09, 0.36], d: [0.8, -0.5, 0.13], a: 19, len: 9, bank: 0 },
  { o: [1.98, -0.85, 0.64], d: [0.9, -0.3, 0.1], a: 15, len: 7, bank: 1 },
  { o: [1.98, -0.85, -0.64], d: [0.9, -0.3, -0.1], a: 15, len: 7, bank: 1 },
  { o: [2.24, 1.08, -0.35], d: [0.76, -0.64, 0], a: 13, len: 8, bank: 2 },
].map((b) => ({ ...b, o: v3(b.o), d: v3(b.d).normalize() }))

/* --------------------------------------------------------- hull profile */

function chaikin(pts, iterations) {
  let p = pts
  for (let k = 0; k < iterations; k++) {
    const out = []
    for (let i = 0; i < p.length; i++) {
      const a = p[i]
      const b = p[(i + 1) % p.length]
      out.push(new Vector2(a.x * 0.75 + b.x * 0.25, a.y * 0.75 + b.y * 0.25))
      out.push(new Vector2(a.x * 0.25 + b.x * 0.75, a.y * 0.25 + b.y * 0.75))
    }
    p = out
  }
  return p
}

let OUTLINE = null
/** Side profile of the foam body (before the edge round), counter-clockwise.
 *  A cradle is cut out of the front for the sphere. */
function hullOutline() {
  if (OUTLINE) return OUTLINE
  const R = HULL.cradle
  const P = (deg) => new Vector3(SPHERE.x + R * Math.cos(deg * DEG), SPHERE.y + R * Math.sin(deg * DEG), 0)
  const ctrl = [
    P(40),
    [1.9, 0.42],
    [1.74, 0.72],
    [1.45, 0.93],
    [0.9, 1.08],
    [0.2, 1.13],
    [-0.6, 1.06],
    [-1.35, 0.86],
    [-1.85, 0.55],
    [-2.08, 0.18],
    [-2.05, -0.18],
    [-1.8, -0.45],
    [-1.3, -0.68],
    [-0.6, -0.9],
    [-0.1, -1.08],
    P(220),
  ].map((c) => (c.isVector3 ? c : new Vector3(c[0], c[1], 0)))
  const outer = new CatmullRomCurve3(ctrl, false, 'centripetal').getSpacedPoints(110)
  const pts = outer.map((v) => new Vector2(v.x, v.y))
  const N = 56
  for (let i = 1; i < N; i++) {
    const a = (220 - (180 * i) / N) * DEG
    pts.push(new Vector2(SPHERE.x + R * Math.cos(a), SPHERE.y + R * Math.sin(a)))
  }
  OUTLINE = chaikin(pts, 2)
  return OUTLINE
}

/** Outward offset of a closed CCW polyline (the silhouette after the edge round). */
function offsetOutline(pts, d) {
  const n = pts.length
  return pts.map((p, i) => {
    const a = pts[(i - 1 + n) % n]
    const b = pts[(i + 1) % n]
    const tx = b.x - a.x
    const ty = b.y - a.y
    const l = Math.hypot(tx, ty) || 1
    return new Vector2(p.x + (ty / l) * d, p.y - (tx / l) * d)
  })
}

/** [lowest, highest] y of the profile at x (before the edge round). */
function profileAt(x) {
  const pts = hullOutline()
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    if ((a.x - x) * (b.x - x) <= 0 && a.x !== b.x) {
      const y = a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x)
      lo = Math.min(lo, y)
      hi = Math.max(hi, y)
    }
  }
  return [lo, hi]
}

/** Deck surface (after the edge round) at x: height and outward normal. */
function deckAt(x) {
  const y = profileAt(x)[1] + HULL.bevelS
  const slope = (profileAt(x + 0.05)[1] - profileAt(x - 0.05)[1]) / 0.1
  return { y, n: new Vector3(-slope, 1, 0).normalize() }
}

/* ==========================================================================
   Side elevation (SVG): the builder's plate drawing, and the no-WebGL view.
   ========================================================================== */

function elevationSVG(variant) {
  const K = 100
  const X0 = -2.55
  const Y0 = 1.72
  const X = (x) => ((x - X0) * K).toFixed(1)
  const Y = (y) => ((Y0 - y) * K).toFixed(1)
  const W = 5.15 * K
  const H = (Y0 + 2.18) * K
  const poly = (pts, close) => 'M' + pts.map((p) => `${X(p.x ?? p[0])} ${Y(p.y ?? p[1])}`).join('L') + (close ? 'Z' : '')
  const sil = offsetOutline(hullOutline(), HULL.bevelS)
  const skid = new CatmullRomCurve3(SKID.map((s) => new Vector3(s[0], s[1], 0))).getPoints(40)
  const S = SPHERE
  const out = []
  out.push(`<svg class="ve ve--${variant}" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" fill="none" aria-hidden="true" focusable="false">`)
  out.push(`<defs><clipPath id="ve-clip-${variant}"><path d="${poly(sil, true)}"/></clipPath></defs>`)
  // waterline grid
  out.push('<g class="ve-grid">')
  for (let x = -2.5; x <= 2.51; x += 0.5) out.push(`<line x1="${X(x)}" y1="${Y(1.62)}" x2="${X(x)}" y2="${Y(-1.62)}"/>`)
  for (let y = -1.5; y <= 1.51; y += 0.5) out.push(`<line x1="${X(-2.5)}" y1="${Y(y)}" x2="${X(2.5)}" y2="${Y(y)}"/>`)
  out.push('</g>')
  // hull
  out.push(`<path class="ve-hull" d="${poly(sil, true)}"/>`)
  out.push(`<path class="ve-cap" d="${poly(hullOutline(), true)}"/>`)
  out.push(`<g class="ve-seam" clip-path="url(#ve-clip-${variant})">`)
  out.push(`<line x1="${X(-1.18)}" y1="${Y(1.6)}" x2="${X(-1.18)}" y2="${Y(-1.6)}"/>`)
  out.push(`<line x1="${X(0.12)}" y1="${Y(1.6)}" x2="${X(0.12)}" y2="${Y(-1.6)}"/>`)
  out.push(`<line x1="${X(-2.6)}" y1="${Y(0.42)}" x2="${X(1.55)}" y2="${Y(0.42)}"/>`)
  out.push('</g>')
  // hatch + boom
  const top1 = profileAt(1.0)[1] + HULL.bevelS
  out.push(`<path class="ve-part" d="M${X(0.7)} ${Y(top1)}L${X(0.72)} ${Y(top1 + 0.09)}L${X(1.28)} ${Y(top1 + 0.09)}L${X(1.3)} ${Y(top1)}"/>`)
  const mastY = profileAt(1.5)[1] + HULL.bevelS - 0.02
  out.push(`<path class="ve-part" d="M${X(1.5)} ${Y(mastY)}L${X(2.2)} ${Y(1.17)}"/>`)
  out.push(`<rect class="ve-part" x="${X(2.12)}" y="${Y(1.24)}" width="${(0.14 * K).toFixed(1)}" height="${(0.13 * K).toFixed(1)}" rx="2"/>`)
  // thrusters
  for (const t of THRUSTERS) {
    if (t.p[2] < 0 && t.d[2] === 0) continue
    const s = t.s
    if (t.d[0] !== 0) out.push(`<rect class="ve-part" x="${X(t.p[0] - 0.1 * s)}" y="${Y(t.p[1] + 0.165 * s)}" width="${(0.2 * s * K).toFixed(1)}" height="${(0.33 * s * K).toFixed(1)}" rx="3"/>`)
    else if (t.deck) {
      const dy = deckAt(t.p[0]).y
      out.push(`<rect class="ve-part" x="${X(t.p[0] - 0.165 * s)}" y="${Y(dy + 0.05)}" width="${(0.33 * s * K).toFixed(1)}" height="${(0.06 * K).toFixed(1)}" rx="2"/>`)
    }
    else if (t.side === 1) out.push(`<circle class="ve-part" cx="${X(t.p[0])}" cy="${Y(t.p[1])}" r="${(0.15 * s * K).toFixed(1)}"/>`)
  }
  out.push(`<path class="ve-part" d="M${X(-2.02)} ${Y(0.46)}L${X(-1.7)} ${Y(0.46)}M${X(-1.92)} ${Y(-0.3)}L${X(-1.6)} ${Y(-0.3)}"/>`)
  // frame, skids, arm, ballast
  out.push(`<path class="ve-part" d="${poly(skid)}"/>`)
  out.push(`<path class="ve-part" d="M${X(POST.a[0])} ${Y(POST.a[1])}L${X(POST.b[0])} ${Y(POST.b[1])}"/>`)
  for (const x of [-1.3, -0.25]) out.push(`<path class="ve-part" d="M${X(x)} ${Y(-1.5)}L${X(x)} ${Y(profileAt(x)[0] - HULL.bevelS + 0.04)}"/>`)
  out.push(`<circle class="ve-part" cx="${X(2.125)}" cy="${Y(-0.02)}" r="4"/>`)
  out.push(`<path class="ve-part" d="${poly(ARM.map((a) => [a[0], a[1]]))}L${X(2.32)} ${Y(-1.44)}"/>`)
  out.push(`<rect class="ve-part" x="${X(-1.08)}" y="${Y(-1.08)}" width="${(0.52 * K).toFixed(1)}" height="${(0.17 * K).toFixed(1)}" rx="3"/>`)
  // sphere
  out.push(`<circle class="ve-sphere" cx="${X(S.x)}" cy="${Y(S.y)}" r="${(S.r * K).toFixed(1)}"/>`)
  out.push(`<circle class="ve-sphere-in" cx="${X(S.x)}" cy="${Y(S.y)}" r="${(S.inner * K).toFixed(1)}"/>`)
  out.push(`<line class="ve-sphere-in" x1="${X(S.x - S.r)}" y1="${Y(S.y)}" x2="${X(S.x + S.r)}" y2="${Y(S.y)}"/>`)
  const vd = VIEWPORT_DIRS[0]
  const vp = (r, a) => [S.x + Math.cos(Math.atan2(vd.y, vd.x) + a) * r, S.y + Math.sin(Math.atan2(vd.y, vd.x) + a) * r]
  out.push(`<path class="ve-port" d="${poly([vp(S.r + 0.01, -0.2), vp(S.r - 0.17, -0.09), vp(S.r - 0.17, 0.09), vp(S.r + 0.01, 0.2)])}"/>`)
  // dimensions
  const dy = -1.86
  const xl = -2.28
  const xr = 2.32
  out.push('<g class="ve-dim">')
  out.push(`<path d="M${X(xl)} ${Y(dy + 0.1)}L${X(xl)} ${Y(dy - 0.1)}M${X(xr)} ${Y(dy + 0.1)}L${X(xr)} ${Y(dy - 0.1)}M${X(xl)} ${Y(dy)}L${X(-0.32)} ${Y(dy)}M${X(0.36)} ${Y(dy)}L${X(xr)} ${Y(dy)}"/>`)
  out.push(`<path d="M${X(xl + 0.09)} ${Y(dy + 0.045)}L${X(xl)} ${Y(dy)}L${X(xl + 0.09)} ${Y(dy - 0.045)}M${X(xr - 0.09)} ${Y(dy + 0.045)}L${X(xr)} ${Y(dy)}L${X(xr - 0.09)} ${Y(dy - 0.045)}"/>`)
  out.push(`<text x="${X(0.02)}" y="${Y(dy - 0.055)}" text-anchor="middle">4.6 m</text>`)
  out.push(`<path d="M${X(S.x)} ${Y(S.y + S.inner)}L${X(S.x)} ${Y(1.5)}L${X(S.x + 0.5)} ${Y(1.5)}"/>`)
  out.push(`<text x="${X(S.x + 0.56)}" y="${Y(1.5 - 0.055)}">1.5 m inside</text>`)
  out.push('</g>')
  out.push('</svg>')
  return out.join('')
}

/* ==========================================================================
   Geometry helpers
   ========================================================================== */

/** Non-indexed clone with position + normal only, so anything can be merged. */
function prep(g) {
  const out = g.index ? g.toNonIndexed() : g.clone()
  for (const k of Object.keys(out.attributes)) if (k !== 'position' && k !== 'normal') out.deleteAttribute(k)
  return out
}
function placed(g, pos, quat, scale) {
  const m = new Matrix4().compose(pos || new Vector3(), quat || new Quaternion(), scale || new Vector3(1, 1, 1))
  return prep(g).applyMatrix4(m)
}
const aim = (dir) => new Quaternion().setFromUnitVectors(UP, dir.clone().normalize())
function rod(a, b, r, seg = 14, r2 = r) {
  const d = b.clone().sub(a)
  return placed(new CylinderGeometry(r2, r, d.length(), seg, 1, false), a.clone().lerp(b, 0.5), aim(d))
}
function merge(list) {
  return mergeGeometries(list.map(prep), false)
}

function hullGeometry() {
  const shape = new Shape(hullOutline())
  let g = new ExtrudeGeometry(shape, {
    depth: HULL.depth,
    steps: 1,
    curveSegments: 1,
    bevelEnabled: true,
    bevelThickness: HULL.bevelT,
    bevelSize: HULL.bevelS,
    bevelSegments: 9,
  })
  g.translate(0, 0, -HULL.depth / 2)
  const pos = g.attributes.position
  for (let i = 0; i < pos.count; i++) pos.setZ(i, pos.getZ(i) * widthAt(pos.getX(i), pos.getY(i)))
  g.deleteAttribute('normal')
  g.deleteAttribute('uv')
  g = mergeVertices(g, 1e-4)
  g.computeVertexNormals()
  return g
}

/** A ducted thruster along +y: duct + stators (satin) and hub + blades (dark). */
function thrusterGeometry() {
  const L = 0.2
  const ri = 0.13
  const ro = 0.165
  const prof = []
  for (let i = 0; i <= 10; i++) {
    const t = i / 10
    prof.push(new Vector2(ri + 0.012 * (2 * t - 1) ** 2, -L / 2 + L * t))
  }
  for (let i = 1; i < 8; i++) {
    const a = (Math.PI * i) / 8
    prof.push(new Vector2((ri + ro) / 2 - (Math.cos(a) * (ro - ri)) / 2, L / 2 + Math.sin(a) * 0.014))
  }
  for (let i = 10; i >= 0; i--) {
    const t = i / 10
    prof.push(new Vector2(ro - 0.008 * (1 - t), -L / 2 + L * t))
  }
  for (let i = 1; i < 8; i++) {
    const a = (Math.PI * i) / 8
    prof.push(new Vector2((ri + ro) / 2 + (Math.cos(a) * (ro - ri)) / 2, -L / 2 - Math.sin(a) * 0.02))
  }
  prof.push(prof[0].clone())
  const duct = new LatheGeometry(prof, 40)
  const satin = [
    new TorusGeometry((ri + ro) / 2, 0.012, 8, 40).rotateX(Math.PI / 2).translate(0, L / 2 + 0.004, 0),
    new TorusGeometry((ri + ro) / 2, 0.01, 8, 40).rotateX(Math.PI / 2).translate(0, -L / 2 - 0.006, 0),
  ]
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.3
    const b = new BoxGeometry(0.1, 0.012, 0.014)
    b.translate(0.085, -L * 0.32, 0)
    b.rotateY(a)
    satin.push(b)
  }
  satin.push(new CylinderGeometry(0.038, 0.046, 0.15, 18), new SphereGeometry(0.038, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.075, 0))
  for (let k = 0; k < 5; k++) {
    const b = new BoxGeometry(0.09, 0.008, 0.042)
    b.rotateX(0.55)
    b.translate(0.078, 0.02, 0)
    b.rotateY((k / 5) * Math.PI * 2)
    satin.push(b)
  }
  return { satin: merge(satin), dark: merge([duct]) }
}

/* ==========================================================================
   Materials: one patch adds the "built" reveal (and panel seams on the hull)
   ========================================================================== */

const GLSL_NOISE = /* glsl */ `
float vsH(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vsNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(vsH(i), vsH(i + vec3(1,0,0)), f.x), mix(vsH(i + vec3(0,1,0)), vsH(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(vsH(i + vec3(0,0,1)), vsH(i + vec3(1,0,1)), f.x), mix(vsH(i + vec3(0,1,1)), vsH(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float vsSeam(float d) { float w = fwidth(d); return 1.0 - smoothstep(0.0035, 0.0035 + w * 1.6, abs(d)); }
`

function patch(mat, U, variant, { seams = false, ao = '', lens = false, brushed = false, cabin = false } = {}) {
  mat.customProgramCacheKey = () => 'vesper-' + variant
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uBuild = U.uBuild
    sh.uniforms.uRootInv = U.uRootInv
    sh.uniforms.uCore = U.uCore
    sh.uniforms.uEdge = U.uEdge
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform mat4 uRootInv;\nvarying vec3 vLocal;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec4 vsLp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          vsLp = instanceMatrix * vsLp;
        #endif
        vLocal = (uRootInv * modelMatrix * vsLp).xyz;`,
      )
    let frag = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        ${seams ? '#define VESPER_SEAMS' : ''}
        ${ao === 'hull' ? '#define VESPER_AO_HULL' : ''}
        ${ao === 'sphere' ? '#define VESPER_AO_SPHERE' : ''}
        ${lens ? '#define VESPER_LENS' : ''}
        ${brushed ? '#define VESPER_BRUSHED' : ''}
        ${cabin ? '#define VESPER_CABIN' : ''}
        uniform float uBuild; uniform vec3 uCore; uniform vec3 uEdge; varying vec3 vLocal;
        ${GLSL_NOISE}`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        float vsN = vsNoise(vLocal * 3.1) * 0.6 + vsNoise(vLocal * 9.0) * 0.4;
        float vsD = length(vLocal - uCore) + (vsN - 0.5) * 0.55;
        float vsR = uBuild * 4.4 - 0.3;
        if (vsD > vsR) discard;
        float vsEdge = (1.0 - smoothstep(0.0, 0.14, vsR - vsD)) * (1.0 - step(0.999, uBuild));`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float vsSm = 0.0;
        float vsStreak = 0.5;
        #ifdef VESPER_BRUSHED
          // a machined, bead-blasted sphere: fine turning rings around its
          // axis and a matte grain, never a mirror
          vec3 vsQ = vLocal - uCore;
          float vsLat = atan(vsQ.y, length(vsQ.xz));
          vsStreak = vsNoise(vec3(vsLat * 160.0, vsQ.x * 1.5, vsQ.z * 1.5)) * 0.7 + vsNoise(vLocal * 55.0) * 0.3;
          diffuseColor.rgb *= 0.9 + 0.16 * vsStreak;
        #endif
        #ifdef VESPER_SEAMS
          vsSm = max(vsSm, vsSeam(vLocal.x + 1.18));
          vsSm = max(vsSm, vsSeam(vLocal.x - 0.12));
          vsSm = max(vsSm, vsSeam(vLocal.x + 0.55) * step(0.42, vLocal.y));
          vsSm = max(vsSm, vsSeam(vLocal.y - 0.42) * step(vLocal.x, 1.55));
          vsSm = max(vsSm, vsSeam(vLocal.y + 0.62) * step(vLocal.x, 0.05));
          vsSm = max(vsSm, vsSeam(vLocal.z) * step(1.0, vLocal.y));
          diffuseColor.rgb *= 1.0 - 0.75 * vsSm;
          diffuseColor.rgb *= mix(0.62, 1.08, smoothstep(-1.5, 1.3, vLocal.y));
        #endif`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        #ifdef VESPER_LENS
          totalEmissiveRadiance *= pow(clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
        #endif
        #ifdef VESPER_CABIN
          totalEmissiveRadiance *= smoothstep(-0.7, 0.85, (vLocal.y - uCore.y) / 0.75);
        #endif
        totalEmissiveRadiance += uEdge * vsEdge * 2.6;`,
      )
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
        float vsAO = 1.0;
        #ifdef VESPER_AO_HULL
          vsAO *= mix(0.22, 1.0, smoothstep(0.86, 1.32, length(vLocal.xy - uCore.xy)));
          vsAO *= mix(0.5, 1.0, smoothstep(-1.45, -0.1, vLocal.y));
        #endif
        #ifdef VESPER_AO_SPHERE
          vec3 vsDir = normalize(vLocal - uCore);
          float vsIn = smoothstep(0.3, -0.35, dot(vsDir.xy, vec2(0.8, -0.6))) * smoothstep(0.95, 0.62, abs(vsDir.z));
          vsAO *= 1.0 - 0.82 * vsIn;
          vsAO *= mix(0.55, 1.0, smoothstep(-0.95, 0.2, vsDir.y));
        #endif
        reflectedLight.indirectDiffuse *= vsAO;
        reflectedLight.indirectSpecular *= vsAO;
        reflectedLight.directDiffuse *= vsAO;
        reflectedLight.directSpecular *= mix(1.0, vsAO, 0.75);`,
      )
    if (seams) {
      frag = frag.replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + vsSm * 0.5 + (vsNoise(vLocal * 22.0) - 0.5) * 0.08, 0.0, 1.0);`,
      )
    } else if (brushed) {
      frag = frag.replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + (vsStreak - 0.5) * 0.2, 0.0, 1.0);`,
      )
    }
    sh.fragmentShader = frag
  }
  return mat
}

/* ==========================================================================
   Blueprint: slice every part with stations, waterlines and buttocks
   ========================================================================== */

const PLANES = (() => {
  const P = []
  for (let x = -2.2; x <= 2.32; x += 0.22) P.push([1, 0, 0, x])
  for (let y = -1.46; y <= 1.4; y += 0.24) P.push([0, 1, 0, y])
  for (const z of [0, -0.38, 0.38, -0.64, 0.64]) P.push([0, 0, 1, z])
  return P
})()

function sliceInto(out, src) {
  const geo = src.index ? src.toNonIndexed() : src
  const pos = geo.attributes.position.array
  geo.computeBoundingBox()
  const bb = geo.boundingBox
  for (const [nx, ny, nz, d] of PLANES) {
    const lo = nx * bb.min.x + ny * bb.min.y + nz * bb.min.z
    const hi = nx * bb.max.x + ny * bb.max.y + nz * bb.max.z
    if (d < lo || d > hi) continue
    for (let i = 0; i < pos.length; i += 9) {
      const da = nx * pos[i] + ny * pos[i + 1] + nz * pos[i + 2] - d
      const db = nx * pos[i + 3] + ny * pos[i + 4] + nz * pos[i + 5] - d
      const dc = nx * pos[i + 6] + ny * pos[i + 7] + nz * pos[i + 8] - d
      const sa = da >= 0
      const sb = db >= 0
      const sc = dc >= 0
      if (sa === sb && sb === sc) continue
      let n = 0
      const pt = (o1, o2, t) => {
        out.push(pos[o1] + (pos[o2] - pos[o1]) * t, pos[o1 + 1] + (pos[o2 + 1] - pos[o1 + 1]) * t, pos[o1 + 2] + (pos[o2 + 2] - pos[o1 + 2]) * t)
        n++
      }
      if (sa !== sb) pt(i, i + 3, da / (da - db))
      if (sb !== sc) pt(i + 3, i + 6, db / (db - dc))
      if (sc !== sa && n < 2) pt(i + 6, i, dc / (dc - da))
      if (n !== 2) out.length -= n * 3
    }
  }
}

function blueprintGeometry(geos) {
  const seg = []
  for (const g of geos) sliceInto(seg, g)
  const count = seg.length / 3
  const aSeg = new Float32Array(count * 2)
  const maxD = 3.5
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < count; i += 2) {
    const mx = (seg[i * 3] + seg[i * 3 + 3]) / 2 - CORE.x
    const my = (seg[i * 3 + 1] + seg[i * 3 + 4]) / 2 - CORE.y
    const mz = (seg[i * 3 + 2] + seg[i * 3 + 5]) / 2 - CORE.z
    const delay = clamp(Math.hypot(mx, my, mz) / maxD) * 0.86 + rnd() * 0.012
    aSeg[i * 2] = delay
    aSeg[i * 2 + 1] = 0
    aSeg[i * 2 + 2] = delay
    aSeg[i * 2 + 3] = 1
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(seg), 3))
  g.setAttribute('aSeg', new BufferAttribute(aSeg, 2))
  return g
}

/* ==========================================================================
   Shaders for light: blueprint lines, beams, snow, lamp flares
   ========================================================================== */

function lineMaterial() {
  return new ShaderMaterial({
    uniforms: { uDraw: { value: 0 }, uAlpha: { value: 1 }, uDist: { value: 20 }, uColor: { value: new Color(PHOTOPHORE) } },
    vertexShader: /* glsl */ `
      attribute vec2 aSeg;
      uniform float uDist;
      varying float vT; varying float vDelay; varying float vFade;
      void main() {
        vT = aSeg.y; vDelay = aSeg.x;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        // near side bright, far side dim: depth read the way a draughtsman would
        vFade = smoothstep(uDist + 3.5, uDist - 3.0, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uDraw; uniform float uAlpha; uniform vec3 uColor;
      varying float vT; varying float vDelay; varying float vFade;
      void main() {
        float local = clamp((uDraw - vDelay) / 0.16, 0.0, 1.0);
        if (local <= 0.0 || vT > local) discard;
        float tip = (1.0 - smoothstep(0.0, 0.3, local - vT)) * (1.0 - step(0.999, local));
        float a = uAlpha * (0.28 + 0.72 * vFade) * (0.62 + tip * 1.8);
        gl_FragColor = vec4(uColor * (1.0 + tip), a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  })
}

function beamMaterial() {
  return new ShaderMaterial({
    uniforms: { uI: { value: 0 }, uTime: { value: 0 }, uColor: { value: new Color('#d8f4ff') } },
    vertexShader: /* glsl */ `
      varying float vAlong; varying vec3 vN; varying vec3 vV;
      void main() {
        vAlong = -position.y;
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uI; uniform float uTime; uniform vec3 uColor;
      varying float vAlong; varying vec3 vN; varying vec3 vV;
      void main() {
        float f = abs(dot(normalize(vN), normalize(vV)));
        float dust = 0.78 + 0.22 * sin(vAlong * 23.0 - uTime * 0.7) * sin(vAlong * 9.0 + uTime * 0.4 + f * 3.0);
        float a = uI * pow(f, 2.4) * pow(1.0 - vAlong, 2.0) * smoothstep(0.0, 0.07, vAlong) * dust * 0.2;
        gl_FragColor = vec4(uColor, a);
      }`,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
  })
}

function snowMaterial(dpr) {
  const zeros = () => Array.from({ length: 6 }, () => new Vector4())
  return new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uMin: { value: new Vector3(1.6, -6.4, -3.2) },
      uSize: { value: new Vector3(8.0, 7.8, 6.4) },
      uBO: { value: zeros() },
      uBD: { value: zeros() },
      uBL: { value: new Array(6).fill(8) },
      uPx: { value: 26 * dpr },
      uBase: { value: 0.0 },
      uColor: { value: new Color('#e4fbff') },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aRand;
      uniform float uTime; uniform vec3 uMin; uniform vec3 uSize;
      uniform vec4 uBO[6]; uniform vec4 uBD[6]; uniform float uBL[6];
      uniform float uPx;
      varying float vI;
      void main() {
        vec3 p = position;
        p.y = uMin.y + mod(p.y - uMin.y - uTime * (0.02 + 0.05 * aRand.x), uSize.y);
        p.x += sin(uTime * (0.2 + 0.3 * aRand.y) + aRand.z * 6.2831) * 0.07;
        p.z += cos(uTime * (0.15 + 0.25 * aRand.z) + aRand.y * 6.2831) * 0.07;
        float I = 0.0;
        for (int i = 0; i < 6; i++) {
          vec3 v = p - uBO[i].xyz;
          float along = dot(v, uBD[i].xyz);
          float c = along / max(length(v), 1e-4);
          float cone = smoothstep(uBD[i].w - 0.012, uBD[i].w + 0.045, c);
          float fall = clamp(1.0 - along / uBL[i], 0.0, 1.0);
          I += uBO[i].w * cone * fall * fall * step(0.0, along);
        }
        vI = I;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(uPx * 2.4 * (0.6 + 1.6 * aRand.w) / -mv.z, 1.0, 26.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uBase;
      varying float vI;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.05, d);
        float k = a * (min(vI, 1.4) * 1.7 + uBase);
        if (k < 0.002) discard;
        gl_FragColor = vec4(uColor, k);
      }`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  })
}

function flareTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  r.addColorStop(0, 'rgba(255,255,255,1)')
  r.addColorStop(0.12, 'rgba(230,250,255,0.85)')
  r.addColorStop(0.35, 'rgba(160,230,255,0.22)')
  r.addColorStop(1, 'rgba(120,210,255,0)')
  g.fillStyle = r
  g.fillRect(0, 0, 128, 128)
  // a faint horizontal streak, like a lens
  const s = g.createLinearGradient(0, 0, 128, 0)
  s.addColorStop(0, 'rgba(180,240,255,0)')
  s.addColorStop(0.5, 'rgba(220,250,255,0.55)')
  s.addColorStop(1, 'rgba(180,240,255,0)')
  g.fillStyle = s
  g.fillRect(0, 62.5, 128, 3)
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  return t
}

function flareMaterial(dpr) {
  return new ShaderMaterial({
    uniforms: { uBanks: { value: new Vector3() }, uPx: { value: 46 * dpr }, uMap: { value: flareTexture() } },
    vertexShader: /* glsl */ `
      attribute float aBank;
      uniform vec3 uBanks; uniform float uPx;
      varying float vI;
      void main() {
        float I = aBank < 0.5 ? uBanks.x : (aBank < 1.5 ? uBanks.y : uBanks.z);
        vI = I;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = I > 0.01 ? uPx * (0.55 + 0.45 * min(I, 1.3)) * min(19.0 / -mv.z, 1.35) : 0.0;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      varying float vI;
      void main() {
        vec4 t = texture2D(uMap, gl_PointCoord);
        gl_FragColor = vec4(t.rgb, t.a * min(vI, 1.3));
      }`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  })
}

/** The cut face of a sectioned part: a flat fill with drawing-office hatching
 *  (back faces seen through the cut read as the solid's section). */
const BUILD_DISCARD = /* glsl */ `
  float vsN = vsNoise(vLocal * 3.1) * 0.6 + vsNoise(vLocal * 9.0) * 0.4;
  float vsD = length(vLocal - uCore) + (vsN - 0.5) * 0.55;
  if (vsD > uBuild * 4.4 - 0.3) discard;
`
function capMaterial(U, { fill, line, pitch, weight, planes, ring = false }) {
  const m = new ShaderMaterial({
    uniforms: {
      uBuild: U.uBuild,
      uRootInv: U.uRootInv,
      uCore: U.uCore,
      uCam: U.uCam,
      uCut: U.uCut,
      uFill: { value: new Color(fill) },
      uLine: { value: new Color(line) },
      uPitch: { value: pitch },
      uWeight: { value: weight },
      uRing: { value: new Vector2(0.75, 0.84) },
      uI: { value: 1 },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <clipping_planes_pars_vertex>
      uniform mat4 uRootInv;
      varying vec3 vLocal;
      void main() {
        #include <begin_vertex>
        #include <project_vertex>
        #include <clipping_planes_vertex>
        vLocal = (uRootInv * modelMatrix * vec4(transformed, 1.0)).xyz;
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <clipping_planes_pars_fragment>
      ${ring ? '#define VESPER_RING' : ''}
      uniform float uBuild; uniform vec3 uCore; uniform vec3 uFill; uniform vec3 uLine;
      uniform float uPitch; uniform float uWeight; uniform vec2 uRing; uniform float uI;
      uniform vec3 uCam; uniform float uCut;
      varying vec3 vLocal;
      ${GLSL_NOISE}
      void main() {
        #include <clipping_planes_fragment>
        ${BUILD_DISCARD}
        #ifdef VESPER_RING
          float r = length(vLocal.xy - uCore.xy);
          float aa = fwidth(r);
          float inRing = smoothstep(uRing.x - aa, uRing.x + aa, r) * (1.0 - smoothstep(uRing.y - aa, uRing.y + aa, r));
          if (inRing < 0.01) discard;
          float edge = 1.0 - smoothstep(0.0, aa * 1.5, min(abs(r - uRing.x), abs(r - uRing.y)));
        #else
          float edge = 0.0;
        #endif
        // hatch the point where the view ray crosses the cutting plane, so
        // the section reads as one flat face whatever lies behind it
        vec3 rd = vLocal - uCam;
        float tt = abs(rd.z) > 1e-4 ? clamp((uCut - uCam.z) / rd.z, 0.0, 1.0) : 1.0;
        vec3 P = uCam + rd * tt;
        float h = (P.x + P.y) * uPitch;
        float hw = fwidth(h);
        float hatch = smoothstep(0.5 - uWeight - hw, 0.5 - uWeight, abs(fract(h) - 0.5));
        vec3 col = mix(uFill, uLine, clamp(hatch * 0.85 + edge, 0.0, 1.0));
        gl_FragColor = vec4(col * uI, 1.0);
        #include <colorspace_fragment>
      }`,
    side: ring ? DoubleSide : BackSide,
    clipping: !ring,
  })
  if (!ring) {
    m.clippingPlanes = planes
    m.clipIntersection = true
  }
  return m
}

function glowMaterial() {
  return new ShaderMaterial({
    uniforms: { uI: { value: 0 }, uSize: { value: 3.2 }, uColor: { value: new Color(PHOTOPHORE) } },
    vertexShader: /* glsl */ `
      uniform float uSize;
      varying vec2 vP;
      void main() {
        vP = position.xy * 2.0;
        vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        mv.xy += position.xy * uSize;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uI; uniform vec3 uColor;
      varying vec2 vP;
      void main() {
        float r2 = dot(vP, vP);
        float a = uI * (exp(-r2 * 4.0) * 0.32 + exp(-r2 * 22.0) * 0.16) * (1.0 - smoothstep(0.7, 1.0, sqrt(r2)));
        if (a < 0.002) discard;
        gl_FragColor = vec4(uColor, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  })
}

/* ---- livery: painted on the flat side panels (x -1.95…0.05, y -0.62…0.42) */
const LIVERY = { x0: -1.95, x1: 0.05, y0: -0.62, y1: 0.42 }
function drawLivery(c) {
  const g = c.getContext('2d')
  const k = c.width / (LIVERY.x1 - LIVERY.x0)
  const X = (x) => (x - LIVERY.x0) * k
  const Y = (y) => (LIVERY.y1 - y) * k
  g.clearRect(0, 0, c.width, c.height)
  g.fillStyle = 'rgba(226, 236, 236, 0.86)'
  g.font = '620 condensed 300px Anybody, "Arial Narrow", sans-serif'
  if ('fontStretch' in g) g.fontStretch = 'condensed'
  g.textBaseline = 'alphabetic'
  g.fillText('Vesper', X(-1.04), Y(-0.31))
  // pinstripe + small print, in the same paint
  g.fillStyle = 'rgba(226, 236, 236, 0.5)'
  g.fillRect(X(-1.04), Y(-0.4), X(-0.02) - X(-1.04), 0.009 * k)
  g.font = '500 54px Anybody, sans-serif'
  if ('fontStretch' in g) g.fontStretch = 'normal'
  g.fillStyle = 'rgba(226, 236, 236, 0.55)'
  g.fillText('Full ocean depth, 11,000 m', X(-1.04), Y(-0.49))
}

/* ==========================================================================
   The scene
   ========================================================================== */

function createVesper(canvas, { dpr, maxDpr, mobile }) {
  // MSAA only where it is cheap: on high-density screens the backbuffer is
  // already finer than the eye can resolve edges at.
  const renderer = new WebGLRenderer({ canvas, antialias: maxDpr < 1.5, alpha: true, powerPreference: 'high-performance' })
  renderer.setClearColor(0x000000, 0)
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.outputColorSpace = SRGBColorSpace
  renderer.setPixelRatio(dpr)
  renderer.localClippingEnabled = true

  const scene = new Scene()
  const pmrem = new PMREMGenerator(renderer)
  const room = new RoomEnvironment()
  const envTex = pmrem.fromScene(room, 0.04).texture
  scene.environment = envTex
  scene.environmentIntensity = 0.55
  room.dispose?.()
  pmrem.dispose()

  const camera = new PerspectiveCamera(19, 1, 0.1, 90)
  const target = new Vector3(0.06, -0.12, 0)

  const U = {
    uBuild: { value: 0 },
    uRootInv: { value: new Matrix4() },
    uCore: { value: CORE.clone() },
    uEdge: { value: new Color(PHOTOPHORE) },
    uCam: { value: new Vector3() },
    uCut: { value: 9 },
  }

  const root = new Group()
  scene.add(root)
  const surfaces = []
  const sliceSrc = []

  /* ---- the cutaway: a notch through her starboard side, around the sphere.
     Clipped where all of these hold: z > c, 0.1 < x < 1.9, -1.36 < y < 0.45 */
  const cutLocal = [
    new Plane(new Vector3(0, 0, -1), 9),
    new Plane(new Vector3(-1, 0, 0), 0.1),
    new Plane(new Vector3(1, 0, 0), -1.9),
    new Plane(new Vector3(0, 1, 0), -0.45),
    new Plane(new Vector3(0, -1, 0), -1.36),
  ]
  const cutPlanes = cutLocal.map((pl) => pl.clone())
  const cuttable = (mat) => {
    mat.clippingPlanes = cutPlanes
    mat.clipIntersection = true
    return mat
  }

  /* ---- materials */
  const M = {
    hull: cuttable(
      patch(
        new MeshPhysicalMaterial({
          color: '#1d2227',
          metalness: 0.22,
          roughness: 0.4,
          clearcoat: 0.6,
          clearcoatRoughness: 0.3,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        }),
        U,
        'hull',
        { seams: true, ao: 'hull' },
      ),
    ),
    // Titanium as it really leaves the shop: machined and bead-blasted, a
    // soft grey sheen with a narrow rim, never a mirror.
    sphere: cuttable(
      patch(
        new MeshPhysicalMaterial({
          color: '#8e9196',
          metalness: 1,
          roughness: 0.5,
          envMap: envTex,
          envMapIntensity: 0.4,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        }),
        U,
        'sphere',
        { ao: 'sphere', brushed: true },
      ),
    ),
    satin: cuttable(patch(new MeshPhysicalMaterial({ color: '#8f959c', metalness: 1, roughness: 0.32, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }), U, 'satin')),
    dark: patch(new MeshPhysicalMaterial({ color: '#23282e', metalness: 0.6, roughness: 0.38, clearcoat: 0.4, clearcoatRoughness: 0.3, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }), U, 'dark'),
    acrylic: cuttable(
      patch(
        new MeshPhysicalMaterial({
          color: '#010608',
          metalness: 0,
          roughness: 0.015,
          clearcoat: 1,
          clearcoatRoughness: 0.02,
          ior: 1.49,
          specularIntensity: 1,
          emissive: new Color('#2bbdb2'),
          emissiveIntensity: 0.0,
        }),
        U,
        'acrylic',
        { lens: true },
      ),
    ),
  }
  const add = (geo, mat, slice = true) => {
    const m = new Mesh(geo, mat)
    root.add(m)
    surfaces.push(m)
    if (slice) sliceSrc.push(geo)
    return m
  }

  /* ---- foam body, and its section where the cut goes through it */
  const hullGeo = hullGeometry()
  add(hullGeo, M.hull)
  const hullCap = new Mesh(hullGeo, capMaterial(U, { fill: '#0b1a20', line: '#256a67', pitch: 11, weight: 0.06, planes: cutPlanes }))
  hullCap.visible = false
  root.add(hullCap)

  /* ---- livery decals, one per side, sitting exactly on the side planes */
  const liveryCanvas = document.createElement('canvas')
  liveryCanvas.width = 2048
  liveryCanvas.height = Math.round((2048 * (LIVERY.y1 - LIVERY.y0)) / (LIVERY.x1 - LIVERY.x0))
  drawLivery(liveryCanvas)
  const liveryTex = new CanvasTexture(liveryCanvas)
  liveryTex.colorSpace = SRGBColorSpace
  liveryTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
  document.fonts?.load('620 300px Anybody').then(() => {
    drawLivery(liveryCanvas)
    liveryTex.needsUpdate = true
  })
  const liveryMat = patch(
    new MeshPhysicalMaterial({
      color: '#ffffff',
      map: liveryTex,
      transparent: true,
      metalness: 0.1,
      roughness: 0.42,
      clearcoat: 0.6,
      clearcoatRoughness: 0.3,
      depthWrite: false,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
    U,
    'livery',
  )
  for (const side of [1, -1]) {
    const g = new PlaneGeometry(LIVERY.x1 - LIVERY.x0, LIVERY.y1 - LIVERY.y0, 4, 2)
    g.translate((LIVERY.x0 + LIVERY.x1) / 2, (LIVERY.y0 + LIVERY.y1) / 2, 0)
    const pos = g.attributes.position
    const uv = g.attributes.uv
    for (let i = 0; i < pos.count; i++) {
      pos.setZ(i, side * (sideZ(pos.getX(i), pos.getY(i)) + 0.003))
      if (side < 0) uv.setX(i, 1 - uv.getX(i))
    }
    g.computeVertexNormals()
    const m = new Mesh(g, liveryMat)
    m.renderOrder = 1
    root.add(m)
    surfaces.push(m)
  }

  /* ---- titanium pressure sphere, flange, bolts, viewports */
  const S = new Vector3(SPHERE.x, SPHERE.y, 0)
  const sphereGeo = new SphereGeometry(SPHERE.r, 112, 80).translate(S.x, S.y, 0)
  const sphereMesh = new Mesh(sphereGeo, M.sphere)
  root.add(sphereMesh)
  surfaces.push(sphereMesh)
  sliceSrc.push(prep(new SphereGeometry(SPHERE.r, 56, 40).translate(S.x, S.y, 0)))
  const flange = placed(new TorusGeometry(SPHERE.r + 0.004, 0.02, 10, 140), S, new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2))
  const ports = []
  const portRings = []
  for (const d of VIEWPORT_DIRS) {
    const q = aim(d)
    ports.push(placed(new CylinderGeometry(0.165, 0.07, 0.18, 40, 1), S.clone().addScaledVector(d, SPHERE.r + 0.014 - 0.09), q))
    portRings.push(placed(new TorusGeometry(0.172, 0.018, 10, 48), S.clone().addScaledVector(d, SPHERE.r + 0.01), q.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2))))
  }
  add(merge(ports), M.acrylic, false)

  /* ---- inside the sphere: cabin wall, deck, three seats, three screens.
     Only drawn while the cutaway is open. */
  const interior = new Group()
  interior.visible = false
  root.add(interior)
  const cabinMat = patch(
    new MeshPhysicalMaterial({ color: '#69737a', roughness: 0.85, metalness: 0.05, emissive: new Color('#ffb054'), emissiveIntensity: 0, side: BackSide }),
    U,
    'cabin',
    { cabin: true },
  )
  interior.add(new Mesh(new SphereGeometry(SPHERE.inner, 72, 48).translate(S.x, S.y, 0), cabinMat))
  const seatMat = patch(new MeshPhysicalMaterial({ color: '#262d33', roughness: 0.78, metalness: 0.05, sheen: 0.6, sheenRoughness: 0.5, sheenColor: new Color('#5f7d84') }), U, 'seat')
  const floorY = S.y - 0.5
  const seatParts = []
  const seat = (x, z, yaw) => {
    const q = new Quaternion().setFromAxisAngle(UP, yaw)
    const at = (g) => seatParts.push(placed(g, new Vector3(x, floorY, z), q))
    at(new RoundedBoxGeometry(0.2, 0.09, 0.18, 2, 0.02).translate(0, 0.045, 0))
    at(new RoundedBoxGeometry(0.36, 0.08, 0.34, 3, 0.03).translate(0.02, 0.13, 0))
    at(new RoundedBoxGeometry(0.07, 0.44, 0.34, 3, 0.03).rotateZ(0.32).translate(-0.2, 0.36, 0))
    at(new RoundedBoxGeometry(0.08, 0.13, 0.2, 2, 0.035).rotateZ(0.32).translate(-0.3, 0.62, 0))
  }
  seat(S.x + 0.16, 0, 0) // the pilot, at the main viewport
  seat(S.x - 0.2, 0.32, -0.66) // a guest at each side viewport
  seat(S.x - 0.2, -0.32, 0.66)
  interior.add(new Mesh(merge(seatParts), seatMat))
  const deck = new CircleGeometry(Math.sqrt(SPHERE.inner ** 2 - 0.5 ** 2) - 0.01, 48).rotateX(-Math.PI / 2).translate(S.x, floorY, 0)
  interior.add(new Mesh(deck, patch(new MeshPhysicalMaterial({ color: '#171c20', roughness: 0.9 }), U, 'deck')))
  const screenMat = patch(new MeshBasicMaterial({ color: new Color(PHOTOPHORE).multiplyScalar(1.25), toneMapped: false }), U, 'screen')
  const screens = []
  for (const [d, w] of [
    [new Vector3(0.62, 0.2, 0), 0.26],
    [new Vector3(0.32, 0.12, 0.52), 0.16],
    [new Vector3(0.32, 0.12, -0.52), 0.16],
  ]) {
    const p = S.clone().add(d.clone().setLength(SPHERE.inner - 0.06))
    const g = new PlaneGeometry(w, w * 0.56)
    const m = new Mesh(g, screenMat)
    m.position.copy(p)
    m.lookAt(S.x, S.y - 0.25, 0)
    m.updateMatrix()
    screens.push(g.clone().applyMatrix4(m.matrix))
  }
  interior.add(new Mesh(mergeGeometries(screens.map(prep)), screenMat))

  // the section of the 90 mm titanium wall, exactly in the cutting plane
  const ringMat = capMaterial(U, { fill: '#18272d', line: PHOTOPHORE, pitch: 34, weight: 0.12, ring: true })
  const ring = new Mesh(new CircleGeometry(SPHERE.r, 112).translate(S.x, S.y, 0), ringMat)
  ring.visible = false
  ring.renderOrder = 1
  root.add(ring)

  /* ---- frame: skids, posts, struts, brow bar, cross member */
  const satin = [flange, ...portRings]
  for (const s of [1, -1]) {
    const curve = new CatmullRomCurve3(SKID.map((p) => new Vector3(p[0], p[1], s * SKID_Z)))
    satin.push(new TubeGeometry(curve, 90, 0.045, 12, false))
    const e0 = curve.getPoint(0)
    satin.push(new SphereGeometry(0.045, 12, 8).translate(e0.x, e0.y, e0.z))
    satin.push(rod(new Vector3(POST.a[0], POST.a[1], s * SKID_Z), new Vector3(POST.b[0], POST.b[1], s * SKID_Z), 0.034))
    for (const x of [-1.3, -0.25]) {
      const bottom = profileAt(x)[0] - HULL.bevelS + 0.06
      satin.push(rod(new Vector3(x, SKID[2][1] + 0.02, s * SKID_Z), new Vector3(x, bottom, s * 0.42), 0.032))
    }
  }
  satin.push(new TubeGeometry(new CatmullRomCurve3(BROW_BAR.map(v3)), 40, 0.036, 10, false))
  satin.push(rod(new Vector3(1.5, -1.5, -SKID_Z), new Vector3(1.5, -1.5, SKID_Z), 0.03))
  // tail bars for the aft thrusters
  satin.push(rod(new Vector3(-1.86, 0.46, -0.8), new Vector3(-1.86, 0.46, 0.8), 0.035))
  satin.push(rod(new Vector3(-1.76, -0.3, -0.76), new Vector3(-1.76, -0.3, 0.76), 0.032))
  // hatch coaming on the deck above the sphere
  const deckTop = profileAt(SPHERE.x)[1] + HULL.bevelS
  satin.push(new CylinderGeometry(0.31, 0.33, 0.1, 48).translate(SPHERE.x, deckTop + 0.02, 0))
  satin.push(new TorusGeometry(0.15, 0.018, 8, 32).rotateX(Math.PI / 2).translate(SPHERE.x, deckTop + 0.13, 0))
  // instrument boom
  const mastA = new Vector3(1.5, profileAt(1.5)[1] + HULL.bevelS - 0.04, -0.35)
  const mastB = new Vector3(2.18, 1.17, -0.35)
  satin.push(rod(mastA, mastB, 0.03))
  satin.push(rod(new Vector3(2.2, 1.11, -0.52), new Vector3(2.2, 1.11, -0.18), 0.02))
  add(merge(satin), M.satin)

  const dark = []
  dark.push(new CylinderGeometry(0.29, 0.3, 0.06, 48).translate(SPHERE.x, deckTop + 0.09, 0))
  // sonar head + camera pod on the boom
  dark.push(new CylinderGeometry(0.075, 0.075, 0.12, 24).rotateX(Math.PI / 2).translate(2.14, 1.26, -0.35))
  dark.push(new RoundedBoxGeometry(0.16, 0.1, 0.1, 2, 0.02).translate(1.92, 1.2, -0.35))
  // drop weights and variable-ballast spheres
  const yb = profileAt(-0.82)[0] - HULL.bevelS
  dark.push(new RoundedBoxGeometry(0.52, 0.17, 0.4, 3, 0.04).translate(-0.82, yb - 0.1, 0))
  dark.push(new RoundedBoxGeometry(0.42, 0.06, 0.5, 2, 0.02).translate(-0.82, yb + 0.0, 0))
  for (const s of [1, -1]) {
    const yy = profileAt(-1.55)[0] - HULL.bevelS
    dark.push(new SphereGeometry(0.2, 32, 20).translate(-1.55, yy - 0.12, s * 0.36))
  }
  // manipulator arm, folded
  const A = ARM.map(v3)
  dark.push(new CylinderGeometry(0.075, 0.085, 0.12, 24).translate(A[0].x, -1.48, A[0].z))
  dark.push(new SphereGeometry(0.07, 20, 14).translate(A[0].x, A[0].y, A[0].z))
  dark.push(new SphereGeometry(0.058, 20, 14).translate(A[1].x, A[1].y, A[1].z))
  dark.push(new SphereGeometry(0.045, 16, 12).translate(A[2].x, A[2].y, A[2].z))
  add(merge(dark), M.dark)
  const arm = [rod(A[0], A[1], 0.045, 16, 0.04), rod(A[1], A[2], 0.038, 16, 0.034)]
  const wristDir = new Vector3(0.35, -1, 0).normalize()
  arm.push(rod(A[2], A[2].clone().addScaledVector(wristDir, 0.12), 0.03))
  for (const s of [1, -1]) {
    const j = A[2].clone().addScaledVector(wristDir, 0.12)
    arm.push(rod(j, j.clone().add(new Vector3(0.05, -0.1, s * 0.035)), 0.012, 8))
  }
  add(merge(arm), M.satin)

  /* ---- thrusters (instanced) */
  const T = thrusterGeometry()
  const tSat = new InstancedMesh(T.satin, M.satin, THRUSTERS.length)
  const tDark = new InstancedMesh(T.dark, M.dark, THRUSTERS.length)
  const throats = []
  THRUSTERS.forEach((t, i) => {
    const p = v3(t.p)
    let dir = v3(t.d)
    if (t.side) p.z = t.side * (sideZ(p.x, p.y) - 0.06)
    if (t.deck) {
      const dk = deckAt(p.x)
      dir = dk.n
      p.y = dk.y
      p.addScaledVector(dir, -0.035 * t.s)
      throats.push(placed(new CircleGeometry(0.128 * t.s, 32).rotateX(-Math.PI / 2), new Vector3(t.p[0], dk.y, t.p[2]).addScaledVector(dir, 0.004), aim(dir)))
    }
    const m = new Matrix4().compose(p, aim(dir), new Vector3(t.s, t.s, t.s))
    tSat.setMatrixAt(i, m)
    tDark.setMatrixAt(i, m)
    sliceSrc.push(T.dark.clone().applyMatrix4(m))
  })
  root.add(tSat, tDark)
  surfaces.push(tSat, tDark)
  add(merge(throats), patch(new MeshPhysicalMaterial({ color: '#000000', roughness: 1, metalness: 0 }), U, 'void'), false)

  /* ---- lamps: heads, lenses (instanced, coloured per bank), flares */
  const lampBody = merge([new CylinderGeometry(0.036, 0.044, 0.08, 16), new TorusGeometry(0.034, 0.006, 6, 20).rotateX(Math.PI / 2).translate(0, 0.04, 0)])
  const lensGeo = new CircleGeometry(0.03, 20).rotateX(-Math.PI / 2).translate(0, 0.0405, 0)
  const lamps = new InstancedMesh(lampBody, M.dark, LAMPS.length)
  const lensMat = new MeshBasicMaterial({ color: '#ffffff', toneMapped: false })
  const lenses = new InstancedMesh(lensGeo, lensMat, LAMPS.length)
  const flarePos = new Float32Array(LAMPS.length * 3)
  const flareBank = new Float32Array(LAMPS.length)
  const dim = new Color('#0c1f24')
  const WHITE = new Color(1, 1, 1)
  LAMPS.forEach((l, i) => {
    const m = new Matrix4().compose(l.p, aim(l.d), new Vector3(1, 1, 1))
    lamps.setMatrixAt(i, m)
    lenses.setMatrixAt(i, m)
    lenses.setColorAt(i, dim)
    const fp = l.p.clone().addScaledVector(l.d, 0.07)
    flarePos.set([fp.x, fp.y, fp.z], i * 3)
    flareBank[i] = l.bank
  })
  root.add(lamps, lenses)
  surfaces.push(lamps)
  const flareGeo = new BufferGeometry()
  flareGeo.setAttribute('position', new BufferAttribute(flarePos, 3))
  flareGeo.setAttribute('aBank', new BufferAttribute(flareBank, 1))
  const flares = new Points(flareGeo, flareMaterial(dpr))
  flares.renderOrder = 6
  root.add(flares)

  /* ---- light beams */
  const coneGeo = new ConeGeometry(1, 1, 48, 10, true).translate(0, -0.5, 0)
  const beams = BEAMS.map((b) => {
    const mesh = new Mesh(coneGeo, beamMaterial())
    const r = Math.tan(b.a * DEG) * b.len
    mesh.position.copy(b.o)
    mesh.quaternion.setFromUnitVectors(new Vector3(0, -1, 0), b.d)
    mesh.scale.set(r, b.len, r)
    mesh.renderOrder = 4
    mesh.visible = false
    root.add(mesh)
    return mesh
  })

  /* ---- marine snow caught in the beams */
  const N = mobile ? 1400 : 3200
  const sp = new Float32Array(N * 3)
  const sr = new Float32Array(N * 4)
  const snowU = snowMaterial(dpr)
  const mn = snowU.uniforms.uMin.value
  const sz = snowU.uniforms.uSize.value
  for (let i = 0; i < N; i++) {
    sp[i * 3] = mn.x + Math.random() * sz.x
    sp[i * 3 + 1] = mn.y + Math.random() * sz.y
    sp[i * 3 + 2] = mn.z + Math.random() * sz.z
    sr.set([Math.random(), Math.random(), Math.random(), Math.random() ** 3], i * 4)
  }
  const snowGeo = new BufferGeometry()
  snowGeo.setAttribute('position', new BufferAttribute(sp, 3))
  snowGeo.setAttribute('aRand', new BufferAttribute(sr, 4))
  const snow = new Points(snowGeo, snowU)
  snow.frustumCulled = false
  snow.renderOrder = 5
  root.add(snow)
  BEAMS.forEach((b, i) => {
    snowU.uniforms.uBO.value[i].set(b.o.x, b.o.y, b.o.z, 0)
    snowU.uniforms.uBD.value[i].set(b.d.x, b.d.y, b.d.z, Math.cos(b.a * DEG))
    snowU.uniforms.uBL.value[i] = b.len
  })

  /* ---- blueprint */
  const lineMat = lineMaterial()
  const lines = new LineSegments(blueprintGeometry(sliceSrc), lineMat)
  lines.renderOrder = 3
  lines.frustumCulled = false
  root.add(lines)

  /* ---- the sphere's first light: a photophore glow while she is only lines */
  const glowMat = glowMaterial()
  const glow = new Mesh(new PlaneGeometry(1, 1), glowMat)
  glow.position.copy(CORE)
  glow.frustumCulled = false
  glow.renderOrder = 2
  glow.visible = false
  root.add(glow)

  /* ---- light rig: key + two photophore rims, kept relative to the camera */
  const key = new DirectionalLight('#e6f5ff', 2.1)
  const rimA = new DirectionalLight(PHOTOPHORE, 2.6)
  const rimB = new DirectionalLight(PHOTOPHORE_2, 2.2)
  scene.add(key, rimA, rimB)
  const spot = new SpotLight('#eaf9ff', 0, 9, 34 * DEG, 0.7, 1.4)
  spot.position.set(2.15, -0.05, 0)
  spot.target.position.set(4.2, -1.6, 0.1)
  root.add(spot, spot.target)

  /* ---- anchors for callouts (local point, outward normal) */
  const ringA = 128 * DEG
  const anchors = {
    sphere: { p: S.clone().addScaledVector(new Vector3(0.34, 0.3, 0.89).normalize(), SPHERE.r), n: new Vector3(0.34, 0.3, 0.89).normalize() },
    rated: { p: new Vector3(-0.3, profileAt(-0.3)[1] + HULL.bevelS, 0.12), n: new Vector3(0, 1, 0.3).normalize(), always: true },
    foam: { p: new Vector3(-0.62, 0.12, sideZ(-0.62, 0.12)), n: new Vector3(0, 0, 1) },
    viewports: { p: S.clone().addScaledVector(VIEWPORT_DIRS[1], SPHERE.r + 0.02), n: VIEWPORT_DIRS[1].clone() },
    lamps: { p: LAMPS[7].p.clone(), n: new Vector3(0.75, -0.2, 0.6).normalize() },
    cabin: { p: new Vector3(S.x - 0.18, floorY + 0.18, 0.3), n: new Vector3(0, 0, 1), always: true },
    wall: { p: new Vector3(S.x + Math.cos(ringA) * 0.795, S.y + Math.sin(ringA) * 0.795, 0), n: new Vector3(0, 0, 1), always: true },
  }

  /* ---- points on the silhouette, for laying callouts out around her */
  const silo = []
  offsetOutline(hullOutline(), HULL.bevelS).forEach((q, i) => {
    if (i % 10 === 0) silo.push(new Vector3(q.x, q.y, 0))
  })
  hullOutline().forEach((q, i) => {
    if (i % 14 === 0) for (const sd of [1, -1]) silo.push(new Vector3(q.x, q.y, sd * sideZ(q.x, q.y)))
  })
  for (const sd of [1, -1]) for (const k of SKID) silo.push(new Vector3(k[0], k[1] - 0.05, sd * SKID_Z))
  silo.push(mastB.clone().add(new Vector3(0, 0.12, 0)), new Vector3(SPHERE.x, deckTop + 0.14, 0), v3(ARM[2]).add(new Vector3(0.06, -0.16, 0)))
  for (const t of THRUSTERS.slice(0, 4)) for (const dy of [0.2, -0.2]) silo.push(new Vector3(t.p[0], t.p[1] + dy, t.p[2]))

  /* ---- state */
  const tmp = new Vector3()
  const tmp2 = new Vector3()
  const fwd = new Vector3()
  const right = new Vector3()
  const up = new Vector3()
  const banksNow = [0, 0, 0]
  const lensColor = new Color()
  let W = 1
  let H = 1
  let asleep = false

  function setSize(w, h) {
    W = Math.max(1, w)
    H = Math.max(1, h)
    if (!asleep) renderer.setSize(W, H, false)
    camera.aspect = W / H
    camera.updateProjectionMatrix()
  }
  function setDpr(d) {
    renderer.setPixelRatio(d)
    if (!asleep) renderer.setSize(W, H, false)
    flares.material.uniforms.uPx.value = 46 * d
    snowU.uniforms.uPx.value = 26 * d
  }
  /** Off screen, hand the backing store back (a full-size buffer is tens of MB). */
  function sleep() {
    if (asleep) return
    asleep = true
    renderer.setSize(1, 1, false)
  }
  function wake() {
    if (!asleep) return
    asleep = false
    renderer.setSize(W, H, false)
  }

  function update(s, t) {
    // camera on a sphere around a moving target; distance follows from the
    // scale (px per metre) and the lens, so the lens can change on its own
    const c = s.cam
    camera.fov = c.fov
    const dist = H / 2 / (c.f * Math.tan((c.fov * DEG) / 2))
    const a = c.az * DEG
    const e = c.el * DEG
    target.set(c.tx, c.ty, c.tz)
    camera.position.set(target.x + dist * Math.sin(a) * Math.cos(e), target.y + dist * Math.sin(e), target.z + dist * Math.cos(a) * Math.cos(e))
    camera.near = Math.max(0.1, dist - 14)
    camera.far = dist + 40
    camera.lookAt(target)
    camera.setViewOffset(W, H, -c.sx * W, -c.sy * H, W, H)
    camera.updateMatrixWorld()
    lineMat.uniforms.uDist.value = dist
    // the vessel hovers
    root.position.y = s.bob
    root.rotation.z = s.roll
    root.rotation.x = s.roll * 0.4
    root.updateMatrixWorld()
    U.uRootInv.value.copy(root.matrixWorld).invert()

    // lights follow the camera, so the rims always find the silhouette
    camera.getWorldDirection(fwd)
    right.crossVectors(fwd, UP).normalize()
    up.crossVectors(right, fwd).normalize()
    const place = (light, r, u, f) => light.position.copy(target).addScaledVector(right, r).addScaledVector(up, u).addScaledVector(fwd, -f)
    place(key, -5, 7, 6)
    place(rimA, -6, 5, -12)
    place(rimB, 8, -2.5, -11)

    // acts
    const build = s.build
    U.uBuild.value = build
    const built = build > 0.001
    for (const m of surfaces) m.visible = built
    lenses.visible = build > 0.95
    lineMat.uniforms.uDraw.value = s.draw
    lineMat.uniforms.uAlpha.value = s.wire
    lines.visible = s.draw > 0.001 && s.wire > 0.003
    M.acrylic.emissiveIntensity = 0.03 + s.ports * 0.15
    glowMat.uniforms.uI.value = s.glow
    glow.visible = s.glow > 0.002

    // the cutaway
    const cut = s.cut
    const open = built && cut < SPHERE.r
    cutLocal[0].constant = open ? cut : 9
    for (let i = 0; i < cutLocal.length; i++) cutPlanes[i].copy(cutLocal[i]).applyMatrix4(root.matrixWorld)
    interior.visible = open
    hullCap.visible = open
    ring.visible = open
    if (open) {
      ring.position.z = cut
      ringMat.uniforms.uRing.value.set(Math.sqrt(Math.max(0, SPHERE.inner ** 2 - cut * cut)), Math.sqrt(SPHERE.r ** 2 - cut * cut))
      cabinMat.emissiveIntensity = 0.16 * s.cabin
      U.uCut.value = cut
      U.uCam.value.copy(camera.position).applyMatrix4(U.uRootInv.value)
    }

    const b = s.banks
    let any = 0
    for (let i = 0; i < 3; i++) {
      if (Math.abs(banksNow[i] - b[i]) > 1e-4) {
        banksNow[i] = b[i]
        any = 1
      }
    }
    if (any) {
      LAMPS.forEach((l, i) => {
        const I = banksNow[l.bank]
        lensColor.copy(dim).lerp(WHITE, clamp(I)).multiplyScalar(1 + 1.6 * clamp(I))
        lenses.setColorAt(i, lensColor)
      })
      lenses.instanceColor.needsUpdate = true
    }
    flares.material.uniforms.uBanks.value.set(b[0], b[1], b[2])
    flares.visible = b[0] + b[1] + b[2] > 0.005
    BEAMS.forEach((bm, i) => {
      const I = b[bm.bank]
      beams[i].material.uniforms.uI.value = I
      beams[i].material.uniforms.uTime.value = t
      beams[i].visible = I > 0.005
      snowU.uniforms.uBO.value[i].w = I
    })
    snow.visible = b[0] + b[1] + b[2] > 0.005
    snowU.uniforms.uTime.value = t
    spot.intensity = b[0] * 26
  }

  function render() {
    renderer.render(scene, camera)
  }

  /** Screen position of an anchor + how much it faces the camera. */
  function project(key, out) {
    const a = anchors[key]
    tmp.copy(a.p).applyMatrix4(root.matrixWorld)
    tmp2.copy(a.n).transformDirection(root.matrixWorld)
    const facing = a.always ? 1 : tmp2.dot(fwd.copy(camera.position).sub(tmp).normalize())
    tmp.project(camera)
    out.x = (tmp.x * 0.5 + 0.5) * W
    out.y = (-tmp.y * 0.5 + 0.5) * H
    out.facing = facing
    return out
  }

  /** Screen-space box around the silhouette. */
  function screenBox(out) {
    out.l = out.t = Infinity
    out.r = out.b = -Infinity
    for (const q of silo) {
      tmp.copy(q).applyMatrix4(root.matrixWorld).project(camera)
      const x = (tmp.x * 0.5 + 0.5) * W
      const y = (-tmp.y * 0.5 + 0.5) * H
      if (x < out.l) out.l = x
      if (x > out.r) out.r = x
      if (y < out.t) out.t = y
      if (y > out.b) out.b = y
    }
    return out
  }

  /** Screen-space box around the pressure sphere alone. */
  function sphereBox(out) {
    tmp.copy(CORE).applyMatrix4(root.matrixWorld)
    tmp2.copy(tmp).addScaledVector(up, SPHERE.r)
    tmp.project(camera)
    tmp2.project(camera)
    const x = (tmp.x * 0.5 + 0.5) * W
    const y = (-tmp.y * 0.5 + 0.5) * H
    const r = Math.abs(tmp2.y - tmp.y) * 0.5 * H
    out.l = x - r
    out.r = x + r
    out.t = y - r
    out.b = y + r
    return out
  }

  /** Compile every program up front so nothing hitches mid-scroll. */
  async function warm() {
    const vis = []
    scene.traverse((o) => {
      vis.push([o, o.visible])
      o.visible = true
    })
    try {
      if (renderer.compileAsync) await renderer.compileAsync(scene, camera)
      else renderer.compile(scene, camera)
    } catch {
      /* compiling lazily is fine too */
    }
    for (const [o, v] of vis) o.visible = v
  }

  return { renderer, setSize, setDpr, sleep, wake, update, render, project, screenBox, sphereBox, warm, sizeInfo: () => ({ W, H }) }
}

/* ==========================================================================
   Choreography: everything is a pure function of one clock, c.
   c runs -1 → 0 while the stage scrolls up to the pin (the pre-roll), then
   0 → 1 across the pin. Stacked layouts run a shorter stretch of it.
   ========================================================================== */

// The pinned layout needs width for the copy column beside her, and height.
const PIN_MQ = '(min-width: 1024px) and (min-height: 600px) and (min-aspect-ratio: 5/4)'
const PIN_LEN = 4.2 // viewports of scroll while pinned
const TAIL = 1 - 1 / PIN_LEN // from here the builder's plate rises under her
const ACTS = [
  [0, 0.2],
  [0.2, 0.42],
  [0.42, 0.6],
  [0.6, TAIL],
]
const BANKS_AT = [0.44, 0.49, 0.54]
const SONAR_AT = 0.57
const CUT_AT = [0.6, 0.68]
const ELEV = [0.78, 0.97] // turning to a true side elevation
const DISSOLVE = [0.85, 0.985] // surfaces go back to lines, outside in
const STACK_RANGE = [-0.6, 0.74]
const STATIC_C = 0.57 // reduced motion: lamps on, sonar quiet

// [c, azimuth°, elevation°, distance at 19° (m), target x, y, z, view shift x, y]
const CAM_PIN = [
  [-1.0, -62, 17, 23.5, 0.06, -0.12, 0, 1, 1],
  [0.0, -40, 13, 21.5, 0.06, -0.12, 0, 1, 1],
  [0.2, -8, 7, 20.2, 0.06, -0.12, 0, 1, 1],
  [0.42, 26, 2, 19.4, 0.06, -0.12, 0, 1, 1],
  [0.6, 42, 1, 19.4, 0.06, -0.12, 0, 1, 1],
  [0.69, 31, 14, 17.8, 0.62, -0.46, 0, 1.38, 1.4],
  [TAIL, 27, 15, 17.2, 0.68, -0.5, 0, 1.38, 1.4],
  [1.0, 24, 15, 17.2, 0.68, -0.5, 0, 1.38, 1.4],
]
const CAM_STACK = [
  [-0.6, -38, 12, 21.0, 0.06, -0.12, 0, 0, 0],
  [0.0, -30, 10, 19.5, 0.06, -0.12, 0, 0, 0],
  [0.2, 0, 6, 18.8, 0.06, -0.12, 0, 0, 0],
  [0.42, 30, 2, 18.4, 0.06, -0.12, 0, 0, 0],
  [0.6, 42, 1, 18.8, 0.06, -0.12, 0, 0, 0],
  [0.74, 28, 14, 15.4, 0.6, -0.32, 0, 0, 0],
]
// the plate's side elevation, in metres: left, top, width (see elevationSVG)
const SVG_X0 = -2.55
const SVG_Y0 = 1.72
const SVG_W = 5.15
const TAN_19 = Math.tan((19 * DEG) / 2)

function sampleKeys(keys, p) {
  const n = keys.length
  if (p <= keys[0][0]) return keys[0].slice(1)
  if (p >= keys[n - 1][0]) return keys[n - 1].slice(1)
  let i = 0
  while (p > keys[i + 1][0]) i++
  const k0 = keys[Math.max(0, i - 1)]
  const k1 = keys[i]
  const k2 = keys[i + 1]
  const k3 = keys[Math.min(n - 1, i + 2)]
  const h = k2[0] - k1[0]
  const t = (p - k1[0]) / h
  const t2 = t * t
  const t3 = t2 * t
  const out = []
  for (let j = 1; j < k1.length; j++) {
    const m1 = ((k2[j] - k0[j]) / (k2[0] - k0[0] || 1)) * h
    const m2 = ((k3[j] - k1[j]) / (k3[0] - k1[0] || 1)) * h
    out.push((2 * t3 - 3 * t2 + 1) * k1[j] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * k2[j] + (t3 - t2) * m2)
  }
  return out
}

/* ==========================================================================
   init
   ========================================================================== */

export function init(ctx) {
  const root = document.getElementById('vessel')
  if (!root) return
  const { gsap, ScrollTrigger } = ctx
  const $ = (s) => root.querySelector(s)
  const stage = $('.vessel__stage')
  const view = $('.vessel__view')
  const canvas = $('.vessel__canvas')
  const title = $('.vessel__title')
  const copy = $('.vessel__copy')
  const actsEl = $('.vessel__acts')
  const grab = $('.vessel__grab')
  const plate = $('.vessel__plate')
  const drawing = $('.vessel__drawing')
  const actEls = [...root.querySelectorAll('.vessel__act')]
  const fillEls = actEls.map((a) => a.querySelector('.vessel__act-fill'))
  const textEls = actEls.map((a) => a.querySelector('.vessel__act-text'))
  const leaders = $('.vessel__leaders')
  // the copy scrolls on during the hand-off; its children move rather than
  // the column, so the column never becomes a stacking context of its own
  // (the title stays under the 3D view, the lead and acts above it)
  const copyKids = [title, $('.vessel__lead'), actsEl]
  const setCopyY = (y) => {
    const t = y > 0 ? `translate3d(0, ${(-y).toFixed(1)}px, 0)` : ''
    for (const el of copyKids) el.style.transform = t
  }
  const reduced = ctx.reducedMotion
  const touch = ctx.isTouch
  const mobile = ctx.isMobile()
  let stacked = true
  let pinned = false

  if (reduced) root.classList.add('vessel--static')

  /* ---- 2D: the plate drawing, always */
  $('.vessel__elevation').innerHTML = elevationSVG('plate')

  /* ---- 3D, if the browser can */
  const maxDpr = mobile ? Math.min(ctx.dpr, 1.25) : Math.min(ctx.dpr, 1.5)
  let dprNow = Math.min(maxDpr, 1.25)
  let gl = null
  try {
    if (new URLSearchParams(location.search).has('nogl')) throw new Error('nogl')
    gl = createVesper(canvas, { dpr: dprNow, maxDpr, mobile })
  } catch (err) {
    console.warn('[vessel] WebGL unavailable, showing the drawing instead', err)
    gl = null
  }
  const noGL = () => {
    root.classList.add('vessel--nogl')
    const fb = $('.vessel__fallback')
    if (!fb.firstChild) fb.innerHTML = elevationSVG('stage')
  }
  if (!gl) noGL()
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault()
    gl = null
    noGL()
  })

  /* ---- callouts: DOM + leader paths. Two at most per act; an act's labels
     leave as the next act's arrive. */
  const SVGNS = 'http://www.w3.org/2000/svg'
  const CALLOUTS = {
    sphere: { win: [-0.3, 0.2], side: 1, place: 'below', run: 0.035 },
    rated: { win: [0.06, 0.2], side: 1, place: 'above', run: 0.04 },
    foam: { win: [0.24, 0.42], side: 1, place: 'above', run: 0.035 },
    viewports: { win: [0.3, 0.42], side: 1, place: 'below', run: 0.035 },
    lamps: { win: [0.47, 0.6], side: 1, place: 'above', run: 0.035 },
    cabin: { win: [0.665, TAIL - 0.012], side: 1, place: 'below', run: 0.03, near: 205 },
    wall: { win: [0.685, TAIL - 0.012], side: -1, place: 'above', run: 0.03, near: 110 },
  }
  const STATIC_KEYS = new Set(['sphere', 'lamps'])
  const callouts = [...root.querySelectorAll('.vessel__callout')].map((el) => {
    const key = el.dataset.key
    const path = document.createElementNS(SVGNS, 'path')
    path.setAttribute('class', 'vessel__leader')
    const dot = document.createElementNS(SVGNS, 'circle')
    dot.setAttribute('class', 'vessel__dot')
    dot.setAttribute('r', '3')
    const halo = document.createElementNS(SVGNS, 'circle')
    halo.setAttribute('class', 'vessel__halo')
    halo.setAttribute('r', '9')
    leaders.append(path, halo, dot)
    return { el, key, cfg: CALLOUTS[key], path, dot, halo, v: 0, on: false, tw: null, w: 0, hidden: true, pt: { x: 0, y: 0, facing: 1 } }
  })
  const bounds = { minX: 24, maxX: 1000 }
  let calloutsOn = false
  const measureCallouts = () => {
    calloutsOn = !!gl && (!stacked || view.clientWidth >= 1024)
    if (!calloutsOn) return
    callouts.forEach((c) => {
      c.w = Math.max(c.el.querySelector('.vessel__callout-title').offsetWidth, c.el.querySelector('.vessel__callout-sub').offsetWidth)
      c.el.style.width = c.w + 'px'
    })
    const vr = view.getBoundingClientRect()
    const rail = parseFloat(getComputedStyle(copy).paddingLeft) || 24
    if (stacked) bounds.minX = rail
    else {
      const lead = copy.querySelector('.vessel__lead').getBoundingClientRect()
      const acts = actsEl.getBoundingClientRect()
      bounds.minX = Math.max(24, Math.max(lead.right, acts.right) - vr.left + 32)
    }
    bounds.maxX = vr.width - rail - (window.innerWidth >= 1024 ? 72 : 0) - 12
  }

  /* ---- the act sentences share one slot: reserve the tallest */
  const measureActs = () => {
    if (stacked) {
      actsEl.style.removeProperty('--act-h')
      return
    }
    const h = Math.max(...textEls.map((t) => t.offsetHeight))
    actsEl.style.setProperty('--act-h', h + 'px')
  }

  /* ---- where the plate's drawing will be when the pin lets go (stage px) */
  const handoff = { left: 0, top: 0, w: 0 }
  const measureHandoff = () => {
    handoff.w = 0
    if (!pinned) return
    const svg = drawing.querySelector('svg')
    const pr = plate.getBoundingClientRect()
    const sr = svg.getBoundingClientRect()
    const vr = view.getBoundingClientRect()
    handoff.left = sr.left - vr.left
    handoff.top = sr.top - pr.top
    handoff.w = sr.width
  }

  /* ---- state */
  const S = { c: -1, target: -1, pre: 0, pin: 0, hand: 0, yaw: 0, yawT: 0, mx: 0, my: 0, mxT: 0, myT: 0 }
  let time = 0
  let active = false
  let dirty = true
  let blank = false
  let sonarDone = false
  const banks = [{ v: 0, on: false }, { v: 0, on: false }, { v: 0, on: false }]
  let lastAct = -1
  let lastFill = -1
  const shift = { x: 0.11, y: 0.045 }

  const setBank = (b, on) => {
    if (b.on === on) return
    b.on = on
    gsap.killTweensOf(b)
    if (reduced) {
      b.v = on ? 1 : 0
      return
    }
    if (on) {
      gsap
        .timeline()
        .to(b, { v: 0.85, duration: 0.05, ease: 'none' })
        .to(b, { v: 0.2, duration: 0.07, ease: 'none' })
        .to(b, { v: 1.2, duration: 0.12, ease: 'power2.out' })
        .to(b, { v: 1, duration: 0.7, ease: 'power3.out' })
    } else gsap.to(b, { v: 0, duration: 0.35, ease: 'power2.out' })
  }

  function camAt(c, e) {
    const k = sampleKeys(stacked ? CAM_STACK : CAM_PIN, c)
    const { W, H } = gl.sizeInfo()
    let dist = k[2]
    // narrower views see less of her length: step back
    if (stacked) dist *= clamp(1.25 / (W / H), 1, 1.9)
    else dist *= clamp(1.6 / (W / H), 1, 1.3)
    const cam = { az: k[0], el: k[1], f: H / 2 / (dist * TAN_19), fov: 19, tx: k[3], ty: k[4], tz: k[5], sx: k[6] * shift.x, sy: k[7] * shift.y }
    if (e > 0 && handoff.w > 0) {
      // a true side elevation, lined up with the drawing on the plate:
      // a dolly-zoom flattens the perspective into orthographic
      const f = handoff.w / SVG_W
      cam.az = lerp(cam.az, 0, e)
      cam.el = lerp(cam.el, 0, e)
      cam.f = lerp(cam.f, f, e)
      cam.fov = lerp(19, 4.5, e)
      cam.tx = lerp(cam.tx, SVG_X0 + (W / 2 - handoff.left) / f, e)
      cam.ty = lerp(cam.ty, SVG_Y0 - (H / 2 - handoff.top) / f, e)
      cam.tz = lerp(cam.tz, 0, e)
      cam.sx = lerp(cam.sx, 0, e)
      cam.sy = lerp(cam.sy, 0, e)
    }
    return cam
  }

  function stateAt(c) {
    const p = Math.max(0, c)
    const e = pinned ? ease(range(p, ELEV[0], ELEV[1])) : 0
    const dissolve = pinned ? ease(range(p, DISSOLVE[0], DISSOLVE[1])) : 0
    const lampsOut = Math.max(0.6 * range(p, 0.6, 0.67), pinned ? range(p, 0.79, 0.87) : 0)
    const still = reduced ? 0 : 1 - e
    const cam = camAt(c, e)
    cam.az += (S.yaw + S.mx * 3.5) * (1 - e) + (stacked && !reduced ? Math.sin(time * 0.16) * 6 : 0)
    cam.el += -S.my * 2 * (1 - e)
    return {
      draw: c < 0 ? 0.42 * ease(range(c, -0.85, -0.03)) : 0.42 + 0.8 * range(p, 0, 0.2),
      build: ease(range(p, 0.2, 0.4)) * (1 - dissolve),
      wire: Math.max((1 - 0.88 * range(p, 0.3, 0.44)) * (1 - range(p, 0.42, 0.56)), range(p, DISSOLVE[0], 0.96)) * (1 - S.hand),
      glow: ease(range(c, -0.8, -0.25)) * (1 - range(p, 0.18, 0.36)),
      ports: range(p, 0.32, 0.42),
      cabin: range(p, 0.62, 0.7),
      cut: p >= CUT_AT[0] ? lerp(0.95, 0, ease(range(p, CUT_AT[0], CUT_AT[1]))) : 9,
      banks: banks.map((b) => b.v * (1 - lampsOut)),
      cam,
      bob: Math.sin(time * 0.42) * 0.035 * still,
      roll: Math.sin(time * 0.31 + 1.2) * 0.008 * still,
    }
  }

  /* ---- DOM, per frame (cheap writes only when values change) */
  function updateDOM(c) {
    if (stacked) return
    const p = Math.max(0, c)
    const fill = range(p, 0.2, 0.4)
    const f = Math.round(fill * 1000) / 1000
    if (f !== lastFill) {
      lastFill = f
      title.style.setProperty('--fill', f.toFixed(3))
      title.style.setProperty('--stroke', (1 - range(p, 0.36, 0.44)).toFixed(3))
    }
    const act = p < ACTS[1][0] ? 0 : p < ACTS[2][0] ? 1 : p < ACTS[3][0] ? 2 : 3
    if (act !== lastAct) {
      lastAct = act
      actEls.forEach((a, i) => a.classList.toggle('is-active', i === act))
    }
    ACTS.forEach(([a, b], i) => (fillEls[i].style.transform = `scaleX(${range(p, a, b).toFixed(4)})`))
  }

  const pt = { x: 0, y: 0, facing: 1 }
  const box = { l: 0, r: 0, t: 0, b: 0 }
  const live = []
  const hideCallout = (co) => {
    if (co.hidden) return
    co.hidden = true
    co.el.style.opacity = '0'
    co.path.style.opacity = co.dot.style.opacity = co.halo.style.opacity = '0'
  }
  /** Do two leaders (anchor → elbow → shelf) cross? */
  const crosses = (a, b) => {
    const hit = (o, q) => {
      // o's diagonal against q's shelf
      const y = q.ey
      if ((o.ay - y) * (o.ey - y) > 0 || o.ay === o.ey) return false
      const x = o.ax + ((o.ex - o.ax) * (y - o.ay)) / (o.ey - o.ay)
      return x > Math.min(q.ex, q.end) - 4 && x < Math.max(q.ex, q.end) + 4
    }
    return hit(a, b) || hit(b, a)
  }
  function updateCallouts(c) {
    if (!gl || !calloutsOn) return
    const { W, H } = gl.sizeInfo()
    const { minX, maxX } = bounds
    live.length = 0
    for (const co of callouts) {
      const on = reduced ? STATIC_KEYS.has(co.key) : c >= co.cfg.win[0] && c < co.cfg.win[1]
      if (on !== co.on) {
        co.on = on
        co.tw?.kill()
        if (reduced) co.v = on ? 1 : 0
        else co.tw = gsap.to(co, { v: on ? 1 : 0, duration: on ? 1.1 : 0.45, ease: on ? 'power3.out' : 'power2.in' })
      }
      if (co.v <= 0.001) {
        hideCallout(co)
        continue
      }
      gl.project(co.key, co.pt)
      co.face = clamp((co.pt.facing + 0.05) / 0.3)
      co.ax = co.pt.x
      co.ay = co.pt.y
      co.up = co.cfg.place === 'above'
      const near = co.cfg.near
      co.ey = near ? co.ay + (co.up ? -near : near) : co.up ? Math.min(co.ay, box.t) - 46 : Math.max(co.ay, box.b) + 40
      let side = co.cfg.side
      const run = co.cfg.run * W
      if (side > 0 && co.ax + run + co.w + 12 > maxX) side = -1
      if (side < 0 && co.ax - run - co.w - 12 < minX) side = 1
      co.side = side
      co.ex = co.ax + side * run
      co.end = co.ex + side * (co.w + 14)
      co.x0 = Math.min(co.ex, co.end)
      co.x1 = Math.max(co.ex, co.end)
      live.push(co)
    }
    // collision pass: labels on the same side of her keep 72 px between
    // baselines, and leaders never cross (swap shelves, else flip a side)
    for (const up of [true, false]) {
      const g = live.filter((o) => o.up === up).sort((a, b) => (up ? b.ey - a.ey : a.ey - b.ey))
      for (let i = 1; i < g.length; i++) {
        for (let j = 0; j < i; j++) {
          const a = g[j]
          const b = g[i]
          if (b.x0 < a.x1 + 16 && b.x1 > a.x0 - 16 && Math.abs(b.ey - a.ey) < 72) b.ey = up ? a.ey - 72 : a.ey + 72
          if (crosses(a, b)) {
            ;[a.ey, b.ey] = [b.ey, a.ey]
            if (crosses(a, b)) {
              ;[a.ey, b.ey] = [b.ey, a.ey]
              b.side = -b.side
              b.ex = b.ax + b.side * b.cfg.run * W
              b.end = b.ex + b.side * (b.w + 14)
            }
          }
        }
      }
    }
    for (const co of live) {
      co.hidden = false
      const vis = co.v * co.face
      const { ax, ay, side, ex } = co
      const ey = clamp(co.ey, 84, H - 56)
      const end = co.end
      const d = `M${ax.toFixed(1)} ${ay.toFixed(1)}L${ex.toFixed(1)} ${ey.toFixed(1)}L${end.toFixed(1)} ${ey.toFixed(1)}`
      co.path.setAttribute('d', d)
      const len = Math.hypot(ex - ax, ey - ay) + Math.abs(end - ex)
      co.path.style.strokeDasharray = `${len.toFixed(1)} ${len.toFixed(1)}`
      co.path.style.strokeDashoffset = (len * (1 - co.v)).toFixed(1)
      co.path.style.opacity = co.face.toFixed(3)
      co.dot.setAttribute('cx', ax.toFixed(1))
      co.dot.setAttribute('cy', ay.toFixed(1))
      co.halo.setAttribute('cx', ax.toFixed(1))
      co.halo.setAttribute('cy', ay.toFixed(1))
      co.dot.style.opacity = vis.toFixed(3)
      co.halo.style.opacity = (vis * (0.55 + 0.45 * Math.sin(time * 2.2 + ax * 0.01))).toFixed(3)
      co.el.style.opacity = clamp((vis - 0.25) / 0.75).toFixed(3)
      co.el.style.transform = `translate3d(${(side > 0 ? ex + 7 : ex - 7 - co.w).toFixed(1)}px, ${ey.toFixed(1)}px, 0)`
      co.el.style.setProperty('--reveal', clamp((co.v - 0.35) / 0.65).toFixed(3))
      co.el.dataset.side = side > 0 ? 'r' : 'l'
    }
  }

  /* ---- the drag handle covers her, and only once she is there to turn */
  const grabbable = () => !!gl && !reduced && !touch && !stacked
  const gr = { l: 0, t: 0, w: 0, h: 0, on: false }
  const sbox = { l: 0, r: 0, t: 0, b: 0 }
  function updateGrab(c) {
    const on = grabbable() && c > -0.15 && c < TAIL - 0.03
    if (on !== gr.on) {
      gr.on = on
      grab.classList.toggle('is-on', on)
    }
    if (!on) return
    const b = c < 0.08 ? gl.sphereBox(sbox) : box
    const pad = 12
    const l = Math.round(b.l - pad)
    const t = Math.round(b.t - pad)
    const w = Math.round(b.r - b.l + pad * 2)
    const h = Math.round(b.b - b.t + pad * 2)
    if (Math.abs(l - gr.l) + Math.abs(t - gr.t) + Math.abs(w - gr.w) + Math.abs(h - gr.h) < 3) return
    Object.assign(gr, { l, t, w, h })
    grab.style.transform = `translate3d(${l}px, ${t}px, 0)`
    grab.style.width = w + 'px'
    grab.style.height = h + 'px'
  }

  /* ---- sizing */
  function resize() {
    if (!gl) return
    const r = view.getBoundingClientRect()
    shift.x = stacked ? 0 : r.width >= 1200 ? 0.11 : r.width >= 1100 ? 0.13 : 0.15
    shift.y = stacked ? 0 : 0.045
    gl.setSize(Math.round(r.width), Math.round(r.height))
    measureCallouts()
    dirty = true
  }
  const ro = new ResizeObserver(() => resize())
  ro.observe(view)

  /* ---- render only while on screen, and give the memory back when not */
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) active = e.isIntersecting
      if (gl) active ? gl.wake() : gl.sleep()
      dirty = true
      blank = false
    },
    { rootMargin: '10% 0px' },
  )
  io.observe(view)
  document.addEventListener('visibilitychange', () => (dirty = true))

  /* ---- scroll */
  const strokes = () => {
    const svg = drawing.querySelector('svg')
    const els = [...svg.querySelectorAll('.ve-sphere, .ve-port, .ve-cap, .ve-hull, .ve-part, .ve-dim path')]
    // from the sphere outward, the way the lines plan was drawn
    const cx = (SPHERE.x - SVG_X0) * 100
    const cy = (SVG_Y0 - SPHERE.y) * 100
    const d = new Map()
    for (const el of els) {
      let b
      try {
        b = el.getBBox()
      } catch {
        b = { x: cx, y: cy, width: 0, height: 0 }
      }
      const rx = Math.max(b.x - cx, 0, cx - (b.x + b.width))
      const ry = Math.max(b.y - cy, 0, cy - (b.y + b.height))
      d.set(el, Math.hypot(rx, ry) + (el.closest('.ve-dim') ? 400 : 0))
    }
    return els.sort((a, b) => d.get(a) - d.get(b))
  }
  const syncTarget = () => (S.target = S.pre - 1 + S.pin)
  const mm = gsap.matchMedia()
  mm.add({ pin: PIN_MQ, any: '(min-width: 0px)' }, (mc) => {
    pinned = !!mc.conditions.pin && !reduced && !!gl
    stacked = !pinned
    root.classList.toggle('vessel--stack', stacked)
    root.classList.toggle('vessel--pinned', pinned)
    lastAct = lastFill = -1
    if (stacked) actEls.forEach((a) => a.classList.add('is-active'))
    resize()
    measureActs()

    if (reduced) {
      S.c = S.target = STATIC_C
      banks.forEach((b) => setBank(b, true))
      dirty = true
      return () => actEls.forEach((a) => a.classList.remove('is-active'))
    }

    if (pinned) {
      const stageH = () => stage.offsetHeight
      // the copy scrolls on with the page while she holds for the hand-off
      const tailY = (self) => Math.max(0, self.progress * (self.end - self.start) - (self.end - self.start - stageH()))
      ScrollTrigger.create({
        trigger: stage,
        start: 'top 80%',
        end: 'top top',
        onUpdate: (self) => {
          S.pre = self.progress
          syncTarget()
        },
      })
      const pinST = ScrollTrigger.create({
        trigger: stage,
        start: 'top top',
        end: () => '+=' + Math.round(stageH() * PIN_LEN),
        pin: true,
        anticipatePin: 1,
        invalidateOnRefresh: true,
        onUpdate: (self) => {
          S.pin = self.progress
          syncTarget()
          setCopyY(tailY(self))
        },
        onRefresh: (self) => setCopyY(tailY(self)),
      })
      // the title is squeezed by pressure as it arrives
      gsap.fromTo(
        title,
        { '--squeeze': 1 },
        { '--squeeze': 0, ease: 'none', scrollTrigger: { trigger: root, start: 'top 90%', end: 'top top', scrub: true } },
      )
      // hand-off: once the drawing lies exactly over her, it draws itself
      // from the sphere outward while the 3D lines let go
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: plate,
          start: () => pinST.end,
          end: () => pinST.end + Math.round(window.innerHeight * 0.42),
          scrub: true,
          invalidateOnRefresh: true,
          onUpdate: (self) => (S.hand = self.progress),
        },
      })
      tl.fromTo(drawing, { '--draw-a': 0 }, { '--draw-a': 1, duration: 0.12, ease: 'none' }, 0)
      tl.fromTo(strokes(), { drawSVG: '0%' }, { drawSVG: '100%', duration: 0.42, ease: 'none', stagger: { amount: 0.4 } }, 0.02)
      tl.fromTo(drawing, { '--cap-a': 0 }, { '--cap-a': 1, duration: 0.3, ease: 'none' }, 0.7)
      return () => {
        setCopyY(0)
        S.pre = S.pin = S.hand = 0
      }
    }

    // stacked: one pass while the view crosses the screen
    ScrollTrigger.create({
      trigger: view,
      start: 'top 78%',
      end: 'bottom 62%',
      onUpdate: (self) => {
        S.target = lerp(STACK_RANGE[0], STACK_RANGE[1], self.progress)
      },
    })
    S.target = Math.max(S.target, STACK_RANGE[0])
    gsap.fromTo(
      strokes(),
      { drawSVG: '0%' },
      { drawSVG: '100%', ease: 'none', stagger: 0.012, scrollTrigger: { trigger: drawing, start: 'top 85%', end: 'bottom 60%', scrub: true } },
    )
    return () => actEls.forEach((a) => a.classList.remove('is-active'))
  })
  if (!reduced) {
    const rows = root.querySelectorAll('.vessel__spec')
    gsap.fromTo(
      rows,
      { '--rule': 0 },
      { '--rule': 1, ease: 'none', stagger: 0.06, scrollTrigger: { trigger: '.vessel__specs', start: 'top 85%', end: 'bottom 70%', scrub: true } },
    )
  }

  /* ---- pointer: a little parallax, and drag to turn her (fine pointers) */
  if (!reduced && !touch) {
    window.addEventListener(
      'pointermove',
      (e) => {
        if (!active) return
        S.mxT = (e.clientX / window.innerWidth) * 2 - 1
        S.myT = (e.clientY / window.innerHeight) * 2 - 1
      },
      { passive: true },
    )
    let drag = null
    grab.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0 || !grabbable()) return
      drag = { x: e.clientX, yaw: S.yawT }
      grab.setPointerCapture(e.pointerId)
      view.classList.add('is-dragging')
      gsap.killTweensOf(S, 'yawT')
    })
    grab.addEventListener('pointermove', (e) => {
      if (!drag) return
      S.yawT = clamp(drag.yaw + (e.clientX - drag.x) * 0.28, -140, 140)
    })
    const release = () => {
      if (!drag) return
      drag = null
      view.classList.remove('is-dragging')
      gsap.to(S, { yawT: 0, duration: 2.4, ease: 'power3.inOut', delay: 0.6 })
    }
    grab.addEventListener('pointerup', release)
    grab.addEventListener('pointercancel', release)
  }

  /* ---- adaptive resolution: start modest, step up while frames are fast,
     step down (for good) if they run long */
  let slow = 0
  let fast = 0
  let frames = 0
  let settled = false
  const watchFrame = (dt) => {
    if (reduced || !gl || maxDpr <= 1) return
    frames++
    if (dt > 1 / 40) slow++
    else if (dt < 1 / 55) fast++
    if (frames < 90) return
    if (slow > 45 && dprNow > 1) {
      dprNow = Math.max(1, dprNow - 0.25)
      settled = true
      gl.setDpr(dprNow)
    } else if (!settled && fast > 80 && dprNow < maxDpr) {
      dprNow = Math.min(maxDpr, dprNow + 0.25)
      gl.setDpr(dprNow)
    }
    frames = slow = fast = 0
  }

  /* ---- frame loop */
  let last = performance.now()
  const frame = () => {
    const now = performance.now()
    const dt = Math.min(0.5, (now - last) / 1000)
    last = now
    if (!active || document.hidden) return
    if (reduced && !dirty) return
    dirty = false
    time += dt
    const k = 1 - Math.exp(-dt * 7.5)
    S.c += (S.target - S.c) * k
    if (Math.abs(S.target - S.c) < 1e-4) S.c = S.target
    S.yaw += (S.yawT - S.yaw) * (1 - Math.exp(-dt * 8))
    S.mx += (S.mxT - S.mx) * (1 - Math.exp(-dt * 2.5))
    S.my += (S.myT - S.my) * (1 - Math.exp(-dt * 2.5))
    const c = S.c

    for (let i = 0; i < 3; i++) setBank(banks[i], c >= BANKS_AT[i])
    updateDOM(c)
    if (!gl) return
    const st = stateAt(c)
    // after the hand-off there is nothing left to draw: clear once, then rest
    const empty = st.build < 0.001 && (st.wire < 0.003 || st.draw < 0.001) && st.glow < 0.002
    if (empty && blank) return
    blank = empty
    gl.update(st, time)
    gl.render()
    watchFrame(dt)
    if (!empty) gl.screenBox(box)
    updateCallouts(c)
    updateGrab(empty ? -9 : c)

    if (!sonarDone && !reduced && c >= SONAR_AT && c < TAIL) {
      sonarDone = true
      const r = view.getBoundingClientRect()
      const s = gl.project('lamps', pt)
      ctx.emit('sonar', { x: r.left + s.x, y: r.top + s.y, strength: 0.5 })
    }
  }
  gsap.ticker.add(frame)

  updateDOM(S.c)
  ScrollTrigger.addEventListener('refresh', () => {
    measureCallouts()
    measureActs()
    measureHandoff()
    dirty = true
    blank = false
  })
  if (gl) gl.warm().then(() => (dirty = true))
}
