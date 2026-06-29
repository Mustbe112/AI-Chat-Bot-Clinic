const express      = require('express')
const cors         = require('cors')
const cookieParser = require('cookie-parser')
const path         = require('path')
require('dotenv').config()

const { router: authRoutes } = require('./routes/auth')
const chatRoutes              = require('./routes/chat')
const appointmentRoutes       = require('./routes/appointment')

const app  = express()
const PORT = process.env.PORT || 3000

const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'https://ai-chat-bot-clinic.vercel.app'
]

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin) || origin.endsWith('.vercel.app')) {
      callback(null, true)
    } else {
      callback(new Error('Not allowed by CORS'))
    }
  },
  credentials: true  // required for cookies to be sent cross-origin
}))

// MIDDLEWARE
app.use(express.json())

// cookie-parser must come before any route that reads req.cookies
app.use(cookieParser(process.env.COOKIE_SECRET))

app.use(express.static(path.join(__dirname, '../public'), { index: false }))

// ROUTES
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

// START SERVER
app.listen(PORT, () => {
  console.log(`Running on http://localhost:${PORT}`)
})