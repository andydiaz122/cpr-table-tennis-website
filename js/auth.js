/* ══════════════════════════════════════════════════════════════
   Auth — APOLLO V9.0
   Supabase email/password auth for operator access.
   Investors view the site without authentication.
   ══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var authModal = null;
  var authForm = null;
  var authError = null;
  var authButton = null;
  var operatorControls = null;

  function init() {
    authModal = document.getElementById('auth-modal');
    authForm = document.getElementById('auth-form');
    authError = document.getElementById('auth-error');
    authButton = document.getElementById('auth-button');
    operatorControls = document.querySelectorAll('.operator-only');

    if (!authButton || !window.apolloDb) return;

    // Auth button click → show/hide modal or sign out
    authButton.addEventListener('click', function () {
      window.apolloDb.getSession().then(function (result) {
        if (result.data.session) {
          // Already logged in → sign out
          window.apolloDb.signOut().then(function () {
            updateAuthUI(null);
          });
        } else {
          // Show login modal
          if (authModal) authModal.classList.add('active');
        }
      });
    });

    // Close modal on backdrop click
    if (authModal) {
      authModal.addEventListener('click', function (e) {
        if (e.target === authModal) {
          authModal.classList.remove('active');
        }
      });
    }

    // Form submit
    if (authForm) {
      authForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var email = authForm.querySelector('[name="email"]').value.trim();
        var password = authForm.querySelector('[name="password"]').value;

        if (!email || !password) {
          showError('Email and password required.');
          return;
        }

        showError('');
        window.apolloDb.signIn(email, password).then(function (result) {
          if (result.error) {
            showError(result.error.message);
          } else {
            authModal.classList.remove('active');
            authForm.reset();
            updateAuthUI(result.data.session);
          }
        });
      });
    }

    // Listen for auth state changes
    window.apolloDb.onAuthStateChange(function (event, session) {
      updateAuthUI(session);
    });

    // Check initial session
    window.apolloDb.getSession().then(function (result) {
      updateAuthUI(result.data.session);
    });
  }

  function updateAuthUI(session) {
    var isLoggedIn = !!session;

    // Update auth button
    if (authButton) {
      authButton.textContent = isLoggedIn ? 'Sign Out' : '';
      authButton.title = isLoggedIn ? 'Sign out' : 'Operator login';
      authButton.classList.toggle('authenticated', isLoggedIn);
    }

    // Show/hide operator-only elements
    operatorControls.forEach(function (el) {
      el.style.display = isLoggedIn ? '' : 'none';
    });

    // Dispatch custom event for other modules
    document.dispatchEvent(new CustomEvent('apollo:auth', {
      detail: { authenticated: isLoggedIn, session: session }
    }));
  }

  function showError(message) {
    if (authError) {
      authError.textContent = message;
      authError.style.display = message ? 'block' : 'none';
    }
  }

  // ── Public API ─────────────────────────────────────────────
  window.ApolloAuth = {
    init: init
  };

  // Auto-init when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
