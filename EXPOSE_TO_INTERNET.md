# Exposing the app to the internet

This app is a local dev server (`npm run dev`, `http://localhost:3000`). To
let someone outside this machine reach it — for a demo, a quick review, or
testing from a phone — you need a tunnel: a service that opens a public
URL and forwards traffic to your local port. No deployment, no server
setup, nothing changes in the app itself.

If the other computer is on the **same network** as this one (same
office/corporate LAN, same WiFi), you don't need a tunnel at all — see
"Same network" below. A tunnel is only needed when the other computer is
somewhere else entirely (different building, home, mobile data).

## Same network — no tunnel needed

1. On this machine: `npm run dev` (leave it running)
2. Find this machine's LAN IP: `ipconfig` (Windows) → the `IPv4 Address`
   under the adapter that has a `Default Gateway` set (that's the real
   network adapter, not a virtual/host-only one). On this machine that's
   currently `172.23.37.45`.
3. On the other computer, open a browser to `http://<that IP>:3000` — e.g.
   `http://172.23.37.45:3000`. Confirmed reachable: `next dev` binds to
   all network interfaces by default, not just `localhost`.

This only works while both computers are on the same network, and the IP
can change if this machine reconnects or gets a new DHCP lease — re-check
`ipconfig` if it stops responding.

## Different network — use a tunnel

Two tunnel tools are installed as dev dependencies (`npm run dev` must
already be running in another terminal before either of these):

### Option A — Cloudflare Tunnel (recommended on this network)

```bash
npm run tunnel:cloudflare
```

Runs `cloudflared tunnel --url http://localhost:3000`. After a few
seconds it prints a public URL:

```
Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):
https://random-words-here.trycloudflare.com
```

That URL proxies straight to your local `:3000` over HTTPS. No account,
no signup, no config file needed. **Verified working from NIB's corporate
network** (see "Why not localtunnel" below) — confirmed live: the public
URL served the app's actual login page.

Each run generates a new random URL — there's no stable/reusable address
with the quick-tunnel (account-less) mode used here.

### Option B — localtunnel

```bash
npm run tunnel
```

Runs `lt --port 3000`. Also prints a public `https://<name>.loca.lt` URL.
Simpler tool, but **does not work from NIB's corporate network** — see
below. Worth trying if you're on a different network (home, mobile
hotspot) where it may work fine and is slightly simpler to reason about.

Optional: `lt --port 3000 --subdomain my-name` requests a stable,
memorable subdomain instead of a random one (subject to availability,
not guaranteed).

### Why not localtunnel (on this network)

Tested and confirmed: on NIB's corporate network, DNS for `loca.lt`
resolves fine and a bare TCP handshake on port 443 succeeds, but the
actual HTTPS request to it hangs indefinitely — `npm run tunnel` will sit
there with no URL printed, forever. Meanwhile general internet (Google,
GitHub, npm, and Cloudflare's `trycloudflare.com`) all work normally. This
is the network firewall/proxy blocking that specific host, not a bug in
the app or the tunnel tool. If `npm run tunnel` never prints a URL after
~15 seconds, stop it (`Ctrl+C`) and use `npm run tunnel:cloudflare`
instead.

## Before you share the URL — read this

A tunnel makes the **real app** reachable, with real login — there's no
separate "demo mode." Specifically:

- **Change the seeded passwords first** if this will be shared beyond
  people who already have the credentials. `/admin/users` → Edit → Reset
  password. The default accounts (`admin` / `Admin@123`, etc.) are listed
  right on the login page itself, so anyone who reaches the URL can see
  them.
- **The tunnel URL itself is not secret** — anyone who has it can reach
  the app's login screen. Cloudflare's quick-tunnel URLs are long random
  strings (hard to guess), but they're not access-controlled beyond that.
  Only share the URL with people who should be able to attempt a login.
- **Stop the tunnel when you're done** (`Ctrl+C` in that terminal). The
  public URL stops working immediately once the process exits.
- Data still lives in the same local `data/db.json` file as always —
  nothing about tunneling changes storage, persistence, or where the data
  lives.

## Quick reference

| Scenario | Command | Works on NIB network? |
|---|---|---|
| Same network as this machine | `http://172.23.37.45:3000` directly, no command | ✅ Yes — verified |
| Different network | `npm run tunnel:cloudflare` | ✅ Yes — verified |
| Different network | `npm run tunnel` (localtunnel) | ❌ No — blocked, hangs with no URL |

The tunnel commands require `npm run dev` already running in a separate
terminal first. The LAN IP above is this machine's current address — it
can change; re-check with `ipconfig` if it stops responding.
