#!/usr/bin/env bash
#
# ForgeMarket Discord bot — 24/7 on any Ubuntu/Debian VPS, in one command.
#
#   sudo bash deploy/install-vps.sh
#
# Run it from inside the `discord` folder (from the zip or a git clone). It:
#   1. installs Node.js 20 if the server does not have it;
#   2. copies the bot to /opt/forgemarket-bot and installs its dependencies;
#   3. asks for your Discord token and the other settings ONCE and stores them
#      in /etc/forgemarket-bot.env, readable by root and the bot only — never
#      in the code folder, never printed back;
#   4. installs a systemd service: the bot starts when the server boots and is
#      restarted within seconds whenever it stops;
#   5. installs a watchdog that asks the bot's own health endpoint every two
#      minutes and restarts it if it is running but no longer connected to
#      Discord — the failure "it is on, but silent".
#
# Running it again UPDATES the bot (new code, same settings) and restarts it.
set -euo pipefail

APP_DIR=/opt/forgemarket-bot
ENV_FILE=/etc/forgemarket-bot.env
SERVICE=forgemarket-bot
BOT_USER=forgebot
HEALTH_PORT=8787
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

say() { printf '\n\033[1;35m▶ %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run with sudo:  sudo bash deploy/install-vps.sh"
[ -f "$SRC_DIR/package.json" ] && [ -f "$SRC_DIR/src/bot.js" ] \
  || die "Run this from the discord folder (it needs package.json and src/bot.js next to it)."
command -v systemctl >/dev/null || die "This server has no systemd. Use Ubuntu 22.04/24.04 or Debian 12."

# ── 1. Node.js 20 ──────────────────────────────────────────────────────────
NODE_MAJOR=$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || echo 0)
if [ "${NODE_MAJOR:-0}" -lt 18 ]; then
  say "Installing Node.js 20"
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
else
  say "Node.js $(node -v) is already installed"
fi
command -v curl >/dev/null || apt-get install -y curl

# ── 2. The bot's own user and files ────────────────────────────────────────
id "$BOT_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$BOT_USER"
say "Copying the bot to $APP_DIR"
mkdir -p "$APP_DIR"
# Code only: no local .env, no node_modules — and never the state files. The
# bot keeps XP and running giveaways in xp.json / giveaways.json next to its
# code; an update must not overwrite the server's live copies with whatever
# old ones sit on your own PC.
tar -C "$SRC_DIR" --exclude=node_modules --exclude=.env \
  --exclude=xp.json --exclude=giveaways.json -cf - . | tar -C "$APP_DIR" -xf -
cd "$APP_DIR"
say "Installing dependencies"
npm ci --omit=dev --no-audit --no-fund
chown -R "$BOT_USER":"$BOT_USER" "$APP_DIR"

# ── 3. Settings, asked once ────────────────────────────────────────────────
ask() {   # ask VAR "question" [secret]
  local var=$1 q=$2 secret=${3:-} val=''
  while [ -z "$val" ]; do
    if [ -n "$secret" ]; then read -r -s -p "  $q: " val; echo; else read -r -p "  $q: " val; fi
  done
  printf '%s=%s\n' "$var" "$val" >> "$ENV_FILE.new"
}
if [ ! -f "$ENV_FILE" ]; then
  say "Settings (asked once — stored in $ENV_FILE, never shown again)"
  umask 077; : > "$ENV_FILE.new"
  ask DISCORD_TOKEN        "Discord bot token (Developer Portal → Bot → Reset Token)" secret
  ask DISCORD_CLIENT_ID    "Application ID (Developer Portal → General Information)"
  ask DISCORD_GUILD_ID     "Your Discord server ID"
  ask REVIEW_INGEST_SECRET "REVIEW_INGEST_SECRET — exactly the value in Vercel" secret
  read -r -p "  Anthropic API key for the AI assistant (Enter to skip): " -s AK; echo
  [ -n "${AK:-}" ] && printf 'ANTHROPIC_API_KEY=%s\n' "$AK" >> "$ENV_FILE.new"
  printf 'STORE_URL=https://www.forgemarket.nl\nFORGEMARKET_API_URL=https://www.forgemarket.nl\n' >> "$ENV_FILE.new"
  mv "$ENV_FILE.new" "$ENV_FILE"
else
  say "Keeping your settings in $ENV_FILE (edit it with: sudo nano $ENV_FILE)"
fi
grep -q '^PORT=' "$ENV_FILE" || printf 'PORT=%s\n' "$HEALTH_PORT" >> "$ENV_FILE"
chown root:"$BOT_USER" "$ENV_FILE"; chmod 640 "$ENV_FILE"

# ── 4. Always on ───────────────────────────────────────────────────────────
say "Installing the $SERVICE service"
cat > /etc/systemd/system/$SERVICE.service <<UNIT
[Unit]
Description=ForgeMarket Discord bot
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
Type=simple
User=$BOT_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
Environment=NODE_ENV=production
ExecStart=$(command -v node) src/bot.js
Restart=always
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=20
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

# ── 5. Watchdog: on, but not connected, is not on ──────────────────────────
cat > /usr/local/bin/$SERVICE-watchdog <<WD
#!/usr/bin/env bash
# Restart the bot when its health endpoint has said "not connected" twice in a row.
STATE=/run/$SERVICE-watchdog.fails
if curl -fsS --max-time 10 http://127.0.0.1:$HEALTH_PORT/health >/dev/null 2>&1; then
  rm -f "\$STATE"; exit 0
fi
n=\$(( \$(cat "\$STATE" 2>/dev/null || echo 0) + 1 )); echo "\$n" > "\$STATE"
if [ "\$n" -ge 2 ]; then
  logger -t $SERVICE "health check failed twice — restarting"
  systemctl restart $SERVICE; rm -f "\$STATE"
fi
WD
chmod 755 /usr/local/bin/$SERVICE-watchdog
cat > /etc/systemd/system/$SERVICE-watchdog.service <<UNIT
[Unit]
Description=Restart the ForgeMarket bot when it is up but disconnected
[Service]
Type=oneshot
ExecStart=/usr/local/bin/$SERVICE-watchdog
UNIT
cat > /etc/systemd/system/$SERVICE-watchdog.timer <<UNIT
[Unit]
Description=Check the ForgeMarket bot every 2 minutes
[Timer]
OnBootSec=3min
OnUnitActiveSec=2min
[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now $SERVICE >/dev/null
systemctl restart $SERVICE
systemctl enable --now $SERVICE-watchdog.timer >/dev/null

say "Waiting for the bot to connect"
for i in $(seq 1 30); do
  if curl -fsS --max-time 3 http://127.0.0.1:$HEALTH_PORT/health >/dev/null 2>&1; then
    printf '\n\033[1;32m✓ The bot is online and connected to Discord. It now runs 24/7.\033[0m\n'
    echo "  Logs:     sudo journalctl -u $SERVICE -f"
    echo "  Restart:  sudo systemctl restart $SERVICE"
    echo "  Update:   put the new discord folder on the server and run this script again"
    exit 0
  fi
  sleep 2
done
echo
systemctl --no-pager status $SERVICE | head -15 || true
die "The bot did not connect within a minute. See the reason with: sudo journalctl -u $SERVICE -n 50"
