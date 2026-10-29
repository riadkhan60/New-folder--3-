import { initGlassUI } from './js/ui.js';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const params = new URLSearchParams(window.location.search);
const canvas = document.getElementById('world');

// Phones and weak machines get the lighter world; everything else gets real refraction.
function pickQuality() {
  const forced = params.get('quality');
  if (forced === 'low' || forced === 'high') return forced;
  const small = window.matchMedia('(max-width: 760px)').matches;
  const weak = (navigator.hardwareConcurrency || 8) <= 4 && (navigator.deviceMemory || 8) <= 4;
  return small || weak ? 'low' : 'high';
}

let world = null;

try {
  const { createWorld } = await import('./js/world.js');
  world = createWorld(canvas, {
    quality: pickQuality(),
    reducedMotion,
    adaptive: params.get('adapt') !== '0',
    onContextLost: () => {
      document.body.dataset.world = 'unavailable';
    },
  });
  document.body.dataset.world = world.isPaused() ? 'paused' : 'running';
  window.glassWorld = world;
} catch (error) {
  console.warn('The 3D world could not start, showing the flat sky instead.', error);
  document.body.dataset.world = 'unavailable';
}

initGlassUI({ world, reducedMotion });
