/**
 * ForgeMarket Discord ecosystem — the entire server as data.
 *
 * setup.js reads this to create roles, categories, channels, descriptions and
 * permissions idempotently. The bot reads MESSAGES/FAQ at runtime.
 *
 * Permission strings map to discord.js PermissionFlagsBits keys.
 *
 * NOTE ON OWNER: the server Owner is never created or modified here — Discord
 * guarantees the Owner full control. The bot only manages roles BELOW its own.
 */

// ── Roles (top of list = highest; Owner sits above all, untouched) ──────────
export const ROLES = [
  {
    key: 'admin', name: 'Admin', color: '#ef4444', hoist: true, mentionable: false,
    perms: ['ManageGuild', 'ManageChannels', 'ManageRoles', 'ManageMessages',
      'KickMembers', 'BanMembers', 'ModerateMembers', 'ManageNicknames',
      'ManageThreads', 'ViewAuditLog', 'ManageEvents', 'MentionEveryone'],
    responsibility: 'Runs the server day-to-day: structure, roles, staff, policy. Full management short of Owner.',
  },
  {
    key: 'moderator', name: 'Moderator', color: '#3b82f6', hoist: true, mentionable: false,
    perms: ['ManageMessages', 'KickMembers', 'ModerateMembers', 'ManageThreads',
      'MuteMembers', 'DeafenMembers', 'MoveMembers'],
    responsibility: 'Keeps the community safe & on-topic: warnings, timeouts, spam/scam removal, escalations.',
  },
  {
    key: 'support', name: 'Support', color: '#10b981', hoist: true, mentionable: true,
    perms: ['ManageMessages', 'ManageThreads'],
    responsibility: 'Handles tickets, order questions, refunds and delivery issues. First line of customer help.',
  },
  {
    key: 'vip', name: 'VIP Customer', color: '#a855f7', hoist: true, mentionable: false,
    perms: [],
    responsibility: 'Top customers: early drops, exclusive channels, better giveaway odds, priority support.',
  },
  {
    key: 'partner', name: 'Partner', color: '#eab308', hoist: true, mentionable: false,
    perms: [],
    responsibility: 'Approved collaborators / affiliates. Access to the partner channel and co-marketing.',
  },
  // Loyalty tiers — mirrored automatically from the store (lifetime spend).
  // Cosmetic colour roles; the site's role-sync matches these by NAME.
  {
    key: 'platinum', name: 'Platinum', color: '#a78bfa', hoist: false, mentionable: false,
    perms: [],
    responsibility: 'Loyalty tier: €2000+ lifetime spend on the store. Synced automatically.',
  },
  {
    key: 'gold', name: 'Gold', color: '#f59e0b', hoist: false, mentionable: false,
    perms: [],
    responsibility: 'Loyalty tier: €500+ lifetime spend on the store. Synced automatically.',
  },
  {
    key: 'silver', name: 'Silver', color: '#9ca3af', hoist: false, mentionable: false,
    perms: [],
    responsibility: 'Loyalty tier: €100+ lifetime spend on the store. Synced automatically.',
  },
  {
    key: 'bronze', name: 'Bronze', color: '#cd7f32', hoist: false, mentionable: false,
    perms: [],
    responsibility: 'Loyalty tier: first paid order on the store. Synced automatically.',
  },
  {
    key: 'verified', name: 'Verified Customer', color: '#22c55e', hoist: false, mentionable: false,
    perms: [],
    responsibility: 'Default member tier after passing verification — unlocks the full community.',
  },
  {
    key: 'bot', name: 'Bot', color: '#5865F2', hoist: false, mentionable: false,
    perms: [],
    responsibility: 'Automation: onboarding, tickets, AI assistant, reviews, giveaways, logging.',
  },
];

// Convenience role-key groups used in permission overwrites.
const STAFF = ['admin', 'moderator', 'support'];
const MEMBERS = ['verified', 'vip', 'partner', ...STAFF];

/**
 * Categories → channels.
 * category.access: 'public' | 'verified' | 'vip' | 'staff'
 * channel.type: 'text' | 'voice' | 'forum' | 'announcement'
 * channel.readOnly: members can read but not post (staff can post)
 * channel.slowmode: seconds
 */
export const CATEGORIES = [
  {
    name: '👋 WELCOME', access: 'public',
    channels: [
      { name: 'welcome', type: 'text', readOnly: true, topic: 'Welcome to ForgeMarket — game top-ups and gift cards. Start here 👇' },
      { name: 'start-here', type: 'text', readOnly: true, topic: 'A 30-second guide to the server: verify, browse, buy, get support.' },
      { name: 'rules', type: 'text', readOnly: true, topic: 'The rules. Be cool, no scams, no spam. Breaking them = removal.' },
      { name: 'verify', type: 'text', readOnly: true, topic: 'Tap the button to verify and unlock the community.' },
      { name: 'links', type: 'text', readOnly: true, topic: 'All official ForgeMarket links — shop, track order, sign in & socials.' },
    ],
  },
  {
    name: '📢 ANNOUNCEMENTS', access: 'verified',
    channels: [
      { name: 'announcements', type: 'announcement', readOnly: true, topic: 'Official ForgeMarket news. Follow this channel to never miss a drop.' },
      { name: 'updates', type: 'text', readOnly: true, topic: 'Product, pricing and feature updates.' },
      { name: 'restocks', type: 'text', readOnly: true, topic: 'Back-in-stock alerts for popular top-ups.' },
      { name: 'status', type: 'text', readOnly: true, topic: 'Store & delivery status — all systems operational ✅' },
    ],
  },
  {
    name: '🛒 MARKETPLACE', access: 'verified',
    channels: [
      { name: 'products', type: 'text', readOnly: true, topic: 'Browse the catalog — fair prices, money back if it never arrives → {STORE_URL}' },
      { name: 'price-list', type: 'text', readOnly: true, topic: 'Live prices for our most popular top-ups.' },
      { name: 'deals', type: 'text', readOnly: true, topic: 'Limited-time deals and bundle prices.' },
      { name: 'ask-the-bot', type: 'text', slowmode: 3, topic: 'Ask our assistant anything — product recommendations, prices and order help.' },
      { name: 'how-to-buy', type: 'text', readOnly: true, topic: 'Step-by-step: how to order, how to pay, and when your code arrives.' },
    ],
  },
  {
    name: '💬 COMMUNITY', access: 'verified',
    channels: [
      { name: 'roles', type: 'text', readOnly: true, topic: 'Pick your games & notifications to get the right pings.' },
      { name: 'introductions', type: 'text', slowmode: 10, topic: 'New here? Say hi 👋' },
      { name: 'general', type: 'text', topic: 'General chat for the ForgeMarket community.' },
      { name: 'gaming', type: 'text', topic: 'Talk games, tips and updates.' },
      { name: 'looking-for-group', type: 'text', topic: 'Find teammates and squads — LFG here.' },
      { name: 'clips', type: 'text', topic: 'Drop your best plays and clips.' },
      { name: 'screenshots-media', type: 'text', topic: 'Share your best gaming moments.' },
      { name: 'memes', type: 'text', topic: 'Gaming memes & fun.' },
      { name: 'suggestions', type: 'text', topic: 'Got an idea? Use /suggest — the community votes and staff respond.' },
      { name: 'starboard', type: 'text', readOnly: true, topic: 'The best messages, starred by the community ⭐ (react with ⭐).' },
      { name: 'off-topic', type: 'text', topic: 'Anything goes (within the rules).' },
    ],
  },
  {
    // Dedicated voice hub — earn XP while you hang out (5 XP/min, capped/session).
    name: '🔊 VOICE', access: 'verified',
    channels: [
      { name: '🛋️ Lounge', aka: ['lounge'], type: 'voice' },
      { name: '🎮 Game Night', aka: ['game-night'], type: 'voice' },
      { name: '🎧 Duo', type: 'voice', userLimit: 2 },
      { name: '🎯 Squad', type: 'voice', userLimit: 5 },
      { name: '🎵 Music', type: 'voice' },
      { name: '💤 AFK', type: 'voice', afk: true },
    ],
  },
  {
    name: '⭐ REVIEWS & TRUST', access: 'verified',
    channels: [
      { name: 'reviews', type: 'text', readOnly: true, topic: 'Verified customer reviews. Posted automatically after real orders.' },
      { name: 'vouchers', type: 'text', slowmode: 30, topic: 'Bought from us? Leave a quick voucher/vouch for the community 💚' },
      { name: 'proof-of-delivery', type: 'text', readOnly: true, topic: 'Screenshots of real, completed deliveries.' },
      { name: 'discount-codes', type: 'text', readOnly: true, topic: 'Active discount/voucher codes — redeem at checkout.' },
    ],
  },
  {
    name: '🎫 SUPPORT', access: 'verified',
    channels: [
      { name: 'open-a-ticket', type: 'text', readOnly: true, topic: 'Need help? Tap the button to open a private ticket with our team.' },
      { name: 'faq', type: 'text', readOnly: true, topic: 'Answers to the most common questions.' },
      { name: 'support-info', type: 'text', readOnly: true, topic: 'Hours, response times and how support works.' },
      { name: 'report-a-scam', type: 'text', readOnly: true, topic: 'Staff never DM first. Report suspicious users here via a ticket.' },
    ],
  },
  {
    name: '📅 EVENTS', access: 'verified',
    channels: [
      { name: 'events', type: 'announcement', readOnly: true, topic: 'Tournaments, drops and community events.' },
      { name: 'event-signup', type: 'text', topic: 'Sign up for upcoming events.' },
      { name: 'events-stage', type: 'voice', topic: 'Live event voice/stage.' },
    ],
  },
  {
    name: '🎉 GIVEAWAYS', access: 'verified',
    channels: [
      { name: 'giveaways', type: 'text', readOnly: true, topic: 'Enter active giveaways. Hosted by the team & the bot.' },
      { name: 'giveaway-chat', type: 'text', topic: 'Talk about current giveaways.' },
      { name: 'winners', type: 'text', readOnly: true, topic: 'Hall of winners 🏆' },
    ],
  },
  {
    name: '🤝 PARTNERS', access: 'verified',
    channels: [
      { name: 'partnerships', type: 'text', readOnly: true, topic: 'Want to partner or become an affiliate? Open a ticket to apply.' },
      { name: 'partner-perks', type: 'text', readOnly: true, topic: 'Perks & benefits for approved partners.' },
    ],
  },
  {
    // Ticket channels are created here by the bot. Staff-gated: members only
    // ever see their own ticket (the bot grants them a per-channel overwrite).
    name: '🎫 TICKETS', access: 'staff',
    channels: [],
  },
  {
    name: '🛠️ STAFF', access: 'staff',
    channels: [
      { name: 'staff-chat', type: 'text', topic: 'Internal staff discussion.' },
      { name: 'staff-announcements', type: 'text', readOnly: true, topic: 'Owner/Admin updates for staff.' },
      { name: 'ticket-logs', type: 'text', topic: 'Transcripts of closed tickets (auto-posted).' },
      { name: 'mod-log', type: 'text', topic: 'Moderation + audit events (auto-posted).' },
      { name: 'leads', type: 'text', topic: 'Captured leads + order/sales notifications from the bot.' },
      { name: 'staff-voice', type: 'voice', topic: 'Staff voice.' },
    ],
  },
];

export { STAFF, MEMBERS };

// Self-assignable roles (created by setup, toggled by buttons in #roles).
export const GAME_ROLES = [
  { key: 'robux', label: 'Roblox', emoji: '🟩', color: '#22c55e' },
  { key: 'fortnite', label: 'Fortnite', emoji: '🟦', color: '#60a5fa' },
  { key: 'valorant', label: 'Valorant', emoji: '🟥', color: '#fb7185' },
  { key: 'cod', label: 'Call of Duty', emoji: '🟧', color: '#f97316' },
  { key: 'apex', label: 'Apex Legends', emoji: '🔺', color: '#ef4444' },
  { key: 'genshin', label: 'Genshin', emoji: '🟦', color: '#22d3ee' },
  { key: 'brawl', label: 'Brawl Stars', emoji: '🟨', color: '#eab308' },
  { key: 'clash', label: 'Clash of Clans', emoji: '🟪', color: '#a78bfa' },
];
export const NOTIFY_ROLES = [
  { key: 'drops', label: 'Drops & Restocks', emoji: '🔔', color: '#6366f1' },
  { key: 'deals', label: 'Deals', emoji: '🔥', color: '#ec4899' },
  { key: 'giveaways', label: 'Giveaways', emoji: '🎉', color: '#a855f7' },
];

// Level roles — earned automatically by chatting & voice (the bot keeps only
// the highest earned tier on your profile). Matched by NAME, like loyalty roles.
export const LEVEL_ROLES = [
  { level: 5, name: 'Level 5 ⚡', color: '#60a5fa' },
  { level: 10, name: 'Level 10 🔥', color: '#a78bfa' },
  { level: 20, name: 'Level 20 💎', color: '#f472b6' },
  { level: 30, name: 'Level 30 👑', color: '#f59e0b' },
];

// ── Onboarding & content ────────────────────────────────────────────────────
export const MESSAGES = {
  welcome: (g) => ({
    image: '{STORE_URL}/discord/banner-welcome.png?v=2',
    color: 0x7c5cff,
    title: `Welcome to ${g} ⚡`,
    description:
      "**Game top-ups and gift cards, without the hassle.**\n\n" +
      "Robux • V-Bucks • Valorant • CoD • Genshin • Apex • gift cards & more.\n\n" +
      "**Get started:**\n" +
      "1️⃣ Read the <#rules>\n" +
      "2️⃣ Verify in <#verify> to unlock the server\n" +
      "3️⃣ Browse <#products> or ask in <#ask-the-bot>\n" +
      "4️⃣ Need help? <#open-a-ticket>\n\n" +
      "Money back if it doesn't arrive · real human support · no account needed to buy.",
  }),
  rules: {
    image: '{STORE_URL}/discord/banner-rules.png?v=2',
    color: 0x94a3b8,
    title: '📜 Server Rules',
    description:
      "**1. Be respectful.** No harassment, hate, or NSFW.\n" +
      "**2. No scams.** Never trade outside official channels. Staff will *never* DM you first.\n" +
      "**3. No spam / self-promo** without permission.\n" +
      "**4. English in main channels** so staff can moderate.\n" +
      "**5. One account per person.** No ban evasion.\n" +
      "**6. Use tickets for order issues** — don't share private info publicly.\n" +
      "**7. Staff decisions are final.** Appeals via ticket.\n\n" +
      "_Breaking the rules can result in a timeout, kick or ban._",
  },
  startHere: {
    title: '🚀 Start Here',
    description:
      "**What is ForgeMarket?** Game currency and gift cards — Robux, V-Bucks, Valorant, Steam and more.\n\n" +
      "**How it works:**\n" +
      "• Browse <#products> or ask in <#ask-the-bot>\n" +
      "• Order on the website — no account needed\n" +
      "• Pay with your order number as the reference\n" +
      "• We confirm the payment and send your code by email\n" +
      "• Track it any time with `/order` or on the site\n\n" +
      "**Why trust us?** Reviews in <#reviews> are tied to real orders, <#proof-of-delivery> shows actual deliveries, " +
      "and you get your money back if something never arrives.\n\n" +
      "👉 First step: verify in <#verify>.",
  },
  verify: {
    image: '{STORE_URL}/discord/banner-verify.png?v=2',
    color: 0x22c55e,
    title: '✅ Verify to enter',
    description:
      "Tap **Verify** below to confirm you're human and unlock the full server: " +
      "marketplace, community, giveaways and support.\n\nThis keeps the community safe from bots and scammers.",
  },
  ticketPanel: {
    image: '{STORE_URL}/discord/banner-support.png?v=2',
    color: 0x3b82f6,
    title: '🎫 Open a support ticket',
    description:
      "Pick a topic below and we'll open a **private channel** with our team.\n\n" +
      "🛒 **Order issue** — missing/incorrect delivery\n" +
      "💳 **Payment** — checkout or refund\n" +
      "🤝 **Partnership** — collab / affiliate\n" +
      "❓ **Other** — anything else\n\n" +
      "We answer as fast as we can during the day — and every ticket gets a real person, not a bot.",
  },
  products: {
    image: '{STORE_URL}/discord/banner-products.png?v=2',
    color: 0x6366f1,
    title: '🛒 The ForgeMarket catalog',
    description:
      "Game currency, top-ups, gift cards and subscriptions — fair prices, real support, " +
      "and reviews tied to real orders.\n\n" +
      "**Popular:** Robux • V-Bucks • Valorant VP • CoD Points • Apex Coins • Genshin • Brawl Stars • Clash of Clans\n\n" +
      "Not sure what you need? Ask in <#ask-the-bot> and our assistant will recommend the right pack.\n\n" +
      "👇 Tap **Browse the shop** to see live prices.",
  },
  howToBuy: {
    title: '💳 How to buy',
    description:
      "**1.** Open the shop and pick your pack — no account needed.\n" +
      "**2.** Place the order and you'll see the amount plus a **reference** (your order number).\n" +
      "**3.** Pay with that reference. Put it in the payment description — it's how we match your payment to your order.\n" +
      "**4.** We confirm the payment. In-stock items are sent automatically; the rest we deliver by hand, usually within a few hours.\n" +
      "**5.** Your code arrives by email, with instructions for redeeming it.\n\n" +
      "Check your status any time with `/order <number>` or on the site — no login required.\n" +
      "Something wrong? Open a ticket in <#open-a-ticket>. If an order never arrives, you get your money back.",
  },
  deals: {
    image: '{STORE_URL}/discord/banner-deals.png?v=2',
    color: 0xef4444,
    title: '🔥 Deals & bundles',
    description:
      "Limited-time offers and best-value bundles drop here.\n\n" +
      "🔔 Turn on notifications for this channel so you never miss a deal.\n" +
      "💜 **VIP Customers** get early access and extra discounts.",
  },
  announcement: {
    title: '📢 Welcome to ForgeMarket — we’re live!',
    description:
      "Top up your favourite games without the hassle. ⚡\n\n" +
      "• **In stock? Sent automatically.** Everything else delivered by hand, usually within a few hours\n" +
      "• **Money back** if an order never arrives\n" +
      "• **Reviews tied to real orders** and real proof of delivery\n" +
      "• **A real person** answering tickets right here on Discord\n\n" +
      "Verify in <#verify>, then browse <#products>. Welcome aboard! 🎉",
  },
  supportInfo: {
    image: '{STORE_URL}/discord/banner-support.png?v=2',
    color: 0x3b82f6,
    title: '📋 How support works',
    description:
      "**Open hours:** every day. We're one small team, so replies come fast during the day and can wait until morning at night.\n" +
      "**Order issues:** open a ticket in <#open-a-ticket> with your order number.\n" +
      "**Refunds:** request from your order page or via a ticket — approved refunds go to your original method.\n" +
      "**Safety:** our staff will **never DM you first** and never ask for passwords. Report anyone who does.",
  },
  reviewsIntro: {
    image: '{STORE_URL}/discord/banner-vouches.png?v=2',
    color: 0x22c55e,
    title: '⭐ Verified customer reviews',
    description:
      "Every review here is tied to a **real, completed order** — no fakes.\n\n" +
      "See genuine delivery screenshots in <#proof-of-delivery>, and bought from us? " +
      "Leave a quick vouch in <#vouches> 💚",
  },
  proofIntro: {
    title: '📸 Proof of delivery',
    description: "Real screenshots of completed deliveries. Transparency builds trust. 🔒",
  },
  giveawaysIntro: {
    image: '{STORE_URL}/discord/banner-giveaways.png?v=2',
    color: 0xa855f7,
    title: '🎉 Giveaways',
    description:
      "Free top-ups, every week! 🎁\n\n" +
      "• Active giveaways are posted here — react/enter to join.\n" +
      "• **VIP Customers** get bonus entries.\n" +
      "• Winners are announced in <#winners>.\n\nGood luck! 🍀",
  },
  eventsIntro: {
    title: '📅 Community events',
    description: "Tournaments, drops and community nights. Sign up in <#event-signup> and hop into <#events-stage> when we go live.",
  },
  staffIntro: {
    title: '🛠️ Staff HQ',
    description:
      "Internal area. Tickets log to <#ticket-logs>, moderation to <#mod-log>, and the bot posts joins, " +
      "tickets, buying-intent leads and sales to <#leads>.\n\nKeep it professional — customers come first. 💪",
  },
  links: {
    title: '🔗 Official ForgeMarket links',
    description:
      "Only trust links posted here or by staff.\n\n" +
      "🛍️ **Shop:** {STORE_URL}/shop\n" +
      "🏠 **Home:** {STORE_URL}\n" +
      "📦 **Track your order:** {STORE_URL}/track\n" +
      "👤 **Your account:** {STORE_URL}/account\n" +
      "❓ **FAQ:** see <#faq>\n\n" +
      "Buttons below take you straight there 👇",
  },
  status: {
    title: '🟢 Status — all systems operational',
    description:
      "**Store:** online ✅\n**Deliveries:** running ✅\n**Payments:** being confirmed as normal ✅\n\n" +
      "We post here if anything is ever delayed. No news = all good.",
  },
  priceList: {
    image: '{STORE_URL}/discord/banner-products.png?v=2',
    color: 0x6366f1,
    title: '🏷️ Live price list',
    description:
      "Our most popular top-ups (full catalog + live prices on the site):\n\n" +
      "• **Robux** — from €9.99\n• **V-Bucks** — from €6.99\n• **Valorant VP** — from €9.99\n" +
      "• **CoD Points** — from €23.99\n• **Apex Coins** — from €9.99\n• **Genshin Crystals** — from €15.99\n" +
      "• **Brawl Stars Gems** — from €6.99\n• **Clash of Clans Gems** — from €4.99\n\n" +
      "Prices may change — always check the shop for the live price 👇",
  },
  vouchersIntro: {
    image: '{STORE_URL}/discord/banner-vouches.png?v=2',
    color: 0x22c55e,
    title: '💚 Vouchers & vouches',
    description:
      "Bought from us? Leave a quick **voucher** here — a screenshot + a line about your experience " +
      "helps the whole community shop with confidence.\n\n" +
      "Real customers only. Verified reviews are also posted in <#reviews>.",
  },
  discountCodes: {
    image: '{STORE_URL}/discord/banner-deals.png?v=2',
    color: 0xec4899,
    title: '🏷️ Discount & voucher codes',
    description:
      "Active codes drop here — redeem them at checkout for money off.\n\n" +
      "💜 **VIP Customers** get exclusive codes.\n🔔 Turn on notifications so you never miss one.",
  },
  reportScam: {
    title: '🚨 Report a scam',
    description:
      "**Staff will NEVER DM you first** and will never ask for your password or codes.\n\n" +
      "If someone impersonates the team or DMs you a 'deal', **don't engage** — open a ticket in " +
      "<#open-a-ticket> and report them. We keep this community safe. 🛡️",
  },
  partnersIntro: {
    title: '🤝 Partner with ForgeMarket',
    description:
      "Content creator, community owner or reseller? Let's work together.\n\n" +
      "Open a ticket in <#open-a-ticket> (choose **Partnership**) with a bit about you and your audience. " +
      "Approved partners get the **Partner** role, perks and co-marketing.",
  },
  partnerPerks: {
    title: '🎁 Partner perks',
    description:
      "• Affiliate/revenue share\n• Exclusive partner channel & support\n• Co-marketing and shoutouts\n" +
      "• Early access to drops and codes\n\nApply via a ticket — see <#partnerships>.",
  },
  rolesPanel: {
    title: '🎮 Pick your roles',
    description:
      "Tap the games you play and the alerts you want — get pinged only for what you care about.\n\n" +
      "**Games** give you a colour + access to LFG pings.\n**Alerts** notify you about drops, deals & giveaways.\n\n" +
      "Tap again to remove a role.",
  },
  suggestionsIntro: {
    title: '💡 Suggestions',
    description:
      "Help shape ForgeMarket! Use **/suggest** `your idea` and it gets posted here with " +
      "live ✅/❌ vote buttons and its own discussion thread.\n\n" +
      "Staff review every idea — you'll see it marked **Approved**, **Planned** or **Declined**, " +
      "and you get a DM when a decision lands. Good ideas get built. 🚀",
  },
  starboardIntro: {
    title: '⭐ Starboard',
    description:
      "React to any message with ⭐ and once it hits **3 stars** it lands here — a hall of fame " +
      "for the funniest, most helpful and best community moments. 🏆",
  },
};

// Per-category delivery explanation — mirrors the site's product pages so the
// answer to "how do I get it?" is consistent everywhere. Keyed by category;
// anything else falls back to `default`.
export const DELIVERY_INFO = {
  robux: {
    method: 'Sent straight to your Roblox account via the official Roblox+ top-up method — no password or login needed, fully account-safe.',
    steps: [
      'Turn on 2-Step Verification (2FA) on your Roblox account — required before we can deliver.',
      'Send us your Roblox username (in your order or a support ticket).',
      'We deliver the Robux to your account. Done! 🎉',
    ],
    notes: [
      'Max 5,000 R$ per account per day (Roblox rule). Bigger orders split across days — e.g. 10,000 R$ over 2 days.',
      'Large orders can be delivered faster via 2 accounts: a colleague and I each complete part at the same time.',
      'We never ask for your password.',
    ],
  },
  'v-bucks': {
    method: 'Delivered as an official V-Bucks gift card code you redeem yourself — works on every platform.',
    steps: [
      'Your code arrives by email once your payment is confirmed.',
      'Redeem it in Fortnite / your Epic Games account.',
      'Your V-Bucks show up right away. 🎮',
    ],
    notes: [
      'Codes are region-based — match your account to the product’s region.',
      'Keep your code private: a redeemed code can’t be refunded.',
    ],
  },
  default: {
    method: 'Delivered as an official code, or topped up straight onto your account — depending on the product.',
    steps: [
      'Once your payment is confirmed, your code or confirmation arrives by email.',
      'Follow the short redeem steps we include with it.',
      'Enjoy — you’re all set. ✅',
    ],
    notes: [
      'Any account requirements (2FA, region) are shown before checkout.',
      'Stuck? Open a ticket — eligible orders are money-back guaranteed.',
    ],
  },
};

// FAQ — powers the #faq channel AND the AI fallback.
export const FAQ = [
  { q: 'How fast is delivery?', a: 'Items we have in stock are sent automatically once your payment is confirmed. Anything we buy in for you is delivered by hand, usually within a few hours during the day. Either way the code arrives by email.' },
  { q: 'Is it safe / legit?', a: 'Encrypted checkout, automated fraud screening, reviews tied to real orders, and your money back if an order never arrives. Staff never DM you first.' },
  { q: 'What payment methods can I use?', a: 'You pay by bank transfer or payment link, using your order number as the reference. We confirm every payment by hand — usually within minutes during the day. More automatic methods are coming.' },
  { q: 'I didn’t get my code — what now?', a: 'First check spam. Then run `/order <your number>` to see the live status. Still nothing? Open a ticket in #open-a-ticket with your order number — if it never arrives you get your money back.' },
  { q: 'Can I get a refund?', a: 'Yes, request a refund from your order page or via a ticket. Approved refunds go back to your original payment method.' },
  { q: 'How do I become a VIP?', a: 'VIP is granted to loyal customers — keep buying and stay active. VIPs get early drops, exclusive channels and better giveaway odds.' },
  { q: 'How do giveaways work?', a: 'We host giveaways in #giveaways. React/enter to participate; winners are posted in #winners. VIPs get bonus entries.' },
  { q: 'Do you sell <game> currency?', a: 'We stock Robux, V-Bucks, Valorant, CoD, Apex, Genshin, Brawl Stars, Clash of Clans and more — check #products or ask in #ask-the-bot.' },
];
