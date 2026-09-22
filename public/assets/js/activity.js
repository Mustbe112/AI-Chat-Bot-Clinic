;(function () {
  const API_BASE = window.CLINIC_API_BASE || 'https://ai-chat-bot-clinic.onrender.com'

  let sessionId = localStorage.getItem('clinicSessionId')
  if (!sessionId) {
    sessionId = 'sess-' + Math.random().toString(36).slice(2, 9) + '-' + Date.now()
    localStorage.setItem('clinicSessionId', sessionId)
  }

  fetch(API_BASE + '/activity', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'page_view',
      path: location.pathname,
      sessionId: sessionId
    })
  }).catch(function () { /* ignore network errors */ })
})()
