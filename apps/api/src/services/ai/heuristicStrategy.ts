import { ReportType, type AiReportPayload, type SignalBundle } from '@memeforge/shared';
import type { AiStrategy, BrainContext } from './strategy.js';

const usd = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

/**
 * HeuristicStrategy — transparent, fully-offline rule-based reasoning. It turns
 * the aggregated signal context into structured, explainable reports. This is
 * the default and also the guaranteed fallback for the Anthropic strategy.
 */
export class HeuristicStrategy implements AiStrategy {
  readonly name = 'heuristic';

  async generateReport(type: ReportType, ctx: BrainContext): Promise<AiReportPayload> {
    switch (type) {
      case ReportType.DAILY:
        return this.daily(ctx);
      case ReportType.WEEKLY:
        return this.weekly(ctx);
      case ReportType.MARKET:
        return this.market(ctx);
      case ReportType.RISK:
        return this.risk(ctx);
      case ReportType.OPPORTUNITY:
        return this.opportunity(ctx);
      default:
        return this.daily(ctx);
    }
  }

  private daily(ctx: BrainContext): AiReportPayload {
    const sections = [
      {
        heading: 'Portfolio',
        body: `Value ${usd(ctx.portfolioValueUsd)} · Daily PnL ${usd(ctx.dailyPnlUsd)} · ${ctx.openPositions} open positions.`,
      },
      {
        heading: 'Performers',
        body: '',
        bullets: [
          ctx.bestPerformer ? `Best: ${ctx.bestPerformer.symbol} (${pct(ctx.bestPerformer.pct)})` : 'Best: n/a',
          ctx.worstPerformer ? `Worst: ${ctx.worstPerformer.symbol} (${pct(ctx.worstPerformer.pct)})` : 'Worst: n/a',
        ],
      },
      {
        heading: 'AI observations',
        body: this.observations(ctx),
      },
    ];
    return this.wrap(ReportType.DAILY, 'Daily Report', `Net ${pct((ctx.dailyPnlUsd / Math.max(ctx.portfolioValueUsd, 1)) * 100)} on the day.`, sections);
  }

  private weekly(ctx: BrainContext): AiReportPayload {
    const sections = [
      { heading: 'Portfolio health', body: `Value ${usd(ctx.portfolioValueUsd)} · Total PnL ${usd(ctx.totalPnlUsd)}.` },
      {
        heading: 'Biggest win / mistake',
        body: '',
        bullets: [
          ctx.bestPerformer ? `Win: ${ctx.bestPerformer.symbol} ${pct(ctx.bestPerformer.pct)}` : 'Win: n/a',
          ctx.worstPerformer ? `Watch: ${ctx.worstPerformer.symbol} ${pct(ctx.worstPerformer.pct)} — consider tightening stops` : 'Watch: n/a',
        ],
      },
      {
        heading: 'Opportunity report',
        body: '',
        bullets: ctx.topOpportunities.slice(0, 5).map((o) => `${o.symbol}: opp ${o.opportunity}/100, risk ${o.risk}/100`),
      },
    ];
    return this.wrap(ReportType.WEEKLY, 'Weekly Report', 'Weekly portfolio health & opportunity review.', sections);
  }

  private market(ctx: BrainContext): AiReportPayload {
    return this.wrap(ReportType.MARKET, 'Market Summary', 'Current market activity across tracked tokens.', [
      {
        heading: 'Whale activity',
        body: '',
        bullets: ctx.whaleActivity.slice(0, 6).map((w) => `${w.side} ${w.symbol} ${usd(w.amountUsd)}`),
      },
      {
        heading: 'Top opportunities',
        body: '',
        bullets: ctx.topOpportunities.slice(0, 6).map((o) => `${o.symbol} — opportunity ${o.opportunity}/100`),
      },
    ]);
  }

  private risk(ctx: BrainContext): AiReportPayload {
    return this.wrap(ReportType.RISK, 'Risk Summary', `${ctx.riskFlags.length} active risk flags.`, [
      {
        heading: 'Flags',
        body: ctx.riskFlags.length ? '' : 'No elevated risks detected across holdings.',
        bullets: ctx.riskFlags.slice(0, 10).map((r) => `[${r.level}] ${r.symbol}: ${r.message}`),
      },
    ]);
  }

  private opportunity(ctx: BrainContext): AiReportPayload {
    return this.wrap(ReportType.OPPORTUNITY, 'Opportunity Summary', 'Highest-scoring opportunities right now.', [
      {
        heading: 'Ranked opportunities',
        body: '',
        bullets: ctx.topOpportunities.map((o) => `${o.symbol}: opportunity ${o.opportunity}/100 · risk ${o.risk}/100`),
      },
    ]);
  }

  private observations(ctx: BrainContext): string {
    const obs: string[] = [];
    if (ctx.dailyPnlUsd > 0) obs.push('Portfolio is green today — consider taking partial profits on extended runners.');
    else if (ctx.dailyPnlUsd < 0) obs.push('Drawdown today — verify trailing stops are armed on winners.');
    if (ctx.whaleActivity.some((w) => w.side === 'SELL')) obs.push('Whale distribution detected on some tokens — watch for momentum loss.');
    if (ctx.riskFlags.length) obs.push(`${ctx.riskFlags.length} holdings carry elevated risk flags.`);
    if (!obs.length) obs.push('Conditions are stable. No urgent action required.');
    return obs.join(' ');
  }

  private wrap(type: ReportType, title: string, summary: string, sections: AiReportPayload['sections']): AiReportPayload {
    return { type, title, summary, sections, generatedAt: new Date().toISOString() };
  }

  async explainMove(direction: 'up' | 'down', s: SignalBundle): Promise<string[]> {
    const reasons: string[] = [];
    if (direction === 'up') {
      if (s.whaleNetUsd > 5000) reasons.push('🐋 Whale accumulation detected');
      if (s.volumeTrend >= 3) reasons.push(`📊 Volume spike (${s.volumeTrend.toFixed(1)}x average)`);
      if (s.socialScore >= 70) reasons.push('💬 Rising social activity');
      if (s.token.priceChange1h > 10) reasons.push('🔥 Trending — strong short-term momentum');
      if (s.smartMoneyActive) reasons.push('🧠 Smart money entry observed');
      if (s.holderGrowth24h > 5) reasons.push('👥 Accelerating holder growth');
      if (!reasons.length) reasons.push('Broad market strength / general buying pressure');
    } else {
      if (s.whaleNetUsd < -5000) reasons.push('🐋 Whale selling / distribution');
      if (s.volumeTrend < 1) reasons.push('📉 Liquidity & volume reduction');
      if (s.token.priceChange1h < -8) reasons.push('⚡ Momentum loss — sharp short-term reversal');
      if (s.socialScore < 40) reasons.push('💬 Fading social interest');
      if (s.smartMoneyActive === false && s.token.priceChange24h < 0) reasons.push('🏚 General market weakness');
      if (!reasons.length) reasons.push('Profit-taking after a recent run-up');
    }
    return reasons;
  }
}
