const express  = require('express')
const router   = express.Router()
const prisma   = require('../services/prisma')
const { getAvailableSlots, isSlotAvailable } = require('../services/scheduler')
const { logActivity, readTokenUserId, claimSessionBookings, ownedAppointmentWhere } = require('../services/pipeline')

const TZ_OFFSET_MS = 7 * 60 * 60 * 1000
function thaiLocalToUTC(isoStr) {
  if (/Z$|[+-]\d{2}:\d{2}$/.test(isoStr)) return new Date(isoStr).toISOString()
  const localMs = Date.parse(isoStr + 'Z')
  return new Date(localMs - TZ_OFFSET_MS).toISOString()
}

// Helper: resolve user from either JWT userId (req.userId set by middleware)
// or legacy sessionId query/body param.  Returns user row or null.
async function resolveUser(req) {
  // JWT path (logged-in user, Way 2 chatbot or any future auth'd request)
  if (req.userId) {
    return await prisma.users.findUnique({
      where: { id: req.userId },
      select: { id: true, display_name: true, email: true, phone: true }
    })
  }
  // Session-id path (legacy / guest chatbot browsing)
  const sessionId = req.query.sessionId || req.body?.sessionId
  if (!sessionId) return null
  return await prisma.users.findUnique({
    where: { session_id: sessionId },
    select: { id: true, display_name: true, email: true, phone: true }
  })
}

function activitySession(req) {
  return req.query.sessionId || req.body?.sessionId || null
}

// Optional auth — cookie or Bearer. Does not reject guests.
function optionalAuth(req, res, next) {
  const userId = readTokenUserId(req)
  if (userId) req.userId = userId
  next()
}

//  GET /appointments/slots
router.get('/slots', optionalAuth, async (req, res) => {
  try {
    const days  = parseInt(req.query.days) || 7
    const slots = await getAvailableSlots(days)
    logActivity({
      userId:    req.userId || null,
      sessionId: activitySession(req),
      event:     'view_slots'
    })
    res.json({ success: true, slots })
  } catch (error) {
    console.error('Slots error:', error)
    res.status(500).json({ success: false, message: 'Could not fetch slots.' })
  }
})

//  GET /appointments/services
router.get('/services', optionalAuth, async (req, res) => {
  try {
    const services = await prisma.services.findMany({
      where: { is_active: true },
      orderBy: { category: 'asc' }
    })

    const grouped = services.reduce((acc, svc) => {
      if (!acc[svc.category]) acc[svc.category] = []
      acc[svc.category].push(svc)
      return acc
    }, {})

    logActivity({
      userId:    req.userId || null,
      sessionId: activitySession(req),
      event:     'view_services'
    })

    res.json({ success: true, services, grouped })
  } catch (error) {
    console.error('Services error:', error)
    res.status(500).json({ success: false, message: 'Could not fetch services.' })
  }
})

//  GET /appointments/my  — requires auth
router.get('/my', optionalAuth, async (req, res) => {
  try {
    const sessionId = activitySession(req)
    if (req.userId) await claimSessionBookings(req.userId, sessionId)
    const user = req.userId
      ? await prisma.users.findUnique({
          where: { id: Number(req.userId) },
          select: { id: true, email: true, phone: true }
        })
      : null
    const ors = await ownedAppointmentWhere(user, sessionId)

    if (!ors.length) return res.json({ success: true, appointments: [] })

    const appointments = await prisma.appointments.findMany({
      where: { OR: ors },
      select: {
        id: true, booking_ref: true, slot_datetime: true, status: true, notes: true,
        guest_name: true, guest_phone: true, guest_email: true, created_at: true,
        services: { select: { name: true, category: true, price: true, duration_min: true } }
      },
      orderBy: { slot_datetime: 'asc' }
    })

    res.json({ success: true, appointments: appointments || [] })
  } catch (error) {
    console.error('My appointments error:', error)
    res.status(500).json({ success: false, message: 'Could not fetch appointments.' })
  }
})

//  POST /appointments/book  — logged-in only (JWT cookie / Bearer)
router.post('/book', optionalAuth, async (req, res) => {
  try {
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: 'Please log in to book via the AI assistant.'
      })
    }
    const user = await prisma.users.findUnique({
      where: { id: req.userId },
      select: { id: true, display_name: true, email: true, phone: true }
    })
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Please log in to book via the AI assistant.'
      })
    }

    const { notes } = req.body
    const serviceId = Number(req.body.serviceId)
    const slotDatetime = thaiLocalToUTC(req.body.slotDatetime)

    if (!serviceId || !slotDatetime) {
      return res.status(400).json({ success: false, message: 'serviceId and slotDatetime are required.' })
    }

    const available = await isSlotAvailable(slotDatetime)
    if (!available) {
      return res.status(409).json({ success: false, message: 'This slot is fully booked. Please choose another time.' })
    }

    const service = await prisma.services.findFirst({
      where: { id: serviceId, is_active: true },
      select: { id: true, name: true, price: true }
    })

    if (!service) return res.status(404).json({ success: false, message: 'Service not found.' })

    const guestEmail = (req.body.guestEmail || user.email || '').toLowerCase().trim() || null
    const guestPhone = (req.body.guestPhone || user.phone || '').trim() || null
    if (Number.isNaN(new Date(slotDatetime).getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid appointment time. Please pick the slot again.' })
    }

    const bookingRef = await createAppointmentWithRef({
      user_id:       user.id,
      service_id:    serviceId,
      slot_datetime: slotDatetime,
      notes:         notes || null,
      status:        'confirmed',
      guest_name:    req.body.guestName || user.display_name || null,
      guest_phone:   guestPhone,
      guest_email:   guestEmail
    })

    const sessionId = activitySession(req)
    await claimSessionBookings(user.id, sessionId)
    logActivity({
      userId:    user.id,
      sessionId,
      event:     'book',
      meta:      { bookingRef, serviceId }
    })

    res.json({
      success: true,
      appointment: { bookingRef, service: service.name, price: service.price, slotDatetime }
    })
  } catch (error) {
    console.error('Book error:', error)
    res.status(500).json({ success: false, message: 'Could not book appointment.' })
  }
})

//  POST /appointments/book-guest  — Way 1 (Book Now button)
//  No login required. Collects name, phone, email from form.
router.post('/book-guest', optionalAuth, async (req, res) => {
  try {
    const { guestName, guestPhone, guestEmail, notes } = req.body
    const serviceId = Number(req.body.serviceId)
    const slotDatetime = thaiLocalToUTC(req.body.slotDatetime)

    if (!guestName || !guestPhone || !serviceId || !slotDatetime) {
      return res.status(400).json({
        success: false,
        message: 'Name, phone, service, and appointment time are required.'
      })
    }

    const available = await isSlotAvailable(slotDatetime)
    if (!available) {
      return res.status(409).json({ success: false, message: 'This slot is fully booked. Please choose another time.' })
    }

    const service = await prisma.services.findFirst({
      where: { id: serviceId, is_active: true },
      select: { id: true, name: true, price: true }
    })

    if (!service) return res.status(404).json({ success: false, message: 'Service not found.' })

    const sessionId = activitySession(req)
    const normalizedEmail = guestEmail ? guestEmail.toLowerCase().trim() : null

    // Prefer the signed-in account, then same email/phone, then this browser session.
    let guestUser = req.userId ? { id: req.userId } : null
    if (!guestUser && normalizedEmail) {
      guestUser = await prisma.users.findUnique({
        where: { email: normalizedEmail },
        select: { id: true }
      })
    }
    if (!guestUser && guestPhone) {
      guestUser = await prisma.users.findFirst({
        where: { phone: guestPhone.trim(), is_registered: true },
        select: { id: true }
      })
    }
    if (!guestUser && sessionId) {
      const sessionUser = await prisma.users.findUnique({
        where: { session_id: sessionId },
        select: { id: true, is_registered: true }
      })
      if (sessionUser && !sessionUser.is_registered) guestUser = sessionUser
    }

    if (!guestUser) {
      const newSessionId = sessionId || ('guest-' + Math.random().toString(36).slice(2, 9) + '-' + Date.now())
      try {
        guestUser = await prisma.users.create({
          data: {
            display_name:  guestName.trim(),
            email:         normalizedEmail,
            phone:         guestPhone.trim(),
            session_id:    newSessionId,
            is_registered: false,
            picture_url:   `https://api.dicebear.com/7.x/personas/svg?seed=${newSessionId}`
          },
          select: { id: true }
        })
      } catch (uErr) {
        if (uErr.code === 'P2002' && sessionId) {
          guestUser = await prisma.users.findUnique({
            where: { session_id: sessionId },
            select: { id: true }
          })
        }
        if (!guestUser) throw uErr
      }
    }

    const bookingRef = await createAppointmentWithRef({
      user_id:       guestUser.id,
      service_id:    serviceId,
      slot_datetime: slotDatetime,
      notes:         notes || null,
      status:        'confirmed',
      guest_name:    guestName.trim(),
      guest_phone:   guestPhone.trim(),
      guest_email:   normalizedEmail
    })

    if (req.userId) await claimSessionBookings(req.userId, sessionId)
    logActivity({
      userId:    guestUser.id,
      sessionId,
      event:     'book_guest',
      meta:      { bookingRef, serviceId }
    })

    res.json({
      success: true,
      appointment: {
        bookingRef,
        service:      service.name,
        price:        service.price,
        slotDatetime,
        guestName:    guestName.trim(),
        guestPhone:   guestPhone.trim()
      }
    })
  } catch (error) {
    console.error('Book-guest error:', error)
    res.status(500).json({ success: false, message: 'Could not complete booking. Please try again.' })
  }
})

//  PATCH /appointments/cancel  — requires auth
router.patch('/cancel', optionalAuth, async (req, res) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ success: false, message: 'Please log in to cancel appointments.' })
    }
    const sessionId = activitySession(req)
    await claimSessionBookings(req.userId, sessionId)

    const user = await prisma.users.findUnique({
      where: { id: Number(req.userId) },
      select: { id: true, email: true, phone: true }
    })
    if (!user) {
      return res.status(401).json({ success: false, message: 'Please log in to cancel appointments.' })
    }
    const ors = [
      { user_id: user.id },
      user.email ? { guest_email: user.email.toLowerCase().trim() } : null,
      user.phone ? { guest_phone: user.phone.trim() } : null
    ].filter(Boolean)

    const { bookingRef } = req.body
    if (!bookingRef) {
      return res.status(400).json({ success: false, message: 'bookingRef is required.' })
    }

    const appointment = await prisma.appointments.findFirst({
      where: { booking_ref: bookingRef, OR: ors },
      select: { id: true, status: true, user_id: true }
    })

    if (!appointment) {
      return res.status(404).json({ success: false, message: `Booking ${bookingRef} not found on your account.` })
    }
    if (appointment.status === 'cancelled') {
      return res.status(400).json({ success: false, message: 'This appointment is already cancelled.' })
    }

    await prisma.appointments.update({
      where: { id: appointment.id },
      data: { status: 'cancelled' }
    })

    logActivity({
      userId:    (user && user.id) || appointment.user_id,
      sessionId,
      event:     'cancel',
      meta:      { bookingRef }
    })

    res.json({ success: true, message: `Appointment ${bookingRef} cancelled successfully.` })
  } catch (error) {
    console.error('Cancel error:', error)
    res.status(500).json({ success: false, message: 'Could not cancel appointment.' })
  }
})

//  PATCH /appointments/reschedule  — requires auth
router.patch('/reschedule', optionalAuth, async (req, res) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ success: false, message: 'Please log in to reschedule appointments.' })
    }
    const sessionId = activitySession(req)
    await claimSessionBookings(req.userId, sessionId)

    const user = await prisma.users.findUnique({
      where: { id: Number(req.userId) },
      select: { id: true, email: true, phone: true }
    })
    if (!user) {
      return res.status(401).json({ success: false, message: 'Please log in to reschedule appointments.' })
    }
    const ors = [
      { user_id: user.id },
      user.email ? { guest_email: user.email.toLowerCase().trim() } : null,
      user.phone ? { guest_phone: user.phone.trim() } : null
    ].filter(Boolean)

    const { bookingRef, newServiceId } = req.body
    const newSlotDatetime = req.body.newSlotDatetime
      ? thaiLocalToUTC(req.body.newSlotDatetime)
      : undefined

    if (!bookingRef) {
      return res.status(400).json({ success: false, message: 'bookingRef is required.' })
    }
    if (!newSlotDatetime && !newServiceId) {
      return res.status(400).json({ success: false, message: 'Provide at least newSlotDatetime or newServiceId.' })
    }

    const appointment = await prisma.appointments.findFirst({
      where: { booking_ref: bookingRef, OR: ors },
      select: { id: true, status: true, slot_datetime: true, service_id: true, user_id: true }
    })

    if (!appointment) {
      return res.status(404).json({ success: false, message: `Booking ${bookingRef} not found on your account.` })
    }
    if (appointment.status === 'cancelled') {
      return res.status(400).json({ success: false, message: 'Cannot reschedule a cancelled appointment.' })
    }

    const targetSlot = newSlotDatetime || appointment.slot_datetime
    if (newSlotDatetime && newSlotDatetime !== appointment.slot_datetime.toISOString()) {
      const available = await isSlotAvailable(newSlotDatetime)
      if (!available) {
        return res.status(409).json({ success: false, message: 'That slot is fully booked. Please choose another time.' })
      }
    }

    const targetServiceId = newServiceId || appointment.service_id
    if (newServiceId) {
      const svc = await prisma.services.findFirst({
        where: { id: newServiceId, is_active: true },
        select: { id: true }
      })
      if (!svc) return res.status(404).json({ success: false, message: 'Service not found.' })
    }

    await prisma.appointments.update({
      where: { id: appointment.id },
      data: { slot_datetime: targetSlot, service_id: targetServiceId }
    })

    logActivity({
      userId:    (user && user.id) || appointment.user_id,
      sessionId,
      event:     'reschedule',
      meta:      { bookingRef }
    })

    const updatedService = await prisma.services.findUnique({
      where: { id: targetServiceId },
      select: { name: true, price: true }
    })

    res.json({
      success: true,
      message: `Appointment ${bookingRef} rescheduled successfully.`,
      appointment: {
        bookingRef,
        service:      updatedService?.name,
        price:        updatedService?.price,
        slotDatetime: targetSlot
      }
    })
  } catch (error) {
    console.error('Reschedule error:', error)
    res.status(500).json({ success: false, message: 'Could not reschedule appointment.' })
  }
})

// ── Booking reference generator ───────────────────────────
async function generateRef() {
  const today = new Date(Date.now() + TZ_OFFSET_MS).toISOString().split('T')[0].replace(/-/g, '')
  const prefix = `TCB-${today}-`
  const latest = await prisma.appointments.findMany({
    where: { booking_ref: { startsWith: prefix } },
    select: { booking_ref: true },
    orderBy: { booking_ref: 'desc' },
    take: 1
  })
  let next = 1
  if (latest[0]) {
    const n = parseInt(latest[0].booking_ref.slice(prefix.length), 10)
    if (Number.isFinite(n)) next = n + 1
  }
  return `${prefix}${String(next).padStart(3, '0')}`
}

async function createAppointmentWithRef(data) {
  let lastErr
  for (let attempt = 0; attempt < 5; attempt++) {
    const bookingRef = await generateRef()
    try {
      await prisma.appointments.create({ data: { ...data, booking_ref: bookingRef } })
      return bookingRef
    } catch (err) {
      lastErr = err
      if (err.code !== 'P2002') throw err
    }
  }
  throw lastErr
}

module.exports = router