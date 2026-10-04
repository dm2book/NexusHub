/**
 * Register the slash commands.   npm run register
 *
 * With DISCORD_GUILD_ID they register to that guild and appear instantly;
 * without it they register globally, which can take up to an hour to show.
 * The bot also does this itself on every ClientReady, so running it by hand is
 * only needed to see the result before starting the bot.
 */
import 'dotenv/config';
import { registerCommands } from './commands.js';

const token = (process.env.DISCORD_TOKEN || '').trim();
const appId = (process.env.DISCORD_CLIENT_ID || process.env.DISCORD_APPLICATION_ID || '').trim();
const guildId = (process.env.DISCORD_GUILD_ID || '').trim();

const missing = [!token && 'DISCORD_TOKEN', !appId && 'DISCORD_CLIENT_ID (or DISCORD_APPLICATION_ID)'].filter(Boolean);
if (missing.length) {
  console.error(`Missing ${missing.join(' and ')} — see discord/.env.example.`);
  process.exit(1);
}

try {
  const { count, scope } = await registerCommands({ token, appId, guildId });
  console.log(`✅ Registered ${count} slash commands (${scope})`
    + (guildId ? '' : ' — global commands can take up to an hour to appear'));
} catch (e) {
  console.error(`Registering commands failed: ${e.message}`);
  process.exit(1);
}
