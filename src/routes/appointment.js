const express  = require('express')
const router   = express.Router()
const jwt      = require('jsonwebtoken')
const prisma   = require('../services/prisma')
const { getAvailableSlots, isSlotAvailable } = require('../services/scheduler')
const { authMiddleware } = require('./auth')

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

// Optional auth middleware — sets req.userId if valid Bearer token present,
// but does NOT reject if no token (allows guest browsing to still work).
function optionalAuth(req, res, next) {
  const header = req.headers.authorization
  if (header && header.startsWith('Bearer ')) {
    try {
      const secret = process.env.JWT_SECRET || 'change-me-in-production'
      const payload = jwt.verify(header.slice(7), secret)
      req.userId = payload.userId
    } catch { /* ignore invalid token */ }
  }
  next()
}

//  GET /appointments/slots
router.get('/slots', async (req, res) => {
  try {
    const days  = parseInt(req.query.days) || 7
    const slots = await getAvailableSlots(days)
    res.json({ success: true, slots })
  } catch (error) {
    console.error('Slots error:', error)
    res.status(500).json({ success: false, message: 'Could not fetch slots.' })
  }
})

//  GET /appointments/services
router.get('/services', async (req, res) => {
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

    res.json({ success: true, services, grouped })
  } catch (error) {
    console.error('Services error:', error)
    res.status(500).json({ success: false, message: 'Could not fetch services.' })
  }
})

//  GET /appointments/my  — requires auth
router.get('/my', optionalAuth, async (req, res) => {
  try {
    const user = await resolveUser(req)
    if (!user) return res.json({ success: true, appointments: [] })

    const appointments = await prisma.appointments.findMany({
      where: { user_id: user.id },
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

//  POST /appointments/book  — Way 2 (chatbot, requires login)
router.post('/book', optionalAuth, async (req, res) => {
  try {
    const user = await resolveUser(req)
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Please log in to book via the AI assistant.'
      })
    }

    const { serviceId, notes } = req.body
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

    const bookingRef = await generateRef()

    await prisma.appointments.create({
      data: {
        user_id:       user.id,
        service_id:    serviceId,
        slot_datetime: slotDatetime,
        booking_ref:   bookingRef,
        notes:         notes || null,
        status:        'confirmed'
      }
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
router.post('/book-guest', async (req, res) => {
  try {
    const { guestName, guestPhone, guestEmail, serviceId, notes } = req.body
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

    // Upsert a guest user row (keyed by email) so we can track appointments
    // without requiring full registration.
    let guestUser = null
    if (guestEmail) {
      guestUser = await prisma.users.findUnique({
        where: { email: guestEmail.toLowerCase().trim() },
        select: { id: true }
      })
    }

    if (!guestUser) {
      // Create a minimal guest user row
      const sessionId = 'guest-' + Math.random().toString(36).slice(2, 9) + '-' + Date.now()
      try {
        guestUser = await prisma.users.create({
          data: {
            display_name:  guestName.trim(),
            email:         guestEmail ? guestEmail.toLowerCase().trim() : null,
            phone:         guestPhone.trim(),
            session_id:    sessionId,
            is_registered: false,
            picture_url:   `https://api.dicebear.com/7.x/personas/svg?seed=${sessionId}`
          },
          select: { id: true }
        })
      } catch (uErr) {
        throw uErr
      }
    }

    const bookingRef = await generateRef()

    await prisma.appointments.create({
      data: {
        user_id:       guestUser.id,
        service_id:    serviceId,
        slot_datetime: slotDatetime,
        booking_ref:   bookingRef,
        notes:         notes || null,
        status:        'confirmed',
        guest_name:    guestName.trim(),
        guest_phone:   guestPhone.trim(),
        guest_email:   guestEmail ? guestEmail.toLowerCase().trim() : null
      }
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
    const user = await resolveUser(req)
    if (!user) {
      return res.status(401).json({ success: false, message: 'Please log in to cancel appointments.' })
    }

    const { bookingRef } = req.body
    if (!bookingRef) {
      return res.status(400).json({ success: false, message: 'bookingRef is required.' })
    }

    const appointment = await prisma.appointments.findFirst({
      where: { booking_ref: bookingRef, user_id: user.id },
      select: { id: true, status: true }
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

    res.json({ success: true, message: `Appointment ${bookingRef} cancelled successfully.` })
  } catch (error) {
    console.error('Cancel error:', error)
    res.status(500).json({ success: false, message: 'Could not cancel appointment.' })
  }
})

//  PATCH /appointments/reschedule  — requires auth
router.patch('/reschedule', optionalAuth, async (req, res) => {
  try {
    const user = await resolveUser(req)
    if (!user) {
      return res.status(401).json({ success: false, message: 'Please log in to reschedule appointments.' })
    }

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
      where: { booking_ref: bookingRef, user_id: user.id },
      select: { id: true, status: true, slot_datetime: true, service_id: true }
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
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '')
  const count = await prisma.appointments.count()
  return `TCB-${today}-${String((count || 0) + 1).padStart(3, '0')}`
}

module.exports = router