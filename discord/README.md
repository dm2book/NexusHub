# ForgeMarket — Discord Ecosystem Blueprint

A professional, scalable Discord ecosystem for the ForgeMarket gaming marketplace
— designed to **build trust, support customers, grow the community, and drive
sales**, with heavy automation so the team can scale to thousands of members.

This folder is **implementation-ready**: the entire server is defined as data
(`src/config.js`) and built automatically (`src/setup.js`), and a runtime bot
(`src/bot.js`) handles onboarding, tickets and an AI assistant.

> **Owner control:** the server Owner is never created or modified by any script.
> Discord guarantees the Owner full permissions, full visibility and complete
> management access at all times. The bot only manages roles **below** its own.
>
> **The bot is not an Administrator.** It is invited with exactly the fifteen
> permissions it uses (`npm run invite` prints the link). Administrator would
> bypass every channel overwrite this setup applies — including the ones that
> make each support ticket private — so a bot holding it could read every
> ticket in the server, and anyone holding its token could delete the guild's
> channels or ban its members. Its only moderation action is deleting a scam
> message.

---

## 1. Quick start

```bash
cd discord
cp .env.example .env          # fill in DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID
npm install

npm run register              # registers all slash commands to DISCORD_GUILD_ID (instant)
REPOST=1 npm run setup        # builds roles, categories, channels, permissions, AutoMod + (re)posts panels
npm start                     # runs the live bot (onboarding, tickets, giveaways, AI…)
```

`REPOST=1` re-posts every panel (verify button, ticket buttons, self-role
buttons). Both scripts are **idempotent** — existing roles/channels/AutoMod rules
are reused, never duplicated, so it's safe to re-run after every update.
`npm run register` is a PUT of the full command list, so re-running it never
duplicates anything; the bot also does the same PUT itself every time it starts.
Without `DISCORD_GUILD_ID` the script registers globally (up to an hour to show) —
but the bot itself refuses to start without `DISCORD_GUILD_ID`.

**Create the bot:** discord.com/developers → New Application → Bot → copy token.
Enable **Server Members Intent** and **Message Content Intent** (required for
verify, leveling and automod). **Switch "Public Bot" OFF** on the same Bot page —
otherwise anyone with the invite link can add the bot to their own server. The
bot only works in `DISCORD_GUILD_ID` and leaves any other server it is added to
(it logs `left a guild that is not DISCORD_GUILD_ID`), but turning Public Bot off
stops it from being added in the first place. Then run `npm run invite` and open the link it
prints: `bot` + `applications.commands`, with the fifteen permissions the bot
actually uses and nothing else. Drag the bot's role **above** every role it
manages (Verified Customer, the loyalty tiers, the level roles) — Discord
refuses to grant a role that sits above the bot's own. (Optional) add `ANTHROPIC_API_KEY` for the AI
assistant and `FORGEMARKET_API_URL` for live recommendations + order lookups —
without them the bot still works (rule-based FAQ + sample replies).

> **Updating an existing server?** `git pull` first, then re-run the three
> commands above. Nothing is duplicated; new channels/commands are added and
> panels refreshed.

### Hosting it 24/7

`npm start` only runs while your terminal is open. To keep the bot online, host
it on any always-on platform — see **§13. Deploy (24/7 hosting)** below for a
copy-paste Railway / PebbleHost / Render / VPS guide. A `Procfile` is included.

---

## 2. Server structure (12 categories · 55+ channels)

Re-running `npm run setup` **enforces the whole layout**: category order,
channel order & placement (old channels are moved/renamed, never duplicated),
role order, voice permissions, user limits and the AFK channel.

Access tiers: **public** (everyone) · **verified** (after onboarding) · **vip** ·
**staff**. Read-only = members read, staff post.

### 👋 WELCOME — *public*
| Channel | Type | Purpose |
|---|---|---|
| `welcome` | read-only | Brand intro + 3-step start guide |
| `start-here` | read-only | How the server & store work |
| `rules` | read-only | Community rules |
| `verify` | button | Verification gate that unlocks the server |

### 📢 ANNOUNCEMENTS — *public*
`announcements` (announcement/followable), `updates`, `restocks` — all read-only.

### 🛒 MARKETPLACE — *verified*
`products` (catalog + store link, read-only), `deals` (read-only), `ask-the-bot`
(AI assistant + recommendations), `how-to-buy` (read-only guide).

### 💬 COMMUNITY — *verified*
`introductions`, `general`, `gaming`, `screenshots-media`, `off-topic`,
`suggestions` (live voting + staff decisions), `starboard`.

### 🔊 VOICE — *verified*
`🛋️ Lounge`, `🎮 Game Night`, `🎧 Duo` (max 2), `🎯 Squad` (max 5), `🎵 Music`,
`💤 AFK` (auto-move after 5 min idle). Voice time earns XP: **5 XP/min**,
capped at 2h per session.

### ⭐ REVIEWS — *public (read), verified (post)*
`reviews` (auto-posted verified reviews), `proof-of-delivery` (real delivery
screenshots), `vouches` (customer vouches, slow-mode). Public so prospects see
social proof before buying.

### 🎫 SUPPORT — *public*
`open-a-ticket` (button panel), `faq` (read-only), `support-info` (hours/SLAs).

### 🎫 TICKETS — *staff*
Ticket channels are created here. Opening a ticket shows a **form** (order
number + description), the bot posts the **live order status** instantly, and
each member sees only their own ticket.

### 📅 EVENTS — *verified*
`events` (announcement), `event-signup`, `events-stage` (voice).

### 🎉 GIVEAWAYS — *verified*
`giveaways` (read-only, hosted), `winners` (read-only), `giveaway-terms`
(read-only — the actievoorwaarden every giveaway links to).

### 🛠️ STAFF — *staff only*
`staff-chat`, `staff-announcements` (read-only), `ticket-logs` (transcripts),
`mod-log`, `leads` (bot posts joins, tickets, buying intent, sales), `staff-voice`.

Channel **descriptions/topics** are set automatically from `config.js`.

---

## 3. Roles & responsibilities

| Role | Key permissions | Responsibility |
|---|---|---|
| **Owner** | All (Discord-native) | You. Full control, never modified. |
| **Admin** | Manage Server/Channels/Roles/Messages, Kick/Ban, Timeout, Audit Log | Runs the server; manages staff & structure. Near-admin, below Owner. |
| **Moderator** | Manage Messages/Threads, Kick, Timeout, voice moderation | Keeps community safe & on-topic; handles spam/scams; escalates. |
| **Support** | Manage Messages/Threads (+ ticket access) | First line of customer help: tickets, orders, refunds, delivery. |
| **VIP Customer** | Same access as a member | Recognition role, granted by the store once lifetime spend passes `DISCORD_VIP_THRESHOLD_CENTS`. No extra perks. |
| **Partner** | Member + partner channel | Affiliates/collaborators; co-marketing. |
| **Verified Customer** | Base member access | Default tier after verification; full community access. |
| **Bot** | Fifteen scoped permissions (`npm run invite`) — never Administrator | Automation: onboarding, tickets, AI, logging. |

Permissions are applied via **category & channel overwrites** (least-privilege):
`@everyone` is denied view on gated categories; tiers are granted upward.

---

## 4. Onboarding & verification

1. New member joins → bot **DMs a warm welcome** and points to `#verify`.
2. `#welcome`, `#start-here`, `#rules` are visible to everyone (read-only).
3. `#verify` shows a **Verify button** → grants **Verified Customer** → unlocks
   Marketplace, Community, Events, Giveaways.
4. This gates out bots/scammers and makes the first impression feel professional.

Onboarding copy (welcome, rules, start-here) lives in `config.js → MESSAGES` and
is posted + pinned automatically.

> Tip: also enable Discord's native **Onboarding** (Server Settings → Onboarding)
> and **Rules Screening** for an extra layer — this blueprint complements both.

---

## 5. Support system (low manual workload)

- **Tickets:** `#open-a-ticket` has topic buttons (Order / Payment / Partnership /
  Other). A click opens a **private channel** visible only to the user + staff,
  pings **@Support**, and prompts for order number/details.
- **Escalation:** Support handles first response → mentions **@Moderator/@Admin**
  for policy/refund decisions. Roles are mentionable for fast paging.
- **Transcripts:** closing a ticket saves a full transcript to `#ticket-logs` and
  deletes the channel — clean, auditable, automatic.
- **Moderation:** mod actions surface in `#mod-log`; Moderators have timeout/kick;
  scam-prevention is reinforced by the rules ("staff never DM first").
- **Deflection:** `#faq` + the AI assistant resolve common questions before they
  ever become tickets.

**Workflow:** _question → AI/FAQ → (if unresolved) ticket → Support → escalate →
resolve → transcript logged._

---

## 6. Review & trust system

- `#reviews` and `#proof-of-delivery` are **public read-only** so prospects see
  real social proof before buying.
- After a completed order, your store can post a **verified review** (via the
  existing `DISCORD_ORDER_WEBHOOK_URL` in the main app, or extend the bot) — every
  review is tied to a real purchase, so it's trustworthy.
- `#vouches` lets Verified Customers add quick vouches (slow-mode to keep quality).
- Combined with verification + "staff never DM first" rules, this creates a
  visible, end-to-end trust loop.

---

## 7. Community & retention

- Discussion (`general`, `off-topic`, `introductions`) + game-specific (`gaming`)
  + media (`screenshots-media`) keep people talking.
- **Events** (tournaments/drops) and **Giveaways** (free, one equal entry per person) create
  recurring reasons to return — and giveaways are a powerful acquisition loop.
- Voice (the 🔊 VOICE hub + `events-stage`) deepens engagement — and pays XP.
- Level roles (**Level 5 ⚡ / 10 🔥 / 20 💎 / 30 👑**) are granted automatically;
  only the highest earned tier shows on the profile.
- The bot greets, recommends and nudges users toward community + giveaways.

---

## 8. AI assistant ("Forge")

Powered by Claude (`@anthropic-ai/sdk`), with **prompt caching** on the system
prompt (FAQ + live catalog) for fast, cheap responses at scale. Works in
`#ask-the-bot` and via `/ask` and `/recommend`.

Capabilities:
- **Greets** new users (join DM).
- **Answers FAQs** from a single source of truth (`config.js → FAQ`).
- **Recommends products** from the **live catalog** (`FORGEMARKET_API_URL`), never
  inventing prices or items.
- **Asks one qualifying question** when a request is vague (game/amount/budget).
- **Creates tickets** and **routes to staff** for order/payment issues.
- **Collects leads:** buying-intent messages and new joins are logged to `#leads`.
- **Promotes engagement:** points users to giveaways/community naturally.
- **Graceful fallback:** without an API key it uses a rule-based FAQ + catalog
  matcher, so it never goes silent.

Persona: helpful, concise, trustworthy, never pushy — tuned for Discord length.

---

## 9. Owner control & scalability

- **Owner** is untouched and supreme by Discord design.
- All structure is **code** → reproducible, versioned, idempotent (`setup.js` can
  re-run safely). Easy to audit and change.
- Permission model is **role/overwrite-based**, so it scales to thousands without
  per-user work.
- Automation (verification, tickets, AI, transcripts, logging) keeps **manual
  workload flat** as the community grows.
- Stateless bot → can run anywhere (Railway/Render/Fly/VPS/a container). For a
  always-on bot, use a persistent host (Discord gateway needs a long-lived
  connection — not serverless).

---

## 10. Final audit

| Category | Score | Why |
|---|---|---|
| **Trust** | 9.5/10 | Verification gate, public verified reviews + proof-of-delivery, "staff never DM" rules, buyer-protection messaging. |
| **Community quality** | 9/10 | Clear topical channels, events, giveaways, voice, bot-driven engagement. |
| **Support quality** | 9.5/10 | Button tickets, staff routing/escalation, transcripts, FAQ + AI deflection. |
| **Automation** | 9.5/10 | One-command build, auto onboarding, tickets, AI assistant, lead capture, logging. |
| **Scalability** | 9/10 | Role/overwrite permissions, idempotent code, stateless bot, prompt-cached AI. |
| **Professionalism** | 9.5/10 | Consistent naming/emojis, polished copy, least-privilege perms, clean structure. |

All categories ≥ 9/10.

**Next upgrades** (optional): native Discord Onboarding questions, auto-post
verified reviews from the store webhook into `#reviews`, and a leveling/XP system.

---

## 11. Full feature list (what the bot does)

- **Builds the whole server** (10 categories, 49 channels) with topics, least-
  privilege permissions and **rich panels/text in every key channel** — idempotent,
  resilient (one failure never aborts the run), and re-postable with `REPOST=1`.
- **Verification gate:** before verifying, members see **only the WELCOME area**.
  Verify → read & **accept the rules** (green button) → granted *Verified Customer*
  → the whole server unlocks (everything except staff). Re-running setup re-applies
  the gate to an existing server.
- **Always-can-post fix:** the bot gets its own permission overwrite in every
  category, so panels post even in read-only channels **without needing Administrator**.
- **Onboarding:** warm welcome DM that points new members to `#verify`.
- **Self-roles** (`#roles`): one-tap game roles (Roblox, Fortnite, Valorant, CoD,
  Apex, Genshin, Brawl, Clash) + alert roles (Drops, Deals, Giveaways).
- **Tickets:** topic buttons → private channel (hidden from other members),
  **Claim** (locks + disables the button) + **Close**, staff routing, full transcript
  to `#ticket-logs`, transcript **DM'd to the owner** with a ⭐ **rating** prompt.
  Also `/close`.
- **Giveaways 2.0:** `/giveaway prize minutes winners` → Enter button with a **live
  entry counter**, **multiple winners**, **verified-only** entry, Discord account
  ≥ 7 days old, one equal chance per entrant (no paid or bonus entries),
  tap-to-leave, winner **DMs**, auto-post to `#winners`. On every draw the
  entrant count and a SHA-256 of the sorted entrant ids go to `#mod-log`.
  `/reroll` skips previous winners and works until the giveaway is archived
  (30 days). Terms are posted by setup in `#giveaway-terms`.
- **Leveling / XP:** earn XP per message (cooldown), **level-up announcements**,
  `/rank` (level, XP bar, rank) and `/leaderboard`. Persisted to `xp.json`.
  `/daily` claims a growing daily XP bonus (streaks, caps at 10 days) and a
  **weekly top-10 leaderboard** auto-posts to `#general` every Monday evening.
- **Suggestions:** `/suggest` → embed in `#suggestions` with ✅/❌ voting.
- **Starboard:** ⭐-react any message → at 3 stars it's reposted to `#starboard`.
- **AI assistant "Forge"** (`#ask-the-bot`, `/ask`, `/recommend`): FAQ + live
  product recommendations (Claude + prompt caching, rule-based fallback).
- **VIP automation** (store side): a paid order grants *Verified Customer*, and
  lifetime spend over the VIP threshold adds *VIP Customer* (a recognition role)
  to buyers who linked Discord.
- **Promos:** `/coupon code percent` → posts to `#discount-codes` (pings Deals);
  `/flashsale deal minutes [code]` → live-countdown deal in `#deals` (auto-greys
  out when it ends); `/announce message` → posts to `#announcements`.
- **Live server stats:** auto-managed voice channels (👥 Members, 💎 Boosts).
- **Order lookup:** `/order <number>` via the store's public tracking API.
- **Vouches:** `/vouch stars message` (stars required) posts to `#vouches`. When
  the member's Discord is linked to a store account with a completed order it is
  labelled **Verified purchase**, sent to the website for review and eligible for
  the daily spotlight; otherwise it is a **community vouch** and stays in Discord.
- **Auto-moderation:** setup creates Discord AutoMod rules (scam keywords/regex,
  mention spam, spam). The bot also removes invites, "free robux/vbucks/nitro" and
  generator bait, lookalike store domains and fake Roblox/Steam/Discord/Epic links
  from non-staff (outside tickets) — on new **and edited** messages — and logs to
  `#mod-log`.
- **Anti-scam & anti-raid:** welcome DM warns *staff never DMs first*;
  staff-impersonation detection (lookalike characters normalized) alerts
  `#mod-log` on join/nickname change; a join-rate spike (8+/min) pings staff.
- **Live #price-list:** auto-updating embed from the real catalog, every 10 min.
- **Price lookup:** `/price <product>` — fuzzy match with buy link + close matches.
- **Polls:** `/poll question [option1..4]` → reaction voting (👍/👎 or 1️⃣–4️⃣).
- **Ticket hygiene:** tickets idle for 24h get a "still there?" ping; 24h later
  they auto-close with the usual transcript + rating DM (restart-safe).
- **Community sparkle:** boost thank-yous in `#general`, member-count milestone
  celebrations every 100 members, a public welcome in `#general` on every join
  (auto-suppressed during join spikes, auto-deletes after 10 min) and a daily
  **vouch spotlight** — one recent verified-purchase vouch reposted every afternoon.
- **Loyalty tier roles:** Bronze / Silver / Gold / Platinum are created by setup
  (colour-matched to the site) and assigned automatically by the store's
  role-sync on every paid order.
- **Restart-safe:** active giveaways (incl. entries + timers) and the starboard
  index persist to disk and are restored on boot.
- **Ticket QoL:** paste an order number (FM-2026-…) in any ticket and the bot
  instantly replies with the live order status + latest timeline.
- **Logging + leads:** joins, leaves, tickets and buying-intent posted to staff channels.
- **Slash commands:** `/help /ask /recommend /price /order /vouch /suggest /poll
  /daily /shop /invite /stats /serverinfo /rank /leaderboard` and staff:
  `/giveaway /reroll /coupon /flashsale /announce /close`.

## 12. Brand assets

- `assets/logo.svg` — the ForgeMarket mark. A ready-to-upload **512×512 PNG** is
  provided for your Discord **server icon / bot avatar** (Server Settings → upload).

---

## 13. Deploy (24/7 hosting)

The bot keeps a long-lived gateway connection, so it must run on an **always-on
process** (a "worker"/"background" service — *not* a serverless function). This
folder ships everything a host needs: a `Procfile`, a `Dockerfile`, a
`railway.json`, and `engines.node >=18`.

**First, one-time setup (run locally once):** register the slash commands and
build the server. Re-run `setup` when the server structure changes; the bot
re-registers commands itself on every start.

```bash
cd discord && npm install
npm run register
REPOST=1 npm run setup
```

Then deploy the always-on bot (`node src/bot.js`) with one of:

### Option A — Railway (recommended, 24/7)

1. Push this repo to GitHub (already done).
2. [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo**
   → pick this repo.
3. **Settings → Source → Root Directory:** `discord` (so it builds this folder only).
4. **Settings → Config-as-code → Railway Config File:** `/discord/railway.json`.
   Railway does not look inside the root directory for it by itself; the path is
   from the repository root.
5. **Variables** → paste the block below. Every one of them is explained in
   [`.env.example`](.env.example), which is generated from the same list the bot
   validates against at startup, so the two cannot drift.
6. **Deploy.** `railway.json` builds the `Dockerfile` (which runs
   `node src/bot.js` as a non-root user), sets **restart policy ALWAYS** and the
   health check path `/health`.

**The variables Railway needs**

| | Variable | Without it |
|---|---|---|
| **Required** | `DISCORD_TOKEN` | The bot refuses to start. |
| **Required** | `DISCORD_GUILD_ID` | The bot refuses to start. It only serves this server and leaves any other. |
| Strongly recommended | `DISCORD_CLIENT_ID` | `npm run invite` and `npm run register` cannot run. |
| | `DISCORD_OWNER_IDS` | Owner commands (`/paylink`, `/digest`, `/coupon`, `/announce`…) fall back to "has Manage Server". |
| | `STORE_URL` | Every link the bot posts has nowhere to go. |
| | `FORGEMARKET_API_URL` | `/price`, `/order` and the store relay are off. |
| | `REVIEW_INGEST_SECRET` | **The relay is silent**: no order pings, no drops, no delivery DMs, and no durable state. Must match Vercel exactly. |
| Optional | `ANTHROPIC_API_KEY` | A rule-based FAQ answers instead of the AI. |
| | `AI_DAILY_CAP` | Default 300 AI answers per day for the whole server. |
| | `DISCORD_PAYLINK_SECRET` | `/paylink` is disabled. Must match the API's value. |
| | `PAYLINK_HOSTS` | Only the API's payment-host allow-list applies. |
| | `LAUNCH_DATE` | Launch post goes out at `2026-10-23T22:00:00Z` (24 Oct, 00:00 Amsterdam). |
| | `SUPPORT_HOURS` | #support-info says "Elke dag, reactie meestal binnen 24 uur (NL tijd)". |
| | `DISCORD_INVITE_URL` | `/invite` says the link is not ready until the bot has made its own. |
| | `PORT` | Railway sets this itself — it turns on the health endpoint. |
| | `LOG_LEVEL`, `LOG_FORMAT` | Defaults are `info` and JSON off a terminal. |

The bot logs a warning naming every recommended variable it is missing, and what
stops working. A missing required variable is fatal and exits `1`, so a
half-configured deploy shows as crashed rather than as a bot quietly doing nothing.

**Health check.** Railway → **Settings → Healthcheck Path: `/health`**. The bot
serves it on `$PORT`:

```json
{ "ok": true, "status": "connected", "uptimeSeconds": 3812,
  "gateway": { "ping": 41, "guilds": 1 }, "bot": "ForgeMarket#1234" }
```

It answers **503 while the gateway is not connected**. Railway only uses the
health check **while deploying** (a new deploy goes live once `/health` answers
200); it does not keep polling it afterwards. Staying up is handled by the bot
itself: an in-process watchdog exits with code 1 when the gateway has not been
ready for five minutes, a terminal gateway close (bad token, intents switched
off) exits 1, and an uncaught exception flushes state and exits 1. With restart
policy **ALWAYS**, Railway then starts a fresh process.

**Logs.** JSON, one line per event, so Railway's log search can filter them:

```json
{"lvl":"info","msg":"health endpoint listening","at":"…","port":8080}
{"lvl":"warn","msg":"gateway disconnected","at":"…","shard":0,"code":1006,"terminal":false}
```

`LOG_FORMAT=pretty` gives human output for a local run; a terminal gets that by
default.

**What to watch on the first deploy**

- `connecting to Discord…` then `gateway ready` — it is online.
- `login failed: the token is invalid` / `privileged intents are off` — these do
  not retry, because a retry cannot fix them. Fix the cause and redeploy.
- `login failed — retrying` — Discord or the network is having a moment. It
  backs off up to six times before giving up and letting Railway restart it.
- `running without REVIEW_INGEST_SECRET` — the bot is up but the shop cannot
  reach it. Copy the value from Vercel.

### Option B — PebbleHost (Discord bot hosting)
1. Order a **Discord Bot** server with **Node.js 20**.
2. In the file manager (or SFTP) upload the contents of the `discord/` folder —
   **without** `node_modules` (PebbleHost installs dependencies itself from
   `package.json`) and without any `.env` you have locally with secrets you
   do not want there.
3. **Startup file / main file:** `src/bot.js`.
4. Create a `.env` file in the uploaded folder (same directory as
   `package.json`) with at least `DISCORD_TOKEN`, `DISCORD_GUILD_ID`,
   `DISCORD_CLIENT_ID`, `STORE_URL`, `FORGEMARKET_API_URL` and
   `REVIEW_INGEST_SECRET` (see `.env.example` for the rest). Leave **`PORT`
   unset** — PebbleHost does not route a web port to the bot, and without it
   the health endpoint simply stays off.
5. Once, from the PebbleHost console (or locally with the same `.env`):
   `npm run register` and then `npm run setup`. Do not put these in the startup
   command — the bot re-registers commands itself on every start, and `setup`
   only needs to run when the server structure changes.
6. Start the server. If the gateway drops and does not come back within five
   minutes the bot exits with code 1; turn on PebbleHost's auto-restart so it
   is started again.

### Option C — Render
1. [render.com](https://render.com) → **New → Background Worker** → connect repo.
2. **Root Directory:** `discord` · **Build:** `npm ci` · **Start:** `node src/bot.js`.
3. Add the same environment variables → Create. (Use a paid instance type; the
   free tier sleeps and the bot would drop offline.)

### Option D — A VPS, in one command (no Railway needed)
For when Railway will not take your card: any Ubuntu 22.04/24.04 or Debian 12
VPS works — pick a provider whose checkout accepts a payment method you have
(iDEAL, PayPal, …). The smallest plan is plenty: 1 vCPU, 1 GB RAM.

1. Put this `discord` folder on the server (from the zip, or `git clone`).
2. Run, from inside it:
   ```bash
   sudo bash deploy/install-vps.sh
   ```
3. Answer the questions once: bot token, application ID, server ID and the
   `REVIEW_INGEST_SECRET` from Vercel. They go to `/etc/forgemarket-bot.env`,
   readable only by root and the bot.

The bot then starts at boot, is restarted within seconds if it stops, and a
watchdog restarts it when it is running but no longer connected to Discord.
To update: put the new folder on the server and run the same command — the
settings and the live XP and giveaways are kept.
Logs: `sudo journalctl -u forgemarket-bot -f`.

### Option E — Docker by hand
```bash
# On the server, after cloning:
cd discord
docker build -t forgemarket-bot .
docker run -d --name forgemarket-bot --restart unless-stopped \
  -e DISCORD_TOKEN=... -e DISCORD_CLIENT_ID=... -e DISCORD_GUILD_ID=... \
  -e STORE_URL=https://forgemarket.nl \
  forgemarket-bot
```
Or without Docker, keep it alive with **pm2**: `npm i -g pm2 && pm2 start npm --name forgemarket-bot -- start && pm2 save`.

> **Secrets:** never commit `.env`. Set every secret in the host's dashboard
> (or `-e` flags). `.env` and the local state files are git-ignored.
>
> **No volume needed.** XP, running giveaways and the weekly bookkeeping are
> kept in the store, over the signed relay, and read back on boot — so a
> redeploy loses none of it. The JSON files next to the source are a fallback
> for a bot pointed at no site, and a container that throws its disk away on
> every deploy costs nothing. (This used to be untrue: the files were the only
> copy, and every deploy reset every member's level and dropped every running
> giveaway. Set `REVIEW_INGEST_SECRET` and it cannot happen again.)
>
> **Graceful shutdown.** Railway sends `SIGTERM` before replacing a container.
> The bot flushes its state, closes the health endpoint, tells Discord it is
> going, and exits — rather than leaving the member list showing it green until
> the gateway times the session out.
