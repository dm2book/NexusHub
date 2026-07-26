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
  new SlashCommandBuilder().setName('price').setDescription('Look up a product’s live price')
    .addStringOption((o) => o.setName('product').setDescription('e.g. 1700 Robux, Nitro, Valorant').setRequired(true)),
  new SlashCommandBuilder().setName('delivery').setDescription('How a product is delivered (steps + what you need)')
    .addStringOption((o) => o.setName('product').setDescription('e.g. Robux, V-Bucks').setRequired(true)),
  new SlashCommandBuilder().setName('drops').setDescription('See upcoming drops, restocks & sales'),
  new SlashCommandBuilder().setName('poll').setDescription('Start a quick poll (👍/👎 or up to 4 options)')
    .addStringOption((o) => o.setName('question').setDescription('The poll question').setRequired(true))
    .addStringOption((o) => o.setName('option1').setDescription('Option 1'))
    .addStringOption((o) => o.setName('option2').setDescription('Option 2'))
    .addStringOption((o) => o.setName('option3').setDescription('Option 3'))
    .addStringOption((o) => o.setName('option4').setDescription('Option 4')),
  new SlashCommandBuilder().setName('daily').setDescription('Claim your daily XP bonus (build a streak!)'),
  new SlashCommandBuilder().setName('vouch').setDescription('Leave a vouch for ForgeMarket')
    .addStringOption((o) => o.setName('message').setDescription('Your experience').setRequired(true))
    .addIntegerOption((o) => o.setName('stars').setDescription('1–5 stars').setMinValue(1).setMaxValue(5)),
  new SlashCommandBuilder().setName('giveaway').setDescription('Staff: start a giveaway')
    .addStringOption((o) => o.setName('prize').setDescription('What are you giving away?').setRequired(true))
    .addIntegerOption((o) => o.setName('minutes').setDescription('Duration in minutes (default 10, max 14 days)').setMinValue(1).setMaxValue(20160))
    .addIntegerOption((o) => o.setName('winners').setDescription('Number of winners (default 1)')),
  new SlashCommandBuilder().setName('reroll').setDescription('Staff: reroll a giveaway winner')
    .addStringOption((o) => o.setName('message_id').setDescription('The giveaway message ID').setRequired(true)),
  new SlashCommandBuilder().setName('rank').setDescription('Show your level & XP'),
  new SlashCommandBuilder().setName('balance').setDescription('Check your Forge Coins, store credit & loyalty tier'),
  new SlashCommandBuilder().setName('leaderboard').setDescription('Show the top members by XP'),
  new SlashCommandBuilder().setName('suggest').setDescription('Suggest an idea for ForgeMarket')
    .addStringOption((o) => o.setName('idea').setDescription('Your suggestion').setRequired(true)),
  new SlashCommandBuilder().setName('shop').setDescription('Get a link to the ForgeMarket shop'),
  new SlashCommandBuilder().setName('invite').setDescription('Get the server invite link'),
  new SlashCommandBuilder().setName('stats').setDescription('Show live server stats'),
  new SlashCommandBuilder().setName('close').setDescription('Staff: close the current ticket'),
  new SlashCommandBuilder().setName('coupon').setDescription('Staff: post a discount code')
    .addStringOption((o) => o.setName('code').setDescription('e.g. FORGE10').setRequired(true))
    .addIntegerOption((o) => o.setName('percent').setDescription('% off (1–90)').setRequired(true))
    .addStringOption((o) => o.setName('note').setDescription('Optional note')),
  new SlashCommandBuilder().setName('paylink')
    .setDescription('Owner: attach a payment link with the exact amount to an order')
    .addStringOption((o) => o.setName('order').setDescription('Order number, e.g. FM-2026-8KQ2R7XZ').setRequired(true))
    .addStringOption((o) => o.setName('link').setDescription('The payment request link from your bank app').setRequired(true)),
  new SlashCommandBuilder().setName('digest').setDescription('Staff: live store digest (revenue, orders, stock)'),
  new SlashCommandBuilder().setName('stock').setDescription('Staff: which products are low on codes'),
  new SlashCommandBuilder().setName('launch').setDescription('Staff: live ready-to-sell checklist'),
  new SlashCommandBuilder().setName('flashsale').setDescription('Staff: post a limited-time deal with a live countdown')
    .addStringOption((o) => o.setName('deal').setDescription('e.g. 20% OFF all Robux').setRequired(true))
    .addIntegerOption((o) => o.setName('minutes').setDescription('How long it runs (default 60, max 1440)'))
    .addStringOption((o) => o.setName('code').setDescription('Optional checkout code, e.g. FLASH20')),
  new SlashCommandBuilder().setName('announce').setDescription('Staff: post an announcement')
    .addStringOption((o) => o.setName('message').setDescription('What to announce').setRequired(true)),
  new SlashCommandBuilder().setName('clearpins').setDescription('Staff: delete all "pinned a message" notices across the server')
    .addBooleanOption((o) => o.setName('here').setDescription('Only this channel (default: every channel)')),
  new SlashCommandBuilder().setName('serverinfo').setDescription('Show server statistics'),
].map((c) => c.toJSON());

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
await rest.put(Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID), { body: commands });
console.log(`✅ Registered ${commands.length} slash commands to guild ${DISCORD_GUILD_ID}`);
