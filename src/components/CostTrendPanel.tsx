import { ChartNoAxesColumnIncreasing } from "lucide-react";
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
  formatSignedNumber,
  formatCurrency,
  formatSignedCurrency,
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

    return (
      <span className="cost-formula-item" key={`${item.modelId}-${item.type}-${item.role}`}>
        {renderModelCode(item.modelId)}
        <span>
          {item.type === "image"
            ? ui.modelImageCostText((item.imageCount ?? 0).toLocaleString(), cost)
            : ui.modelInputCostText((item.tokenCount ?? 0).toLocaleString(), cost)}
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
  currentMetrics: VersionCostMetrics;
  exchangeRate: UsdKrwExchangeRate | null;
  locale: Locale;
  metricsByVersion: Record<string, VersionCostMetrics>;
  topicVersions: PromptVersion[];
  ui: UiMessages;
};

export function CostTrendPanel({
  currentMetrics,
  exchangeRate,
  locale,
  metricsByVersion,
  topicVersions,
  ui,
}: CostTrendPanelProps) {
  const usdKrwRate = exchangeRate?.rate ?? null;
  const formatCost = (valueUsd: number) =>
    formatCurrency(valueUsd, locale, usdKrwRate);
  const formatSignedCost = (valueUsd: number) =>
    formatSignedCurrency(valueUsd, locale, usdKrwRate);
  const trendRows = topicVersions
    .map((version) => ({ metrics: metricsByVersion[version.id], version }))
    .filter((row): row is { metrics: VersionCostMetrics; version: PromptVersion } =>
      Boolean(row.metrics),
    );
  const latestTrendRows = [...trendRows].reverse();
  const maxCost = Math.max(
    0.000001,
    ...trendRows.map((row) => row.metrics.totalCostUsd),
  );
  const chartData = trendRows.map(({ metrics, version }, index) => ({
    cost: metrics.totalCostUsd,
    label: version.label,
    order: index + 1,
    tokens: metrics.promptTokens,
  }));

  return (
    <section className="panel cost-panel">
      <div className="panel-heading">
        <h3>{ui.estimatedCostTrend}</h3>
      </div>

      <article className="current-cost-card">
        <div>
          <strong>{ui.currentDraftEstimate}</strong>
          <span>{renderCostFormula(currentMetrics, ui, locale, usdKrwRate)}</span>
        </div>
        <div className="current-cost-metrics">
          <span>
            {ui.changeDelta(
              currentMetrics.promptChars.toLocaleString(),
              currentMetrics.promptTokens.toLocaleString(),
            )}
          </span>
          <span className={getSignedClass(currentMetrics.costDeltaUsd)}>
            {ui.costDelta(formatSignedCost(currentMetrics.costDeltaUsd))}
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
          <span>{ui.versionTrend}</span>
        </div>
        {trendRows.length > 0 ? (
          <>
            <div className="trend-chart" aria-label={ui.versionTrend}>
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
                    tickLine={false}
                    axisLine={false}
                    width={72}
                    tickFormatter={(value) => formatCost(Number(value))}
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
                    dot={{ r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="trend-list">
              {latestTrendRows.map(({ metrics, version }) => {
                const barWidth = `${Math.max(4, (metrics.totalCostUsd / maxCost) * 100)}%`;
                const directionClass = getSignedClass(metrics.costDeltaUsd);

                return (
                  <article key={version.id} className="trend-row">
                    <div className="trend-row-head">
                      <div>
                        <strong>{version.label}</strong>
                        <span>{getCommitMemo(version.notes, ui.commitMemoFallback)}</span>
                      </div>
                      <b>{formatCost(metrics.totalCostUsd)}</b>
                    </div>
                    <div className="trend-cost-formula">
                      {renderCostFormula(metrics, ui, locale, usdKrwRate)}
                    </div>
                    <div className="trend-bar-track">
                      <span
                        className={`trend-bar ${directionClass}`}
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
                      <span className={directionClass}>
                        {ui.costDelta(formatSignedCost(metrics.costDeltaUsd))}
                      </span>
                      <span className={getSignedClass(metrics.charDelta || metrics.tokenDelta)}>
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
  );
}
