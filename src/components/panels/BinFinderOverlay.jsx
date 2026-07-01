import React from "react";

const panelBaseStyle = {
    position: "absolute",
    top: "12px",
    right: "12px",
    zIndex: 940,
    width: "min(360px, calc(100% - 24px))",
    maxHeight: "min(72vh, 620px)",
    borderRadius: "14px",
    border: "1px solid #cbd5e1",
    background: "rgba(255,255,255,0.97)",
    boxShadow: "0 16px 34px rgba(15,23,42,0.22)",
    backdropFilter: "blur(6px)",
    display: "grid",
    gridTemplateRows: "auto auto minmax(0, 1fr)",
    overflow: "hidden",
};

const titleStyle = {
    margin: 0,
    fontSize: "0.98rem",
    fontWeight: 800,
    color: "#0f172a",
};

const subtitleStyle = {
    margin: "3px 0 0",
    fontSize: "0.76rem",
    color: "#475569",
    lineHeight: 1.35,
};

const closeButtonStyle = {
    border: "1px solid #cbd5e1",
    borderRadius: "999px",
    background: "#fff",
    width: "30px",
    height: "30px",
    fontWeight: 800,
    color: "#334155",
    cursor: "pointer",
};

const rowButtonStyle = {
    width: "100%",
    textAlign: "left",
    border: "1px solid #e2e8f0",
    background: "#ffffff",
    borderRadius: "10px",
    padding: "8px 10px",
    display: "grid",
    gap: "3px",
    cursor: "pointer",
};

const formatDistance = (meters) => {
    if (!Number.isFinite(meters)) return "";
    if (meters < 1000) {
        return `${Math.round(meters)}m`;
    }

    return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)}km`;
};

export default function BinFinderOverlay({
    isOpen,
    isMobile,
    bins,
    hasLiveLocation,
    liveLocationError,
    selectedBinId,
    onSelectBin,
    onClose,
}) {
    if (!isOpen) return null;

    return (
        <section
            aria-label="Bin finder"
            style={{
                ...panelBaseStyle,
                left: isMobile ? "10px" : "auto",
                right: isMobile ? "10px" : "12px",
                top: isMobile ? "10px" : "12px",
                width: isMobile ? "auto" : panelBaseStyle.width,
                maxHeight: isMobile ? "min(58vh, 520px)" : panelBaseStyle.maxHeight,
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: "10px",
                    padding: "10px 10px 8px",
                    borderBottom: "1px solid #e2e8f0",
                }}
            >
                <div>
                    <h2 style={titleStyle}>Bin Finder</h2>
                    <p style={subtitleStyle}>
                        {hasLiveLocation
                            ? "Nearest bins are sorted by your live location."
                            : "Showing all bins. Enable location for nearest sorting."}
                    </p>
                </div>
                <button type="button" onClick={onClose} aria-label="Close bin finder" style={closeButtonStyle}>
                    ×
                </button>
            </div>

            {liveLocationError && !hasLiveLocation ? (
                <div
                    style={{
                        padding: "8px 10px",
                        borderBottom: "1px solid #dbeafe",
                        background: "#eff6ff",
                        color: "#1d4ed8",
                        fontSize: "0.72rem",
                        lineHeight: 1.35,
                    }}
                >
                    {liveLocationError}
                </div>
            ) : null}

            <div style={{ overflowY: "auto", padding: "8px", display: "grid", gap: "7px" }}>
                {bins.length ? (
                    bins.map((bin) => {
                        const isSelected = String(selectedBinId || "") === String(bin.id);

                        return (
                            <button
                                key={bin.id}
                                type="button"
                                onClick={() => onSelectBin(bin)}
                                style={{
                                    ...rowButtonStyle,
                                    border: isSelected ? "1px solid #60a5fa" : rowButtonStyle.border,
                                    background: isSelected ? "#eff6ff" : "#ffffff",
                                }}
                            >
                                <div
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        gap: "8px",
                                    }}
                                >
                                    <strong
                                        style={{
                                            color: "#0f172a",
                                            fontSize: "0.8rem",
                                            fontWeight: 800,
                                        }}
                                    >
                                        {bin.label}
                                    </strong>
                                    {Number.isFinite(bin.distanceMeters) ? (
                                        <span
                                            style={{
                                                borderRadius: "999px",
                                                padding: "2px 8px",
                                                fontSize: "0.68rem",
                                                fontWeight: 800,
                                                border: "1px solid #93c5fd",
                                                background: "#dbeafe",
                                                color: "#1e3a8a",
                                            }}
                                        >
                                            {formatDistance(bin.distanceMeters)}
                                        </span>
                                    ) : null}
                                </div>
                                <span style={{ color: "#475569", fontSize: "0.74rem", lineHeight: 1.32 }}>
                                    {bin.subtitle}
                                </span>
                            </button>
                        );
                    })
                ) : (
                    <div
                        style={{
                            borderRadius: "10px",
                            border: "1px solid #e2e8f0",
                            background: "#f8fafc",
                            padding: "10px",
                            color: "#475569",
                            fontSize: "0.78rem",
                        }}
                    >
                        No mapped bins are available yet.
                    </div>
                )}
            </div>
        </section>
    );
}
