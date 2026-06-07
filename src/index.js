const express = require('express')
const cors = require('cors')
const path = require('path')
require('dotenv').config()

const { router: authRoutes } = require('./routes/auth')   // auth.js exports { router, authMiddleware }
const chatRoutes        = require('./routes/chat')
const appointmentRoutes = require('./routes/appointment')

const app  = express()
const PORT = process.env.PORT || 3000

// ============================================================
//  MIDDLEWARE
// ============================================================
app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://ai-chat-bot-clinic.vercel.app'  // your actual Vercel URL
  ]
}))
app.use(express.json())
app.use(express.static(path.join(__dirname, '../public'), { index: false }))

// ============================================================
//  ROUTES
// ============================================================
app.use('/auth',         authRoutes)
app.use('/chat',         chatRoutes)
app.use('/appointments', appointmentRoutes)

// Health check (for UptimeRobot / Render keep-alive)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', clinic: 'Lumière Clinic Bot', time: new Date().toISOString() })
})

// Serve HTML pages
app.get('/',         (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')))
app.get('/chatbot',  (req, res) => res.sendFile(path.join(__dirname, '../public/pages/chatbot.html')))
app.get('/price',    (req, res) => res.sendFile(path.join(__dirname, '../public/pages/price.html')))
app.get('/about',    (req, res) => res.sendFile(path.join(__dirname, '../public/pages/about.html')))
app.get('/booking',  (req, res) => res.sendFile(path.join(__dirname, '../public/pages/booking.html')))
app.get('/login',    (req, res) => res.sendFile(path.join(__dirname, '../public/pages/login.html')))

// ============================================================
//  START SERVER
// ============================================================
app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║       Lumière Clinic Bot             ║
  ║  Running on http://localhost:${PORT}  ║
  ╚══════════════════════════════════════╝
  `)
})