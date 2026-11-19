/**
 * ocean.js — the global water.
 *
 * One fixed WebGL canvas (#ocean) that only ever ADDS light on top of the
 * CSS water colour (--bg from depth.js). The canvas is cleared to black and
 * composited with `mix-blend-mode: screen` (see ocean.css), so black means
 * "no light here" and the page colour always shows through.
 *
 * Layers (back → front):
 *   1. Light pass, rendered at reduced resolution into a render target:
 *      - Snell's window: a real refraction of the sky through a rippling
 *        surface (per-pixel normal → refract → sky), with Fresnel fade and a
 *        slight dispersion at the edge, total internal reflection outside it.
 *      - Light shafts converging on the sun's under-water position.
 *      - A faint caustic web drifting through the water.
 *      All of it scales with state.sun and recedes upward as you leave the
 *      surface (camera pitch drops, path to the surface lengthens).
 *   2. Marine snow — thousands of soft particles in parallax layers. Scroll
 *      down and they stream upward past you (motion-stretched with speed).
 *   3. Bioluminescent sparks from ~200 m — brief, scattered flashes, some in
 *      siphonophore-like chains — tinted red in the hadal zone.
 *   4. Sun glitter: brief cyan-white glints inside Snell's window, gathered
 *      toward the sun's image; they leave with the window as you sink.
 *   5. Stimulated plankton glints. Below ~200 m, descending fast lights the
 *      water (more flashes the faster you go, streaked by the motion).
 *
 * Layer crossings: every zone boundary (200, 1,000, 4,000, 6,000 m) is a
 * change of water mass. Cross one, either way, and a sheet of that layer
 * sweeps through the view over ~1.5 s (up the screen on the way down): its
 * faces shimmer as fine strata, it lenses the light behind it, it lights
 * the snow and the plankton it carries, and at 200 m, where sunlight still
 * reaches, it gathers that light into a travelling band of caustic glimmer.
 *
 * Atmosphere (plain DOM, also without WebGL): a vignette in the water's own
 * near-black that closes in with depth plus a darker column below you near
 * the surface — both UNDER <main>, so they never dim text — and a fine film
 * grain over the content (overlay blend, stepped by the compositor).
 *
 * Boot: init() only builds plain JS objects. The WebGL context, the
 * renderer and the shaders (compiled in parallel where the browser can) are
 * created in idle time while the intro plays, and nothing is drawn while the
 * loader's black panel still covers the page.
 *
 * Intro: the light comes up WITH the loader's flood (bus 'intro:flood', or
 * the loader gaining .is-exiting), so the rising waterline uncovers a sun
 * window that is already shimmering. The water it brings is stirred: the
 * surface ripples harder and the caustics flare, then settle over ~3 s, and
 * the snow rushes up past the lens as we go under. Without the loader
 * (?skipintro) the light simply rises on ctx.ready.
 *
 * Cost: nothing is drawn while the water is hidden (bus 'ocean:cover'
 * { on }, or the creatures' stage fully blacked out); in deep, still water
 * (no sunlight, no scroll, no pointer, no ping) it draws at 30 fps.
 *
 * Listens: ctx.on('sonar', { x, y, strength }) → a ring passes through the
 * snow and lights it up. Never throws. Without WebGL2 it adds html.no-webgl
 * and ocean.css paints a still, CSS-only sun window instead.
 */
import '../styles/ocean.css'
import {
  WebGLRenderer,
  Scene,
  OrthographicCamera,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  BufferGeometry,
  BufferAttribute,
  Points,
  WebGLRenderTarget,
  AdditiveBlending,
  NoBlending,
  LinearFilter,
  Vector2,
  Vector3,
  Vector4,
} from 'three'

const DEG = Math.PI / 180
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const lerp = (a, b, t) => a + (b - a) * t
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/* ------------------------------------------------------------------ GLSL */

const COMMON = /* glsl */ `
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 hash31(float p) { vec3 p3 = fract(vec3(p) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xxy + p3.yzz) * p3.zyx); }
float noise1(float x) { float i = floor(x); float f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(hash11(i), hash11(i + 1.0), f); }

// Light shafts: parallel in the water, so in perspective they radiate from
// the vanishing point of the (refracted) sun direction. sp and vp are in
// aspect-corrected screen space (x * aspect, y).
float shafts(vec2 sp, vec2 vp, float freq, float t) {
  vec2 v = sp - vp;
  float dist = length(v);
  float a = atan(v.x, -v.y) * freq;
  a += 0.018 * sin(t * 0.21 + a * 3.0) + 0.011 * sin(t * 0.37 - a * 7.0);
  float s = noise1(a * 21.0 + t * 0.085) * 0.58
          + noise1(a * 47.0 - t * 0.13) * 0.3
          + noise1(a * 97.0 + t * 0.24) * 0.12;
  s = smoothstep(0.4, 0.95, s);
  float brk = 0.5 + 0.5 * noise1(dist * 2.1 - t * 0.22 + a * 9.0);
  return s * s * brk;
}

// A layer boundary (thermocline / halocline) seen edge-on: a slow, slightly
// tilted undulation around its centre line. x is aspect-corrected.
float bandOff(float x, float t) {
  return 0.05 * sin(x * 1.3 + t * 0.9) + 0.024 * sin(x * 3.7 - t * 1.7) + 0.035 * x;
}
`

const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const LIGHT_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uAspect;
uniform float uTime;
uniform float uAmt;
uniform float uPitch;
uniform float uYaw;
uniform float uTanFov;
uniform float uH;
uniform float uHK;
uniform vec3 uSunW;
uniform vec3 uSunA;
uniform vec2 uVP;
uniform float uRayFreq;
uniform float uRays;
uniform float uWin;
uniform float uStir;
uniform vec4 uBand;      // x: centre (ndc y), y: amount, z: travel (+1 up), w: sunlit
uniform vec3 uBandCol;
${COMMON}

vec3 camDir(vec2 ndc) {
  float sp = sin(uPitch), cp = cos(uPitch);
  vec3 f = vec3(0.0, sp, cp);
  vec3 u = vec3(0.0, cp, -sp);
  vec3 d = normalize(f + ndc.x * uTanFov * uAspect * vec3(1.0, 0.0, 0.0) + ndc.y * uTanFov * u);
  float sy = sin(uYaw), cy = cos(uYaw);
  return vec3(d.x * cy + d.z * sy, d.y, -d.x * sy + d.z * cy);
}

// Gradient of a small sum-of-waves height field (metres), with a slow
// domain warp so the pattern never looks like a grid.
vec2 waveGrad(vec2 p, float t) {
  p += 0.55 * vec2(sin(p.y * 0.47 + t * 0.21), cos(p.x * 0.52 - t * 0.17));
  p += 0.22 * vec2(sin(p.y * 1.7 - t * 0.43), cos(p.x * 1.9 + t * 0.37));
  vec2 g = vec2(0.0);
  vec2 d; float k; float ph;
  // wave groups: amplitude swells and fades across the surface
  float grp = 0.72 + 0.28 * sin(dot(p, vec2(0.31, -0.23)) + t * 0.16);
  d = normalize(vec2( 1.0,  0.35)); k = 6.2831 / 2.10; ph = dot(d, p) * k - t * 1.15; g += d * (0.022 * k * cos(ph));
  d = normalize(vec2(-0.55, 1.0));  k = 6.2831 / 1.37; ph = dot(d, p) * k - t * 1.32; g += d * (0.014 * k * cos(ph));
  d = normalize(vec2( 0.25,-1.0));  k = 6.2831 / 0.86; ph = dot(d, p) * k - t * 1.71; g += d * (0.0085 * k * cos(ph));
  d = normalize(vec2(-1.0, -0.4));  k = 6.2831 / 0.59; ph = dot(d, p) * k - t * 2.05; g += d * (0.0052 * k * cos(ph));
  d = normalize(vec2( 0.8,  0.75)); k = 6.2831 / 0.38; ph = dot(d, p) * k - t * 2.55; g += d * (0.0031 * k * cos(ph));
  d = normalize(vec2(-0.3,  0.95)); k = 6.2831 / 0.24; ph = dot(d, p) * k - t * 3.20; g += d * (0.0017 * k * cos(ph));
  d = normalize(vec2( 0.93,-0.61)); k = 6.2831 / 1.71; ph = dot(d, p) * k - t * 1.24; g += d * (0.011 * k * cos(ph));
  return g * grp;
}

// The sky, seen from below through the surface.
vec3 sky(vec3 T) {
  float el = clamp(T.y, 0.0, 1.0);
  vec3 c = mix(vec3(0.94, 1.0, 1.0), vec3(0.60, 0.86, 0.97), pow(el, 0.55));
  float s = max(dot(T, uSunA), 0.0);
  c += vec3(1.0, 0.98, 0.92) * (pow(s, 1400.0) * 9.0 + pow(s, 60.0) * 0.9 + pow(s, 7.0) * 0.22);
  return c;
}

// A tileable caustic web (after the well-known iterative water caustic).
float causticWeb(vec2 uv, float time) {
  vec2 p = mod(uv * 6.28318, 6.28318) - 250.0;
  vec2 i = p;
  float c = 1.0;
  const float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float t = time * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + t) / inten), p.y / (cos(i.y + t) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec2 sp = vec2(ndc.x * uAspect, ndc.y);
  vec3 d = camDir(ndc);
  vec3 col = vec3(0.0);

  // ---- Snell's window + the mirror-like underside of the surface
  if (d.y > 0.015) {
    float invY = 1.0 / d.y;
    vec2 P = d.xz * uH * invY;
    float lod = exp(-uH * invY * 0.055);           // far ripples are sub-pixel: calm them
    vec2 g = waveGrad(P, uTime) * lod * (1.0 + 1.5 * uStir);   // freshly stirred water
    vec3 n = normalize(vec3(g.x, -1.0, g.y));       // surface normal, facing down
    float cosI = -dot(n, d);
    // Three wavelengths → a hint of dispersion right at the rim.
    vec3 eta = vec3(1.3295, 1.3330, 1.3385);
    vec3 k = 1.0 - eta * eta * (1.0 - cosI * cosI);
    vec3 cosT = sqrt(max(k, 0.0));
    vec3 tr = 1.0 - (0.02 + 0.98 * pow(1.0 - cosT, vec3(5.0)));   // Fresnel transmission
    vec3 T = refract(d, n, 1.333);
    vec3 skyc = sky(normalize(T + vec3(0.0, 1e-4, 0.0)));
    // red is absorbed first: the window is seen through blue-green water
    vec3 att = exp(-uHK * invY * vec3(1.9, 0.82, 0.66));
    // the moving surface focuses the sky into a faint bright network
    float net = causticWeb(P * 0.21 + vec2(0.0, uTime * 0.01), uTime * 0.45);
    col += skyc * tr * att * uWin * (0.84 + 0.55 * net * (1.0 + 1.3 * uStir));
    // outside the window: total internal reflection of the dim water below,
    // broken up by the ripples
    float slope = length(g);
    float tir = 1.0 - tr.g;
    col += vec3(0.05, 0.17, 0.2) * (0.25 + 3.2 * slope * slope) * tir * att * uWin;
  }

  // ---- In-scattered glow: water is brighter toward the sun (forward scattering)
  float mu = dot(d, uSunW);
  float g2 = 0.72;
  float hg = (1.0 - g2 * g2) / pow(1.0 + g2 * g2 - 2.0 * g2 * mu, 1.5);
  float upw = smoothstep(-0.55, 0.9, d.y);
  col += vec3(0.32, 0.8, 0.9) * (0.03 * upw + 0.012 * hg) ;

  // ---- Light shafts
  float topFade = smoothstep(-1.25, 0.85, ndc.y);
  float r = shafts(sp, uVP, uRayFreq, uTime) * topFade * topFade;
  col += vec3(0.62, 0.93, 1.0) * r * 0.26 * uRays;

  // ---- Caustic web drifting through the upper water
  vec2 cp = sp * 0.95 + vec2(uTime * 0.011, uTime * 0.017);
  float c = causticWeb(cp, uTime * 0.32);
  col += vec3(0.6, 0.96, 1.0) * c * (0.05 + 0.3 * r) * (1.0 + 1.6 * uStir) * topFade * uRays;

  col *= uAmt;

  // ---- Crossing a layer boundary: a sheet of denser water sweeps through
  // the view. Its faces shimmer like heat haze (fine, broken strata); where
  // sunlight still reaches, the lensing layer gathers it into a travelling
  // band of caustic glimmer. In the dark it is only a faint living haze, and
  // the plankton it carries (the glint layer) does the rest.
  if (uBand.y > 0.002) {
    float bd = ndc.y - uBand.x - bandOff(sp.x, uTime);
    float bw = 0.17;
    float prof = exp(-bd * bd / (bw * bw));
    if (prof > 0.004) {
      float str = 0.0;
      for (int k = 0; k < 3; k++) {
        float fk = float(k);
        float o = (fk - 1.0) * 0.052 + 0.012 * sin(uTime * 1.7 + fk * 2.1 + sp.x * 2.6);
        float w = bd - o + 0.006 * sin(sp.x * 11.0 + uTime * 2.4 + fk);
        float brk = smoothstep(0.3, 0.85, noise1(sp.x * 3.1 + fk * 7.3 - uTime * 0.9 * uBand.z));
        str += exp(-w * w / 0.00004) * brk * (fk == 1.0 ? 1.0 : 0.6);
      }
      float web = causticWeb(sp * 1.45 + vec2(uTime * 0.03, bd * 1.8), uTime * 0.9);
      vec3 b = uBandCol * (0.06 * prof + 0.22 * str * prof);
      b += vec3(0.8, 0.97, 1.0) * uBand.w * prof * (0.06 + 0.48 * web + 0.28 * str);
      col += b * uBand.y;
    }
  }

  // a dome-port style falloff along the top edge keeps the glare off the nav
  col *= 1.0 - 0.38 * smoothstep(0.74, 1.0, ndc.y);
  col += (hash12(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) / 255.0;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`

const COMPOSITE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform float uTime;
uniform float uAspect;
uniform vec4 uBand;
${COMMON}
void main() {
  vec2 uv = vUv;
  // a passing layer is a weak lens: it bends the light behind it
  if (uBand.y > 0.002) {
    vec2 ndc = vUv * 2.0 - 1.0;
    float bd = ndc.y - uBand.x - bandOff(ndc.x * uAspect, uTime);
    float e = exp(-bd * bd / 0.029) * uBand.y;
    uv.y -= bd * e * 0.05;
    uv.x += 0.0035 * sin(ndc.y * 34.0 - uTime * 3.6 * uBand.z + ndc.x * 4.0) * e;
  }
  vec3 c = texture2D(uTex, uv).rgb;
  c += (hash12(gl_FragCoord.xy + fract(uTime * 7.0) * 113.0) - 0.5) / 255.0;
  gl_FragColor = vec4(max(c, 0.0), 1.0);
}
`

const SNOW_VERT = /* glsl */ `
attribute vec4 aRand;
uniform float uTime;
uniform float uFlow;
uniform float uVel;
uniform float uPR;
uniform float uAspect;
uniform float uAmt;
uniform float uLight;
uniform float uRayFreq;
uniform float uScale;
uniform vec2 uVP;
uniform vec2 uMouse;
uniform float uMouseAmt;
uniform vec4 uSonar;
uniform vec3 uCol;
uniform vec4 uBand;
uniform vec3 uBandCol;
varying float vA;
varying float vS;
varying float vSoft;
varying vec3 vC;
${COMMON}

void main() {
  float z = position.z;               // 0 = right in front of the lens, 1 = far
  float near = 1.0 - z;
  float par = mix(0.2, 1.85, near * near);
  // Descent: scroll down and the water column streams up past you.
  // At rest, the snow keeps sinking, very slowly.
  float sink = uTime * mix(0.0035, 0.014, near) * (0.6 + 0.8 * aRand.x);
  float y = fract(position.y + uFlow * par * 0.6 - sink);
  float x = position.x + sin(uTime * (0.04 + 0.1 * aRand.y) + aRand.z * 6.2831) * 0.012 * (0.35 + near);
  vec2 sp = vec2((x * 2.0 - 1.0) * uAspect * 1.04, y * 2.3 - 1.15);

  // The pointer parts the water a little (near particles only).
  vec2 dm = sp - vec2(uMouse.x * uAspect, uMouse.y);
  float md = length(dm);
  sp += dm / max(md, 1e-3) * uMouseAmt * 0.055 * near * exp(-md * md / 0.03);

  // A sonar ping travels outward and lights the snow as it passes.
  float age = uTime - uSonar.z;
  vec2 ds = sp - vec2(uSonar.x * uAspect, uSonar.y);
  float sd = length(ds);
  float ring = uSonar.w * step(0.0, age) * exp(-pow((sd - age * 0.85) / 0.15, 2.0)) * exp(-age * 0.7);
  sp += ds / max(sd, 1e-3) * ring * 0.035;

  gl_Position = vec4(sp.x / uAspect, sp.y, 0.0, 1.0);

  float soft = smoothstep(0.32, 0.0, z);                       // out of focus up close
  float size = mix(1.15, 6.5, pow(near, 2.4)) * (0.55 + 0.9 * aRand.w) * (1.0 + soft * 1.4);
  float stretch = 1.0 + min(abs(uVel) * par * 1.4, 7.0);
  vS = stretch;
  vSoft = soft;
  gl_PointSize = max(size * stretch * uScale, 1.0) * uPR;

  float a = mix(0.16, 0.6, smoothstep(1.0, 0.4, z)) * (0.35 + 0.65 * aRand.x);
  a *= mix(1.0, 0.3, soft);
  a /= pow(stretch, 0.6);
  a *= 0.78 + 0.22 * sin(uTime * (0.5 + aRand.y * 1.6) + aRand.z * 40.0);
  float lit = shafts(sp, uVP, uRayFreq, uTime);
  a *= 1.0 + uLight * (0.6 + 3.2 * lit) * smoothstep(-1.2, 0.8, sp.y);
  a *= 1.0 + 7.0 * ring;
  // a passing layer catches the motes it carries
  float bd = sp.y - uBand.x - bandOff(sp.x, uTime);
  float bx = exp(-bd * bd / 0.016) * uBand.y * (0.35 + 0.65 * aRand.w);
  a *= 1.0 + 3.2 * bx;
  vA = a * uAmt;
  // the ping briefly tints what it touches with living blue-green
  vC = mix(uCol, vec3(0.42, 0.97, 0.91), clamp(ring, 0.0, 1.0) * 0.7);
  vC = mix(vC, uBandCol, clamp(bx, 0.0, 1.0) * 0.55);
}
`

const SNOW_FRAG = /* glsl */ `
precision highp float;
varying float vA;
varying float vS;
varying float vSoft;
varying vec3 vC;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r = 1.0 / vS;
  // a capsule: round when still, a thin vertical streak when moving fast
  float d = length(vec2(q.x, max(abs(q.y) - (1.0 - r), 0.0))) / r;
  float f = 1.0 - smoothstep(mix(0.0, 0.5, vSoft), 1.0, d);
  f = mix(f * f, f, vSoft);
  f += vSoft * 0.22 * smoothstep(0.55, 0.85, d) * (1.0 - smoothstep(0.85, 1.0, d)) * r;
  // streaks fade toward both ends, like a real motion blur
  float streak = 1.0 - r;
  f *= mix(1.0, 1.0 - smoothstep(0.15, 1.0, abs(q.y)), streak);
  if (f <= 0.001) discard;
  gl_FragColor = vec4(vC, vA * f);
}
`

const SPARK_VERT = /* glsl */ `
attribute vec4 aRand;
attribute vec4 aChain;     // x: chain seed, y: index in chain, z: chain length (0 = solo)
uniform float uTime;
uniform float uFlow;
uniform float uPR;
uniform float uAspect;
uniform float uAmt;
uniform float uScale;
uniform float uHadal;
uniform vec3 uColA;
uniform vec3 uColB;
uniform vec3 uColR;
varying float vA;
varying float vSoft;
varying vec3 vC;
${COMMON}

void main() {
  float isChain = step(0.5, aChain.z);
  float P = mix(4.5, 12.0, aRand.x);
  float phase = isChain > 0.5 ? hash11(aChain.x * 7.3) : aRand.y;
  float tt = uTime + phase * P;
  float cyc = floor(tt / P);
  float l = tt - cyc * P - aChain.y * 0.075 * isChain;   // chains light up in sequence
  float env = smoothstep(0.0, 0.07, l) * exp(-max(l, 0.0) * mix(3.4, 1.3, aRand.z));
  env += 0.6 * step(0.66, aRand.w) * (1.0 - isChain) * smoothstep(0.3, 0.37, l) * exp(-max(l - 0.3, 0.0) * 2.4);

  // every flash happens somewhere new
  float seed = isChain > 0.5 ? aChain.x : aRand.z * 13.1 + aRand.w * 7.7;
  vec3 h = hash31(seed * 17.13 + cyc * 3.71);
  vec3 h2 = hash31(seed * 5.31 + cyc * 1.97 + 11.0);
  vec2 base = h.xy;
  float z = isChain > 0.5 ? 0.35 + 0.5 * h2.z : h.z;
  if (isChain > 0.5) {
    float ang = h2.x * 6.2831;
    vec2 dir = vec2(cos(ang), sin(ang) * 0.6);
    vec2 perp = vec2(-dir.y, dir.x);
    float s = aChain.y - aChain.z * 0.5;
    base += dir * s * 0.011 * (1.4 - z) + perp * sin(aChain.y * 0.5 + h2.y * 6.0) * 0.02;
  }
  float near = 1.0 - z;
  float par = mix(0.2, 1.6, near * near);
  float y = fract(base.y + uFlow * par * 0.6 + uTime * 0.004);
  float x = base.x + sin(uTime * 0.07 + seed) * 0.01;
  vec2 sp = vec2((x * 2.0 - 1.0) * 1.04, y * 2.3 - 1.15);
  gl_Position = vec4(sp, 0.0, 1.0);

  float soft = smoothstep(0.3, 0.0, z);
  float size = mix(3.0, 11.0, pow(near, 2.0)) * (1.0 + soft * 2.4) * (isChain > 0.5 ? 0.8 : 1.0);
  vSoft = soft;
  float a = env * uAmt * mix(1.0, 0.4, soft) * (0.55 + 0.45 * aRand.z);
  vA = a;
  gl_PointSize = a < 0.003 ? 0.0 : size * uScale * uPR;
  vec3 c = mix(uColA, uColB, h2.y);
  vC = mix(c, uColR, uHadal * (0.35 + 0.4 * h2.z));
}
`

const SPARK_FRAG = /* glsl */ `
precision highp float;
varying float vA;
varying float vSoft;
varying vec3 vC;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float d2 = dot(q, q);
  if (d2 > 1.0) discard;
  float core = exp(-d2 * 14.0);
  float halo = exp(-d2 * 3.0) * 0.6;
  float bokeh = (1.0 - smoothstep(0.55, 1.0, sqrt(d2))) * 0.5;
  float f = mix(core + halo, bokeh, vSoft);
  // the hottest centre runs toward white, like a real photophore
  vec3 c = mix(vC, vec3(1.0), core * 0.35 * (1.0 - vSoft));
  gl_FragColor = vec4(c, vA * f);
}
`

// Stimulated light. Small plankton flash when the water around them is
// disturbed: descend fast through dark water and the sub's wake lights up
// (uBloom), and a layer boundary passing through the view lights the
// plankton it carries (uBand). Each glint fires on its own short cycle,
// somewhere new each time, and is swept past like the snow.
const GLINT_VERT = /* glsl */ `
attribute vec4 aRand;
uniform float uTime;
uniform float uFlow;
uniform float uVel;
uniform float uPR;
uniform float uAspect;
uniform float uScale;
uniform float uBloom;
uniform float uHadal;
uniform vec4 uBand;
uniform vec3 uBandCol;
uniform vec3 uColA;
uniform vec3 uColB;
uniform vec3 uColR;
varying float vA;
varying float vS;
varying vec3 vC;
${COMMON}

void main() {
  float P = mix(0.8, 2.2, aRand.x);
  float tt = uTime + aRand.y * P;
  float cyc = floor(tt / P);
  float l = tt - cyc * P;
  vec3 h = hash31(aRand.w * 37.1 + cyc * 2.93);

  float z = aRand.z;
  float near = 1.0 - z;
  float par = mix(0.25, 1.9, near * near);
  float y = fract(h.y + uFlow * par * 0.6);
  vec2 sp = vec2((h.x * 2.0 - 1.0) * uAspect * 1.04, y * 2.3 - 1.15);
  gl_Position = vec4(sp.x / uAspect, sp.y, 0.0, 1.0);

  // the faster the descent, the more of them answer
  float thr = 1.0 - 0.75 * uBloom;
  float fire = smoothstep(thr, thr + 0.06, h.z) * uBloom;
  float env = smoothstep(0.0, 0.035, l) * exp(-l * mix(6.5, 3.0, aRand.x));
  float bloom = fire * env;

  float bd = sp.y - uBand.x - bandOff(sp.x, uTime);
  float bp = exp(-bd * bd / 0.014) * uBand.y * step(0.2, aRand.w);
  float tw = 0.5 + 0.5 * sin(uTime * (13.0 + 21.0 * aRand.x) + aRand.y * 40.0);
  float band = bp * (0.25 + 0.75 * tw * tw);

  float stretch = 1.0 + min(abs(uVel) * par * 1.25, 6.0);
  vS = stretch;
  float a = (bloom * mix(0.7, 1.5, near) + band * 1.35) / pow(stretch, 0.3);
  vA = a;
  float size = mix(2.6, 8.5, near * near) * (1.0 + 0.9 * clamp(bp, 0.0, 1.0));
  gl_PointSize = a < 0.004 ? 0.0 : size * stretch * uScale * uPR;

  vec3 c = mix(uColA, uColB, fract(h.z * 7.13));
  // living light stays blue-green, even under the red lamps
  c = mix(c, uColR, uHadal * 0.1);
  vC = mix(c, uBandCol, clamp(band / max(a, 1e-3), 0.0, 1.0));
}
`

const GLINT_FRAG = /* glsl */ `
precision highp float;
varying float vA;
varying float vS;
varying vec3 vC;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r = 1.0 / vS;
  float d = length(vec2(q.x, max(abs(q.y) - (1.0 - r), 0.0))) / r;
  if (d > 1.0) discard;
  float core = exp(-d * d * 12.0);
  float halo = exp(-d * d * 3.2) * 0.45;
  float f = (core + halo) * mix(1.0, 1.0 - smoothstep(0.1, 1.0, abs(q.y)), 1.0 - r);
  gl_FragColor = vec4(mix(vC, vec3(1.0), core * 0.3), vA * f);
}
`

// Sun glitter. Where a ripple tilts just right, the sun flashes through the
// surface for an instant: glints gather toward the sun's image and only
// happen inside Snell's window, so they leave with the window as you sink.
const GLITTER_VERT = /* glsl */ `
attribute vec4 aRand;
uniform float uTime;
uniform float uPR;
uniform float uAspect;
uniform float uAmt;
uniform float uScale;
uniform float uPitch;
uniform float uYaw;
uniform float uTanFov;
uniform vec3 uSunW;
uniform vec2 uVP;
varying float vA;
${COMMON}

void main() {
  float P = mix(0.7, 2.4, aRand.x);
  float tt = uTime + aRand.y * P;
  float cyc = floor(tt / P);
  float l = tt - cyc * P;
  float dur = mix(0.12, 0.36, aRand.z);
  float env = smoothstep(0.0, dur * 0.25, l) * (1.0 - smoothstep(dur * 0.25, dur, l));
  vec3 h = hash31(aRand.w * 29.3 + cyc * 3.77);
  vec2 ndc = vec2(uVP.x / uAspect + (h.x - 0.5) * 1.7, mix(0.2, 1.02, sqrt(h.y)));

  float s = sin(uPitch), c = cos(uPitch);
  vec3 d = normalize(vec3(0.0, s, c) + ndc.x * uTanFov * uAspect * vec3(1.0, 0.0, 0.0) + ndc.y * uTanFov * vec3(0.0, c, -s));
  float sy = sin(uYaw), cy = cos(uYaw);
  d = vec3(d.x * cy + d.z * sy, d.y, -d.x * sy + d.z * cy);
  float win = smoothstep(0.66, 0.78, d.y);
  float toSun = pow(max(dot(d, uSunW), 0.0), 9.0);

  float a = env * win * toSun * uAmt * (0.7 + 0.9 * h.z);
  vA = a;
  gl_Position = vec4(ndc, 0.0, 1.0);
  gl_PointSize = a < 0.004 ? 0.0 : mix(9.0, 30.0, h.z * toSun) * uScale * uPR;
}
`

const GLITTER_FRAG = /* glsl */ `
precision highp float;
varying float vA;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  float core = exp(-r2 * 26.0) * 1.4;
  float fade = 1.0 - sqrt(r2);
  float arms = exp(-abs(q.x) * 26.0 - q.y * q.y * 1.5) + exp(-abs(q.y) * 26.0 - q.x * q.x * 1.5);
  float f = core + 0.45 * arms * fade * fade;
  // seen through blue-green water: cyan-white, white-hot at the centre
  gl_FragColor = vec4(mix(vec3(0.66, 0.95, 1.0), vec3(1.0), min(core, 1.0) * 0.6), vA * f);
}
`

/* ------------------------------------------------------------- module */

export function init(ctx) {
  const canvas = document.getElementById('ocean')
  if (!canvas) return
  try {
    return createOcean(ctx, canvas)
  } catch (err) {
    console.warn('[ocean] disabled:', err?.message || err)
  }
}

// Work that may take a few milliseconds runs in idle time, never inside
// init(): the intro is playing while the modules initialise.
const idle = (fn, timeout) =>
  typeof requestIdleCallback === 'function'
    ? requestIdleCallback(fn, { timeout })
    : setTimeout(fn, 16)

function createOcean(ctx, canvas) {
  const { gsap } = ctx
  const params = new URLSearchParams(location.search)
  const adaptive = !params.has('hq')

  // The GL context and renderer are created later, in build().
  let renderer = null
  let live = false // drawing (or the CSS fallback is up)
  let disposed = false
  let fbTick = null

  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const quad = new PlaneGeometry(2, 2)

  // ---- sizes / quality
  const mobile = ctx.isMobile()
  // Phones: lower pixel ratio (soft light and motes survive it well) and a
  // light pass of ~95k px against ~390k on a 1440×900 laptop.
  let pr = Math.min(ctx.dpr, mobile ? 1.25 : 1.5)
  let lightScale = mobile ? 0.6 : 0.55
  let W = window.innerWidth
  let H = window.innerHeight
  let stableVh = H

  // ---- the sun. Under water it sits 30° from vertical (refracted from a
  // sun ~42° above the horizon), ahead of us and off to the left.
  const TH = 30 * DEG
  const AZ = -22 * DEG
  const sunW = new Vector3(-Math.sin(TH) * Math.sin(AZ), Math.cos(TH), Math.sin(TH) * Math.cos(AZ))
  const thA = Math.asin(Math.min(0.999, 1.333 * Math.sin(TH)))
  const sunA = new Vector3(-Math.sin(thA) * Math.sin(AZ), Math.cos(thA), Math.sin(thA) * Math.cos(AZ))
  const TAN_FOV = Math.tan(36 * DEG)

  // ---- a layer boundary passing through the view (shared by every pass):
  // x centre (ndc y), y amount, z travel direction (+1 = up), w sunlit
  const band = new Vector4(0, 0, 1, 0)
  const bandCol = new Vector3(0.42, 0.97, 0.91)

  // ---- light pass
  const lightRT = new WebGLRenderTarget(2, 2, {
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
  })
  const lightU = {
    uAspect: { value: W / H },
    uTime: { value: 0 },
    uAmt: { value: 1 },
    uPitch: { value: 26 * DEG },
    uYaw: { value: 0 },
    uTanFov: { value: TAN_FOV },
    uH: { value: 3 },
    uHK: { value: 0.3 },
    uSunW: { value: sunW },
    uSunA: { value: sunA },
    uVP: { value: new Vector2(0, 1.2) },
    uRayFreq: { value: 1 },
    uRays: { value: 1 },
    uWin: { value: 1 },
    uStir: { value: 0 },
    uBand: { value: band },
    uBandCol: { value: bandCol },
  }
  const lightScene = new Scene()
  const lightMesh = new Mesh(
    quad,
    new ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: LIGHT_FRAG,
      uniforms: lightU,
      depthTest: false,
      depthWrite: false,
      blending: NoBlending,
    }),
  )
  lightMesh.frustumCulled = false
  lightScene.add(lightMesh)

  // ---- main scene: composite + snow + sparks
  const scene = new Scene()
  const compU = {
    uTex: { value: lightRT.texture },
    uTime: { value: 0 },
    uAspect: lightU.uAspect,
    uBand: lightU.uBand,
  }
  const comp = new Mesh(
    quad,
    new ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: COMPOSITE_FRAG,
      uniforms: compU,
      depthTest: false,
      depthWrite: false,
      blending: NoBlending,
    }),
  )
  comp.frustumCulled = false
  comp.renderOrder = 0
  scene.add(comp)

  // marine snow
  const SNOW = mobile ? 1300 : 3400
  const snowPos = new Float32Array(SNOW * 3)
  const snowRand = new Float32Array(SNOW * 4)
  for (let i = 0; i < SNOW; i++) {
    const near = Math.pow(Math.random(), 3.4)
    snowPos[i * 3] = Math.random()
    snowPos[i * 3 + 1] = Math.random()
    snowPos[i * 3 + 2] = 1 - near
    for (let k = 0; k < 4; k++) snowRand[i * 4 + k] = Math.random()
  }
  const snowGeo = new BufferGeometry()
  snowGeo.setAttribute('position', new BufferAttribute(snowPos, 3))
  snowGeo.setAttribute('aRand', new BufferAttribute(snowRand, 4))
  const snowU = {
    uTime: { value: 0 },
    uFlow: { value: 0 },
    uVel: { value: 0 },
    uPR: { value: pr },
    uAspect: { value: W / H },
    uAmt: { value: 1 },
    uLight: { value: 1 },
    uRayFreq: lightU.uRayFreq,
    uScale: { value: 1 },
    uVP: lightU.uVP,
    uMouse: { value: new Vector2(9, 9) },
    uMouseAmt: { value: 0 },
    uSonar: { value: new Vector4(0, 0, -99, 0) },
    uCol: { value: new Vector3(0.84, 0.97, 1) },
    uBand: lightU.uBand,
    uBandCol: lightU.uBandCol,
  }
  const snow = new Points(
    snowGeo,
    new ShaderMaterial({
      vertexShader: SNOW_VERT,
      fragmentShader: SNOW_FRAG,
      uniforms: snowU,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: AdditiveBlending,
    }),
  )
  snow.frustumCulled = false
  snow.renderOrder = 2
  scene.add(snow)

  // bioluminescent sparks (solo flashes + a few chains)
  const CHAINS = mobile ? 3 : 7
  const CHAIN_LEN = 12
  const SOLO = mobile ? 90 : 200
  const SPARKS = SOLO + CHAINS * CHAIN_LEN
  const spPos = new Float32Array(SPARKS * 3)
  const spRand = new Float32Array(SPARKS * 4)
  const spChain = new Float32Array(SPARKS * 4)
  for (let i = 0; i < SPARKS; i++) {
    for (let k = 0; k < 4; k++) spRand[i * 4 + k] = Math.random()
    if (i >= SOLO) {
      const c = Math.floor((i - SOLO) / CHAIN_LEN)
      spChain[i * 4] = 1 + c * 3.17
      spChain[i * 4 + 1] = (i - SOLO) % CHAIN_LEN
      spChain[i * 4 + 2] = CHAIN_LEN
    }
  }
  // chain members must share a period exactly
  for (let c = 0; c < CHAINS; c++) {
    const p = Math.random()
    for (let j = 0; j < CHAIN_LEN; j++) spRand[(SOLO + c * CHAIN_LEN + j) * 4] = p
  }
  const sparkGeo = new BufferGeometry()
  sparkGeo.setAttribute('position', new BufferAttribute(spPos, 3))
  sparkGeo.setAttribute('aRand', new BufferAttribute(spRand, 4))
  sparkGeo.setAttribute('aChain', new BufferAttribute(spChain, 4))
  const sparkU = {
    uTime: snowU.uTime,
    uFlow: snowU.uFlow,
    uPR: snowU.uPR,
    uAspect: snowU.uAspect,
    uAmt: { value: 0 },
    uScale: snowU.uScale,
    uHadal: { value: 0 },
    uColA: { value: new Vector3(0.42, 0.97, 0.91) }, // --c-photophore
    uColB: { value: new Vector3(0.23, 0.66, 1.0) }, // --c-photophore-2
    uColR: { value: new Vector3(1.0, 0.3, 0.24) }, // toward --c-redlight
  }
  const sparks = new Points(
    sparkGeo,
    new ShaderMaterial({
      vertexShader: SPARK_VERT,
      fragmentShader: SPARK_FRAG,
      uniforms: sparkU,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: AdditiveBlending,
    }),
  )
  sparks.frustumCulled = false
  sparks.renderOrder = 3
  scene.add(sparks)

  // stimulated plankton glints (descent blooms + passing layers)
  const GLINTS = mobile ? 230 : 520
  const glRand = new Float32Array(GLINTS * 4)
  for (let i = 0; i < GLINTS * 4; i++) glRand[i] = Math.random()
  const glintGeo = new BufferGeometry()
  glintGeo.setAttribute('position', new BufferAttribute(new Float32Array(GLINTS * 3), 3))
  glintGeo.setAttribute('aRand', new BufferAttribute(glRand, 4))
  const glintU = {
    uTime: snowU.uTime,
    uFlow: snowU.uFlow,
    uVel: snowU.uVel,
    uPR: snowU.uPR,
    uAspect: snowU.uAspect,
    uScale: snowU.uScale,
    uBloom: { value: 0 },
    uHadal: sparkU.uHadal,
    uBand: lightU.uBand,
    uBandCol: lightU.uBandCol,
    uColA: sparkU.uColA,
    uColB: sparkU.uColB,
    uColR: sparkU.uColR,
  }
  const glints = new Points(
    glintGeo,
    new ShaderMaterial({
      vertexShader: GLINT_VERT,
      fragmentShader: GLINT_FRAG,
      uniforms: glintU,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: AdditiveBlending,
    }),
  )
  glints.frustumCulled = false
  glints.renderOrder = 4
  scene.add(glints)

  // sun glitter in Snell's window
  const GLITTER = mobile ? 70 : 170
  const gtRand = new Float32Array(GLITTER * 4)
  for (let i = 0; i < GLITTER * 4; i++) gtRand[i] = Math.random()
  const glitterGeo = new BufferGeometry()
  glitterGeo.setAttribute('position', new BufferAttribute(new Float32Array(GLITTER * 3), 3))
  glitterGeo.setAttribute('aRand', new BufferAttribute(gtRand, 4))
  const glitterU = {
    uTime: snowU.uTime,
    uPR: snowU.uPR,
    uAspect: snowU.uAspect,
    uAmt: { value: 0 },
    uScale: snowU.uScale,
    uPitch: lightU.uPitch,
    uYaw: lightU.uYaw,
    uTanFov: lightU.uTanFov,
    uSunW: lightU.uSunW,
    uVP: lightU.uVP,
  }
  const glitter = new Points(
    glitterGeo,
    new ShaderMaterial({
      vertexShader: GLITTER_VERT,
      fragmentShader: GLITTER_FRAG,
      uniforms: glitterU,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: AdditiveBlending,
    }),
  )
  glitter.frustumCulled = false
  glitter.renderOrder = 1
  scene.add(glitter)

  // ---- atmosphere (plain DOM, works without WebGL too). A vignette in the
  // water's own colour that closes in as you sink, and a darker water column
  // below you near the surface: both sit UNDER the content (between this
  // canvas and <main>), so they deepen the water and never dim the text.
  // Over everything but the instruments: a fine, slow film grain.
  const atmos = document.createElement('div')
  atmos.className = 'ocean-atmos'
  atmos.setAttribute('aria-hidden', 'true')
  const vigEl = document.createElement('div')
  vigEl.className = 'ocean-atmos__vig'
  const floorEl = document.createElement('div')
  floorEl.className = 'ocean-atmos__floor'
  atmos.append(vigEl, floorEl)
  canvas.after(atmos)
  const grainEl = document.createElement('div')
  grainEl.className = 'ocean-grain' + (ctx.reducedMotion ? ' is-still' : '')
  grainEl.setAttribute('aria-hidden', 'true')
  atmos.after(grainEl)
  let grainUrl = ''
  let lastVig = ''
  let lastFloor = ''
  function atmosAt(depth) {
    const f = clamp(Math.log1p(depth / 60) / Math.log1p(6000 / 60))
    const v = (0.42 + 0.58 * f).toFixed(2)
    const fl = (1 - 0.6 * f).toFixed(2)
    if (v !== lastVig) vigEl.style.opacity = lastVig = v
    if (fl !== lastFloor) floorEl.style.opacity = lastFloor = fl
  }
  // a small tile of soft, roughly gaussian monochrome noise
  function makeGrain() {
    if (disposed) return
    try {
      const S = 128
      const c = document.createElement('canvas')
      c.width = c.height = S
      const g = c.getContext('2d')
      const im = g.createImageData(S, S)
      const d = im.data
      for (let i = 0; i < S * S; i++) {
        const n = (Math.random() + Math.random() + Math.random()) / 3 - 0.5
        const v = Math.max(0, Math.min(255, Math.round(128 + n * 420)))
        d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v
        d[i * 4 + 3] = 255
      }
      g.putImageData(im, 0, 0)
      const apply = (url) => {
        if (disposed) return
        grainUrl = url
        grainEl.style.backgroundImage = `url("${url}")`
        grainEl.classList.add('is-ready')
      }
      if (c.toBlob) c.toBlob((b) => b && apply(URL.createObjectURL(b)))
      else apply(c.toDataURL())
    } catch {
      /* no grain: fine */
    }
  }

  // ---- sizing
  function resize(force = false) {
    const w = window.innerWidth
    const h = window.innerHeight
    // Mobile URL bars resize the viewport while scrolling: on touch devices
    // ignore small height-only changes (the canvas is stretched by CSS
    // meanwhile). A desktop window always gets an exact backing store.
    if (!force && w === W && h === H) return
    if (!force && w === W && ctx.isTouch && Math.abs(h - H) < 120) return
    if (w !== W || !ctx.isTouch || Math.abs(h - stableVh) > 120) stableVh = h
    W = w
    H = h
    lightU.uAspect.value = W / H
    snowU.uAspect.value = W / H
    snowU.uPR.value = pr
    // keep particle sizes sensible on very small / very large screens
    snowU.uScale.value = clamp(Math.sqrt((W * H) / (1440 * 900)), 0.75, 1.25)
    dirty = true
    if (!renderer) return
    renderer.setPixelRatio(pr)
    renderer.setSize(W, H, false)
    lightRT.setSize(Math.max(2, Math.round(W * lightScale)), Math.max(2, Math.round(H * lightScale)))
  }

  // ---- input
  const mouse = new Vector2(9, 9)
  let mouseTarget = 0
  let movedAt = 0
  const fine = !ctx.isTouch && !ctx.reducedMotion
  const onMove = (e) => {
    mouse.set((e.clientX / W) * 2 - 1, 1 - (e.clientY / H) * 2)
    mouseTarget = 1
    movedAt = performance.now()
  }
  const onLeave = () => (mouseTarget = 0)
  if (fine) {
    window.addEventListener('pointermove', onMove, { passive: true })
    document.documentElement.addEventListener('pointerleave', onLeave)
  }

  const offSonar = ctx.on('sonar', (detail = {}) => {
    const x = typeof detail.x === 'number' ? (detail.x / W) * 2 - 1 : 0
    const y = typeof detail.y === 'number' ? 1 - (detail.y / H) * 2 : 0
    snowU.uSonar.value.set(x, y, time, clamp(detail.strength ?? 1, 0, 2))
    dirty = true
  })

  // ---- covered: nothing of the water can be seen, so nothing is drawn.
  // A section can say so on the bus (`ocean:cover`, { on }). The creatures'
  // stage also tells us through the darkness it eases in: while its --dark
  // is full and it has no soft edges on screen, it blacks out the viewport.
  let busCover = false
  const offCover = ctx.on('ocean:cover', (d = {}) => {
    busCover = !!d.on
    dirty = true
  })
  let lifeStage = null
  function blackedOut() {
    if (busCover) return true
    if (depthState.section !== 'life') return false
    lifeStage ??= document.querySelector('#life.is-float .creatures__stage')
    if (!lifeStage) return false
    const st = lifeStage.style
    return (
      parseFloat(st.getPropertyValue('--dark')) >= 0.995 &&
      parseFloat(st.getPropertyValue('--edge')) === 0 &&
      parseFloat(st.getPropertyValue('--edge-b')) === 0
    )
  }

  // ---- state
  let time = ctx.reducedMotion ? 14 : 0
  let last = performance.now()
  let lastY = window.scrollY
  let vel = 0
  let dirty = true
  let drawnY = -1
  let frame = 0
  // intro: light 0 → 1; stir: freshly flooded water, 1 → 0; rush: extra
  // upward flow of the snow (screens) as we go under
  const fx = { intro: ctx.reducedMotion ? 1 : 0, stir: 0, rush: 0 }
  let lastRush = 0
  let lastDepth = -1
  const depthState = { depth: 0, sun: 1, hadal: 0, section: null }

  // ---- layer crossings. Each zone boundary is a real change of water mass
  // (the thermocline under the mixed layer at ~200 m, the colder deep water
  // below 1,000 m, …). Cross one and a sheet of that layer sweeps through
  // the view over ~1.5 s: up the screen on the way down, down it on the way
  // up. Colour by boundary: sunlit glimmer at 200 m, living blue-green and
  // then blue below, and the first red of the observation lamps at 6,000 m.
  const BAND_COL = [null, [0.58, 0.98, 0.96], [0.42, 0.97, 0.91], [0.3, 0.7, 1.0], [1.0, 0.34, 0.27]]
  const bandFx = { p: 1, on: false, dir: 1, sunlit: 0, amp: 1 }
  let bloom = 0
  let zoneIdx = -1
  let bandsArmed = false
  // not on load, deep links or layout re-aims: only once the visitor dives
  ctx.ready.then(() => gsap.delayedCall(0.8, () => (bandsArmed = true)))
  function crossLayer(dir, b) {
    if (ctx.reducedMotion || !renderer || !bandsArmed) return
    // a quick run through several layers (a nav jump) shows one sweep
    if (bandFx.on && bandFx.p < 0.72) return
    const c = BAND_COL[b] || BAND_COL[2]
    bandCol.set(c[0], c[1], c[2])
    bandFx.dir = dir
    bandFx.sunlit = b === 1 ? Math.pow(clamp(depthState.sun), 1.15) * fx.intro : 0
    bandFx.amp = b === 1 ? 1 : 0.92
    bandFx.on = true
    gsap.killTweensOf(bandFx)
    gsap.fromTo(
      bandFx,
      { p: 0 },
      { p: 1, duration: 1.55, ease: 'none', onComplete: () => (bandFx.on = false) },
    )
    dirty = true
  }

  const offDepth = ctx.depth.onChange((s) => {
    const zi = s.zone ? ctx.depth.ZONES.findIndex((z) => z.id === s.zone.id) : -1
    if (zoneIdx >= 0 && zi >= 0 && zi !== zoneIdx && Math.abs(s.depth - lastDepth) < 1500) {
      crossLayer(zi > zoneIdx ? 1 : -1, Math.max(zi, zoneIdx))
    }
    zoneIdx = zi
    depthState.depth = s.depth
    depthState.sun = s.sun
    depthState.hadal = s.hadal
    depthState.section = s.section
    if (Math.abs(s.depth - lastDepth) > 0.01) dirty = true
    lastDepth = s.depth
    atmosAt(s.depth)
  })

  // The light comes up with the flood (or, without the loader, as the page
  // hands over). Whichever arrives first wins; the rest are no-ops. Until
  // the flood the loader's black panel covers the page: nothing is drawn.
  let veiled = !ctx.skipIntro && !!document.querySelector('.loader')
  let pendingRaise = null
  function doRaise(flood) {
    pendingRaise = null
    if (!flood) {
      gsap.to(fx, { intro: 1, duration: 3.2, ease: 'power2.out' })
      return
    }
    // the waterline takes 1.2 s to cross the screen (loader T.floodDur)
    gsap.to(fx, { intro: 1, duration: 1.5, ease: 'power2.out', delay: 0.05 })
    gsap.fromTo(fx, { stir: 1 }, { stir: 0, duration: 3.4, ease: 'power2.out' })
    gsap.to(fx, { rush: 0.34, duration: 2.2, ease: 'power3.out' })
  }
  let offFlood = null
  let floodObs = null
  if (!ctx.reducedMotion) {
    let raised = false
    const raise = (flood) => {
      veiled = false
      if (raised) return
      raised = true
      offFlood?.()
      floodObs?.disconnect()
      // not drawing yet (a slow device): rise as soon as it can
      if (live) doRaise(flood)
      else pendingRaise = flood
    }
    offFlood = ctx.on('intro:flood', () => raise(true))
    const loaderEl = ctx.skipIntro ? null : document.querySelector('.loader')
    if (loaderEl && typeof MutationObserver !== 'undefined') {
      floodObs = new MutationObserver(() => {
        if (loaderEl.classList.contains('is-exiting')) raise(true)
      })
      floodObs.observe(loaderEl, { attributes: true, attributeFilter: ['class'] })
    }
    ctx.ready.then(() => raise(false))
  } else {
    veiled = false
  }

  // ---- adaptive quality (skipped with ?hq). Measured only once the page
  // has settled after the intro; a window counts as slow when most of its
  // frames are, so one-off hitches never cost quality.
  let perfFrames = 0
  let slowFrames = 0
  let downgrades = 0
  let measuring = false
  ctx.ready.then(() => gsap.delayedCall(1.5, () => (measuring = true)))
  function adapt(dt) {
    if (!adaptive || !measuring || downgrades >= 2) return
    perfFrames++
    if (dt > 0.026) slowFrames++
    if (perfFrames < 120) return
    const slow = slowFrames / perfFrames > 0.6
    perfFrames = 0
    slowFrames = 0
    if (slow) {
      downgrades++
      lightScale = Math.max(0.35, lightScale * 0.72)
      pr = Math.max(1, pr * 0.8)
      snowGeo.setDrawRange(0, Math.round(SNOW * (downgrades === 1 ? 0.7 : 0.5)))
      resize(true)
    }
  }

  function project(dir, pitch, yaw) {
    // undo the yaw, then project through the pitched camera
    const cy = Math.cos(yaw)
    const sy = Math.sin(yaw)
    const x = dir.x * cy - dir.z * sy
    const z = dir.x * sy + dir.z * cy
    const s = Math.sin(pitch)
    const c = Math.cos(pitch)
    const zc = Math.max(dir.y * s + z * c, 0.06)
    const yc = dir.y * c - z * s
    return [x / (zc * TAN_FOV), yc / (zc * TAN_FOV)]
  }

  // a slow, heavy look-around: the camera leans toward the pointer
  const look = { x: 0, y: 0 }

  function update(dt) {
    const y = window.scrollY
    const { depth, sun, hadal } = depthState

    // how far we have left the surface: the first screen of scroll, then depth
    const hScroll = smooth(0, 1, y / stableVh)
    const fDepth = Math.log1p(depth / 25) / Math.log1p(1000 / 25)
    const rise = clamp(0.3 * hScroll + 0.7 * clamp(fDepth))

    const lk = 1 - Math.exp(-dt * 1.6)
    const mOn = snowU.uMouseAmt.value
    look.x += (mouse.x * mOn - look.x) * lk
    look.y += (mouse.y * mOn - look.y) * lk
    const yaw = look.x * 4.5 * DEG
    const pitch = (lerp(20.5, 3, Math.pow(rise, 0.85)) + look.y * 1.8) * DEG
    lightU.uPitch.value = pitch
    lightU.uYaw.value = yaw
    lightU.uH.value = lerp(4.2, 12, rise * rise)
    lightU.uHK.value = lerp(0.24, 2.6, Math.pow(rise, 1.6))
    const [vx, vy] = project(sunW, pitch, yaw)
    lightU.uVP.value.set(vx, vy)
    lightU.uRayFreq.value = clamp(Math.hypot(vx, vy) / 1.35, 0.85, 3)
    const sunAmt = Math.pow(clamp(sun), 1.15)
    lightU.uWin.value = 1 - smooth(0.55, 1, rise)
    lightU.uRays.value = lerp(1, 0.7, rise)
    lightU.uAmt.value = sunAmt * fx.intro
    lightU.uStir.value = fx.stir
    lightU.uTime.value = time
    compU.uTime.value = time

    // descent velocity in screens / second, smoothed
    if (!ctx.reducedMotion) {
      const dRush = fx.rush - lastRush
      lastRush = fx.rush
      // an instant jump (deep link, layout re-aim) is not a descent: no
      // streaking snow, no bloom
      const jumped = Math.abs(y - lastY) > stableVh * 1.5
      const v = jumped ? vel : clamp(((y - lastY) / stableVh + dRush) / Math.max(dt, 1 / 240), -10, 10)
      vel += (v - vel) * (1 - Math.exp(-dt * 7))
      snowU.uFlow.value = y / stableVh + fx.rush
    }
    lastY = y
    snowU.uVel.value = ctx.reducedMotion ? 0 : vel
    snowU.uTime.value = time

    // snow colour: sunlit motes near the top, lamp-lit grey-blue below,
    // red under the observation lamps in the hadal zone
    const c = snowU.uCol.value
    const lamp = [0.6, 0.74, 0.84]
    const lit = [0.86, 0.98, 1.0]
    const red = [1.0, 0.42, 0.36]
    c.set(
      lerp(lerp(lamp[0], lit[0], sun), red[0], hadal * 0.8),
      lerp(lerp(lamp[1], lit[1], sun), red[1], hadal * 0.8),
      lerp(lerp(lamp[2], lit[2], sun), red[2], hadal * 0.8),
    )
    snowU.uAmt.value = lerp(0.62, 1, sun) * lerp(0.35, 1, fx.intro)
    snowU.uLight.value = sunAmt * fx.intro

    mouseTarget = fine ? mouseTarget : 0
    snowU.uMouse.value.lerp(mouse, 1 - Math.exp(-dt * 6))
    snowU.uMouseAmt.value += (mouseTarget - snowU.uMouseAmt.value) * (1 - Math.exp(-dt * 3))

    // sun glitter lives in Snell's window
    glitterU.uAmt.value = sunAmt * fx.intro * lightU.uWin.value

    // a layer sweeping through the view (sine in-out, fading at both ends)
    if (bandFx.on) {
      const p = bandFx.p
      const e = 0.5 - 0.5 * Math.cos(Math.PI * p)
      band.set(lerp(-1.45, 1.45, e) * bandFx.dir, bandFx.amp * Math.pow(Math.sin(Math.PI * p), 0.65), bandFx.dir, bandFx.sunlit)
    } else band.y = 0

    // the descent lights the water: below the sunlight, speed stirs up
    // flashes from the plankton (fast to answer, slow to settle)
    const tgt = ctx.reducedMotion ? 0 : smooth(200, 520, depth) * smooth(0.12, 1.9, Math.abs(vel))
    bloom += (tgt - bloom) * (1 - Math.exp(-dt * (tgt > bloom ? 5 : 1.3)))
    if (bloom < 0.001) bloom = 0
    glintU.uBloom.value = bloom

    sparkU.uAmt.value = smooth(160, 520, depth) * 1.4 * (1 + 0.7 * bloom)
    sparkU.uHadal.value = hadal
  }

  function render(warm = false) {
    const lightOn = warm || lightU.uAmt.value > 0.004 || band.y > 0.002
    if (lightOn) {
      renderer.setRenderTarget(lightRT)
      renderer.render(lightScene, camera)
    }
    comp.visible = lightOn
    glitter.visible = warm || glitterU.uAmt.value > 0.01
    glints.visible = warm || bloom > 0.003 || band.y > 0.002
    sparks.visible = warm || sparkU.uAmt.value > 0.002
    renderer.setRenderTarget(null)
    renderer.clear(true, false, false)
    renderer.render(scene, camera)
  }

  function tick() {
    if (document.hidden) return
    const now = performance.now()
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    if (ctx.reducedMotion) {
      // Static water: only redraw when the depth, the size or the scroll
      // through the first screen (which tilts the view away from the sun)
      // changed.
      const sy = window.scrollY
      if (!dirty && (sy > stableVh * 1.05 || Math.abs(sy - drawnY) < 2)) return
      if (blackedOut()) return
      dirty = false
      drawnY = sy
      update(1 / 60)
      render()
      return
    }
    time += dt
    update(dt)
    // under the loader's black panel, or blacked out by a section
    if (veiled || blackedOut()) return
    // Deep, still water (no sunlight, no descent, no pointer, no ping):
    // the snow drifts at a few pixels a second and the sparks fade slowly,
    // so every other frame (30 fps) reads the same and costs half.
    const still =
      lightU.uAmt.value <= 0.004 &&
      Math.abs(vel) < 0.02 &&
      bloom < 0.003 &&
      !bandFx.on &&
      now - movedAt > 800 &&
      time - snowU.uSonar.value.z > 6
    frame++
    if (still && frame % 2) return
    render()
    adapt(dt)
  }

  const onVis = () => {
    last = performance.now()
    lastY = window.scrollY
    dirty = true
  }
  let resizeRaf = 0
  const onResize = () => {
    cancelAnimationFrame(resizeRaf)
    resizeRaf = requestAnimationFrame(() => resize(false))
  }
  document.addEventListener('visibilitychange', onVis)
  window.addEventListener('resize', onResize)

  /* ---------------------------------------------------- build, off init */
  // 1. the context and the renderer; 2. the shaders, compiled in parallel
  //    where the browser can (KHR_parallel_shader_compile); 3. one warm-up
  //    frame (buffer uploads, the light target), still under the loader.
  //    Each step in its own idle slot, so the intro never drops a frame.
  function build() {
    if (disposed) return
    // Create the context ourselves so a missing WebGL2 never logs an error.
    let gl = null
    try {
      gl = canvas.getContext('webgl2', {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance',
      })
    } catch {
      gl = null
    }
    if (!gl) {
      startFallback()
      return
    }
    renderer = new WebGLRenderer({ canvas, context: gl, antialias: false })
    renderer.autoClear = false
    renderer.setClearColor(0x000000, 1)
    canvas.addEventListener('webglcontextlost', (e) => e.preventDefault(), false)
    resize(true)
    idle(compile, 400)
  }

  function compile() {
    if (disposed) return
    let pending
    try {
      // Parallel compile only where the driver supports it; otherwise
      // compileAsync just warns and compiles synchronously anyway.
      const parallel = renderer.extensions.has('KHR_parallel_shader_compile')
      const comp = (sc) => (parallel ? renderer.compileAsync(sc, camera) : (renderer.compile(sc, camera), Promise.resolve()))
      // the light pass draws into its target: compile it for that target
      renderer.setRenderTarget(lightRT)
      const a = comp(lightScene)
      renderer.setRenderTarget(null)
      pending = Promise.all([a, comp(scene)])
    } catch {
      pending = Promise.resolve()
    }
    pending.catch(() => {}).then(() => idle(goLive, 300))
  }

  function goLive() {
    if (disposed || live) return
    update(1 / 60)
    render(true)
    live = true
    dirty = true
    last = performance.now()
    lastY = window.scrollY
    gsap.ticker.add(tick)
    if (pendingRaise !== null) doRaise(pendingRaise)
  }

  // ---- no WebGL2: the opening screen keeps its light. ocean.css paints a
  // soft Snell's window and a few still shafts on the (context-less) canvas;
  // here it fades with the sunlight and recedes upward as you leave the
  // surface, like the real one. Opacity and a transform only: no repaints.
  function startFallback() {
    document.documentElement.classList.add('no-webgl')
    let lastO = ''
    let lastT = ''
    fbTick = () => {
      const hScroll = smooth(0, 1, window.scrollY / stableVh)
      const o = (Math.pow(clamp(depthState.sun), 1.15) * fx.intro * (1 - 0.5 * hScroll)).toFixed(3)
      const t = `translate3d(0, ${Math.round(-0.2 * hScroll * H)}px, 0)`
      if (o !== lastO) canvas.style.opacity = lastO = o
      if (t !== lastT) canvas.style.transform = lastT = t
    }
    fbTick()
    gsap.ticker.add(fbTick)
    live = true
    if (pendingRaise !== null) doRaise(pendingRaise)
  }

  idle(build, 500)
  // the grain arrives with the page, never during the intro's first frames
  ctx.ready.then(() => idle(makeGrain, 1200))

  return () => {
    disposed = true
    gsap.killTweensOf(bandFx)
    atmos.remove()
    grainEl.remove()
    if (grainUrl.startsWith('blob:')) URL.revokeObjectURL(grainUrl)
    gsap.ticker.remove(tick)
    if (fbTick) gsap.ticker.remove(fbTick)
    cancelAnimationFrame(resizeRaf)
    offSonar?.()
    offCover?.()
    offDepth?.()
    offFlood?.()
    floodObs?.disconnect()
    window.removeEventListener('resize', onResize)
    document.removeEventListener('visibilitychange', onVis)
    window.removeEventListener('pointermove', onMove)
    document.documentElement.removeEventListener('pointerleave', onLeave)
    renderer?.dispose()
    lightRT.dispose()
  }
}
