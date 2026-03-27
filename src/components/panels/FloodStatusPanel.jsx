import React, { useEffect, useRef, useState } from "react";

const FLOOD_SEVERITY_CONFIG = {
    1: { label: "Severe Flood Warning", color: "#991b1b", bg: "#fff5f5", border: "#fecaca", dot: "#dc2626" },
    2: { label: "Flood Warning", color: "#92400e", bg: "#fffbeb", border: "#fde68a", dot: "#d97706" },
    3: { label: "Flood Alert", color: "#78350f", bg: "#fefce8", border: "#fde68a", dot: "#f59e0b" },
};

export default function FloodStatusPanel({
    floodAlerts,
    isLoadingFloodAlerts,
    floodAlertsError,
    floodAlertsUpdatedAt,
    isMobile,
    uiTokens,
    SurfaceCard,
}) {
    const [isOpen, setIsOpen] = useState(false);
    const panelRef = useRef(null);

    const hasAlerts = floodAlerts.length > 0;
    const highest = hasAlerts ? floodAlerts[0] : null;
    const sevConf = highest ? (FLOOD_SEVERITY_CONFIG[highest.severityLevel] || FLOOD_SEVERITY_CONFIG[3]) : null;
    const visibleAlerts = floodAlerts.slice(0, 3);
    const overflowCount = floodAlerts.length - visibleAlerts.length;

    useEffect(() => {
        if (!isOpen || !isMobile) return undefined;

        const handlePointerDown = (event) => {
            if (!panelRef.current?.contains(event.target)) {
                setIsOpen(false);
            }
        };

        document.addEventListener("pointerdown", handlePointerDown);
        return () => document.removeEventListener("pointerdown", handlePointerDown);
    }, [isOpen, isMobile]);

    let pillBg = "rgba(255,255,255,0.96)";
    let pillBorder = "#e2e8f0";
    let pillDot = "#22c55e";
    let pillText = "No active flood alerts";
    let pillTextColor = "#64748b";

    if (isLoadingFloodAlerts && !hasAlerts) {
        pillDot = "#94a3b8";
        pillText = "Checking flood status...";
        pillTextColor = "#94a3b8";
    } else if (floodAlertsError) {
        pillDot = "#cbd5e1";
        pillText = "Flood status unavailable";
        pillTextColor = "#94a3b8";
    } else if (hasAlerts && sevConf) {
        pillBg = sevConf.bg;
        pillBorder = sevConf.border;
        pillDot = sevConf.dot;
        pillText = `${floodAlerts.length} flood alert${floodAlerts.length !== 1 ? "s" : ""} in area`;
        pillTextColor = sevConf.color;
    }

    return (
        <div
            style={{
                position: "absolute",
                top: "10px",
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 900,
                pointerEvents: "none",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
            }}
        >
            <div
                ref={panelRef}
                style={{
                    display: "inline-flex",
                    flexDirection: "column",
                    alignItems: "center",
                    pointerEvents: "auto",
                    position: "relative",
                }}
                onMouseEnter={!isMobile ? () => setIsOpen(true) : undefined}
                onMouseLeave={!isMobile ? () => setIsOpen(false) : undefined}
            >
                <button
                    type="button"
                    onClick={isMobile ? () => setIsOpen((prev) => !prev) : undefined}
                    aria-expanded={isOpen}
                    aria-label={pillText}
                    style={{
                        border: `1px solid ${pillBorder}`,
                        borderRadius: uiTokens.radius.pill,
                        background: pillBg,
                        backdropFilter: "blur(6px)",
                        WebkitBackdropFilter: "blur(6px)",
                        padding: "5px 10px 5px 9px",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        boxShadow: "0 4px 14px rgba(15,23,42,0.12)",
                        cursor: "pointer",
                        maxWidth: "min(90vw, 280px)",
                        minWidth: 0,
                    }}
                >
                    <span
                        aria-hidden="true"
                        style={{
                            width: "7px",
                            height: "7px",
                            borderRadius: "50%",
                            flexShrink: 0,
                            background: pillDot,
                        }}
                    />
                    <span
                        style={{
                            fontSize: "0.72rem",
                            fontWeight: 700,
                            color: pillTextColor,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            minWidth: 0,
                        }}
                    >
                        {pillText}
                    </span>
                    <span
                        aria-hidden="true"
                        style={{ fontSize: "0.6rem", color: pillTextColor, opacity: 0.65, flexShrink: 0 }}
                    >
                        {isOpen ? "▴" : "▾"}
                    </span>
                </button>

                <div
                    style={{
                        position: "absolute",
                        top: "calc(100% + 5px)",
                        left: "50%",
                        width: "min(90vw, 300px)",
                        opacity: isOpen ? 1 : 0,
                        transform: isOpen
                            ? "translateX(-50%) translateY(0) scale(1)"
                            : "translateX(-50%) translateY(-6px) scale(0.97)",
                        transformOrigin: "top center",
                        transition: "opacity 160ms ease, transform 180ms ease",
                        pointerEvents: isOpen ? "auto" : "none",
                    }}
                >
                    <SurfaceCard style={{ padding: "10px", display: "grid", gap: "8px" }}>
                        {floodAlertsUpdatedAt ? (
                            <div style={{ fontSize: "0.68rem", color: "#94a3b8", fontWeight: 600, textAlign: "center" }}>
                                Last checked: {floodAlertsUpdatedAt} · updates every 15 min
                            </div>
                        ) : null}

                        {!hasAlerts && !floodAlertsError && !isLoadingFloodAlerts ? (
                            <div style={{ fontSize: "0.76rem", color: "#374151", fontWeight: 600, textAlign: "center", padding: "2px 0" }}>
                                No active flood alerts in the River Lune area.
                            </div>
                        ) : null}

                        {isLoadingFloodAlerts && !hasAlerts ? (
                            <div style={{ fontSize: "0.76rem", color: "#94a3b8", textAlign: "center", padding: "2px 0" }}>
                                Loading flood data...
                            </div>
                        ) : null}

                        {floodAlertsError ? (
                            <div style={{ fontSize: "0.76rem", color: "#94a3b8", textAlign: "center", padding: "2px 0" }}>
                                Could not load flood data from the Environment Agency.
                            </div>
                        ) : null}

                        {hasAlerts ? (
                            <div
                                style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: "4px",
                                }}
                            >
                                {visibleAlerts.map((alert) => {
                                    const cfg = FLOOD_SEVERITY_CONFIG[alert.severityLevel] || FLOOD_SEVERITY_CONFIG[3];
                                    return (
                                        <div
                                            key={alert.id}
                                            style={{
                                                border: `1px solid ${cfg.border}`,
                                                borderRadius: uiTokens.radius.sm,
                                                background: cfg.bg,
                                                padding: "7px 10px",
                                                fontSize: "0.72rem",
                                                lineHeight: 1.35,
                                            }}
                                        >
                                            <div
                                                style={{
                                                    fontWeight: 800,
                                                    color: cfg.color,
                                                    marginBottom: "2px",
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: "5px",
                                                }}
                                            >
                                                <span
                                                    style={{
                                                        width: "6px",
                                                        height: "6px",
                                                        borderRadius: "50%",
                                                        background: cfg.dot,
                                                        flexShrink: 0,
                                                        display: "inline-block",
                                                    }}
                                                />
                                                {alert.severity}
                                            </div>
                                            <div style={{ color: "#374151", fontWeight: 600 }}>{alert.areaName}</div>
                                            {alert.message ? (
                                                <div
                                                    style={{
                                                        color: "#6b7280",
                                                        marginTop: "3px",
                                                        display: "-webkit-box",
                                                        WebkitLineClamp: 2,
                                                        WebkitBoxOrient: "vertical",
                                                        overflow: "hidden",
                                                    }}
                                                >
                                                    {alert.message}
                                                </div>
                                            ) : null}
                                            {alert.timeIssued ? (
                                                <div style={{ color: "#9ca3af", marginTop: "3px" }}>{alert.timeIssued}</div>
                                            ) : null}
                                        </div>
                                    );
                                })}
                            </div>
                        ) : null}

                        {overflowCount > 0 ? (
                            <div
                                style={{
                                    fontSize: "0.7rem",
                                    color: "#64748b",
                                    fontWeight: 700,
                                    textAlign: "center",
                                    padding: "3px 0",
                                }}
                            >
                                +{overflowCount} more
                            </div>
                        ) : null}

                        <div style={{ fontSize: "0.65rem", color: "#cbd5e1", textAlign: "center" }}>
                            Environment Agency · Open Government Licence
                        </div>
                    </SurfaceCard>
                </div>
            </div>
        </div>
    );
}
