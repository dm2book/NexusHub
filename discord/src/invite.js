#!/usr/bin/env node
/**
 * Print the invite link for this bot, with exactly the powers it uses.
 *
 *   npm run invite
 *
 * The setup used to say "invite the bot with Administrator". Administrator
 * bypasses every channel overwrite the setup then carefully applies — including
 * the ones that make each support ticket private — so the bot would have been
 * able to read every ticket in the server, and anyone holding its token could
 * have deleted the guild's channels or banned its members. It needs none of
 * that: its only moderation action is deleting a scam message.
 */
import 'dotenv/config';
import { BOT_PERMISSIONS, botPermissionBits, botInviteUrl } from './permissions.js';

const id = process.env.DISCORD_CLIENT_ID || process.env.DISCORD_APPLICATION_ID || '';
if (!id) {
  console.error('Set DISCORD_CLIENT_ID (Discord Developer Portal → your app → Application ID).');
  process.exit(1);
}

console.log('\nForgeMarket bot — least-privilege invite\n');
console.log(`  permissions: ${botPermissionBits()}`);
console.log(`  ${BOT_PERMISSIONS.join(', ')}\n`);
console.log('  NOT requested: Administrator, BanMembers, KickMembers, ModerateMembers, ManageWebhooks\n');
console.log(`${botInviteUrl(id)}\n`);
console.log('After inviting, drag the bot\'s role ABOVE every role it manages');
console.log('(Verified Customer, the loyalty tiers and the level roles) — Discord');
console.log('refuses to grant a role that sits above the bot\'s own.\n');
