// ============================================================
//  auth-nav.js  —  shared navbar auth state for all pages
//  Auth: HttpOnly cookie (set by server) — no token in JS
// ============================================================

(function () {

  const API_BASE = 'https://ai-chat-bot-clinic.onrender.com'

  // ── Idle timeout ──────────────────────────────────────────
  // Logs the user out after 30 min of no mouse/keyboard/touch
  // activity on any page that includes this script.
  const IDLE_MS = 30 * 60 * 1000   // 30 minutes
  const WARN_MS =  2 * 60 * 1000   // warn 2 min before logout
  let idleTimer = null
  let warnTimer = null
  let warnToast = null

  // We track login state in memory only — no localStorage token
  // applyAuthToNav() reads lc_user (non-sensitive display data only)
  function isLoggedIn() {
    return !!sessionStorage.getItem('lc_user')
  }

  function resetIdleTimer() {
    if (!isLoggedIn()) return
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
    // Tell the server to clear the cookie
    fetch(API_BASE + '/auth/logout', {
      method: 'POST',
      credentials: 'include'
    }).finally(function () {
      sessionStorage.removeItem('lc_user')
      window.dispatchEvent(new Event('auth:logout'))
      applyAuthToNav()

      const msg = document.createElement('div')
      msg.textContent = 'You were logged out due to inactivity.'
      msg.style.cssText =
        'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);' +
        'background:#1a2236;color:#fff;padding:11px 20px;border-radius:10px;' +
        'font-size:13px;font-family:Jost,sans-serif;' +
        'box-shadow:0 4px 20px rgba(0,0,0,0.25);z-index:99999;'
      document.body.appendChild(msg)
      setTimeout(function () { msg.remove(); window.location.href = '/' }, 2500)
    })
  }

  // Reset timer on any user activity
  const ACTIVITY = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click']
  ACTIVITY.forEach(function (evt) {
    window.addEventListener(evt, resetIdleTimer, { passive: true })
  })

  window.addEventListener('auth:login',  function () { resetIdleTimer() })
  window.addEventListener('auth:logout', function () {
    clearTimeout(idleTimer); clearTimeout(warnTimer); dismissWarnToast()
  })

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', resetIdleTimer)
  } else {
    resetIdleTimer()
  }

  // ── Apply auth state to the navbar ───────────────────────
  function applyAuthToNav() {
    // lc_user holds only display data (name, avatar) — not sensitive
    // The real auth proof is the HttpOnly cookie, invisible to JS
    const user = JSON.parse(sessionStorage.getItem('lc_user') || 'null')

    const authBtn      = document.getElementById('nav-auth-btn')
    const mobileBtn    = document.getElementById('mobile-auth-btn')
    const logoutBtn    = document.getElementById('nav-logout-btn')
    const mobileLogout = document.getElementById('mobile-logout-btn')

    if (user) {
      // ── Logged-in state ──────────────────────────────────
      const firstName = user.displayName ? user.displayName.split(' ')[0] : 'Me'

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

      if (mobileBtn) {
        mobileBtn.textContent = firstName
        mobileBtn.href = '/chatbot'
      }

      if (logoutBtn)    logoutBtn.style.display    = 'inline-flex'
      if (mobileLogout) mobileLogout.style.display = 'block'

    } else {
      // ── Logged-out state ─────────────────────────────────
      const chip = document.querySelector('.nav-user-chip#nav-auth-btn')
      if (chip) {
        chip.outerHTML = `<a href="/login" id="nav-auth-btn">Sign In</a>`
      }
      if (mobileBtn) {
        mobileBtn.textContent = 'Sign In'
        mobileBtn.href = '/login'
      }
      if (logoutBtn)    logoutBtn.style.display    = 'none'
      if (mobileLogout) mobileLogout.style.display = 'none'
    }
  }

  // ── Logout helper (global so onclick="navLogout()" works) ─
  window.navLogout = function () {
    fetch(API_BASE + '/auth/logout', {
      method: 'POST',
      credentials: 'include'   // sends the cookie so server can clear it
    }).finally(function () {
      sessionStorage.removeItem('lc_user')
      window.dispatchEvent(new Event('auth:logout'))
      window.location.href = '/'
    })
  }

  // ── Verify session on page load via /auth/me ─────────────
  // Since JS can't read the HttpOnly cookie, we ask the server
  // if the cookie is still valid. If yes, we get user data back.
  function checkSession() {
    fetch(API_BASE + '/auth/me', {
      credentials: 'include'   // sends the cookie automatically
    })
    .then(function (res) {
      if (!res.ok) {
        sessionStorage.removeItem('lc_user')
        applyAuthToNav()
        return
      }
      return res.json()
    })
    .then(function (data) {
      if (data && data.user) {
        sessionStorage.setItem('lc_user', JSON.stringify(data.user))
        applyAuthToNav()
        resetIdleTimer()
      }
    })
    .catch(function () {
      // Network error — keep whatever state we have
      applyAuthToNav()
    })
  }

  // ── Run on page load ──────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkSession)
  } else {
    checkSession()
  }

  // ── React to login events (e.g. from chatbot page) ────────
  window.addEventListener('auth:login', function (e) {
    if (e.detail && e.detail.user) {
      // Store only display data — never the token
      sessionStorage.setItem('lc_user', JSON.stringify(e.detail.user))
    }
    applyAuthToNav()
  })

  window.addEventListener('auth:logout', function () {
    applyAuthToNav()
  })

  // NOTE: cross-tab sync via storage event is removed —
  // sessionStorage is intentionally tab-scoped. Each tab
  // independently verifies its session via /auth/me on load.

}())