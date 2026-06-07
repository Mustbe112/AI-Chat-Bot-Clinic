// ============================================================
//  routes/appointment.js  (v2)
//  New: POST /appointments/book-guest  (Way 1 — no login)
//  Updated: all other routes now also accept JWT auth
//           in addition to sessionId, so the chatbot (Way 2)
//           can work with logged-in users seamlessly.
// ============================================================

const express  = require('express')
const router   = express.Router()
const supabase = require('../services/supabase')
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
    const { data } = await supabase
      .from('users')
      .select('id, display_name, email, phone')
      .eq('id', req.userId)
      .single()
    return data || null
  }
  // Session-id path (legacy / guest chatbot browsing)
  const sessionId = req.query.sessionId || req.body?.sessionId
  if (!sessionId) return null
  const { data } = await supabase
    .from('users')
    .select('id, display_name, email, phone')
    .eq('session_id', sessionId)
    .single()
  return data || null
}

// Optional auth middleware — sets req.userId if valid Bearer token present,
// but does NOT reject if no token (allows guest browsing to still work).
function optionalAuth(req, res, next) {
  const header = req.headers.authorization
  if (header && header.startsWith('Bearer ')) {
    try {
      const jwt    = require('jsonwebtoken')
      const secret = process.env.JWT_SECRET || 'change-me-in-production'
      const payload = jwt.verify(header.slice(7), secret)
      req.userId = payload.userId
    } catch { /* ignore invalid token */ }
  }
  next()
}

// ============================================================
//  GET /appointments/slots
// ============================================================
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

// ============================================================
//  GET /appointments/services
// ============================================================
router.get('/services', async (req, res) => {
  try {
    const { data: services, error } = await supabase
      .from('services')
      .select('*')
      .eq('is_active', true)
      .order('category', { ascending: true })

    if (error) throw error

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

// ============================================================
//  GET /appointments/my  — requires auth
// ============================================================
router.get('/my', optionalAuth, async (req, res) => {
  try {
    const user = await resolveUser(req)
    if (!user) return res.json({ success: true, appointments: [] })

    const { data: appointments, error } = await supabase
      .from('appointments')
      .select(`
        id, booking_ref, slot_datetime, status, notes,
        guest_name, guest_phone, guest_email, created_at,
        services ( name, category, price, duration_min )
      `)
      .eq('user_id', user.id)
      .order('slot_datetime', { ascending: true })

    if (error) throw error
    res.json({ success: true, appointments: appointments || [] })
  } catch (error) {
    console.error('My appointments error:', error)
    res.status(500).json({ success: false, message: 'Could not fetch appointments.' })
  }
})

// ============================================================
//  POST /appointments/book  — Way 2 (chatbot, requires login)
// ============================================================
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

    const { data: service } = await supabase
      .from('services')
      .select('id, name, price')
      .eq('id', serviceId)
      .eq('is_active', true)
      .single()

    if (!service) return res.status(404).json({ success: false, message: 'Service not found.' })

    const bookingRef = await generateRef()

    const { error } = await supabase.from('appointments').insert({
      user_id:       user.id,
      service_id:    serviceId,
      slot_datetime: slotDatetime,
      booking_ref:   bookingRef,
      notes:         notes || null,
      status:        'confirmed'
    })
    if (error) throw error

    res.json({
      success: true,
      appointment: { bookingRef, service: service.name, price: service.price, slotDatetime }
    })
  } catch (error) {
    console.error('Book error:', error)
    res.status(500).json({ success: false, message: 'Could not book appointment.' })
  }
})

// ============================================================
//  POST /appointments/book-guest  — Way 1 (Book Now button)
//  No login required. Collects name, phone, email from form.
// ============================================================
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

    const { data: service } = await supabase
      .from('services')
      .select('id, name, price')
      .eq('id', serviceId)
      .eq('is_active', true)
      .single()

    if (!service) return res.status(404).json({ success: false, message: 'Service not found.' })

    // Upsert a guest user row (keyed by phone) so we can track appointments
    // without requiring full registration.
    let guestUser = null
    if (guestEmail) {
      const { data } = await supabase
        .from('users')
        .select('id')
        .eq('email', guestEmail.toLowerCase().trim())
        .single()
      guestUser = data
    }

    if (!guestUser) {
      // Create a minimal guest user row
      const sessionId = 'guest-' + Math.random().toString(36).slice(2, 9) + '-' + Date.now()
      const { data, error: uErr } = await supabase
        .from('users')
        .insert({
          display_name:  guestName.trim(),
          email:         guestEmail ? guestEmail.toLowerCase().trim() : null,
          phone:         guestPhone.trim(),
          session_id:    sessionId,
          is_registered: false,
          picture_url:   `https://api.dicebear.com/7.x/personas/svg?seed=${sessionId}`
        })
        .select('id')
        .single()
      if (uErr) throw uErr
      guestUser = data
    }

    const bookingRef = await generateRef()

    const { error } = await supabase.from('appointments').insert({
      user_id:       guestUser.id,
      service_id:    serviceId,
      slot_datetime: slotDatetime,
      booking_ref:   bookingRef,
      notes:         notes || null,
      status:        'confirmed',
      guest_name:    guestName.trim(),
      guest_phone:   guestPhone.trim(),
      guest_email:   guestEmail ? guestEmail.toLowerCase().trim() : null
    })
    if (error) throw error

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

// ============================================================
//  PATCH /appointments/cancel  — requires auth
// ============================================================
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

    const { data: appointment } = await supabase
      .from('appointments')
      .select('id, status')
      .eq('booking_ref', bookingRef)
      .eq('user_id', user.id)
      .single()

    if (!appointment) {
      return res.status(404).json({ success: false, message: `Booking ${bookingRef} not found on your account.` })
    }
    if (appointment.status === 'cancelled') {
      return res.status(400).json({ success: false, message: 'This appointment is already cancelled.' })
    }

    await supabase
      .from('appointments')
      .update({ status: 'cancelled' })
      .eq('id', appointment.id)

    res.json({ success: true, message: `Appointment ${bookingRef} cancelled successfully.` })
  } catch (error) {
    console.error('Cancel error:', error)
    res.status(500).json({ success: false, message: 'Could not cancel appointment.' })
  }
})

// ============================================================
//  PATCH /appointments/reschedule  — requires auth
// ============================================================
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

    const { data: appointment } = await supabase
      .from('appointments')
      .select('id, status, slot_datetime, service_id')
      .eq('booking_ref', bookingRef)
      .eq('user_id', user.id)
      .single()

    if (!appointment) {
      return res.status(404).json({ success: false, message: `Booking ${bookingRef} not found on your account.` })
    }
    if (appointment.status === 'cancelled') {
      return res.status(400).json({ success: false, message: 'Cannot reschedule a cancelled appointment.' })
    }

    const targetSlot = newSlotDatetime || appointment.slot_datetime
    if (newSlotDatetime && newSlotDatetime !== appointment.slot_datetime) {
      const available = await isSlotAvailable(newSlotDatetime)
      if (!available) {
        return res.status(409).json({ success: false, message: 'That slot is fully booked. Please choose another time.' })
      }
    }

    const targetServiceId = newServiceId || appointment.service_id
    if (newServiceId) {
      const { data: svc } = await supabase
        .from('services').select('id').eq('id', newServiceId).eq('is_active', true).single()
      if (!svc) return res.status(404).json({ success: false, message: 'Service not found.' })
    }

    const { error } = await supabase
      .from('appointments')
      .update({ slot_datetime: targetSlot, service_id: targetServiceId })
      .eq('id', appointment.id)

    if (error) throw error

    const { data: updatedService } = await supabase
      .from('services').select('name, price').eq('id', targetServiceId).single()

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
  const { count } = await supabase
    .from('appointments')
    .select('*', { count: 'exact', head: true })
  return `TCB-${today}-${String((count || 0) + 1).padStart(3, '0')}`
}

module.exports = router