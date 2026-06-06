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
  new SlashCommandBuilder().setName('order').setDescription('Check the status of an order')
    .addStringOption((o) => o.setName('number').setDescription('Your order number, e.g. FM-2026-XXXX').setRequired(true)),
  new SlashCommandBuilder().setName('vouch').setDescription('Leave a vouch for ForgeMarket')
    .addStringOption((o) => o.setName('message').setDescription('Your experience').setRequired(true))
    .addIntegerOption((o) => o.setName('stars').setDescription('1–5 stars').setMinValue(1).setMaxValue(5)),
  new SlashCommandBuilder().setName('giveaway').setDescription('Staff: start a giveaway')
    .addStringOption((o) => o.setName('prize').setDescription('What are you giving away?').setRequired(true))
    .addIntegerOption((o) => o.setName('minutes').setDescription('Duration in minutes (default 10)')),
].map((c) => c.toJSON());

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
await rest.put(Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID), { body: commands });
console.log(`✅ Registered ${commands.length} slash commands to guild ${DISCORD_GUILD_ID}`);
