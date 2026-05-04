import { ChevronDown, CircleDot, GitBranch } from "lucide-react";
import type { PromptVersion, Topic } from "../types";
import type { Locale, UiMessages } from "../i18n";
import {
  formatSignedNumber,
  formatSignedCurrency,
  getModelDisplayName,
  type VersionCostMetrics,
} from "../lib/costEstimator";
import { getCommitMemo } from "../lib/promptVersions";

const getSignedClass = (value: number) =>
  value > 0 ? "up" : value < 0 ? "down" : "flat";

const hasModelChanges = (metrics: VersionCostMetrics) =>
  metrics.modelAddedIds.length > 0 || metrics.modelRemovedIds.length > 0;

type HistoryGraphProps = {
  activeVersionId: string;
  draftNotes: string;
  hasDraftChanges: boolean;
  selectedTopic: Topic | null;
  topicVersions: PromptVersion[];
  locale: Locale;
  metricsByVersion: Record<string, VersionCostMetrics>;
  ui: UiMessages;
  usdKrwRate?: number | null;
  onCheckout: (version: PromptVersion) => void;
  onCherryPick: (version: PromptVersion) => void;
  onDelete: (versionId: string) => void;
  onOpenDraftDiff: () => void;
  onOpenVersionDiff: (versionId: string) => void;
};

export function HistoryGraph({
  activeVersionId,
  draftNotes,
  hasDraftChanges,
  selectedTopic,
  topicVersions,
  locale,
  metricsByVersion,
  ui,
  usdKrwRate,
  onCheckout,
  onCherryPick,
  onDelete,
  onOpenDraftDiff,
  onOpenVersionDiff,
}: HistoryGraphProps) {
  if (!selectedTopic) {
    return (
      <section className="sidebar-history empty-sidebar-history">
        <GitBranch aria-hidden="true" size={18} />
        <span>{ui.selectTopic}</span>
      </section>
    );
  }

  return (
    <section className="sidebar-history">
      <div className="graph-header">
        <div className="graph-title">
          <ChevronDown aria-hidden="true" size={13} />
          <span>{ui.graph}</span>
        </div>
      </div>
      <div className="git-graph" aria-label={ui.graph}>
        {activeVersionId === "draft" && hasDraftChanges ? (
          <article className="graph-row draft active">
            <div className="graph-rail">
              <span className="graph-node open" />
              <span className="graph-line" />
            </div>
            <div className="graph-content">
              <div className="graph-line-row">
                <button
                  type="button"
                  className="graph-message"
                  onClick={onOpenDraftDiff}
                >
                  {ui.draftMessage}
                </button>
                <span className="branch-pill">
                  <CircleDot aria-hidden="true" size={14} />
                  {ui.currentVersion}
                </span>
              </div>
              <div className="graph-subline">
                {draftNotes.trim() || ui.draftUnsavedChanges}
              </div>
            </div>
          </article>
        ) : null}

        {[...topicVersions]
          .reverse()
          .map((version, index, reversedVersions) => {
            const isActive = version.id === activeVersionId;
            const isLatest =
              index === 0 && !(activeVersionId === "draft" && hasDraftChanges);
            const metrics = metricsByVersion[version.id];
            return (
              <article
                key={version.id}
                className={`graph-row ${isActive ? "active" : ""}`}
              >
                <div className="graph-rail">
                  <span
                    className={`graph-line top ${isLatest ? "hidden" : ""}`}
                  />
                  <span className="graph-node filled" />
                  <span
                    className={`graph-line bottom ${
                      index === reversedVersions.length - 1 ? "hidden" : ""
                    }`}
                  />
                </div>
                <div className="graph-content">
                  <div className="graph-line-row">
                    <button
                      type="button"
                      className="graph-message"
                      onClick={() => onOpenVersionDiff(version.id)}
                    >
                      {version.label}
                    </button>
                    {isLatest ? (
                      <span className="branch-pill">
                        <CircleDot aria-hidden="true" size={14} />
                        {ui.currentVersion}
                      </span>
                    ) : null}
                  </div>
                  <div className="graph-subline">
                    <span>
                      {getCommitMemo(version.notes, ui.commitMemoFallback)}
                    </span>
                  </div>
                  {metrics ? (
                    <>
                      <div className="graph-metrics">
                        <span className={getSignedClass(metrics.charDelta)}>
                          {ui.graphChars(formatSignedNumber(metrics.charDelta))}
                        </span>
                        <span className={getSignedClass(metrics.tokenDelta)}>
                          {ui.graphTokens(formatSignedNumber(metrics.tokenDelta))}
                        </span>
                        <span className={getSignedClass(metrics.costDeltaUsd)}>
                          {ui.graphCost(formatSignedCurrency(metrics.costDeltaUsd, locale, usdKrwRate))}
                        </span>
                      </div>
                      {hasModelChanges(metrics) ? (
                        <div className="model-change-list compact">
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
                      ) : null}
                    </>
                  ) : null}
                  <div className="graph-actions">
                    <button type="button" onClick={() => onCheckout(version)}>
                      {ui.checkout}
                    </button>
                    <button type="button" onClick={() => onCherryPick(version)}>
                      {ui.cherryPick}
                    </button>
                    <button type="button" onClick={() => onDelete(version.id)}>
                      {ui.delete}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        {topicVersions.length === 0 ? (
          <div className="empty-commit-log">{ui.emptyCommitLog}</div>
        ) : null}
      </div>
    </section>
  );
}
