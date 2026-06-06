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
      { name: 'welcome', type: 'text', readOnly: true, topic: 'Welcome to ForgeMarket — instant, trusted game top-ups. Start here 👇' },
      { name: 'start-here', type: 'text', readOnly: true, topic: 'A 30-second guide to the server: verify, browse, buy, get support.' },
      { name: 'rules', type: 'text', readOnly: true, topic: 'The rules. Be cool, no scams, no spam. Breaking them = removal.' },
      { name: 'verify', type: 'text', readOnly: true, topic: 'Tap the button to verify and unlock the community.' },
      { name: 'links', type: 'text', readOnly: true, topic: 'All official ForgeMarket links — shop, track order, sign in & socials.' },
    ],
  },
  {
    name: '📢 ANNOUNCEMENTS', access: 'public',
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
      { name: 'products', type: 'text', readOnly: true, topic: 'Browse the catalog. Every order is instant + buyer-protected → {STORE_URL}' },
      { name: 'price-list', type: 'text', readOnly: true, topic: 'Live prices for our most popular top-ups.' },
      { name: 'deals', type: 'text', readOnly: true, topic: 'Limited-time deals and bundle prices.' },
      { name: 'ask-the-bot', type: 'text', slowmode: 3, topic: 'Ask our AI assistant anything — get product recommendations & help in seconds.' },
      { name: 'how-to-buy', type: 'text', readOnly: true, topic: 'Step-by-step: how to order and receive your code instantly.' },
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
      { name: 'off-topic', type: 'text', topic: 'Anything goes (within the rules).' },
      { name: 'lounge', type: 'voice', topic: 'Hang out in voice.' },
      { name: 'game-night', type: 'voice', topic: 'Community game nights.' },
    ],
  },
  {
    name: '⭐ REVIEWS & TRUST', access: 'public',
    channels: [
      { name: 'reviews', type: 'text', readOnly: true, topic: 'Verified customer reviews. Posted automatically after real orders.' },
      { name: 'vouchers', type: 'text', slowmode: 30, topic: 'Bought from us? Leave a quick voucher/vouch for the community 💚' },
      { name: 'proof-of-delivery', type: 'text', readOnly: true, topic: 'Screenshots of real, completed deliveries.' },
      { name: 'discount-codes', type: 'text', readOnly: true, topic: 'Active discount/voucher codes — redeem at checkout.' },
    ],
  },
  {
    name: '🎫 SUPPORT', access: 'public',
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
    name: '🤝 PARTNERS', access: 'public',
    channels: [
      { name: 'partnerships', type: 'text', readOnly: true, topic: 'Want to partner or become an affiliate? Open a ticket to apply.' },
      { name: 'partner-perks', type: 'text', readOnly: true, topic: 'Perks & benefits for approved partners.' },
    ],
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

// ── Onboarding & content ────────────────────────────────────────────────────
export const MESSAGES = {
  welcome: (g) => ({
    title: `Welcome to ${g} ⚡`,
    description:
      "**The premium marketplace for game top-ups — delivered in seconds.**\n\n" +
      "Robux • V-Bucks • Valorant • CoD • Genshin • Apex • gift cards & more.\n\n" +
      "**Get started:**\n" +
      "1️⃣ Read the <#rules>\n" +
      "2️⃣ Verify in <#verify> to unlock the server\n" +
      "3️⃣ Browse <#products> or ask in <#ask-the-bot>\n" +
      "4️⃣ Need help? <#open-a-ticket>\n\n" +
      "Instant delivery · buyer-protected · 24/7 support.",
  }),
  rules: {
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
      "**What is ForgeMarket?** Instant, trusted game currency & gift cards.\n\n" +
      "**How it works:**\n" +
      "• Browse <#products> or get a recommendation in <#ask-the-bot>\n" +
      "• Buy on the website — pay securely\n" +
      "• Your code is delivered **instantly** to your dashboard + email\n" +
      "• Issues? Open a ticket in <#open-a-ticket>\n\n" +
      "**Why trust us?** Verified reviews in <#reviews>, real <#proof-of-delivery>, and a money-back guarantee.\n\n" +
      "👉 First step: verify in <#verify>.",
  },
  verify: {
    title: '✅ Verify to enter',
    description:
      "Tap **Verify** below to confirm you're human and unlock the full server: " +
      "marketplace, community, giveaways and support.\n\nThis keeps the community safe from bots and scammers.",
  },
  ticketPanel: {
    title: '🎫 Open a support ticket',
    description:
      "Pick a topic below and we'll open a **private channel** with our team.\n\n" +
      "🛒 **Order issue** — missing/incorrect delivery\n" +
      "💳 **Payment** — checkout or refund\n" +
      "🤝 **Partnership** — collab / affiliate\n" +
      "❓ **Other** — anything else\n\n" +
      "Average first response: **under 10 minutes** during open hours.",
  },
  products: {
    title: '🛒 The ForgeMarket catalog',
    description:
      "Game currency, top-ups, gift cards and subscriptions — **delivered in seconds**, " +
      "buyer-protected, with verified reviews.\n\n" +
      "**Popular:** Robux • V-Bucks • Valorant VP • CoD Points • Apex Coins • Genshin • Brawl Stars • Clash of Clans\n\n" +
      "Not sure what you need? Ask in <#ask-the-bot> and our assistant will recommend the right pack.\n\n" +
      "👇 Tap **Browse the shop** to see live prices.",
  },
  howToBuy: {
    title: '💳 How to buy (it takes ~30 seconds)',
    description:
      "**1.** Open the shop and pick your pack.\n" +
      "**2.** Check out securely (card payment).\n" +
      "**3.** Your code is delivered **instantly** to your dashboard **and** email.\n" +
      "**4.** Redeem in-game. Done! 🎮\n\n" +
      "Problem with an order? Open a ticket in <#open-a-ticket> — eligible orders are money-back guaranteed.",
  },
  deals: {
    title: '🔥 Deals & bundles',
    description:
      "Limited-time offers and best-value bundles drop here.\n\n" +
      "🔔 Turn on notifications for this channel so you never miss a deal.\n" +
      "💜 **VIP Customers** get early access and extra discounts.",
  },
  announcement: {
    title: '📢 Welcome to ForgeMarket — we’re live!',
    description:
      "The fastest, most trusted place to top up your favourite games. ⚡\n\n" +
      "• **Instant delivery** on every order\n" +
      "• **Buyer protection** + money-back guarantee\n" +
      "• **Verified reviews** and real proof of delivery\n" +
      "• **24/7 support** right here on Discord\n\n" +
      "Verify in <#verify>, then browse <#products>. Welcome aboard! 🎉",
  },
  supportInfo: {
    title: '📋 How support works',
    description:
      "**Open hours:** every day, with fast responses (avg. under 10 min).\n" +
      "**Order issues:** open a ticket in <#open-a-ticket> with your order number.\n" +
      "**Refunds:** request from your order page or via a ticket — approved refunds go to your original method.\n" +
      "**Safety:** our staff will **never DM you first** and never ask for passwords. Report anyone who does.",
  },
  reviewsIntro: {
    title: '⭐ Verified customer reviews',
    description:
      "Every review here is tied to a **real, completed order** — no fakes.\n\n" +
      "See genuine delivery screenshots in <#proof-of-delivery>, and bought from us? " +
      "Leave a quick vouch in <#vouches> 💚",
  },
  proofIntro: {
    title: '📸 Proof of delivery',
    description: "Real screenshots of completed, instant deliveries. Transparency builds trust. 🔒",
  },
  giveawaysIntro: {
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
      "**Store:** online ✅\n**Instant delivery:** operational ✅\n**Payments:** operational ✅\n\n" +
      "We post here if anything is ever delayed. No news = all good.",
  },
  priceList: {
    title: '🏷️ Live price list',
    description:
      "Our most popular top-ups (full catalog + live prices on the site):\n\n" +
      "• **Robux** — from €9.99\n• **V-Bucks** — from €6.99\n• **Valorant VP** — from €9.99\n" +
      "• **CoD Points** — from €23.99\n• **Apex Coins** — from €9.99\n• **Genshin Crystals** — from €15.99\n" +
      "• **Brawl Stars Gems** — from €6.99\n• **Clash of Clans Gems** — from €4.99\n\n" +
      "Prices may change — always check the shop for the live price 👇",
  },
  vouchersIntro: {
    title: '💚 Vouchers & vouches',
    description:
      "Bought from us? Leave a quick **voucher** here — a screenshot + a line about your experience " +
      "helps the whole community shop with confidence.\n\n" +
      "Real customers only. Verified reviews are also posted in <#reviews>.",
  },
  discountCodes: {
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
};

// FAQ — powers the #faq channel AND the AI fallback.
export const FAQ = [
  { q: 'How fast is delivery?', a: 'Most top-ups are delivered automatically within seconds of payment. The code arrives in your dashboard and by email.' },
  { q: 'Is it safe / legit?', a: 'Yes — encrypted checkout, automated fraud screening, buyer protection and verified reviews. Staff never DM you first.' },
  { q: 'What payment methods can I use?', a: 'Secure card payments at checkout. More methods are added over time.' },
  { q: 'I didn’t get my code — what now?', a: 'Open a ticket in #open-a-ticket with your order number. We resolve delivery issues fast, and eligible orders are money-back guaranteed.' },
  { q: 'Can I get a refund?', a: 'Yes, request a refund from your order page or via a ticket. Approved refunds go back to your original payment method.' },
  { q: 'How do I become a VIP?', a: 'VIP is granted to loyal customers — keep buying and stay active. VIPs get early drops, exclusive channels and better giveaway odds.' },
  { q: 'How do giveaways work?', a: 'We host giveaways in #giveaways. React/enter to participate; winners are posted in #winners. VIPs get bonus entries.' },
  { q: 'Do you sell <game> currency?', a: 'We stock Robux, V-Bucks, Valorant, CoD, Apex, Genshin, Brawl Stars, Clash of Clans and more — check #products or ask in #ask-the-bot.' },
];
