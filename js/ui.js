// Glass UI behaviours: pane tilt and glare, the motion toggle, and feeding scroll and
// pointer position into the 3D world.
export function initGlassUI({ world, reducedMotion }) {
  const body = document.body;
  const toggle = document.getElementById('motion-toggle');
  const panes = Array.from(document.querySelectorAll('.pane'));
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  if (world) {
    wireWorld(world, toggle, body, finePointer);
  }

  if (finePointer && !reducedMotion) {
    panes.forEach(wireTilt);
  }
}

function wireWorld(world, toggle, body, finePointer) {
  const syncToggle = () => {
    const paused = world.isPaused();
    toggle.setAttribute('aria-pressed', String(paused));
    toggle.textContent = paused ? 'Resume the world' : 'Pause the world';
    body.dataset.world = paused ? 'paused' : 'running';
  };

  toggle.hidden = false;
  toggle.addEventListener('click', () => {
    world.setPaused(!world.isPaused());
    syncToggle();
  });
  syncToggle();

  const sendScroll = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    world.setScroll(max > 0 ? window.scrollY / max : 0);
  };
  window.addEventListener('scroll', sendScroll, { passive: true });
  window.addEventListener('resize', sendScroll);
  sendScroll();

  if (finePointer) {
    window.addEventListener(
      'pointermove',
      (event) => {
        if (event.pointerType === 'touch') return;
        const x = (event.clientX / window.innerWidth) * 2 - 1;
        const y = -((event.clientY / window.innerHeight) * 2 - 1);
        world.setPointer(x, y);
      },
      { passive: true },
    );
    document.documentElement.addEventListener('pointerleave', () => world.setPointer(0, 0));
  }
}

function wireTilt(pane) {
  let frame = 0;
  let latest = null;

  const apply = () => {
    frame = 0;
    const rect = pane.getBoundingClientRect();
    const x = (latest.clientX - rect.left) / rect.width;
    const y = (latest.clientY - rect.top) / rect.height;
    pane.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
    pane.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
    pane.style.setProperty('--ry', `${((x - 0.5) * 10).toFixed(2)}deg`);
    pane.style.setProperty('--rx', `${((0.5 - y) * 8).toFixed(2)}deg`);
  };

  pane.addEventListener('pointerenter', () => pane.classList.add('is-lit'));
  pane.addEventListener('pointermove', (event) => {
    latest = event;
    if (!frame) frame = requestAnimationFrame(apply);
  });
  pane.addEventListener('pointerleave', () => {
    pane.classList.remove('is-lit');
    if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    pane.style.setProperty('--rx', '0deg');
    pane.style.setProperty('--ry', '0deg');
  });
}
