# Redis on Windows (Memurai)

NIB Control360 uses **Redis**. On Windows that's **Memurai**, a Redis-compatible Windows service. This page explains what it's for, how to keep it running, what the `redis.unavailable` warning means, and how to check it.

## 1. What Redis is used for

| Feature | If Redis is down |
|---|---|
| **Sign-in lockout and rate limits** (sign-in, password reset, uploads, messages) | They **switch off**. Sign-in still works, but brute-force protection is gone |
| **Register Finding draft autosave** (recovering an unsaved form) | Off: an unsaved form isn't recovered |
| **Email queue**, when `EMAIL_QUEUE_DRIVER=bullmq` (this app's `.env`) | **Notification and forgot-password emails wait** in the queue until Redis is back |

The app is built **not to stop** when Redis is down. Requests continue, and it logs a warning instead of failing.

## 2. The warning: `redis.unavailable`

```
"event":"redis.unavailable","reason":"ECONNREFUSED: connect ECONNREFUSED ::1:6379; connect ECONNREFUSED 127.0.0.1:6379",
"message":"Redis is unavailable - rate limiting and draft autosave are off until it's back (requests continue)"
```

**Why it appears:** the app tried to connect to `REDIS_URL` (`redis://localhost:6379`) and nothing answered on port 6379. Memurai was stopped, still starting, or not installed.

**During `npm run build`:** the build loads the app's pages with several workers, and each one tries Redis, so you can see the warning several times. **The build still succeeds** (look for `✓ Generating static pages`). It's harmless during a build, but it shows that Redis wasn't running at that moment.

**While the app is running:** it is **not** harmless. Rate limits are off and emails queue up. Start Memurai (§3).

## 3. Keep Memurai running (once per machine)

Open **PowerShell as Administrator**:

```powershell
# 1. Is it running?
Get-Service Memurai | Select-Object Name, Status, StartType

# 2. Start it if Status is Stopped
Start-Service Memurai

# 3. Start it automatically with Windows
Set-Service Memurai -StartupType Automatic

# 4. Does it answer on port 6379?
Test-NetConnection 127.0.0.1 -Port 6379
```

- **Expected:** Status **Running**, StartType **Automatic**, and `TcpTestSucceeded : True`.
- **`Start-Service` and `Set-Service` print nothing when they succeed.** No output means it worked; a failure shows a red error. Confirm with step 1.

## 4. Start order

1. **Memurai**
2. The app: `npm start` (production) or `npm run dev`
3. The email worker: `npm run worker:email` (needed because `EMAIL_WORKER=external`)

On the **deployment server**, where the app and worker are NSSM services (PRODUCTION.md §6.2), make both wait for Memurai, so a reboot always starts them in the right order:

```powershell
nssm set NIBControl360      DependOnService Memurai
nssm set NIBControl360Email DependOnService Memurai
```

## 5. Settings

| Where | Value |
|---|---|
| `.env` | `REDIS_URL=redis://localhost:6379`. With a password: `redis://:PASSWORD@localhost:6379` |
| Memurai config (production) | Set a password (`requirepass`) and keep it bound to localhost or a private network (PRODUCTION.md §2) |

## 6. Troubleshooting

| You see | Cause | Do |
|---|---|---|
| `ECONNREFUSED ... 6379` | Memurai not running | `Start-Service Memurai` |
| `Get-Service Memurai` → *Cannot find any service* | Memurai not installed | Install Memurai (Redis 6+ compatible), then §3 |
| `NOAUTH Authentication required` | Memurai has a password, `REDIS_URL` doesn't | Put the password in `REDIS_URL` |
| Emails not arriving, no SMTP errors | Redis down, or the email worker not running | §3, then start `npm run worker:email` |
| Warning only during `npm run build` | Memurai stopped at build time | Harmless for the build; start Memurai before running the app |

Related: [PRODUCTION.md](PRODUCTION.md) (§2 prerequisites, §6.3 email queue), [email-queue.md](email-queue.md) (BullMQ driver), [auth-security-review.md](auth-security-review.md) (M1: limits off when Redis is down).
