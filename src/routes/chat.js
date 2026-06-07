// ============================================================
//  routes/chat.js  (v2)
//  Accepts either:
//   • Bearer token  (registered user, Way 2 logged-in chatbot)
//   • sessionId body param (guest browsing, Way 2 unauthenticated)
// ============================================================

const express  = require('express')
const router   = express.Router()
const { chat } = require('../services/gemini')
const supabase = require('../services/supabase')

// Resolve user from JWT (preferred) or sessionId fallback.
// Returns { user, isLoggedIn }
async function resolveUser(req, displayName = 'Guest') {
  // ── JWT path ──────────────────────────────────────────
  const header = req.headers.authorization
  if (header && header.startsWith('Bearer ')) {
    try {
      const jwt     = require('jsonwebtoken')
      const secret  = process.env.JWT_SECRET || 'change-me-in-production'
      const payload = jwt.verify(header.slice(7), secret)

      const { data: user } = await supabase
        .from('users')
        .select('*')
        .eq('id', payload.userId)
        .single()

      if (user) return { user, isLoggedIn: true }
    } catch { /* fall through to sessionId */ }
  }

  // ── sessionId path (guest) ────────────────────────────
  const { sessionId } = req.body
  if (!sessionId) return { user: null, isLoggedIn: false }

  const { data: existing } = await supabase
    .from('users')
    .select('*')
    .eq('session_id', sessionId)
    .single()

  if (existing) return { user: existing, isLoggedIn: existing.is_registered || false }

  // Create new guest session user
  const { data: newUser, error } = await supabase
    .from('users')
    .insert({
      display_name:  displayName,
      session_id:    sessionId,
      is_registered: false,
      picture_url:   `https://api.dicebear.com/7.x/personas/svg?seed=${sessionId}`
    })
    .select()
    .single()

  if (error) { console.error('Error creating guest user:', error); return { user: null, isLoggedIn: false } }
  return { user: newUser, isLoggedIn: false }
}

// ============================================================
//  POST /chat
// ============================================================
router.post('/', async (req, res) => {
  try {
    const { message, displayName } = req.body

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ success: false, message: 'Message is required.' })
    }

    const { user, isLoggedIn } = await resolveUser(req, displayName || 'Guest')
    if (!user) {
      return res.status(500).json({ success: false, message: 'Could not initialize session.' })
    }

    // Pass isLoggedIn flag to Gemini so it can gate booking actions
    const result = await chat(user.id, message.trim(), isLoggedIn)

    return res.json({
      success:    result.success,
      message:    result.message,
      remaining:  result.remaining,
      slots:      result.slots || null,
      isLoggedIn,
      user: {
        id:          user.id,
        displayName: user.display_name,
        pictureUrl:  user.picture_url,
        isLoggedIn
      }
    })
  } catch (error) {
    console.error('Chat route error:', error)
    res.status(500).json({ success: false, message: 'Internal server error.' })
  }
})

// ============================================================
//  GET /chat/history
// ============================================================
router.get('/history', async (req, res) => {
  try {
    const { sessionId } = req.query

    // Also support Bearer token for history
    let userId = null
    const header = req.headers.authorization
    if (header && header.startsWith('Bearer ')) {
      try {
        const jwt     = require('jsonwebtoken')
        const secret  = process.env.JWT_SECRET || 'change-me-in-production'
        const payload = jwt.verify(header.slice(7), secret)
        userId = payload.userId
      } catch {}
    }

    if (!userId && sessionId) {
      const { data: user } = await supabase
        .from('users').select('id').eq('session_id', sessionId).single()
      userId = user?.id
    }

    if (!userId) return res.json({ success: true, history: [] })

    const { data: history } = await supabase
      .from('chat_history')
      .select('role, content, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(50)

    return res.json({ success: true, history: history || [] })
  } catch (error) {
    console.error('History route error:', error)
    res.status(500).json({ success: false, message: 'Internal server error.' })
  }
})

module.exports = router