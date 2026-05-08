import { ChartNoAxesColumnIncreasing, Star } from "lucide-react";
import type { ReactNode } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Locale, UiMessages } from "../i18n";
import {
  formatCurrencyAxis,
  formatSignedNumber,
  formatCurrency,
  getInputRateParts,
  getModelDisplayName,
  type VersionCostMetrics,
} from "../lib/costEstimator";
import type { UsdKrwExchangeRate } from "../lib/exchangeRate";
import { getCommitMemo } from "../lib/promptVersions";
import type { PromptVersion } from "../types";

const getSignedClass = (value: number) =>
  value > 0 ? "up" : value < 0 ? "down" : "flat";

const renderModelCode = (modelId: string) => (
  <code className="cost-model-code" title={modelId}>
    {getModelDisplayName(modelId)}
  </code>
);

type CostChartDotProps = {
  cx?: number;
  cy?: number;
  payload?: { isGoodResult?: boolean };
};

const CostChartDot = ({ cx, cy, payload }: CostChartDotProps) => {
  if (typeof cx !== "number" || typeof cy !== "number") {
    return null;
  }

  if (payload?.isGoodResult) {
    return (
      <g transform={`translate(${cx}, ${cy})`} className="trend-chart-good-dot">
        <circle r={7} />
        <Star
          aria-hidden="true"
          fill="currentColor"
          height={10}
          viewBox="0 0 24 24"
          width={10}
          x={-5}
          y={-5}
        />
      </g>
    );
  }

  return <circle className="trend-chart-dot" cx={cx} cy={cy} r={4} />;
};

const hasModelChanges = (metrics: VersionCostMetrics) =>
  metrics.modelAddedIds.length > 0 || metrics.modelRemovedIds.length > 0;

const renderModelChanges = (metrics: VersionCostMetrics, ui: UiMessages) => {
  if (!hasModelChanges(metrics)) {
    return null;
  }

  return (
    <div className="model-change-list">
      <span>{ui.model}</span>
      {metrics.modelAddedIds.map((modelId) => (
        <code className="model-change up" key={`add-${modelId}`} title={modelId}>
          + {getModelDisplayName(modelId)}
        </code>
      ))}
      {metrics.modelRemovedIds.map((modelId) => (
        <code className="model-change down" key={`remove-${modelId}`} title={modelId}>
          - {getModelDisplayName(modelId)}
        </code>
      ))}
    </div>
  );
};

const renderCostFormula = (
  metrics: VersionCostMetrics,
  ui: UiMessages,
  locale: Locale,
  usdKrwRate?: number | null,
) => {
  const parts = metrics.modelCostItems.map<ReactNode>((item) => {
    const cost = formatCurrency(item.costUsd, locale, usdKrwRate);
    const inputRate = item.type === "input" ? getInputRateParts(item) : null;
    const inputRatePrice = inputRate
      ? formatCurrency(inputRate.inputPriceUsd, locale, usdKrwRate)
      : formatCurrency(0, locale, usdKrwRate);

    return (
      <span className="cost-formula-item" key={`${item.modelId}-${item.type}-${item.role}`}>
        {renderModelCode(item.modelId)}
        <span>
          {item.type === "image"
            ? ui.modelImageCostText((item.imageCount ?? 0).toLocaleString(), cost)
            : ui.modelInputCostText(
                (item.tokenCount ?? 0).toLocaleString(),
                inputRatePrice,
                (inputRate?.inputTokenUnitInTenThousands ?? 100).toLocaleString(),
                cost,
              )}
        </span>
      </span>
    );
  });

  if (parts.length === 0) {
    return <span>{ui.noSelectedModels}</span>;
  }

  return (
    <span className="cost-formula">
      {parts.map((part, index) => (
        <span className="cost-formula-part" key={index}>
          {index > 0 ? <span className="cost-formula-plus">+</span> : null}
          {part}
        </span>
      ))}
      <span className="cost-formula-equals">=</span>
      <strong>{formatCurrency(metrics.totalCostUsd, locale, usdKrwRate)}</strong>
    </span>
  );
};

type CostTrendPanelProps = {
  activeCostLabel: string;
  currentMetrics: VersionCostMetrics;
  exchangeRate: UsdKrwExchangeRate | null;
  includeDraftInTopicUsage: boolean;
  locale: Locale;
  metricsByVersion: Record<string, VersionCostMetrics>;
  topicVersions: PromptVersion[];
  ui: UiMessages;
};

type TopicUsageSummary = {
  inputTokens: number;
  promptChars: number;
  promptTokens: number;
  resultChars: number;
  resultCount: number;
  runCount: number;
  totalCostUsd: number;
};

const emptyTopicUsage: TopicUsageSummary = {
  inputTokens: 0,
  promptChars: 0,
  promptTokens: 0,
  resultChars: 0,
  resultCount: 0,
  runCount: 0,
  totalCostUsd: 0,
};

const getCostChartDomain = (costs: number[]): [number, number] => {
  const validCosts = costs.filter((cost) => Number.isFinite(cost));
  if (validCosts.length === 0) {
    return [0, 1];
  }

  const minCost = Math.min(...validCosts);
  const maxCost = Math.max(...validCosts);
  const spread = maxCost - minCost;
  if (spread > 0) {
    const padding = spread * 0.25;

    return [Math.max(0, minCost - padding), maxCost + padding];
  }

  const fallbackPadding = Math.max(Math.abs(minCost) * 0.05, 0.000001);

  return [Math.max(0, minCost - fallbackPadding), minCost + fallbackPadding];
};

const addMetricsToTopicUsage = (
  summary: TopicUsageSummary,
  metrics: VersionCostMetrics,
) => {
  const resultCount = metrics.resultCount;
  const billableRuns = Math.max(1, resultCount);

  return {
    inputTokens: summary.inputTokens + metrics.inputTokens * billableRuns,
    promptChars: summary.promptChars + metrics.promptChars,
    promptTokens: summary.promptTokens + metrics.promptTokens,
    resultChars: summary.resultChars + metrics.resultChars,
    resultCount: summary.resultCount + resultCount,
    runCount: summary.runCount + 1,
    totalCostUsd: summary.totalCostUsd + metrics.totalCostUsd * billableRuns,
  };
};

export function CostTrendPanel({
  activeCostLabel,
  currentMetrics,
  exchangeRate,
  includeDraftInTopicUsage,
  locale,
  metricsByVersion,
  topicVersions,
  ui,
}: CostTrendPanelProps) {
  const usdKrwRate = exchangeRate?.rate ?? null;
  const formatCost = (valueUsd: number) =>
    formatCurrency(valueUsd, locale, usdKrwRate);
  const formatAxisCost = (valueUsd: number) =>
    formatCurrencyAxis(valueUsd, locale, usdKrwRate);
  const trendRows = topicVersions
    .map((version) => ({ metrics: metricsByVersion[version.id], version }))
    .filter((row): row is { metrics: VersionCostMetrics; version: PromptVersion } =>
      Boolean(row.metrics),
    );
  const savedTopicUsage = trendRows.reduce(
    (summary, row) => addMetricsToTopicUsage(summary, row.metrics),
    emptyTopicUsage,
  );
  const topicUsage = includeDraftInTopicUsage
    ? addMetricsToTopicUsage(savedTopicUsage, currentMetrics)
    : savedTopicUsage;
  const firstTrackedMetrics =
    trendRows[0]?.metrics ?? (includeDraftInTopicUsage ? currentMetrics : null);
  const latestTrackedMetrics = includeDraftInTopicUsage
    ? currentMetrics
    : (trendRows[trendRows.length - 1]?.metrics ?? null);
  const hasImprovementDelta =
    Boolean(firstTrackedMetrics && latestTrackedMetrics) && topicUsage.runCount > 1;
  const promptCharDelta =
    firstTrackedMetrics && latestTrackedMetrics
      ? latestTrackedMetrics.promptChars - firstTrackedMetrics.promptChars
      : 0;
  const promptTokenDelta =
    firstTrackedMetrics && latestTrackedMetrics
      ? latestTrackedMetrics.promptTokens - firstTrackedMetrics.promptTokens
      : 0;
  const latestTrendRows = [...trendRows].reverse();
  const maxCost = Math.max(
    0.000001,
    ...trendRows.map((row) => row.metrics.totalCostUsd),
  );
  const chartData = trendRows.map(({ metrics, version }, index) => ({
    cost: metrics.totalCostUsd,
    isGoodResult: Boolean(version.isGoodResult),
    label: version.label,
    order: index + 1,
    tokens: metrics.inputTokens,
  }));
  const costChartDomain = getCostChartDomain(
    chartData.map((item) => item.cost),
  );

  return (
    <section className="panel cost-panel">
      <section className="cost-section">
        <div className="panel-heading">
          <h3>{ui.singleRequestCost}</h3>
        </div>

        <article className="current-cost-card">
          <div>
            <strong>{activeCostLabel}</strong>
            <span>{renderCostFormula(currentMetrics, ui, locale, usdKrwRate)}</span>
          </div>
          <div className="current-cost-metrics">
            <span>
              {ui.changeDelta(
                currentMetrics.promptChars.toLocaleString(),
                currentMetrics.promptTokens.toLocaleString(),
              )}
            </span>
          </div>
          {renderModelChanges(currentMetrics, ui)}
        </article>

        <div className="cost-note">
          <span>{ui.costEstimateNote}</span>
          {locale === "ko" && exchangeRate ? (
            <span>
              {exchangeRate.fallback
                ? ui.exchangeRateFallbackInfo(
                    exchangeRate.rate.toLocaleString("ko-KR", {
                      maximumFractionDigits: 2,
                    }),
                  )
                : ui.exchangeRateInfo(
                    exchangeRate.rate.toLocaleString("ko-KR", {
                      maximumFractionDigits: 2,
                    }),
                    exchangeRate.date,
                  )}
            </span>
          ) : null}
        </div>

        <div className="trend-card">
          <div className="trend-card-title">
            <ChartNoAxesColumnIncreasing aria-hidden="true" size={16} />
            <span>{ui.estimatedCostTrend}</span>
          </div>
          {trendRows.length > 0 ? (
            <>
              <div className="trend-chart" aria-label={ui.estimatedCostTrend}>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={chartData} margin={{ left: 8, right: 18, top: 18, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                    />
                    <YAxis
                      domain={costChartDomain}
                      tickLine={false}
                      axisLine={false}
                      width={86}
                      tickFormatter={(value) => formatAxisCost(Number(value))}
                    />
                    <Tooltip
                      formatter={(value, name) =>
                        name === "cost"
                          ? [formatCost(Number(value)), ui.costTab]
                          : [Number(value).toLocaleString(), String(name)]
                      }
                      labelFormatter={(label) => String(label)}
                    />
                    <Line
                      type="monotone"
                      dataKey="cost"
                      stroke="#2f80ed"
                      strokeWidth={3}
                      dot={<CostChartDot />}
                      activeDot={<CostChartDot />}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="trend-list">
                {latestTrendRows.map(({ metrics, version }) => {
                  const barWidth = `${Math.max(4, (metrics.totalCostUsd / maxCost) * 100)}%`;
                  const changeClass = getSignedClass(metrics.charDelta || metrics.tokenDelta);

                  return (
                    <article key={version.id} className="trend-row">
                      <div className="trend-row-head">
                        <div>
                          <strong>
                            {version.isGoodResult ? (
                              <Star
                                aria-label={ui.goodResult}
                                className="trend-version-star"
                                fill="currentColor"
                                size={13}
                              />
                            ) : null}
                            {version.label}
                          </strong>
                          <span>
                            {getCommitMemo(version.notes, ui.commitMemoFallback)}
                          </span>
                        </div>
                        <b>{formatCost(metrics.totalCostUsd)}</b>
                      </div>
                      <div className="trend-cost-formula">
                        {renderCostFormula(metrics, ui, locale, usdKrwRate)}
                      </div>
                      <div className="trend-bar-track">
                        <span
                          className="trend-bar"
                          style={{ width: barWidth }}
                        />
                      </div>
                      <div className="trend-metrics">
                        <span>
                          {ui.changeDelta(
                            metrics.promptChars.toLocaleString(),
                            metrics.promptTokens.toLocaleString(),
                          )}
                        </span>
                        <span className={changeClass}>
                          {ui.changeDelta(
                            formatSignedNumber(metrics.charDelta),
                            formatSignedNumber(metrics.tokenDelta),
                          )}
                        </span>
                      </div>
                      {renderModelChanges(metrics, ui)}
                    </article>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="empty-commit-log">{ui.noTrendData}</div>
          )}
        </div>
      </section>

      <section className="cost-section">
        <div className="panel-heading">
          <h3>{ui.overallStats}</h3>
        </div>

        <article className="topic-usage-card">
          <div className="topic-usage-main">
            <div>
              <strong>{ui.topicTestUsage}</strong>
              <span>
                {includeDraftInTopicUsage
                  ? ui.topicUsageIncludingDraft
                  : ui.topicUsageSavedOnly}
              </span>
            </div>
            <b>{formatCost(topicUsage.totalCostUsd)}</b>
          </div>
          <div className="topic-usage-metrics">
            <span>{ui.topicUsageTests(topicUsage.runCount.toLocaleString())}</span>
            <span>{ui.topicUsageResults(topicUsage.resultCount.toLocaleString())}</span>
            <span>
              {ui.topicUsageInputTokens(topicUsage.inputTokens.toLocaleString())}
            </span>
            <span>{ui.topicUsagePromptChars(topicUsage.promptChars.toLocaleString())}</span>
            {topicUsage.resultChars > 0 ? (
              <span>{ui.topicUsageResultChars(topicUsage.resultChars.toLocaleString())}</span>
            ) : null}
          </div>
          {hasImprovementDelta ? (
            <div className="topic-improvement-metrics">
              <span>{ui.topicImprovementFromFirst}</span>
              <span className={getSignedClass(promptCharDelta || promptTokenDelta)}>
                {ui.changeDelta(
                  formatSignedNumber(promptCharDelta),
                  formatSignedNumber(promptTokenDelta),
                )}
              </span>
            </div>
          ) : null}
        </article>
      </section>
    </section>
  );
}
