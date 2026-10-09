/**
 * Is this a Discord webhook URL?
 *
 * The alert webhook can be pasted into the admin (Settings → Alerts), and the
 * server POSTs to whatever is there — so without a check it is a way to make
 * the server send requests anywhere, the cloud metadata service included.
 * Discord's own hosts and its webhook path are all a real one ever uses.
 */
const HOSTS = new Set(['discord.com', 'discordapp.com', 'ptb.discord.com', 'canary.discord.com',
  'ptb.discordapp.com', 'canary.discordapp.com']);

export function isDiscordWebhookUrl(value) {
  let u;
  try { u = new URL(String(value || '').trim()); } catch { return false; }
  return u.protocol === 'https:' && !u.port && !u.username && !u.password
    && HOSTS.has(u.hostname.toLowerCase())
    && /^\/api\/(v\d+\/)?webhooks\/\d+\/[\w-]+\/?$/.test(u.pathname);
}
