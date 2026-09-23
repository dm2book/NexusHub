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
    key: 'support', name: 'Support', color: '#10b981', hoist: true, mentionable: false,
    perms: ['ManageMessages', 'ManageThreads'],
    responsibility: 'Handles tickets, order questions, refunds and delivery issues. First line of customer help.',
  },
  {
    key: 'vip', name: 'VIP Customer', color: '#a855f7', hoist: true, mentionable: false,
    perms: [],
    responsibility: 'Top customers: early access to drops and codes, bonus giveaway entries, priority on tickets.',
  },
  {
    key: 'partner', name: 'Partner', color: '#eab308', hoist: true, mentionable: false,
    perms: [],
    responsibility: 'Approved collaborators / affiliates. Revenue share, early access and co-marketing.',
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
    // No colour on purpose: this role outranks the game and level roles, so a
    // colour here would override every one of them on every member.
    key: 'verified', name: 'Verified Customer', color: null, hoist: false, mentionable: false,
    perms: [],
    responsibility: 'Default member tier after passing verification — unlocks the full community.',
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
 * channel.public:   readable BEFORE verifying, even inside a gated category
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
      // #updates was merged in here: two staff-only news channels split an
      // already-thin posting rhythm and both looked abandoned.
      { name: 'announcements', type: 'announcement', readOnly: true, topic: 'Official ForgeMarket news, product and pricing updates. Follow to never miss a drop.' },
      { name: 'restocks', type: 'text', readOnly: true, topic: 'Back-in-stock alerts. Grab the 🔔 Drops & Restocks role in #roles to get pinged.' },
      { name: 'status', type: 'text', readOnly: true, topic: 'Posted here when something is delayed. No recent post = running normally.' },
    ],
  },
  {
    name: '🛒 MARKETPLACE', access: 'verified',
    channels: [
      { name: 'products', type: 'text', readOnly: true, topic: 'Browse the catalog — fair prices, money back if it never arrives → {STORE_URL}' },
      { name: 'price-list', type: 'text', readOnly: true, topic: 'Live prices, synced automatically from the shop.' },
      { name: 'how-to-buy', type: 'text', readOnly: true, public: true, topic: 'Step-by-step: how to order, how to pay, and when your code arrives.' },
      { name: 'deals', type: 'text', readOnly: true, topic: 'Limited-time deals and bundle prices.' },
      { name: 'ask-the-bot', type: 'text', slowmode: 3, topic: 'Ask our assistant anything — product recommendations, prices and order help.' },
    ],
  },
  {
    // Trust sits directly under the shop: "has anyone actually received their
    // order?" is the first question a new store has to answer, and it used to be
    // buried below seventeen chat and voice channels.
    name: '⭐ REVIEWS & TRUST', access: 'verified',
    channels: [
      { name: 'reviews', type: 'text', readOnly: true, public: true, topic: 'Reviews from real orders — posted here automatically as they come in.' },
      // Renamed from "vouchers": in Dutch a voucher is a discount coupon, and
      // this server has a coupon channel two rows down.
      { name: 'vouches', aka: ['vouchers'], type: 'text', slowmode: 30, topic: 'Bought from us? Leave a quick vouch for the community 💚' },
      { name: 'proof-of-delivery', type: 'text', readOnly: true, public: true, topic: 'Screenshots of real, completed deliveries.' },
      { name: 'discount-codes', type: 'text', readOnly: true, topic: 'Active discount codes — redeem at checkout.' },
    ],
  },
  {
    name: '🎫 SUPPORT', access: 'verified',
    channels: [
      { name: 'open-a-ticket', type: 'text', readOnly: true, topic: 'Need help? Tap a button to open a private ticket with our team.' },
      { name: 'faq', type: 'text', readOnly: true, public: true, topic: 'Answers to the most common questions.' },
      { name: 'support-info', type: 'text', readOnly: true, topic: 'How support works, and what to expect.' },
      { name: 'report-a-scam', type: 'text', readOnly: true, public: true, topic: 'Staff never DM first. Report suspicious users here.' },
    ],
  },
  {
    /* One conversation, not seven — but one per language rather than one
       for everybody.

       The rule that keeps this from becoming four empty rooms is `lang`: a
       language room is invisible until you pick that language in #roles, so a
       member sees exactly one general, not three abandoned ones beside it.
       #general-nl carries `house` as well, which keeps it readable for every
       verified member — it is the shop's own language, and it is the floor
       nobody falls through if they never open the picker.

       general-nl adopts the old #general by `aka`, so the conversation that is
       already there moves with the name instead of being left beside it. */
    name: '💬 COMMUNITY', access: 'verified',
    channels: [
      { name: 'roles', type: 'text', readOnly: true, topic: 'Pick your language, your games and the alerts you want.' },
      { name: 'general-nl', aka: ['general'], type: 'text', lang: 'nl', house: true,
        topic: 'Nederlandse chat — de hoofdkamer van ForgeMarket. Zeg even hallo 👋' },
      { name: 'general-en', type: 'text', lang: 'en',
        topic: 'English chat. Pick English in #roles and this room stays with you.' },
      { name: 'general-de', type: 'text', lang: 'de',
        topic: 'Deutscher Chat. Wähle in #roles Deutsch, dann bleibt dir dieser Raum.' },
      { name: 'general-fr', type: 'text', lang: 'fr',
        topic: 'Salon francophone. Choisis Français dans #roles et ce salon reste chez toi.' },
      { name: 'media', aka: ['clips', 'screenshots-media', 'memes'], type: 'text', topic: 'Clips, screenshots and memes.' },
      { name: 'suggestions', type: 'text', topic: 'Got an idea? Use /suggest — the community votes and staff respond.' },
      { name: 'starboard', type: 'text', readOnly: true, topic: 'The best messages, starred by the community ⭐ (react with ⭐).' },
    ],
  },
  {
    name: '🔊 VOICE', access: 'verified',
    channels: [
      { name: '🛋️ Lounge', aka: ['lounge'], type: 'voice' },
      { name: '🎮 Game Night', aka: ['game-night'], type: 'voice' },
      { name: '💤 AFK', type: 'voice', afk: true },
    ],
  },
  {
    name: '🎉 GIVEAWAYS', access: 'verified',
    channels: [
      { name: 'giveaways', type: 'text', readOnly: true, topic: 'Enter active giveaways. Hosted by the team & the bot.' },
      { name: 'winners', type: 'text', readOnly: true, topic: 'Hall of winners 🏆' },
    ],
  },
  {
    name: '🤝 PARTNERS', access: 'verified',
    channels: [
      { name: 'partners', aka: ['partnerships', 'partner-perks'], type: 'text', readOnly: true, topic: 'Creator, community owner or reseller? Apply here — perks for approved partners.' },
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
      { name: 'staff-voice', type: 'voice' },
    ],
  },
];

export { STAFF, MEMBERS };

/**
 * The four languages this server is spoken in, and the room each one opens.
 *
 * A picker rather than four buttons, because unlike a game you have exactly one
 * of these: picking Deutsch takes Nederlands off you, so nobody ends up holding
 * all four and seeing every room. That is also why `key` is the ISO code — it
 * matches the storefront's own locales (nl/en/de/fr), which is what the
 * delivery mail is already written in.
 *
 * `room` is the channel this role unlocks; permissions.js gates that channel on
 * this role and nothing else, so adding a fifth language here is a config line
 * and a channel, not a permission rewrite.
 *
 * `confirm` is written in the language it confirms. A member who picks
 * Français and is answered in English has been told the picker does not
 * really work, in the one message whose whole job is to prove that it does.
 * {room} is substituted with the real channel mention.
 *
 * No colour, deliberately. These sit at the bottom of the role list so a colour
 * here would lose to every game and level role anyway — it would be a badge
 * that shows up for nobody, and a language is not a badge.
 */
export const LANGUAGE_ROLES = [
  { key: 'nl', label: 'Nederlands', emoji: '🇳🇱', room: 'general-nl',
    blurb: 'Nederlandse chat — de hoofdkamer',
    confirm: 'Je taal staat nu op **Nederlands**. Je kamer is {room}.' },
  { key: 'en', label: 'English', emoji: '🇬🇧', room: 'general-en',
    blurb: 'English chat',
    confirm: 'Your language is set to **English**. Your room is {room}.' },
  { key: 'de', label: 'Deutsch', emoji: '🇩🇪', room: 'general-de',
    blurb: 'Deutscher Chat',
    confirm: 'Deine Sprache steht jetzt auf **Deutsch**. Dein Raum ist {room}.' },
  { key: 'fr', label: 'Français', emoji: '🇫🇷', room: 'general-fr',
    blurb: 'Salon francophone',
    confirm: 'Ta langue est maintenant **Français**. Ton salon est {room}.' },
];

// Self-assignable roles (created by setup, toggled by buttons in #roles).
export const GAME_ROLES = [
  { key: 'robux', label: 'Roblox', emoji: '🟩', color: '#22c55e' },
  { key: 'fortnite', label: 'Fortnite', emoji: '🟦', color: '#60a5fa' },
  { key: 'valorant', label: 'Valorant', emoji: '🟥', color: '#fb7185' },
  { key: 'cod', label: 'Call of Duty', emoji: '🟧', color: '#f97316' },
  { key: 'apex', label: 'Apex Legends', emoji: '🔺', color: '#ef4444' },
  { key: 'genshin', label: 'Genshin', emoji: '⚗️', color: '#22d3ee' },
  { key: 'brawl', label: 'Brawl Stars', emoji: '🟨', color: '#eab308' },
  { key: 'clash', label: 'Clash of Clans', emoji: '🟪', color: '#a78bfa' },
  { key: 'giftcards', label: 'Gift Cards', emoji: '🎁', color: '#14b8a6' },
];
/**
 * Which self-assignable game role a shop category belongs to.
 *
 * #roles has offered these since the server was built and nothing ever pinged
 * one: every restock went to everyone who opted into any drop at all, so
 * somebody who only buys Robux was pinged for every Steam restock. That is how
 * an opt-in role becomes an opt-out.
 *
 * Keys are the storefront's category slugs. A category with no entry pings
 * nobody in particular — it still reaches the Drops & Restocks role, which is
 * the whole point of that one.
 */
export const CATEGORY_GAME_ROLE = {
  robux: 'robux',
  'v-bucks': 'fortnite',
  valorant: 'valorant',
  cod: 'cod',
  apex: 'apex',
  genshin: 'genshin',
  brawl: 'brawl',
  clash: 'clash',
  clashroyale: 'clash',
  giftcard: 'giftcards',
  steam: 'giftcards',
  playstation: 'giftcards',
  xbox: 'giftcards',
  nintendo: 'giftcards',
  netflix: 'giftcards',
  spotify: 'giftcards',
};

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
/**
 * The brand banners' versions — a deliberate copy of src/lib/discordBanners.js.
 *
 * The bot's Docker image copies only `discord/`, so this tree cannot import
 * from src/. The copy is therefore the price of shipping the bot on its own,
 * and server/test/creative-freshness.test.mjs fails if the two ever disagree —
 * which is the only thing that makes a duplicate safe.
 *
 * Discord caches an embed image by URL and never looks again, so the version is
 * the artwork's own hash: regenerate with `node scripts/art/social-generate.mjs`
 * and paste the hashes it prints, in both places.
 */
export const BANNER_VERSION = {
  welcome: 'ff710d19',
  rules: 'e144095a',
  verify: '67cbd42f',
  products: '750e032b',
  deals: 'fe6d198c',
  giveaways: 'e9aa014e',
  support: '4e29c726',
  vouches: 'e9958175',
  'start-here': '228db0c3',
  'how-to-buy': '12f79c27',
  announcements: '9d36d003',
  proof: '5f01c449',
  links: '228b0ba5',
  'report-a-scam': 'dc5fb25a',
  partners: '0f124302',
  roles: '7f8984bf',
  suggestions: '9a0f115b',
};

/** The banner URL for a channel, with {STORE_URL} still to be substituted. */
export const bannerImage = (name) =>
  `{STORE_URL}/discord/banner-${name}.jpg?v=${BANNER_VERSION[name] || ''}`;

export const MESSAGES = {
  welcome: (g) => ({
    image: bannerImage('welcome'),
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
    image: bannerImage('rules'),
    color: 0x94a3b8,
    title: '📜 Server Rules',
    description:
      "**1. Be respectful.** No harassment, hate, or NSFW.\n" +
      "**2. No scams.** Never trade outside official channels. Staff will *never* DM you first.\n" +
      "**3. No spam / self-promo** without permission.\n" +
      "**4. Nederlands of Engels** in the main channels — anything else we can't moderate.\n" +
      "**5. One account per person.** No ban evasion.\n" +
      "**6. Use tickets for order issues** — don't share private info publicly.\n" +
      "**7. Staff decisions are final.** Appeals via ticket.\n\n" +
      "_Breaking the rules can result in a timeout, kick or ban._",
  },
  startHere: {
    image: bannerImage('start-here'),
    color: 0xa855f7,
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
    image: bannerImage('verify'),
    color: 0x22c55e,
    title: '✅ Verify to enter',
    description:
      "Tap **Verify** below to confirm you're human and unlock the full server: " +
      "marketplace, community, giveaways and support.\n\nThis keeps the community safe from bots and scammers.",
  },
  ticketPanel: {
    image: bannerImage('support'),
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
    image: bannerImage('products'),
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
    image: bannerImage('how-to-buy'),
    color: 0x38bdf8,
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
    image: bannerImage('deals'),
    color: 0xef4444,
    title: '🔥 Deals & bundles',
    description:
      "Limited-time offers and best-value bundles drop here.\n\n" +
      "🔔 Turn on notifications for this channel so you never miss a deal.\n" +
      "💜 **VIP Customers** get early access and extra discounts.",
  },
  announcement: {
    image: bannerImage('announcements'),
    color: 0x6366f1,
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
    image: bannerImage('support'),
    color: 0x3b82f6,
    title: '📋 How support works',
    description:
      "**Open hours:** every day. We're one small team, so replies come fast during the day and can wait until morning at night.\n" +
      "**Order issues:** open a ticket in <#open-a-ticket> with your order number.\n" +
      "**Refunds:** request from your order page or via a ticket — approved refunds go to your original method.\n" +
      "**Safety:** our staff will **never DM you first** and never ask for passwords. Report anyone who does.",
  },
  // Takes the Trustpilot URL because the strongest thing this panel can say is
  // "and you don't have to take our word for it" — but only once there is a
  // profile to point at. Unset, the line is absent rather than dead.
  reviewsIntro: ({ trustpilotUrl = '' } = {}) => ({
    image: bannerImage('vouches'),
    color: 0x22c55e,
    title: '⭐ Verified customer reviews',
    description:
      "Every review here is tied to a **real, completed order** — no fakes.\n\n" +
      "See genuine delivery screenshots in <#proof-of-delivery>, and bought from us? " +
      "Leave a quick vouch in <#vouches> 💚" +
      (trustpilotUrl
        ? `\n\n⭐ **We're on Trustpilot too:** ${trustpilotUrl}\n` +
          "Those reviews live on a platform we don't own and can't edit — read them before you buy."
        : ''),
  }),
  proofIntro: {
    image: bannerImage('proof'),
    color: 0x34d399,
    title: '📸 Proof of delivery',
    description: "Real screenshots of completed deliveries. Transparency builds trust. 🔒",
  },
  giveawaysIntro: {
    image: bannerImage('giveaways'),
    color: 0xa855f7,
    title: '🎉 Giveaways',
    description:
      "Free top-ups, every week! 🎁\n\n" +
      "• Active giveaways are posted here — react/enter to join.\n" +
      "• **VIP Customers** get bonus entries.\n" +
      "• Winners are announced in <#winners>.\n\nGood luck! 🍀",
  },
  staffIntro: {
    color: 0x64748b,
    title: '🛠️ Staff HQ',
    description:
      "Internal area. Tickets log to <#ticket-logs>, moderation to <#mod-log>, and the bot posts joins, " +
      "tickets, buying-intent leads and sales to <#leads>.\n\nKeep it professional — customers come first. 💪",
  },
  // This panel is the anti-scam reference: "if it isn't listed here, it isn't
  // us". That only holds if the list is complete, so the Trustpilot profile
  // belongs here the moment it exists — and nowhere in the copy before that,
  // because a link to a profile that doesn't exist is exactly what the panel
  // warns against.
  links: ({ trustpilotUrl = '' } = {}) => ({
    image: bannerImage('links'),
    color: 0x818cf8,
    title: '🔗 Official ForgeMarket links',
    description:
      "Only trust links posted here or by staff.\n\n" +
      "🛍️ **Shop:** {STORE_URL}/shop\n" +
      "🏠 **Home:** {STORE_URL}\n" +
      "📦 **Track your order:** {STORE_URL}/track\n" +
      "👤 **Your account:** {STORE_URL}/account\n" +
      (trustpilotUrl ? `⭐ **Trustpilot reviews:** ${trustpilotUrl}\n` : '') +
      "❓ **FAQ:** see <#faq>\n\n" +
      "Buttons below take you straight there 👇",
  }),
  status: {
    color: 0x22c55e,
    title: '🟢 Store status',
    // No standing "all systems operational" claim: this panel is pinned once and
    // would keep saying it during an outage. It explains the channel instead.
    description:
      "This is where we post when something is delayed — a payment provider acting up, a supplier being slow, " +
      "or maintenance on the shop.\n\n" +
      "**No recent post = everything is running normally.**\n\n" +
      "Waiting on an order right now? `/order <your number>` gives you its live status, or check " +
      "{STORE_URL}/track — no account needed.",
  },
  priceList: {
    image: bannerImage('products'),
    color: 0x6366f1,
    title: '🏷️ Prices',
    // Deliberately no prices here. The bot posts a live, auto-syncing price
    // embed in this same channel; a second hand-written list could only ever
    // drift out of date and contradict it.
    description:
      "The full price list below updates itself straight from the shop, so what you see here is what you pay.\n\n" +
      "Looking for something that isn't listed? Ask in <#ask-the-bot> — if we can get it, we will.",
  },
  vouchersIntro: {
    image: bannerImage('vouches'),
    color: 0x22c55e,
    title: '💚 Vouchers & vouches',
    description:
      "Bought from us? Leave a quick **voucher** here — a screenshot + a line about your experience " +
      "helps the whole community shop with confidence.\n\n" +
      "Real customers only. Verified reviews are also posted in <#reviews>.",
  },
  discountCodes: {
    image: bannerImage('deals'),
    color: 0xec4899,
    title: '🏷️ Discount & voucher codes',
    description:
      "Active codes drop here — redeem them at checkout for money off.\n\n" +
      "💜 **VIP Customers** get exclusive codes.\n🔔 Turn on notifications so you never miss one.",
  },
  reportScam: {
    image: bannerImage('report-a-scam'),
    color: 0xf87171,
    title: '🚨 Report a scam',
    description:
      "**Staff will NEVER DM you first** and will never ask for your password or codes.\n\n" +
      "If someone impersonates the team or DMs you a 'deal', **don't engage** — open a ticket in " +
      "<#open-a-ticket> and report them. We keep this community safe. 🛡️",
  },
  partnersIntro: {
    image: bannerImage('partners'),
    color: 0xa855f7,
    title: '🤝 Earn from ForgeMarket',
    description:
      /* This panel advertised an application-only partner programme and said
         nothing about the referral programme every member already has. The
         store has issued a code per account since it was built, pays 5% of
         every order a referred customer places — not just their first — and
         credits it as spendable store credit. Nobody was told, so nobody
         shared. The open thing goes first because it applies to everyone
         reading; the gated thing is the step up from it. */
      "**Anyone can start today.** Type **/ref** for your own link. When someone " +
      "orders through it you earn **5% of what they spend, on every order they " +
      "ever place** — paid straight into your store credit, nothing to claim.\n\n" +
      "— \n\n" +
      "**Bigger audience?** Content creator, community owner or reseller — let's work together.\n\n" +
      "**What you get:** a higher revenue share, early access to drops and codes, a partner role, " +
      "direct line to the owner and co-marketing.\n\n" +
      "**How to apply:** tap the button below (or open a ticket and pick **Partnership**) and tell us " +
      "who you are and where your audience is. We reply to every application.",
  },
  rolesPanel: {
    image: bannerImage('roles'),
    color: 0x22d3ee,
    title: '🎮 Pick your roles',
    description:
      "Three things to pick, and you keep only what you want.\n\n" +
      "🌍 **Language** — Nederlands, English, Deutsch or Français. "
      + "Your chat room opens when you pick one, and you only see that one.\n"
      /* "LFG pings" until this line was rewritten — there is no LFG channel and
         never was. What a game role actually does is decide which restock
         pings reach you, which is CATEGORY_GAME_ROLE above. */
      + "🎮 **Games** — a colour, and a ping only when the thing you actually buy is back in stock.\n"
      + "🔔 **Alerts** — drops, deals and giveaways.\n\n"
      + "Games and alerts toggle — tap again to drop one. Language is one at a time.",
  },
  suggestionsIntro: {
    image: bannerImage('suggestions'),
    color: 0x34d399,
    title: '💡 Suggestions',
    description:
      "Help shape ForgeMarket! Use **/suggest** `your idea` and it gets posted here with " +
      "live ✅/❌ vote buttons and its own discussion thread.\n\n" +
      "Staff review every idea — you'll see it marked **Approved**, **Planned** or **Declined**, " +
      "and you get a DM when a decision lands. Good ideas get built. 🚀",
  },
  starboardIntro: {
    color: 0xf59e0b,
    title: '⭐ Starboard',
    description:
      "React to any message with ⭐ and once it hits **3 stars** it lands here — a hall of fame " +
      "for the funniest, most helpful and best community moments. 🏆",
  },
};

// Per-category delivery explanation — mirrors the site's product pages so the
// answer to "how do I get it?" is consistent everywhere. Keyed by category;
// anything else falls back to `default`.
/* DELIVERY_INFO used to live here with two categories — robux and v-bucks —
   under a comment promising it was "kept in step with src/lib/deliveryInfo.js".
   Both had two, the shop sells twenty-one, and the recipes for eight of them
   were already written and translated inside the delivery email.
   It is now generated into src/generated/delivery.js from the shop's own
   table, so the bot and the product page cannot answer differently.
   Regenerate: node scripts/gen-discord-delivery.mjs */

// FAQ — powers the #faq channel AND the AI fallback.
export const FAQ = [
  { q: 'How fast is delivery?', a: 'Items we have in stock are sent automatically once your payment is confirmed. Anything we buy in for you is delivered by hand, usually within a few hours during the day. Either way the code arrives by email.' },
  { q: 'Is it safe / legit?', a: 'Encrypted checkout, automated fraud screening, reviews tied to real orders, and your money back if an order never arrives. Staff never DM you first.' },
  { q: 'What payment methods can I use?', a: 'You pay by bank transfer or payment link, using your order number as the reference. We confirm every payment by hand — usually within minutes during the day. More automatic methods are coming.' },
  { q: 'I didn’t get my code — what now?', a: 'First check spam. Then run `/order <your number>` to see the live status. Still nothing? Open a ticket in #open-a-ticket with your order number — if it never arrives you get your money back.' },
  { q: 'Can I get a refund?', a: 'Yes, request a refund from your order page or via a ticket. Approved refunds go back to your original payment method.' },
  { q: 'How do I become a VIP?', a: 'VIP is granted to loyal customers — keep buying and stay active. VIPs get early access to drops and codes, bonus giveaway entries and priority on tickets.' },
  { q: 'How do giveaways work?', a: 'We host giveaways in #giveaways. React/enter to participate; winners are posted in #winners. VIPs get bonus entries.' },
  { q: 'Do you sell <game> currency?', a: 'We stock Robux, V-Bucks, Valorant, CoD, Apex, Genshin, Brawl Stars, Clash of Clans and more — check #products or ask in #ask-the-bot.' },
];
