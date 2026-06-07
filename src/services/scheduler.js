const supabase = require('./supabase')

const SLOT_TIMES = [
    { hour: 9,  minute: 0  },
    { hour: 10, minute: 5  },
    { hour: 11, minute: 10 },
    { hour: 13, minute: 5  },
    { hour: 14, minute: 10 },
    { hour: 15, minute: 15 },
    { hour: 16, minute: 20 },
]

const MAX_BOOKINGS_PER_SLOT = 2

const TZ_OFFSET_MS = 7 * 60 * 60 * 1000 // UTC+7 Thailand

// Build a UTC ISO string that represents a given local Thai time
function thaiToUTC(dateStr, hour, minute) {
    // dateStr = 'YYYY-MM-DD', hour/minute = local Thai time
    const localMs = Date.parse(`${dateStr}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:00Z`)
    return new Date(localMs - TZ_OFFSET_MS).toISOString()
}

// Get today's date string in Thai timezone
function todayInThai() {
    const now = new Date(Date.now() + TZ_OFFSET_MS)
    return now.toISOString().split('T')[0]
}

async function getSlotsForDate(dateStr) {
    const slots = []

    for (const time of SLOT_TIMES) {
        const utcIso = thaiToUTC(dateStr, time.hour, time.minute)

        const { count, error } = await supabase
            .from('appointments')
            .select('*', { count: 'exact', head: true })
            .eq('slot_datetime', utcIso)
            .eq('status', 'confirmed')

        if (error) {
            console.error('Error fetching slot count:', error)
            continue
        }

        const booked    = count || 0
        const remaining = MAX_BOOKINGS_PER_SLOT - booked

        slots.push({
            datetime:    utcIso,
            display:     formatSlotDisplay(time),
            date:        dateStr,
            booked,
            remaining,
            isAvailable: remaining > 0
        })
    }

    return slots
}

async function getAvailableSlots(days = 7) {
    const available = []
    const todayStr  = todayInThai()
    const today     = new Date(todayStr + 'T00:00:00Z')

    for (let i = 0; i < days; i++) {
        const date = new Date(today)
        date.setUTCDate(today.getUTCDate() + i)

        if (date.getUTCDay() === 0) continue // skip Sunday

        const dateStr   = date.toISOString().split('T')[0]
        const slots     = await getSlotsForDate(dateStr)
        const openSlots = slots.filter(s => s.isAvailable)

        if (openSlots.length > 0) {
            available.push({
                date:    dateStr,
                dayName: date.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Bangkok' }),
                slots:   openSlots
            })
        }
    }

    return available
}

// slotDateTime must be a UTC ISO string (as stored in DB)
async function isSlotAvailable(slotDateTime) {
    const { count, error } = await supabase
        .from('appointments')
        .select('*', { count: 'exact', head: true })
        .eq('slot_datetime', slotDateTime)
        .eq('status', 'confirmed')

    if (error) return false
    return (count || 0) < MAX_BOOKINGS_PER_SLOT
}

function formatSlotDisplay(time) {
    const start = new Date(2000, 0, 1, time.hour, time.minute)
    const end   = new Date(2000, 0, 1, time.hour + 1, time.minute)

    const fmt = (d) => d.toLocaleTimeString('en-US', {
        hour:   'numeric',
        minute: '2-digit',
        hour12: true
    })

    return `${fmt(start)} - ${fmt(end)}`
}

module.exports = { getSlotsForDate, getAvailableSlots, isSlotAvailable, SLOT_TIMES, MAX_BOOKINGS_PER_SLOT }