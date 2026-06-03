import { REST, Routes } from 'discord.js';
import { config } from './config.js';
import { commandDefs } from './commands.js';

/** Register slash commands with Discord (guild-scoped for instant updates). */
async function main() {
  if (!config.token || !config.clientId) {
    console.error('Set DISCORD_BOT_TOKEN and DISCORD_BOT_CLIENT_ID first.');
    process.exit(1);
  }
  const rest = new REST({ version: '10' }).setToken(config.token);
  const route = config.guildId
    ? Routes.applicationGuildCommands(config.clientId, config.guildId)
    : Routes.applicationCommands(config.clientId);
  await rest.put(route, { body: commandDefs });
  console.log(`✅ Registered ${commandDefs.length} commands${config.guildId ? ` to guild ${config.guildId}` : ' globally'}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
