/**
 * Packs found by desk research on 4 October 2026 — web searches run by hand,
 * not by the shop's servers — with the pages that name them.
 *
 * Only packs that at least two independent pages name are here; amounts that
 * one source mentioned and another contradicted (Robux 400/1,700, COD Points
 * 500/21,000, PokéCoins 2,500, FC Points 100/250/5,900) are left out, and so
 * are products whose packs the sources did not agree on (Spotify, Amazon, GTA
 * Shark Cards). Each pack becomes MENTIONS from these pages (source
 * 'research'), so it goes through the same parser, duplicate check and gate
 * as everything else: never added automatically, two websites minimum, and a
 * person approves it. This is a snapshot: it does not update itself.
 */
export const RESEARCHED_AT = '2026-10-04T12:00:00Z';
export const RESEARCH_VERSION = 'r1-2026-10-04';

export const RESEARCHED_PACKS = [
  { game: 'ea-fc', platforms: ['playstation', 'xbox', 'pc'], region: 'global', amounts: [500, 1050, 1600, 2800, 12000, 18500],
    sources: ['https://gg.deals/ingame-currency/ea-sports-fc-26-fc-points-12000/', 'https://fifauteam.com/fc-points-prices-fc-26/',
      'https://coingate.com/gift-cards/articles/article/fc-points-prices-what-they-buy-and-the-fc-27-transfer'] },
  { game: 'roblox', region: 'global', amounts: [800, 2000, 4500, 10000],
    sources: ['https://roblox.fandom.com/wiki/Roblox_Gift_Card', 'https://playgama.com/blog/game-faqs/how-many-robux-do-roblox-gift-cards-add/',
      'https://resell.codes/en/blog/roblox-gift-cards-wholesale-guide'] },
  { game: 'fortnite', platforms: ['any'], region: 'global', amounts: [1000, 2800, 5000, 13500],
    sources: ['https://store.epicgames.com/en-US/p/fortnite--13500-v-bucks', 'https://gg.deals/ingame-currency/fortnite-1000-v-bucks/',
      'https://www.g2a.com/fortnite-epic-games-key-2800-v-bucks-i10000174299009'] },
  { game: 'valorant', region: 'eu', amounts: [475, 1000, 2050, 3650, 5350, 11000],
    sources: ['https://wiki.playvalorant.com/en-us/VALORANT_Points', 'https://bo3.gg/valorant/articles/prices-for-valorant-points-in-all-regions',
      'https://www.valorant-spind.de/en/valorant-points-preise.html'] },
  { game: 'league-of-legends', region: 'eu', amounts: [575, 1380, 2800, 4500, 6500, 13500],
    sources: ['https://leagueoflegends.fandom.com/wiki/RP', 'https://www.g2a.com/league-of-legends-riot-points-1380-rp-riot-key-europe-west-i10000179182060',
      'https://www.g2a.com/league-of-legends-riot-points-2800-rp-riot-key-europe-west-i10000179182059'] },
  { game: 'call-of-duty', platforms: ['playstation', 'xbox', 'pc'], region: 'global', amounts: [200, 1100, 2400, 5000, 9500, 13000],
    sources: ['https://gg.deals/game-points-group/call-of-duty-points/', 'https://callofduty.fandom.com/wiki/CODPoints',
      'https://lfcarry.com/guides/cod-points-guide'] },
  { game: 'apex-legends', platforms: ['playstation', 'xbox', 'pc'], region: 'global', amounts: [1000, 2150, 4350, 6700, 11500],
    sources: ['https://gg.deals/ingame-currency/apex-legends-1000-apex-coins/', 'https://www.dlcompare.com/gamecards/108/buy-apex-legends-2150-apex-coins-key',
      'https://www.bestbuy.com/product/apex-legends-11500-coins-digital/JCQ6HQGFQ8/sku/6457725'] },
  /* Base amounts (60, 300, 980, …), as the shop and sellers name the packs —
     not the totals with the in-game bonus (330, 1,090, …), which would list
     the same pack twice. */
  { game: 'genshin-impact', region: 'global', amounts: [60, 300, 980, 1980, 3280, 6480],
    sources: ['https://genshin-impact.fandom.com/wiki/Genesis_Crystal', 'https://www.codashop.com/en-us/genshin-impact',
      'https://game8.co/games/Genshin-Impact/archives/297595'] },
  { game: 'pubg-mobile', region: 'global', amounts: [60, 325, 660, 1800, 3850, 8100],
    sources: ['https://www.codashop.com/en-us/pubg-mobile-uc-redeem-code', 'https://gamecardsdirect.com/nl-en/pubg-mobile-uc/',
      'https://news.bittopup.com/news/pubg-mobile-uc-top-up-guide-2026-best-value-packs'] },
  { game: 'free-fire', region: 'global', amounts: [100, 310, 520, 1060, 2180, 5600],
    sources: ['https://www.joytify.com/en-us/free-fire-global', 'https://buffbuff.com/top-up/free-fire', 'https://ggpick.com/free-fire/top-up/'] },
  { game: 'mobile-legends', region: 'global', amounts: [86, 172, 257, 344, 429, 514, 706, 2195, 3688, 5532, 9288],
    sources: ['https://www.joytify.com/en-us/mobile-legends-global', 'https://www.durmaplay.com/en/mobile-legends-diamonds-global',
      'https://www.lotkeys.com/en/product/mobile-legends-bang-bang-diamonds-global'] },
  { game: 'brawl-stars', region: 'global', amounts: [30, 80, 170, 360, 950, 2000],
    sources: ['https://brawlstars.fandom.com/wiki/Gems', 'https://www.u4gm.com/brawl-stars-top-up'] },
  { game: 'clash-of-clans', region: 'global', amounts: [80, 500, 1200, 2500, 6500, 14000],
    sources: ['https://topuplist.com/blogs/detail/clash-of-clans-gems-price-best-value-packs-2026', 'https://www.durmaplay.com/en/clash-of-clans-6500-green-gems',
      'https://igitems.com/clashofclans-topup'] },
  { game: 'clash-royale', region: 'global', amounts: [80, 500, 1200, 2500, 6500, 14000],
    sources: ['https://clashroyale.fandom.com/wiki/Shop', 'https://clashroyale.wiki/resources/gems/',
      'https://www.kinguin.net/category/334916/clash-royale-top-up-global-14000-gems-6500-gems-2500-gems-1200-gems-500-gems-80-gems-gold-pass-diamond-pass-fistful-of-gems-pouch-of-gems-bucket-of-gems-barrel-of-gems'] },
  { game: 'pokemon-go', region: 'global', amounts: [100, 550, 1200, 5200, 14500],
    sources: ['https://pokemongohub.net/post/news/pokemon-go-raises-100-pokecoins-bundle-price/', 'https://pokemongohub.net/post/news/pokemon-go-black-friday-sale-analysis/',
      'https://skycoach.gg/pokemon-go-boost/pokecoins'] },
  { game: 'minecraft', region: 'global', amounts: [1720, 3500, 8800],
    sources: ['https://gg.deals/ingame-currency/minecraft-minecoins-pack-1720-coins/', 'https://gamecardsdirect.com/de-en/minecraft-minecoins/',
      'https://www.eneba.com/us/store/minecraft-minecoins'] },
  { game: 'steam', region: 'eu', amounts: [5, 10, 20, 25, 50, 100],
    sources: ['https://gamecardsdirect.com/nl-en/steam-gift-cards/', 'https://gg.deals/gift-cards-group/steam-wallet-gift-card-eur-netherlands/',
      'https://startselect.com/nl-en/gift-cards/steam-card-gift-cards'] },
  { game: 'playstation-store', region: 'nl', amounts: [10, 20, 25, 50, 75, 100],
    sources: ['https://gamecardsdirect.com/nl-nl/playstation-network-cards/', 'https://startselect.com/nl-nl/cadeaukaarten/playstation-store-kaarten',
      'https://www.bol.com/nl/nl/p/10-euro-playstation-store-tegoed-psn-playstation-network-kaart/9200000113877194/'] },
  { game: 'xbox-store', region: 'nl', amounts: [5, 10, 15, 20, 25, 30, 50, 75],
    sources: ['https://beltegoed.nl/infos/xbox-gift-card/xbox-cadeaukaart-alle-voordelen', 'https://ikwiltegoed.nl/gamecards/xbox/giftcards',
      'https://startselect.com/nl-nl/cadeaukaarten/xbox-gift-cards'] },
  { game: 'nintendo-store', region: 'nl', amounts: [15, 25, 50, 75, 100],
    sources: ['https://www.giftcards.nl/cadeaukaarten/nintendo-eshop-card/', 'https://startselect.com/nl-nl/cadeaukaarten/nintendo-eshop-cards',
      'https://beltegoed.nl/nintendo-eshop-card'] },
  { game: 'google-play', region: 'nl', amounts: [15, 25, 50],
    sources: ['https://support.google.com/googleplay/answer/3422734?hl=nl', 'https://www.opwaarderen.nl/google-play', 'https://kaartdirect.nl/product/google-play-card-eur15'] },
  { game: 'apple', region: 'nl', amounts: [15, 25, 50, 100],
    sources: ['https://kaartdirect.nl/cadeaukaarten/apple-gift-card', 'https://www.iculture.nl/tips/apple-tegoed-cadeau-geven/',
      'https://startselect.com/nl-nl/cadeaukaarten/apple-gift-cards'] },
  { game: 'netflix', region: 'nl', amounts: [15, 25, 50],
    sources: ['https://kaartdirect.nl/cadeaukaarten/netflix', 'https://www.primera.nl/cadeaukaarten/muziek-en-media/netflix',
      'https://startselect.com/nl-nl/netflix-gift-card-euro25/33946'] },
  { game: 'discord', region: 'global', amounts: [1, 12],
    sources: ['https://www.hablax.com/en/country/netherlands/giftcard-discord-nitro-gift-card', 'https://giftsy.com/en/discord-nitro-1-month-subscription-global',
      'https://www.mygiftcardsupply.com/discord-gift-card/'] },
  { game: 'xbox-game-pass', region: 'eu', amounts: [1, 3],
    sources: ['https://gamesdirect.nl/producten/xbox-game-pass-ultimate-1-maand.html', 'https://xboxlivekaarten.nl/producten/xbox-game-pass-ultimate-1-maand.html',
      'https://www.loaded.com/3-month-xbox-game-pass-ultimate-xbox-one-pc-eu'] },
];
