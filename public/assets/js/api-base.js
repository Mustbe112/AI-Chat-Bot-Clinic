;(function (global) {
  var loc  = global.location || {}
  var host = loc.hostname || ''
  var local = host === 'localhost' || host === '127.0.0.1'
  if (!local) {
    global.CLINIC_API_BASE = 'https://ai-chat-bot-clinic.onrender.com'
    return
  }
  // Same-origin when Express is already serving this page (port 3000).
  // Other local ports (Live Server, etc.) must call Express on 3000.
  var port = String(loc.port || '')
  global.CLINIC_API_BASE = (port === '3000' || port === '') ? '' : 'http://localhost:3000'
})(window)
