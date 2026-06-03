import { ReportType, type AiReportPayload, type SignalBundle } from '@memeforge/shared';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import type { AiStrategy, BrainContext } from './strategy.js';
import { HeuristicStrategy } from './heuristicStrategy.js';

/**
 * AnthropicStrategy — sends the aggregated signal context to the Claude API for
 * richer natural-language synthesis. The heuristic strategy is always used as a
 * structural scaffold + guaranteed fallback so the platform never hard-fails on
 * an AI outage or missing key.
 */
export class AnthropicStrategy implements AiStrategy {
  readonly name = 'anthropic';
  private fallback = new HeuristicStrategy();

  async generateReport(type: ReportType, ctx: BrainContext): Promise<AiReportPayload> {
    const base = await this.fallback.generateReport(type, ctx);
    if (!env.ai.anthropicApiKey) return base;
    try {
      const prose = await this.complete(
        `You are MemeForge's market analyst. Write a concise, professional ${type} report for a single crypto portfolio owner. ` +
          `Be direct and risk-aware. Never recommend buying. Context JSON:\n${JSON.stringify(ctx)}`,
      );
      if (prose) base.summary = prose;
    } catch (err) {
      logger.warn({ err }, 'Anthropic report failed — using heuristic');
    }
    return base;
  }

  async explainMove(direction: 'up' | 'down', signals: SignalBundle): Promise<string[]> {
    const base = await this.fallback.explainMove(direction, signals);
    if (!env.ai.anthropicApiKey) return base;
    try {
      const prose = await this.complete(
        `In 3-5 short bullet points, explain why the token ${signals.token.symbol} is ${direction}. ` +
          `Use only these signals, do not invent data: ${JSON.stringify(signals)}. Return bullets separated by newlines.`,
      );
      if (prose) return prose.split('\n').map((l) => l.replace(/^[-•*]\s*/, '').trim()).filter(Boolean);
    } catch (err) {
      logger.warn({ err }, 'Anthropic explainMove failed — using heuristic');
    }
    return base;
  }

  private async complete(prompt: string): Promise<string | null> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ai.anthropicApiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: env.ai.model,
        max_tokens: 700,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { content?: Array<{ text?: string }> };
    return json.content?.map((c) => c.text ?? '').join('').trim() ?? null;
  }
}
