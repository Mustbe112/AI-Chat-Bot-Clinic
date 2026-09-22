const express = require('express')
const router  = express.Router()
const prisma = require('../services/prisma')
const { logActivity, deriveStage, readTokenUserId, claimSessionBookings } = require('../services/pipeline')

function sessionFrom(req) {
  return req.body?.sessionId || req.query.sessionId || null
}

// POST /activity — client page views only
router.post('/', async (req, res) => {
  try {
    const event = req.body?.event
    if (event !== 'page_view' && event !== 'view_services') {
      return res.status(400).json({ success: false, message: 'Only page_view or view_services is accepted from the client.' })
    }
    const path = typeof req.body.path === 'string' ? req.body.path : null
    await logActivity({
      userId:    readTokenUserId(req),
      sessionId: sessionFrom(req),
      event,
      path,
      meta:      req.body.meta || undefined
    })
    res.json({ success: true })
  } catch (error) {
    console.error('Activity post error:', error)
    res.status(500).json({ success: false, message: 'Could not record activity.' })
  }
})

// GET /activity/stage — widget / chatbot chip
router.get('/stage', async (req, res) => {
  try {
    const sessionId = sessionFrom(req)
    let userId = readTokenUserId(req)
    if (userId) await claimSessionBookings(userId, sessionId)

    if (!userId && sessionId) {
      const linked = await prisma.user_activity.findFirst({
        where: { session_id: sessionId, user_id: { not: null } },
        orderBy: { created_at: 'desc' },
        select: { user_id: true }
      })
      if (linked && linked.user_id) userId = linked.user_id
    }

    const pipeline = await deriveStage(userId, sessionId)
    res.json({
      success:     true,
      stage:       pipeline.stage,
      recent:      pipeline.recent,
      recommended: pipeline.recommended || []
    })
  } catch (error) {
    console.error('Activity stage error:', error)
    res.status(500).json({ success: false, message: 'Could not derive stage.' })
  }
})

module.exports = router
