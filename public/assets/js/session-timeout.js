;(function () {
  const API_BASE = 'https://ai-chat-bot-clinic.onrender.com'

  const SESSION_TIMEOUT_SEC = 60 * 60  //1 hour
  const WARNING_BEFORE_SEC  = 120    // 2 mins
  const SESSION_TIMEOUT_MS = SESSION_TIMEOUT_SEC * 1000
  const WARNING_AT_MS      = (SESSION_TIMEOUT_SEC - WARNING_BEFORE_SEC) * 1000

  const LOGIN_URL = '/pages/login.html'


  if (!localStorage.getItem('lc_token')) return

  let warningTimer = null
  let logoutTimer  = null
  let modalEl      = null

  // Modal UI
  function createModal() {
    if (modalEl) return modalEl

    const overlay = document.createElement('div')
    overlay.id = 'session-timeout-overlay'
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 9999;
      background: rgba(15, 23, 42, 0.55);
      display: flex; align-items: center; justify-content: center;
      font-family: inherit;
    `

    const box = document.createElement('div')
    box.style.cssText = `
      background: #fff; border-radius: 12px; padding: 28px 32px;
      max-width: 380px; width: 90%; text-align: center;
      box-shadow: 0 10px 40px rgba(0,0,0,0.2);
    `

    box.innerHTML = `
      <h3 style="margin: 0 0 8px; font-size: 1.15rem; color: #111;">
        Session about to expire
      </h3>
      <p style="margin: 0 0 20px; font-size: 0.9rem; color: #555; line-height: 1.5;">
        You've been inactive for a while. For your security, you'll be
        logged out in <span id="session-timeout-countdown">${WARNING_BEFORE_SEC}</span>s
        unless you'd like to continue.
      </p>
      <button id="session-timeout-stay" style="
        background: #0f172a; color: #fff; border: none;
        padding: 10px 24px; border-radius: 8px; font-size: 0.9rem;
        cursor: pointer; font-weight: 500;
      ">Stay logged in</button>
    `

    overlay.appendChild(box)
    document.body.appendChild(overlay)
    modalEl = overlay

    document.getElementById('session-timeout-stay').addEventListener('click', stayLoggedIn)

    return overlay
  }

  function showModal() {
    const overlay = createModal()
    overlay.style.display = 'flex'

    // Countdown text
    let remaining = WARNING_BEFORE_SEC
    const countdownEl = document.getElementById('session-timeout-countdown')
    const tick = setInterval(() => {
      remaining -= 1
      if (countdownEl) countdownEl.textContent = String(Math.max(remaining, 0))
      if (remaining <= 0) clearInterval(tick)
    }, 1000)

    modalEl._tick = tick
  }

  function hideModal() {
    if (!modalEl) return
    modalEl.style.display = 'none'
    if (modalEl._tick) clearInterval(modalEl._tick)
  }

  // Logout
  function doLogout(reason) {
    clearTimers()
    hideModal()
    localStorage.removeItem('lc_token')
    localStorage.removeItem('lc_user')
    window.dispatchEvent(new CustomEvent('auth:logout', { detail: { reason } }))

    const params = new URLSearchParams()
    if (reason) params.set('reason', reason)
    const qs = params.toString()
    window.location.href = LOGIN_URL + (qs ? '?' + qs : '')
  }

  //Stay logged in: refresh token via /auth/me
  async function stayLoggedIn() {
    hideModal()
    const token = localStorage.getItem('lc_token')
    if (!token) return doLogout('session_expired')

    try {
      const res = await fetch(`${API_BASE}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` }
      })

      if (res.status === 401) {
        // Token already timed out server-side
        return doLogout('session_expired')
      }

      const refreshed = res.headers.get('X-Refreshed-Token')
      if (refreshed) {
        localStorage.setItem('lc_token', refreshed)
      }

      resetTimers()
    } catch (err) {
      // Network error — don't force logout, just retry on next activity
      resetTimers()
    }
  }

  // Timers 
  function clearTimers() {
    if (warningTimer) clearTimeout(warningTimer)
    if (logoutTimer)  clearTimeout(logoutTimer)
    warningTimer = null
    logoutTimer  = null
  }

  function resetTimers() {
    clearTimers()
    hideModal()
    warningTimer = setTimeout(showModal, WARNING_AT_MS)
    logoutTimer  = setTimeout(() => doLogout('inactivity'), SESSION_TIMEOUT_MS)
  }

  // Activity listeners
  // Reset idle timers on genuine user interaction.
  // (Do NOT reset on background API calls — only real user activity.)
  const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart']

  let activityThrottle = false
  function onActivity() {
    // While the warning modal is showing, activity should NOT silently
    // reset the timer — the user must explicitly click "Stay logged in".
    if (modalEl && modalEl.style.display === 'flex') return

    if (activityThrottle) return
    activityThrottle = true
    setTimeout(() => { activityThrottle = false }, 1000) // throttle to once/sec

    resetTimers()
  }

  ACTIVITY_EVENTS.forEach(evt =>
    window.addEventListener(evt, onActivity, { passive: true })
  )

  resetTimers()
})()