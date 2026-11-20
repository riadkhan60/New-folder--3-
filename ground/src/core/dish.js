/**
 * dish.js — the dish: a live GPU fluid simulation behind the whole page.
 *
 * A WebGL2 stable-fluids solver (velocity + dye ping-pong, semi-Lagrangian
 * advection, curl + vorticity confinement, divergence, Jacobi pressure,
 * gradient subtraction). The dye is not colour: it is optical density
 * (absorbance) per channel, D = −ln(colour / paper) in linear light, so
 * pigments mix subtractively like paint (ultramarine + ochre gives a dark
 * green), and the screen shows paper × exp(−D). Alpha carries how much of
 * the density belongs to granulating pigment, so ultramarine and the earths
 * settle into the tooth of the paper as speckle while carmine stays smooth.
 *
 * Contract (DESIGN.md §8):
 *   - follows ctx.palette.onChange: a new field is poured in, then the dish
 *     relaxes to it; on paper it relaxes slowly so drops linger as blooms.
 *     Each chapter pours in its own way (GESTURES); paper is poured as clear
 *     water that lifts the last colour cleanly, never as grey dishwater
 *   - on paper the water travels with the page, so a drop stays with the
 *     section it was made in; on a colour field it drifts more slowly
 *   - text stays readable: under the type of the current field (measured
 *     line boxes, rasterised to a small mask) dye settles to the field faster,
 *     and right after a pour it settles there first
 *   - indigo is dropped as the pale yellow-green of its vat and turns blue as
 *     the air reaches it (pigments.js: indigo)
 *   - ctx.on('drop', { id, x, y, amount, radius, vx, vy, mode })
 *       x, y     0..1 viewport units (default centre)
 *       amount   1 = masstone strength at the centre (0..4)
 *       radius   fraction of the viewport's shorter side (default 0.12)
 *       vx, vy   momentum, viewport units per second (y down)
 *       id       pigment id; 'paper' or 'water' drops clear water (lifts colour)
 *       mode     'mix' replaces the colour under the drop instead of layering it
 *   - ctx.on('stir', { x, y, dx, dy, strength, radius })
 *   - the pointer (and a dragging finger) stirs on its own
 *   - no WebGL2 / no renderable float textures / reduced motion → html.no-dish
 * While it runs, html gets .dish-on. Nothing else is exposed.
 */
import '../styles/dish.css'

/* ===================================================================== optics */

// How strongly each pigment granulates in a wash: 1 = ultramarine (coarse
// crystals that settle into the paper), ~0 = a smooth staining dye or lake.
const GRANULATION = {
  ultramarine: 1,
  'egyptian-blue': 0.9,
  'yellow-ochre': 0.75,
  'red-ochre': 0.7,
  malachite: 0.65,
  'bone-black': 0.5,
  vermilion: 0.45,
  orpiment: 0.35,
  'lead-white': 0.3,
  indigo: 0.15,
  'tyrian-purple': 0.12,
  carmine: 0.08,
  paper: 0,
}

// How each field is poured in, from the edge the page scrolls towards.
// 'wave' floods along the whole edge (wet earth), 'smoke' sends up curling
// plumes (soot from charred bone), 'stream' pours a jet from one point,
// 'bloom' drops the colour into the centre and lets it open out (a lump of
// lapis), 'scatter' rains drops that bloom and merge (crushed insects).
const GESTURES = {
  paper: { kind: 'wave', x: 0.5 },
  'yellow-ochre': { kind: 'wave', x: 0.42 },
  'bone-black': { kind: 'smoke', x: 0.5 },
  'egyptian-blue': { kind: 'stream', x: 0.24 },
  'tyrian-purple': { kind: 'stream', x: 0.8 },
  ultramarine: { kind: 'bloom', x: 0.5 },
  carmine: { kind: 'scatter', x: 0.5 },
}

// Pigments that change colour in the water. Indigo forms in the vat as a pale
// yellow-green and only turns blue when the air reaches it (pigments.js).
const DEVELOP = {
  indigo: { from: '#d4d88f', delay: 0.35, dur: 1.5 },
}

const toLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
const hexLin = (h) => [1, 3, 5].map((i) => toLin(parseInt(h.slice(i, i + 2), 16) / 255))
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const rand = (a, b) => a + Math.random() * (b - a)

/* ==================================================================== shaders */

const HEAD = `#version 300 es
precision highp float;
precision highp sampler2D;
`

const NOISE = `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3. - 2. * f);
  return mix(mix(hash12(i), hash12(i + vec2(1., 0.)), u.x), mix(hash12(i + vec2(0., 1.)), hash12(i + vec2(1., 1.)), u.x), u.y);
}
float fbm(vec2 p){
  float a = .5, s = 0.;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= .5; }
  return s / .9375;
}
`

const FILTER = (manual) =>
  manual
    ? `
vec4 SAMPLE(sampler2D s, vec2 uv, vec2 ts){
  vec2 st = uv / ts - .5; vec2 i = floor(st); vec2 f = fract(st);
  vec4 a = texture(s, (i + vec2(.5, .5)) * ts), b = texture(s, (i + vec2(1.5, .5)) * ts);
  vec4 c = texture(s, (i + vec2(.5, 1.5)) * ts), d = texture(s, (i + vec2(1.5, 1.5)) * ts);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
`
    : `
#define SAMPLE(s, uv, ts) texture(s, uv)
`

const VERT = `${HEAD}
layout(location = 0) in vec2 aPos;
uniform vec2 uTexel;
out vec2 vUv; out vec2 vL; out vec2 vR; out vec2 vT; out vec2 vB;
void main(){
  vUv = aPos * .5 + .5;
  vL = vUv - vec2(uTexel.x, 0.); vR = vUv + vec2(uTexel.x, 0.);
  vT = vUv + vec2(0., uTexel.y); vB = vUv - vec2(0., uTexel.y);
  gl_Position = vec4(aPos, 0., 1.);
}`

const FS = {
  fill: `
in vec2 vUv; out vec4 o;
uniform vec4 uValue;
void main(){ o = uValue; }`,

  scale: `
in vec2 vUv; out vec4 o;
uniform sampler2D uTex; uniform float uMul;
void main(){ o = texture(uTex, vUv) * uMul; }`,

  copy: `
in vec2 vUv; out vec4 o;
uniform sampler2D uTex; uniform vec2 uSrcTexel;
void main(){ o = SAMPLE(uTex, vUv, uSrcTexel); }`,

  // One splat: a ragged, optionally stretched gaussian. Velocity splats push
  // (uAdd.xy), open outwards (uRadial) and turn (uSwirl); dye splats layer
  // density (uAdd), replace it (uMixTo · uMixAmt) or develop it: the part of
  // the density that is one colour (dot(rgb, uDevA)) turns into another
  // (+ uDevTo per unit), as indigo turns from yellow-green to blue in air.
  splat: `
in vec2 vUv; out vec4 o;
uniform sampler2D uTarget;
uniform float uAspect; uniform vec2 uPoint; uniform float uRadius;
uniform vec2 uDir; uniform float uStretch; uniform float uRough; uniform float uSeed;
uniform vec4 uAdd; uniform vec4 uMixTo; uniform float uMixAmt;
uniform float uRadial; uniform float uSwirl;
uniform vec4 uDevA; uniform vec4 uDevTo; uniform float uDevAmt;
${NOISE}
void main(){
  vec2 p = vUv - uPoint; p.x *= uAspect;
  vec2 q = vec2(dot(p, uDir), dot(p, vec2(-uDir.y, uDir.x)));
  q.x /= uStretch;
  vec2 nq = q / uRadius;
  float n = (vnoise(nq * 1.7 + uSeed) - .5) + (vnoise(nq * 4.3 - uSeed * 1.31) - .5) * .5;
  float r = length(nq) * (1. + uRough * n);
  float g = exp(-r * r);
  vec4 base = texture(uTarget, vUv);
  vec2 out2 = p / (length(p) + 1e-5);
  vec2 push = (out2 * uRadial + vec2(-out2.y, out2.x) * uSwirl) * (r * g * 2.33);
  vec4 res = base + uAdd * g + vec4(push, 0., 0.);
  if (uDevAmt > 0.) res += uDevTo * clamp(dot(base.rgb, uDevA.rgb), 0., 4.) * clamp(uDevAmt * g, 0., 1.);
  o = mix(res, uMixTo, clamp(uMixAmt * g, 0., 1.));
}`,

  curl: `
in vec2 vUv; in vec2 vL; in vec2 vR; in vec2 vT; in vec2 vB; out vec4 o;
uniform sampler2D uVelocity;
void main(){
  float L = texture(uVelocity, vL).y, R = texture(uVelocity, vR).y;
  float T = texture(uVelocity, vT).x, B = texture(uVelocity, vB).x;
  o = vec4(.5 * (R - L - T + B), 0., 0., 1.);
}`,

  vorticity: `
in vec2 vUv; in vec2 vL; in vec2 vR; in vec2 vT; in vec2 vB; out vec4 o;
uniform sampler2D uVelocity; uniform sampler2D uCurl; uniform float uCurlK; uniform float uDt;
void main(){
  float L = texture(uCurl, vL).x, R = texture(uCurl, vR).x;
  float T = texture(uCurl, vT).x, B = texture(uCurl, vB).x;
  float C = texture(uCurl, vUv).x;
  vec2 f = .5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  f /= length(f) + .0001;
  f *= uCurlK * C; f.y *= -1.;
  vec2 v = texture(uVelocity, vUv).xy + f * uDt;
  o = vec4(clamp(v, -1200., 1200.), 0., 1.);
}`,

  // Divergence, minus the sources: where liquid is poured in, the water is
  // allowed to spread (∇·v = s), so a drop opens into a bloom.
  divergence: `
in vec2 vUv; in vec2 vL; in vec2 vR; in vec2 vT; in vec2 vB; out vec4 o;
uniform sampler2D uVelocity; uniform vec4 uSrc[12]; uniform float uAspect;
void main(){
  float L = texture(uVelocity, vL).x, R = texture(uVelocity, vR).x;
  float T = texture(uVelocity, vT).y, B = texture(uVelocity, vB).y;
  vec2 C = texture(uVelocity, vUv).xy;
  if (vL.x < 0.) L = -C.x;
  if (vR.x > 1.) R = -C.x;
  if (vT.y > 1.) T = -C.y;
  if (vB.y < 0.) B = -C.y;
  float s = 0.;
  for (int i = 0; i < 12; i++) {
    vec4 S = uSrc[i];
    vec2 p = vUv - S.xy; p.x *= uAspect;
    s += S.w * exp(-dot(p, p) / (S.z * S.z));
  }
  o = vec4(.5 * (R - L + T - B) - s, 0., 0., 1.);
}`,

  pressure: `
in vec2 vUv; in vec2 vL; in vec2 vR; in vec2 vT; in vec2 vB; out vec4 o;
uniform sampler2D uPressure; uniform sampler2D uDivergence;
void main(){
  float L = texture(uPressure, vL).x, R = texture(uPressure, vR).x;
  float T = texture(uPressure, vT).x, B = texture(uPressure, vB).x;
  float div = texture(uDivergence, vUv).x;
  o = vec4((L + R + B + T - div) * .25, 0., 0., 1.);
}`,

  gradient: `
in vec2 vUv; in vec2 vL; in vec2 vR; in vec2 vT; in vec2 vB; out vec4 o;
uniform sampler2D uPressure; uniform sampler2D uVelocity;
void main(){
  float L = texture(uPressure, vL).x, R = texture(uPressure, vR).x;
  float T = texture(uPressure, vT).x, B = texture(uPressure, vB).x;
  vec2 v = texture(uVelocity, vUv).xy - vec2(R - L, T - B);
  o = vec4(v, 0., 1.);
}`,

  // Velocity advection, with dissipation and the drift scrolling gives the
  // water (sheared, so it never slides as one slab). uShift carries the water
  // with the page (on paper); what scrolls in from beyond the glass is still.
  advectVelocity: `
in vec2 vUv; out vec4 o;
uniform sampler2D uVelocity; uniform vec2 uVelTexel;
uniform float uDt; uniform float uDiss; uniform float uDrift; uniform float uTime; uniform float uShift;
void main(){
  vec2 coord = vUv - uDt * SAMPLE(uVelocity, vUv, uVelTexel).xy * uVelTexel - vec2(0., uShift);
  float sy = vUv.y - uShift;
  float inside = smoothstep(-uVelTexel.y, 0., sy) * smoothstep(1. + uVelTexel.y, 1., sy);
  vec2 v = SAMPLE(uVelocity, coord, uVelTexel).xy * inside / (1. + uDiss * uDt);
  float shear = .62 + .38 * sin(vUv.x * 5.2 + uTime * .23) * cos(vUv.y * 2.3 - uTime * .17);
  v.y += uDrift * shear * uDt;
  o = vec4(v, 0., 1.);
}`,

  // Dye advection, then relaxation towards the field. During a pour a ragged
  // front (uFlood) sweeps out from the pour: behind it the dish relaxes fast.
  // Under the type of the current field (uMask) it relaxes faster still, so
  // text always sits on its own field. While a pour clears (uLift) the dish
  // takes whichever is quicker, thinning the dye (density) or the light
  // passing through it (transmittance): a dark field lifts off cleanly
  // instead of draining through grey.
  advectDye: `
in vec2 vUv; out vec4 o;
uniform sampler2D uVelocity; uniform sampler2D uSource; uniform sampler2D uMask;
uniform vec2 uVelTexel; uniform vec2 uSrcTexel;
uniform float uDt; uniform float uRelaxDt; uniform float uShift; uniform float uLift;
uniform vec4 uTarget; uniform float uRateIn; uniform float uRateOut;
uniform float uMaskRate; uniform float uMaskPour;
uniform vec4 uFlood; uniform float uFloodOn; uniform float uBandRate; uniform float uAspect; uniform float uTime;
${NOISE}
void main(){
  vec2 coord = vUv - uDt * SAMPLE(uVelocity, vUv, uVelTexel).xy * uVelTexel - vec2(0., uShift);
  vec4 c = SAMPLE(uSource, coord, uSrcTexel);
  // water scrolled in from beyond the glass is clean field
  float sy = vUv.y - uShift;
  c = mix(uTarget, c, smoothstep(-2. * uSrcTexel.y, 0., sy) * smoothstep(1. + 2. * uSrcTexel.y, 1., sy));
  float type = texture(uMask, vUv).r;
  float rate = uRateIn + uMaskRate * type;
  if (uFloodOn > .5) {
    // a wet edge: ragged like a wash running into damp paper. Just inside it
    // the colour arrives at once; behind it the rest soaks in.
    vec2 q = vUv * vec2(uAspect, 1.);
    float n = fbm(q * 2.4 + vec2(uTime * .04, -uTime * .03));
    float d = length(q - uFlood.xy) + (n - .5) * uFlood.w;
    float e = uFlood.z - d;
    float front = smoothstep(0., .035, e);
    // tide lines: the wash takes more readily on some rings than others
    float ring = .5 + .5 * sin(d * 44.);
    float band = front * exp(-e * 16.) * (.3 + .7 * ring * ring);
    rate = mix(uRateOut, uRateIn + uMaskPour * type, front) + uBandRate * band;
  }
  float k = 1. - exp(-rate * uRelaxDt);
  vec4 r = mix(c, uTarget, k);
  if (uLift > 0.) {
    vec3 viaT = -log(max(mix(exp(-c.rgb), exp(-uTarget.rgb), k), vec3(1e-5)));
    vec3 fast = mix(r.rgb, viaT, step(abs(viaT - uTarget.rgb), abs(r.rgb - uTarget.rgb)));
    vec3 rgb = mix(r.rgb, fast, uLift);
    // granulation follows the colour down at the same pace
    float den = dot(abs(c.rgb - uTarget.rgb), vec3(1.));
    float ke = den > 1e-4 ? 1. - dot(abs(rgb - uTarget.rgb), vec3(1.)) / den : k;
    r = vec4(rgb, mix(c.a, uTarget.a, clamp(max(ke, k), 0., 1.)));
  }
  o = max(r, vec4(0.));
}`,

  // Paper × exp(−density), with granulation, the paper's tooth, wet relief
  // from the density gradient, and moving water reading a little deeper.
  display: `
in vec2 vUv; in vec2 vL; in vec2 vR; in vec2 vT; in vec2 vB; out vec4 o;
uniform sampler2D uDye; uniform sampler2D uVelocity;
uniform vec2 uDyeTexel; uniform vec2 uVelTexel;
uniform vec3 uPaper; uniform float uDpr; uniform float uTexelPx; uniform float uVelPx;
uniform float uRelief; uniform float uRim; uniform float uGrain; uniform float uGran; uniform float uWet;
${NOISE}
vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - .055, step(vec3(.0031308), c)); }
const vec3 W = vec3(.3, .5, .2);
void main(){
  vec4 d = SAMPLE(uDye, vUv, uDyeTexel);
  float dl = dot(SAMPLE(uDye, vL, uDyeTexel).rgb, W), dr = dot(SAMPLE(uDye, vR, uDyeTexel).rgb, W);
  float dt = dot(SAMPLE(uDye, vT, uDyeTexel).rgb, W), db = dot(SAMPLE(uDye, vB, uDyeTexel).rgb, W);
  vec2 g = vec2(dr - dl, dt - db) / (2. * uTexelPx);

  // paper: a cold-pressed tooth, fixed to the glass
  vec2 px = gl_FragCoord.xy / uDpr;
  float h = vnoise(px / 7.5) * .5 + vnoise(px / 3.1 + 19.7) * .32 + vnoise(px / 1.45 + 7.3) * .18;
  float valley = 1. - h;

  // granulation: pigment settles into the valleys of the tooth, as a fine
  // mottle and a scatter of coarse particles
  float mottle = vnoise(px / 2.1 + 3.1);
  float speck = smoothstep(.86, 1., hash12(floor(px / 1.6) + .5));
  float lum = max(dot(d.rgb, vec3(1. / 3.)), 1e-3);
  // it shows most in thin washes; a deep, even field stays calm under type
  float gran = clamp(d.a / lum, 0., 1.2) * uGran / (1. + .45 * lum);
  float gm = 1. + gran * ((valley - .5) * .42 + (mottle - .5) * .22 + (speck - .07) * (.25 + .5 * valley));
  vec3 dens = d.rgb * gm;

  // wet: where the water moves, the colour reads deeper
  vec2 v = SAMPLE(uVelocity, vUv, uVelTexel).xy * uVelPx;
  float wet = 1. - exp(-length(v) * .004);
  dens *= 1. + wet * uWet;

  // the rim a wash leaves where it thins
  float slope = length(g);
  dens *= 1. + min(slope * uRim, .28);

  vec3 col = uPaper * exp(-dens);

  // wet relief: light from the upper left catches the swell of the colour
  vec3 nrm = normalize(vec3(-g * uRelief, 1.));
  const vec3 LI = vec3(-.42, .6, .68);
  float lit = dot(nrm, normalize(LI)) / normalize(LI).z;
  col *= mix(1., lit, .35);
  col *= 1. + (h - .5) * uGrain;
  o = vec4(toSRGB(clamp(col, 0., 1.)), 1.);
}`,
}

const UNIFORMS = {
  fill: ['uValue'],
  scale: ['uTex', 'uMul'],
  copy: ['uTex', 'uSrcTexel'],
  splat: ['uTarget', 'uAspect', 'uPoint', 'uRadius', 'uDir', 'uStretch', 'uRough', 'uSeed', 'uAdd', 'uMixTo', 'uMixAmt', 'uRadial', 'uSwirl', 'uDevA', 'uDevTo', 'uDevAmt'],
  curl: ['uTexel', 'uVelocity'],
  vorticity: ['uTexel', 'uVelocity', 'uCurl', 'uCurlK', 'uDt'],
  divergence: ['uTexel', 'uVelocity', 'uSrc', 'uAspect'],
  pressure: ['uTexel', 'uPressure', 'uDivergence'],
  gradient: ['uTexel', 'uPressure', 'uVelocity'],
  advectVelocity: ['uVelocity', 'uVelTexel', 'uDt', 'uDiss', 'uDrift', 'uTime', 'uShift'],
  advectDye: ['uVelocity', 'uSource', 'uMask', 'uVelTexel', 'uSrcTexel', 'uDt', 'uRelaxDt', 'uShift', 'uLift', 'uTarget', 'uRateIn', 'uRateOut', 'uMaskRate', 'uMaskPour', 'uFlood', 'uFloodOn', 'uBandRate', 'uAspect', 'uTime'],
  display: ['uTexel', 'uDye', 'uVelocity', 'uDyeTexel', 'uVelTexel', 'uPaper', 'uDpr', 'uTexelPx', 'uVelPx', 'uRelief', 'uRim', 'uGrain', 'uGran', 'uWet'],
}

/* ===================================================================== tuning */

const SIM = {
  curl: 9, // vorticity confinement
  velDiss: 0.7, // velocity dissipation per second
  pressureIters: 20,
  pressureKeep: 0.8,
  relaxPaper: 0.14, // per second: drops linger as blooms on paper
  relaxField: 0.5, // per second on a pigment field
  relaxFlood: 2.3, // behind a pour's front
  relaxFloodPaper: 3.4, // behind clear water poured in to lift a field off
  relaxBand: 14, // right at the wet edge
  typePaper: 0.45, // extra per second under the type, on paper
  typeField: 0.7, // extra per second under the type, on a colour field
  typePour: 2.2, // extra per second under the type, behind a pour's front
  follow: 0.93, // on paper, how much of the scroll the water travels with
  driftField: 0.3, // on a field, how much the scroll drags the water
  driftPaper: 0.06, // on paper (on top of following the page), a liquid lag
  relief: 7,
  rim: 5,
  grain: 0.045,
  granulation: 1,
  wet: 0.22,
}

/* ===================================================================== module */

export function init(ctx) {
  const root = document.documentElement
  const canvas = document.getElementById('dish')
  const disable = () => {
    root.classList.add('no-dish')
    root.classList.remove('dish-on')
  }
  if (!canvas || ctx.reducedMotion) return disable()
  let ok = false
  try {
    ok = createDish(ctx, canvas, disable)
  } catch (err) {
    console.error('[dish] could not start', err)
  }
  if (!ok) disable()
}

function createDish(ctx, canvas, disable) {
  const root = document.documentElement
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  })
  if (!gl) return false

  /* --------------------------------------------------------------- formats */
  const caps = detectFormats(gl)
  if (!caps) return false

  /* ---------------------------------------------------------------- optics */
  const { PIGMENTS, PAPER } = ctx.pigments
  const paperLin = hexLin(PAPER.hex)
  const densityOf = (hex, gran) => {
    const l = hexLin(hex)
    const d = new Float32Array(4)
    for (let i = 0; i < 3; i++) d[i] = Math.max(0, -Math.log(Math.max(l[i], 1e-4) / paperLin[i]))
    d[3] = gran * ((d[0] + d[1] + d[2]) / 3)
    return d
  }
  const OPTICS = {}
  for (const p of [PAPER, ...PIGMENTS]) {
    const gran = GRANULATION[p.id] ?? 0.3
    OPTICS[p.id] = {
      id: p.id,
      mass: densityOf(p.hex, gran),
      tint: densityOf(p.tint, gran * 0.8),
      gesture: GESTURES[p.id] || { kind: 'wave', x: 0.5 },
      paper: p.id === 'paper',
    }
  }
  OPTICS.water = OPTICS.paper
  const optics = (id) => OPTICS[id] || null
  const maxDensity = (d) => Math.max(d[0], d[1], d[2])
  // a colour, not a grey: only these leave a ghost of themselves on paper
  const chromatic = (d) => {
    const hi = maxDensity(d)
    return hi > 0.05 && (hi - Math.min(d[0], d[1], d[2])) / hi > 0.22
  }

  // Colours that develop in the water: density c ≈ a·from + b·mass, solved
  // by least squares, so a = dot(c, A); developing moves a into b.
  const dot3 = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2]
  for (const id in DEVELOP) {
    const o = OPTICS[id]
    if (!o) continue
    const spec = DEVELOP[id]
    const L = densityOf(spec.from, (GRANULATION[id] ?? 0.3) * 0.6)
    const I = o.mass
    const LL = dot3(L, L)
    const II = dot3(I, I)
    const LI = dot3(L, I)
    const det = LL * II - LI * LI
    if (det < 1e-6) continue
    const A = new Float32Array(4)
    const to = new Float32Array(4)
    for (let i = 0; i < 3; i++) A[i] = (II * L[i] - LI * I[i]) / det
    for (let i = 0; i < 4; i++) to[i] = I[i] - L[i]
    o.develop = { from: L, a: A, to, delay: spec.delay, dur: spec.dur }
  }

  /* ------------------------------------------------------------ live state */
  const phone = () => ctx.isMobile() || (ctx.isTouch && Math.min(screen.width, screen.height) < 768)
  const target = new Float32Array(4) // density the dish relaxes to
  const whisper = new Float32Array(4) // what stirring leaves behind
  let memory = OPTICS.ultramarine // the last colour poured: the water remembers it
  let whisperGain = 0.6
  let field = null
  let fieldProgress = 0
  let rateIn = SIM.relaxPaper
  let rateOut = SIM.relaxPaper
  let baseRate = SIM.relaxPaper
  const flood = {
    on: false, t0: 0, delay: 0, dur: 1.8, hold: 0.5, ramp: 2.4, rate: SIM.relaxFlood,
    ox: 0, oy: 0, r0: 0, r1: 1, soft: 0.3, r: 0, tail: false,
  }
  let typeBoost = SIM.typePaper // extra relaxation under the type, now
  let drift = 0
  let follow = 0 // 0..1: how much the water travels with the page now
  let lastScroll = null // page scroll at the last step, css px
  let simTime = 0
  let lastInput = 0
  let energy = 0 // rough peak velocity in the water (texels/s)
  let residual = 0 // rough density still to relax
  let quality = 0 // 0 full, 1 lighter, 2 lightest
  let glReady = false
  let alive = true
  let firstFrame = true

  const pending = [] // drops that arrive before the GPU is ready
  const pendingStirs = []

  // pooled splat operations, scheduled in simulation time
  const POOL = 200
  const ops = []
  for (let i = 0; i < POOL; i++) {
    ops.push({
      on: false, t: 0, x: 0, y: 0, dirx: 1, diry: 0, stretch: 1, rough: 0.4, seed: 0,
      vr: 0, vx: 0, vy: 0, radial: 0, swirl: 0,
      dr: 0, add: new Float32Array(4), mixTo: new Float32Array(4), amt: 0, hasDye: false,
      srcR: 0, srcS: 0, srcTau: 0.6, dev: null, devAmt: 0,
    })
  }
  let opCount = 0
  function takeOp(delay) {
    for (let i = 0; i < POOL; i++) {
      const o = ops[i]
      if (o.on) continue
      o.on = true
      o.t = simTime + delay
      o.x = o.y = 0
      o.dirx = 1
      o.diry = 0
      o.stretch = 1
      o.rough = 0.4
      o.seed = Math.random() * 97
      o.vr = o.vx = o.vy = o.radial = o.swirl = 0
      o.dr = 0
      o.add.fill(0)
      o.mixTo.fill(0)
      o.amt = 0
      o.hasDye = false
      o.srcR = o.srcS = 0
      o.srcTau = 0.6
      o.dev = null
      o.devAmt = 0
      opCount++
      return o
    }
    return null
  }

  // sources: where liquid is being poured in (fed to the divergence pass)
  const SRC = 12
  const sources = []
  for (let i = 0; i < SRC; i++) sources.push({ on: false, x: 0, y: 0, r: 1, s0: 0, tau: 1, t0: 0 })
  const srcUniform = new Float32Array(SRC * 4)
  let srcLive = 0
  function addSource(x, y, r, s0, tau) {
    let slot = null
    let weakest = Infinity
    for (let i = 0; i < SRC; i++) {
      const q = sources[i]
      if (!q.on) {
        slot = q
        break
      }
      const left = q.s0 * Math.exp(-(simTime - q.t0) / q.tau)
      if (left < weakest) {
        weakest = left
        slot = q
      }
    }
    slot.on = true
    slot.x = x
    slot.y = y
    slot.r = Math.max(r, 0.005)
    slot.s0 = s0
    slot.tau = tau
    slot.t0 = simTime
  }
  function packSources() {
    srcLive = 0
    for (let i = 0; i < SRC; i++) {
      const q = sources[i]
      const j = i * 4
      let w = 0
      if (q.on) {
        const t = simTime - q.t0
        // a quick swell, then an easing off
        w = q.s0 * Math.min(1, t / 0.08) * Math.exp(-t / q.tau)
        if (t > q.tau * 5) q.on = false
        else srcLive++
      }
      srcUniform[j] = q.x
      srcUniform[j + 1] = q.y
      srcUniform[j + 2] = q.r
      srcUniform[j + 3] = w
    }
  }

  /* --------------------------------------------------------------- geometry */
  let cssW = 1
  let cssH = 1
  let aspect = 1
  let dpr = 1
  let simW = 0
  let simH = 0
  let dyeW = 0
  let dyeH = 0
  const shortH = () => Math.min(cssW, cssH) / cssH // shorter side, in canvas-height units
  // viewport (0..1, y down) → dish uv (y up)
  const vy2uv = (y) => 1 - (y * window.innerHeight) / cssH
  const pxToTex = () => simH / cssH

  /* ------------------------------------------------------------- GL objects */
  let vs = null
  const P = {}
  let vao = null
  let buf = null
  let vel, dye, pressure, divergence, curl
  // where the type of the current field sits on screen (R8, linear: soft)
  const mask = { tex: null, w: 0, h: 0, data: null, tmp: null, y: NaN, field: null, version: -1 }

  function measure() {
    const r = canvas.getBoundingClientRect()
    cssW = Math.max(1, r.width || window.innerWidth)
    cssH = Math.max(1, r.height || window.innerHeight)
    aspect = cssW / cssH
    const capDpr = [1.5, 1, 0.75][quality]
    dpr = Math.min(ctx.dpr || 1, capDpr)
  }

  function resolution(res) {
    const a = cssW / cssH
    const big = Math.round(res * (a < 1 ? 1 / a : a))
    const small = Math.round(res)
    return a >= 1 ? [big, small] : [small, big]
  }

  function allocate() {
    measure()
    const w = Math.max(1, Math.round(cssW * dpr))
    const h = Math.max(1, Math.round(cssH * dpr))
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    const small = phone()
    const simRes = small || quality >= 2 ? 96 : 128
    const dyeBase = small ? 512 : [1024, 768, 512][quality]
    const dyeRes = Math.min(dyeBase, Math.round(Math.min(w, h)))
    const [sw, sh] = resolution(simRes)
    const [dw, dh] = resolution(dyeRes)
    const lin = caps.linear ? gl.LINEAR : gl.NEAREST
    if (!vel) {
      vel = double(sw, sh, caps.rg, lin)
      dye = double(dw, dh, caps.rgba, lin)
      pressure = double(sw, sh, caps.r, gl.NEAREST)
      divergence = fbo(sw, sh, caps.r, gl.NEAREST)
      curl = fbo(sw, sh, caps.r, gl.NEAREST)
    } else {
      // keep the water when the window changes: resample into the new size
      if (vel.w !== sw || vel.h !== sh) {
        resizeDouble(vel, sw, sh, caps.rg, lin)
        resizeDouble(pressure, sw, sh, caps.r, gl.NEAREST)
        dispose(divergence)
        dispose(curl)
        divergence = fbo(sw, sh, caps.r, gl.NEAREST)
        curl = fbo(sw, sh, caps.r, gl.NEAREST)
      }
      if (dye.w !== dw || dye.h !== dh) resizeDouble(dye, dw, dh, caps.rgba, lin)
    }
    simW = sw
    simH = sh
    dyeW = dw
    dyeH = dh
    allocateMask(small ? 96 : 128)
  }

  function allocateMask(res) {
    const a = cssW / cssH
    const mw = a >= 1 ? res : Math.max(24, Math.round(res * a))
    const mh = a >= 1 ? Math.max(24, Math.round(res / a)) : res
    if (mask.tex && mask.w === mw && mask.h === mh) return
    if (mask.tex) gl.deleteTexture(mask.tex)
    mask.w = mw
    mask.h = mh
    mask.data = new Uint8ClampedArray(mw * mh)
    mask.tmp = new Float32Array(mw * mh)
    mask.y = NaN
    gl.activeTexture(gl.TEXTURE0)
    mask.tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, mask.tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, mw, mh, 0, gl.RED, gl.UNSIGNED_BYTE, mask.data)
  }

  function fbo(w, h, fmt, filter) {
    gl.activeTexture(gl.TEXTURE0)
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internal, w, h, 0, fmt.format, caps.type, null)
    const fb = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    gl.viewport(0, 0, w, h)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    return { tex, fb, w, h, tx: 1 / w, ty: 1 / h }
  }
  function dispose(f) {
    gl.deleteTexture(f.tex)
    gl.deleteFramebuffer(f.fb)
  }
  function double(w, h, fmt, filter) {
    return {
      read: fbo(w, h, fmt, filter),
      write: fbo(w, h, fmt, filter),
      w,
      h,
      tx: 1 / w,
      ty: 1 / h,
      swap() {
        const t = this.read
        this.read = this.write
        this.write = t
      },
    }
  }
  function resizeDouble(d, w, h, fmt, filter) {
    const next = fbo(w, h, fmt, filter)
    use(P.copy)
    gl.uniform1i(P.copy.u.uTex, bind(0, d.read))
    gl.uniform2f(P.copy.u.uSrcTexel, d.tx, d.ty)
    blit(next)
    dispose(d.read)
    dispose(d.write)
    d.read = next
    d.write = fbo(w, h, fmt, filter)
    d.w = w
    d.h = h
    d.tx = 1 / w
    d.ty = 1 / h
  }
  function bind(unit, f) {
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, f.tex)
    return unit
  }
  function use(p) {
    gl.useProgram(p.p)
  }
  function blit(target) {
    if (target) {
      gl.viewport(0, 0, target.w, target.h)
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb)
    } else {
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  /* --------------------------------------------------------------- programs */
  function compileAll() {
    const ext = gl.getExtension('KHR_parallel_shader_compile')
    vs = gl.createShader(gl.VERTEX_SHADER)
    gl.shaderSource(vs, VERT)
    gl.compileShader(vs)
    const filter = FILTER(!caps.linear)
    for (const name of Object.keys(FS)) {
      const fs = gl.createShader(gl.FRAGMENT_SHADER)
      gl.shaderSource(fs, HEAD + filter + FS[name])
      gl.compileShader(fs)
      const p = gl.createProgram()
      gl.attachShader(p, vs)
      gl.attachShader(p, fs)
      gl.linkProgram(p)
      P[name] = { p, fs, u: {} }
    }
    return ext
  }
  function programsDone(ext) {
    if (!ext) return true
    for (const k in P) if (!gl.getProgramParameter(P[k].p, ext.COMPLETION_STATUS_KHR)) return false
    return true
  }
  function finishPrograms() {
    for (const k in P) {
      const prog = P[k]
      if (!gl.getProgramParameter(prog.p, gl.LINK_STATUS)) {
        throw new Error(
          `[dish] ${k}: ${gl.getProgramInfoLog(prog.p)} ${gl.getShaderInfoLog(prog.fs)} ${gl.getShaderInfoLog(vs)}`,
        )
      }
      for (const u of UNIFORMS[k]) prog.u[u] = gl.getUniformLocation(prog.p, u)
    }
    vao = gl.createVertexArray()
    gl.bindVertexArray(vao)
    buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  }

  /* ----------------------------------------------------------------- splats */
  const SCISSOR = 2.75
  function splatPass(d, o, isDye) {
    const R = isDye ? o.dr : o.vr
    use(P.splat)
    const u = P.splat.u
    gl.uniform1i(u.uTarget, bind(0, d.read))
    gl.uniform1f(u.uAspect, aspect)
    gl.uniform2f(u.uPoint, o.x, o.y)
    gl.uniform1f(u.uRadius, R)
    gl.uniform2f(u.uDir, o.dirx, o.diry)
    gl.uniform1f(u.uStretch, o.stretch)
    gl.uniform1f(u.uRough, o.rough)
    gl.uniform1f(u.uSeed, o.seed)
    if (isDye) {
      gl.uniform4f(u.uAdd, o.add[0], o.add[1], o.add[2], o.add[3])
      gl.uniform4f(u.uMixTo, o.mixTo[0], o.mixTo[1], o.mixTo[2], o.mixTo[3])
      gl.uniform1f(u.uMixAmt, o.amt)
      gl.uniform1f(u.uRadial, 0)
      gl.uniform1f(u.uSwirl, 0)
      if (o.dev) {
        gl.uniform4f(u.uDevA, o.dev.a[0], o.dev.a[1], o.dev.a[2], 0)
        gl.uniform4f(u.uDevTo, o.dev.to[0], o.dev.to[1], o.dev.to[2], o.dev.to[3])
      }
      gl.uniform1f(u.uDevAmt, o.dev ? o.devAmt : 0)
    } else {
      gl.uniform4f(u.uAdd, o.vx, o.vy, 0, 0)
      gl.uniform4f(u.uMixTo, 0, 0, 0, 0)
      gl.uniform1f(u.uMixAmt, 0)
      gl.uniform1f(u.uRadial, o.radial)
      gl.uniform1f(u.uSwirl, o.swirl)
      gl.uniform1f(u.uDevAmt, 0)
    }
    // only touch the pixels the splat can reach, then copy them back
    const half = (SCISSOR * R * Math.max(1, o.stretch)) / (1 - 0.6 * Math.min(o.rough, 1))
    const x0 = Math.max(0, Math.floor((o.x - half / aspect) * d.w))
    const x1 = Math.min(d.w, Math.ceil((o.x + half / aspect) * d.w))
    const y0 = Math.max(0, Math.floor((o.y - half) * d.h))
    const y1 = Math.min(d.h, Math.ceil((o.y + half) * d.h))
    if (x1 <= x0 || y1 <= y0) return
    gl.enable(gl.SCISSOR_TEST)
    gl.scissor(x0, y0, x1 - x0, y1 - y0)
    blit(d.write)
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, d.write.fb)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, d.read.fb)
    gl.blitFramebuffer(x0, y0, x1, y1, x0, y0, x1, y1, gl.COLOR_BUFFER_BIT, gl.NEAREST)
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)
    gl.disable(gl.SCISSOR_TEST)
  }
  function fire(o) {
    if (o.srcS > 0) {
      addSource(o.x, o.y, o.srcR, o.srcS, o.srcTau)
      const m = o.srcS * o.srcR * simH
      if (m > energy) energy = m
    }
    if (o.vr > 0) {
      splatPass(vel, o, false)
      const m = Math.hypot(o.vx, o.vy) + Math.abs(o.radial) + Math.abs(o.swirl)
      if (m > energy) energy = m
    }
    if (o.hasDye && o.dr > 0) splatPass(dye, o, true)
  }
  function runOps() {
    if (!opCount) return
    let fired = 0
    for (let i = 0; i < POOL && fired < 40; i++) {
      const o = ops[i]
      if (!o.on || o.t > simTime) continue
      fire(o)
      o.on = false
      opCount--
      fired++
    }
  }

  /* ------------------------------------------------------------- simulation */
  function step(dt, relaxDt, moving, shift) {
    gl.disable(gl.BLEND)
    if (moving) {
      const tx = vel.tx
      const ty = vel.ty
      use(P.curl)
      gl.uniform2f(P.curl.u.uTexel, tx, ty)
      gl.uniform1i(P.curl.u.uVelocity, bind(0, vel.read))
      blit(curl)

      use(P.vorticity)
      gl.uniform2f(P.vorticity.u.uTexel, tx, ty)
      gl.uniform1i(P.vorticity.u.uVelocity, bind(0, vel.read))
      gl.uniform1i(P.vorticity.u.uCurl, bind(1, curl))
      gl.uniform1f(P.vorticity.u.uCurlK, SIM.curl)
      gl.uniform1f(P.vorticity.u.uDt, dt)
      blit(vel.write)
      vel.swap()

      use(P.divergence)
      gl.uniform2f(P.divergence.u.uTexel, tx, ty)
      gl.uniform1i(P.divergence.u.uVelocity, bind(0, vel.read))
      gl.uniform4fv(P.divergence.u.uSrc, srcUniform)
      gl.uniform1f(P.divergence.u.uAspect, aspect)
      blit(divergence)

      use(P.scale)
      gl.uniform1i(P.scale.u.uTex, bind(0, pressure.read))
      gl.uniform1f(P.scale.u.uMul, SIM.pressureKeep)
      blit(pressure.write)
      pressure.swap()

      use(P.pressure)
      gl.uniform2f(P.pressure.u.uTexel, tx, ty)
      gl.uniform1i(P.pressure.u.uDivergence, bind(0, divergence))
      for (let i = 0; i < SIM.pressureIters; i++) {
        gl.uniform1i(P.pressure.u.uPressure, bind(1, pressure.read))
        blit(pressure.write)
        pressure.swap()
      }

      use(P.gradient)
      gl.uniform2f(P.gradient.u.uTexel, tx, ty)
      gl.uniform1i(P.gradient.u.uPressure, bind(0, pressure.read))
      gl.uniform1i(P.gradient.u.uVelocity, bind(1, vel.read))
      blit(vel.write)
      vel.swap()

      use(P.advectVelocity)
      const a = P.advectVelocity.u
      gl.uniform1i(a.uVelocity, bind(0, vel.read))
      gl.uniform2f(a.uVelTexel, tx, ty)
      gl.uniform1f(a.uDt, dt)
      gl.uniform1f(a.uDiss, SIM.velDiss)
      gl.uniform1f(a.uDrift, drift)
      gl.uniform1f(a.uTime, simTime)
      gl.uniform1f(a.uShift, shift)
      blit(vel.write)
      vel.swap()
    }

    const pouring = flood.on || flood.tail
    use(P.advectDye)
    const u = P.advectDye.u
    gl.uniform1i(u.uVelocity, bind(0, vel.read))
    gl.uniform1i(u.uSource, bind(1, dye.read))
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, mask.tex)
    gl.uniform1i(u.uMask, 2)
    gl.uniform2f(u.uVelTexel, vel.tx, vel.ty)
    gl.uniform2f(u.uSrcTexel, dye.tx, dye.ty)
    gl.uniform1f(u.uDt, moving ? dt : 0)
    gl.uniform1f(u.uRelaxDt, relaxDt)
    gl.uniform1f(u.uShift, shift)
    gl.uniform1f(u.uLift, pouring ? 1 : 0)
    gl.uniform4f(u.uTarget, target[0], target[1], target[2], target[3])
    gl.uniform1f(u.uRateIn, rateIn)
    gl.uniform1f(u.uRateOut, rateOut)
    gl.uniform1f(u.uMaskRate, typeBoost)
    gl.uniform1f(u.uMaskPour, SIM.typePour)
    gl.uniform4f(u.uFlood, flood.ox, flood.oy, flood.r, flood.soft)
    gl.uniform1f(u.uFloodOn, flood.on ? 1 : 0)
    gl.uniform1f(u.uBandRate, SIM.relaxBand)
    gl.uniform1f(u.uAspect, aspect)
    gl.uniform1f(u.uTime, simTime)
    blit(dye.write)
    dye.swap()
  }

  function render() {
    use(P.display)
    const u = P.display.u
    gl.uniform2f(u.uTexel, dye.tx, dye.ty)
    gl.uniform1i(u.uDye, bind(0, dye.read))
    gl.uniform1i(u.uVelocity, bind(1, vel.read))
    gl.uniform2f(u.uDyeTexel, dye.tx, dye.ty)
    gl.uniform2f(u.uVelTexel, vel.tx, vel.ty)
    gl.uniform3f(u.uPaper, paperLin[0], paperLin[1], paperLin[2])
    gl.uniform1f(u.uDpr, canvas.width / cssW)
    gl.uniform1f(u.uTexelPx, cssH / dyeH)
    gl.uniform1f(u.uVelPx, cssH / simH)
    gl.uniform1f(u.uRelief, SIM.relief)
    gl.uniform1f(u.uRim, SIM.rim)
    gl.uniform1f(u.uGrain, SIM.grain)
    gl.uniform1f(u.uGran, SIM.granulation)
    gl.uniform1f(u.uWet, SIM.wet)
    blit(null)
  }

  function fillDye(d) {
    use(P.fill)
    gl.uniform4f(P.fill.u.uValue, d[0], d[1], d[2], d[3])
    blit(dye.read)
    blit(dye.write)
  }

  /* ------------------------------------------------------------------ pours */
  const ghost = new Float32Array(4) // the faint trace of a colour left on paper

  function setTarget(o) {
    target.set(o.mass)
    baseRate = o.paper ? SIM.relaxPaper : SIM.relaxField
    typeBoost = o.paper ? SIM.typePaper : SIM.typeField
    // the water remembers the last colour (a grey would only read as dirt)
    if (!o.paper && chromatic(o.tint)) memory = o
    const w = o.paper ? memory.tint : o.tint
    whisper.set(w)
    whisperGain = o.paper ? 0.28 : 1
    if (o.paper) for (let i = 0; i < 4; i++) whisper[i] *= 0.55
  }

  function pour(id, dir, leftId) {
    const o = optics(id)
    if (!o) return
    const left = optics(leftId) || memory
    const before = maxDensity(target)
    setTarget(o)
    residual = Math.max(residual, Math.abs(maxDensity(target) - before) + 0.6)
    if (!glReady) return

    const g = o.gesture
    const s = shortH()
    const fromBottom = dir >= 0
    const edge = fromBottom ? 0 : 1
    const inward = fromBottom ? 1 : -1
    const H = simH // texels per canvas height
    const rich = o.mass
    const portrait = aspect < 0.8

    // ---- where the colour comes from, and the ragged front it floods behind
    let ox, oy, soft
    let delay = 0
    let minDur = 1.3
    if (g.kind === 'bloom') {
      ox = 0.5
      oy = 0.52
      soft = 0.42
    } else if (g.kind === 'stream') {
      ox = g.x + rand(-0.04, 0.04)
      oy = edge - inward * 0.04
      soft = 0.42
    } else if (g.kind === 'scatter') {
      // the drops land first; the field runs together behind them
      ox = g.x
      oy = edge - inward * 0.35
      soft = 0.62
      delay = 0.5
      minDur = 1.9
    } else {
      ox = g.x + rand(-0.08, 0.08)
      oy = edge - inward * 0.5
      soft = 0.5
    }
    const fx = ox * aspect
    let far = 0
    for (let cx = 0; cx <= 1; cx++)
      for (let cy = 0; cy <= 1; cy++) far = Math.max(far, Math.hypot(cx * aspect - fx, cy - oy))
    const near = Math.hypot(clamp(fx, 0, aspect) - fx, clamp(oy, 0, 1) - oy)
    flood.on = true
    flood.tail = false
    flood.t0 = simTime
    flood.delay = delay
    flood.ox = fx
    flood.oy = oy
    flood.soft = soft
    flood.r0 = near - soft * 0.5
    flood.r1 = far + soft * 0.6 + 0.1
    flood.dur = clamp(0.45 + (flood.r1 - flood.r0) * 0.52, minDur, 2.1)
    flood.r = flood.r0
    // clear water lifts a field off faster than a colour soaks in, and holds
    // a moment longer so nothing of the last field is left under the type
    flood.rate = o.paper ? SIM.relaxFloodPaper : SIM.relaxFlood
    flood.hold = o.paper ? 0.9 : 0.5
    rateIn = flood.rate
    rateOut = 0
    // a pour is screen-wide: the water stops travelling with the page
    follow = Math.min(follow, 0.25)
    lastScroll = window.scrollY

    // ---- the pour
    if (g.kind === 'wave') {
      // a broad flood from the edge: liquid wells up all along it
      const n = portrait ? 3 : 5
      for (let i = 0; i < n; i++) {
        const x = (i + 0.5) / n + rand(-0.06, 0.06)
        const t = rand(0, 0.16)
        // liquid welling up just beyond the edge…
        const w = takeOp(t)
        if (!w) break
        w.x = x
        w.y = edge - inward * 0.04
        w.srcR = 0.2 * s
        w.srcS = rand(2.6, 3.6)
        w.srcTau = 0.75
        // …carrying the colour in with it
        const a = takeOp(t)
        if (!a) break
        a.x = x
        a.y = edge + inward * 0.015
        a.hasDye = true
        a.dr = 0.2 * s
        a.mixTo.set(rich)
        a.amt = 1
        a.rough = 0.55
        // keep it coming for a moment
        for (let k = 1; k <= 3; k++) {
          const b = takeOp(t + k * 0.16)
          if (!b) break
          b.x = x + rand(-0.04, 0.04)
          b.y = edge + inward * 0.01
          b.hasDye = true
          b.dr = 0.16 * s
          b.mixTo.set(rich)
          b.amt = 1
          b.rough = 0.5
        }
      }
      // a few currents curl the front into eddies
      const m = portrait ? 2 : 3
      for (let i = 0; i < m; i++) {
        const c = takeOp(rand(0.15, 0.45))
        if (!c) break
        c.x = rand(0.15, 0.85)
        c.y = edge + inward * rand(0.05, 0.15)
        c.vr = 0.11 * s
        c.vx = rand(-0.5, 0.5) * H
        c.vy = inward * rand(0.6, 0.9) * H
        c.rough = 0.5
      }
    } else if (g.kind === 'smoke') {
      // soot: plumes well up from the edge and curl over as they rise
      const n = portrait ? 2 : 3
      for (let j = 0; j < n; j++) {
        const x = (j + 0.5) / n + rand(-0.07, 0.07)
        const t0 = j * 0.1 + rand(0, 0.12)
        const src = takeOp(t0)
        if (!src) break
        src.x = x
        src.y = edge - inward * 0.03
        src.srcR = 0.15 * s
        src.srcS = rand(2.6, 3.4)
        src.srcTau = 0.9
        const lean = rand(-0.3, 0.3)
        for (let i = 0; i < 10; i++) {
          const p = takeOp(t0 + i * 0.085)
          if (!p) break
          const a = lean + Math.sin(i * 0.9 + j * 2.1) * 0.4
          p.x = x + Math.sin(i * 0.7 + j) * 0.012
          p.y = edge + inward * 0.015
          p.vr = 0.08 * s
          p.vx = Math.sin(a) * 0.95 * H
          p.vy = inward * Math.cos(a) * 0.95 * H
          p.swirl = (i % 2 ? 1 : -1) * 0.22 * H
          p.rough = 0.6
          p.hasDye = true
          p.dr = 0.095 * s
          p.mixTo.set(rich)
          p.amt = 1
        }
      }
      // slow turns in the water above, so the plumes roll over
      for (let i = 0; i < (portrait ? 2 : 3); i++) {
        const c = takeOp(rand(0.3, 0.6))
        if (!c) break
        c.x = rand(0.15, 0.85)
        c.y = edge + inward * rand(0.3, 0.55)
        c.vr = 0.16 * s
        c.swirl = rand(-0.5, 0.5) * H
        c.rough = 0.4
      }
    } else if (g.kind === 'stream') {
      // a jet poured in from one point of the edge
      const lean = (0.5 - ox) * 0.8
      const src = takeOp(0)
      if (src) {
        src.x = ox
        src.y = edge - inward * 0.02
        src.srcR = 0.12 * s
        src.srcS = 5
        src.srcTau = 0.9
      }
      const n = 12
      for (let i = 0; i < n; i++) {
        const t = i * 0.06
        const a = Math.sin(i * 0.8 + rand(0, 0.5)) * 0.32 + lean
        const p = takeOp(t)
        if (!p) break
        p.x = ox + Math.sin(i * 0.6) * 0.01
        p.y = edge + inward * 0.012
        p.vr = 0.07 * s
        p.vx = Math.sin(a) * 1.25 * H
        p.vy = inward * Math.cos(a) * 1.25 * H
        p.rough = 0.45
        p.hasDye = true
        p.dr = 0.085 * s
        p.mixTo.set(rich)
        p.amt = 1
      }
    } else if (g.kind === 'scatter') {
      // drops rain in, nearest the edge first; each one blooms, then the
      // front runs them together into the field
      const cols = portrait ? 4 : 6
      const rows = portrait ? 6 : 4
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const x = (i + 0.5 + rand(-0.42, 0.42)) / cols
          const d = (j + 0.5 + rand(-0.42, 0.42)) / rows // from the pour edge
          const p = takeOp(0.04 + d * 0.7 + rand(0, 0.22))
          if (!p) break
          const r = rand(0.045, 0.085) * s
          p.x = x
          p.y = edge + inward * d
          p.srcR = r * 0.9
          p.srcS = rand(2.2, 3.4)
          p.srcTau = 0.5
          p.vr = r
          p.swirl = rand(-0.08, 0.08) * H
          p.rough = 0.7
          p.hasDye = true
          p.dr = r
          p.mixTo.set(rich)
          p.amt = 1
        }
      }
    } else {
      // bloom: the colour is dropped into the middle and opens out
      for (let k = 0; k < 4; k++) {
        const p = takeOp(k * 0.14)
        if (!p) break
        p.x = ox + rand(-0.01, 0.01)
        p.y = oy + rand(-0.01, 0.01)
        if (k === 0) {
          p.srcR = 0.17 * s
          p.srcS = 4.2
          p.srcTau = 1
        }
        p.hasDye = true
        p.dr = (0.13 - k * 0.015) * s
        p.mixTo.set(rich)
        p.amt = 1
        p.rough = 0.7
      }
      const fingers = 6
      const a0 = rand(0, Math.PI * 2)
      for (let i = 0; i < fingers; i++) {
        const a = a0 + (i / fingers) * Math.PI * 2 + rand(-0.3, 0.3)
        const c = Math.cos(a)
        const sn = Math.sin(a)
        const f = takeOp(rand(0.25, 0.55))
        if (!f) break
        const r = rand(0.18, 0.26) * s
        f.x = ox + (c * r) / aspect
        f.y = oy + sn * r
        f.vr = 0.06 * s
        f.vx = c * rand(0.6, 0.9) * H
        f.vy = sn * rand(0.6, 0.9) * H
        f.rough = 0.5
        f.hasDye = true
        f.dr = 0.055 * s
        f.mixTo.set(rich)
        f.amt = 0.9
      }
    }

    // ---- marbled streaks of the tint, laid in as the pour settles. Clear
    // water leaves only a faint ghost of a colour it lifted (never of a grey,
    // which would read as dirt), and the type clears first.
    let streakTint = o.tint
    let streakAmt = 0.5
    let streaks = portrait ? 3 : 4
    if (o.paper) {
      if (left.paper || !chromatic(left.tint)) streaks = 0
      else {
        const k = Math.min(1, 0.16 / Math.max(maxDensity(left.tint), 1e-3))
        for (let i = 0; i < 4; i++) ghost[i] = left.tint[i] * k
        streakTint = ghost
        streakAmt = 0.6
        streaks = portrait ? 2 : 3
      }
    }
    for (let i = 0; i < streaks; i++) {
      const t = delay + flood.dur * 0.6 + i * rand(0.1, 0.2)
      const q = takeOp(t)
      if (!q) break
      const ang = rand(-0.8, 0.8) + (Math.random() < 0.5 ? 0 : Math.PI)
      q.x = rand(0.1, 0.9)
      q.y = rand(0.12, 0.88)
      q.dirx = Math.cos(ang)
      q.diry = Math.sin(ang)
      q.stretch = rand(5, 9)
      q.rough = 0.7
      q.vr = 0.07 * s
      q.vx = Math.cos(ang) * 0.35 * H
      q.vy = Math.sin(ang) * 0.35 * H
      q.swirl = rand(-0.4, 0.4) * H
      q.hasDye = true
      q.dr = rand(0.016, 0.028) * s
      q.mixTo.set(streakTint)
      q.amt = streakAmt
    }
    kick(true)
  }

  let lastSeep = -1
  function seep(id, k, fromBottom) {
    const o = optics(id)
    if (!o || k < 0.08 || simTime - lastSeep < 0.07) return
    lastSeep = simTime
    const s = shortH()
    const edge = fromBottom ? 0 : 1
    const inward = fromBottom ? 1 : -1
    const p = takeOp(0)
    if (!p) return
    p.x = rand(0.04, 0.96)
    p.y = edge + inward * rand(-0.02, 0.03)
    p.srcR = 0.14 * s
    p.srcS = 1.4 * k
    p.srcTau = 0.35
    p.hasDye = true
    p.dr = rand(0.12, 0.2) * s
    p.rough = 0.7
    p.mixTo.set(o.mass)
    p.amt = 0.2 + 0.55 * k
    residual = Math.max(residual, maxDensity(o.mass) * 0.5)
    kick(false)
  }

  function updateFlood() {
    if (!flood.on && !flood.tail) return
    const t = simTime - flood.t0 - flood.delay
    if (flood.on) {
      const u = clamp(t / flood.dur)
      const e = 1 - Math.pow(1 - u, 2.1)
      flood.r = flood.r0 + (flood.r1 - flood.r0) * e
      rateIn = flood.rate
      rateOut = 0
      if (u >= 1) {
        flood.on = false
        flood.tail = true
      }
      return
    }
    // after the front has crossed: hold, then ease down to the field's rate
    // (under the type too, which has been clearing first)
    const k = clamp((t - flood.dur - flood.hold) / flood.ramp)
    const e = k * k * (3 - 2 * k)
    rateIn = flood.rate + (baseRate - flood.rate) * e
    rateOut = rateIn
    const typeRest = baseRate === SIM.relaxPaper ? SIM.typePaper : SIM.typeField
    typeBoost = SIM.typePour + (typeRest - SIM.typePour) * e
    if (k >= 1) flood.tail = false
  }

  /* ------------------------------------------------------------ drops, stir */
  function drop(d = {}) {
    if (!glReady) {
      if (pending.length < 24) pending.push(d)
      return
    }
    const id = d.id || (field && field !== 'paper' ? field : 'ultramarine')
    const o = optics(id)
    if (!o) return
    const s = shortH()
    const x = clamp(d.x ?? 0.5, -0.2, 1.2)
    const y = vy2uv(clamp(d.y ?? 0.5, -0.2, 1.2))
    const amount = clamp(d.amount ?? 1, 0, 4)
    const r = clamp(d.radius ?? 0.12, 0.005, 0.6) * s
    const rel = r / s // radius as a fraction of the short side
    const H = simH
    const vx = (d.vx || 0) * cssW * pxToTex()
    const vy = -(d.vy || 0) * window.innerHeight * pxToTex()
    const clear = o.paper
    const mix = clear || d.mode === 'mix'
    // indigo arrives as the yellow-green of the vat, and turns blue in air
    const dev = !clear && o.develop ? o.develop : null
    const colour = dev ? dev.from : o.mass

    // the drop: colour, and the little volume of water it brings, which
    // opens it out into a bloom
    const p = takeOp(0)
    if (!p) return
    p.x = x
    p.y = y
    p.srcR = r * 0.9
    p.srcS = (clear ? 3.2 : 2.2) * (0.7 + 0.3 * Math.min(amount, 2))
    p.srcTau = 0.55 + rel * 1.5
    if (vx || vy) {
      p.vr = r * 1.2
      p.vx = vx
      p.vy = vy
    }
    p.swirl = rand(-0.06, 0.06) * H
    p.rough = 0.65
    p.hasDye = true
    p.dr = r
    if (mix) {
      p.mixTo.set(colour)
      p.amt = Math.min(1, amount)
    } else {
      for (let i = 0; i < 4; i++) p.add[i] = colour[i] * amount
    }
    // fingers: a drop never opens evenly
    if (rel > 0.035 && amount > 0.25) {
      const n = 3 + Math.floor(Math.random() * 3)
      const a0 = rand(0, Math.PI * 2)
      for (let i = 0; i < n; i++) {
        const a = a0 + (i / n) * Math.PI * 2 + rand(-0.5, 0.5)
        const c = Math.cos(a)
        const sn = Math.sin(a)
        const f = takeOp(rand(0.12, 0.35))
        if (!f) break
        const rr = r * rand(0.9, 1.25)
        f.x = x + (c * rr) / aspect
        f.y = y + sn * rr
        f.vr = r * 0.35
        f.vx = c * rand(0.5, 1) * rel * 2.4 * H + vx * 0.4
        f.vy = sn * rand(0.5, 1) * rel * 2.4 * H + vy * 0.4
        f.rough = 0.5
        if (!clear) {
          f.hasDye = true
          f.dr = r * 0.28
          if (mix) {
            f.mixTo.set(colour)
            f.amt = Math.min(1, amount) * 0.7
          } else for (let k = 0; k < 4; k++) f.add[k] = colour[k] * amount * 0.35
        }
      }
    }
    if (dev) {
      // the air reaches it: in a few breaths the yellow-green goes blue,
      // wherever the drop has run to (the drop's own drift is followed)
      const steps = 6
      const ux = (d.vx || 0) * (window.innerWidth / cssW) * 0.4
      const uy = -(d.vy || 0) * (window.innerHeight / cssH) * 0.4
      for (let i = 0; i < steps; i++) {
        const t = dev.delay + (i / (steps - 1)) * dev.dur
        const q = takeOp(t)
        if (!q) break
        q.x = x + ux * Math.min(t, 1)
        q.y = y + uy * Math.min(t, 1)
        q.hasDye = true
        q.dr = r * 2.6
        q.rough = 0.3
        q.dev = dev
        q.devAmt = 1 / (steps - i)
      }
    }
    residual = Math.max(residual, maxDensity(o.mass) * Math.max(amount, 0.5) + 0.2)
    kick(true)
  }

  function stirAt(x, y, dxPx, dyPx, dt, strength, radius, tint) {
    // x, y: uv; dxPx/dyPx: css px moved (y up) over dt seconds
    const k = pxToTex()
    const inv = 1 / Math.max(dt, 1 / 120)
    let vx = dxPx * inv * k * 0.75 * strength
    let vy = dyPx * inv * k * 0.75 * strength
    const m = Math.hypot(vx, vy)
    const cap = simH * 2.4
    if (m > cap) {
      vx *= cap / m
      vy *= cap / m
    }
    const o = takeOp(0)
    if (!o) return
    o.x = x
    o.y = y
    o.vr = radius
    o.vx = vx
    o.vy = vy
    o.rough = 0.3
    if (tint > 0) {
      const speed = Math.hypot(dxPx, dyPx) * inv
      o.hasDye = true
      o.dr = radius * 0.75
      o.mixTo.set(whisper)
      o.amt = Math.min(0.08, speed / 11000) * tint * whisperGain
      if (m > 0) {
        o.dirx = vx / m
        o.diry = vy / m
        o.stretch = 1.6
      }
      residual = Math.max(residual, 0.25)
    }
  }

  /* ---------------------------------------------------------------- pointer */
  const ptr = { has: false, x: 0, y: 0, sx: 0, sy: 0, moved: false, t: 0 }
  function pointTo(clientX, clientY) {
    const x = clientX
    const y = clientY
    if (!ptr.has) {
      ptr.has = true
      ptr.x = ptr.sx = x
      ptr.y = ptr.sy = y
      ptr.t = performance.now()
      return
    }
    ptr.x = x
    ptr.y = y
    ptr.moved = true
    kick(false)
  }
  function flushPointer() {
    if (!ptr.moved) return
    ptr.moved = false
    const now = performance.now()
    const dt = clamp((now - ptr.t) / 1000, 1 / 240, 0.1)
    ptr.t = now
    const dx = ptr.x - ptr.sx
    const dy = ptr.y - ptr.sy
    const dist = Math.hypot(dx, dy)
    if (dist < 0.5) return
    const s = shortH()
    const radius = (phone() ? 0.075 : 0.055) * s
    const stepPx = radius * cssH * 0.8
    const n = Math.min(4, Math.max(1, Math.ceil(dist / stepPx)))
    for (let i = 1; i <= n; i++) {
      const t = i / n
      const px = ptr.sx + dx * t
      const py = ptr.sy + dy * t
      stirAt(px / cssW, 1 - py / cssH, dx / n, -dy / n, dt / n, 1, radius, 1)
    }
    ptr.sx = ptr.x
    ptr.sy = ptr.y
    lastInput = simTime
  }
  function ripple(clientX, clientY, strength) {
    if (!glReady) return
    const s = shortH()
    const o = takeOp(0)
    if (!o) return
    o.x = clientX / cssW
    o.y = 1 - clientY / cssH
    o.srcR = 0.05 * s
    o.srcS = 2.2 * strength
    o.srcTau = 0.35
    kick(true)
  }

  const listeners = []
  const listen = (el, type, fn, opts = { passive: true }) => {
    el.addEventListener(type, fn, opts)
    listeners.push(() => el.removeEventListener(type, fn, opts))
  }
  listen(window, 'pointermove', (e) => {
    if (e.pointerType === 'touch') return
    pointTo(e.clientX, e.clientY)
  })
  listen(window, 'pointerdown', (e) => {
    if (e.pointerType === 'touch') return
    ripple(e.clientX, e.clientY, 1)
  })
  listen(document, 'pointerleave', () => {
    ptr.has = false
  })
  listen(window, 'blur', () => {
    ptr.has = false
  })
  listen(window, 'touchstart', (e) => {
    const t = e.touches[0]
    if (!t) return
    ptr.has = false
    pointTo(t.clientX, t.clientY)
    ripple(t.clientX, t.clientY, 0.6)
  })
  listen(window, 'touchmove', (e) => {
    const t = e.touches[0]
    if (t) pointTo(t.clientX, t.clientY)
  })
  listen(window, 'touchend', () => {
    ptr.has = false
  })

  /* ----------------------------------------------------------------- the bus */
  ctx.on('drop', (d) => drop(d || {}))
  ctx.on('stir', (d = {}) => {
    if (!glReady) {
      if (pendingStirs.length < 8) pendingStirs.push(d)
      return
    }
    const s = shortH()
    const x = clamp(d.x ?? 0.5, 0, 1)
    const y = vy2uv(clamp(d.y ?? 0.5, 0, 1))
    const dxPx = (d.dx || 0) * cssW
    const dyPx = -(d.dy || 0) * window.innerHeight
    const strength = clamp(d.strength ?? 1, 0, 6)
    const radius = clamp(d.radius ?? 0.06, 0.01, 0.5) * s
    stirAt(x, y, dxPx, dyPx, 1 / 60, strength, radius, Math.min(strength, 2))
    lastInput = simTime
    kick(true)
  })

  ctx.palette.onChange((st) => {
    // scrolling drags the water a little (on paper the water travels with
    // the page instead, see frame(); this only adds a liquid lag to it)
    const v = st.velocity || 0
    const k = SIM.driftField + (SIM.driftPaper - SIM.driftField) * follow
    drift = glReady ? clamp(v, -60, 60) * 60 * pxToTex() * k : 0
    if (Math.abs(v) > 0.08) kick(false)
    // as a boundary nears the probe, the next colour wicks in from its edge
    if (glReady && st.field === field && st.from !== st.to && Math.abs(v) > 0.05) {
      if (v > 0 && field === st.from) seep(st.to, st.mix / 0.5, true)
      else if (v < 0 && field === st.to) seep(st.from, (1 - st.mix) / 0.5, false)
    }
    if (st.field === field) return
    const prev = field
    const dir = st.progress >= fieldProgress ? 1 : -1
    field = st.field
    fieldProgress = st.progress
    const o = optics(field) || OPTICS.paper
    if (prev === null || !glReady) {
      setTarget(o)
      if (glReady) fillDye(target)
      return
    }
    pour(field, Math.abs(v) > 0.3 ? Math.sign(v) : dir, prev)
  })

  /* ------------------------------------------------- the water and the page */
  // Ops still to fire and live sources are in screen space: when the water
  // travels with the page, they travel with it.
  function carry(dy) {
    if (opCount) for (let i = 0; i < POOL; i++) if (ops[i].on) ops[i].y += dy
    for (let i = 0; i < SRC; i++) if (sources[i].on) sources[i].y += dy
  }

  // Where the type is: the line boxes of every text node in the page, in
  // page coordinates, each tagged with the field it is set on. Measured when
  // the layout settles (never per frame); rasterised per frame into a small
  // mask of the screen for the current field only (a lab that re-inks its
  // type for a flood of its own drops out of the mask while it does).
  const text = { n: 0, rects: new Float32Array(0), fields: new Uint8Array(0), ids: new Map(), version: 0 }
  const fieldId = (f) => {
    let i = text.ids.get(f)
    if (i === undefined && text.ids.size < 250) text.ids.set(f, (i = text.ids.size + 1))
    return i || 0
  }
  const SKIP = '[hidden], .visually-hidden, .sr-only, script, style, noscript, template, canvas#dish'
  function measureText() {
    const roots = [document.querySelector('main'), ...document.querySelectorAll('body > footer')].filter(Boolean)
    const sy = window.scrollY
    const vw = window.innerWidth
    const out = []
    const tags = []
    const range = document.createRange()
    const MAX = 8000
    for (const r of roots) {
      const walker = document.createTreeWalker(r, NodeFilter.SHOW_TEXT)
      let node
      let lastEl = null
      let fi = 0
      while ((node = walker.nextNode()) && tags.length < MAX) {
        const v = node.nodeValue
        if (!v || !/\S/.test(v)) continue
        const el = node.parentElement
        if (!el) continue
        if (el !== lastEl) {
          lastEl = el
          const f = el.closest('[data-field]')
          fi = f && !el.closest(SKIP) ? fieldId(f.dataset.field) : 0
        }
        if (!fi) continue
        range.selectNodeContents(node)
        const rs = range.getClientRects()
        for (let i = 0; i < rs.length; i++) {
          const q = rs[i]
          if (q.width < 2 || q.height < 2 || q.right < 0 || q.left > vw) continue
          const m = Math.min(14, Math.max(4, q.height * 0.2))
          out.push(q.left - m, q.top + sy - m, q.right + m, q.bottom + sy + m)
          tags.push(fi)
        }
      }
    }
    text.rects = Float32Array.from(out)
    text.fields = Uint8Array.from(tags)
    text.n = tags.length
    text.version++
  }
  // (a few hundred line boxes: a few milliseconds, off the scroll path)
  let measureT = 0
  function remeasure(ms) {
    clearTimeout(measureT)
    measureT = setTimeout(() => {
      if (!alive) return
      try {
        measureText()
      } catch (err) {
        text.n = 0
        text.version++
      }
    }, ms)
  }

  function paintMask(sy) {
    if (!mask.tex) return
    const fi = text.ids.get(field) || 0
    if (sy === mask.y && fi === mask.field && text.version === mask.version) return
    mask.y = sy
    mask.field = fi
    mask.version = text.version
    const data = mask.data
    const W = mask.w
    data.fill(0)
    if (fi && text.n) {
      const kx = W / cssW
      const ky = mask.h / cssH
      const R = text.rects
      const F = text.fields
      for (let i = 0, j = 0; i < text.n; i++, j += 4) {
        if (F[i] !== fi) continue
        const top = R[j + 1] - sy
        const bottom = R[j + 3] - sy
        if (bottom < 0 || top > cssH) continue
        const c0 = Math.max(0, Math.floor(R[j] * kx))
        const c1 = Math.min(W, Math.ceil(R[j + 2] * kx))
        if (c1 <= c0) continue
        // mask rows run bottom-up, like the dish
        const r0 = Math.max(0, Math.floor((cssH - bottom) * ky))
        const r1 = Math.min(mask.h, Math.ceil((cssH - top) * ky))
        for (let r = r0; r < r1; r++) data.fill(255, r * W + c0, r * W + c1)
      }
      softenMask()
    }
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, mask.tex)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, mask.h, gl.RED, gl.UNSIGNED_BYTE, data)
  }

  // two box blurs make a soft halo round the type, so the water clears in a
  // breath around a line of text rather than in a box behind it
  function softenMask() {
    const W = mask.w
    const Hh = mask.h
    const a = mask.data
    const b = mask.tmp
    const R = 2
    const n = 2 * R + 1
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 0; y < Hh; y++) {
        const row = y * W
        let sum = 0
        for (let x = -R; x <= R; x++) sum += a[row + clamp(x, 0, W - 1)]
        for (let x = 0; x < W; x++) {
          b[row + x] = sum / n
          sum += a[row + Math.min(W - 1, x + R + 1)] - a[row + Math.max(0, x - R)]
        }
      }
      const gain = pass ? 1.6 : 1
      for (let x = 0; x < W; x++) {
        let sum = 0
        for (let y = -R; y <= R; y++) sum += b[clamp(y, 0, Hh - 1) * W + x]
        for (let y = 0; y < Hh; y++) {
          a[y * W + x] = (sum / n) * gain
          sum += b[Math.min(Hh - 1, y + R + 1) * W + x] - b[Math.max(0, y - R) * W + x]
        }
      }
    }
  }

  // the layout moves: measure the type again, once it has settled
  ctx.ready?.then(() => {
    remeasure(700)
    setTimeout(() => remeasure(0), 3600) // after the opening type has landed
  })
  document.fonts?.ready.then(() => remeasure(300))
  ctx.ScrollTrigger?.addEventListener?.('refresh', () => remeasure(250))
  const layoutRO = typeof ResizeObserver === 'function' ? new ResizeObserver(() => remeasure(450)) : null
  const typeMO =
    typeof MutationObserver === 'function'
      ? new MutationObserver(() => remeasure(40))
      : null
  for (const el of [document.querySelector('main'), ...document.querySelectorAll('body > footer')]) {
    if (!el) continue
    layoutRO?.observe(el)
    typeMO?.observe(el, { subtree: true, attributes: true, attributeFilter: ['data-field', 'hidden'] })
  }

  /* ------------------------------------------------------------------- loop */
  let rafId = 0
  let running = false
  let lastNow = 0
  let acc = 0
  let slowFrames = 0
  let frameCount = 0
  let frameSum = 0

  function kick(input) {
    if (input) lastInput = simTime
    if (!glReady || !alive || running || document.hidden) return
    running = true
    lastNow = performance.now()
    acc = 0
    frameCount = 0
    frameSum = 0
    canvas.dataset.state = 'awake'
    rafId = requestAnimationFrame(frame)
  }
  function sleep() {
    running = false
    if (rafId) cancelAnimationFrame(rafId)
    rafId = 0
    canvas.dataset.state = 'asleep'
  }

  function frame(now) {
    rafId = 0
    if (!alive || document.hidden) {
      sleep()
      return
    }
    const raw = Math.max(0, Math.min((now - lastNow) / 1000, 0.25))
    lastNow = now
    acc += raw
    flushPointer()

    const sy = window.scrollY
    const scrolling = lastScroll !== null && Math.abs(sy - lastScroll) > 0.25 && follow > 0.02
    const calm = simTime - lastInput > 3.5 && !flood.on && !opCount && !srcLive && Math.abs(drift) < 1
    // when only drying (relaxing in still water), 20 steps a second is plenty
    // (but not while the water is travelling with the page)
    const drying = calm && energy < 6 && !scrolling
    if (drying && acc < 1 / 20) {
      rafId = requestAnimationFrame(frame)
      return
    }
    const dt = Math.min(acc, drying ? 0.12 : 1 / 30)
    acc = 0
    simTime += dt

    // on paper the water travels with the page, so a drop stays with the
    // section it was made in; a pour is screen-wide, so it stays put
    const followTo = field === 'paper' && !flood.on ? 1 : 0
    follow += (followTo - follow) * (1 - Math.exp(-dt * (followTo > follow ? 2.5 : 9)))
    const shift = lastScroll === null ? 0 : clamp((follow * SIM.follow * (sy - lastScroll)) / cssH, -2, 2)
    lastScroll = sy
    if (shift) carry(shift)
    paintMask(sy)

    // adaptive quality: if the device can't keep up, lighten the load
    if (!drying && quality < 2) {
      frameCount++
      if (frameCount > 8) frameSum += raw
      if (frameCount >= 68) {
        if (frameSum / 60 > 0.042 && ++slowFrames >= 2) {
          quality++
          slowFrames = 0
          allocate()
        }
        frameCount = 0
        frameSum = 0
      }
    }

    updateFlood()
    runOps()
    packSources()
    const moving = energy > 0.35 || Math.abs(drift) > 0.5 || opCount > 0 || srcLive > 0
    step(dt, dt, moving, shift)
    render()
    if (firstFrame) {
      firstFrame = false
      root.classList.add('dish-on')
    }

    energy *= Math.exp(-SIM.velDiss * dt)
    const relaxing = flood.on ? 0 : Math.min(rateIn, rateOut)
    residual *= Math.exp(-relaxing * dt)

    const done = calm && energy < 0.35 && residual < 0.012 && !flood.tail
    if (done) {
      sleep()
      return
    }
    rafId = requestAnimationFrame(frame)
  }

  /* -------------------------------------------------------------- lifecycle */
  let resizeT = 0
  function onResize() {
    clearTimeout(resizeT)
    resizeT = setTimeout(() => {
      if (!glReady) return
      allocate()
      mask.y = NaN
      remeasure(300)
      render()
      kick(false)
    }, 120)
  }
  listen(window, 'resize', onResize)
  listen(document, 'visibilitychange', () => {
    if (document.hidden) sleep()
    else kick(false)
  })
  listen(
    canvas,
    'webglcontextlost',
    (e) => {
      e.preventDefault()
      glReady = false
      sleep()
      disable()
    },
    false,
  )
  listen(
    canvas,
    'webglcontextrestored',
    () => {
      // start again from scratch on the new context
      vel = dye = pressure = divergence = curl = null
      mask.tex = null
      mask.w = mask.h = 0
      for (const k in P) delete P[k]
      firstFrame = true
      root.classList.remove('no-dish')
      boot()
    },
    false,
  )

  function boot() {
    // (re-)enable the float render targets on this context
    gl.getExtension('EXT_color_buffer_float')
    gl.getExtension('EXT_color_buffer_half_float')
    gl.getExtension('OES_texture_float_linear')
    const ext = compileAll()
    const poll = () => {
      if (!alive) return
      if (!programsDone(ext)) {
        requestAnimationFrame(poll)
        return
      }
      try {
        finishPrograms()
        allocate()
      } catch (err) {
        console.error(err)
        alive = false
        disable()
        return
      }
      glReady = true
      lastScroll = window.scrollY
      const st = ctx.palette.get()
      if (field === null) field = st.field
      follow = field === 'paper' ? 1 : 0
      setTarget(optics(field) || OPTICS.paper)
      fillDye(target)
      render()
      // anything that was asked for while the GPU warmed up
      for (const d of pending.splice(0)) drop(d)
      for (const d of pendingStirs.splice(0)) ctx.emit('stir', d)
      kick(true)
    }
    requestAnimationFrame(poll)
  }

  boot()
  return true
}

/* ============================================================ capabilities */

function detectFormats(gl) {
  const cbf = gl.getExtension('EXT_color_buffer_float')
  gl.getExtension('EXT_color_buffer_half_float')
  const floatLinear = gl.getExtension('OES_texture_float_linear')

  const half = {
    type: gl.HALF_FLOAT,
    rgba: supported(gl, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT),
    rg: supported(gl, gl.RG16F, gl.RG, gl.HALF_FLOAT),
    r: supported(gl, gl.R16F, gl.RED, gl.HALF_FLOAT),
    linear: true,
  }
  if (half.rgba && half.rg && half.r) return half
  if (!cbf) return null
  const full = {
    type: gl.FLOAT,
    rgba: supported(gl, gl.RGBA32F, gl.RGBA, gl.FLOAT),
    rg: supported(gl, gl.RG32F, gl.RG, gl.FLOAT),
    r: supported(gl, gl.R32F, gl.RED, gl.FLOAT),
    linear: !!floatLinear,
  }
  if (full.rgba && full.rg && full.r) return full
  return null
}

function supported(gl, internal, format, type) {
  if (renderable(gl, internal, format, type)) return { internal, format }
  if (internal === gl.R16F) return supported(gl, gl.RG16F, gl.RG, type)
  if (internal === gl.RG16F) return supported(gl, gl.RGBA16F, gl.RGBA, type)
  if (internal === gl.R32F) return supported(gl, gl.RG32F, gl.RG, type)
  if (internal === gl.RG32F) return supported(gl, gl.RGBA32F, gl.RGBA, type)
  return null
}

function renderable(gl, internal, format, type) {
  const tex = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, 4, 4, 0, format, type, null)
  const fb = gl.createFramebuffer()
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.bindTexture(gl.TEXTURE_2D, null)
  gl.deleteFramebuffer(fb)
  gl.deleteTexture(tex)
  return ok
}
