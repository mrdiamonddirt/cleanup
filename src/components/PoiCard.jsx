import React, { useRef, useEffect } from "react";
import ImageCarousel from "./ImageCarousel";

export default function PoiCard({
    poi,
    onClose,
    onEdit,
    isMobile,
    canManage,
}) {
    const cardRef = useRef(null);

    if (!poi) return null;

    // Close on Escape key
    useEffect(() => {
        const handleEscape = (event) => {
            if (event.key === "Escape") onClose?.();
        };
        window.addEventListener("keydown", handleEscape);
        return () => window.removeEventListener("keydown", handleEscape);
    }, [onClose]);

    const isMobileView = isMobile;
    const statusColor = poi.status === "published" ? "#059669" : "#d97706";
    const statusBg = poi.status === "published" ? "#d1fae5" : "#fef3c7";

    const cardStyle = isMobileView
        ? {
              position: "fixed",
              inset: 0,
              zIndex: 1200,
              borderRadius: "0",
          }
        : {
              position: "fixed",
              right: 0,
              top: 0,
              bottom: 0,
              width: "min(400px, 100%)",
              zIndex: 1200,
              borderRadius: "0",
          };

    return (
        <>
            {/* Backdrop (mobile only) */}
            {isMobileView && (
                <div
                    onClick={onClose}
                    style={{
                        position: "fixed",
                        inset: 0,
                        background: "rgba(2,6,23,0.45)",
                        zIndex: 1199,
                    }}
                />
            )}

            {/* Card */}
            <div
                ref={cardRef}
                style={{
                    ...cardStyle,
                    background: "#ffffff",
                    display: "flex",
                    flexDirection: "column",
                    boxShadow: isMobileView
                        ? "0 22px 46px rgba(15,23,42,0.28)"
                        : "-4px 0 12px rgba(15,23,42,0.15)",
                    border: isMobileView ? "none" : "1px solid #e2e8f0",
                    overflow: "hidden",
                }}
            >
                {/* Header */}
                <div
                    style={{
                        padding: "14px 16px",
                        borderBottom: "1px solid #e2e8f0",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        background: "linear-gradient(145deg, #f8fafc 0%, #ffffff 100%)",
                    }}
                >
                    <div style={{ flex: 1 }}>
                        <h2
                            style={{
                                margin: "0 0 4px 0",
                                fontSize: "1.1rem",
                                fontWeight: 700,
                                color: "#0f172a",
                            }}
                        >
                            {poi.title}
                        </h2>
                        <div
                            style={{
                                display: "flex",
                                gap: "8px",
                                flexWrap: "wrap",
                            }}
                        >
                            {poi.is_historic && (
                                <span
                                    style={{
                                        fontSize: "0.7rem",
                                        background: "#fef3c7",
                                        color: "#92400e",
                                        padding: "3px 8px",
                                        borderRadius: "4px",
                                        fontWeight: 600,
                                    }}
                                >
                                    📜 Historic
                                </span>
                            )}
                            {poi.is_museum && (
                                <span
                                    style={{
                                        fontSize: "0.7rem",
                                        background: "#ddd6fe",
                                        color: "#581c87",
                                        padding: "3px 8px",
                                        borderRadius: "4px",
                                        fontWeight: 600,
                                    }}
                                >
                                    🏛️ Museum
                                </span>
                            )}
                            <span
                                style={{
                                    fontSize: "0.7rem",
                                    background: statusBg,
                                    color: statusColor,
                                    padding: "3px 8px",
                                    borderRadius: "4px",
                                    fontWeight: 600,
                                }}
                            >
                                {poi.status === "published" ? "✓ Published" : "◦ Draft"}
                            </span>
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div
                        style={{
                            display: "flex",
                            gap: "6px",
                            marginLeft: "8px",
                        }}
                    >
                        {canManage && (
                            <button
                                type="button"
                                onClick={() => onEdit?.(poi.id)}
                                style={{
                                    padding: "6px 10px",
                                    border: "1px solid #bfdbfe",
                                    background: "#dbeafe",
                                    color: "#1e40af",
                                    borderRadius: "6px",
                                    cursor: "pointer",
                                    fontSize: "0.75rem",
                                    fontWeight: 600,
                                }}
                            >
                                Edit
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={onClose}
                            style={{
                                padding: "6px 10px",
                                border: "1px solid #cbd5e1",
                                background: "#f1f5f9",
                                color: "#334155",
                                borderRadius: "6px",
                                cursor: "pointer",
                                fontSize: "1rem",
                            }}
                        >
                            ✕
                        </button>
                    </div>
                </div>

                {/* Scrollable Content */}
                <div
                    style={{
                        flex: 1,
                        overflowY: "auto",
                        padding: "14px 16px",
                        display: "grid",
                        gap: "12px",
                    }}
                >
                    {/* Image Carousel */}
                    {poi.poi_images && poi.poi_images.length > 0 && (
                        <ImageCarousel images={poi.poi_images} />
                    )}

                    {/* Summary */}
                    {poi.summary && (
                        <div>
                            <p
                                style={{
                                    margin: "0",
                                    fontSize: "0.9rem",
                                    color: "#475569",
                                    lineHeight: 1.5,
                                    fontWeight: 500,
                                }}
                            >
                                {poi.summary}
                            </p>
                        </div>
                    )}

                    {/* Description */}
                    {poi.description && (
                        <div>
                            <p
                                style={{
                                    margin: "0",
                                    fontSize: "0.85rem",
                                    color: "#64748b",
                                    lineHeight: 1.6,
                                    whiteSpace: "pre-wrap",
                                    wordWrap: "break-word",
                                }}
                            >
                                {poi.description}
                            </p>
                        </div>
                    )}

                    {/* Metadata */}
                    <div
                        style={{
                            fontSize: "0.8rem",
                            color: "#718096",
                            padding: "8px 0",
                            borderTop: "1px solid #e2e8f0",
                            borderBottom: "1px solid #e2e8f0",
                        }}
                    >
                        {poi.period_start_year || poi.period_end_year ? (
                            <div style={{ marginBottom: "6px" }}>
                                <strong style={{ color: "#334155" }}>Period:</strong>{" "}
                                {poi.period_start_year || "?"} -{" "}
                                {poi.period_end_year || "?"}{" "}
                            </div>
                        ) : null}
                        <div>
                            <strong style={{ color: "#334155" }}>Coordinates:</strong>{" "}
                            {Number(poi.latitude).toFixed(4)}, {Number(poi.longitude).toFixed(4)}
                        </div>
                    </div>

                    {/* External Links */}
                    {(poi.google_maps_url || poi.wiki_url) && (
                        <div
                            style={{
                                display: "grid",
                                gap: "8px",
                                paddingTop: "4px",
                            }}
                        >
                            {poi.google_maps_url && (
                                <a
                                    href={poi.google_maps_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{
                                        display: "block",
                                        padding: "10px 12px",
                                        background: "#fee2e2",
                                        color: "#991b1b",
                                        border: "1px solid #fca5a5",
                                        borderRadius: "8px",
                                        textDecoration: "none",
                                        fontSize: "0.85rem",
                                        fontWeight: 600,
                                        textAlign: "center",
                                        cursor: "pointer",
                                        transition: "all 0.2s ease",
                                    }}
                                    onMouseEnter={(e) => {
                                        e.target.style.background = "#fecaca";
                                    }}
                                    onMouseLeave={(e) => {
                                        e.target.style.background = "#fee2e2";
                                    }}
                                >
                                    🗺️ View on Google Maps
                                </a>
                            )}
                            {poi.wiki_url && (
                                <a
                                    href={poi.wiki_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{
                                        display: "block",
                                        padding: "10px 12px",
                                        background: "#dbeafe",
                                        color: "#1e40af",
                                        border: "1px solid #93c5fd",
                                        borderRadius: "8px",
                                        textDecoration: "none",
                                        fontSize: "0.85rem",
                                        fontWeight: 600,
                                        textAlign: "center",
                                        cursor: "pointer",
                                        transition: "all 0.2s ease",
                                    }}
                                    onMouseEnter={(e) => {
                                        e.target.style.background = "#bfdbfe";
                                    }}
                                    onMouseLeave={(e) => {
                                        e.target.style.background = "#dbeafe";
                                    }}
                                >
                                    📖 Learn More on Wiki
                                </a>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}
