# Lumière Skin Clinic — AI Chatbot Technical Documentation

---

## Deployment

| Item | Value |
|---|---|
| Production URL | `https://ai-chat-bot-clinic.vercel.app` |
| Frontend hosting | Vercel (static HTML + JS) |
| Backend hosting | Render (Node.js Express, keep-alive via `/health`) |
| Database | Supabase (PostgreSQL) |
| AI model | Google Gemini 2.5 Flash |
| Runtime | Node.js, CommonJS |

> The frontend is served as static HTML from Vercel. The backend runs as a separate Express server on Render, kept alive by UptimeRobot pinging `/health`.

---

## Data Structure

### Database tables (Supabase / PostgreSQL)

#### `users`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `display_name` | text | |
| `email` | text | nullable for guests |
| `phone` | text | |
| `id_number` | text | registered users only |
| `password_hash` | text | bcrypt, 10 rounds |
| `session_id` | text | unique guest/session token |
| `is_registered` | boolean | false = guest row |
| `picture_url` | text | DiceBear avatar |

#### `appointments`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK → users | |
| `service_id` | int FK → services | |
| `slot_datetime` | timestamptz | stored in UTC |
| `booking_ref` | text | format `TCB-YYYYMMDD-NNN` |
| `status` | text | `confirmed` / `cancelled` |
| `notes` | text | optional |
| `guest_name/phone/email` | text | guest bookings only |

#### `services`
| Column | Type | Notes |
|---|---|---|
| `id` | int PK | 1–14 |
| `name` | text | |
| `category` | text | |
| `price` | int | THB |
| `duration_min` | int | |
| `is_active` | boolean | |

#### `chat_history`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK | |
| `role` | text | `user` / `model` |
| `content` | text | |
| `created_at` | timestamptz | |

#### `message_usage`
| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid FK | |
| `usage_date` | date | |
| `count` | int | resets daily |

#### `blocked_keywords`
| Column | Type | Notes |
|---|---|---|
| `keyword` | text | case-insensitive match |

---

## System Design

### Architecture overview

```
Browser (Vercel)
  │  HTML + JS (chatbot-widget.js, auth-nav.js, script.js)
  │  REST over HTTPS
  ▼
Express server (Render)
  ├── /auth      — register, login, /me
  ├── /chat      — POST message, GET history
  └── /appointments — slots, book, book-guest, cancel, reschedule
         │
         ├── scheduler.js  — slot availability queries (UTC+7)
         ├── gemini.js     — Gemini API + function-calling loop
         └── supabase.js   — Supabase client (anon key)
                │
                ▼
           Supabase PostgreSQL
```

### Appointment slot system

Seven fixed daily slots (Thai local time UTC+7):
`09:00 · 10:05 · 11:10 · 13:05 · 14:10 · 15:15 · 16:20`

Each slot supports up to **2 concurrent bookings**. Sundays are skipped. All datetimes are stored in UTC and converted to Thai time for display only.

### Chat flow (AI layer)

1. Message arrives at `POST /chat`.
2. Rate limit checked (5 msgs / 10 s, in-memory Map).
3. Daily limit checked (50 msgs / day, from `message_usage`).
4. Message scanned against `blocked_keywords`.
5. Last 10 messages loaded from `chat_history` as context.
6. System prompt chosen: **guest** (read-only) or **logged-in** (full booking access).
7. Gemini called with matching function declarations.
8. Any `functionCall` responses are executed in a loop until a plain text reply is returned.
9. Both the user message and AI reply are saved to `chat_history`.

### Two booking paths

| | Way 1 — Guest booking | Way 2 — Chat booking |
|---|---|---|
| Auth required | No | Yes (JWT) |
| Entry point | Book Now button | Chatbot |
| Endpoint | `POST /appointments/book-guest` | `POST /appointments/book` |
| User row | Created on the fly | Resolved from JWT |
| Data collected | name, phone, email | from existing account |

---

## Performance

### Rate limiting (layered)
- **Auth routes** — in-memory Map per IP: login 10 req / 15 min, register 5 req / hr, `/me` 60 req / min.
- **Chat burst** — 5 messages / 10 seconds per userId.
- **Daily message cap** — 50 messages / day per user (DB-backed, resets at midnight).
- Expired entries pruned every 5 minutes to prevent unbounded memory growth.

### Gemini API resilience
`sendWithRetry()` retries up to 3 times on HTTP 429 or 503, respecting the `RetryInfo.retryDelay` from the error details when present. Default back-off is 60 s for 429 and 5 s for 503.

### Session token refresh
On every authenticated request the server issues a refreshed JWT (`X-Refreshed-Token` header) with an updated `lastActive` timestamp, silently resetting the idle clock without a new login.

### Keep-alive
The `/health` endpoint returns `{ status: "ok" }` for UptimeRobot and Render's zero-downtime monitoring. This prevents the Render free-tier instance from sleeping.

---

## Security

### Authentication
- Passwords hashed with **bcrypt** (10 salt rounds).
- Tokens signed with **JWT** (HS256), 1-hour expiry.
- Inactivity logout: server checks `lastActive` on every request; if idle > 3600 s → 401 `SESSION_TIMEOUT`. Client-side idle timer warns at 28 min and clears tokens at 30 min.
- Token cleared from `localStorage` on logout and idle-out. Cross-tab sync via `storage` event.

### Input validation
- Email regex, minimum 8-char password, phone format check on registration.
- Message length hard cap: **200 characters**.
- `blocked_keywords` table for content moderation (case-insensitive substring match).
- `isValidEmail` and `isValidPhone` helpers on the auth route.

### CORS
Strict allowlist: `localhost:3000` and `*.vercel.app`. All other origins rejected.

### Slot integrity
`isSlotAvailable()` re-checks the booking count at write time (not just at slot-display time) before any `INSERT`, preventing double-booking under concurrent requests.

### JWT typo bug (known)
`rateLimit('regsiter')` in `auth.js` contains a typo (`regsiter` instead of `register`). This causes the register rate-limit rule to not be applied on that route because the key lookup fails silently. **Fix:** change `'regsiter'` to `'register'` in the `router.post('/register', ...)` call.

---

## Challenges & Solutions

### 1. Timezone handling
**Problem:** Clinic operates in UTC+7 (Thailand), but all timestamps must be stored in UTC for consistent querying.

**Solution:** `thaiToUTC()` in `scheduler.js` and `thaiLocalToUTC()` in `appointment.js` / `gemini.js` convert Thai local ISO strings to UTC before any DB write. `todayInThai()` derives the current date by adding the offset to `Date.now()`. Display-only formatting always uses `Asia/Bangkok` as the `timeZone` argument.

### 2. AI function-calling loop
**Problem:** Gemini may return multiple sequential function calls before producing a text reply (e.g. fetch slots → book appointment).

**Solution:** A `while` loop in `gemini.js` continues sending `functionResponse` objects back to the chat session until `response.functionCalls()` is empty. Slot data is captured from the first `get_available_slots` call and forwarded to the client alongside the final text reply so the widget can render clickable time chips.

### 3. Guest vs logged-in AI behaviour
**Problem:** The AI must not offer booking actions to unauthenticated users, but the same chat endpoint serves both.

**Solution:** `isLoggedIn` is resolved in the chat route and passed to `gemini.js`. Two distinct system prompts are used — the guest prompt explicitly forbids calling booking functions and instructs the AI to redirect to the guest booking button. The logged-in prompt unlocks the full function declaration set.

### 4. Duplicate `generateRef()` function
**Problem:** `generateRef()` is defined identically in both `gemini.js` and `appointment.js`, creating a maintenance risk.

**Solution (recommended):** Extract to a shared utility file, e.g. `src/services/utils.js`, and import from both routes.

### 5. Guest user creation race condition
**Problem:** Two simultaneous guest bookings with the same email could attempt to insert duplicate user rows.

**Solution (partial):** The `book-guest` route first queries by email and only inserts if no row is found. A database-level `UNIQUE` constraint on `users.email` (or an upsert) would fully eliminate the race.

### 6. In-memory rate limiters don't survive restarts
**Problem:** The `rateLimitStore` and `chatRateStore` Maps live in process memory. A Render instance restart resets all counters.

**Solution (recommended for production):** Replace both Maps with a Redis-backed store (e.g. `ioredis` + sliding window). The code is structured so the swap is isolated to each store's `get`/`set` calls.
