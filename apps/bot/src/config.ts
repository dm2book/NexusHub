import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();

export const config = {
  token: process.env.DISCORD_BOT_TOKEN ?? '',
  clientId: process.env.DISCORD_BOT_CLIENT_ID ?? '',
  guildId: process.env.DISCORD_GUILD_ID ?? '',
  apiBaseUrl: process.env.API_BASE_URL ?? 'http://localhost:4000',
  // A long-lived service token (owner JWT) the bot uses to call the API.
  serviceToken: process.env.BOT_SERVICE_TOKEN ?? '',
};
