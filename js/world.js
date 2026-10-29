// A small glass world: floating refractive forms over a mirror sea at dusk.
// createWorld(canvas, options) renders it and returns a handle for scroll, pointer and pause.
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const PALETTE = {
  skyTop: '#10293b',
  horizon: '#2b6078',
  sun: '#f2b66d',
  iris: '#b9a7ff',
  aqua: '#9fe8e0',
  ice: '#e4f6ff',
};

const SUN_DIRECTION = new THREE.Vector3(0.5, 0.16, -1).normalize();
const EXPOSURE = 0.8;
const FOG_NEAR = 12;
const FOG_FAR = 70;

// Camera keyframes: scrolling the page drifts the camera from A to B.
const CAMERA_A = { pos: new THREE.Vector3(0, 1.9, 14.5), look: new THREE.Vector3(0.4, 1.7, -1.5) };
const CAMERA_B = { pos: new THREE.Vector3(0.6, 2.7, -11.5), look: new THREE.Vector3(0, 1.3, -29) };

// Each form: geometry recipe, base position, fixed orientation, tint, spin speed per axis,
// drift [amplitude, speed, phase], optional scale and glass thickness. "core" forms are the
// ones kept on the light tier.
const FORMS = [
  { geo: ['sphere', 2.2, 64, 48], pos: [2.4, 2.4, 0.6], rot: [0.1, 0.2, 0.12], scale: [1, 1, 0.38], tint: PALETTE.ice, spin: [0, 0.14, 0], drift: [0.22, 0.32, 0.0], thick: 1.2, core: true },
  { geo: ['torus', 1.5, 0.16, 24, 96], pos: [-4.6, 2.9, -3.0], rot: [1.1, 0.3, 0], tint: PALETTE.aqua, spin: [0.12, 0.08, 0], drift: [0.3, 0.26, 1.2], core: true },
  { geo: ['torus', 1.0, 0.12, 20, 80], pos: [5.6, 1.4, -9.0], rot: [0.6, 0, 0.4], tint: PALETTE.iris, spin: [0.06, 0.18, 0], drift: [0.25, 0.4, 2.1], core: true },
  { geo: ['torus', 2.1, 0.2, 24, 110], pos: [-2.0, 3.8, -18.0], rot: [1.4, 0.2, 0], tint: PALETTE.ice, spin: [0.05, 0.1, 0.03], drift: [0.35, 0.22, 0.4], core: false },
  { geo: ['cylinder', 0.45, 0.45, 2.0, 3], pos: [-3.4, 1.3, 0.2], rot: [0.4, 0, 0.5], tint: PALETTE.ice, spin: [0, 0.3, 0.05], drift: [0.18, 0.5, 0.8], core: true },
  { geo: ['cylinder', 0.5, 0.5, 2.2, 3], pos: [1.5, 3.5, -5.5], rot: [0.9, 0.2, -0.4], tint: PALETTE.iris, spin: [0.08, 0.22, 0], drift: [0.28, 0.33, 2.6], core: true },
  { geo: ['cylinder', 0.6, 0.6, 2.8, 3], pos: [-6.2, 1.9, -12.0], rot: [0.2, 0, 0.9], tint: PALETTE.aqua, spin: [0.05, 0.26, 0.04], drift: [0.3, 0.3, 1.7], core: false },
  { geo: ['cylinder', 0.45, 0.45, 2.0, 3], pos: [4.2, 2.7, -16.0], rot: [1.2, 0.4, 0], tint: PALETTE.ice, spin: [0.1, 0.2, 0], drift: [0.22, 0.42, 3.3], core: false },
  { geo: ['octahedron', 0.75, 0], pos: [-1.0, 2.5, -1.6], rot: [0.3, 0.6, 0.2], tint: PALETTE.aqua, spin: [0.15, 0.2, 0.1], drift: [0.2, 0.55, 0.3], core: true },
  { geo: ['octahedron', 0.9, 0], pos: [6.8, 3.3, -4.2], rot: [0.5, 0.1, 0.4], tint: PALETTE.ice, spin: [0.1, 0.24, 0.05], drift: [0.3, 0.3, 1.1], core: true },
  { geo: ['icosahedron', 0.6, 0], pos: [2.6, 1.0, -11.5], rot: [0, 0.4, 0.3], tint: PALETTE.iris, spin: [0.2, 0.12, 0.08], drift: [0.2, 0.47, 2.0], core: false },
  { geo: ['icosahedron', 0.8, 0], pos: [-4.2, 4.3, -22.0], rot: [0.2, 0.2, 0.6], tint: PALETTE.aqua, spin: [0.12, 0.16, 0.1], drift: [0.35, 0.28, 0.9], core: false },
  { geo: ['sphere', 0.62, 48, 32], pos: [0.7, 1.6, -7.6], rot: [0, 0, 0], tint: PALETTE.ice, spin: [0, 0.1, 0], drift: [0.25, 0.38, 1.5], core: true },
  { geo: ['sphere', 0.5, 48, 32], pos: [-7.2, 3.0, -7.0], rot: [0, 0, 0], tint: PALETTE.iris, spin: [0, 0.1, 0], drift: [0.2, 0.44, 2.8], core: false },
  { geo: ['box', 0.9, 3.2, 0.22], pos: [-3.9, 2.0, -26.0], rot: [0, 0.5, 0.05], tint: PALETTE.ice, spin: [0, 0.09, 0], drift: [0.25, 0.25, 0.6], core: true },
  { geo: ['box', 1.1, 2.6, 0.22], pos: [7.2, 2.1, -20.0], rot: [0, -0.6, -0.04], tint: PALETTE.aqua, spin: [0, 0.07, 0], drift: [0.2, 0.3, 1.9], core: false },
];

const LANTERNS = [
  [1.2, 1.3, 2.6],
  [-3.4, 3.9, -1.2],
  [4.4, 0.9, -6.5],
  [-1.4, 2.2, -13.5],
  [6.0, 3.9, -12.0],
  [-5.6, 1.1, -19.0],
];

const SKY_VERTEX = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAGMENT = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uSun;
  uniform vec3 uSunDirection;
  varying vec3 vDirection;
  void main() {
    vec3 d = normalize(vDirection);
    float band = smoothstep(-0.04, 0.45, d.y);
    vec3 color = mix(uHorizon, uTop, band);
    float s = max(dot(d, uSunDirection), 0.0);
    color += uSun * (pow(s, 1200.0) * 3.0 + pow(s, 12.0) * 0.18 + pow(s, 3.0) * 0.04);
    color = mix(color, uTop * 0.5, smoothstep(0.0, 0.35, -d.y));
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// The stock Reflector shader plus scene fog, so the sea fades into the horizon.
const SEA_SHADER = {
  name: 'GlassSeaShader',
  uniforms: THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null } },
  ]),
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    #include <common>
    #include <fog_pars_vertex>
    #include <logdepthbuf_pars_vertex>
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      #include <logdepthbuf_vertex>
      #include <fog_vertex>
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    varying vec4 vUv;
    #include <fog_pars_fragment>
    #include <logdepthbuf_pars_fragment>
    float blendOverlay(float base, float blend) {
      return base < 0.5 ? (2.0 * base * blend) : (1.0 - 2.0 * (1.0 - base) * (1.0 - blend));
    }
    vec3 blendOverlay(vec3 base, vec3 blend) {
      return vec3(blendOverlay(base.r, blend.r), blendOverlay(base.g, blend.g), blendOverlay(base.b, blend.b));
    }
    void main() {
      #include <logdepthbuf_fragment>
      vec4 base = texture2DProj(tDiffuse, vUv);
      gl_FragColor = vec4(blendOverlay(base.rgb, color), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
    }
  `,
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);

function buildGeometry([type, ...args]) {
  switch (type) {
    case 'cylinder':
      return new THREE.CylinderGeometry(...args);
    case 'torus':
      return new THREE.TorusGeometry(...args);
    case 'octahedron':
      return new THREE.OctahedronGeometry(...args);
    case 'icosahedron':
      return new THREE.IcosahedronGeometry(...args);
    case 'sphere':
      return new THREE.SphereGeometry(...args);
    case 'box':
      return new THREE.BoxGeometry(...args);
    default:
      throw new Error(`Unknown form geometry: ${type}`);
  }
}

function buildSkyMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color(PALETTE.skyTop) },
      uHorizon: { value: new THREE.Color(PALETTE.horizon) },
      uSun: { value: new THREE.Color(PALETTE.sun) },
      uSunDirection: { value: SUN_DIRECTION.clone() },
    },
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
  });
}

// Reflections come from the world's own dusk sky plus a few coloured light panels.
function buildEnvironment(renderer, skyMaterial) {
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMaterial));

  const addPanel = (color, intensity, width, height, position) => {
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(intensity),
      side: THREE.DoubleSide,
    });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    panel.position.set(...position);
    panel.lookAt(0, 0, 0);
    envScene.add(panel);
  };
  addPanel(PALETTE.sun, 8, 10, 4, [7, 6, -5]);
  addPanel(PALETTE.aqua, 4, 7, 7, [-9, 3, 1]);
  addPanel(PALETTE.iris, 2, 3, 12, [1, 4, 10]);
  addPanel('#ffffff', 6, 16, 2.5, [0, 10, 0]);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(envScene, 0.02).texture;
  pmrem.dispose();
  envScene.traverse((object) => {
    if (object.isMesh && object.material !== skyMaterial) {
      object.geometry.dispose();
      object.material.dispose();
    }
  });
  return texture;
}

function buildGlassMaterial(tint, quality, thickness = 0.8) {
  if (quality === 'high') {
    return new THREE.MeshPhysicalMaterial({
      color: tint,
      transmission: 1,
      thickness,
      ior: 1.45,
      roughness: 0.02,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      iridescence: 0.4,
      iridescenceIOR: 1.3,
      iridescenceThicknessRange: [120, 420],
      attenuationColor: new THREE.Color('#cdf3ff'),
      attenuationDistance: 8,
      specularIntensity: 1,
      envMapIntensity: 2.0,
    });
  }
  return new THREE.MeshPhysicalMaterial({
    color: tint,
    transparent: true,
    opacity: 0.42,
    roughness: 0.05,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    iridescence: 0.4,
    iridescenceIOR: 1.3,
    envMapIntensity: 1.6,
    depthWrite: false,
  });
}

function buildSea(quality) {
  const geometry = new THREE.PlaneGeometry(700, 700);
  let sea;
  if (quality === 'high') {
    sea = new Reflector(geometry, {
      clipBias: 0.003,
      textureWidth: 1024,
      textureHeight: 1024,
      color: 0x6f93a6,
      shader: SEA_SHADER,
    });
    sea.material.fog = true;
  } else {
    sea = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: 0x163646,
        roughness: 0.5,
        metalness: 0.7,
        envMapIntensity: 0.5,
      }),
    );
  }
  sea.rotation.x = -Math.PI / 2;
  return sea;
}

// A soft round sprite so the dust reads as glints rather than square points.
function buildSpriteTexture() {
  const size = 64;
  const sprite = document.createElement('canvas');
  sprite.width = size;
  sprite.height = size;
  const context = sprite.getContext('2d');
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.35, 'rgba(255, 255, 255, 0.6)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(sprite);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function buildParticles(count) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = (Math.random() - 0.5) * 70;
    positions[i * 3 + 1] = Math.random() * 16 + 0.2;
    positions[i * 3 + 2] = -65 + Math.random() * 90;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xdff3fb,
    map: buildSpriteTexture(),
    size: 0.12,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geometry, material);
}

export function createWorld(canvas, options = {}) {
  const quality = options.quality === 'low' ? 'low' : 'high';
  const adaptive = options.adaptive !== false;
  const onContextLost = options.onContextLost || (() => {});

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = EXPOSURE;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(new THREE.Color(PALETTE.horizon), FOG_NEAR, FOG_FAR);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);

  const skyMaterial = buildSkyMaterial();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), skyMaterial);
  sky.renderOrder = -1;
  scene.add(sky);

  scene.environment = buildEnvironment(renderer, skyMaterial);

  scene.add(new THREE.HemisphereLight(0x8fb7c9, 0x0b1f2e, 0.6));
  const sunLight = new THREE.DirectionalLight(PALETTE.sun, 2.2);
  sunLight.position.copy(SUN_DIRECTION).multiplyScalar(60);
  scene.add(sunLight);
  const lampA = new THREE.PointLight(PALETTE.sun, 40, 30, 2);
  lampA.position.set(1.2, 1.3, 2.6);
  const lampB = new THREE.PointLight(PALETTE.iris, 30, 30, 2);
  lampB.position.set(-3.4, 3.9, -1.2);
  scene.add(lampA, lampB);

  let sea = buildSea(quality);
  scene.add(sea);

  const forms = FORMS.filter((form) => quality === 'high' || form.core).map((form) => {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(
      buildGeometry(form.geo),
      buildGlassMaterial(form.tint, quality, form.thick),
    );
    mesh.rotation.set(...form.rot);
    if (form.scale) mesh.scale.set(...form.scale);
    group.add(mesh);
    group.position.set(...form.pos);
    scene.add(group);
    return { ...form, group, mesh, baseX: form.pos[0], baseY: form.pos[1] };
  });

  const lanternGeometry = new THREE.SphereGeometry(0.14, 20, 14);
  const lanternMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(PALETTE.sun).multiplyScalar(quality === 'high' ? 1.6 : 1.3),
  });
  const lanterns = LANTERNS.map((position) => {
    const mesh = new THREE.Mesh(lanternGeometry, lanternMaterial);
    mesh.position.set(...position);
    scene.add(mesh);
    return { mesh, baseY: position[1] };
  });

  const particles = buildParticles(quality === 'high' ? 1400 : 500);
  scene.add(particles);

  // Post-processing (bloom) only on the high tier.
  let composer = null;
  if (quality === 'high') {
    const size = renderer.getSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.35, 0.6, 0.9));
    composer.addPass(new OutputPass());
    composer.setPixelRatio(renderer.getPixelRatio());
  }

  // State
  const state = {
    time: 0,
    frames: 0,
    fps: 0,
    fpsFrames: 0,
    fpsClock: 0,
    intro: options.reducedMotion ? 1 : 0,
    motion: options.reducedMotion ? 0 : 1,
    scrollTarget: 0,
    scroll: 0,
    pointerTarget: new THREE.Vector2(),
    pointer: new THREE.Vector2(),
    xScale: 1,
    degradeStep: 0,
    userPaused: Boolean(options.reducedMotion),
    hidden: document.hidden,
    rafId: 0,
    last: 0,
  };
  const frameTimes = [];
  const cameraPosition = new THREE.Vector3();
  const cameraLook = new THREE.Vector3();

  function resize() {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.fov = camera.aspect < 0.8 ? 58 : 42;
    camera.updateProjectionMatrix();
    composer?.setSize(width, height);
    // Pull the hero forms inward on narrow screens so they stay in view.
    state.xScale = clamp(camera.aspect / 1.6, 0.45, 1);
    if (!state.rafId) renderStill();
  }

  function update(dt) {
    const s = state;
    s.time += dt;
    if (s.intro < 1) {
      s.intro = Math.min(1, s.intro + dt / 2.2);
      const e = easeOutCubic(s.intro);
      scene.fog.near = THREE.MathUtils.lerp(1, FOG_NEAR, e);
      scene.fog.far = THREE.MathUtils.lerp(10, FOG_FAR, e);
      renderer.toneMappingExposure = THREE.MathUtils.lerp(0.3, EXPOSURE, e);
    }

    const follow = 1 - Math.exp(-dt * 2.5);
    s.scroll += (s.scrollTarget - s.scroll) * follow;
    s.pointer.lerp(s.pointerTarget, 1 - Math.exp(-dt * 4));

    const t = s.time;
    const m = s.motion;
    cameraPosition.lerpVectors(CAMERA_A.pos, CAMERA_B.pos, s.scroll);
    cameraLook.lerpVectors(CAMERA_A.look, CAMERA_B.look, s.scroll);
    cameraPosition.x += s.pointer.x * 1.2 + Math.sin(t * 0.23) * 0.25 * m;
    cameraPosition.y += s.pointer.y * 0.6 + Math.cos(t * 0.19) * 0.12 * m;
    cameraLook.x += s.pointer.x * 0.5;
    cameraLook.y += s.pointer.y * 0.25;
    camera.position.copy(cameraPosition);
    camera.lookAt(cameraLook);
    sky.position.copy(camera.position);

    forms.forEach((form) => {
      form.group.position.x = form.baseX * s.xScale;
      form.group.position.y = form.baseY + Math.sin(t * form.drift[1] + form.drift[2]) * form.drift[0] * m;
      form.group.rotation.x += form.spin[0] * dt * m;
      form.group.rotation.y += form.spin[1] * dt * m;
      form.group.rotation.z += form.spin[2] * dt * m;
    });
    lanterns.forEach((lantern, index) => {
      lantern.mesh.position.y = lantern.baseY + Math.sin(t * 0.6 + index * 1.3) * 0.15 * m;
    });
    particles.rotation.y = t * 0.01 * m;
    particles.position.y = Math.sin(t * 0.1) * 0.3 * m;
  }

  function render() {
    if (composer && state.degradeStep < 1) composer.render();
    else renderer.render(scene, camera);
    state.frames += 1;
  }

  function renderStill() {
    state.scroll = state.scrollTarget;
    state.pointer.copy(state.pointerTarget);
    update(0);
    render();
  }

  // Drop the costliest effects one at a time if the device cannot keep up.
  function degrade() {
    state.degradeStep += 1;
    if (state.degradeStep === 1) {
      console.info('Glass world: bloom switched off to keep things smooth.');
    } else if (state.degradeStep === 2) {
      scene.remove(sea);
      sea.geometry.dispose();
      sea.material.dispose();
      sea = buildSea('low');
      scene.add(sea);
      console.info('Glass world: mirror sea replaced with a simpler one.');
    } else if (state.degradeStep === 3) {
      renderer.setPixelRatio(1);
      composer?.setPixelRatio(1);
      resize();
      console.info('Glass world: resolution lowered.');
    }
    frameTimes.length = 0;
  }

  function probePerformance(dt) {
    if (!adaptive || quality !== 'high' || state.degradeStep >= 3 || state.time < 2.5) return;
    frameTimes.push(dt);
    if (frameTimes.length < 90) return;
    const average = frameTimes.reduce((sum, value) => sum + value, 0) / frameTimes.length;
    frameTimes.length = 0;
    if (average > 1 / 26) degrade();
  }

  function frame(now) {
    state.rafId = requestAnimationFrame(frame);
    const elapsed = Math.max(0, (now - state.last) / 1000);
    state.last = now;
    // Animation uses a clamped step so a stalled tab does not jump; stats use the real one.
    update(clamp(elapsed, 0, 0.05) || 1 / 60);
    render();
    state.fpsFrames += 1;
    state.fpsClock += elapsed;
    if (state.fpsClock >= 1) {
      state.fps = state.fpsFrames / state.fpsClock;
      state.fpsFrames = 0;
      state.fpsClock = 0;
    }
    probePerformance(elapsed);
  }

  function startLoop() {
    if (state.rafId || state.userPaused || state.hidden) return;
    state.last = performance.now();
    state.rafId = requestAnimationFrame(frame);
  }

  function stopLoop() {
    if (!state.rafId) return;
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  }

  const onVisibility = () => {
    state.hidden = document.hidden;
    if (state.hidden) stopLoop();
    else startLoop();
  };
  const onLost = (event) => {
    event.preventDefault();
    stopLoop();
    onContextLost();
  };
  let resizeFrame = 0;
  const onResize = () => {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      resize();
    });
  };
  document.addEventListener('visibilitychange', onVisibility);
  canvas.addEventListener('webglcontextlost', onLost);
  window.addEventListener('resize', onResize);

  resize();
  if (state.userPaused) renderStill();
  else startLoop();

  return {
    quality,
    scene,
    camera,
    setScroll(progress) {
      state.scrollTarget = clamp(progress, 0, 1);
    },
    setPointer(x, y) {
      state.pointerTarget.set(clamp(x, -1, 1), clamp(y, -1, 1));
    },
    setPaused(paused) {
      state.userPaused = Boolean(paused);
      if (state.userPaused) {
        stopLoop();
      } else {
        state.motion = 1;
        startLoop();
      }
    },
    isPaused() {
      return state.userPaused;
    },
    renderStill,
    getStats() {
      return {
        quality,
        frames: state.frames,
        fps: Math.round(state.fps),
        degradeStep: state.degradeStep,
        running: Boolean(state.rafId),
      };
    },
    dispose() {
      stopLoop();
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('webglcontextlost', onLost);
      window.removeEventListener('resize', onResize);
      scene.traverse((object) => {
        if (object.isMesh || object.isPoints) {
          object.geometry?.dispose();
          object.material?.dispose();
        }
      });
      composer?.dispose();
      renderer.dispose();
    },
  };
}
