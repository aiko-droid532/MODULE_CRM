"use client";

import { useState } from "react";
import styles from "./page.module.css";

type FunnelItem = {
  key: string;
  label: string;
  type: "normal" | "group" | "child";
  statusKeys?: string[];
};

const STAGE_COLORS: Record<string, string> = {
  NEW_LEAD: "#6366f1",
  CLARIFICATION: "#818cf8",
  CALL: "#3b82f6",
  SECOND_CALL: "#2563eb",
  THIRD_CALL: "#1d4ed8",
  CONSULTATION: "#f59e0b",
  PRE_RESERVATION: "#fbbf24",
  RESERVATION: "#f97316",
  CONTRACT_PREPARATION: "#a855f7",
  MEETING: "#8b5cf6",
  CLIENT_CONFIRMATION: "#059669",
  CONTRACT: "#0d9488",
  PAYMENT_CONFIRMED: "#10b981",
  DEAL: "#0ea5e9",
  WAITING_PAYMENT: "#ec4899",
  SUCCESS: "#15803d",
  FAILED: "#ef4444",
  CANCELLED: "#64748b",
};

const STAGE_HIERARCHY: Record<string, number> = {
  NEW_LEAD: 0,
  CLARIFICATION: 1,
  CALL: 2,
  SECOND_CALL: 3,
  THIRD_CALL: 4,
  PRE_RESERVATION: 5,
  RESERVATION: 6,
  CONTRACT_PREPARATION: 7,
  CONSULTATION: 8,
  MEETING: 9,
  CLIENT_CONFIRMATION: 10,
  CONTRACT: 11,
  PAYMENT_CONFIRMED: 12,
  DEAL: 13,
  WAITING_PAYMENT: 14,
  SUCCESS: 15,
  FAILED: 16,
  CANCELLED: 17,
};

// Для CANCELLED/FAILED ранг в STAGE_HIERARCHY (16/17) существует только для порядка
// отображения объединённой строки внизу списка — сам по себе он не означает "прошёл
// дальше всех остальных". Поэтому для Conversion View (кумулятивный подсчёт "дошёл ли
// до этого этапа") у отменённых/проваленных сделок берём ранг их предыдущего статуса
// (этап, на котором сделка реально была перед отменой), а не ранг самого CANCELLED/FAILED —
// иначе такие сделки задним числом "проходили" вообще все этапы воронки, включая WON.
function getDealIndex(status: string, previousStatus?: string | null): number {
  if ((status === "FAILED" || status === "CANCELLED") && previousStatus && STAGE_HIERARCHY[previousStatus] !== undefined) {
    return STAGE_HIERARCHY[previousStatus];
  }
  return STAGE_HIERARCHY[status] !== undefined ? STAGE_HIERARCHY[status] : 0;
}

function formatMoney(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(1)}K`;
  return `$${Math.round(amount)}`;
}

function formatDuration(minutes: number): string {
  if (minutes <= 0) return "0 мин.";
  const d = Math.floor(minutes / (24 * 60));
  const h = Math.floor((minutes % (24 * 60)) / 60);
  const m = minutes % 60;
  if (d > 0) return `${d} дн. ${h} ч. ${m} мин.`;
  if (h > 0) return `${h} ч. ${m} мин.`;
  return `${m} мин.`;
}

interface FunnelViewProps {
  structure: FunnelItem[];
  statusData: Record<
    string,
    { count: number; money: number; avgMinutes: number }
  >;
  leadsCount: number;
  deals: any[];
}

export default function FunnelView({
  structure,
  statusData,
  leadsCount,
  deals,
}: FunnelViewProps) {
  const [viewMode, setViewMode] = useState<"pipeline" | "conversion">(
    "pipeline",
  );
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(
    { CALL: true },
  );
  const [selectedStage, setSelectedStage] = useState<FunnelItem | null>(null);

  const toggleGroup = (e: React.MouseEvent, key: string) => {
    e.stopPropagation();
    setExpandedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const openModal = (item: FunnelItem) => {
    setSelectedStage(item);
    setTimeout(() => {
      document
        .getElementById("detail-view")
        ?.scrollIntoView({ behavior: "smooth" });
    }, 100);
  };

  // Фильтр сделок для выбранной плашки
  const filteredDeals = selectedStage
    ? deals.filter((d) => {
        // Объединённая строка Cancelled (FAILED + CANCELLED) — это терминальные статусы,
        // а не этап воронки, поэтому кумулятивный подсчёт "дошёл ли до этапа" к ней не
        // применим ни в одном из режимов — всегда прямое совпадение текущего статуса.
        if (selectedStage.key === "CANCELLED_MERGED" && selectedStage.statusKeys) {
          return selectedStage.statusKeys.includes(d.status);
        }
        if (viewMode === "pipeline") {
          if (selectedStage.type === "group" && selectedStage.statusKeys) {
            return selectedStage.statusKeys.includes(d.status);
          }
          return d.status === selectedStage.key;
        } else {
          if (selectedStage.type === "group" && selectedStage.statusKeys) {
            const firstKey = selectedStage.statusKeys[0];
            const targetIndex = STAGE_HIERARCHY[firstKey] || 0;
            return getDealIndex(d.status, d.previousStatus) >= targetIndex;
          }
          const targetIndex = STAGE_HIERARCHY[selectedStage.key] || 0;
          return getDealIndex(d.status, d.previousStatus) >= targetIndex;
        }
      })
    : [];

  // ---- Функция для рендера одной строки воронки (общая для обычных и объединённой) ----
  const renderFunnelRow = (
    key: string,
    label: string,
    count: number,
    money: number,
    avgTimeMinutes: number,
    color: string,
    isGroup: boolean = false,
    isChild: boolean = false,
    hideTime: boolean = false,
    isFinancialStage: boolean = true,
    onClick: () => void,
    statusKeys?: string[],
  ) => {
    const totalDeals = deals.length;
    const percentage = totalDeals > 0 ? Math.round((count / totalDeals) * 100) : 0;

    return (
      <div
        key={key}
        className={`${styles.funnelRow} ${isGroup ? styles.groupRow : ""} ${isChild ? styles.childRow : ""}`}
        onClick={onClick}
        style={{ cursor: "pointer" }}
      >
        <div
          className={`${styles.statusLabel} ${isGroup ? styles.groupLabel : ""} ${isChild ? styles.childLabel : ""}`}
        >
          {isGroup && (
            <span
              className={styles.expandIcon}
              onClick={(e) => toggleGroup(e, key)}
            >
              {/* иконка при необходимости */}
            </span>
          )}
          <div className={styles.labelMain}>
            <div className={styles.labelText}>
              {isChild && <span className={styles.childConnector}></span>}
              <span>{label}</span>
            </div>
            {!hideTime && (
              <div className={styles.timeBadge} title="Среднее время на этапе">
                {formatDuration(avgTimeMinutes)}
              </div>
            )}
          </div>
        </div>

        <div className={styles.barWrapper}>
          <div
            className={`${styles.funnelBar} ${isGroup ? styles.groupBar : ""}`}
            style={{
              width: `${Math.max(percentage, 10)}%`,
              background:
                count > 0
                  ? `linear-gradient(135deg, ${color}, ${color}cc)`
                  : "#f1f5f9",
              boxShadow: count > 0 ? `0 4px 14px ${color}20` : "none",
              border: count > 0 ? "none" : "1px dashed #cbd5e1",
              borderRadius: "8px",
              transition: "all 400ms ease",
            }}
          >
            <span
              className={styles.barText}
              style={{
                color: count > 0 ? "#ffffff" : "#94a3b8",
                textShadow: count > 0 ? "0 1px 3px rgba(0,0,0,0.25)" : "none",
              }}
            >
              {percentage}%
            </span>
          </div>
        </div>

        <div className={styles.rightInfo}>
          <span className={styles.countLabel}>{count} сделок</span>
          {isFinancialStage ? (
            <span className={styles.moneyLabel} style={{ color }}>
              {formatMoney(money)}
            </span>
          ) : (
            <span
              className={styles.moneyLabel}
              style={{
                color: "#94a3b8",
                fontStyle: "italic",
                fontSize: "0.65rem",
              }}
            >
              без объекта
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Переключатель режимов */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          marginBottom: "24px",
          gap: "8px",
        }}
      >
        <button
          onClick={() => {
            setViewMode("pipeline");
            setSelectedStage(null);
          }}
          style={{
            padding: "10px 24px",
            borderRadius: "12px",
            border: "1px solid #cbd5e1",
            fontWeight: 800,
            fontSize: "0.9rem",
            cursor: "pointer",
            backgroundColor: viewMode === "pipeline" ? "#1e3a8a" : "white",
            color: viewMode === "pipeline" ? "white" : "#64748b",
            boxShadow:
              viewMode === "pipeline"
                ? "0 4px 12px rgba(30, 58, 138, 0.25)"
                : "none",
            transition: "all 0.2s",
          }}
        >
          Pipeline View (Текущие)
        </button>
        <button
          onClick={() => {
            setViewMode("conversion");
            setSelectedStage(null);
          }}
          style={{
            padding: "10px 24px",
            borderRadius: "12px",
            border: "1px solid #cbd5e1",
            fontWeight: 800,
            fontSize: "0.9rem",
            cursor: "pointer",
            backgroundColor: viewMode === "conversion" ? "#10b981" : "white",
            color: viewMode === "conversion" ? "white" : "#64748b",
            boxShadow:
              viewMode === "conversion"
                ? "0 4px 12px rgba(16, 185, 129, 0.25)"
                : "none",
            transition: "all 0.2s",
          }}
        >
          Conversion View (Чистая воронка)
        </button>
      </div>

      <div className={styles.funnelContainer}>
        {/* Основной перебор structure, исключая FAILED и CANCELLED (они будут объединены отдельно) */}
        {structure.map((item) => {
          // Пропускаем статусы, которые будут в объединённой строке
          if (item.key === "FAILED" || item.key === "CANCELLED") return null;

          const isGroup = item.type === "group";
          const isChild = item.type === "child";

          if (isChild) {
            const parent = structure.find(
              (p) => p.type === "group" && p.statusKeys?.includes(item.key),
            );
            if (parent && !expandedGroups[parent.key]) return null;
          }

          let stageDeals: any[] = [];
          if (viewMode === "pipeline") {
            if (isGroup && item.statusKeys) {
              stageDeals = deals.filter((d) =>
                item.statusKeys?.includes(d.status),
              );
            } else {
              stageDeals = deals.filter((d) => d.status === item.key);
            }
          } else {
            if (isGroup && item.statusKeys) {
              const firstKey = item.statusKeys[0];
              const targetIndex = STAGE_HIERARCHY[firstKey] || 0;
              stageDeals = deals.filter(
                (d) => getDealIndex(d.status, d.previousStatus) >= targetIndex,
              );
            } else {
              const targetIndex = STAGE_HIERARCHY[item.key] || 0;
              stageDeals = deals.filter(
                (d) => getDealIndex(d.status, d.previousStatus) >= targetIndex,
              );
            }
          }

          const count = stageDeals.length;
          const money = stageDeals.reduce(
            (sum, d) => sum + (d.unit?.price || 0),
            0,
          );
          const totalMins = stageDeals.reduce((sum, d) => {
            const diff = new Date().getTime() - new Date(d.updatedAt).getTime();
            return sum + Math.floor(diff / (1000 * 60));
          }, 0);
          const avgTimeMinutes = count > 0 ? Math.floor(totalMins / count) : 0;
          const color = STAGE_COLORS[item.key] || "#6366f1";
          const currentRank = STAGE_HIERARCHY[item.key] || 0;
          const isFinancialStage = currentRank >= 5;
          const hideTime =
            item.key === "SUCCESS" || item.key === "WON" || item.key === "FAILED" || item.key === "CANCELLED";

          return renderFunnelRow(
            item.key,
            item.label,
            count,
            money,
            avgTimeMinutes,
            color,
            isGroup,
            isChild,
            hideTime,
            isFinancialStage,
            () => openModal(item),
            item.statusKeys,
          );
        })}

        {/* ---- ОБЪЕДИНЁННАЯ СТРОКА ДЛЯ LOST / CANCELLED ---- */}
        {(() => {
          const lostCancelledDeals = deals.filter(
            (d) => d.status === "FAILED" || d.status === "CANCELLED",
          );
          const count = lostCancelledDeals.length;
          const money = 0; // не показываем деньги
          const avgTimeMinutes = 0; // время не показываем
          const color = STAGE_COLORS["CANCELLED"] || "#64748b";
          const hideTime = true;
          const isFinancialStage = false; // без объекта

          // Для модального окна создадим фиктивный элемент, который будет вести себя как группа
          const mergedItem: FunnelItem = {
            key: "CANCELLED_MERGED",
            label: "Cancelled",
            type: "group",
            statusKeys: ["FAILED", "CANCELLED"],
          };

          return renderFunnelRow(
            mergedItem.key,
            mergedItem.label,
            count,
            money,
            avgTimeMinutes,
            color,
            false, // не группа (но можно сделать как группу, если нужно)
            false,
            hideTime,
            isFinancialStage,
            () => {
              // Открываем модалку с фильтром по обоим статусам
              setSelectedStage(mergedItem);
              setTimeout(() => {
                document
                  .getElementById("detail-view")
                  ?.scrollIntoView({ behavior: "smooth" });
              }, 100);
            },
            mergedItem.statusKeys,
          );
        })()}
      </div>

      {/* Детальное окно (модалка) */}
      {selectedStage && (
        <div className={styles.detailCard} id="detail-view">
          <div className={styles.detailHeader}>
            <div className={styles.detailTitleGroup}>
              <div
                className={styles.detailIndicator}
                style={{
                  backgroundColor: STAGE_COLORS[selectedStage.key] || "#6366f1",
                }}
              />
              <div>
                <h3>
                  Детальная аналитика: {selectedStage.label} (
                  {viewMode === "pipeline" ? "Текущие" : "Все прошедшие"})
                </h3>
                <p className={styles.detailSubtitle}>
                  Список сделок на этапе воронки
                </p>
              </div>
            </div>
            <button
              className={styles.closeDetailBtn}
              onClick={() => setSelectedStage(null)}
            >
              Закрыть детали ×
            </button>
          </div>

          <div className={styles.detailBody}>
            <div className={styles.detailGrid}>
              <div className={styles.mainMetrics}>
                <div className={styles.metricItem}>
                  <span className={styles.metricLabel}>Объем сделок</span>
                  <div className={styles.metricValue}>
                    {filteredDeals.length}
                  </div>
                </div>
                <div className={styles.metricItem}>
                  <span className={styles.metricLabel}>Сумма на этапе</span>
                  <div
                    className={styles.metricValue}
                    style={{
                      color: STAGE_COLORS[selectedStage.key] || "#6366f1",
                    }}
                  >
                    {formatMoney(
                      filteredDeals.reduce(
                        (sum, d) => sum + (d.unit?.price || 0),
                        0,
                      ),
                    )}
                  </div>
                </div>
                <div className={styles.metricItem}>
                  <span className={styles.metricLabel}>
                    Среднее время в статусе
                  </span>
                  <div className={styles.metricValue}>
                    {(() => {
                      const totalMins = filteredDeals.reduce((sum, d) => {
                        const diff =
                          new Date().getTime() -
                          new Date(d.updatedAt).getTime();
                        return sum + Math.floor(diff / (1000 * 60));
                      }, 0);
                      const avg =
                        filteredDeals.length > 0
                          ? Math.floor(totalMins / filteredDeals.length)
                          : 0;
                      return formatDuration(avg);
                    })()}
                  </div>
                </div>
              </div>

              <div className={styles.dealsTableWrapper}>
                <table className={styles.dealsTable}>
                  <thead>
                    <tr>
                      <th>ID сделки</th>
                      <th>Клиент</th>
                      <th>Объект недвижимости</th>
                      <th>Сумма (USD)</th>
                      <th>Ответственный</th>
                      <th>Время в статусе</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDeals.map((deal) => {
                      const totalMinutesInStatus = Math.floor(
                        (new Date().getTime() -
                          new Date(deal.updatedAt).getTime()) /
                          (1000 * 60),
                      );
                      return (
                        <tr key={deal.id}>
                          <td className={styles.dealId}>
                            #{deal.id.slice(0, 8)}
                          </td>
                          <td className={styles.clientName}>
                            {deal.lead?.name || "—"}
                          </td>
                          <td className={styles.unitInfo}>
                            <span className={styles.projectName}>
                              {deal.unit?.block?.project?.name}
                            </span>
                            <span className={styles.unitNumber}>
                              Квартира №{deal.unit?.number}
                            </span>
                          </td>
                          <td className={styles.dealPrice}>
                            {deal.unit?.price
                              ? `$${deal.unit.price.toLocaleString()}`
                              : "—"}
                          </td>
                          <td className={styles.managerName}>
                            Дежурный менеджер
                          </td>
                          <td className={styles.daysStatus}>
                            {formatDuration(totalMinutesInStatus)}
                          </td>
                        </tr>
                      );
                    })}
                    {filteredDeals.length === 0 && (
                      <tr>
                        <td
                          colSpan={6}
                          style={{
                            textAlign: "center",
                            padding: "40px",
                            color: "#94a3b8",
                          }}
                        >
                          Нет сделок на этом этапе
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}