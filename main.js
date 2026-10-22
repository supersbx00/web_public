/* =========================================================
   Movimiento físico estilo Apple (ver skill apple-design)
   - Springs con damping ratio + response, sin duración fija.
   - Toda animación parte del valor actual en pantalla → interrumpible.
   - Respeta prefers-reduced-motion (solo fundidos, sin desplazamientos).
   ========================================================= */

(function () {
  'use strict';

  const root = document.documentElement;
  root.classList.add('js');

  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reducedMotion = motionQuery.matches;
  motionQuery.addEventListener?.('change', (e) => { reducedMotion = e.matches; });

  /* ---------- Motor de springs ---------- */

  // Presets en términos de Apple: damping ratio (1 = sin rebote) y response (s).
  const SPRING = {
    default: { damping: 1, response: 0.4 },
    press: { damping: 1, response: 0.18 },
    release: { damping: 0.75, response: 0.35 },
    hover: { damping: 0.85, response: 0.35 },
    reveal: { damping: 1, response: 0.6 },
    sheet: { damping: 0.85, response: 0.3 },
    count: { damping: 1, response: 1.1 },
  };

  // Canales que implican desplazamiento: con reduced motion se aplican al instante.
  const MOTION_CHANNELS = new Set(['y', 'hoverY', 'scale']);

  const states = new Map(); // element -> { channels, render }
  const active = new Set(); // "element|channel" en movimiento
  let rafId = 0;
  let lastTime = 0;

  function getState(el, render, initial) {
    let state = states.get(el);
    if (!state) {
      state = { channels: {}, render };
      for (const key in initial) state.channels[key] = { value: initial[key], velocity: 0, target: initial[key], k: 0, c: 0 };
      states.set(el, state);
    }
    return state;
  }

  function spring(el, key, target, preset = SPRING.default, onSettle) {
    const state = states.get(el);
    if (!state) return;
    const ch = state.channels[key];
    ch.target = target;
    ch.onSettle = onSettle;

    if (reducedMotion && MOTION_CHANNELS.has(key)) {
      ch.value = target;
      ch.velocity = 0;
      state.render(el, state.channels);
      onSettle?.();
      return;
    }

    // stiffness = (2π / response)², damping = 4π·ζ / response  (masa = 1)
    const response = reducedMotion ? Math.min(preset.response, 0.25) : preset.response;
    const damping = reducedMotion ? 1 : preset.damping;
    ch.k = Math.pow((2 * Math.PI) / response, 2);
    ch.c = (4 * Math.PI * damping) / response;

    active.add(el);
    if (!rafId) {
      lastTime = performance.now();
      rafId = requestAnimationFrame(tick);
    }
  }

  function tick(now) {
    // Pasos fijos pequeños para estabilidad numérica, con tope ante pestañas en segundo plano.
    let dt = Math.min((now - lastTime) / 1000, 1 / 20);
    lastTime = now;
    const STEP = 1 / 240;

    for (const el of active) {
      const state = states.get(el);
      let moving = false;

      for (const key in state.channels) {
        const ch = state.channels[key];
        if (ch.k === 0) continue;

        let remaining = dt;
        while (remaining > 0) {
          const h = Math.min(STEP, remaining);
          const force = -ch.k * (ch.value - ch.target) - ch.c * ch.velocity;
          ch.velocity += force * h;
          ch.value += ch.velocity * h;
          remaining -= h;
        }

        const scale = Math.max(Math.abs(ch.target), 1);
        if (Math.abs(ch.velocity) < 0.001 * scale && Math.abs(ch.value - ch.target) < 0.0005 * scale) {
          ch.value = ch.target;
          ch.velocity = 0;
          ch.k = 0;
          const done = ch.onSettle;
          ch.onSettle = null;
          done?.();
        } else {
          moving = true;
        }
      }

      state.render(el, state.channels);
      if (!moving) active.delete(el);
    }

    rafId = active.size ? requestAnimationFrame(tick) : 0;
  }

  /* ---------- Render de transformaciones compuestas ---------- */

  function renderBox(el, ch) {
    const y = ch.y.value + ch.hoverY.value;
    el.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0) scale(${ch.scale.value.toFixed(4)})`;
    el.style.opacity = ch.opacity.value.toFixed(3);
  }

  function box(el, initial = {}) {
    return getState(el, renderBox, { y: 0, hoverY: 0, scale: 1, opacity: 1, ...initial });
  }

  /* ---------- Barra superior: hairline al hacer scroll ---------- */

  const nav = document.getElementById('nav');
  const hero = document.getElementById('heroContent');
  let scrollTicking = false;

  function onScroll() {
    const y = window.scrollY;
    nav.classList.toggle('is-scrolled', y > 8);

    // El encabezado principal se reduce sutilmente, 1:1 con el scroll (sin retardo).
    if (hero) {
      if (reducedMotion) {
        hero.style.transform = '';
        hero.style.opacity = '';
      } else {
        const progress = Math.min(Math.max(y / (window.innerHeight * 0.7), 0), 1);
        hero.style.transform = `scale(${(1 - progress * 0.06).toFixed(4)})`;
        hero.style.opacity = (1 - progress * 0.6).toFixed(3);
      }
    }
    scrollTicking = false;
  }

  window.addEventListener('scroll', () => {
    if (!scrollTicking) {
      scrollTicking = true;
      requestAnimationFrame(onScroll);
    }
  }, { passive: true });
  onScroll();

  /* ---------- Botones: feedback en pointerdown, no en click ---------- */

  document.querySelectorAll('[data-spring-press]').forEach((el) => {
    box(el);
    const release = () => spring(el, 'scale', 1, SPRING.release);

    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      spring(el, 'scale', 0.95, SPRING.press);
    });
    el.addEventListener('pointerup', release);
    el.addEventListener('pointerleave', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        spring(el, 'scale', 0.95, SPRING.press);
        setTimeout(release, 120);
      }
    });
  });

  /* ---------- Cards: elevación suave al hover (solo puntero fino) ---------- */

  const canHover = window.matchMedia('(hover: hover) and (pointer: fine)');

  document.querySelectorAll('[data-spring-hover]').forEach((el) => {
    box(el);
    el.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'mouse' || !canHover.matches) return;
      spring(el, 'hoverY', -4, SPRING.hover);
    });
    el.addEventListener('pointerleave', () => spring(el, 'hoverY', 0, SPRING.hover));
  });

  /* ---------- Aparición al entrar en pantalla ---------- */

  function countUp(container) {
    container.querySelectorAll('[data-count]').forEach((num) => {
      const target = Number(num.dataset.count);
      const state = getState(num, (el, ch) => {
        el.textContent = String(Math.round(ch.n.value));
      }, { n: 0 });
      state.render(num, state.channels);
      spring(num, 'n', target, SPRING.count);
    });
  }

  const revealEls = document.querySelectorAll('[data-reveal]');

  if ('IntersectionObserver' in window) {
    revealEls.forEach((el) => {
      // Puede existir ya (cards con hover), así que se fija el estado inicial explícitamente.
      const state = box(el);
      state.channels.y.value = state.channels.y.target = reducedMotion ? 0 : 28;
      state.channels.opacity.value = state.channels.opacity.target = 0;
      state.render(el, state.channels);
    });

    const revealObserver = new IntersectionObserver((entries) => {
      const visible = entries.filter((e) => e.isIntersecting);
      visible.forEach((entry, i) => {
        const el = entry.target;
        revealObserver.unobserve(el);
        // Escalonado corto dentro del mismo lote para que la cuadrícula "fluya".
        setTimeout(() => {
          spring(el, 'y', 0, SPRING.reveal);
          spring(el, 'opacity', 1, SPRING.reveal);
          countUp(el);
        }, reducedMotion ? 0 : i * 70);
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -6% 0px' });

    revealEls.forEach((el) => revealObserver.observe(el));
  } else {
    revealEls.forEach((el) => { el.style.opacity = 1; });
  }

  /* ---------- Menú móvil: interrumpible, entra y sale por el mismo camino ---------- */

  const toggle = document.getElementById('navToggle');
  const links = document.getElementById('navLinks');
  const mobileQuery = window.matchMedia('(max-width: 734px)');
  let menuOpen = false;

  getState(links, (el, ch) => {
    if (!mobileQuery.matches) {
      el.style.transform = '';
      el.style.opacity = '';
      return;
    }
    el.style.transform = `translate3d(0, ${ch.y.value.toFixed(2)}px, 0) scale(${ch.scale.value.toFixed(4)})`;
    el.style.opacity = ch.opacity.value.toFixed(3);
  }, { y: -12, scale: 0.98, opacity: 0 });

  function setMenu(open) {
    menuOpen = open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');

    if (open) links.classList.add('is-open');
    spring(links, 'y', open ? 0 : -12, SPRING.sheet);
    spring(links, 'scale', open ? 1 : 0.98, SPRING.sheet);
    spring(links, 'opacity', open ? 1 : 0, SPRING.default, () => {
      if (!menuOpen) links.classList.remove('is-open');
    });
  }

  toggle.addEventListener('click', () => setMenu(!menuOpen));
  links.addEventListener('click', (e) => {
    if (e.target.closest('a') && menuOpen) setMenu(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menuOpen) {
      setMenu(false);
      toggle.focus();
    }
  });
  mobileQuery.addEventListener?.('change', () => {
    if (menuOpen) setMenu(false);
    const state = states.get(links);
    state.render(links, state.channels);
  });

  /* ---------- Enlace activo según la sección visible ---------- */

  const navAnchors = [...links.querySelectorAll('a[href^="#"]')];
  const sections = navAnchors
    .map((a) => document.querySelector(a.getAttribute('href')))
    .filter(Boolean);

  if ('IntersectionObserver' in window) {
    const sectionObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const id = '#' + entry.target.id;
        navAnchors.forEach((a) => a.classList.toggle('is-active', a.getAttribute('href') === id));
      });
    }, { rootMargin: '-45% 0px -50% 0px' });

    sections.forEach((s) => sectionObserver.observe(s));
  }

  /* ---------- Año del footer ---------- */

  const year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());
})();
