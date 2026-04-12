/* ══════════════════════════════════════════════════════════════
   Animations — APOLLO V9.0
   GSAP ScrollTrigger reveals, counter animations, parallax.
   Vanilla JS — no React. Respects prefers-reduced-motion.
   ══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── Bail if reduced motion preferred ───────────────────────
  var prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReduced || typeof gsap === 'undefined') return;

  // Register ScrollTrigger
  if (typeof ScrollTrigger !== 'undefined') {
    gsap.registerPlugin(ScrollTrigger);
  }

  // Note: Section reveals are handled by CSS .reveal + IntersectionObserver
  // in app.js. GSAP only handles specific enhancements (counters, bars,
  // pipeline stagger, thesis stagger) to avoid double-animation conflicts.

  // ── Counter Animations ─────────────────────────────────────
  // Count up from 0 on scroll-into-view.
  // Skip .stat-grid values — those are updated live by metrics.js.
  // Only animate static values in #engine, #validation sections.
  function initCounters() {
    var statValues = gsap.utils.toArray('#engine .stat-value, #validation .num, .metrics-table .num');
    statValues.forEach(function (el) {
      var text = el.textContent.trim();

      // Parse numeric value from text like "+$24.19", "67.8%", "94"
      var match = text.match(/([+-]?\$?)([\d,.]+)(%?)/);
      if (!match) return;

      var prefix = match[1] || '';
      var numStr = match[2].replace(/,/g, '');
      var suffix = match[3] || '';
      var targetVal = parseFloat(numStr);

      if (isNaN(targetVal) || targetVal === 0) return;

      // Determine decimal places
      var decimals = numStr.indexOf('.') >= 0 ? numStr.split('.')[1].length : 0;

      var proxy = { val: 0 };

      gsap.to(proxy, {
        val: targetVal,
        duration: 1.2,
        ease: 'power2.out',
        scrollTrigger: {
          trigger: el,
          start: 'top 85%',
          once: true
        },
        onUpdate: function () {
          var formatted = proxy.val.toFixed(decimals);
          // Add comma separators for large numbers
          if (targetVal >= 1000) {
            formatted = Number(formatted).toLocaleString('en-US', {
              minimumFractionDigits: decimals,
              maximumFractionDigits: decimals
            });
          }
          el.textContent = prefix + formatted + suffix;
        }
      });
    });
  }

  // ── Hero Parallax ──────────────────────────────────────────
  // Subtle parallax on the hero grid background
  function initParallax() {
    var gridBg = document.querySelector('.hero-grid-bg');
    if (!gridBg) return;

    gsap.to(gridBg, {
      y: 80,
      ease: 'none',
      scrollTrigger: {
        trigger: '.hero',
        start: 'top top',
        end: 'bottom top',
        scrub: true
      }
    });
  }

  // ── Pipeline Steps Stagger ─────────────────────────────────
  // Pipeline steps slide in from left with stagger
  function initPipelineReveal() {
    var steps = gsap.utils.toArray('.pipeline-step');
    if (!steps.length) return;

    gsap.from(steps, {
      x: -60,
      opacity: 0,
      duration: 0.7,
      stagger: 0.15,
      ease: 'power3.out',
      scrollTrigger: {
        trigger: '.pipeline-grid',
        start: 'top 80%',
        once: true
      }
    });
  }

  // ── Feature Bar Fill Animation ─────────────────────────────
  // Bars grow from 0 width to target width on scroll
  function initFeatureBars() {
    var bars = gsap.utils.toArray('.feature-bar-fill');
    if (!bars.length) return;

    bars.forEach(function (bar) {
      var targetWidth = bar.style.width || '0%';
      bar.style.width = '0%';

      gsap.to(bar, {
        width: targetWidth,
        duration: 0.8,
        ease: 'power2.out',
        scrollTrigger: {
          trigger: bar,
          start: 'top 90%',
          once: true
        }
      });
    });
  }

  // ── Thesis Cards Stagger ───────────────────────────────────
  function initThesisReveal() {
    var cards = gsap.utils.toArray('.thesis-card');
    if (!cards.length) return;

    gsap.from(cards, {
      y: 50,
      opacity: 0,
      duration: 0.6,
      stagger: 0.12,
      ease: 'power2.out',
      scrollTrigger: {
        trigger: '.thesis-grid',
        start: 'top 80%',
        once: true
      }
    });
  }

  // ── Nav Scroll Behavior ────────────────────────────────────
  // Shrink nav on scroll
  function initNavScroll() {
    var nav = document.querySelector('.nav');
    if (!nav) return;

    ScrollTrigger.create({
      start: 'top -80',
      onUpdate: function (self) {
        if (self.direction === 1) {
          nav.classList.add('nav-scrolled');
        } else if (self.scroll() < 80) {
          nav.classList.remove('nav-scrolled');
        }
      }
    });
  }

  // ── Initialize All ─────────────────────────────────────────
  function initAll() {
    initNavScroll();
    initParallax();
    initThesisReveal();
    initPipelineReveal();
    initFeatureBars();
    initCounters();
  }

  // Wait for DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }

})();
