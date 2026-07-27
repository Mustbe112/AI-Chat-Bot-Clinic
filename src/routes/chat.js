const express    = require('express')
const router     = express.Router()
const jwt        = require('jsonwebtoken')
const { chat }   = require('../services/gemini')
const supabase   = require('../services/supabase')
const prisma = require('../services/prisma')
const e = require('express')

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production'

// Resolve user from JWT (preferred) or sessionId fallback.
// Returns { user, isLoggedIn }
async function resolveUser(req, displayName = 'Guest') {
  //  JWT path 
  const header = req.headers.authorization
  if (header && header.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(header.slice(7), JWT_SECRET)

      const user = await prisma.users.findUnique({
        where:{id: payload.userId}
      })

      if (user) return { user, isLoggedIn: true }
    } catch { /* fall through to sessionId */ }
  }

  //  sessionId path (guest)
  const { sessionId } = req.body
  if (!sessionId) return { user: null, isLoggedIn: false }

  const existing = await prisma.users.findUnique({
    where:{session_id: sessionId}
  })

  if (existing) return { user: existing, isLoggedIn: existing.is_registered || false }

  // Create new guest session user
  try{
    const newUser = await prisma.users.create({
      data:{
        display_name:displayName,
        session_id:sessionId,
        is_registered:false,
        picture_url:`https://api.dicebear.com/7.x/personas/svg?seed=${sessionId}`
      }
    })
    return {user: newUser, isLoggedIn:false}
  }catch(error){
    console.error('Error creating guest user : ',error)
    return {user:null, isLoggedIn:false}
  }
}

//  POST /chat

router.post('/', async (req, res) => {
  try {
    const { message, displayName } = req.body

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ success: false, message: 'Message is required.' })
    }

    const { user, isLoggedIn } = await resolveUser(req, displayName)
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

//  GET /chat/history
// Lightweight helper: resolve only the userId without creating guest rows
async function resolveUserId(req) {
  const header = req.headers.authorization
  if (header && header.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(header.slice(7), JWT_SECRET)
      return payload.userId
    } catch {}
  }
  const sessionId = req.query.sessionId || req.body?.sessionId
  if (sessionId) {
   const user = await prisma.users.findUnique({
    where:{session_id:sessionId},
    select:{id:true}
   })
   return user?.id || null
  }
  return null
}

router.get('/history', async (req, res) => {
  try {
    const userId = await resolveUserId(req)

    if (!userId) return res.json({ success: true, history: [] })

    const history = await prisma.chat_history.findMany({
      where:{user_id :userId},
      select:{role:true, content:true, created_at:true},
      orderBy:{created_at:'asc'},
      take:50
    })

    return res.json({ success: true, history: history || [] })
  } catch (error) {
    console.error('History route error:', error)
    res.status(500).json({ success: false, message: 'Internal server error.' })
  }
})

module.exports = router