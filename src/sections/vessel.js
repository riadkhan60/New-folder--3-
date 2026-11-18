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
  ExtrudeGeometry,
  Shape,
  Vector2,
  Vector3,
  Vector4,
  Matrix4,
  Quaternion,
  Color,
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
  // flank pods, vertical
  { p: [-0.78, 0.5, 0.9], d: [0, 1, 0], s: 1.0 },
  { p: [-0.78, 0.5, -0.9], d: [0, 1, 0], s: 1.0 },
  { p: [0.42, 0.66, 0.88], d: [0, 1, 0], s: 0.95 },
  { p: [0.42, 0.66, -0.88], d: [0, 1, 0], s: 0.95 },
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
    else if (t.d[1] !== 0) out.push(`<rect class="ve-part" x="${X(t.p[0] - 0.165 * s)}" y="${Y(t.p[1] + 0.1 * s)}" width="${(0.33 * s * K).toFixed(1)}" height="${(0.2 * s * K).toFixed(1)}" rx="3"/>`)
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
  const satin = [duct]
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.3
    const b = new BoxGeometry(0.1, 0.012, 0.014)
    b.translate(0.085, -L * 0.32, 0)
    b.rotateY(a)
    satin.push(b)
  }
  const dark = [new CylinderGeometry(0.038, 0.046, 0.15, 18), new SphereGeometry(0.038, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.075, 0)]
  for (let k = 0; k < 5; k++) {
    const b = new BoxGeometry(0.09, 0.008, 0.042)
    b.rotateX(0.55)
    b.translate(0.078, 0.02, 0)
    b.rotateY((k / 5) * Math.PI * 2)
    dark.push(b)
  }
  return { satin: merge(satin), dark: merge(dark) }
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

function patch(mat, U, variant, { seams = false } = {}) {
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
        #ifdef VESPER_SEAMS
          vsSm = max(vsSm, vsSeam(vLocal.x + 1.18));
          vsSm = max(vsSm, vsSeam(vLocal.x - 0.12));
          vsSm = max(vsSm, vsSeam(vLocal.x + 0.55) * step(0.42, vLocal.y));
          vsSm = max(vsSm, vsSeam(vLocal.y - 0.42) * step(vLocal.x, 1.55));
          vsSm = max(vsSm, vsSeam(vLocal.z) * step(1.0, vLocal.y));
          diffuseColor.rgb *= 1.0 - 0.6 * vsSm;
          diffuseColor.rgb *= mix(0.62, 1.08, smoothstep(-1.5, 1.3, vLocal.y));
        #endif`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += uEdge * vsEdge * 2.6;`,
      )
    if (seams) {
      frag = frag.replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + vsSm * 0.35 + (vsNoise(vLocal * 22.0) - 0.5) * 0.07, 0.0, 1.0);`,
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

function sliceInto(out, geo) {
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
    const delay = clamp(Math.hypot(mx, my, mz) / maxD) * 0.84 + rnd() * 0.07
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
    uniforms: { uDraw: { value: 0 }, uAlpha: { value: 1 }, uColor: { value: new Color(PHOTOPHORE) } },
    vertexShader: /* glsl */ `
      attribute vec2 aSeg;
      varying float vT; varying float vDelay; varying float vFade;
      void main() {
        vT = aSeg.y; vDelay = aSeg.x;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFade = smoothstep(15.5, 8.0, -mv.z);
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
    uniforms: { uI: { value: 0 }, uColor: { value: new Color('#d8f4ff') } },
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
      uniform float uI; uniform vec3 uColor;
      varying float vAlong; varying vec3 vN; varying vec3 vV;
      void main() {
        float f = abs(dot(normalize(vN), normalize(vV)));
        float a = uI * pow(f, 1.7) * pow(1.0 - vAlong, 2.3) * smoothstep(0.0, 0.05, vAlong) * 0.3;
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
      uMin: { value: new Vector3(1.4, -6.5, -3.6) },
      uSize: { value: new Vector3(8.5, 8.4, 7.2) },
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
        gl_PointSize = clamp(uPx * (0.6 + 1.5 * aRand.w) / -mv.z, 1.0, 26.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uBase;
      varying float vI;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.05, d);
        float k = a * (min(vI, 1.5) * 0.95 + uBase);
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
    uniforms: { uBanks: { value: new Vector3() }, uPx: { value: 36 * dpr }, uMap: { value: flareTexture() } },
    vertexShader: /* glsl */ `
      attribute float aBank;
      uniform vec3 uBanks; uniform float uPx;
      varying float vI;
      void main() {
        float I = aBank < 0.5 ? uBanks.x : (aBank < 1.5 ? uBanks.y : uBanks.z);
        vI = I;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = I > 0.01 ? uPx * (0.55 + 0.45 * min(I, 1.3)) * (10.0 / -mv.z) : 0.0;
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

/* ==========================================================================
   The scene
   ========================================================================== */

function createVesper(canvas, { dpr, mobile }) {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' })
  renderer.setClearColor(0x000000, 0)
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.outputColorSpace = SRGBColorSpace
  renderer.setPixelRatio(dpr)

  const scene = new Scene()
  const pmrem = new PMREMGenerator(renderer)
  const room = new RoomEnvironment()
  scene.environment = pmrem.fromScene(room, 0.04).texture
  scene.environmentIntensity = 0.42
  room.dispose?.()
  pmrem.dispose()

  const camera = new PerspectiveCamera(26, 1, 0.1, 80)
  const target = new Vector3(0.06, -0.12, 0)

  const U = {
    uBuild: { value: 0 },
    uRootInv: { value: new Matrix4() },
    uCore: { value: CORE.clone() },
    uEdge: { value: new Color(PHOTOPHORE) },
  }

  const root = new Group()
  scene.add(root)
  const surfaces = []
  const sliceSrc = []

  /* ---- materials */
  const M = {
    hull: patch(
      new MeshPhysicalMaterial({
        color: '#171b1f',
        metalness: 0.18,
        roughness: 0.44,
        clearcoat: 0.55,
        clearcoatRoughness: 0.28,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      }),
      U,
      'hull',
      { seams: true },
    ),
    sphere: patch(
      new MeshPhysicalMaterial({ color: '#cfcac3', metalness: 1, roughness: 0.13, clearcoat: 0.3, clearcoatRoughness: 0.08, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
      U,
      'sphere',
    ),
    satin: patch(new MeshPhysicalMaterial({ color: '#8f959c', metalness: 1, roughness: 0.32, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }), U, 'satin'),
    dark: patch(new MeshPhysicalMaterial({ color: '#2b3036', metalness: 0.75, roughness: 0.42, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }), U, 'dark'),
    acrylic: patch(
      new MeshPhysicalMaterial({
        color: '#041a1e',
        metalness: 0,
        roughness: 0.03,
        clearcoat: 1,
        clearcoatRoughness: 0.02,
        ior: 1.49,
        specularIntensity: 1,
        emissive: new Color('#2fd8c8'),
        emissiveIntensity: 0.0,
      }),
      U,
      'acrylic',
    ),
  }
  const add = (geo, mat, slice = true) => {
    const m = new Mesh(geo, mat)
    root.add(m)
    surfaces.push(m)
    if (slice) sliceSrc.push(geo)
    return m
  }

  /* ---- foam body */
  add(hullGeometry(), M.hull)

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
  // flank pylons
  for (const t of THRUSTERS.slice(4, 8)) {
    const s = Math.sign(t.p[2])
    satin.push(rod(new Vector3(t.p[0], t.p[1], s * (sideZ(t.p[0], t.p[1]) - 0.08)), new Vector3(t.p[0], t.p[1], t.p[2] - s * 0.15), 0.03))
  }
  // hatch coaming on the deck above the sphere
  const deck = profileAt(SPHERE.x)[1] + HULL.bevelS
  satin.push(new CylinderGeometry(0.31, 0.33, 0.1, 48).translate(SPHERE.x, deck + 0.02, 0))
  satin.push(new TorusGeometry(0.15, 0.018, 8, 32).rotateX(Math.PI / 2).translate(SPHERE.x, deck + 0.13, 0))
  // instrument boom
  const mastA = new Vector3(1.5, profileAt(1.5)[1] + HULL.bevelS - 0.04, -0.35)
  const mastB = new Vector3(2.18, 1.17, -0.35)
  satin.push(rod(mastA, mastB, 0.03))
  satin.push(rod(new Vector3(2.2, 1.11, -0.52), new Vector3(2.2, 1.11, -0.18), 0.02))
  add(merge(satin), M.satin)

  const dark = []
  dark.push(new CylinderGeometry(0.29, 0.3, 0.06, 48).translate(SPHERE.x, deck + 0.09, 0))
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
  THRUSTERS.forEach((t, i) => {
    const p = v3(t.p)
    if (t.side) p.z = t.side * (sideZ(p.x, p.y) - 0.06)
    const m = new Matrix4().compose(p, aim(v3(t.d)), new Vector3(t.s, t.s, t.s))
    tSat.setMatrixAt(i, m)
    tDark.setMatrixAt(i, m)
    sliceSrc.push(T.satin.clone().applyMatrix4(m))
  })
  root.add(tSat, tDark)
  surfaces.push(tSat, tDark)

  /* ---- lamps: heads, lenses (instanced, coloured per bank), flares */
  const lampBody = merge([new CylinderGeometry(0.036, 0.044, 0.08, 16), new TorusGeometry(0.034, 0.006, 6, 20).rotateX(Math.PI / 2).translate(0, 0.04, 0)])
  const lensGeo = new CircleGeometry(0.03, 20).rotateX(-Math.PI / 2).translate(0, 0.0405, 0)
  const lamps = new InstancedMesh(lampBody, M.dark, LAMPS.length)
  const lensMat = new MeshBasicMaterial({ color: '#ffffff', toneMapped: false })
  const lenses = new InstancedMesh(lensGeo, lensMat, LAMPS.length)
  const flarePos = new Float32Array(LAMPS.length * 3)
  const flareBank = new Float32Array(LAMPS.length)
  const dim = new Color('#0c1f24')
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
  const N = mobile ? 900 : 2000
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

  /* ---- light rig: key + two photophore rims, kept relative to the camera */
  const key = new DirectionalLight('#dff3ff', 1.5)
  const rimA = new DirectionalLight(PHOTOPHORE, 3.4)
  const rimB = new DirectionalLight(PHOTOPHORE_2, 3.0)
  scene.add(key, rimA, rimB)
  const spot = new SpotLight('#eaf9ff', 0, 9, 34 * DEG, 0.7, 1.4)
  spot.position.set(2.15, -0.05, 0)
  spot.target.position.set(4.2, -1.6, 0.1)
  root.add(spot, spot.target)

  /* ---- anchors for callouts (local point, outward normal) */
  const anchors = {
    sphere: { p: S.clone().addScaledVector(new Vector3(0.34, 0.3, 0.89).normalize(), SPHERE.r), n: new Vector3(0.34, 0.3, 0.89).normalize() },
    rated: { p: new Vector3(-0.3, profileAt(-0.3)[1] + HULL.bevelS, 0.12), n: new Vector3(0, 1, 0.3).normalize(), always: true },
    foam: { p: new Vector3(-0.62, 0.12, sideZ(-0.62, 0.12)), n: new Vector3(0, 0, 1) },
    viewports: { p: S.clone().addScaledVector(VIEWPORT_DIRS[1], SPHERE.r + 0.02), n: VIEWPORT_DIRS[1].clone() },
    lamps: { p: LAMPS[7].p.clone(), n: new Vector3(0.75, -0.2, 0.6).normalize() },
  }

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
  let shiftX = 0
  let shiftY = 0

  function setSize(w, h, sx = 0, sy = 0) {
    W = Math.max(1, w)
    H = Math.max(1, h)
    shiftX = sx
    shiftY = sy
    renderer.setSize(W, H, false)
    camera.aspect = W / H
    camera.setViewOffset(W, H, -sx * W, -sy * H, W, H)
    camera.updateProjectionMatrix()
  }

  function update(s, t) {
    // camera on a sphere around the vessel
    const [az, el, dist] = s.cam
    const a = az * DEG
    const e = el * DEG
    camera.position.set(target.x + dist * Math.sin(a) * Math.cos(e), target.y + dist * Math.sin(e), target.z + dist * Math.cos(a) * Math.cos(e))
    camera.lookAt(target)
    camera.updateMatrixWorld()
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
    place(rimA, -7, 4, -8)
    place(rimB, 8, -1.5, -7)

    // acts
    const build = s.build
    U.uBuild.value = build
    const built = build > 0.001
    for (const m of surfaces) m.visible = built
    lenses.visible = build > 0.95
    lineMat.uniforms.uDraw.value = s.draw
    lineMat.uniforms.uAlpha.value = s.wire
    lines.visible = s.draw > 0.001 && s.wire > 0.003
    M.acrylic.emissiveIntensity = 0.05 + s.cabin * 0.5

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
        lensColor.copy(dim).lerp(new Color(1, 1, 1), clamp(I)).multiplyScalar(1 + 1.6 * clamp(I))
        lenses.setColorAt(i, lensColor)
      })
      lenses.instanceColor.needsUpdate = true
    }
    flares.material.uniforms.uBanks.value.set(b[0], b[1], b[2])
    flares.visible = b[0] + b[1] + b[2] > 0.005
    BEAMS.forEach((bm, i) => {
      const I = b[bm.bank]
      beams[i].material.uniforms.uI.value = I
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

  return { renderer, setSize, update, render, project, warm, sizeInfo: () => ({ W, H, shiftX, shiftY }) }
}

/* ==========================================================================
   Choreography: everything is a pure function of p (0..1)
   ========================================================================== */

const CAM_DESKTOP = [
  // p, azimuth°, elevation°, distance
  [0.0, -34, 9, 11.8],
  [0.29, 4, 6, 11.0],
  [0.58, 42, -2, 10.4],
  [0.86, 30, 4, 10.9],
  [1.0, 24, 6, 11.3],
]
const CAM_MOBILE = [
  [0.0, -30, 8, 12.4],
  [0.35, 10, 6, 12.0],
  [0.65, 40, 0, 11.6],
  [1.0, 30, 5, 12.0],
]
const ACTS = [
  [0, 0.29],
  [0.29, 0.58],
  [0.58, 0.86],
]
const BANKS_AT = [0.6, 0.67, 0.74]
const SONAR_AT = 0.79

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
  const actEls = [...root.querySelectorAll('.vessel__act')]
  const fillEls = actEls.map((a) => a.querySelector('.vessel__act-fill'))
  const leaders = $('.vessel__leaders')
  const reduced = ctx.reducedMotion
  let mobile = ctx.isMobile()

  if (reduced) root.classList.add('vessel--static')

  /* ---- 2D: the plate drawing, always */
  $('.vessel__elevation').innerHTML = elevationSVG('plate')

  /* ---- 3D, if the browser can */
  let gl = null
  try {
    gl = createVesper(canvas, { dpr: mobile ? Math.min(ctx.dpr, 1.25) : ctx.dpr, mobile })
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

  /* ---- callouts: DOM + leader paths */
  const SVGNS = 'http://www.w3.org/2000/svg'
  const CALLOUTS = {
    sphere: { win: [0.07, 0.44], side: 1, rise: -0.15, run: 0.05 },
    rated: { win: [0.15, 0.5], side: 1, rise: -0.1, run: 0.06 },
    foam: { win: [0.37, 0.7], side: -1, rise: 0.17, run: 0.04 },
    viewports: { win: [0.45, 0.8], side: 1, rise: 0.15, run: 0.05 },
    lamps: { win: [0.63, 1.01], side: 1, rise: -0.17, run: 0.05 },
  }
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
    return { el, key, cfg: CALLOUTS[key], path, dot, halo, v: 0, on: false, tw: null, w: 0, pt: { x: 0, y: 0, facing: 1 } }
  })
  const measureCallouts = () => callouts.forEach((c) => (c.w = Math.max(c.el.querySelector('.vessel__callout-title').offsetWidth, c.el.querySelector('.vessel__callout-sub').offsetWidth)))

  /* ---- state */
  const S = { p: 0, target: 0, yaw: 0, yawT: 0, mx: 0, my: 0, mxT: 0, myT: 0 }
  let time = 0
  let active = false
  let dirty = true
  let sonarDone = false
  const banks = [{ v: 0, on: false }, { v: 0, on: false }, { v: 0, on: false }]
  let lastAct = -1
  let lastFill = -1

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

  function stateAt(p) {
    return {
      draw: range(p, 0.0, 0.27) * 1.2,
      build: ease(range(p, 0.29, 0.56)),
      wire: (1 - 0.88 * range(p, 0.46, 0.64)) * (1 - range(p, 0.62, 0.8)),
      cabin: range(p, 0.5, 0.62),
      banks: banks.map((b) => b.v),
      cam: sampleKeys(mobile ? CAM_MOBILE : CAM_DESKTOP, p),
      bob: reduced ? 0 : Math.sin(time * 0.42) * 0.035,
      roll: reduced ? 0 : Math.sin(time * 0.31 + 1.2) * 0.008,
    }
  }

  /* ---- DOM, per frame (cheap writes only when values change) */
  function updateDOM(p) {
    if (mobile || reduced) return
    const fill = range(p, 0.29, 0.56)
    const f = Math.round(fill * 1000) / 1000
    if (f !== lastFill) {
      lastFill = f
      title.style.setProperty('--fill', f.toFixed(3))
      title.style.setProperty('--stroke', (1 - range(p, 0.5, 0.6)).toFixed(3))
    }
    const act = p < ACTS[1][0] ? 0 : p < ACTS[2][0] ? 1 : 2
    if (act !== lastAct) {
      lastAct = act
      actEls.forEach((a, i) => a.classList.toggle('is-active', i === act))
    }
    ACTS.forEach(([a, b], i) => (fillEls[i].style.transform = `scaleX(${range(p, a, b).toFixed(4)})`))
  }

  const pt = { x: 0, y: 0, facing: 1 }
  function updateCallouts(p) {
    if (!gl || mobile) return
    const { W, H } = gl.sizeInfo()
    const copyR = copy.querySelector('.vessel__lead').getBoundingClientRect()
    const viewR = view.getBoundingClientRect()
    const minX = Math.max(24, copyR.right - viewR.left + 28)
    const maxX = W - 24 - (window.innerWidth >= 1024 ? 84 : 12)
    for (const c of callouts) {
      const on = reduced ? c.key !== 'rated' : p >= c.cfg.win[0] && p < c.cfg.win[1]
      if (on !== c.on) {
        c.on = on
        c.tw?.kill()
        if (reduced) c.v = on ? 1 : 0
        else c.tw = gsap.to(c, { v: on ? 1 : 0, duration: on ? 1.1 : 0.45, ease: on ? 'power3.out' : 'power2.in' })
      }
      if (c.v <= 0.001) {
        c.el.style.opacity = '0'
        c.path.style.opacity = c.dot.style.opacity = c.halo.style.opacity = '0'
        continue
      }
      gl.project(c.key, c.pt)
      const face = clamp((c.pt.facing + 0.05) / 0.3)
      const vis = c.v * face
      const ax = c.pt.x
      const ay = c.pt.y
      let side = c.cfg.side
      const run = c.cfg.run * W
      let ex = ax + side * run
      const ey = clamp(ay + c.cfg.rise * H, 70, H - 60)
      if (side > 0 && ex + c.w + 12 > maxX) side = -1
      if (side < 0 && ex - c.w - 12 < minX) side = 1
      ex = ax + side * run
      const end = ex + side * (c.w + 14)
      const d = `M${ax.toFixed(1)} ${ay.toFixed(1)}L${ex.toFixed(1)} ${ey.toFixed(1)}L${end.toFixed(1)} ${ey.toFixed(1)}`
      c.path.setAttribute('d', d)
      const len = Math.hypot(ex - ax, ey - ay) + Math.abs(end - ex)
      c.path.style.strokeDasharray = `${len.toFixed(1)} ${len.toFixed(1)}`
      c.path.style.strokeDashoffset = (len * (1 - c.v)).toFixed(1)
      c.path.style.opacity = face.toFixed(3)
      c.dot.setAttribute('cx', ax.toFixed(1))
      c.dot.setAttribute('cy', ay.toFixed(1))
      c.halo.setAttribute('cx', ax.toFixed(1))
      c.halo.setAttribute('cy', ay.toFixed(1))
      c.dot.style.opacity = vis.toFixed(3)
      c.halo.style.opacity = (vis * (0.55 + 0.45 * Math.sin(time * 2.2 + ax * 0.01))).toFixed(3)
      c.el.style.opacity = clamp((vis - 0.25) / 0.75).toFixed(3)
      c.el.style.transform = `translate3d(${(side > 0 ? ex + 7 : ex - 7 - c.w).toFixed(1)}px, ${ey.toFixed(1)}px, 0)`
      c.el.style.setProperty('--reveal', clamp((c.v - 0.35) / 0.65).toFixed(3))
      c.el.dataset.side = side > 0 ? 'r' : 'l'
    }
  }

  /* ---- sizing */
  function resize() {
    mobile = ctx.isMobile()
    root.classList.toggle('vessel--mobile', mobile)
    if (!gl) return
    const r = view.getBoundingClientRect()
    // desktop: Vesper sits right of centre, clear of the copy column
    const sx = mobile ? 0 : r.width >= 1200 ? 0.11 : 0.13
    const sy = mobile ? 0 : 0.045
    gl.setSize(Math.round(r.width), Math.round(r.height), sx, sy)
    measureCallouts()
    dirty = true
  }
  const ro = new ResizeObserver(() => resize())
  ro.observe(view)
  resize()

  /* ---- render only while on screen */
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) active = e.isIntersecting
      dirty = true
    },
    { rootMargin: '10% 0px' },
  )
  io.observe(view)
  document.addEventListener('visibilitychange', () => (dirty = true))

  /* ---- scroll */
  const mm = gsap.matchMedia()
  mm.add({ desktop: '(min-width: 768px)', mobile: '(max-width: 767px)' }, (c) => {
    if (reduced) {
      S.p = S.target = 0.9
      banks.forEach((b) => setBank(b, true))
      dirty = true
      return
    }
    if (c.conditions.desktop) {
      ScrollTrigger.create({
        trigger: stage,
        start: 'top top',
        end: () => '+=' + Math.round(window.innerHeight * 3.3),
        pin: true,
        anticipatePin: 1,
        invalidateOnRefresh: true,
        onUpdate: (self) => (S.target = self.progress),
      })
      // the title is squeezed by pressure as it arrives
      gsap.fromTo(
        title,
        { '--squeeze': 1 },
        { '--squeeze': 0, ease: 'none', scrollTrigger: { trigger: root, start: 'top 90%', end: 'top top', scrub: true } },
      )
    } else {
      ScrollTrigger.create({
        trigger: view,
        start: 'top 80%',
        end: 'bottom 30%',
        onUpdate: (self) => (S.target = self.progress),
      })
    }
    // the plate drawing is traced as it comes up
    const strokes = root.querySelectorAll('.vessel__elevation .ve-hull, .vessel__elevation .ve-cap, .vessel__elevation .ve-part, .vessel__elevation .ve-sphere, .vessel__elevation .ve-sphere-in, .vessel__elevation .ve-port, .vessel__elevation .ve-dim path')
    gsap.fromTo(
      strokes,
      { drawSVG: '0%' },
      { drawSVG: '100%', ease: 'none', stagger: 0.012, scrollTrigger: { trigger: '.vessel__drawing', start: 'top 85%', end: 'bottom 60%', scrub: true } },
    )
    const rows = root.querySelectorAll('.vessel__spec')
    gsap.fromTo(
      rows,
      { '--rule': 0 },
      { '--rule': 1, ease: 'none', stagger: 0.06, scrollTrigger: { trigger: '.vessel__specs', start: 'top 85%', end: 'bottom 70%', scrub: true } },
    )
  })

  /* ---- pointer: a little parallax, and drag to turn her (desktop only) */
  if (!reduced && !ctx.isTouch) {
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
    view.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0 || mobile || !gl) return
      drag = { x: e.clientX, yaw: S.yawT }
      view.setPointerCapture(e.pointerId)
      view.classList.add('is-dragging')
      gsap.killTweensOf(S, 'yawT')
    })
    view.addEventListener('pointermove', (e) => {
      if (!drag) return
      S.yawT = clamp(drag.yaw + (e.clientX - drag.x) * 0.28, -140, 140)
    })
    const release = () => {
      if (!drag) return
      drag = null
      view.classList.remove('is-dragging')
      gsap.to(S, { yawT: 0, duration: 2.4, ease: 'power3.inOut', delay: 0.6 })
    }
    view.addEventListener('pointerup', release)
    view.addEventListener('pointercancel', release)
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
    const k = 1 - Math.exp(-dt * 6.5)
    S.p += (S.target - S.p) * k
    S.yaw += (S.yawT - S.yaw) * (1 - Math.exp(-dt * 8))
    S.mx += (S.mxT - S.mx) * (1 - Math.exp(-dt * 2.5))
    S.my += (S.myT - S.my) * (1 - Math.exp(-dt * 2.5))
    const p = S.p

    for (let i = 0; i < 3; i++) setBank(banks[i], p >= BANKS_AT[i])
    updateDOM(p)
    if (!gl) return
    const st = stateAt(p)
    st.cam[0] += S.yaw + S.mx * 3.5 + (mobile && !reduced ? Math.sin(time * 0.16) * 9 : 0)
    st.cam[1] += -S.my * 2
    gl.update(st, time)
    gl.render()
    updateCallouts(p)

    if (!sonarDone && !reduced && p >= SONAR_AT) {
      sonarDone = true
      const r = view.getBoundingClientRect()
      const c = gl.project('lamps', pt)
      ctx.emit('sonar', { x: r.left + c.x, y: r.top + c.y, strength: 0.5 })
    }
  }
  gsap.ticker.add(frame)

  if (gl) gl.warm().then(() => (dirty = true))
}
