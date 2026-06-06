/**
 * Register slash commands to your guild (instant). Run once, and again whenever
 * commands change.   npm run register
 */
import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';

const { DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID } = process.env;

const commands = [
  new SlashCommandBuilder().setName('help').setDescription('How to use ForgeMarket & the assistant'),
  new SlashCommandBuilder().setName('ask').setDescription('Ask the ForgeMarket assistant anything')
    .addStringOption((o) => o.setName('question').setDescription('Your question').setRequired(true)),
  new SlashCommandBuilder().setName('recommend').setDescription('Get a product recommendation')
    .addStringOption((o) => o.setName('game').setDescription('Which game? e.g. Roblox, Fortnite'))
    .addStringOption((o) => o.setName('budget').setDescription('Your budget, e.g. €20')),
].map((c) => c.toJSON());

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
await rest.put(Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID), { body: commands });
console.log(`✅ Registered ${commands.length} slash commands to guild ${DISCORD_GUILD_ID}`);
