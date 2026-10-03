/**
 * The fifty UGC scripts in English — the same beats, products, pictures and
 * price sums as the Dutch ones in ugcScripts.js (which also hold `ok`, the
 * SKUs and the pictures); only the words are here. Written the way a
 * British or international player talks, not translated word for word.
 */
const R1 = 'ROBUX-1000', R45 = 'ROBUX-4500', R10 = 'ROBUX-10000', R22 = 'ROBUX-22500';
const V1 = 'VBUCKS-1000', V28 = 'VBUCKS-2800', V5 = 'VBUCKS-5000', V13 = 'VBUCKS-13500';
const site = ($) => $.site('forgemarket.nl');
const fa = ($) => $.say('2FA', 'two-factor authentication');

export default {
  'ugc-01': {
    hook: () => 'I honestly thought free Robux worked…',
    problem: () => 'You type your name, then your password. And then nothing happens.',
    solution: ($) => `Real Robux don't need your password. You only give your ${$.field(R1)}.`,
    cta: ($) => `A thousand Robux, ${$.p(R1)}. ${site($)}` },
  'ugc-02': {
    hook: () => 'This "Robux generator" wanted one thing from me.',
    problem: () => 'My password. Why would a seller ever need that?',
    solution: () => 'ForgeMarket only asks for your username. Your password stays yours.',
    cta: ($) => `See for yourself: ${site($)}` },
  'ugc-03': {
    hook: () => 'My little brother clicked a "free Robux" link.',
    problem: () => 'He had to log in on a site that looked like Roblox. It wasn\'t.',
    solution: () => 'Buying Robux should never mean logging in somewhere else. At ForgeMarket it\'s just your username.',
    cta: ($) => `Show him: ${site($)}` },
  'ugc-04': {
    hook: () => 'Ten thousand free Robux? No.',
    problem: () => 'When something is free, you pay with your account.',
    solution: ($) => `Ten thousand Robux on ForgeMarket is ${$.p(R10)}. Just a price, no tricks.`,
    cta: ($) => site($) },
  'ugc-05': {
    hook: () => 'I got a DM: "Want free Robux?"',
    problem: () => 'First your password, then "verification". You know how it goes.',
    solution: () => 'I\'d rather just buy them. Only my username, never my password.',
    cta: () => 'Link in bio.' },
  'ugc-06': {
    hook: () => 'Roblox players keep making this mistake.',
    problem: () => 'They hand their password to someone who "sorts out Robux".',
    solution: () => 'You never have to. Robux on ForgeMarket only need your username.',
    cta: ($) => `${site($)}. Your password stays yours.` },
  'ugc-07': {
    hook: () => 'Turn this on before you buy Robux.',
    problem: ($) => `Without ${fa($)} your account is an open door.`,
    solution: ($) => `ForgeMarket only delivers once ${fa($)} is on, and only asks for your username.`,
    cta: ($) => `${fa($)} first, then ${site($)}`,
    checklist: () => ['2FA on', 'Just your username', 'Never your password'] },
  'ugc-08': {
    hook: () => 'My mate lost his Roblox account.',
    problem: () => 'He gave his password for "cheap Robux".',
    solution: () => 'You can buy Robux without anyone getting into your account. Just your username.',
    cta: ($) => site($) },
  'ugc-09': {
    hook: () => 'What does a Robux seller actually need from you?',
    problem: () => 'Not your password. Not your email code.',
    solution: ($) => `At ForgeMarket: your ${$.field(R1)}. That's it.`,
    cta: ($) => `A thousand Robux, ${$.p(R1)}. ${site($)}` },
  'ugc-10': {
    hook: () => 'My mum asked: "Do you have to give your password?"',
    problem: () => 'On a lot of those sites you do. That\'s why she didn\'t trust it.',
    solution: ($) => `Not here. You only fill in your ${$.field(R1)}.`,
    cta: ($) => `Show her: ${site($)}` },
  'ugc-11': {
    hook: () => 'I overpaid for Robux. My own fault.',
    problem: ($) => `I kept buying a thousand Robux for ${$.p(R1)}.`,
    solution: ($) => `Ten thousand is ${$.p(R10)}. That's ${$.per(R10)} per thousand instead of ${$.per(R1)}.`,
    cta: ($) => `Do the maths: ${site($)}` },
  'ugc-12': {
    hook: () => 'Grab your calculator for a second.',
    problem: ($) => `A thousand Robux: ${$.p(R1)}. Sounds fine, right?`,
    solution: ($) => `With ${$.size(R22)} Robux you pay ${$.per(R22)} per thousand. Bigger pack, lower price per thousand.`,
    cta: ($) => site($) },
  'ugc-13': {
    hook: () => 'Buying a few Robux every week? Expensive joke.',
    problem: ($) => `Ten times a thousand Robux: ${$.m(10 * $.c(R1))}.`,
    solution: ($) => `Ten thousand in one go: ${$.p(R10)}. That's ${$.m(10 * $.c(R1) - $.c(R10))} less.`,
    cta: ($) => site($) },
  'ugc-14': {
    hook: () => 'I wait before buying Robux now. On purpose.',
    problem: () => 'Every small top-up cost me more per thousand.',
    solution: ($) => `${$.size(R45)} Robux for ${$.p(R45)} is ${$.per(R45)} per thousand. A single thousand is ${$.p(R1)}.`,
    cta: ($) => `Check it: ${site($)}` },
  'ugc-15': {
    hook: () => 'Nobody looks at the price per thousand Robux.',
    problem: () => 'You look at the total and click.',
    solution: ($) => `At ForgeMarket it goes from ${$.per(R1)} to ${$.per(R22)} per thousand, depending on the pack.`,
    cta: ($) => site($) },
  'ugc-16': {
    hook: () => 'This cost me too much V-Bucks money for years.',
    problem: ($) => `I always bought the smallest pack. A thousand for ${$.p(V1)}.`,
    solution: ($) => `The ${$.size(V13)} pack is ${$.p(V13)}. That's ${$.per(V13)} per thousand.`,
    cta: ($) => `Do the maths at ${site($)}` },
  'ugc-17': {
    hook: ($) => `${$.per(V1)} or ${$.per(V13)}. Same thousand V-Bucks.`,
    problem: () => 'The only difference is how many you buy at once.',
    solution: ($) => `On ForgeMarket: a thousand V-Bucks ${$.p(V1)}, ${$.size(V13)} for ${$.p(V13)}.`,
    cta: ($) => site($) },
  'ugc-18': {
    hook: () => 'Buying V-Bucks again every season?',
    problem: () => 'Always a small pack, always the highest price per thousand.',
    solution: ($) => `${$.size(V5)} V-Bucks for ${$.p(V5)}, or ${$.size(V13)} for ${$.p(V13)}. Work it out per thousand.`,
    cta: ($) => site($) },
  'ugc-19': {
    hook: () => 'I thought you could only buy V-Bucks in the game.',
    problem: () => 'In there you never see what a thousand costs.',
    solution: ($) => `On ForgeMarket you get a V-Bucks code by email. Redeem it at ${$.site('fortnite.com/vbuckscard')}.`,
    cta: ($) => site($) },
  'ugc-20': {
    hook: () => 'Twenty euros of pocket money. How many V-Bucks?',
    problem: () => 'Small packs get you the least for it.',
    solution: ($) => `${$.size(V28)} V-Bucks cost ${$.p(V28)}. A single thousand is ${$.p(V1)}.`,
    cta: ($) => `See what fits: ${site($)}` },
  'ugc-21': {
    hook: () => 'I don\'t want yet another account.',
    problem: () => 'Passwords everywhere, newsletters, confirming emails.',
    solution: () => 'At ForgeMarket you check out as a guest.',
    cta: ($) => site($) },
  'ugc-22': {
    hook: () => 'I just want some Robux. No profile.',
    problem: () => 'Every site wants you to sign up first.',
    solution: ($) => `Not here. Check out as a guest, and follow your order at ${$.site('forgemarket.nl/track')}.`,
    cta: ($) => site($) },
  'ugc-23': {
    hook: () => 'The password for that one site? Gone.',
    problem: () => 'That\'s why I don\'t make accounts everywhere any more.',
    solution: () => 'ForgeMarket: check out as a guest.',
    cta: ($) => site($) },
  'ugc-24': {
    hook: () => 'I bought something once, and now I get email every day.',
    problem: () => 'Made an account, forgot the tick box.',
    solution: () => 'At ForgeMarket you can check out as a guest.',
    cta: ($) => site($) },
  'ugc-25': {
    hook: () => 'No account means you can\'t follow your order. Or so I thought.',
    problem: () => 'I didn\'t want an account, but I did want to know where my order was.',
    solution: ($) => `At ${$.site('forgemarket.nl/track')} you follow it with your order number.`,
    cta: ($) => site($) },
  'ugc-26': {
    hook: () => 'My biggest fear buying codes online?',
    problem: () => 'Paying, and then getting nothing.',
    solution: () => 'ForgeMarket puts it in writing: not delivered, money back.',
    cta: ($) => `Read it yourself: ${$.site('forgemarket.nl/refunds')}` },
  'ugc-27': {
    hook: () => 'Before I order anywhere, I read this first.',
    problem: () => 'The refund policy. That\'s usually where the catch is.',
    solution: ($) => `At ForgeMarket: not delivered, money back. It's on ${$.site('forgemarket.nl/refunds')}.`,
    cta: () => 'Check it and decide for yourself.' },
  'ugc-28': {
    hook: () => '"Where\'s my order?" No more guessing.',
    problem: () => 'Some shops go quiet the moment you\'ve paid.',
    solution: ($) => `At ${$.site('forgemarket.nl/track')} you see the status of your order.`,
    cta: ($) => site($) },
  'ugc-29': {
    hook: () => 'I always screenshot the refund policy.',
    problem: () => 'You never know when you\'ll need it.',
    solution: () => 'ForgeMarket\'s is short: not delivered, money back.',
    cta: ($) => $.site('forgemarket.nl/refunds') },
  'ugc-30': {
    hook: () => 'I always have questions before I order.',
    problem: () => 'At a lot of shops you can\'t find a human anywhere.',
    solution: () => 'ForgeMarket has a Discord where you can just ask.',
    cta: ($) => $.site('forgemarket.nl/discord') },
  'ugc-31': {
    hook: () => 'My kid wanted Robux. I didn\'t want to give away his password.',
    problem: () => 'That\'s exactly what a lot of sites ask for.',
    solution: ($) => `At ForgeMarket only the ${$.field(R1)}, and ${fa($)} has to be on.`,
    cta: ($) => site($) },
  'ugc-32': {
    hook: () => 'My daughter asked for Steam credit. I don\'t want my card on her account.',
    problem: () => 'Then she can keep buying with it.',
    solution: () => 'A Steam Wallet code arrives by email. She redeems it, your card stays with you.',
    cta: ($) => site($) },
  'ugc-33': {
    hook: () => 'What do you get a gamer who has everything?',
    problem: () => 'You never know which game or which item.',
    solution: () => 'Credit. V-Bucks, Robux or a Steam code. Then they choose.',
    cta: ($) => site($) },
  'ugc-34': {
    hook: () => 'My son spends his pocket money on small Robux packs.',
    problem: ($) => `A thousand Robux for ${$.p(R1)}, again and again.`,
    solution: ($) => `Save up together for ten thousand: ${$.p(R10)}. That's ${$.per(R10)} per thousand.`,
    cta: ($) => `Do the maths together: ${site($)}` },
  'ugc-35': {
    hook: () => 'My nephew wants game credit. But for which game?',
    problem: () => 'He plays Fortnite and Steam games. I don\'t get any of it.',
    solution: () => 'A Steam or V-Bucks code arrives by email. You just pass it on.',
    cta: ($) => site($) },
  'ugc-36': {
    hook: () => 'I put V-Bucks on the wrong account.',
    problem: () => 'Logged in as my little brother. Gone.',
    solution: ($) => `At ${$.site('fortnite.com/vbuckscard')}, check who's logged in first. Then the code.`,
    cta: ($) => `V-Bucks codes at ${site($)}`,
    checklist: () => ['Right account?', 'Then redeem', 'Code from your email'] },
  'ugc-37': {
    hook: () => 'Do this before you redeem a code.',
    problem: () => 'A redeemed code doesn\'t come back.',
    solution: () => 'Check which account you\'re logged into. Your code arrives by email, you choose when.',
    cta: ($) => site($) },
  'ugc-38': {
    hook: () => 'Steam credit on the wrong account? Tough luck.',
    problem: () => 'You can\'t move that balance afterwards.',
    solution: () => 'Log in to the right Steam account first, then redeem your code.',
    cta: ($) => `Steam Wallet codes at ${site($)}`,
    checklist: () => ['Right Steam account', 'Then the code', 'Code from your email'] },
  'ugc-39': {
    hook: () => 'One letter wrong in your username. You don\'t want that.',
    problem: () => 'Then the delivery looks for the wrong account.',
    solution: ($) => `Copy your ${$.field(R1)} straight from your profile when you order.`,
    cta: ($) => site($) },
  'ugc-40': {
    hook: () => 'Never share your gift code in a group chat.',
    problem: () => 'Whoever redeems it first, has it.',
    solution: () => 'Your code only goes to your own email. Keep it there until you use it.',
    cta: ($) => site($) },
  'ugc-41': {
    hook: () => 'That one skin. And just not enough VP.',
    problem: () => 'In the game you don\'t see what a thousand costs.',
    solution: ($) => `A thousand VP for ${$.p('VAL-1000')}. ${$.size('VAL-2050')} VP for ${$.p('VAL-2050')}.`,
    cta: ($) => site($) },
  'ugc-42': {
    hook: () => 'Buying Nitro again every month?',
    problem: ($) => `Twelve single months is ${$.m(12 * $.c('NITRO-1M'))}.`,
    solution: ($) => `A month is ${$.p('NITRO-1M')}. A year is ${$.p('NITRO-1Y')}.`,
    cta: ($) => `Do the maths: ${site($)}` },
  'ugc-43': {
    hook: () => 'Buying Minecoins in tiny bits?',
    problem: () => 'Then you pay the most per coin.',
    solution: ($) => `${$.size('MC-1720')} Minecoins: ${$.p('MC-1720')}. ${$.size('MC-3500')}: ${$.p('MC-3500')}.`,
    cta: ($) => site($) },
  'ugc-44': {
    hook: () => 'I kept buying five hundred gems at a time.',
    problem: ($) => `${$.p('COC-500')} every time. It adds up.`,
    solution: ($) => `${$.size('COC-2500')} gems cost ${$.p('COC-2500')}. Five times five hundred is ${$.m(5 * $.c('COC-500'))}.`,
    cta: ($) => site($) },
  'ugc-45': {
    hook: () => 'Ultimate Team empties your wallet.',
    problem: () => 'Especially when you keep buying small packs of Points.',
    solution: ($) => `${$.size('EAFC-1600')} FC Points: ${$.p('EAFC-1600')}. ${$.size('EAFC-12000')}: ${$.p('EAFC-12000')}. Work it out per thousand.`,
    cta: ($) => site($) },
  'ugc-46': {
    hook: () => '"Buying codes online is always fake." I hear it a lot.',
    problem: () => 'So I look at one thing first.',
    solution: () => 'What happens if it doesn\'t arrive. At ForgeMarket: not delivered, money back.',
    cta: ($) => $.site('forgemarket.nl/refunds') },
  'ugc-47': {
    hook: () => 'You don\'t need an account to order.',
    problem: () => 'Lots of people think you do, and give up.',
    solution: () => 'At ForgeMarket you check out as a guest.',
    cta: ($) => site($) },
  'ugc-48': {
    hook: () => '"A big pack is a waste of money." Not always.',
    problem: () => 'Per thousand, small packs cost you more.',
    solution: ($) => `V-Bucks: ${$.per(V1)} per thousand in the smallest pack, ${$.per(V13)} in the biggest.`,
    cta: ($) => site($) },
  'ugc-49': {
    hook: () => 'My checklist before I buy game credit.',
    problem: () => 'Password? Need an account? What if it never arrives?',
    solution: () => 'ForgeMarket: no password, guest checkout, not delivered means money back.',
    cta: ($) => site($),
    checklist: () => ['No password', 'Guest checkout', 'Not delivered? Money back'] },
  'ugc-50': {
    hook: () => '"Where do you buy your Robux?" Honest answer.',
    problem: () => 'Somewhere that never asks for my password.',
    solution: ($) => `On ForgeMarket only my username. A thousand Robux, ${$.p(R1)}.`,
    cta: () => 'Link in bio.' },
};
