/* ══════════════════════════════════════════════════════════════
   App — APOLLO V9.0
   IntersectionObserver reveals, Gemini AI Ticker, smooth scroll,
   and real-time subscription wiring.
   ══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── IntersectionObserver for .reveal elements ────────────
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, {
    threshold: 0.1,
    rootMargin: '0px 0px -40px 0px'
  });

  document.querySelectorAll('.reveal').forEach(function (el) {
    observer.observe(el);
  });

  // ── AI Ticker Typewriter ─────────────────────────────────
  function typewriter(elementId, text, speed) {
    var el = document.getElementById(elementId);
    var cursor = document.getElementById('ai-ticker-cursor');
    if (!el) return;

    var index = 0;
    el.textContent = '';

    function type() {
      if (index < text.length) {
        el.textContent += text.charAt(index);
        index++;
        setTimeout(type, speed);
      } else if (cursor) {
        cursor.style.animation = 'blink 1s step-end infinite';
      }
    }

    type();
  }

  // Fetch telemetry and start typewriter
  fetch('data/telemetry.json')
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (data && data.summary) {
        typewriter('ai-ticker-text', data.summary, 18);
      }
    })
    .catch(function () {
      typewriter(
        'ai-ticker-text',
        '[SYS] Telemetry feed unavailable. Model operating within nominal parameters.',
        18
      );
    });

  // ── Mobile Hamburger Menu ────────────────────────────────
  var hamburger = document.getElementById('hamburger');
  var navLinks = document.querySelector('.nav-links');
  if (hamburger && navLinks) {
    hamburger.addEventListener('click', function () {
      var isOpen = navLinks.classList.toggle('nav-open');
      hamburger.classList.toggle('active', isOpen);
      hamburger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    // Close menu on link click
    navLinks.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        navLinks.classList.remove('nav-open');
        hamburger.classList.remove('active');
        hamburger.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // ── Smooth scroll for nav links ──────────────────────────
  document.querySelectorAll('a[href^="#"]').forEach(function (link) {
    link.addEventListener('click', function (e) {
      var target = document.querySelector(this.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // ── Real-Time Subscriptions ──────────────────────────────
  // Wire up Supabase real-time to refresh charts and trade tape
  function setupRealtime() {
    if (!window.apolloDb || !window.apolloDb.isConfigured()) return;

    window.apolloDb.subscribeToBets(function (payload) {
      // On any bet change (INSERT or UPDATE), refresh everything
      refreshDashboard();
    });

    window.apolloDb.subscribeToSweeps(function () {
      refreshDashboard();
    });
  }

  function refreshDashboard() {
    if (!window.apolloDb || !window.apolloDb.isConfigured()) return;

    window.apolloDb.fetchBets().then(function (result) {
      if (!result.data) return;

      // Refresh trade tape
      if (window.ApolloOrderbook) {
        window.ApolloOrderbook.render(result.data);
      }

      // Refresh equity curve
      if (window.ApolloChart) {
        window.ApolloChart.setData(result.data);
      }

      // Refresh metrics
      if (window.ApolloMetrics) {
        var metrics = window.ApolloMetrics.compute(result.data);
        window.ApolloMetrics.updateCards(metrics);
      }
    });
  }

  // ── Central Data Init ────────────────────────────────────
  // Single fetch, shared across chart + orderbook + metrics.
  // Prevents triple fetchBets() on page load.
  function initDashboard() {
    if (!window.apolloDb || !window.apolloDb.isConfigured()) return;

    window.apolloDb.fetchBets().then(function (result) {
      if (!result.data) return;

      // Feed data to all modules from a single fetch
      if (window.ApolloChart) window.ApolloChart.init(result.data);
      if (window.ApolloOrderbook) window.ApolloOrderbook.render(result.data);
      if (window.ApolloMetrics) {
        var metrics = window.ApolloMetrics.compute(result.data);
        window.ApolloMetrics.updateCards(metrics);
      }

      // Mark as centrally initialized so modules skip their own fetch
      window._apolloDataLoaded = true;
    });

    setupRealtime();
  }

  // Initialize after a brief delay to ensure other modules registered
  setTimeout(initDashboard, 100);

})();
