import { PrismaClient } from '@prisma/client';
import {
  DEFAULT_AUTO_SELL_LADDER,
  DEFAULT_TRAILING_STOP,
  Role,
  TradeSide,
} from '@memeforge/shared';

const prisma = new PrismaClient();

const OWNER_EMAIL = (process.env.OWNER_EMAIL ?? 'mohamedelhannouti51@gmail.com').toLowerCase();

function addr(): string {
  const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  return Array.from({ length: 44 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

const SEED_TOKENS = [
  { symbol: 'WIF', name: 'dogwifhat', price: 2.41, ch24: 18.2, liq: 1_800_000, holders: 38_000 },
  { symbol: 'BONK', name: 'Bonk', price: 0.0000241, ch24: -6.4, liq: 950_000, holders: 41_000 },
  { symbol: 'POPCAT', name: 'Popcat', price: 1.12, ch24: 64.0, liq: 720_000, holders: 22_000 },
  { symbol: 'MOODENG', name: 'Moo Deng', price: 0.18, ch24: 132.0, liq: 410_000, holders: 9_400 },
  { symbol: 'PNUT', name: 'Peanut the Squirrel', price: 0.94, ch24: 41.0, liq: 560_000, holders: 15_200 },
  { symbol: 'GIGA', name: 'Gigachad', price: 0.061, ch24: -12.0, liq: 280_000, holders: 7_800 },
];

async function main() {
  console.log('🌱 Seeding MemeForge...');

  // ── Owner ──
  const owner = await prisma.user.upsert({
    where: { email: OWNER_EMAIL },
    update: { role: Role.OWNER },
    create: {
      email: OWNER_EMAIL,
      name: 'Owner',
      role: Role.OWNER,
      notificationPref: { create: { email: true, inApp: true } },
      profitLockConfig: { create: { sweepPct: 50 } },
    },
  });
  console.log(`   owner: ${owner.email}`);

  // ── Wallet ──
  const wallet = await prisma.wallet.upsert({
    where: { userId_address: { userId: owner.id, address: 'demo-main' } },
    update: {},
    create: { userId: owner.id, label: 'Main Wallet', address: 'demo-main' },
  });

  // ── Tokens ──
  const tokens = [] as Awaited<ReturnType<typeof prisma.token.create>>[];
  for (const t of SEED_TOKENS) {
    const token = await prisma.token.create({
      data: {
        address: addr(),
        symbol: t.symbol,
        name: t.name,
        priceUsd: t.price,
        priceChange1h: (Math.random() - 0.5) * 12,
        priceChange24h: t.ch24,
        volume24h: t.liq * (2 + Math.random() * 4),
        liquidityUsd: t.liq,
        marketCap: t.price * 1e9,
        fdv: t.price * 2e9,
        holders: t.holders,
        launchedAt: new Date(Date.now() - Math.random() * 60 * 24 * 3_600_000),
      },
    });
    tokens.push(token);
  }

  // ── Open positions with automation ──
  for (const token of tokens.slice(0, 4)) {
    const entry = token.priceUsd / (1 + (token.priceChange24h / 100) * (0.4 + Math.random() * 0.6));
    const sizeUsd = 1000 + Math.random() * 4000;
    const sizeTokens = sizeUsd / entry;
    const position = await prisma.position.create({
      data: {
        walletId: wallet.id,
        tokenId: token.id,
        entryPriceUsd: entry,
        peakPriceUsd: token.priceUsd,
        sizeTokens,
        initialTokens: sizeTokens,
        costBasisUsd: sizeUsd,
        openedAt: new Date(Date.now() - Math.random() * 20 * 24 * 3_600_000),
        trades: {
          create: {
            side: TradeSide.BUY,
            priceUsd: entry,
            amountTokens: sizeTokens,
            amountUsd: sizeUsd,
            note: 'Seed entry',
          },
        },
        autoSellRules: { create: DEFAULT_AUTO_SELL_LADDER },
        trailingStop: { create: { ...DEFAULT_TRAILING_STOP } },
      },
    });
    console.log(`   position: ${token.symbol} (${position.id.slice(0, 8)})`);
  }

  // ── A couple of realized (closed) trades for analytics ──
  const closedToken = tokens[4]!;
  const closed = await prisma.position.create({
    data: {
      walletId: wallet.id,
      tokenId: closedToken.id,
      status: 'CLOSED',
      entryPriceUsd: closedToken.priceUsd * 0.5,
      peakPriceUsd: closedToken.priceUsd * 1.2,
      sizeTokens: 0,
      initialTokens: 10_000,
      costBasisUsd: 2000,
      realizedUsd: 1450,
      openedAt: new Date(Date.now() - 12 * 24 * 3_600_000),
      closedAt: new Date(Date.now() - 2 * 24 * 3_600_000),
    },
  });
  await prisma.trade.createMany({
    data: [
      { positionId: closed.id, side: TradeSide.BUY, priceUsd: closedToken.priceUsd * 0.5, amountTokens: 10_000, amountUsd: 2000 },
      { positionId: closed.id, side: TradeSide.SELL, priceUsd: closedToken.priceUsd * 1.0, amountTokens: 6_000, amountUsd: 2070, pnlUsd: 870, source: 'AUTO_SELL' },
      { positionId: closed.id, side: TradeSide.SELL, priceUsd: closedToken.priceUsd * 1.1, amountTokens: 4_000, amountUsd: 1580, pnlUsd: 580, source: 'TRAILING_STOP' },
    ],
  });
  await prisma.reserveLedger.create({
    data: { walletId: wallet.id, amountUsd: 725, reason: 'Daily profit lock (50% of $1,450 realized)' },
  });

  // ── Whale wallets + transfers ──
  for (let i = 0; i < 4; i++) {
    const whale = await prisma.whaleWallet.create({
      data: { address: addr(), label: `Whale ${i + 1}`, winRate: 50 + Math.random() * 40, totalPnlUsd: Math.random() * 500_000 },
    });
    const token = tokens[Math.floor(Math.random() * tokens.length)]!;
    await prisma.whaleTransfer.create({
      data: {
        whaleId: whale.id,
        tokenId: token.id,
        txHash: addr(),
        side: Math.random() < 0.6 ? TradeSide.BUY : TradeSide.SELL,
        amountUsd: 30_000 + Math.random() * 200_000,
        amountTokens: 100000,
        timestamp: new Date(Date.now() - Math.random() * 6 * 3_600_000),
      },
    });
  }

  // ── Smart money wallets + trades ──
  for (let i = 0; i < 5; i++) {
    const sw = await prisma.smartWallet.create({
      data: {
        address: addr(),
        label: `Smart ${i + 1}`,
        roiPct: 120 + Math.random() * 900,
        winRate: 60 + Math.random() * 35,
        totalPnlUsd: 50_000 + Math.random() * 1_000_000,
      },
    });
    const token = tokens[Math.floor(Math.random() * tokens.length)]!;
    await prisma.smartTrade.create({
      data: {
        walletId: sw.id,
        tokenId: token.id,
        side: TradeSide.BUY,
        amountUsd: 5_000 + Math.random() * 50_000,
        priceUsd: token.priceUsd * (0.7 + Math.random() * 0.3),
        timestamp: new Date(Date.now() - Math.random() * 12 * 3_600_000),
      },
    });
  }

  // ── Watchlist + journal ──
  await prisma.watchlistItem.create({
    data: { userId: owner.id, tokenId: tokens[2]!.id, section: 'FAVORITES', note: 'Strong holder growth' },
  });
  await prisma.watchlistItem.create({
    data: { userId: owner.id, tokenId: tokens[3]!.id, section: 'TRENDING' },
  });
  await prisma.journalEntry.create({
    data: {
      userId: owner.id,
      tokenSymbol: closedToken.symbol,
      entryReason: 'Smart money accumulation + volume breakout',
      exitReason: 'Hit +100% auto-sell ladder, trailing stop closed remainder',
      lesson: 'Laddered exits captured the move without timing the top.',
      pnlUsd: 1450,
      pnlPct: 72.5,
    },
  });

  console.log('✅ Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
