const jwt    = require('jsonwebtoken')
const prisma = require('./prisma')

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production'

const ALLOWED_EVENTS = new Set([
  'page_view', 'chat', 'login', 'register',
  'view_slots', 'view_services',
  'book', 'book_guest', 'cancel', 'reschedule'
])

const STAGE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

const STAGE_RULES = {
  visitor:     'Introduce the clinic briefly and invite them to share a skin concern.',
  browsing:    'They already looked at treatments. Help them pick one. Do not re-list the whole catalog unless asked.',
  chatting:    'They are mid-conversation. Do not restart the welcome. Continue the thread.',
  considering: 'They looked at appointment times. Offer to finish booking. If they are a guest, point them to Book Now or log in.',
  booked:      'They have an upcoming visit. Offer manage, cancel, or reschedule. Do not hard-sell a new booking unless they ask.',
  returning:   'Welcome them back. Offer help with a new visit or questions about a past treatment.'
}

function readTokenUserId(req) {
  const cookieToken = (req.cookies && req.cookies.token)
    || (req.signedCookies && req.signedCookies.token)
  const header = req.headers.authorization
  const bearer = header && header.startsWith('Bearer ') ? header.slice(7) : null
  const token  = cookieToken || bearer
  if (!token) return null
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    const id = Number(payload.userId)
    return Number.isFinite(id) ? id : null
  } catch {
    return null
  }
}

function pushOwner(ors, owner) {
  if (!owner) return
  ors.push({ user_id: owner.id })
  if (owner.email) ors.push({ guest_email: String(owner.email).toLowerCase().trim() })
  if (owner.phone) ors.push({ guest_phone: String(owner.phone).trim() })
}

async function ownedAppointmentWhere(user, sessionId) {
  const ors = []
  pushOwner(ors, user)

  if (sessionId) {
    const sessionUser = await prisma.users.findUnique({
      where: { session_id: sessionId },
      select: { id: true, is_registered: true, email: true, phone: true }
    })
    if (sessionUser && !sessionUser.is_registered) {
      ors.push({ user_id: sessionUser.id })
    }

    // Same browser session after login: cookie may be missing on some
    // requests, but /auth/me already recorded this session for the account.
    if (!user) {
      const linked = await prisma.user_activity.findFirst({
        where: { session_id: sessionId, user_id: { not: null } },
        orderBy: { created_at: 'desc' },
        select: { user_id: true }
      })
      if (linked && linked.user_id) {
        const linkedUser = await prisma.users.findUnique({
          where: { id: linked.user_id },
          select: { id: true, email: true, phone: true, is_registered: true }
        })
        if (linkedUser && linkedUser.is_registered) pushOwner(ors, linkedUser)
      }
    }
  }
  return ors
}

async function logActivity({ userId, sessionId, event, path, meta }) {
  if (!ALLOWED_EVENTS.has(event)) return
  try {
    await prisma.user_activity.create({
      data: {
        user_id:    userId || null,
        session_id: sessionId || null,
        event,
        path:       path ? String(path).slice(0, 200) : null,
        meta:       meta || undefined
      }
    })
  } catch (err) {
    console.error('logActivity error:', err.message)
  }
}

function interestKey(text) {
  const t = String(text || '').toLowerCase()
  if (/acne|blemish|oil|pore|blackhead/.test(t)) return 'acne'
  if (/bright|white|pigment|spot|melasma|glutathione/.test(t)) return 'brightening'
  if (/wrinkle|collagen|anti-age|aging|eye|firm/.test(t)) return 'aging'
  if (/hydra|moisture|hydrat|dry|sensitive|barrier/.test(t)) return 'hydration'
  if (/laser/.test(t)) return 'laser'
  if (/consult/.test(t)) return 'consult'
  return null
}

const RELATED_IDS = {
  acne:        [1, 2, 3, 12],
  brightening: [4, 5, 6, 13],
  aging:       [7, 8, 9],
  hydration:   [10, 11],
  laser:       [12, 13],
  consult:     [14]
}

function recReason(stage, key, lastName) {
  if (stage === 'booked' && lastName) return `Pairs well after ${lastName}`
  if (stage === 'returning' && lastName) return `Follow-up to your last ${lastName}`
  if (stage === 'considering') return 'You were checking appointment times'
  if (key === 'acne') return 'Based on acne / pore interest'
  if (key === 'brightening') return 'Based on brightening interest'
  if (key === 'aging') return 'Based on firming / anti-aging interest'
  if (key === 'hydration') return 'Based on hydration interest'
  if (stage === 'browsing') return 'Popular after browsing our menu'
  return 'A good starting point at Lumière'
}

async function buildRecommendations({ stage, events, lastServiceName, bookedServiceIds }) {
  const catalog = await prisma.services.findMany({
    where: { is_active: true },
    select: { id: true, name: true, category: true, price: true, description: true }
  })
  const byId = new Map(catalog.map(s => [s.id, s]))
  const scores = new Map()

  function bump(id, pts) {
    if (!byId.has(id)) return
    scores.set(id, (scores.get(id) || 0) + pts)
  }

  const keys = new Set()
  if (lastServiceName) {
    const key = interestKey(lastServiceName)
    if (key) keys.add(key)
  }
  for (const ev of events) {
    const meta = ev.meta && typeof ev.meta === 'object' ? ev.meta : {}
    const sid = Number(meta.serviceId)
    if (sid && byId.has(sid)) {
      bump(sid, ev.event === 'book' || ev.event === 'book_guest' ? 8 : 5)
      const key = interestKey(byId.get(sid).name + ' ' + byId.get(sid).category)
      if (key) keys.add(key)
    }
    if (ev.event === 'page_view' && /price/i.test(ev.path || '')) bump(14, 1)
    if (ev.event === 'view_slots') bump(14, 2)
  }
  for (const id of bookedServiceIds || []) {
    const svc = byId.get(Number(id))
    if (!svc) continue
    bump(svc.id, 6)
    const key = interestKey(svc.name + ' ' + svc.category)
    if (key) keys.add(key)
  }

  if (!keys.size) {
    if (stage === 'booked' || stage === 'returning') keys.add('hydration')
    else keys.add('consult')
  }

  for (const key of keys) {
    for (const id of RELATED_IDS[key] || []) bump(id, 4)
  }

  if (stage === 'visitor' || stage === 'browsing') {
    ;[14, 1, 10, 4].forEach(id => bump(id, 2))
  }
  if (stage === 'considering') {
    ;[14].forEach(id => bump(id, 2))
  }

  // If they already have an upcoming booking, prefer complements over the same service
  if (stage === 'booked') {
    for (const id of bookedServiceIds || []) bump(Number(id), -3)
  }

  const ranked = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => byId.get(id))
    .filter(Boolean)

  const picks = []
  for (const svc of ranked) {
    if (picks.length >= 3) break
    const key = interestKey(svc.name + ' ' + svc.category)
    picks.push({
      id:          svc.id,
      name:        svc.name,
      category:    svc.category,
      price:       Number(svc.price),
      description: svc.description || '',
      reason:      recReason(stage, key, lastServiceName)
    })
  }
  return picks
}

function summarizeEvent(row) {
  if (row.event === 'page_view') return `viewed ${row.path || 'a page'}`
  if (row.event === 'view_slots') return 'viewed slots'
  if (row.event === 'view_services') {
    const name = row.meta && row.meta.serviceName
    return name ? `viewed ${name}` : 'viewed services'
  }
  if (row.event === 'chat') return 'sent a chat message'
  if (row.event === 'login') return 'logged in'
  if (row.event === 'register') return 'created an account'
  if (row.event === 'book' || row.event === 'book_guest') return 'booked an appointment'
  if (row.event === 'cancel') return 'cancelled a booking'
  if (row.event === 'reschedule') return 'rescheduled a booking'
  return row.event
}

function isBrowsePath(path) {
  if (!path) return false
  return /price|about|booking/i.test(path)
}

async function deriveStage(userId, sessionId) {
  try {
    return await deriveStageUnsafe(userId, sessionId)
  } catch (err) {
    console.error('deriveStage error:', err.message)
    return { stage: 'visitor', recent: [], upcomingCount: 0, lastServiceName: null, recommended: [] }
  }
}

async function deriveStageUnsafe(userId, sessionId) {
  const since = new Date(Date.now() - STAGE_WINDOW_MS)
  const now   = new Date()

  const identityFilters = []
  if (userId) identityFilters.push({ user_id: userId })
  if (sessionId) identityFilters.push({ session_id: sessionId })

  let events = []
  if (identityFilters.length) {
    events = await prisma.user_activity.findMany({
      where: {
        AND: [
          { OR: identityFilters },
          { created_at: { gte: since } }
        ]
      },
      select: { event: true, path: true, created_at: true, meta: true },
      orderBy: { created_at: 'desc' },
      take: 50
    })
  }

  let upcomingCount    = 0
  let lastServiceName  = null
  let hasPastBooking   = false
  let bookedServiceIds = []

  const owner = userId
    ? await prisma.users.findUnique({
        where: { id: Number(userId) },
        select: { id: true, email: true, phone: true }
      })
    : null
  const ownerOrs = await ownedAppointmentWhere(owner, sessionId)
  if (ownerOrs.length) {
    const appts = await prisma.appointments.findMany({
      where: { status: 'confirmed', OR: ownerOrs },
      select: {
        slot_datetime: true,
        service_id: true,
        services: { select: { name: true } }
      },
      orderBy: { slot_datetime: 'desc' },
      take: 20
    })
    const upcoming = appts.filter(a => new Date(a.slot_datetime) >= now)
    const past     = appts.filter(a => new Date(a.slot_datetime) < now)
    upcomingCount   = upcoming.length
    hasPastBooking  = past.length > 0
    lastServiceName = (upcoming[0] || past[0])?.services?.name || null
    bookedServiceIds = appts.map(a => a.service_id).filter(Boolean)
  }

  const eventNames  = new Set(events.map(e => e.event))
  const browsed     = eventNames.has('view_services')
    || events.some(e => e.event === 'page_view' && isBrowsePath(e.path))
  const chatted     = eventNames.has('chat')
  const considering = eventNames.has('view_slots')

  let stage = 'visitor'
  if (upcomingCount > 0) stage = 'booked'
  else if (hasPastBooking) stage = 'returning'
  else if (considering) stage = 'considering'
  else if (chatted) stage = 'chatting'
  else if (browsed) stage = 'browsing'

  const recommended = await buildRecommendations({
    stage,
    events,
    lastServiceName,
    bookedServiceIds
  })

  return {
    stage,
    recent: events.slice(0, 8).map(summarizeEvent),
    upcomingCount,
    lastServiceName,
    recommended
  }
}

function stagePrompt(stage, extras = {}) {
  const recent   = (extras.recent || []).join(', ') || 'none'
  const upcoming = extras.upcomingCount
    ? `${extras.upcomingCount} upcoming appointment(s)`
    : 'none'
  const last     = extras.lastServiceName || 'unknown'
  const rule     = STAGE_RULES[stage] || STAGE_RULES.visitor
  const returningNote = (stage === 'returning' && extras.lastServiceName)
    ? ` Their last service was ${extras.lastServiceName}.`
    : ''
  const recs = extras.recommended || []
  const recBlock = recs.length
    ? recs.map((s, i) =>
      `${i + 1}. ${s.name} (${s.price} THB) — ${s.reason}`
    ).join('\n')
    : 'none yet'

  return `

USER PIPELINE STAGE: ${stage}
Recent: ${recent}
Upcoming: ${upcoming}
Last service: ${last}

STAGE RULES:
${rule}${returningNote}

RECOMMENDED SERVICES (from their activity — lead with these):
${recBlock}
When they ask what to book, what you recommend, or which treatment to get, suggest these first and say why in one short line. Do not dump all 14 services unless they ask for the full menu.
`
}

async function claimSessionBookings(userId, sessionId) {
  if (!userId || !sessionId) return
  try {
    const guest = await prisma.users.findUnique({
      where: { session_id: sessionId },
      select: { id: true, is_registered: true }
    })
    if (!guest || guest.is_registered || guest.id === userId) return
    await prisma.appointments.updateMany({
      where: { user_id: guest.id },
      data:  { user_id: userId }
    })
  } catch (err) {
    console.error('claimSessionBookings error:', err.message)
  }
}

module.exports = {
  ALLOWED_EVENTS,
  logActivity,
  deriveStage,
  stagePrompt,
  readTokenUserId,
  claimSessionBookings,
  ownedAppointmentWhere
}
