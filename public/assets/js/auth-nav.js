// ============================================================
//  auth-nav.js  —  shared navbar auth state for all pages
//  Include this on every page AFTER script.js:
//    <script src="auth-nav.js"></script>
// ============================================================

(function () {

  // ── Idle timeout ──────────────────────────────────────────
  // Logs the user out after 30 min of no mouse/keyboard/touch
  // activity on any page that includes this script.
  var IDLE_MS  = 30 * 60 * 1000   // 30 minutes
  var WARN_MS  =  2 * 60 * 1000   // warn 2 min before logout
  var idleTimer  = null
  var warnTimer  = null
  var warnToast  = null

  function resetIdleTimer() {
    if (!localStorage.getItem('lc_token')) return  // only when logged in
    clearTimeout(idleTimer)
    clearTimeout(warnTimer)
    dismissWarnToast()
    warnTimer = setTimeout(showIdleWarning, IDLE_MS - WARN_MS)
    idleTimer = setTimeout(function () { dismissWarnToast(); doIdleLogout() }, IDLE_MS)
  }

  function showIdleWarning() {
    if (warnToast) return
    warnToast = document.createElement('div')
    warnToast.innerHTML =
      '<span>You\'ll be logged out in 2 minutes due to inactivity.</span>' +
      '<button id="idle-stay-btn">Stay logged in</button>'
    warnToast.style.cssText =
      'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);' +
      'background:#1a2236;color:#fff;padding:11px 18px;border-radius:10px;' +
      'font-size:13px;font-family:Jost,sans-serif;display:flex;align-items:center;' +
      'gap:14px;box-shadow:0 4px 20px rgba(0,0,0,0.25);z-index:99999;white-space:nowrap;'
    document.body.appendChild(warnToast)
    document.getElementById('idle-stay-btn').style.cssText =
      'background:#b87166;color:#fff;border:none;padding:5px 13px;' +
      'border-radius:6px;font-size:12px;cursor:pointer;' +
      'font-family:Jost,sans-serif;font-weight:600;'
    document.getElementById('idle-stay-btn').addEventListener('click', function () {
      dismissWarnToast()
      resetIdleTimer()
    })
  }

  function dismissWarnToast() {
    if (warnToast) { warnToast.remove(); warnToast = null }
  }

  function doIdleLogout() {
    localStorage.removeItem('lc_token')
    localStorage.removeItem('lc_user')
    localStorage.removeItem('cw-token')
    window.dispatchEvent(new Event('auth:logout'))
    applyAuthToNav()
    // Show notice then redirect
    var msg = document.createElement('div')
    msg.textContent = 'You were logged out due to inactivity.'
    msg.style.cssText =
      'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);' +
      'background:#1a2236;color:#fff;padding:11px 20px;border-radius:10px;' +
      'font-size:13px;font-family:Jost,sans-serif;' +
      'box-shadow:0 4px 20px rgba(0,0,0,0.25);z-index:99999;'
    document.body.appendChild(msg)
    setTimeout(function () { msg.remove(); window.location.href = '/' }, 2500)
  }

  // Reset timer on any user activity
  var ACTIVITY = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click']
  ACTIVITY.forEach(function (evt) {
    window.addEventListener(evt, resetIdleTimer, { passive: true })
  })

  // Start timer on login, stop on logout
  window.addEventListener('auth:login',  function () { resetIdleTimer() })
  window.addEventListener('auth:logout', function () {
    clearTimeout(idleTimer); clearTimeout(warnTimer); dismissWarnToast()
  })

  // Kick off on load if already logged in
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', resetIdleTimer)
  } else {
    resetIdleTimer()
  }

  // ── Apply auth state to the navbar ──────────────────────
  function applyAuthToNav() {
    const user  = JSON.parse(localStorage.getItem('lc_user') || 'null')
    const token = localStorage.getItem('lc_token')

    const authBtn      = document.getElementById('nav-auth-btn')
    const mobileBtn    = document.getElementById('mobile-auth-btn')
    const logoutBtn    = document.getElementById('nav-logout-btn')
    const mobileLogout = document.getElementById('mobile-logout-btn')

    if (user && token) {
      // ── Logged-in state ──────────────────────────────────
      const firstName = user.displayName ? user.displayName.split(' ')[0] : 'Me'

      // Desktop: replace Sign In link with avatar chip
      if (authBtn && authBtn.id === 'nav-auth-btn') {
        authBtn.outerHTML = `
          <a href="/chatbot" class="nav-user-chip" id="nav-auth-btn">
            <img class="nav-user-avatar"
                 src="${user.pictureUrl || ''}"
                 alt="${user.displayName}"
                 onerror="this.style.display='none'" />
            ${firstName}
          </a>`
      }

      // Mobile: change link text + destination
      if (mobileBtn) {
        mobileBtn.textContent = firstName
        mobileBtn.href = '/chatbot'
      }

      // Show logout buttons
      if (logoutBtn)    logoutBtn.style.display    = 'inline-flex'
      if (mobileLogout) mobileLogout.style.display = 'block'

    } else {
      // ── Logged-out state ─────────────────────────────────
      // Restore Sign In link if it was replaced
      const chip = document.querySelector('.nav-user-chip#nav-auth-btn')
      if (chip) {
        chip.outerHTML = `<a href="login.html" id="nav-auth-btn">Sign In</a>`
      }
      if (mobileBtn) {
        mobileBtn.textContent = 'Sign In'
        mobileBtn.href = 'login.html'
      }
      if (logoutBtn)    logoutBtn.style.display    = 'none'
      if (mobileLogout) mobileLogout.style.display = 'none'
    }
  }

  // ── Logout helper (global so onclick="navLogout()" works) ─
  window.navLogout = function () {
    localStorage.removeItem('lc_token')
    localStorage.removeItem('lc_user')
    localStorage.removeItem('cw-token')
    // Notify other parts of the page
    window.dispatchEvent(new Event('auth:logout'))
    window.location.href = '/'
  }

  // ── Run on page load ──────────────────────────────────────
  // Use DOMContentLoaded so elements exist; fall back to
  // immediate call if the script is deferred / at bottom.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyAuthToNav)
  } else {
    applyAuthToNav()
  }

  // ── React to chatbot login WITHOUT a page refresh ─────────
  // chatbot.html dispatches 'auth:login' after doLogin() /
  // doRegister() succeed. Any other page open in the same tab
  // (e.g. if the chatbot is embedded) will catch this too.
  window.addEventListener('auth:login', function (e) {
    // e.detail may carry { user, token } — save them first
    if (e.detail) {
      if (e.detail.token) localStorage.setItem('lc_token', e.detail.token)
      if (e.detail.user)  localStorage.setItem('lc_user', JSON.stringify(e.detail.user))
    }
    applyAuthToNav()
  })

  window.addEventListener('auth:logout', function () {
    applyAuthToNav()
  })

  // ── Storage event: sync across browser tabs ───────────────
  // When the user logs in on another tab, this tab's navbar
  // updates automatically without a refresh.
  window.addEventListener('storage', function (e) {
    if (e.key === 'lc_user' || e.key === 'lc_token') {
      applyAuthToNav()
    }
  })

})()