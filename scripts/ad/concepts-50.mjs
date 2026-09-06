/**
 * Fifty short-form concepts, written for click-through.
 *
 * ── HOW THIS SET DIFFERS FROM concepts.mjs ────────────────────────────────
 * Those twenty-five are video CUTS: they name beats of a real recording and run
 * through make-ad. These fifty are written concepts — hook, body, CTA, caption,
 * on-screen text — for briefing a shoot rather than editing one. Same honesty
 * gate: every one names a SKU that exists and declares what has to be true.
 *
 * ── WHAT ACTUALLY MOVES CTR, AND WHAT ONLY LOOKS LIKE IT DOES ─────────────
 * The hooks below lean on five things, all of which this shop can back:
 *
 *   A NUMBER          "€2.96 per 1,000" beats "great value" because it is
 *                     checkable in one second and an adjective is not.
 *   AN OBJECTION      saying the thing the viewer is already thinking — "if a
 *                     seller asks for your password, close the tab" — buys more
 *                     attention than any promise.
 *   A CONTRADICTION   "the only way to cancel it is to not buy another one"
 *                     stops a scroll because it is not what a shop usually says.
 *   ARGUING AGAINST   "you do not need the 12,000 pack" is the single most
 *   THE SALE          trusted sentence a shop can say, and it costs one order
 *                     to earn the next ten.
 *   A REAL LIMIT      "22,500 R$ takes five days, and we say so before you pay"
 *                     — a constraint stated up front reads as competence.
 *
 * What is NOT in here, deliberately: countdowns that count nothing, "only X
 * left" on unlimited stock, five stars from nobody, "cheapest anywhere" with no
 * competitor observed, and "official" about companies that have never heard of
 * this shop. Every one of those raises CTR and costs the sale at the checkout,
 * and a large part of this audience is under 18.
 *
 * ── THE FIELDS ────────────────────────────────────────────────────────────
 *   hook      the first two seconds. The whole click happens here.
 *   body      what is said or shown in the middle. One idea, not three.
 *   cta       the last card.
 *   caption   the text typed into TikTok / Shorts, with its tags.
 *   onScreen  what stays up throughout: the price, the handle, the disclosure.
 *   needs     what must be TRUE before this may be made (see variants.mjs).
 */

const OVERLAY = ['forgemarket.nl', '#ad · paid promotion'];

export const BRANDS_50 = {
  roblox: { label: 'Roblox', skus: ['ROBUX-1000', 'ROBUX-2000', 'ROBUX-4500', 'ROBUX-10000', 'ROBUX-22500'] },
  eafc: { label: 'FC Points', skus: ['EAFC-1600', 'EAFC-4600', 'EAFC-12000'] },
  vbucks: { label: 'V-Bucks', skus: ['VBUCKS-1000', 'VBUCKS-2800', 'VBUCKS-5000', 'VBUCKS-13500'] },
  steam: { label: 'Steam', skus: ['STEAM-10', 'STEAM-25', 'STEAM-50'] },
  nitro: { label: 'Discord Nitro', skus: ['NITRO-1M', 'NITRO-1Y'] },
};

const c = (id, brand, sku, hook, body, cta, caption, tags, onScreen, needs = ['price']) =>
  ({ id, brand, sku, hook, body, cta, caption: { text: caption, tags }, onScreen: [...onScreen, ...OVERLAY], needs });

export const CONCEPTS_50 = [
  // ══ ROBLOX ═══════════════════════════════════════════════════════════════
  // The youngest audience and the most scammed one. Seven of these ten lead on
  // safety or on a limit rather than on price, because the objection here is
  // not "is it cheap" — it is "is this person going to take my account".
  c('B1', 'roblox', 'ROBUX-22500',
    '22,500 Robux takes five days. We tell you that before you pay.',
    'Roblox allows 5,000 R$ per account per day. That is their rule, not ours, and it means the biggest pack arrives across five days. Anyone promising it in one go is describing something Roblox does not allow.',
    'The whole rule is on the product page · forgemarket.nl',
    'The daily cap is the single most important thing nobody tells you before you buy Robux. It is on our product page, above the buy button.',
    ['#roblox', '#robux', '#robloxtips'], ['{price}'], ['price', 'delivery']),
  c('B2', 'roblox', 'ROBUX-1000',
    'If a Robux seller asks you to turn 2FA OFF, they are not selling you Robux.',
    'We ask for the opposite. Two-step verification has to be ON before we can deliver — that is how the payout works. Your username is the only thing we ever need.',
    'forgemarket.nl',
    'Turning 2FA off is never part of a top-up. It is part of losing the account.',
    ['#roblox', '#robux', '#robloxsafety', '#scamawareness'], ['{price}']),
  c('B3', 'roblox', 'ROBUX-4500',
    'Five Robux packs. Here is the one most people should not buy.',
    'The biggest one. Unless you are spending it all at once, the daily cap turns it into a five-day wait for the same Robux you could have had today. Every pack shows its price per 1,000 so you can see what you are actually choosing between.',
    'Compare every pack · forgemarket.nl',
    'The biggest pack costs less per 1,000 and takes longer to arrive. Both are true and both are on the page.',
    ['#roblox', '#robux', '#fyp'], ['{perThousand} / 1,000'], ['price', 'perThousand']),
  c('B4', 'roblox', 'ROBUX-2000',
    'The whole form is your username.',
    'No password. No logging in as you. No browser extension touching your account. You order, you send a username, we top it up.',
    'forgemarket.nl',
    'If a checkout asks for more than a username to send Robux, ask why.',
    ['#roblox', '#robux', '#gaming'], ['{price}']),
  c('B5', 'roblox', 'ROBUX-10000',
    'You press Buy and nothing is charged. On purpose.',
    'The order is placed first. Then you transfer the exact amount with your order number as the reference. No card is stored, nothing renews, and if we cannot deliver you get all of it back.',
    'forgemarket.nl',
    'No card details on the site at all. You decide when the money moves.',
    ['#roblox', '#robux', '#ouders'], ['{price}']),
  c('B6', 'roblox', 'ROBUX-1000',
    'It is not instant, and here is why we say so.',
    'A person does this by hand: 2FA on, username in, payout out. Most orders go the same day. We could call that instant on a banner and you would find out at checkout — so we call it what it is.',
    'forgemarket.nl',
    'Every product page says exactly how that product is delivered, before you pay.',
    ['#roblox', '#robux', '#webshop'], ['{price}'], ['price', 'delivery']),
  c('B7', 'roblox', 'ROBUX-4500',
    'Your kid asked for Robux. Here is what actually happens.',
    'No account needed to order. You place it, you transfer the exact amount yourself, nothing is on a subscription, and no card is stored anywhere. The seller is one person in the Netherlands with a name and an email on every page.',
    'Read who runs it · forgemarket.nl',
    'For the person paying: nothing is automatic, nothing renews, and you can cancel until it is delivered.',
    ['#roblox', '#robux', '#parenting', '#ouders'], ['{price}']),
  c('B8', 'roblox', 'ROBUX-22500',
    'What happens if you pay and nothing arrives?',
    'You get all of it back. That is on the refund page in writing, not offered as a favour — and until it is delivered you can still cancel. A real person answers the email.',
    'The refund page says it in writing · forgemarket.nl',
    'The answer to "what if it goes wrong" should be written down before you buy, not discovered afterwards.',
    ['#roblox', '#robux', '#scamawareness'], ['{price}']),
  c('B9', 'roblox', 'ROBUX-2000',
    'Price per 1,000 and price per pack are two different questions.',
    'Most shops answer one of them. Every Robux pack here prints both: what it costs, and what it costs per 1,000.',
    'forgemarket.nl',
    'Price per 1,000 is on every pack, so you can stop doing the division in your head.',
    ['#roblox', '#robux', '#fyp'], ['{perThousand} / 1,000'], ['price', 'perThousand']),
  c('B10', 'roblox', 'ROBUX-10000',
    'No account with us. Ever.',
    'Order as a guest, follow it with the link in your confirmation email. An account only adds order history and store credit — it is never required to buy anything.',
    'forgemarket.nl',
    'Guest checkout, always. We are not collecting a signup to sell you Robux.',
    ['#roblox', '#robux', '#gaming'], ['{price}']),

  // ══ FC POINTS ════════════════════════════════════════════════════════════
  // This audience buys around a moment. These lead on being READY rather than
  // being fast, because ready is a promise this shop can keep.
  c('B11', 'eafc', 'EAFC-12000',
    '1,600 · 4,600 · 12,000. Which one is actually worth it?',
    'Per 1,000 points, not per pack — that is the only comparison that means anything, and it is printed on all three.',
    'forgemarket.nl',
    'Three pack sizes, three prices per 1,000, all on the page. Do the comparison in one look instead of in your head.',
    ['#eafc', '#fcpoints', '#fut'], ['{perThousand} / 1,000'], ['price', 'perThousand']),
  c('B12', 'eafc', 'EAFC-1600',
    'You do not need the 12,000 pack.',
    'Buy the size you actually want. No minimum, no bundle you did not ask for, and the small one is a real product at the price on the tin.',
    'forgemarket.nl',
    'The smallest pack, on its own, at its own price. That is the whole offer.',
    ['#eafc', '#fcpoints', '#fut'], ['{price}']),
  c('B13', 'eafc', 'EAFC-4600',
    'What do you need from my EA account? Nothing.',
    'No login, no password, no account link. An email address is the entire form. How the product is delivered is written on its own page before you buy.',
    'forgemarket.nl',
    'We do not ask to sign into your EA account, because we do not need to.',
    ['#eafc', '#fcpoints', '#scamawareness'], ['{price}']),
  c('B14', 'eafc', 'EAFC-4600',
    'Points in the account before the squad is even picked.',
    'Ordered ahead of the session instead of mid-menu. We say what the delivery actually is on every product page — no promises about seconds.',
    'forgemarket.nl',
    'Order before you sit down, not while you are staring at a pack screen.',
    ['#eafc', '#fcpoints', '#fut', '#fifa'], ['{price}'], ['price', 'delivery']),
  c('B15', 'eafc', 'EAFC-12000',
    'The whole purchase, uncut, nothing sped up.',
    'One real order from the shop front to the code in the inbox. The code in frame is masked; everything else is exactly what happened and at the speed it happened.',
    'forgemarket.nl',
    'One real order, start to finish. No cuts where the waiting was.',
    ['#eafc', '#fcpoints', '#fut'], [], ['order']),
  c('B16', 'eafc', 'EAFC-1600',
    'Nothing is charged when you press Buy.',
    'You place the order, then you transfer the exact amount with your order number. No card stored, nothing automatic, and money back in full if we cannot deliver.',
    'forgemarket.nl',
    'The risk of pressing Buy here is zero, and that is the point.',
    ['#eafc', '#fcpoints', '#webshop'], ['{price}']),
  c('B17', 'eafc', 'EAFC-4600',
    'A shop that tells you which pack NOT to buy.',
    'The middle one is usually right. The 12,000 is better per 1,000 and worse if you will not spend it. Both numbers are on the page so you can decide instead of guessing.',
    'forgemarket.nl',
    'We would rather you buy the right size once than the wrong size twice.',
    ['#eafc', '#fcpoints', '#fut'], ['{perThousand} / 1,000'], ['price', 'perThousand']),
  c('B18', 'eafc', 'EAFC-12000',
    'Read the delivery line before you buy from anyone.',
    'Ours says what arrives, how, and what we need from you. If a shop will not tell you that before payment, that is the answer.',
    'forgemarket.nl',
    'Every product page here has a delivery section above the buy button. Check for one wherever you shop.',
    ['#eafc', '#fcpoints', '#scamawareness'], ['{price}'], ['price', 'delivery']),
  c('B19', 'eafc', 'EAFC-1600',
    'No account needed. Not even ours.',
    'Guest checkout, an email address, done. You follow the order with the link in your confirmation.',
    'forgemarket.nl',
    'Buying should not cost you a signup.',
    ['#eafc', '#fcpoints', '#fyp'], ['{price}']),
  c('B20', 'eafc', 'EAFC-4600',
    'Who is actually selling you this?',
    'One person, in the Netherlands, with a name and contact on every page — including the part most shops leave out: not a registered company yet, and it says so.',
    'Read the whole thing · forgemarket.nl',
    'The seller identity page says what the shop is and what it is not.',
    ['#eafc', '#fcpoints', '#webshop'], ['{price}']),

  // ══ V-BUCKS ══════════════════════════════════════════════════════════════
  // The steepest ladder in the shop: €5.99 per 1,000 at the bottom, €2.96 at
  // the top. The number does the work and no adjective is needed. Two of these
  // lead on the shop's own delivery WARNINGS, which is the most trustworthy
  // thing an ad can do.
  c('B21', 'vbucks', 'VBUCKS-13500',
    'The big V-Bucks pack is half the price per unit. Actually half.',
    '€5.99 per 1,000 at the bottom of the ladder, €2.96 at the top. Every pack prints its own, so the comparison takes one look.',
    'forgemarket.nl',
    'Four packs, four prices per 1,000. The gap between the smallest and the biggest is bigger than most people expect.',
    ['#fortnite', '#vbucks', '#fyp'], ['{perThousand} / 1,000'], ['price', 'perThousand']),
  c('B22', 'vbucks', 'VBUCKS-2800',
    'Check the region before you buy. Any shop, not just ours.',
    'V-Bucks codes are region-based — the code has to match the account. It is written in the delivery notes on the product page, above the buy button, because finding out afterwards is the expensive way.',
    'forgemarket.nl',
    'Region mismatch is the most common reason a code does not work, and it is avoidable in one glance.',
    ['#fortnite', '#vbucks', '#gamingtips'], ['{price}'], ['price', 'delivery']),
  c('B23', 'vbucks', 'VBUCKS-5000',
    'Once a code is redeemed it cannot be refunded. Ours says so before you pay.',
    'That is true everywhere and almost nowhere is it printed before the purchase. Keep the code private, check the region, then redeem.',
    'forgemarket.nl',
    'The warnings that matter belong before the payment, not in a support reply.',
    ['#fortnite', '#vbucks', '#scamawareness'], ['{price}']),
  c('B24', 'vbucks', 'VBUCKS-1000',
    'One code. Works on whatever you play on.',
    'Redeemed on your Epic account at fortnite.com/vbuckscard, so the platform does not matter. The steps are printed in the delivery email.',
    'forgemarket.nl',
    'Redeemed on the Epic account, so it follows you across platforms.',
    ['#fortnite', '#vbucks', '#epicgames'], ['{price}']),
  c('B25', 'vbucks', 'VBUCKS-13500',
    'Buying for someone whose account you do not have.',
    'A code by email. You can forward it. You never need their login and neither do we, and there is no subscription attached to anything.',
    'forgemarket.nl',
    'A code you can forward. No account of theirs, no card on file, nothing that renews.',
    ['#fortnite', '#vbucks', '#cadeau', '#gift'], ['{price}']),
  c('B26', 'vbucks', 'VBUCKS-2800',
    'There is no card field. Look for one.',
    'Order first, then transfer the exact amount with your order number as the reference. No card details are stored on this site at all.',
    'forgemarket.nl',
    'You decide when the money moves, and you can cancel until it is delivered.',
    ['#fortnite', '#vbucks', '#fyp'], ['{price}']),
  c('B27', 'vbucks', 'VBUCKS-5000',
    'Four packs. The one in the middle is usually wrong.',
    'The jump from 5,000 to 13,500 is the biggest drop in price per 1,000 on the whole ladder. If you were going to buy twice, buy once.',
    'Compare the ladder · forgemarket.nl',
    'If you are going to buy the middle pack twice, the top pack is cheaper than doing that.',
    ['#fortnite', '#vbucks', '#fyp'], ['{perThousand} / 1,000'], ['price', 'perThousand']),
  c('B28', 'vbucks', 'VBUCKS-1000',
    'The smallest pack is a real product.',
    'No minimum order, no bundle, no "add €5 more for free delivery" on a thing that arrives by email. Buy the size you want.',
    'forgemarket.nl',
    'No minimums and no bundles you did not ask for.',
    ['#fortnite', '#vbucks', '#gaming'], ['{price}']),
  c('B29', 'vbucks', 'VBUCKS-13500',
    'The whole purchase, uncut.',
    'One real order from the shop front to the code in the inbox, at the speed it actually happened. The code in frame is masked.',
    'forgemarket.nl',
    'One real order, nothing sped up past what the timestamps say.',
    ['#fortnite', '#vbucks', '#fyp'], [], ['order']),
  c('B30', 'vbucks', 'VBUCKS-2800',
    'What if it does not arrive?',
    'Money back in full — in writing on the refund page, not offered as a favour. Until it is delivered you can still cancel, and a real person answers the email.',
    'forgemarket.nl',
    'That answer should be written down before you buy. Here it is.',
    ['#fortnite', '#vbucks', '#webshop'], ['{price}']),

  /* ══ STEAM ══════════════════════════════════════════════════════════════
     Three products, all face-value cards, and the thinnest shelf in the shop:
     bought at face they can earn €1.35, €0.92 and €1.16. Ten concepts is a lot
     of attention to point at €3.43 of ceiling, so none of these lead on price —
     there is no price story to tell. They lead on what a card IS and what this
     shop will not ask you for, which is what actually converts a gift card. */
  c('B31', 'steam', 'STEAM-25',
    'We never ask for your Steam login. Nobody selling you credit should.',
    'A code arrives by email and you redeem it yourself. No account link, no password, no "just log in so we can add it for you".',
    'forgemarket.nl',
    'Anyone who needs your Steam login to give you Steam credit is not giving you Steam credit.',
    ['#steam', '#pcgaming', '#scamawareness'], ['{price}']),
  c('B32', 'steam', 'STEAM-10',
    'A Steam card is credit. That is the entire product.',
    'It goes into your wallet and you spend it on whatever the store sells. Nothing is attached, nothing renews, and it does not expire into a subscription.',
    'forgemarket.nl',
    'Store credit, redeemed by you, spent on whatever you like.',
    ['#steam', '#pcgaming', '#gaming'], ['{price}']),
  c('B33', 'steam', 'STEAM-50',
    'The gift that needs nothing from the person getting it.',
    'A code by email that you can forward. You never need their login and neither do we.',
    'forgemarket.nl',
    'A code you can forward. That is the whole gift.',
    ['#steam', '#cadeau', '#gift'], ['{price}']),
  c('B34', 'steam', 'STEAM-10',
    'The smallest one is €11.99 and it is not a teaser.',
    'No minimum order, no bundle, no upsell wall. If €10 of credit is what you want, that is what is for sale.',
    'forgemarket.nl',
    'The small card is a real product, not bait for the big one.',
    ['#steam', '#pcgaming', '#fyp'], ['{price}']),
  c('B35', 'steam', 'STEAM-25',
    'Buy now, pay when you feel like it. Literally.',
    'You order first, then transfer the exact amount with your order number as the reference. No card details are stored on this site.',
    'forgemarket.nl',
    'You decide when the money moves.',
    ['#steam', '#pcgaming', '#webshop'], ['{price}']),
  c('B36', 'steam', 'STEAM-50',
    '"Money back" is a sentence. Ours is a page.',
    'Money back in full, in writing on the refund page. Until it is delivered you can still cancel, and a real person answers the email.',
    'The refund page says it in writing · forgemarket.nl',
    'The answer to that question should exist before you need it.',
    ['#steam', '#webshop', '#scamawareness'], ['{price}']),
  c('B37', 'steam', 'STEAM-25',
    'Keep the code private. Once it is redeemed it is gone.',
    'True of every code from every shop, and almost nowhere is it said before the purchase rather than in a support reply afterwards.',
    'forgemarket.nl',
    'A redeemed code cannot be refunded. Screenshot it to nobody.',
    ['#steam', '#gamingtips', '#scamawareness'], ['{price}']),
  c('B38', 'steam', 'STEAM-10',
    'Most shops hide this page. Ours links it from every product.',
    'One person, in the Netherlands, name and contact on every page — including the part most shops leave out: not a registered company yet, and the page says so.',
    'Read the whole thing · forgemarket.nl',
    'The seller page says what this shop is and what it is not.',
    ['#steam', '#webshop'], ['{price}']),
  c('B39', 'steam', 'STEAM-50',
    'Zero signups between you and a Steam code.',
    'Guest checkout and an email address. You follow the order with the link in your confirmation.',
    'forgemarket.nl',
    'Buying should not cost you a signup.',
    ['#steam', '#pcgaming', '#gaming'], ['{price}']),
  c('B40', 'steam', 'STEAM-25',
    'Watch a stranger buy something and get it.',
    'One real order from the shop front to the code in the inbox, at the speed it actually happened. The code in frame is masked.',
    'forgemarket.nl',
    'One real order, nothing sped up past what the timestamps say.',
    ['#steam', '#pcgaming', '#fyp'], [], ['order']),

  /* ══ DISCORD NITRO ══════════════════════════════════════════════════════
     Two products and the strongest honest angle in the whole set: it is a CODE,
     so it cannot auto-renew. That is the opposite of how Nitro is normally
     sold, which is exactly why it stops a scroll. The year works out at €7.08 a
     month against €8.99 — 21% — and that is arithmetic on the shop's own two
     prices, not a claim about anybody else's. */
  c('B41', 'nitro', 'NITRO-1Y',
    'The only way to cancel it is to not buy another one.',
    'It is a code you redeem yourself, so there is no card on file and nothing to remember to turn off. It runs out instead of quietly charging you for a thirteenth month.',
    'forgemarket.nl',
    'No cancel button to hunt for, because there is nothing to cancel.',
    ['#discord', '#discordnitro', '#nitro'], ['{price}']),
  c('B42', 'nitro', 'NITRO-1Y',
    'A year of Nitro works out at €7.08 a month.',
    'Against €8.99 for a single month — 21% less, from the shop\'s own two prices. Same Nitro, redeemed the same way, on a code that cannot renew behind you.',
    'forgemarket.nl',
    'Both prices are on the site. The maths is one division and we have done it for you.',
    ['#discord', '#discordnitro', '#nitro'], ['€7.08 / month']),
  c('B43', 'nitro', 'NITRO-1M',
    'One month. Not a trial, not a subscription, not a card on file.',
    'A code you redeem at discord.com/billing/promotions. When the month ends, it ends.',
    'forgemarket.nl',
    'A month that stops by itself.',
    ['#discord', '#discordnitro', '#fyp'], ['{price}']),
  c('B44', 'nitro', 'NITRO-1Y',
    'Buying Nitro for someone else.',
    'A code by email you can forward. You never need their Discord login and neither do we, and nothing gets attached to your payment method.',
    'forgemarket.nl',
    'A code you can forward. No account of theirs required.',
    ['#discord', '#discordnitro', '#cadeau', '#gift'], ['{price}']),
  c('B45', 'nitro', 'NITRO-1M',
    'We will never DM you first.',
    'Not about Nitro, not about anything. Every "free Nitro" DM you have ever had was somebody after your account — and a shop that actually sells it does not need to slide into anybody\'s messages.',
    'forgemarket.nl',
    'Staff never DM first. That rule is pinned in our own server.',
    ['#discord', '#discordnitro', '#scamawareness'], ['{price}']),
  c('B46', 'nitro', 'NITRO-1Y',
    'No card on file is the feature, not an oversight.',
    'You order first, then transfer the exact amount with your order number. No card is stored, so nothing can renew whether you remember it or not.',
    'forgemarket.nl',
    'The one purchase where "no card on file" is the actual feature.',
    ['#discord', '#discordnitro', '#webshop'], ['{price}']),
  c('B47', 'nitro', 'NITRO-1M',
    'Redeemed at discord.com/billing/promotions. That is the only place.',
    'Any other link claiming to activate Nitro is claiming something else. The real steps are printed in the delivery email.',
    'forgemarket.nl',
    'One URL. If a link is not that one, it is not activating Nitro.',
    ['#discord', '#discordnitro', '#scamawareness'], ['{price}']),
  c('B48', 'nitro', 'NITRO-1Y',
    'Undelivered means refunded. Not "contact support".',
    'Money back in full, in writing on the refund page. Until it is delivered you can cancel, and a real person answers the email.',
    'The refund page says it in writing · forgemarket.nl',
    'Written down before you need it, which is the only time it counts.',
    ['#discord', '#discordnitro', '#webshop'], ['{price}']),
  c('B49', 'nitro', 'NITRO-1M',
    'A month is €8.99 and we would rather you started there.',
    'If you have never had Nitro, buy the month. The year is better value and worse if you do not end up using it — both prices are on the site and neither one is hidden behind the other.',
    'forgemarket.nl',
    'Start with the month. The year will still be there.',
    ['#discord', '#discordnitro', '#fyp'], ['{price}']),
  c('B50', 'nitro', 'NITRO-1Y',
    'Twenty seconds, one order, no edits where the waiting was.',
    'One real order from the shop front to the code in the inbox, at the speed it actually happened. The code in frame is masked.',
    'forgemarket.nl',
    'One real order, nothing sped up past what the timestamps say.',
    ['#discord', '#discordnitro', '#fyp'], [], ['order']),
];

export const conceptById50 = (id) =>
  CONCEPTS_50.find((x) => x.id.toUpperCase() === String(id).toUpperCase()) || null;

export const conceptsForBrand50 = (brand) =>
  CONCEPTS_50.filter((x) => x.brand === String(brand).toLowerCase());
