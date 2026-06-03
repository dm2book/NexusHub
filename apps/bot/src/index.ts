import { Client, Events, GatewayIntentBits } from 'discord.js';
import { config } from './config.js';
import { handleCommand } from './commands.js';

/**
 * MemeForge Discord bot. Handles the slash commands (/portfolio, /pnl, …) by
 * calling the API. Alert relaying is handled by the API's Discord notification
 * channel; this process owns the interactive command surface.
 */
async function main() {
  if (!config.token) {
    console.error('DISCORD_BOT_TOKEN is not set — the bot cannot start.');
    process.exit(1);
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once(Events.ClientReady, (c) => {
    console.log(`🤖 MemeForge bot online as ${c.user.tag}`);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    try {
      await handleCommand(interaction);
    } catch (err) {
      console.error('Command error', err);
      if (interaction.deferred) await interaction.editReply('⚠️ Something went wrong.');
    }
  });

  await client.login(config.token);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
