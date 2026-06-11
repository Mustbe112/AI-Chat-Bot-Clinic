const { GoogleGenerativeAI } = require('@google/generative-ai')
const supabase = require('./supabase')
const { getSlotsForDate, isSlotAvailable } = require('./scheduler')
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

// ── Per-user chat rate limiter ────────────────────────────
// Keyed by userId. Prevents burst-sending all daily messages
// in seconds and hammering the Gemini API.
// For multi-instance deployments, replace with Redis.
const chatRateStore = new Map()
const CHAT_RATE = { windowMs: 10 * 1000, max: 5 }  // 5 messages per 10 seconds

function checkChatRateLimit(userId) {
  const now   = Date.now()
  const entry = chatRateStore.get(userId)

  if (!entry || now > entry.resetAt) {
    chatRateStore.set(userId, { count: 1, resetAt: now + CHAT_RATE.windowMs })
    return { allowed: true }
  }

  entry.count++
  if (entry.count > CHAT_RATE.max) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
    return { allowed: false, retryAfter }
  }
  return { allowed: true }
}

// Prune expired entries every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of chatRateStore) {
    if (now > entry.resetAt) chatRateStore.delete(key)
  }
}, 5 * 60 * 1000)


const TZ_OFFSET_MS = 7 * 60 * 60 * 1000
function thaiLocalToUTC(isoStr) {
  if (/Z$|[+-]\d{2}:\d{2}$/.test(isoStr)) return new Date(isoStr).toISOString()
  const localMs = Date.parse(isoStr + 'Z')
  return new Date(localMs - TZ_OFFSET_MS).toISOString()
}

//  SYSTEM PROMPTS

// Shared rules for both guest and logged-in modes
const SHARED_RULES = `
You are a friendly and professional AI assistant for "Lumière Skin Clinic", a facial skin clinic in Thailand.

YOUR ROLE:
- Help users learn about our clinic services
- Recommend appropriate treatments based on skin concerns
- Answer questions about pricing and treatment details
- Show available appointment slots when asked
- Assist logged-in users with booking, cancellation, and rescheduling

CLINIC SERVICES (use ONLY these, do not invent others):
ID 1  - Acne Treatment Facial (1,200 THB) - Deep cleansing for acne, blackheads, whiteheads
ID 2  - Acne Scar Reduction (2,500 THB) - Microneedling for acne scars
ID 3  - Oil Control Treatment (1,000 THB) - Regulates sebum for oily skin
ID 4  - Brightening Vitamin C Facial (1,500 THB) - Even skin tone, reduce dark spots
ID 5  - Glutathione Whitening Drip (3,500 THB) - Full-body brightening IV drip
ID 6  - Dark Spot Corrector (1,800 THB) - AHA/BHA peels for pigmentation
ID 7  - Collagen Boost Facial (2,200 THB) - Radiofrequency for firmer skin
ID 8  - Anti-Wrinkle Treatment (2,800 THB) - Ultrasound therapy for fine lines
ID 9  - Eye Rejuvenation (1,600 THB) - Dark circles, puffiness, crow's feet
ID 10 - Hydra Facial (1,400 THB) - Deep hydration and cleansing
ID 11 - Moisture Barrier Repair (1,300 THB) - For dry or sensitive skin
ID 12 - Laser Pore Minimizing (3,000 THB) - Minimize enlarged pores
ID 13 - Laser Pigmentation Removal (3,500 THB) - Sunspots and melasma
ID 14 - Skin Consultation (500 THB) - Personalized skin assessment

CLINIC HOURS:
- Monday to Saturday: 9:00 AM – 5:20 PM
- Lunch break: 12:00 PM – 1:00 PM
- Closed on Sundays

AVAILABLE TIME SLOTS: 09:00, 10:05, 11:10, 13:05, 14:10, 15:15, 16:20

RESPONSE RULES:
1. ONLY answer questions related to this clinic and its services
2. If asked about other clinics say: "I can only provide information about Lumière Skin Clinic."
3. Always be polite, warm, and professional
4. Keep responses concise and easy to read
5. When listing services, format each as: name — price — one-line description
6. After get_available_slots returns data, tell the user the slots are displayed and they can tap a time

FUNCTION CALLING RULES:
- When user wants to SEE slots for a date → call get_available_slots
- For slot_datetime always use ISO format: "YYYY-MM-DDTHH:MM:00"
- Time mapping: "9am"="09:00", "10am"="10:05", "11am"="11:10", "1pm"="13:05", "2pm"="14:10", "3pm"="15:15", "4pm"="16:20"
- Booking ref format: TCB-YYYYMMDD-NNN

SAFETY RULES — NEVER:
- Give specific medical diagnoses
- Recommend prescription medications
- Provide self-harm or dangerous advice
- Discuss illegal activities
`

const GUEST_SYSTEM_PROMPT = SHARED_RULES + `

IMPORTANT — GUEST MODE (user is NOT logged in):
- You can recommend treatments, show prices, and display available slots
- You CANNOT book, cancel, or reschedule appointments
- If the user asks to book, cancel, or reschedule: respond warmly that these actions require an account
- Use this exact message when they try to book:
  "To book an appointment through the chat, you'll need to log in or create a free account first.
   You can also use the **Book Now** button on the page to make a quick guest booking without an account! 😊"
- If they ask to cancel or reschedule via chat, remind them to log in
- Do NOT call book_appointment, cancel_appointment, reschedule_appointment, or get_my_appointments
`

const LOGGEDIN_SYSTEM_PROMPT = SHARED_RULES + `

IMPORTANT — LOGGED-IN MODE (user is authenticated):
- You have full access to booking, cancellation, and rescheduling
- The user's name and profile are already known — do NOT ask for their name or phone number
- Use the user's account to look up their appointments when needed

BOOKING FLOW:
1. Ask which service → wait
2. Confirm service, ask what date → wait
3. Call get_available_slots for that date
4. Slots shown as clickable chips — tell user to tap a time
5. After user picks a slot → call book_appointment immediately

CANCEL FLOW:
1. Ask for booking reference (TCB-YYYYMMDD-NNN) → wait
2. Call cancel_appointment immediately with that reference

RESCHEDULE FLOW:
1. Ask for booking reference → wait
2. Ask what new date they want → wait
3. Call get_available_slots for that date → user picks time
4. Call reschedule_appointment immediately

FLOW RULES:
- When you see a TCB-YYYYMMDD-NNN pattern in the message, treat it as the booking ref for the current flow
- After booking/cancel/reschedule completes, offer further assistance
- When user wants to view bookings → call get_my_appointments
`
//  FUNCTION DECLARATIONS

const SLOT_FUNCTION = {
  name: 'get_available_slots',
  description: 'Get available appointment slots for a specific date.',
  parameters: {
    type: 'OBJECT',
    properties: {
      date: { type: 'STRING', description: 'Date in YYYY-MM-DD format.' }
    },
    required: ['date']
  }
}

const BOOKING_FUNCTIONS = [
  {
    name: 'book_appointment',
    description: 'Book a confirmed appointment for the logged-in user',
    parameters: {
      type: 'OBJECT',
      properties: {
        service_id:    { type: 'NUMBER', description: 'Service ID 1–14' },
        slot_datetime: { type: 'STRING', description: 'ISO datetime e.g. 2025-06-07T09:00:00' },
        notes:         { type: 'STRING', description: 'Optional notes' }
      },
      required: ['service_id', 'slot_datetime']
    }
  },
  {
    name: 'cancel_appointment',
    description: 'Cancel an existing appointment by booking reference',
    parameters: {
      type: 'OBJECT',
      properties: {
        booking_ref: { type: 'STRING', description: 'e.g. TCB-20250607-001' }
      },
      required: ['booking_ref']
    }
  },
  {
    name: 'get_my_appointments',
    description: 'Get all confirmed upcoming appointments for the current user',
    parameters: { type: 'OBJECT', properties: {}, required: [] }
  },
  {
    name: 'reschedule_appointment',
    description: 'Reschedule an existing appointment',
    parameters: {
      type: 'OBJECT',
      properties: {
        booking_ref:       { type: 'STRING', description: 'Existing booking reference' },
        new_slot_datetime: { type: 'STRING', description: 'New ISO datetime (optional)' },
        new_service_id:    { type: 'NUMBER', description: 'New service ID 1–14 (optional)' }
      },
      required: ['booking_ref']
    }
  }
]

//  FUNCTION HANDLERS

async function handleFunctionCall(functionName, args, userId) {
  console.log(`[Gemini Fn] ${functionName}`, args)

  switch (functionName) {

    case 'get_available_slots': {
      const { date } = args
      if (!date) return { success: false, message: 'Please provide a date.' }
      const allSlots = await getSlotsForDate(date)
      const open     = allSlots.filter(s => s.isAvailable)
      if (!open.length) return { success: false, message: `No available slots on ${date}. Please try another date.` }
      const d       = new Date(date + 'T12:00:00')
      const dayName = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
      return { success: true, slots: [{ date, dayName, slots: open }] }
    }

    case 'book_appointment': {
      const { service_id, notes } = args
      const slot_datetime = thaiLocalToUTC(args.slot_datetime)

      const available = await isSlotAvailable(slot_datetime)
      if (!available) return { success: false, message: 'This slot is fully booked. Please choose another time.' }

      const { data: service } = await supabase
        .from('services').select('id, name, price')
        .eq('id', service_id).eq('is_active', true).single()
      if (!service) return { success: false, message: 'Service not found.' }

      const bookingRef = await generateRef()

      const { error } = await supabase.from('appointments').insert({
        user_id:       userId,
        service_id,
        slot_datetime,
        booking_ref:   bookingRef,
        notes:         notes || null,
        status:        'confirmed'
      })
      if (error) throw error

      return {
        success:      true,
        message:      `Appointment booked successfully!`,
        bookingRef,
        service:      service.name,
        price:        service.price,
        slotDatetime: slot_datetime
      }
    }

    case 'cancel_appointment': {
      const { booking_ref } = args

      const { data: appointment } = await supabase
        .from('appointments').select('id, status')
        .eq('booking_ref', booking_ref).eq('user_id', userId).single()

      if (!appointment) return { success: false, message: `Booking ${booking_ref} not found on your account.` }
      if (appointment.status === 'cancelled') return { success: false, message: 'This appointment is already cancelled.' }

      await supabase.from('appointments').update({ status: 'cancelled' }).eq('id', appointment.id)
      return { success: true, message: `Appointment ${booking_ref} has been cancelled successfully.` }
    }

    case 'get_my_appointments': {
      const { data: appointments } = await supabase
        .from('appointments')
        .select('booking_ref, slot_datetime, status, services(name, price)')
        .eq('user_id', userId)
        .eq('status', 'confirmed')
        .order('slot_datetime', { ascending: true })

      if (!appointments || appointments.length === 0) {
        return { success: true, message: 'You have no upcoming appointments.' }
      }
      return { success: true, appointments }
    }

    case 'reschedule_appointment': {
      const { booking_ref, new_service_id } = args
      const new_slot_datetime = args.new_slot_datetime
        ? thaiLocalToUTC(args.new_slot_datetime)
        : undefined

      const { data: appointment } = await supabase
        .from('appointments').select('id, status, slot_datetime, service_id')
        .eq('booking_ref', booking_ref).eq('user_id', userId).single()

      if (!appointment) return { success: false, message: `Booking ${booking_ref} not found on your account.` }
      if (appointment.status === 'cancelled') return { success: false, message: 'Cannot reschedule a cancelled appointment.' }

      const targetSlot = new_slot_datetime || appointment.slot_datetime
      if (new_slot_datetime && new_slot_datetime !== appointment.slot_datetime) {
        const available = await isSlotAvailable(new_slot_datetime)
        if (!available) return { success: false, message: 'That slot is fully booked. Please choose another time.' }
      }

      const targetServiceId = new_service_id || appointment.service_id
      if (new_service_id) {
        const { data: svc } = await supabase
          .from('services').select('id').eq('id', new_service_id).eq('is_active', true).single()
        if (!svc) return { success: false, message: 'Service not found.' }
      }

      await supabase.from('appointments')
        .update({ slot_datetime: targetSlot, service_id: targetServiceId })
        .eq('id', appointment.id)

      const { data: updatedService } = await supabase
        .from('services').select('name, price').eq('id', targetServiceId).single()

      return {
        success:      true,
        message:      `Appointment ${booking_ref} rescheduled successfully.`,
        bookingRef:   booking_ref,
        service:      updatedService?.name,
        price:        updatedService?.price,
        slotDatetime: targetSlot
      }
    }

    default:
      return { success: false, message: 'Unknown function.' }
  }
}

//  HELPERS

async function isSafeMessage(message) {
  const { data: keywords } = await supabase.from('blocked_keywords').select('keyword')
  if (!keywords) return true
  const lower   = message.toLowerCase()
  const blocked = keywords.find(k => lower.includes(k.keyword.toLowerCase()))
  return !blocked
}

async function getChatHistory(userId) {
  const { data, error } = await supabase
    .from('chat_history')
    .select('role, content')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(10)

  if (error || !data) return []
  return data.reverse().map(msg => ({
    role:  msg.role,
    parts: [{ text: msg.content }]
  }))
}

async function saveMessage(userId, role, content) {
  await supabase.from('chat_history').insert({ user_id: userId, role, content })
}

async function checkMessageLimit(userId) {
  const today = new Date().toISOString().split('T')[0]
  const { data, error } = await supabase
    .from('message_usage')
    .select('count')
    .eq('user_id', userId)
    .eq('usage_date', today)
    .single()

  if (error && error.code !== 'PGRST116') return { allowed: true, remaining: 50 }
  const count = data?.count || 0
  return { allowed: count < 50, remaining: 50 - count, count }
}

async function incrementMessageCount(userId) {
  const today = new Date().toISOString().split('T')[0]
  const { data } = await supabase
    .from('message_usage').select('count')
    .eq('user_id', userId).eq('usage_date', today).single()

  if (data) {
    await supabase.from('message_usage')
      .update({ count: data.count + 1 })
      .eq('user_id', userId).eq('usage_date', today)
  } else {
    await supabase.from('message_usage')
      .insert({ user_id: userId, usage_date: today, count: 1 })
  }
}

// NOTE: also defined in routes/appointment.js — consider moving to a shared utility
async function generateRef() {
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '')
  const { count } = await supabase
    .from('appointments').select('*', { count: 'exact', head: true })
  return `TCB-${today}-${String((count || 0) + 1).padStart(3, '0')}`
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

async function sendWithRetry(chatSession, message, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await chatSession.sendMessage(message)
    } catch (error) {
      const retryable = error.status === 429 || error.status === 503
      if (retryable && attempt < maxRetries) {
        let delayMs = error.status === 503 ? 5000 : 60000
        try {
          const retryInfo = error.errorDetails?.find(d => d['@type']?.includes('RetryInfo'))
          if (retryInfo?.retryDelay) delayMs = parseInt(retryInfo.retryDelay) * 1000
        } catch {}
        console.log(`[Gemini] ${error.status} — retrying in ${delayMs / 1000}s (${attempt}/${maxRetries})`)
        await sleep(delayMs)
      } else {
        throw error
      }
    }
  }
}

//  MAIN CHAT FUNCTION

async function chat(userId, userMessage, isLoggedIn = false) {

  if (userMessage.length > 200) {
    return { success: false, message: 'Your message is a bit long. Could you shorten it?' }
  }

  const rateCheck = checkChatRateLimit(userId)
  if (!rateCheck.allowed) {
    return {
      success: false,
      message: `Slow down a little! Please wait ${rateCheck.retryAfter} second${rateCheck.retryAfter === 1 ? '' : 's'} before sending another message.`
    }
  }

  const limitCheck = await checkMessageLimit(userId)
  if (!limitCheck.allowed) {
    return { success: false, message: "You've reached your daily limit of 50 messages. Please come back tomorrow!" }
  }

  const safe = await isSafeMessage(userMessage)
  if (!safe) {
    return { success: false, message: "I'm not able to help with that. Is there anything else I can assist with?" }
  }

  const history = await getChatHistory(userId)

  // Choose system prompt and available functions based on login status
  const systemPrompt = isLoggedIn ? LOGGEDIN_SYSTEM_PROMPT : GUEST_SYSTEM_PROMPT
  const functions    = isLoggedIn
    ? [SLOT_FUNCTION, ...BOOKING_FUNCTIONS]
    : [SLOT_FUNCTION]  // guest can only see slots, not book

  try {
    const model = genAI.getGenerativeModel({
      model:             'gemini-2.5-flash',
      systemInstruction: systemPrompt,
      tools:             [{ functionDeclarations: functions }]
    })

    const chatSession = model.startChat({ history })
    let result   = await sendWithRetry(chatSession, userMessage)
    let response = result.response

    let slotsData = null

    while ((response.functionCalls() || []).length > 0) {
      const functionCall = response.functionCalls()[0]
      const fnResult     = await handleFunctionCall(functionCall.name, functionCall.args, userId)

      if (functionCall.name === 'get_available_slots' && fnResult.success) {
        slotsData = fnResult.slots
      }

      result   = await sendWithRetry(chatSession, [{
        functionResponse: { name: functionCall.name, response: fnResult }
      }])
      response = result.response
    }

    const reply = response.text()

    await saveMessage(userId, 'user', userMessage)
    await saveMessage(userId, 'model', reply)
    await incrementMessageCount(userId)

    return {
      success:   true,
      message:   reply,
      remaining: limitCheck.remaining - 1,
      slots:     slotsData || null
    }

  } catch (error) {
    console.error('Gemini API error:', error)

    if (error.status === 429 || error.status === 503) {
      let waitMsg = 'Please try again in a moment.'
      try {
        const retryInfo = error.errorDetails?.find(d => d['@type']?.includes('RetryInfo'))
        if (retryInfo?.retryDelay) {
          waitMsg = `Please try again in about ${parseInt(retryInfo.retryDelay)} seconds`
        }
      } catch {}
      return { success: false, message: `Our AI assistant is a bit busy right now. ${waitMsg}` }
    }

    return { success: false, message: 'Something went wrong. Please try again shortly.' }
  }
}

module.exports = { chat, checkMessageLimit }