import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { api } from './api.js';

const ACCENT = 0x8b5cf6;
const usd = (n: number) => `$${Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${(n ?? 0) >= 0 ? '🟢 +' : '🔴 '}${Number(n ?? 0).toFixed(1)}%`;

export const commandDefs = [
  new SlashCommandBuilder().setName('portfolio').setDescription('Show portfolio value & PnL'),
  new SlashCommandBuilder().setName('pnl').setDescription('Show PnL across timeframes'),
  new SlashCommandBuilder().setName('watchlist').setDescription('Show your watchlist'),
  new SlashCommandBuilder().setName('alerts').setDescription('Show active alerts'),
  new SlashCommandBuilder().setName('trending').setDescription('Show trending tokens'),
  new SlashCommandBuilder().setName('whales').setDescription('Show recent whale activity'),
  new SlashCommandBuilder().setName('report').setDescription('Generate an AI report')
    .addStringOption((o) =>
      o.setName('type').setDescription('Report type').addChoices(
        { name: 'daily', value: 'DAILY' },
        { name: 'weekly', value: 'WEEKLY' },
        { name: 'market', value: 'MARKET' },
        { name: 'risk', value: 'RISK' },
        { name: 'opportunity', value: 'OPPORTUNITY' },
      ),
    ),
  new SlashCommandBuilder().setName('market').setDescription('Market summary'),
  new SlashCommandBuilder().setName('opportunities').setDescription('Top scored opportunities'),
].map((c) => c.toJSON());

export async function handleCommand(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();
  const embed = new EmbedBuilder().setColor(ACCENT).setTimestamp().setFooter({ text: 'MemeForge' });

  switch (interaction.commandName) {
    case 'portfolio': {
      const s = await api.portfolioSummary();
      if (!s) return void interaction.editReply('⚠️ API unavailable or not authenticated.');
      embed.setTitle('🔥 Portfolio').addFields(
        { name: 'Value', value: usd(s.totalValueUsd), inline: true },
        { name: 'Reserve', value: usd(s.reserveUsd), inline: true },
        { name: 'Total PnL', value: `${usd(s.pnl.totalUsd)} (${pct(s.pnl.totalPct)})`, inline: false },
        { name: 'Open', value: String(s.openPositions), inline: true },
        { name: 'Closed', value: String(s.closedPositions), inline: true },
      );
      return void interaction.editReply({ embeds: [embed] });
    }
    case 'pnl': {
      const s = await api.portfolioSummary();
      if (!s) return void interaction.editReply('⚠️ API unavailable.');
      embed.setTitle('📊 PnL').addFields(
        { name: 'Daily', value: `${usd(s.pnl.dailyUsd)} (${pct(s.pnl.dailyPct)})`, inline: true },
        { name: 'Weekly', value: `${usd(s.pnl.weeklyUsd)} (${pct(s.pnl.weeklyPct)})`, inline: true },
        { name: 'Monthly', value: `${usd(s.pnl.monthlyUsd)} (${pct(s.pnl.monthlyPct)})`, inline: true },
        { name: 'Total', value: `${usd(s.pnl.totalUsd)} (${pct(s.pnl.totalPct)})`, inline: false },
      );
      return void interaction.editReply({ embeds: [embed] });
    }
    case 'watchlist': {
      const w = await api.watchlist();
      if (!w) return void interaction.editReply('⚠️ API unavailable.');
      embed.setTitle('⭐ Watchlist');
      for (const [section, items] of Object.entries(w)) {
        if (items.length) embed.addFields({ name: section, value: items.map((i: any) => `${i.symbol}`).join(', ').slice(0, 1000) });
      }
      return void interaction.editReply({ embeds: [embed] });
    }
    case 'alerts': {
      const a = await api.alerts();
      if (!a) return void interaction.editReply('⚠️ API unavailable.');
      embed.setTitle('🔔 Active Alerts').setDescription(
        a.filter((x: any) => x.enabled).slice(0, 15).map((x: any) => `• ${x.type} ${x.threshold ?? ''} ${x.token?.symbol ?? 'any'}`).join('\n') || 'No active alerts',
      );
      return void interaction.editReply({ embeds: [embed] });
    }
    case 'trending':
    case 'opportunities': {
      const d = await api.discovery();
      if (!d) return void interaction.editReply('⚠️ API unavailable.');
      embed.setTitle(interaction.commandName === 'trending' ? '🔥 Trending' : '💎 Opportunities').setDescription(
        d.slice(0, 10).map((t: any) => `**${t.symbol}** ${pct(t.priceChange24h)} · opp ${t.scores.opportunity} · risk ${t.scores.risk}`).join('\n'),
      );
      return void interaction.editReply({ embeds: [embed] });
    }
    case 'whales': {
      const wh = await api.whales();
      if (!wh) return void interaction.editReply('⚠️ API unavailable.');
      embed.setTitle('🐋 Whale Activity').setDescription(
        wh.slice(0, 10).map((t: any) => `${t.side === 'BUY' ? '🟢' : '🔴'} **${t.token.symbol}** ${usd(t.amountUsd)}`).join('\n') || 'No recent whale activity',
      );
      return void interaction.editReply({ embeds: [embed] });
    }
    case 'market': {
      const r = await api.generateReport('MARKET');
      if (!r) return void interaction.editReply('⚠️ API unavailable.');
      embed.setTitle(`📈 ${r.payload.title}`).setDescription(r.payload.summary);
      for (const s of r.payload.sections.slice(0, 4)) {
        embed.addFields({ name: s.heading, value: (s.bullets?.join('\n') || s.body || '—').slice(0, 1000) });
      }
      return void interaction.editReply({ embeds: [embed] });
    }
    case 'report': {
      const type = interaction.options.getString('type') ?? 'DAILY';
      const r = await api.generateReport(type);
      if (!r) return void interaction.editReply('⚠️ API unavailable.');
      embed.setTitle(`📋 ${r.payload.title}`).setDescription(r.payload.summary);
      for (const s of r.payload.sections.slice(0, 5)) {
        embed.addFields({ name: s.heading, value: (s.bullets?.join('\n') || s.body || '—').slice(0, 1000) });
      }
      return void interaction.editReply({ embeds: [embed] });
    }
    default:
      return void interaction.editReply('Unknown command.');
  }
}
