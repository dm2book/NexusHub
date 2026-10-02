/**
 * deploy/install-vps.sh — the bot 24/7 on a VPS, for when Railway is not an
 * option. What it has to get right is what a bot host gets wrong:
 *
 *   it must come back by itself: after a crash, after a reboot, and when it is
 *   running but no longer connected to Discord;
 *   the token must never land in the code folder, in the shell history or on
 *   screen, and only root and the bot may read it;
 *   an update must keep the settings AND the live XP and giveaways.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};
const path = fileURLToPath(new URL('../deploy/install-vps.sh', import.meta.url));
const sh = readFileSync(path, 'utf8');
const runtime = readFileSync(new URL('../src/runtime.js', import.meta.url), 'utf8');

console.log('\n— It is a script that runs —');
{
  let syntax = true;
  try { execFileSync('bash', ['-n', path]); } catch { syntax = false; }
  ok('bash accepts it', syntax);
  ok('it stops at the first error', /set -euo pipefail/.test(sh));
  ok('it refuses to run without root, and says how', /id -u\)" -eq 0/.test(sh) && /sudo bash deploy\/install-vps\.sh/.test(sh));
  ok('it checks it was started from the discord folder', /src\/bot\.js/.test(sh) && /package\.json/.test(sh));
}

console.log('\n— 24/7 —');
{
  ok('restarted whenever it stops', /Restart=always/.test(sh) && /RestartSec=5/.test(sh));
  ok('…with no limit on how often', /StartLimitIntervalSec=0/.test(sh));
  ok('started at boot', /WantedBy=multi-user\.target/.test(sh) && /systemctl enable --now \$SERVICE/.test(sh));
  ok('a watchdog restarts it when it is up but not connected', /\/health/.test(sh) && /OnUnitActiveSec=2min/.test(sh)
    && /-ge 2/.test(sh) && /systemctl restart \$SERVICE/.test(sh));
  ok('…which needs the health endpoint on: PORT is set', /PORT=%s/.test(sh) && /startHealthServer\(client, \{ port = process\.env\.PORT \}/.test(runtime));
  ok('the health endpoint answers 503 while disconnected, so the watchdog can tell', /503/.test(runtime));
  ok('a stop is a SIGTERM, which the bot handles gracefully', /KillSignal=SIGTERM/.test(sh));
}

console.log('\n— Secrets —');
{
  ok('the token is typed without being shown', /ask DISCORD_TOKEN .* secret/.test(sh) && /read -r -s/.test(sh));
  ok('…and the ingest secret too', /ask REVIEW_INGEST_SECRET .* secret/.test(sh));
  ok('settings live in /etc, outside the code folder', /ENV_FILE=\/etc\/forgemarket-bot\.env/.test(sh) && /EnvironmentFile=\$ENV_FILE/.test(sh));
  ok('…readable by root and the bot only', /chmod 640 "\$ENV_FILE"/.test(sh) && /umask 077/.test(sh));
  ok('no secret is ever echoed', !/echo .*\$(DISCORD_TOKEN|REVIEW_INGEST_SECRET|AK)\b/.test(sh));
  ok('a .env from your own PC is not copied to the server', /--exclude=\.env/.test(sh));
  ok('the bot does not run as root', /User=\$BOT_USER/.test(sh) && /useradd --system/.test(sh) && /NoNewPrivileges=true/.test(sh));
}

console.log('\n— Updating —');
{
  ok('running it again keeps the settings', /if \[ ! -f "\$ENV_FILE" \]/.test(sh) && /Keeping your settings/.test(sh));
  ok('…and never overwrites the live XP or giveaways', /--exclude=xp\.json/.test(sh) && /--exclude=giveaways\.json/.test(sh));
  ok('the names it protects are the files the bot writes',
    /'\.\.\/xp\.json'/.test(readFileSync(new URL('../src/bot.js', import.meta.url), 'utf8'))
    && /'\.\.\/giveaways\.json'/.test(readFileSync(new URL('../src/bot.js', import.meta.url), 'utf8')));
  ok('the README points to it', /install-vps\.sh/.test(readFileSync(new URL('../README.md', import.meta.url), 'utf8')));
}

console.log(`\n${fail ? '❌' : '✅'} vps-install: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
