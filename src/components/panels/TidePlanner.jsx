import React, { useEffect, useMemo, useRef, useState } from "react";

const TIDE_DATA_STALE_WARNING_HOURS = 30;

function SectionTitle({ eyebrow, title, subtitle }) {
    return (
        <div style={{ display: "grid", gap: "3px" }}>
            {eyebrow ? (
                <div
                    style={{
                        fontSize: "0.68rem",
                        fontWeight: 800,
                        color: "#0f766e",
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                    }}
                >
                    {eyebrow}
                </div>
            ) : null}
            <div style={{ fontSize: "0.96rem", fontWeight: 800, color: "#0f172a" }}>{title}</div>
            {subtitle ? <div style={{ fontSize: "0.78rem", color: "#475569", lineHeight: 1.45 }}>{subtitle}</div> : null}
        </div>
    );
}

function TrendPill({ direction, label }) {
    const color = direction === "up" ? "#047857" : direction === "down" ? "#c2410c" : "#334155";
    const borderColor = direction === "flat" ? "#cbd5e1" : color;
    const symbol = direction === "up" ? "↑" : direction === "down" ? "↓" : "→";

    return (
        <span
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                borderRadius: "999px",
                border: `1px solid ${borderColor}`,
                background: "#fff",
                color,
                padding: "3px 8px",
                fontSize: "0.7rem",
                fontWeight: 800,
                whiteSpace: "nowrap",
            }}
        >
            <span aria-hidden="true">{symbol}</span>
            <span>{label}</span>
        </span>
    );
}

function CleanupSensorTable({ isMobile, rows, expandedSensorId, onToggleSensor }) {
    const hasRows = rows.length > 0;

    return (
        <div
            style={{
                border: "1px solid #dbeafe",
                borderRadius: "12px",
                background: "rgba(255,255,255,0.92)",
                overflow: "hidden",
            }}
        >
            <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", minWidth: "640px", borderCollapse: "collapse" }}>
                    <thead>
                        <tr style={{ background: "#eff6ff" }}>
                            {[
                                "Station",
                                "Latest",
                                "Trend",
                                "Checked",
                                "History",
                            ].map((heading) => (
                                <th
                                    key={heading}
                                    style={{
                                        padding: isMobile ? "10px 10px" : "10px 12px",
                                        textAlign: "left",
                                        fontSize: "0.7rem",
                                        color: "#1d4ed8",
                                        fontWeight: 800,
                                        letterSpacing: "0.05em",
                                        textTransform: "uppercase",
                                        borderBottom: "1px solid #dbeafe",
                                    }}
                                >
                                    {heading}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {!hasRows ? (
                            <tr>
                                <td colSpan={5} style={{ padding: "14px 12px", fontSize: "0.8rem", color: "#64748b" }}>
                                    Sensor feeds are still loading.
                                </td>
                            </tr>
                        ) : null}
                        {rows.map((row) => {
                            const isExpanded = expandedSensorId === row.id;

                            return (
                                <React.Fragment key={row.id}>
                                    <tr style={{ borderBottom: isExpanded ? "none" : "1px solid #e2e8f0" }}>
                                        <td style={{ padding: isMobile ? "11px 10px" : "12px" }}>
                                            <div style={{ display: "grid", gap: "3px" }}>
                                                <div style={{ fontSize: "0.82rem", fontWeight: 800, color: "#0f172a" }}>{row.name}</div>
                                                <div style={{ fontSize: "0.71rem", color: "#0f766e", fontWeight: 700 }}>
                                                    {row.riverName} · {row.kindLabel}
                                                </div>
                                                <div style={{ fontSize: "0.71rem", color: "#64748b" }}>{row.parameterName}</div>
                                            </div>
                                        </td>
                                        <td style={{ padding: isMobile ? "11px 10px" : "12px" }}>
                                            <div style={{ display: "grid", gap: "4px" }}>
                                                <div style={{ fontSize: "0.82rem", fontWeight: 800, color: row.error ? "#b91c1c" : "#0f172a" }}>
                                                    {row.loading ? "Loading..." : row.valueLabel}
                                                </div>
                                                {row.flowLabel ? (
                                                    <div style={{ fontSize: "0.72rem", color: "#475569" }}>
                                                        Flow {row.flowLabel}
                                                    </div>
                                                ) : null}
                                            </div>
                                        </td>
                                        <td style={{ padding: isMobile ? "11px 10px" : "12px" }}>
                                            <TrendPill direction={row.trendDirection} label={row.trendLabel} />
                                        </td>
                                        <td style={{ padding: isMobile ? "11px 10px" : "12px" }}>
                                            <div style={{ display: "grid", gap: "4px" }}>
                                                <div style={{ fontSize: "0.76rem", color: "#0f172a", fontWeight: 700 }}>
                                                    {row.ageLabel || "Awaiting update"}
                                                </div>
                                                <div style={{ fontSize: "0.7rem", color: "#64748b" }}>
                                                    {row.timestampLabel || row.flowTimestampLabel || "No timestamp"}
                                                </div>
                                            </div>
                                        </td>
                                        <td style={{ padding: isMobile ? "11px 10px" : "12px" }}>
                                            <button
                                                type="button"
                                                onClick={() => onToggleSensor(row.id)}
                                                disabled={!row.history.length}
                                                style={{
                                                    border: !row.history.length
                                                        ? "1px solid #e2e8f0"
                                                        : isExpanded
                                                          ? "1px solid #0f766e"
                                                          : "1px solid #cbd5e1",
                                                    background: !row.history.length
                                                        ? "#f8fafc"
                                                        : isExpanded
                                                          ? "#ccfbf1"
                                                          : "#fff",
                                                    color: !row.history.length
                                                        ? "#94a3b8"
                                                        : isExpanded
                                                          ? "#115e59"
                                                          : "#0f172a",
                                                    borderRadius: "999px",
                                                    padding: "6px 10px",
                                                    fontSize: "0.72rem",
                                                    fontWeight: 800,
                                                    cursor: !row.history.length ? "not-allowed" : "pointer",
                                                }}
                                            >
                                                {!row.history.length
                                                    ? "No history yet"
                                                    : isExpanded
                                                      ? "Hide history"
                                                      : `Show ${Math.min(row.history.length, 24)} readings`}
                                            </button>
                                        </td>
                                    </tr>
                                    {isExpanded ? (
                                        <tr>
                                            <td colSpan={5} style={{ padding: isMobile ? "10px" : "12px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                                                <div style={{ display: "grid", gap: "8px" }}>
                                                    <div style={{ fontSize: "0.72rem", color: "#334155", fontWeight: 700 }}>
                                                        Last {row.history.length} readings from this station
                                                    </div>
                                                    <div
                                                        style={{
                                                            display: "grid",
                                                            gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))",
                                                            gap: "8px",
                                                        }}
                                                    >
                                                        {row.history.map((entry) => (
                                                            <div
                                                                key={entry.id}
                                                                style={{
                                                                    border: "1px solid #e2e8f0",
                                                                    borderRadius: "10px",
                                                                    background: "#fff",
                                                                    padding: "8px 10px",
                                                                    display: "grid",
                                                                    gap: "3px",
                                                                }}
                                                            >
                                                                <div style={{ fontSize: "0.8rem", color: "#0f172a", fontWeight: 800 }}>{entry.valueLabel}</div>
                                                                <div style={{ fontSize: "0.72rem", color: "#475569" }}>{entry.ageLabel || "Time unavailable"}</div>
                                                                <div style={{ fontSize: "0.68rem", color: "#94a3b8" }}>{entry.timestampLabel || ""}</div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    ) : null}
                                </React.Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export default function TidePlanner({
    isTidePlannerCollapsed,
    isMobile,
    isLoadingLancasterTides,
    fetchLancasterTides,
    lancasterTideUpdatedAt,
    lancasterTideError,
    tideChartData,
    tideChartUrl,
    buildCurrentTideMarker,
    formatTideTime,
    formatTideClockTime,
    formatTideDay,
    cleanupPlannerSensors,
    cleanupForecast,
    cleanupForecastError,
    cleanupForecastUpdatedLabel,
    isLoadingCleanupForecast,
}) {
    const [selectedTideIndex, setSelectedTideIndex] = useState(null);
    const [liveTideTimeMs, setLiveTideTimeMs] = useState(() => Date.now());
    const [activeCleanupWindowIndex, setActiveCleanupWindowIndex] = useState(null);
    const [expandedSensorId, setExpandedSensorId] = useState(null);
    const tideChartViewportRef = useRef(null);
    const autoCenteredTideChartSignatureRef = useRef(null);

    useEffect(() => {
        if (isTidePlannerCollapsed || !tideChartData?.points?.length) return undefined;

        setLiveTideTimeMs(Date.now());

        const intervalId = window.setInterval(() => {
            setLiveTideTimeMs(Date.now());
        }, 15000);

        return () => {
            window.clearInterval(intervalId);
        };
    }, [isTidePlannerCollapsed, tideChartData]);

    const currentTideTime = useMemo(() => new Date(liveTideTimeMs), [liveTideTimeMs]);
    const tideRange = useMemo(() => {
        if (!tideChartData?.points?.length) return null;

        const startTime = Number.isFinite(tideChartData.minTime)
            ? tideChartData.minTime
            : tideChartData.points[0].date.getTime();
        const endTime = Number.isFinite(tideChartData.maxTime)
            ? tideChartData.maxTime
            : tideChartData.points[tideChartData.points.length - 1].date.getTime();

        return {
            startTime,
            endTime,
            includesNow: liveTideTimeMs >= startTime && liveTideTimeMs <= endTime,
        };
    }, [liveTideTimeMs, tideChartData]);
    const tideSnapshotAgeHours = useMemo(() => {
        if (!lancasterTideUpdatedAt) return null;
        const updatedAtMs = new Date(lancasterTideUpdatedAt).getTime();
        if (!Number.isFinite(updatedAtMs)) return null;

        return (Date.now() - updatedAtMs) / (60 * 60 * 1000);
    }, [lancasterTideUpdatedAt]);
    const tideChartSignature = useMemo(() => {
        if (!tideChartData?.points?.length) return null;

        return [
            tideChartData.minTime,
            tideChartData.maxTime,
            tideChartData.width,
            tideChartData.points.length,
        ].join(":");
    }, [tideChartData]);
    const isTideSnapshotStale =
        Number.isFinite(tideSnapshotAgeHours) &&
        tideSnapshotAgeHours >= TIDE_DATA_STALE_WARNING_HOURS;
    const currentTideMarker = useMemo(
        () => buildCurrentTideMarker(tideChartData, liveTideTimeMs),
        [buildCurrentTideMarker, tideChartData, liveTideTimeMs],
    );
    const nextTide = useMemo(
        () =>
            tideChartData?.points?.find((point) => point.date.getTime() >= liveTideTimeMs) || null,
        [tideChartData, liveTideTimeMs],
    );
    const previousTide = useMemo(
        () =>
            tideChartData?.points
                ? [...tideChartData.points].reverse().find((point) => point.date.getTime() <= liveTideTimeMs) || null
                : null,
        [tideChartData, liveTideTimeMs],
    );

    useEffect(() => {
        if (!tideChartData?.points?.length) {
            setSelectedTideIndex(null);
            return;
        }

        if (selectedTideIndex !== null) {
            const selectedStillExists = tideChartData.points.some((point) => point.index === selectedTideIndex);
            if (selectedStillExists) return;
        }

        const fallbackPoint = nextTide || tideChartData.points[0];
        setSelectedTideIndex(fallbackPoint?.index ?? null);
    }, [nextTide, tideChartData, selectedTideIndex]);

    useEffect(() => {
        if (!tideChartData?.cleanupWindows?.length) {
            setActiveCleanupWindowIndex(null);
            return;
        }

        const activeWindowStillExists = tideChartData.cleanupWindows.some(
            (window) => window.index === activeCleanupWindowIndex,
        );

        if (!activeWindowStillExists) {
            setActiveCleanupWindowIndex(null);
        }
    }, [activeCleanupWindowIndex, tideChartData]);

    useEffect(() => {
        if (isTidePlannerCollapsed || !tideChartSignature || !currentTideMarker) return undefined;
        if (autoCenteredTideChartSignatureRef.current === tideChartSignature) return undefined;

        let animationFrameId = 0;
        let nestedAnimationFrameId = 0;

        animationFrameId = window.requestAnimationFrame(() => {
            nestedAnimationFrameId = window.requestAnimationFrame(() => {
                const viewport = tideChartViewportRef.current;
                if (!viewport) return;

                const maxScrollLeft = Math.max(viewport.scrollWidth - viewport.clientWidth, 0);
                const targetScrollLeft = Math.min(
                    Math.max(currentTideMarker.x - viewport.clientWidth / 2, 0),
                    maxScrollLeft,
                );

                viewport.scrollLeft = targetScrollLeft;
                autoCenteredTideChartSignatureRef.current = tideChartSignature;
            });
        });

        return () => {
            window.cancelAnimationFrame(animationFrameId);
            window.cancelAnimationFrame(nestedAnimationFrameId);
        };
    }, [currentTideMarker, isTidePlannerCollapsed, tideChartSignature]);

    useEffect(() => {
        if (!isMobile || activeCleanupWindowIndex === null) return undefined;

        const handlePointerDown = (event) => {
            if (tideChartViewportRef.current?.contains(event.target)) return;
            setActiveCleanupWindowIndex(null);
        };

        window.addEventListener("pointerdown", handlePointerDown);

        return () => {
            window.removeEventListener("pointerdown", handlePointerDown);
        };
    }, [activeCleanupWindowIndex, isMobile]);

    const selectedTidePoint =
        tideChartData?.points?.find((point) => point.index === selectedTideIndex) ||
        nextTide ||
        tideChartData?.points?.[0] ||
        null;
    const activeCleanupWindow =
        tideChartData?.cleanupWindows?.find((window) => window.index === activeCleanupWindowIndex) ||
        null;
    const activeCleanupWindowPosition = activeCleanupWindow
        ? activeCleanupWindow.lowTideX / tideChartData.width
        : null;
    const cleanupTooltipPlacement =
        activeCleanupWindowPosition === null
            ? "center"
            : activeCleanupWindowPosition < 0.24
              ? "left"
              : activeCleanupWindowPosition > 0.76
                ? "right"
                : "center";
    const cleanupTooltipStartLabel = activeCleanupWindow
        ? formatTideTime(new Date(activeCleanupWindow.startTime))
        : "";
    const cleanupTooltipEndLabel = activeCleanupWindow
        ? formatTideTime(new Date(activeCleanupWindow.endTime))
        : "";
    const visibleSensorRows = Array.isArray(cleanupPlannerSensors) ? cleanupPlannerSensors : [];
    const sensorLoadingCount = visibleSensorRows.filter((row) => row.loading).length;
    const tideSectionSubtitle = nextTide
        ? `Next planning pivot is ${nextTide.type.toLowerCase()} at ${formatTideTime(nextTide.date)}.`
        : "Use the tide curve to time safer shoreline access windows.";

    return (
        <div
            style={{
                marginBottom: isTidePlannerCollapsed ? "0px" : "8px",
                marginTop: isTidePlannerCollapsed ? "0px" : "6px",
                transition: "margin 220ms ease",
            }}
        >
            <div
                style={{
                    maxHeight: isTidePlannerCollapsed ? "0px" : "4000px",
                    opacity: isTidePlannerCollapsed ? 0 : 1,
                    transform: isTidePlannerCollapsed ? "translateY(-4px)" : "translateY(0)",
                    overflow: "hidden",
                    pointerEvents: isTidePlannerCollapsed ? "none" : "auto",
                    transition:
                        "max-height 260ms ease, opacity 180ms ease, transform 220ms ease",
                }}
            >
                <div
                    style={{
                        padding: isMobile ? "9px" : "9px 11px",
                        border: "1px solid #dbe3ee",
                        borderRadius: "12px",
                        background: "linear-gradient(160deg, #f8fbff 0%, #f2f7ff 62%, #f8fafc 100%)",
                        boxShadow: "0 8px 20px rgba(15,23,42,0.06)",
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: "6px",
                            flexWrap: "wrap",
                            marginBottom: "7px",
                        }}
                    >
                        <div style={{ display: "grid", gap: "3px" }}>
                            <div style={{ fontSize: "0.68rem", fontWeight: 800, color: "#0f766e", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                                Cleanup planner
                            </div>
                            <div style={{ fontSize: "0.92rem", fontWeight: 800, color: "#1e293b" }}>
                                Lancaster riverside outlook
                            </div>
                        </div>
                        <button
                            onClick={fetchLancasterTides}
                            disabled={isLoadingLancasterTides}
                            style={{
                                border: "1px solid #cbd5e1",
                                borderRadius: "999px",
                                padding: "5px 11px",
                                background: "#fff",
                                fontSize: "0.8rem",
                                minHeight: "32px",
                                fontWeight: 700,
                                cursor: isLoadingLancasterTides ? "wait" : "pointer",
                                opacity: 1,
                            }}
                            title="Reload saved Lancaster tide times"
                        >
                            {isLoadingLancasterTides ? "Refreshing..." : "Refresh tides"}
                        </button>
                    </div>

                    <div
                        style={{
                            marginBottom: "8px",
                            display: "grid",
                            gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1.3fr) minmax(280px, 0.7fr)",
                            gap: "8px",
                        }}
                    >
                        <div
                            style={{
                                padding: isMobile ? "10px" : "11px 12px",
                                borderRadius: "12px",
                                border: "1px solid #bfdbfe",
                                background: "linear-gradient(135deg, rgba(219,234,254,0.8), rgba(255,255,255,0.96))",
                            }}
                        >
                            <SectionTitle
                                eyebrow="Planner overview"
                                title="Choose your cleanup window with tide, sensor, and forecast context"
                                subtitle="The tide chart stays primary, while river sensors and short-range weather help decide whether the next low-tide window is worth using."
                            />
                        </div>

                        <div
                            style={{
                                padding: isMobile ? "10px" : "11px 12px",
                                borderRadius: "12px",
                                border: "1px solid #ccfbf1",
                                background: "linear-gradient(135deg, rgba(204,251,241,0.86), rgba(255,255,255,0.96))",
                                display: "grid",
                                gap: "5px",
                            }}
                        >
                            <div style={{ fontSize: "0.7rem", fontWeight: 800, color: "#0f766e", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                                Live planning signal
                            </div>
                            <div style={{ fontSize: "0.9rem", fontWeight: 800, color: "#0f172a" }}>{tideSectionSubtitle}</div>
                            <div style={{ fontSize: "0.75rem", color: "#475569", lineHeight: 1.45 }}>
                                {sensorLoadingCount
                                    ? `${sensorLoadingCount} sensor feed${sensorLoadingCount === 1 ? " is" : "s are"} still updating.`
                                    : `${visibleSensorRows.length} river station${visibleSensorRows.length === 1 ? "" : "s"} available in the planner.`}
                            </div>
                        </div>
                    </div>

                    <div
                        style={{
                            marginBottom: "7px",
                            padding: isMobile ? "9px 10px" : "10px 12px",
                            borderRadius: "12px",
                            border: "1px solid #dbeafe",
                            background: "linear-gradient(180deg, rgba(239,246,255,0.95) 0%, rgba(248,250,252,0.98) 100%)",
                            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.7)",
                        }}
                    >
                        <div
                            style={{
                                display: "flex",
                                gap: "6px",
                                flexWrap: "wrap",
                                alignItems: "center",
                                marginBottom: "5px",
                            }}
                        >
                            <span
                                style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    borderRadius: "999px",
                                    background: "#dbeafe",
                                    color: "#1d4ed8",
                                    padding: "3px 8px",
                                    fontSize: "0.69rem",
                                    fontWeight: 800,
                                    letterSpacing: "0.04em",
                                    textTransform: "uppercase",
                                }}
                            >
                                Cleanup timing
                            </span>
                            <span
                                style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    borderRadius: "999px",
                                    background: "#fef2f2",
                                    color: "#b91c1c",
                                    padding: "3px 8px",
                                    fontSize: "0.69rem",
                                    fontWeight: 800,
                                    letterSpacing: "0.04em",
                                    textTransform: "uppercase",
                                }}
                            >
                                Safety warning
                            </span>
                        </div>

                        <div style={{ fontSize: "0.81rem", color: "#1e293b", lineHeight: 1.45, fontWeight: 600 }}>
                            The best cleanup window is usually around low tide. Aim for roughly 2 hours before and 2 hours after the low tide dips shown on the graph.
                        </div>

                        <div style={{ fontSize: "0.77rem", color: "#475569", lineHeight: 1.45, marginTop: "4px" }}>
                            These windows are estimates only and conditions can change quickly.
                        </div>

                        <div
                            style={{
                                marginTop: "7px",
                                padding: "8px 10px",
                                borderRadius: "10px",
                                border: "1px solid #fecaca",
                                background: "linear-gradient(180deg, #fff5f5 0%, #fef2f2 100%)",
                            }}
                        >
                            <div
                                style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    borderRadius: "999px",
                                    background: "#fee2e2",
                                    color: "#991b1b",
                                    padding: "2px 7px",
                                    fontSize: "0.67rem",
                                    fontWeight: 800,
                                    letterSpacing: "0.05em",
                                    textTransform: "uppercase",
                                    marginBottom: "4px",
                                }}
                            >
                                Highest risk
                            </div>
                            <div style={{ fontSize: "0.78rem", color: "#7f1d1d", lineHeight: 1.45, fontWeight: 800 }}>
                                Outgoing tides are particularly dangerous.
                            </div>
                            <div style={{ fontSize: "0.76rem", color: "#7f1d1d", lineHeight: 1.45, marginTop: "2px", fontWeight: 700 }}>
                                Tides are dangerous at all times. Do not enter the water without strict professional supervision.
                            </div>
                        </div>
                    </div>

                    {lancasterTideUpdatedAt ? (
                        <div style={{ fontSize: "0.74rem", color: "#64748b", marginBottom: "4px" }}>
                            Updated: {new Date(lancasterTideUpdatedAt).toLocaleString()}
                        </div>
                    ) : null}

                    {tideRange ? (
                        <div
                            style={{
                                marginBottom: "6px",
                                padding: "6px 8px",
                                borderRadius: "8px",
                                border: tideRange.includesNow ? "1px solid #bfdbfe" : "1px solid #fecaca",
                                background: tideRange.includesNow ? "#eff6ff" : "#fff1f2",
                                color: tideRange.includesNow ? "#1e40af" : "#9f1239",
                                fontSize: "0.74rem",
                                lineHeight: 1.4,
                            }}
                        >
                            Coverage: {formatTideTime(new Date(tideRange.startTime))} to {formatTideTime(new Date(tideRange.endTime))}
                            {!tideRange.includesNow
                                ? " - current time is outside this saved range."
                                : " - current time is covered."}
                            {isTideSnapshotStale
                                ? " Snapshot is older than 30 hours; refresh is recommended."
                                : ""}
                        </div>
                    ) : null}

                    {lancasterTideError ? (
                        <div
                            style={{
                                marginBottom: "6px",
                                padding: "8px 10px",
                                borderRadius: "8px",
                                background: "#fff7ed",
                                color: "#9a3412",
                                border: "1px solid #fdba74",
                                fontSize: "0.83rem",
                            }}
                        >
                            {lancasterTideError}
                        </div>
                    ) : null}

                    {isLoadingLancasterTides && !tideChartData && !lancasterTideError ? (
                        <div
                            style={{
                                marginBottom: "8px",
                                padding: "10px 12px",
                                borderRadius: "10px",
                                border: "1px solid #dbeafe",
                                background: "rgba(255,255,255,0.86)",
                                color: "#475569",
                                fontSize: "0.83rem",
                            }}
                        >
                            Loading saved Lancaster tide data...
                        </div>
                    ) : null}

                    {tideChartData ? (
                        <div
                            style={{
                                border: "1px solid #e2e8f0",
                                borderRadius: "12px",
                                background: "#ffffff",
                                marginBottom: "6px",
                                padding: isMobile ? "8px" : "8px 10px",
                            }}
                        >
                            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                <div
                                    style={{
                                        display: "flex",
                                        gap: "6px",
                                        flexWrap: "wrap",
                                        fontSize: "0.75rem",
                                        color: "#475569",
                                    }}
                                >
                                    <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                                        <span aria-hidden="true" style={{ width: "10px", height: "10px", borderRadius: "999px", background: "#1d4ed8" }} />
                                        Tide curve
                                    </span>
                                    <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                                        <span
                                            aria-hidden="true"
                                            style={{
                                                width: "14px",
                                                height: "10px",
                                                borderRadius: "4px",
                                                background: "rgba(22,163,74,0.2)",
                                                border: "1px solid rgba(22,163,74,0.55)",
                                            }}
                                        />
                                        2 hr cleanup window
                                    </span>
                                    <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                                        <span aria-hidden="true" style={{ width: "2px", height: "14px", background: "#dc2626" }} />
                                        Current time
                                    </span>
                                </div>

                                <div
                                    ref={tideChartViewportRef}
                                    style={{ width: "100%", overflowX: "auto", marginTop: "-3px", marginBottom: "-2px" }}
                                >
                                    <div
                                        style={{
                                            position: "relative",
                                            width: `max(100%, ${tideChartData.width}px)`,
                                            minWidth: `${tideChartData.width}px`,
                                        }}
                                    >
                                        {activeCleanupWindow ? (
                                            <div
                                                role="status"
                                                aria-live="polite"
                                                style={{
                                                    position: "absolute",
                                                    top: "10px",
                                                    left:
                                                        cleanupTooltipPlacement === "left"
                                                            ? "10px"
                                                            : cleanupTooltipPlacement === "center"
                                                              ? `${(activeCleanupWindow.lowTideX / tideChartData.width) * 100}%`
                                                              : "auto",
                                                    right: cleanupTooltipPlacement === "right" ? "10px" : "auto",
                                                    transform:
                                                        cleanupTooltipPlacement === "center"
                                                            ? "translateX(-50%)"
                                                            : "none",
                                                    width: isMobile ? "min(260px, calc(100% - 20px))" : "min(300px, calc(100% - 20px))",
                                                    padding: "10px 12px",
                                                    borderRadius: "12px",
                                                    border: "1px solid rgba(15, 23, 42, 0.12)",
                                                    background: "rgba(255, 255, 255, 0.96)",
                                                    color: "#0f172a",
                                                    boxShadow: "0 14px 28px rgba(15,23,42,0.16)",
                                                    fontSize: "0.76rem",
                                                    lineHeight: 1.45,
                                                    zIndex: 2,
                                                    pointerEvents: "none",
                                                }}
                                            >
                                                <div style={{ fontWeight: 800, color: "#166534", marginBottom: "3px" }}>
                                                    Estimated 2 hour cleanup window
                                                </div>
                                                <div style={{ color: "#334155" }}>
                                                    Around {cleanupTooltipStartLabel} to {cleanupTooltipEndLabel}.
                                                </div>
                                                <div style={{ color: "#7f1d1d", marginTop: "5px", fontWeight: 700 }}>
                                                    Estimated only. Tides are dangerous at all times, and outgoing tides are particularly dangerous. Do not enter the water without strict professional supervision.
                                                </div>
                                            </div>
                                        ) : null}

                                        <svg
                                            viewBox={`0 0 ${tideChartData.width} ${tideChartData.height}`}
                                            role="img"
                                            aria-label="Wave graph of upcoming Lancaster tide highs, lows, and current time"
                                            style={{ width: "100%", height: "auto", display: "block" }}
                                        >
                                        <defs>
                                            <linearGradient id="tideBackdropGradient" x1="0" x2="0" y1="0" y2="1">
                                                <stop offset="0%" stopColor="#f8fbff" />
                                                <stop offset="100%" stopColor="#eef6ff" />
                                            </linearGradient>
                                            <linearGradient id="tideAreaGradient" x1="0" x2="0" y1="0" y2="1">
                                                <stop offset="0%" stopColor="#93c5fd" stopOpacity="0.45" />
                                                <stop offset="100%" stopColor="#dbeafe" stopOpacity="0.12" />
                                            </linearGradient>
                                            <filter id="tideCurveGlow" x="-10%" y="-20%" width="120%" height="140%">
                                                <feGaussianBlur stdDeviation="6" result="blur" />
                                                <feColorMatrix
                                                    in="blur"
                                                    type="matrix"
                                                    values="0 0 0 0 0.145 0 0 0 0 0.388 0 0 0 0 0.922 0 0 0 0.18 0"
                                                />
                                            </filter>
                                        </defs>

                                        <rect
                                            x={tideChartData.padding.left}
                                            y={tideChartData.padding.top}
                                            width={tideChartData.width - tideChartData.padding.left - tideChartData.padding.right}
                                            height={tideChartData.baselineY - tideChartData.padding.top}
                                            rx="18"
                                            fill="url(#tideBackdropGradient)"
                                        />

                                        {[0.25, 0.5, 0.75].map((ratio) => {
                                            const y = tideChartData.padding.top + (tideChartData.baselineY - tideChartData.padding.top) * ratio;

                                            return (
                                                <line
                                                    key={`h-grid-${ratio}`}
                                                    x1={tideChartData.padding.left}
                                                    x2={tideChartData.width - tideChartData.padding.right}
                                                    y1={y}
                                                    y2={y}
                                                    stroke="#dbeafe"
                                                    strokeWidth="1"
                                                    strokeDasharray="4 6"
                                                />
                                            );
                                        })}

                                        <line
                                            x1={tideChartData.padding.left}
                                            x2={tideChartData.width - tideChartData.padding.right}
                                            y1={tideChartData.medianY}
                                            y2={tideChartData.medianY}
                                            stroke="#94a3b8"
                                            strokeWidth="1.5"
                                            strokeDasharray="8 8"
                                            opacity="0.8"
                                        />

                                        <line
                                            x1={tideChartData.padding.left}
                                            x2={tideChartData.width - tideChartData.padding.right}
                                            y1={tideChartData.baselineY}
                                            y2={tideChartData.baselineY}
                                            stroke="#cbd5e1"
                                            strokeWidth="1"
                                        />

                                        {tideChartData.cleanupWindows.map((window) => {
                                            const isActive = activeCleanupWindowIndex === window.index;
                                            const cleanupWindowSummary = `Estimated cleanup window from ${formatTideTime(new Date(window.startTime))} to ${formatTideTime(new Date(window.endTime))}. Tides are dangerous at all times, and outgoing tides are particularly dangerous. Do not enter the water without strict professional supervision.`;

                                            return (
                                            <g
                                                key={`cleanup-window-${window.index}`}
                                                role="button"
                                                tabIndex={0}
                                                aria-label={cleanupWindowSummary}
                                                onMouseEnter={() => {
                                                    if (!isMobile) setActiveCleanupWindowIndex(window.index);
                                                }}
                                                onMouseLeave={() => {
                                                    if (!isMobile) {
                                                        setActiveCleanupWindowIndex((currentIndex) =>
                                                            currentIndex === window.index ? null : currentIndex,
                                                        );
                                                    }
                                                }}
                                                onFocus={() => setActiveCleanupWindowIndex(window.index)}
                                                onBlur={() => {
                                                    setActiveCleanupWindowIndex((currentIndex) =>
                                                        currentIndex === window.index ? null : currentIndex,
                                                    );
                                                }}
                                                onClick={() => {
                                                    if (isMobile) {
                                                        setActiveCleanupWindowIndex((currentIndex) =>
                                                            currentIndex === window.index ? null : window.index,
                                                        );
                                                    }
                                                }}
                                                onKeyDown={(event) => {
                                                    if (event.key === "Enter" || event.key === " ") {
                                                        event.preventDefault();
                                                        setActiveCleanupWindowIndex((currentIndex) =>
                                                            currentIndex === window.index ? null : window.index,
                                                        );
                                                    }

                                                    if (event.key === "Escape") {
                                                        setActiveCleanupWindowIndex(null);
                                                    }
                                                }}
                                                style={{ cursor: "pointer" }}
                                            >
                                                <rect
                                                    x={window.xStart}
                                                    y={tideChartData.padding.top}
                                                    width={Math.max(window.xEnd - window.xStart, 1)}
                                                    height={tideChartData.baselineY - tideChartData.padding.top}
                                                    rx="12"
                                                    fill={isActive ? "rgba(22, 163, 74, 0.22)" : "rgba(22, 163, 74, 0.11)"}
                                                />
                                                <line
                                                    x1={window.xStart}
                                                    x2={window.xStart}
                                                    y1={tideChartData.padding.top}
                                                    y2={tideChartData.baselineY}
                                                    stroke={isActive ? "rgba(21, 128, 61, 0.95)" : "rgba(22, 163, 74, 0.6)"}
                                                    strokeWidth={isActive ? "1.4" : "1"}
                                                    strokeDasharray="5 5"
                                                />
                                                <line
                                                    x1={window.xEnd}
                                                    x2={window.xEnd}
                                                    y1={tideChartData.padding.top}
                                                    y2={tideChartData.baselineY}
                                                    stroke={isActive ? "rgba(21, 128, 61, 0.95)" : "rgba(22, 163, 74, 0.6)"}
                                                    strokeWidth={isActive ? "1.4" : "1"}
                                                    strokeDasharray="5 5"
                                                />
                                            </g>
                                            );
                                        })}

                                        {tideChartData.points.map((point) => (
                                            <line
                                                key={`grid-${point.index}`}
                                                x1={point.x}
                                                x2={point.x}
                                                y1={tideChartData.padding.top}
                                                y2={tideChartData.baselineY}
                                                stroke="#e2e8f0"
                                                strokeDasharray="4 6"
                                                strokeWidth="1"
                                            />
                                        ))}

                                        <path d={tideChartData.areaPath} fill="url(#tideAreaGradient)" />
                                        <path
                                            d={tideChartData.curvePath}
                                            fill="none"
                                            stroke="#60a5fa"
                                            strokeWidth="7"
                                            strokeLinecap="round"
                                            opacity="0.1"
                                            filter="url(#tideCurveGlow)"
                                        />
                                        <path
                                            d={tideChartData.curvePath}
                                            fill="none"
                                            stroke="#2563eb"
                                            strokeWidth="2.5"
                                            strokeLinecap="round"
                                        />

                                        {currentTideMarker ? (
                                            <g>
                                                {(() => {
                                                    const timeLabelX = Math.min(
                                                        Math.max(currentTideMarker.x + 8, tideChartData.padding.left + 24),
                                                        tideChartData.width - tideChartData.padding.right - 24,
                                                    );

                                                    return (
                                                        <>
                                                <line
                                                    x1={currentTideMarker.x}
                                                    x2={currentTideMarker.x}
                                                    y1={tideChartData.padding.top}
                                                    y2={tideChartData.baselineY}
                                                    stroke="#dc2626"
                                                    strokeWidth="1.5"
                                                    strokeDasharray="6 4"
                                                    opacity="0.8"
                                                />
                                                <rect
                                                    x={timeLabelX - 19}
                                                    y={tideChartData.padding.top + 5}
                                                    width="38"
                                                    height="14"
                                                    rx="7"
                                                    fill="#fff5f5"
                                                    stroke="#dc2626"
                                                    strokeWidth="1"
                                                    opacity="0.95"
                                                />
                                                <text
                                                    x={timeLabelX}
                                                    y={tideChartData.padding.top + 12.8}
                                                    textAnchor="middle"
                                                    dominantBaseline="middle"
                                                    fontSize="8"
                                                    fontWeight="700"
                                                    fill="#b91c1c"
                                                >
                                                    {formatTideClockTime(currentTideMarker.time)}
                                                </text>
                                                <circle
                                                    cx={currentTideMarker.x}
                                                    cy={currentTideMarker.y}
                                                    r="3.2"
                                                    fill="#ffffff"
                                                    stroke="#dc2626"
                                                    strokeWidth="1.8"
                                                />
                                                        </>
                                                    );
                                                })()}
                                            </g>
                                        ) : null}

                                        {tideChartData.points.map((point) => {
                                            const rawTimeY = point.isLowTide ? point.y + 13 : point.y - 8;
                                            const timeY = Math.max(rawTimeY, tideChartData.padding.top + 9);
                                            const dateLabelX = Math.min(
                                                Math.max(point.x, tideChartData.padding.left + 22),
                                                tideChartData.width - tideChartData.padding.right - 22,
                                            );
                                            const isSelected = point.index === selectedTidePoint?.index;

                                            return (
                                                <g
                                                    key={`point-${point.index}`}
                                                    role="button"
                                                    tabIndex={0}
                                                    aria-label={`Select ${point.type} at ${formatTideTime(point.date)}`}
                                                    onClick={() => setSelectedTideIndex(point.index)}
                                                    onKeyDown={(event) => {
                                                        if (event.key === "Enter" || event.key === " ") {
                                                            event.preventDefault();
                                                            setSelectedTideIndex(point.index);
                                                        }
                                                    }}
                                                    style={{ cursor: "pointer" }}
                                                >
                                                    <circle cx={point.x} cy={point.y} r={isSelected ? "8" : "7"} fill={point.isLowTide ? "#16a34a" : "#2563eb"} opacity={isSelected ? "0.3" : "0.16"} />
                                                    <circle cx={point.x} cy={point.y} r={isSelected ? "5.3" : "4.4"} fill={point.isLowTide ? "#16a34a" : "#1d4ed8"} stroke={isSelected ? "#0f172a" : "#ffffff"} strokeWidth={isSelected ? "2" : "2.5"} />
                                                    <text x={dateLabelX} y={timeY} textAnchor="middle" fontSize="8.8" fill="#64748b">
                                                        {formatTideTime(point.date).replace(/^[A-Za-z]{3},?\s*/, "")}
                                                    </text>
                                                    <text x={dateLabelX} y={tideChartData.height - 4} textAnchor="middle" fontSize="9.2" fontWeight="700" fill="#475569">
                                                        {formatTideDay(point.date)}
                                                    </text>
                                                </g>
                                            );
                                        })}
                                        </svg>
                                    </div>
                                </div>

                                <div
                                    style={{
                                        display: "grid",
                                        gridTemplateColumns: isMobile ? "1fr" : "repeat(3, minmax(0, 1fr))",
                                        gap: "6px",
                                    }}
                                >
                                    <div style={{ borderRadius: "10px", border: "1px solid #dbeafe", background: "#eff6ff", padding: "8px 10px" }}>
                                        <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#1d4ed8", textTransform: "uppercase", letterSpacing: "0.04em" }}>Previous tide</div>
                                        <div style={{ marginTop: "4px", fontSize: "0.88rem", fontWeight: 700, color: "#0f172a" }}>
                                            {previousTide ? previousTide.type : "Unavailable"}
                                        </div>
                                        <div style={{ marginTop: "2px", fontSize: "0.78rem", color: "#475569" }}>
                                            {previousTide ? `${formatTideTime(previousTide.date)} • ${previousTide.height.toFixed(2)} m` : "No tide before current time in this range."}
                                        </div>
                                    </div>

                                    <div
                                        style={{
                                            borderRadius: "10px",
                                            border: selectedTidePoint?.isLowTide ? "1px solid #86efac" : "1px solid #bfdbfe",
                                            background: selectedTidePoint?.isLowTide ? "#f0fdf4" : "#eff6ff",
                                            padding: "8px 10px",
                                        }}
                                    >
                                        <div style={{ fontSize: "0.72rem", fontWeight: 700, color: selectedTidePoint?.isLowTide ? "#15803d" : "#1d4ed8", textTransform: "uppercase", letterSpacing: "0.04em" }}>Selected tide</div>
                                        <div style={{ marginTop: "4px", fontSize: "0.88rem", fontWeight: 700, color: "#0f172a" }}>
                                            {selectedTidePoint ? selectedTidePoint.type : "Unavailable"}
                                        </div>
                                        <div style={{ marginTop: "2px", fontSize: "0.78rem", color: "#475569" }}>
                                            {selectedTidePoint
                                                ? `${formatTideTime(selectedTidePoint.date)} • ${selectedTidePoint.height.toFixed(2)} m`
                                                : "Tap a tide point on the graph for details."}
                                        </div>
                                    </div>

                                    <div style={{ borderRadius: "10px", border: "1px solid #fecaca", background: "#fef2f2", padding: "8px 10px" }}>
                                        <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#b91c1c", textTransform: "uppercase", letterSpacing: "0.04em" }}>Current time</div>
                                        <div style={{ marginTop: "4px", fontSize: "0.88rem", fontWeight: 700, color: "#0f172a" }}>
                                            {formatTideTime(currentTideMarker?.time || currentTideTime)}
                                        </div>
                                        <div style={{ marginTop: "2px", fontSize: "0.78rem", color: "#475569" }}>
                                            {currentTideMarker
                                                ? `Estimated height ${currentTideMarker.height.toFixed(2)} m between ${currentTideMarker.previous.type} and ${currentTideMarker.next.type}.`
                                                : tideRange && !tideRange.includesNow
                                                  ? "Current time is outside the saved chart range. Refresh tide data to resync."
                                                  : "Current tide estimate is unavailable right now."}
                                        </div>
                                    </div>
                                </div>

                                <div style={{ marginTop: "2px", display: "flex", gap: "6px", flexWrap: "wrap" }}>
                                    {tideChartData.points.map((point) => {
                                        const isSelected = point.index === selectedTidePoint?.index;

                                        return (
                                            <button
                                                key={`tide-chip-${point.index}`}
                                                onClick={() => setSelectedTideIndex(point.index)}
                                                style={{
                                                    border: isSelected ? "1px solid #1d4ed8" : "1px solid #cbd5e1",
                                                    background: isSelected ? "#dbeafe" : "#fff",
                                                    color: "#0f172a",
                                                    borderRadius: "999px",
                                                    padding: "4px 9px",
                                                    fontSize: "0.74rem",
                                                    fontWeight: 700,
                                                    cursor: "pointer",
                                                }}
                                            >
                                                {formatTideTime(point.date).replace(/^[A-Za-z]{3},?\s*/, "")}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    ) : null}

                    {!isLoadingLancasterTides && !tideChartData && !lancasterTideError ? (
                        <div
                            style={{
                                marginBottom: "8px",
                                padding: "10px 12px",
                                borderRadius: "10px",
                                border: "1px dashed #bfdbfe",
                                background: "rgba(255,255,255,0.75)",
                                color: "#475569",
                                fontSize: "0.83rem",
                            }}
                        >
                            No saved tide snapshot is available right now. Try refreshing to load the latest Lancaster data.
                        </div>
                    ) : null}

                    <div style={{ display: "grid", gap: "8px", marginBottom: "8px" }}>
                        <div
                            style={{
                                padding: isMobile ? "10px" : "11px 12px",
                                borderRadius: "12px",
                                border: "1px solid #dbeafe",
                                background: "linear-gradient(180deg, rgba(248,250,252,0.92), rgba(255,255,255,0.98))",
                                display: "grid",
                                gap: "8px",
                            }}
                        >
                            <SectionTitle
                                eyebrow="River sensors"
                                title="Live river readings"
                                subtitle="A compact station table for the latest level and flow context, with expandable history up to the last 24 readings per station."
                            />
                            <CleanupSensorTable
                                isMobile={isMobile}
                                rows={visibleSensorRows}
                                expandedSensorId={expandedSensorId}
                                onToggleSensor={(sensorId) => setExpandedSensorId((currentId) => currentId === sensorId ? null : sensorId)}
                            />
                        </div>

                        <div
                            style={{
                                padding: isMobile ? "10px" : "11px 12px",
                                borderRadius: "12px",
                                border: "1px solid #c7d2fe",
                                background: "linear-gradient(180deg, rgba(238,242,255,0.7), rgba(255,255,255,0.98))",
                                display: "grid",
                                gap: "8px",
                            }}
                        >
                            <SectionTitle
                                eyebrow="Weather forecast"
                                title="Near-term cleanup conditions"
                                subtitle="Short-range weather is summarised for rain, wind, and temperature so you can compare the next tide window against likely working conditions."
                            />

                            {isLoadingCleanupForecast && !cleanupForecast ? (
                                <div style={{ fontSize: "0.8rem", color: "#64748b" }}>Loading weather forecast...</div>
                            ) : null}

                            {cleanupForecastError ? (
                                <div
                                    style={{
                                        padding: "9px 10px",
                                        borderRadius: "10px",
                                        border: "1px solid #fdba74",
                                        background: "#fff7ed",
                                        color: "#9a3412",
                                        fontSize: "0.8rem",
                                    }}
                                >
                                    {cleanupForecastError}
                                </div>
                            ) : null}

                            {cleanupForecast ? (
                                <>
                                    <div
                                        style={{
                                            display: "grid",
                                            gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) minmax(260px, 0.9fr)",
                                            gap: "8px",
                                        }}
                                    >
                                        <div
                                            style={{
                                                borderRadius: "12px",
                                                border: "1px solid #c7d2fe",
                                                background: "#fff",
                                                padding: "10px 12px",
                                                display: "grid",
                                                gap: "5px",
                                            }}
                                        >
                                            <div style={{ fontSize: "0.7rem", color: "#4f46e5", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                                                Next hour
                                            </div>
                                            <div style={{ fontSize: "0.92rem", color: "#0f172a", fontWeight: 800 }}>{cleanupForecast.headline}</div>
                                            {cleanupForecast.nextHour ? (
                                                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "2px" }}>
                                                    <span style={{ borderRadius: "999px", background: "#eef2ff", color: "#4338ca", padding: "4px 8px", fontSize: "0.72rem", fontWeight: 700 }}>
                                                        Temp {cleanupForecast.nextHour.temperatureLabel}
                                                    </span>
                                                    <span style={{ borderRadius: "999px", background: "#ecfeff", color: "#155e75", padding: "4px 8px", fontSize: "0.72rem", fontWeight: 700 }}>
                                                        Rain {cleanupForecast.nextHour.rainChanceLabel}
                                                    </span>
                                                    <span style={{ borderRadius: "999px", background: "#f8fafc", color: "#334155", padding: "4px 8px", fontSize: "0.72rem", fontWeight: 700 }}>
                                                        Wind {cleanupForecast.nextHour.windSpeedLabel}
                                                    </span>
                                                </div>
                                            ) : null}
                                            {cleanupForecastUpdatedLabel ? (
                                                <div style={{ fontSize: "0.69rem", color: "#94a3b8" }}>
                                                    Forecast updated {cleanupForecastUpdatedLabel}
                                                </div>
                                            ) : null}
                                        </div>

                                        <div
                                            style={{
                                                borderRadius: "12px",
                                                border: "1px solid #dbeafe",
                                                background: "#fff",
                                                padding: "10px 12px",
                                                display: "grid",
                                                gap: "6px",
                                            }}
                                        >
                                            <div style={{ fontSize: "0.7rem", color: "#1d4ed8", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                                                Key signals
                                            </div>
                                            {cleanupForecast.highlights.map((highlight) => (
                                                <div key={highlight.label} style={{ display: "flex", justifyContent: "space-between", gap: "8px", fontSize: "0.76rem" }}>
                                                    <span style={{ color: "#475569", fontWeight: 700 }}>{highlight.label}</span>
                                                    <span style={{ color: "#0f172a", fontWeight: 800, textAlign: "right" }}>{highlight.value}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div
                                        style={{
                                            display: "grid",
                                            gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))",
                                            gap: "8px",
                                        }}
                                    >
                                        <div
                                            style={{
                                                borderRadius: "12px",
                                                border: "1px solid #dbeafe",
                                                background: "#fff",
                                                padding: "10px 12px",
                                                display: "grid",
                                                gap: "7px",
                                            }}
                                        >
                                            <div style={{ fontSize: "0.7rem", color: "#1d4ed8", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                                                Next 6 hours
                                            </div>
                                            {cleanupForecast.upcomingHours.map((hour) => (
                                                <div key={hour.time} style={{ display: "grid", gridTemplateColumns: "72px 1fr auto", gap: "8px", alignItems: "center" }}>
                                                    <div style={{ fontSize: "0.74rem", color: "#0f172a", fontWeight: 800 }}>{hour.label}</div>
                                                    <div style={{ fontSize: "0.74rem", color: "#475569" }}>{hour.summary}</div>
                                                    <div style={{ fontSize: "0.72rem", color: "#334155", fontWeight: 700, textAlign: "right" }}>
                                                        {hour.temperatureLabel} · {hour.rainChanceLabel}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>

                                        <div
                                            style={{
                                                borderRadius: "12px",
                                                border: "1px solid #dbeafe",
                                                background: "#fff",
                                                padding: "10px 12px",
                                                display: "grid",
                                                gap: "7px",
                                            }}
                                        >
                                            <div style={{ fontSize: "0.7rem", color: "#1d4ed8", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                                                Next 3 days
                                            </div>
                                            {cleanupForecast.daily.map((day) => (
                                                <div key={day.date} style={{ display: "grid", gridTemplateColumns: "92px 1fr auto", gap: "8px", alignItems: "center" }}>
                                                    <div style={{ fontSize: "0.74rem", color: "#0f172a", fontWeight: 800 }}>{day.label}</div>
                                                    <div style={{ fontSize: "0.74rem", color: "#475569" }}>{day.summary}</div>
                                                    <div style={{ fontSize: "0.72rem", color: "#334155", fontWeight: 700, textAlign: "right" }}>
                                                        {day.minTemperatureLabel} to {day.maxTemperatureLabel}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </>
                            ) : null}
                        </div>
                    </div>

                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        <a
                            href={tideChartUrl}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                                textDecoration: "none",
                                border: "1px solid #93c5fd",
                                color: "#1d4ed8",
                                background: "#fff",
                                borderRadius: "999px",
                                padding: isMobile ? "9px 12px" : "7px 11px",
                                fontSize: "0.8rem",
                                fontWeight: 700,
                            }}
                        >
                            Open Full Lancaster Chart
                        </a>
                    </div>
                </div>
            </div>
        </div>
    );
}
