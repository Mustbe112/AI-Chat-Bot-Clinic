const express  = require('express')
const router   = express.Router()
const bcrypt   = require('bcrypt')
const jwt      = require('jsonwebtoken')
const supabase = require('../services/supabase')

const JWT_SECRET      = process.env.JWT_SECRET
const SALT_ROUNDS     = 10
const TOKEN_EXPIRES   = '1h'    // stay logged in for 1 hour
const SESSION_TIMEOUT = 30 * 60 // 30 min of inactivity (seconds)

// On localhost (plain HTTP) cookies marked Secure are silently dropped
// by the browser, and SameSite=None requires Secure to be set at all —
// so both flags must flip together based on environment.
const IS_PROD = process.env.NODE_ENV === 'production'

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure:   IS_PROD,                  // true in prod (HTTPS), false on localhost (HTTP)
  sameSite: IS_PROD ? 'none' : 'lax',  // 'none' needed cross-site in prod; 'lax' works fine on localhost
  maxAge:   60 * 60 * 1000 // 1h, matches TOKEN_EXPIRES
}

// In-memory rate limiter
// Keyed by IP. Each entry: { count, resetAt }
// For multi-instance deployments, replace with Redis-backed storage.
const rateLimitStore = new Map()

const RATE_LIMIT_RULES = {
  login:    { windowMs: 15 * 60 * 1000, max: 10, message: 'Too many login attempts. Please try again in 15 minutes.' },
  register: { windowMs: 60 * 60 * 1000, max: 5,  message: 'Too many registration attempts. Please try again in 1 hour.' },
  me:       { windowMs:  1 * 60 * 1000, max: 60,  message: 'Too many requests. Please slow down.' }
}

function rateLimit(ruleName) {
  const rule = RATE_LIMIT_RULES[ruleName]
  if (!rule) throw new Error(`Unknown rate limit rule: "${ruleName}"`)
  return (req, res, next) => {
    const key     = `${ruleName}:${req.ip}`
    const now     = Date.now()
    const entry   = rateLimitStore.get(key)

    if (!entry || now > entry.resetAt) {
      rateLimitStore.set(key, { count: 1, resetAt: now + rule.windowMs })
      return next()
    }

    entry.count++
    if (entry.count > rule.max) {
      const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000)
      res.set('Retry-After', retryAfterSec)
      return res.status(429).json({
        success: false,
        message: rule.message,
        retryAfter: retryAfterSec
      })
    }
    next()
  }
}

// Periodically prune expired entries to avoid unbounded memory growth
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of rateLimitStore) {
    if (now > entry.resetAt) rateLimitStore.delete(key)
  }
}, 5 * 60 * 1000)

// Middleware: verify JWT + session timeout 
// How inactivity logout works:
//   - Every token carries a `lastActive` timestamp (Unix seconds).
//   - On each authenticated request we check how long ago that was.
//   - If idle longer than SESSION_TIMEOUT → 401 SESSION_TIMEOUT.
//   - If still active, a fresh token is issued in X-Refreshed-Token.
//     The client must swap its stored token for this value on every
//     response that includes it — this silently resets the idle clock.
function authMiddleware(req, res, next) {
  const token = req.cookies && req.cookies.token
  if (!token) {
    return res.status(401).json({ success: false, message: 'Not authenticated.' })
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    req.userId = payload.userId

    // Check inactivity
    const lastActive = payload.lastActive || payload.iat
    if (Math.floor(Date.now() / 1000) - lastActive > SESSION_TIMEOUT) {
      res.clearCookie('token', COOKIE_OPTIONS)
      return res.status(401).json({
        success: false,
        message: 'Session expired due to inactivity. Please log in again.',
        code: 'SESSION_TIMEOUT'
      })
    }

    // Refresh token so the idle clock resets on every active request
    const refreshed = jwt.sign(
      { userId: payload.userId, lastActive: Math.floor(Date.now() / 1000) },
      JWT_SECRET,
      { expiresIn: TOKEN_EXPIRES }
    )
    res.cookie('token', refreshed, COOKIE_OPTIONS)

    next()
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired token.' })
  }
}

// Validation helpers 
function isValidEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) }
function isValidPhone(p) { return /^[0-9+\-\s]{7,15}$/.test(p) }

//  POST /auth/register

router.post('/register', rateLimit('register'), async (req, res) => {
  try {
    const { name, email, password, phone, idNumber } = req.body

    // Validate required fields
    if (!name || !email || !password || !phone || !idNumber) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required: name, email, password, phone, ID number.'
      })
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email address.' })
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' })
    }
    if (!isValidPhone(phone)) {
      return res.status(400).json({ success: false, message: 'Invalid phone number.' })
    }

    // Check duplicate email
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase().trim())
      .single()

    if (existing) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists.' })
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS)
    const sessionId    = 'reg-' + Math.random().toString(36).slice(2, 9) + '-' + Date.now()

    const { data: user, error } = await supabase
      .from('users')
      .insert({
        display_name:  name.trim(),
        email:         email.toLowerCase().trim(),
        password_hash: passwordHash,
        phone:         phone.trim(),
        id_number:     idNumber.trim(),
        session_id:    sessionId,
        is_registered: true,
        picture_url:   `https://api.dicebear.com/7.x/personas/svg?seed=${sessionId}`
      })
      .select('id, display_name, email, phone, picture_url')
      .single()

    if (error) throw error

    const token = jwt.sign(
      { userId: user.id, lastActive: Math.floor(Date.now() / 1000) },
      JWT_SECRET,
      { expiresIn: TOKEN_EXPIRES }
    )

    res.cookie('token', token, COOKIE_OPTIONS)

    res.status(201).json({
      success: true,
      message: 'Account created successfully.',
      user: {
        id:          user.id,
        displayName: user.display_name,
        email:       user.email,
        phone:       user.phone,
        pictureUrl:  user.picture_url
      }
    })
  } catch (error) {
    console.error('Register error:', error)
    res.status(500).json({ success: false, message: 'Could not create account. Please try again.' })
  }
})

//  POST /auth/login

router.post('/login', rateLimit('login'), async (req, res) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' })
    }

    const { data: user } = await supabase
      .from('users')
      .select('id, display_name, email, phone, picture_url, password_hash, is_registered')
      .eq('email', email.toLowerCase().trim())
      .single()

    if (!user || !user.is_registered) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' })
    }

    const match = await bcrypt.compare(password, user.password_hash)
    if (!match) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' })
    }

    const token = jwt.sign(
      { userId: user.id, lastActive: Math.floor(Date.now() / 1000) },
      JWT_SECRET,
      { expiresIn: TOKEN_EXPIRES }
    )

    res.cookie('token', token, COOKIE_OPTIONS)

    res.json({
      success: true,
      user: {
        id:          user.id,
        displayName: user.display_name,
        email:       user.email,
        phone:       user.phone,
        pictureUrl:  user.picture_url
      }
    })
  } catch (error) {
    console.error('Login error:', error)
    res.status(500).json({ success: false, message: 'Login failed. Please try again.' })
  }
})


//  POST /auth/logout  (stateless JWT — client clears token)

router.post('/logout', (req, res) => {
  res.clearCookie('token', COOKIE_OPTIONS)
  res.json({ success: true, message: 'Logged out.' })
})


//  GET /auth/me  — verify token, return user info

router.get('/me', rateLimit('me'), authMiddleware, async (req, res) => {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('id, display_name, email, phone, picture_url, is_registered')
      .eq('id', req.userId)
      .single()

    if (!user) return res.status(404).json({ success: false, message: 'User not found.' })

    res.json({
      success: true,
      user: {
        id:          user.id,
        displayName: user.display_name,
        email:       user.email,
        phone:       user.phone,
        pictureUrl:  user.picture_url,
        isRegistered: user.is_registered
      }
    })
  } catch (error) {
    console.error('Me error:', error)
    res.status(500).json({ success: false, message: 'Could not fetch user.' })
  }
})

module.exports = { router, authMiddleware }