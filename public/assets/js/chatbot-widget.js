// ============================================================
//  LUMIÈRE CLINIC — chatbot-widget.js  (v3)
//  Auth-aware floating chat widget.
//
//  Way 1 — "Book Now" button on service cards:
//    Opens guest booking modal → calls /appointments/book-guest
//    No login required.
//
//  Way 2 — AI chatbot:
//    Guest (not logged in): recommendations, prices, slots only.
//    Logged-in user: full booking / cancel / reschedule via AI.
// ============================================================
; (function () {

  // ── Backend URL ────────────────────────────────────────────
  const API_BASE = 'https://ai-chat-bot-clinic.onrender.com'

  // ── Wake up Render on load (free tier spins down) ──────────
  let cwServerReady = false
  async function cwWakeServer() {
    try {
      const r = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(30000) })
      if (r.ok) cwServerReady = true
    } catch { }
  }
  cwWakeServer()

  // ── Inject HTML ────────────────────────────────────────────
  const markup = `
  <!-- FAB -->
  <button id="cw-fab" aria-label="Open chat">
    <div id="cw-fab-icon-chat">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none"
           stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
    </div>
    <div id="cw-fab-icon-close">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
           stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </div>
    <div id="cw-badge" class="hidden">1</div>
  </button>

  <!-- Chat panel -->
  <div id="cw-panel" role="dialog" aria-label="Lumière Chat">
    <div id="cw-header">
      <div class="cw-avatar"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(184,113,102,0.9)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></div>
      <div class="cw-header-text">
        <div class="cw-header-name">Lumière Skin Consultant</div>
        <div class="cw-header-sub"><span class="cw-online-dot"></span>AI Assistant · Lumière Clinic</div>
      </div>
      <button id="cw-auth-status" class="guest" onclick="cwOpenAuth()"><svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:2px;"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg> Login</button>
      <div id="cw-msg-counter">20 left</div>
    </div>

    <!-- Guest notice (shown when not logged in) -->
    <div id="cw-guest-notice">
      <div class="cw-notice-icon"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d4a89a" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>
      <div class="cw-notice-text">
        <div class="cw-notice-title">Browsing as guest</div>
        <div class="cw-notice-sub">Log in to book, cancel &amp; reschedule via chat</div>
      </div>
      <button class="cw-notice-btn" onclick="cwOpenAuth()">Log in</button>
    </div>

    <div id="cw-messages">
      <div class="cw-date-divider">Today</div>
      <div class="cw-msg-row bot" id="cw-welcome-row">
        <div class="cw-row-icon"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#b87166" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></div>
        <div class="cw-bubble-wrap">
          <div class="cw-bubble">Hello! Welcome to <strong>Lumière Skin Clinic</strong>

I'm your AI skin consultant. I can help you with:
• Treatment recommendations for your skin concerns
• Service pricing &amp; details
• Viewing available appointment slots

<em>Log in to book, cancel, or reschedule appointments via chat.</em></div>
          <div class="cw-msg-time" id="cw-welcome-time"></div>
        </div>
      </div>
      <div class="cw-msg-row bot" id="cw-typing-row">
        <div class="cw-row-icon"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#b87166" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></div>
        <div class="cw-typing-bubble">
          <div class="cw-typing-dot"></div><div class="cw-typing-dot"></div><div class="cw-typing-dot"></div>
        </div>
      </div>
    </div>

    <div id="cw-quick-bar">
      <button class="cw-qbtn" onclick="cwShowAllServices()"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:3px;"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg> Services</button>
      <button class="cw-qbtn" onclick="cwShowSlots()"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:3px;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> Slots</button>
      <button class="cw-qbtn" id="cw-qbtn-mybookings" onclick="cwShowMyAppointments()" style="display:none"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:3px;"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg> My Bookings</button>
      <button class="cw-qbtn" onclick="cwSendQuick('What do you recommend for acne?')"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:3px;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> Recommend</button>
      <button class="cw-qbtn" id="cw-qbtn-reschedule" onclick="cwSendQuick('I want to reschedule my appointment')" style="display:none"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:3px;"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Reschedule</button>
    </div>

    <div id="cw-input-zone">
      <div id="cw-char-line">0 / 100</div>
      <div id="cw-input-row">
        <textarea id="cw-input" placeholder="Ask me anything about your skin…" rows="1" maxlength="100"></textarea>
        <button id="cw-send-btn" onclick="cwSendMessage()">
          <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
        </button>
      </div>
    </div>
  </div>

  <!-- Auth modal -->
  <div id="cw-auth-overlay">
    <div id="cw-auth-modal">
      <div class="cw-modal-header">
        <div class="cw-modal-title">Welcome back</div>
        <div class="cw-modal-sub">Log in to manage your appointments via AI chat</div>
        <button class="cw-modal-close" onclick="cwCloseAuth()">✕</button>
      </div>
      <div class="cw-auth-tabs">
        <button class="cw-auth-tab active" onclick="cwSwitchTab('login')">Log In</button>
        <button class="cw-auth-tab" onclick="cwSwitchTab('register')">Register</button>
      </div>
      <div class="cw-auth-body">
        <div class="cw-auth-error" id="cw-auth-error"></div>

        <!-- Login form -->
        <div class="cw-auth-form active" id="cw-login-form">
          <div class="cw-form-group">
            <label class="cw-form-label">Email</label>
            <input class="cw-form-input" id="cw-login-email" type="email" placeholder="you@email.com" />
          </div>
          <div class="cw-form-group">
            <label class="cw-form-label">Password</label>
            <input class="cw-form-input" id="cw-login-password" type="password" placeholder="••••••••" />
          </div>
          <button class="cw-auth-submit" id="cw-login-btn" onclick="cwDoLogin()">Log In</button>
        </div>

        <!-- Register form -->
        <div class="cw-auth-form" id="cw-register-form">
          <div class="cw-form-group">
            <label class="cw-form-label">Full Name</label>
            <input class="cw-form-input" id="cw-reg-name" type="text" placeholder="Jane Smith" />
          </div>
          <div class="cw-form-group">
            <label class="cw-form-label">Email</label>
            <input class="cw-form-input" id="cw-reg-email" type="email" placeholder="you@email.com" />
          </div>
          <div class="cw-form-group">
            <label class="cw-form-label">Phone</label>
            <input class="cw-form-input" id="cw-reg-phone" type="tel" placeholder="0812345678" />
          </div>
          <div class="cw-form-group">
            <label class="cw-form-label">ID / Passport Number</label>
            <input class="cw-form-input" id="cw-reg-id" type="text" placeholder="National ID or Passport" />
          </div>
          <div class="cw-form-group">
            <label class="cw-form-label">Password</label>
            <input class="cw-form-input" id="cw-reg-password" type="password" placeholder="Min 8 characters" />
          </div>
          <button class="cw-auth-submit" id="cw-reg-btn" onclick="cwDoRegister()">Create Account</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Guest booking modal (Way 1 — no login needed) -->
  <div id="cw-book-overlay">
    <div id="cw-book-modal">
      <div class="cw-modal-header">
        <div class="cw-modal-title" id="cw-book-modal-title">Book Appointment</div>
        <div class="cw-modal-sub" id="cw-book-modal-sub">Fill in your details to confirm</div>
        <button class="cw-modal-close" onclick="cwCloseBookModal()">✕</button>
      </div>
      <div class="cw-auth-body">
        <div class="cw-auth-error" id="cw-book-error"></div>
        <div style="display:flex;flex-direction:column;gap:11px;" id="cw-book-form">
          <div class="cw-form-group">
            <label class="cw-form-label">Full Name *</label>
            <input class="cw-form-input" id="cw-book-name" type="text" placeholder="Jane Smith" />
          </div>
          <div class="cw-form-group">
            <label class="cw-form-label">Phone *</label>
            <input class="cw-form-input" id="cw-book-phone" type="tel" placeholder="0812345678" />
          </div>
          <div class="cw-form-group">
            <label class="cw-form-label">Email (optional)</label>
            <input class="cw-form-input" id="cw-book-email" type="email" placeholder="you@email.com" />
          </div>
          <div class="cw-form-group">
            <label class="cw-form-label">Notes (optional)</label>
            <input class="cw-form-input" id="cw-book-notes" type="text" placeholder="Any special requests?" />
          </div>
          <button class="cw-auth-submit" id="cw-book-submit-btn" onclick="cwSubmitGuestBooking()">Confirm Appointment</button>
        </div>
      </div>
    </div>
  </div>

  <div id="cw-toast"></div>
  `

  const container = document.createElement('div')
  container.innerHTML = markup
  document.body.appendChild(container)

  // ── FAB toggle ─────────────────────────────────────────────
  const $fab = document.getElementById('cw-fab')
  const $panel = document.getElementById('cw-panel')
  const $badge = document.getElementById('cw-badge')

  if (!sessionStorage.getItem('cw-opened')) $badge.classList.remove('hidden')

  $fab.addEventListener('click', () => {
    const isOpen = $panel.classList.toggle('open')
    $fab.classList.toggle('open', isOpen)
    if (isOpen) {
      $badge.classList.add('hidden')
      sessionStorage.setItem('cw-opened', '1')
      setTimeout(() => document.getElementById('cw-input')?.focus(), 300)
      cwScrollBottom()
    }
  })

  document.addEventListener('click', e => {
    const authOverlay = document.getElementById('cw-auth-overlay')
    const bookOverlay = document.getElementById('cw-book-overlay')
    if (!$panel.contains(e.target) && !$fab.contains(e.target) &&
      !authOverlay?.contains(e.target) && !bookOverlay?.contains(e.target) &&
      $panel.classList.contains('open')) {
      $panel.classList.remove('open')
      $fab.classList.remove('open')
    }
  })

  // ── Auth state ─────────────────────────────────────────────
  let cwToken = localStorage.getItem('lc_token') || localStorage.getItem('cw-token') || null
  let cwUser = null
  let cwLoggedIn = false

  const savedUser = localStorage.getItem('lc_user')
  if (savedUser) { try { cwUser = JSON.parse(savedUser); cwLoggedIn = !!cwToken } catch { } }

  // Restore session if token exists
  if (cwToken) cwVerifyToken()

  async function cwVerifyToken() {
    try {
      const r = await fetch(`${API_BASE}/auth/me`, { headers: { Authorization: `Bearer ${cwToken}` } })
      const d = await r.json()
      if (d.success) {
        cwUser = d.user
        cwLoggedIn = true
        cwUpdateAuthUI()
      } else {
        cwToken = null; localStorage.removeItem('lc_token'); localStorage.removeItem('cw-token'); localStorage.removeItem('lc_user')
      }
    } catch { cwToken = null; localStorage.removeItem('lc_token'); localStorage.removeItem('cw-token'); localStorage.removeItem('lc_user') }
  }

  function cwUpdateAuthUI() {
    const statusBtn = document.getElementById('cw-auth-status')
    const guestNotice = document.getElementById('cw-guest-notice')
    const myBookingsBtn = document.getElementById('cw-qbtn-mybookings')
    const rescheduleBtn = document.getElementById('cw-qbtn-reschedule')

    if (cwLoggedIn && cwUser) {
      statusBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:2px;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> ${cwUser.displayName.split(' ')[0]}`
      statusBtn.className = 'logged-in'
      statusBtn.onclick = cwDoLogout
      guestNotice.style.display = 'none'
      if (myBookingsBtn) myBookingsBtn.style.display = ''
      if (rescheduleBtn) rescheduleBtn.style.display = ''

      // Update welcome if first login
      const wb = document.querySelector('#cw-welcome-row .cw-bubble')
      if (wb && wb.dataset.updated !== '1') {
        wb.innerHTML = `Hello <strong>${cwUser.displayName}</strong>! 👋<br><br>
I'm your AI skin consultant. I can help you with:<br>
• Treatment recommendations<br>
• Booking appointments<br>
• Checking & managing your bookings<br>
• Cancel or reschedule via chat<br><br>
How can I help you today?`
        wb.dataset.updated = '1'
      }
    } else {
      statusBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:2px;"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg> Login'
      statusBtn.className = 'guest'
      statusBtn.onclick = cwOpenAuth
      guestNotice.style.display = 'flex'
      if (myBookingsBtn) myBookingsBtn.style.display = 'none'
      if (rescheduleBtn) rescheduleBtn.style.display = 'none'
    }
  }

  // ── Auth modal ─────────────────────────────────────────────
  window.cwOpenAuth = function () {
    document.getElementById('cw-auth-overlay').classList.add('open')
    document.getElementById('cw-auth-error').classList.remove('show')
    document.getElementById('cw-auth-error').textContent = ''
  }
  window.cwCloseAuth = function () {
    document.getElementById('cw-auth-overlay').classList.remove('open')
  }
  window.cwSwitchTab = function (tab) {
    document.querySelectorAll('.cw-auth-tab').forEach((t, i) => t.classList.toggle('active', (tab === 'login' && i === 0) || (tab === 'register' && i === 1)))
    document.getElementById('cw-login-form').classList.toggle('active', tab === 'login')
    document.getElementById('cw-register-form').classList.toggle('active', tab === 'register')
    document.getElementById('cw-auth-error').classList.remove('show')
  }

  function cwSetAuthError(msg) {
    const el = document.getElementById('cw-auth-error')
    el.textContent = msg; el.classList.add('show')
  }

  window.cwDoLogin = async function () {
    const email = document.getElementById('cw-login-email').value.trim()
    const password = document.getElementById('cw-login-password').value
    if (!email || !password) { cwSetAuthError('Please enter your email and password.'); return }
    const btn = document.getElementById('cw-login-btn')
    btn.disabled = true; btn.textContent = 'Logging in…'
    try {
      const r = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })
      const d = await r.json()
      if (d.success) {
        cwToken = d.token; cwUser = d.user; cwLoggedIn = true
        localStorage.setItem('lc_token', cwToken)
        localStorage.setItem('lc_user', JSON.stringify(cwUser))
        localStorage.setItem('cw-token', cwToken)
        // Notify navbar on this page without a refresh
        window.dispatchEvent(new CustomEvent('auth:login', { detail: { token: cwToken, user: cwUser } }))
        cwCloseAuth()
        cwUpdateAuthUI()
        cwAddBubble(`Welcome back, **${cwUser.displayName}**! 🌸 You're now logged in. You can book appointments, cancel, or reschedule via our chat. How can I help you?`, 'bot')
      } else {
        cwSetAuthError(d.message || 'Login failed. Please check your credentials.')
      }
    } catch { cwSetAuthError('Could not connect. Please try again.') }
    btn.disabled = false; btn.textContent = 'Log In'
  }

  window.cwDoRegister = async function () {
    const name = document.getElementById('cw-reg-name').value.trim()
    const email = document.getElementById('cw-reg-email').value.trim()
    const phone = document.getElementById('cw-reg-phone').value.trim()
    const idNumber = document.getElementById('cw-reg-id').value.trim()
    const password = document.getElementById('cw-reg-password').value
    if (!name || !email || !phone || !idNumber || !password) {
      cwSetAuthError('All fields are required.'); return
    }
    const btn = document.getElementById('cw-reg-btn')
    btn.disabled = true; btn.textContent = 'Creating account…'
    try {
      const r = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone, idNumber, password })
      })
      const d = await r.json()
      if (d.success) {
        cwToken = d.token; cwUser = d.user; cwLoggedIn = true
        localStorage.setItem('lc_token', cwToken)
        localStorage.setItem('lc_user', JSON.stringify(cwUser))
        localStorage.setItem('cw-token', cwToken)
        // Notify navbar on this page without a refresh
        window.dispatchEvent(new CustomEvent('auth:login', { detail: { token: cwToken, user: cwUser } }))
        cwCloseAuth()
        cwUpdateAuthUI()
        cwAddBubble(`Account created! Welcome, **${cwUser.displayName}**! 🌸 You can now book, cancel, and reschedule appointments directly via chat. How can I help you today?`, 'bot')
      } else {
        cwSetAuthError(d.message || 'Registration failed.')
      }
    } catch { cwSetAuthError('Could not connect. Please try again.') }
    btn.disabled = false; btn.textContent = 'Create Account'
  }

  function cwDoLogout() {
    cwToken = null; cwUser = null; cwLoggedIn = false
    localStorage.removeItem('lc_token')
    localStorage.removeItem('cw-token')
    localStorage.removeItem('lc_user')
    window.dispatchEvent(new Event('auth:logout'))
    cwUpdateAuthUI()
    cwAddBubble("You've been logged out. You can still browse services and get recommendations. 😊", 'bot')
  }

  // ── State ──────────────────────────────────────────────────
  let cwSessionId = localStorage.getItem('clinicSessionId')
  if (!cwSessionId) {
    cwSessionId = 'sess-' + Math.random().toString(36).slice(2, 9) + '-' + Date.now()
    localStorage.setItem('clinicSessionId', cwSessionId)
  }

  let cwRemaining = 20
  let cwIsLoading = false
  let cwAllServices = []
  let cwPendingServiceId = null
  let cwPendingServiceName = null
  let cwPendingServicePrice = null
  let cwPendingSlot = null
  let cwGeminiMode = false
  let cwRescheduleInProgress = false

  // Guest booking modal state
  let cwGuestBookServiceId = null
  let cwGuestBookSlot = null

  document.getElementById('cw-welcome-time').textContent = cwFmtTime(new Date())

  const $input = document.getElementById('cw-input')
  const $send = document.getElementById('cw-send-btn')
  const $msgs = document.getElementById('cw-messages')
  const $typing = document.getElementById('cw-typing-row')
  const $counter = document.getElementById('cw-msg-counter')
  const $charLine = document.getElementById('cw-char-line')

  $input.addEventListener('input', () => {
    $input.style.height = 'auto'
    $input.style.height = Math.min($input.scrollHeight, 88) + 'px'
    const len = $input.value.length
    $charLine.textContent = `${len} / 100`
    $charLine.className = len > 85 ? 'warn' : ''
  })
  $input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); cwSendMessage() }
  })

  // ── Helpers ────────────────────────────────────────────────
  function cwFmtTime(d) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Bangkok' })
  }
  function cwFmtDatetime(iso) {
    const normalized = (iso && !/Z$|[+-]\d{2}:\d{2}$/.test(iso)) ? iso + 'Z' : iso
    const d = new Date(normalized)
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Bangkok' })
      + ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Bangkok' })
  }
  function cwFmtDayLabel(dateStr) {
    return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-US',
      { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'Asia/Bangkok' })
  }
  function cwFmtPrice(p) { return Number(p).toLocaleString() + ' THB' }
  function cwScrollBottom() { setTimeout(() => $msgs.scrollTop = $msgs.scrollHeight, 40) }

  function cwShowToast(msg) {
    const t = document.getElementById('cw-toast')
    t.textContent = msg; t.classList.add('show')
    setTimeout(() => t.classList.remove('show'), 2800)
  }
  function cwSetTyping(on) {
    $typing.className = 'cw-msg-row bot' + (on ? ' visible' : '')
    if (on) cwScrollBottom()
  }
  function cwFmtBubble(text) {
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/^[•\-] (.+)$/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/gs, m => `<ul>${m}</ul>`)
      .replace(/\n\n/g, '<br><br>')
      .replace(/\n/g, '<br>')
  }

  function cwAddBubble(text, role) {
    const row = document.createElement('div')
    row.className = `cw-msg-row ${role}`
    const prev = $typing.previousElementSibling
    if (prev && prev.classList.contains(role) && prev.classList.contains('cw-msg-row')) {
      row.classList.add('cont')
    }
    const icon = document.createElement('div')
    icon.className = 'cw-row-icon'
    icon.innerHTML = role === 'bot'
      ? '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#b87166" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>'
      : '<span style="font-size:8px;font-weight:700;color:rgba(255,255,255,0.8);font-family:\'Jost\',sans-serif;">ME</span>'
    const wrap = document.createElement('div')
    wrap.className = 'cw-bubble-wrap'
    wrap.innerHTML = `<div class="cw-bubble">${cwFmtBubble(text)}</div>
      <div class="cw-msg-time">${cwFmtTime(new Date())}</div>`
    row.appendChild(icon); row.appendChild(wrap)
    $msgs.insertBefore(row, $typing)
    cwScrollBottom()
    return row
  }

  function cwAddWidget(innerHTML, label) {
    const div = document.createElement('div')
    div.className = 'cw-widget-row'
    div.innerHTML = (label ? `<div class="cw-widget-label">${label}</div>` : '') + innerHTML
    $msgs.insertBefore(div, $typing)
    cwScrollBottom()
    return div
  }

  // ── Services ───────────────────────────────────────────────
  // "Book this service" opens guest modal (Way 1) OR slot picker for logged-in (Way 2)
  window.cwShowAllServices = async function (filterCat = null) {
    if (cwAllServices.length === 0) {
      try {
        const r = await fetch(`${API_BASE}/appointments/services`)
        const d = await r.json()
        if (d.success) cwAllServices = d.services
      } catch { cwAddBubble('Could not load services. Please try again.', 'bot'); return }
    }
    const cats = [...new Set(cwAllServices.map(s => s.category))]
    const list = filterCat ? cwAllServices.filter(s => s.category === filterCat) : cwAllServices

    const tabsHtml = `<div class="cw-cat-tabs">
      <button class="cw-cat-tab ${!filterCat ? 'active' : ''}" onclick="cwShowAllServices(null)">All</button>
      ${cats.map(c => `<button class="cw-cat-tab ${filterCat === c ? 'active' : ''}" onclick="cwShowAllServices('${c}')">${c}</button>`).join('')}
    </div>`

    const cardsHtml = list.map(s => `
      <div class="cw-svc-card">
        <div class="cw-svc-name">${s.name}</div>
        <div class="cw-svc-price">${cwFmtPrice(s.price)}</div>
        <div class="cw-svc-desc">${s.description || ''}</div>
        <button class="cw-svc-book-btn" onclick="cwStartBooking(${s.id},'${s.name.replace(/'/g, "\\'")}',${s.price})">Book this service →</button>
      </div>`).join('')

    cwAddWidget(`${tabsHtml}<div class="cw-services-list">${cardsHtml}</div>`,
      filterCat ? `${filterCat} Services` : 'Our Services & Prices')
  }

  window.cwStartBooking = function (id, name, price) {
    cwPendingServiceId = id
    cwPendingServiceName = name
    cwPendingServicePrice = price
    cwAddBubble(`Great choice! Let's book **${name}** for ${cwFmtPrice(price)} 😊\nPick a date and time below.`, 'bot')
    cwAskForDate()
  }

  // ── Slot picker ────────────────────────────────────────────
  window.cwShowSlots = function (svcId = null, svcName = null, svcPrice = null) {
    if (svcId) { cwPendingServiceId = svcId; cwPendingServiceName = svcName; cwPendingServicePrice = svcPrice }
    cwAskForDate()
  }

  function cwAskForDate() {
    document.querySelectorAll('.cw-date-picker-widget').forEach(el => el.remove())
    const todayThai = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().split('T')[0]
    const maxDate = new Date(Date.now() + 7 * 60 * 60 * 1000)
    maxDate.setUTCDate(maxDate.getUTCDate() + 30)
    const maxStr = maxDate.toISOString().split('T')[0]

    const html = `<div class="cw-date-picker-widget" style="background:var(--cw-white);border:1px solid var(--cw-border);border-radius:18px;overflow:hidden;">
      <div style="background:var(--cw-navy);padding:8px 13px;display:flex;align-items:center;gap:7px;">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <span style="font-family:'Cormorant Garamond',serif;font-size:13px;font-weight:500;color:white;">Choose a Date</span>
      </div>
      <div style="padding:11px 13px;">
        <input type="date" id="cw-date-input" min="${todayThai}" max="${maxStr}" value="${todayThai}"
          style="width:100%;padding:7px 10px;border:1px solid var(--cw-border);border-radius:7px;
          font-family:'Jost',sans-serif;font-size:12px;color:var(--cw-ink);background:var(--cw-sand);cursor:pointer;outline:none;" />
        <button onclick="cwLoadSlotsForDate()" style="margin-top:8px;width:100%;padding:7px 0;
          background:var(--cw-rose);color:white;border:none;border-radius:18px;
          font-family:'Jost',sans-serif;font-size:12px;font-weight:600;cursor:pointer;">
          See Available Times →
        </button>
      </div>
    </div>`
    cwAddWidget(html)
  }

  window.cwLoadSlotsForDate = async function () {
    const input = document.getElementById('cw-date-input')
    if (!input) return
    const date = input.value
    if (!date) { cwShowToast('Please pick a date first!'); return }
    cwGeminiMode = false
    document.querySelectorAll('.cw-date-picker-widget').forEach(el => el.closest('.cw-widget-row')?.remove())

    const loader = cwAddWidget('<div style="text-align:center;padding:14px;font-size:11.5px;color:var(--cw-muted)">Loading slots…</div>')
    try {
      const r = await fetch(`${API_BASE}/appointments/slots?days=30`)
      const d = await r.json()
      loader.remove()
      if (!d.success) { cwAddBubble('Could not load slots. Please try again.', 'bot'); return }
      const dayData = (d.slots || []).find(day => day.date === date)
      if (!dayData || !dayData.slots.length) {
        cwAddBubble(`No available slots on ${cwFmtDayLabel(date)}. Please try another date. 😊`, 'bot')
        cwAskForDate(); return
      }
      cwRenderSlotPicker([dayData])
    } catch {
      loader.remove()
      cwAddBubble('Could not load slots. Is the server running?', 'bot')
    }
  }

  function cwRenderSlotPicker(days) {
    const svcBar = cwPendingServiceId
      ? `<div class="cw-slot-service-bar">
           <div class="cw-slot-service-name">${cwPendingServiceName}</div>
           <div class="cw-slot-service-price">${cwFmtPrice(cwPendingServicePrice)}</div>
         </div>`
      : `<div class="cw-slot-service-bar"><div class="cw-slot-service-name">Select a time to confirm</div></div>`

    const daysHtml = days.map(day => {
      const chips = day.slots.map(slot => {
        const t = new Date(slot.datetime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Bangkok' })
        const full = !slot.isAvailable
        return `<div class="cw-slot-chip${full ? ' full' : ''}"
          ${full ? '' : ` onclick="cwSelectSlot('${slot.datetime}','${t}',this)"`}
          title="${slot.remaining} spot(s) left">
          ${t}<span class="cw-chip-spots">${full ? 'full' : `(${slot.remaining})`}</span>
        </div>`
      }).join('')
      return `<div class="cw-slot-day">
        <div class="cw-slot-day-label">${cwFmtDayLabel(day.date)}</div>
        <div class="cw-slot-chips">${chips}</div>
      </div>`
    }).join('')

    const html = `<div class="cw-slot-picker">
      ${svcBar}
      <div class="cw-slot-scroll">${daysHtml}</div>
      <div class="cw-slot-footer">
        <div class="cw-slot-selection-info">
          <div class="cw-slot-selection-label">Selected slot</div>
          <div class="cw-slot-selection-val" id="cw-selected-slot-text">None selected</div>
        </div>
        <button class="cw-confirm-btn" id="cw-confirm-btn" onclick="cwConfirmBooking()" disabled>Confirm</button>
      </div>
    </div>`
    cwAddWidget(html, 'Available Appointments')
  }

  window.cwSelectSlot = function (datetime, timeDisplay, el) {
    document.querySelectorAll('.cw-slot-chip').forEach(c => c.classList.remove('selected'))
    el.classList.add('selected')
    cwPendingSlot = datetime
    const d = new Date(datetime)
    const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Bangkok' }) + ' · ' + timeDisplay
    const sv = document.getElementById('cw-selected-slot-text')
    if (sv) sv.textContent = label
    const btn = document.getElementById('cw-confirm-btn')
    if (btn) btn.disabled = false
  }

  // ── Confirm booking ────────────────────────────────────────
  window.cwConfirmBooking = async function () {
    if (!cwPendingSlot) return

    if (cwLoggedIn) {
      // Way 2: AI-assisted booking via chat
      if (cwGeminiMode) {
        // Gemini was guiding, pass slot back through chat
        const slotLabel = document.getElementById('cw-selected-slot-text')?.textContent || cwPendingSlot
        const thaiSlot = new Date(new Date(cwPendingSlot).getTime() + 7 * 60 * 60 * 1000)
          .toISOString().replace('Z', '').slice(0, 19)
        cwAddBubble(slotLabel, 'user')
        cwIsLoading = true; cwSetTyping(true)
        try {
          const r = await fetch(`${API_BASE}/chat`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cwToken}` },
            body: JSON.stringify({ message: `Book ${thaiSlot}`, sessionId: cwSessionId })
          })
          const d = await r.json()
          cwSetTyping(false)
          cwAddBubble(d.message || 'Something went wrong.', 'bot')
          if (typeof d.remaining === 'number') { cwRemaining = d.remaining; $counter.textContent = `${d.remaining} left` }
        } catch { cwSetTyping(false); cwAddBubble('Could not connect to server.', 'bot') }
        cwIsLoading = false; cwPendingSlot = null; cwGeminiMode = false
        return
      }

      // Logged in, direct booking via API
      if (!cwPendingServiceId) { cwShowToast('Select a service first!'); return }
      const btn = document.getElementById('cw-confirm-btn')
      if (btn) { btn.disabled = true; btn.textContent = 'Booking…' }
      try {
        const r = await fetch(`${API_BASE}/appointments/book`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cwToken}` },
          body: JSON.stringify({ serviceId: cwPendingServiceId, slotDatetime: cwPendingSlot })
        })
        const d = await r.json()
        if (d.success) {
          const a = d.appointment
          cwAddWidget(cwBuildConfirmCard(a))
          cwAddBubble("Your appointment is confirmed! Save your booking reference — you can use it to cancel or reschedule via chat. 😊", 'bot')
          cwPendingServiceId = null; cwPendingServiceName = null; cwPendingServicePrice = null; cwPendingSlot = null
        } else {
          cwShowToast(d.message || 'Booking failed.')
          cwAddBubble(d.message || 'Booking failed. Please try again.', 'bot')
          if (btn) { btn.disabled = false; btn.textContent = 'Confirm' }
        }
      } catch {
        cwShowToast('Connection error.')
        if (btn) { btn.disabled = false; btn.textContent = 'Confirm' }
      }
      return
    }

    // Guest (Way 1): open the guest details modal
    cwGuestBookServiceId = cwPendingServiceId
    cwGuestBookSlot = cwPendingSlot
    const slotLabel = document.getElementById('cw-selected-slot-text')?.textContent || ''

    document.getElementById('cw-book-modal-title').textContent = cwPendingServiceName || 'Book Appointment'
    document.getElementById('cw-book-modal-sub').textContent = slotLabel || 'Fill in your details to confirm'
    document.getElementById('cw-book-error').classList.remove('show')
    document.getElementById('cw-book-error').textContent = ''
      ;['cw-book-name', 'cw-book-phone', 'cw-book-email', 'cw-book-notes'].forEach(id => {
        document.getElementById(id).value = ''
      })
    document.getElementById('cw-book-overlay').classList.add('open')
  }

  window.cwCloseBookModal = function () {
    document.getElementById('cw-book-overlay').classList.remove('open')
  }

  // ── Guest booking submission (Way 1) ───────────────────────
  window.cwSubmitGuestBooking = async function () {
    const guestName = document.getElementById('cw-book-name').value.trim()
    const guestPhone = document.getElementById('cw-book-phone').value.trim()
    const guestEmail = document.getElementById('cw-book-email').value.trim()
    const notes = document.getElementById('cw-book-notes').value.trim()
    const errEl = document.getElementById('cw-book-error')

    if (!guestName) { errEl.textContent = 'Please enter your name.'; errEl.classList.add('show'); return }
    if (!guestPhone) { errEl.textContent = 'Please enter your phone number.'; errEl.classList.add('show'); return }
    if (!cwGuestBookServiceId || !cwGuestBookSlot) { errEl.textContent = 'Missing service or time selection. Please go back and try again.'; errEl.classList.add('show'); return }

    const btn = document.getElementById('cw-book-submit-btn')
    btn.disabled = true; btn.textContent = 'Confirming…'
    errEl.classList.remove('show')

    try {
      const r = await fetch(`${API_BASE}/appointments/book-guest`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guestName, guestPhone, guestEmail: guestEmail || null, notes: notes || null,
          serviceId: cwGuestBookServiceId, slotDatetime: cwGuestBookSlot
        })
      })
      const d = await r.json()
      if (d.success) {
        cwCloseBookModal()
        const a = d.appointment
        cwAddWidget(cwBuildConfirmCard({ ...a, guestName, guestPhone }))
        cwAddBubble(`Your appointment is confirmed, **${guestName}**! 🎉\nPlease save your booking reference **${a.bookingRef}**.\nIs there anything else I can help with?`, 'bot')
        cwPendingServiceId = null; cwPendingServiceName = null; cwPendingServicePrice = null
        cwPendingSlot = null; cwGuestBookServiceId = null; cwGuestBookSlot = null
      } else {
        errEl.textContent = d.message || 'Booking failed. Please try again.'
        errEl.classList.add('show')
      }
    } catch {
      errEl.textContent = 'Connection error. Please try again.'
      errEl.classList.add('show')
    }
    btn.disabled = false; btn.textContent = 'Confirm Appointment'
  }

  function cwBuildConfirmCard(a) {
    return `<div class="cw-confirm-card">
      <div class="cw-confirm-card-top">
        <div class="cw-confirm-icon"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(138,171,142,0.9)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>
        <div>
          <div class="cw-confirm-title">Appointment Confirmed</div>
          <div class="cw-confirm-sub">We look forward to seeing you</div>
        </div>
      </div>
      <div class="cw-confirm-body">
        ${a.guestName ? `<div class="cw-confirm-row"><span class="cw-confirm-key">Name</span><span class="cw-confirm-val">${a.guestName}</span></div>` : ''}
        <div class="cw-confirm-row"><span class="cw-confirm-key">Service</span><span class="cw-confirm-val">${a.service}</span></div>
        <div class="cw-confirm-row"><span class="cw-confirm-key">Date & Time</span><span class="cw-confirm-val">${cwFmtDatetime(a.slotDatetime)}</span></div>
        <div class="cw-confirm-row"><span class="cw-confirm-key">Price</span><span class="cw-confirm-val">${cwFmtPrice(a.price)}</span></div>
      </div>
      <div class="cw-booking-ref-strip">
        <span class="cw-booking-ref-label">Booking Reference</span>
        <span class="cw-booking-ref-code">${a.bookingRef}</span>
      </div>
    </div>`
  }

  // ── My appointments (logged-in only) ───────────────────────
  window.cwShowMyAppointments = async function () {
    if (!cwLoggedIn) { cwOpenAuth(); return }
    const loader = cwAddWidget('<div style="text-align:center;padding:14px;font-size:11.5px;color:var(--cw-muted)">Loading your appointments…</div>')
    try {
      const r = await fetch(`${API_BASE}/appointments/my`, { headers: { Authorization: `Bearer ${cwToken}` } })
      const d = await r.json()
      loader.remove()
      const confirmed = (d.appointments || []).filter(a => a.status === 'confirmed')
      if (!confirmed.length) {
        cwAddBubble("You don't have any upcoming appointments. Would you like to book one? 😊", 'bot'); return
      }
      const html = confirmed.map(a => `
        <div class="cw-appt-item">
          <div class="cw-appt-top">
            <div class="cw-appt-service">${a.services?.name}</div>
            <div class="cw-appt-ref-badge">${a.booking_ref}</div>
          </div>
          <div class="cw-appt-time">${cwFmtDatetime(a.slot_datetime)}</div>
          <div class="cw-appt-price">฿ ${cwFmtPrice(a.services?.price)}</div>
        </div>`).join('')
      cwAddWidget(`<div class="cw-appts-list">${html}</div>`, `Your Appointments (${confirmed.length})`)
    } catch {
      loader.remove()
      cwAddBubble('Could not load appointments. Please try again.', 'bot')
    }
  }

  // ── Booking receipt lookup ─────────────────────────────────
  async function cwShowBookingReceipt(bookingRef) {
    if (!cwLoggedIn) return
    try {
      const r = await fetch(`${API_BASE}/appointments/my`, { headers: { Authorization: `Bearer ${cwToken}` } })
      const d = await r.json()
      if (!d.success) return
      const appt = (d.appointments || []).find(a => a.booking_ref === bookingRef)
      if (!appt) {
        cwAddBubble(`I couldn't find booking **${bookingRef}** on your account. Please double-check the reference 😊`, 'bot'); return
      }
      const statusColor = appt.status === 'confirmed' ? '#2d6a4f' : '#c0392b'
      const statusBg = appt.status === 'confirmed' ? '#d8f3dc' : '#fde8e8'
      cwAddWidget(`<div style="padding:2px;">
        <div style="font-size:9.5px;font-weight:700;letter-spacing:.08em;color:var(--cw-muted);margin-bottom:8px;">BOOKING FOUND</div>
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;margin-bottom:6px;">
          <div style="font-family:'Cormorant Garamond',serif;font-size:14px;font-weight:700;color:var(--cw-ink);">${appt.services?.name}</div>
          <span style="font-size:9.5px;font-weight:700;padding:2px 7px;border-radius:20px;background:${statusBg};color:${statusColor};white-space:nowrap;">${appt.status.toUpperCase()}</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:3px;font-size:11.5px;color:var(--cw-muted);">
          <div>${cwFmtDatetime(appt.slot_datetime)}</div>
          <div>Ref: <strong style="color:var(--cw-ink);font-family:monospace;">${appt.booking_ref}</strong></div>
          <div>฿ <strong style="color:var(--cw-ink);">${cwFmtPrice(appt.services?.price)}</strong></div>
          ${appt.notes ? `<div>${appt.notes}</div>` : ''}
        </div>
      </div>`, 'Appointment Details')
    } catch { /* Silently fail */ }
  }

  // ── Send message ───────────────────────────────────────────
  window.cwSendQuick = function (text) { $input.value = text; cwSendMessage() }

  window.cwSendMessage = async function () {
    const msg = $input.value.trim()
    if (!msg || cwIsLoading) return
    if (msg.length > 100) { cwShowToast('Max 100 characters!'); return }
    if (cwRemaining <= 0) { cwShowToast('Daily message limit reached 😊'); return }

    const lower = msg.toLowerCase()
    const isRescheduleIntent = /\b(reschedule|change.*time|change.*date|change.*appointment|move.*appointment|update.*appointment)\b/.test(lower)
    const isBookIntent = !isRescheduleIntent && /\b(book|appointment|schedule|reserve|slot|want to book|like to book)\b/.test(lower)
    const isServiceIntent = /\b(service|treatment|offer|price|cost|how much|menu|what do you have)\b/.test(lower)
    const isMyAppts = /\b(my booking|my appointment|my reservation|what did i book)\b/.test(lower)
    const isCancelIntent = /\b(cancel|cancellation)\b/.test(lower)

    // Service info — always allowed
    if (isServiceIntent && !isBookIntent) {
      cwAddBubble(msg, 'user')
      $input.value = ''; $input.style.height = 'auto'; $charLine.textContent = '0 / 100'
      cwAddBubble("Here are our services! Tap a category to filter, or click **Book this service** to get started 😊", 'bot')
      cwShowAllServices(); return
    }

    // My appointments — requires login
    if (isMyAppts) {
      cwAddBubble(msg, 'user')
      $input.value = ''; $input.style.height = 'auto'; $charLine.textContent = '0 / 100'
      if (!cwLoggedIn) {
        cwAddBubble("To view your appointments, please log in first. 😊", 'bot')
        cwOpenAuth(); return
      }
      cwShowMyAppointments(); return
    }

    // Reschedule / cancel — requires login
    if ((isRescheduleIntent || isCancelIntent) && !cwRescheduleInProgress) {
      cwAddBubble(msg, 'user')
      $input.value = ''; $input.style.height = 'auto'; $charLine.textContent = '0 / 100'
      if (!cwLoggedIn) {
        cwAddBubble("To reschedule or cancel appointments, please log in first. Your booking history is linked to your account. 😊", 'bot')
        cwOpenAuth(); return
      }
      cwRescheduleInProgress = true
      cwAddBubble("Sure! Please enter your **booking reference** (e.g. TCB-20260605-001) and I'll get that sorted for you 😊", 'bot')
      return
    }

    // Booking intent — guests redirected to services panel + guest form
    if (isBookIntent) {
      cwAddBubble(msg, 'user')
      $input.value = ''; $input.style.height = 'auto'; $charLine.textContent = '0 / 100'
      if (!cwLoggedIn) {
        cwAddBubble("Sure! Browse our services below and click **Book this service** to make a quick booking — no login required! 😊\n\nOr **log in** to book via our AI chat for a more personalised experience.", 'bot')
        cwShowAllServices(); return
      }
      cwAddBubble("Sure! Which service would you like to book? Here's what we offer 👇", 'bot')
      cwShowAllServices(); return
    }

    // Booking ref lookup
    const bookingRefMatch = msg.match(/\bTCB-\d{8}-\d{3}\b/i)
    if (bookingRefMatch) {
      cwAddBubble(msg, 'user')
      $input.value = ''; $input.style.height = 'auto'; $charLine.textContent = '0 / 100'
      if (!cwLoggedIn) {
        cwAddBubble("To look up a booking, please log in first. 😊", 'bot')
        cwOpenAuth(); return
      }
      cwRescheduleInProgress = true
      await cwShowBookingReceipt(bookingRefMatch[0].toUpperCase())
      return
    }

    if (!bookingRefMatch) cwAddBubble(msg, 'user')
    $input.value = ''; $input.style.height = 'auto'
    $charLine.textContent = '0 / 100'; $charLine.className = ''
    cwRescheduleInProgress = false

    cwIsLoading = true; $send.disabled = true; cwSetTyping(true)

    // Wait for Render to wake up if still cold-starting
    if (!cwServerReady) {
      const t0 = Date.now()
      while (!cwServerReady && Date.now() - t0 < 28000) {
        await new Promise(r => setTimeout(r, 800))
      }
      if (!cwServerReady) {
        cwSetTyping(false)
        cwAddBubble('Server is starting up — please try again in a moment 🔌', 'bot')
        cwIsLoading = false; $send.disabled = false
        return
      }
    }

    try {
      const headers = { 'Content-Type': 'application/json' }
      if (cwToken) headers['Authorization'] = `Bearer ${cwToken}`

      const r = await fetch(`${API_BASE}/chat`, {
        method: 'POST', headers,
        body: JSON.stringify({ message: msg, sessionId: cwSessionId })
      })
      const d = await r.json()
      cwSetTyping(false)

      if (d.slots && d.slots.length && cwLoggedIn) {
        // Logged in: show slot picker for AI-guided booking
        cwGeminiMode = true; cwRescheduleInProgress = false
        if (d.message) cwAddBubble(d.message, 'bot')
        cwRenderSlotPicker(d.slots)
      } else {
        cwAddBubble(d.message || 'Something went wrong.', 'bot')
        if (d.message && /rescheduled|cancelled|confirmed|anything else/i.test(d.message)) {
          cwRescheduleInProgress = false
        }
      }
      if (typeof d.remaining === 'number') { cwRemaining = d.remaining; $counter.textContent = `${d.remaining} left` }
    } catch {
      cwSetTyping(false)
      cwAddBubble('Could not connect to server. Is your backend running? 🔌', 'bot')
    }

    cwIsLoading = false; $send.disabled = false; $input.focus()
  }

  // Init UI
  cwUpdateAuthUI()

})()