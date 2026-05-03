import React, { useRef, useEffect, useState } from "react";
import ImageCarousel from "./ImageCarousel";
import { useW3W } from "../useW3W";
import { normalizeW3WWords } from "../w3w";

export default function PoiCard({
    poi,
    onClose,
    onEdit,
    isMobile,
    canManage,
    shareUrl,
    onLike,
    onShareRecorded,
    onSubmitComment,
    commentDraft = "",
    onCommentDraftChange,
    comments = [],
    likeCount = 0,
    shareCount = 0,
    isSubmittingInteraction = false,
    interactionStatus = "",
    interactionError = "",
    isLoadingComments = false,
    commentsError = "",
    isTidePlannerCollapsed = true,
}) {
    const cardRef = useRef(null);
    const shareStatusTimeoutRef = useRef(null);
    const [shareStatus, setShareStatus] = useState("");
    const storedW3WWords = normalizeW3WWords(poi?.w3w_address);
    const shouldResolveW3WLive = !storedW3WWords;
    const { words: fallbackW3WWords, loading: fallbackW3WLoading } = useW3W(
        shouldResolveW3WLive && poi ? Number(poi.latitude) : null,
        shouldResolveW3WLive && poi ? Number(poi.longitude) : null,
    );
    const w3wWords = storedW3WWords || fallbackW3WWords;
    const w3wLoading = shouldResolveW3WLive && fallbackW3WLoading;

    if (!poi) return null;

    // Close on Escape key
    useEffect(() => {
        const handleEscape = (event) => {
            if (event.key === "Escape") onClose?.();
        };
        window.addEventListener("keydown", handleEscape);
        return () => window.removeEventListener("keydown", handleEscape);
    }, [onClose]);

    useEffect(() => {
        return () => {
            if (shareStatusTimeoutRef.current) {
                window.clearTimeout(shareStatusTimeoutRef.current);
                shareStatusTimeoutRef.current = null;
            }
        };
    }, []);

    const setShareStatusWithTimeout = (message) => {
        setShareStatus(message);

        if (shareStatusTimeoutRef.current) {
            window.clearTimeout(shareStatusTimeoutRef.current);
        }

        shareStatusTimeoutRef.current = window.setTimeout(() => {
            setShareStatus("");
            shareStatusTimeoutRef.current = null;
        }, 2400);
    };

    const handleShare = async () => {
        if (!shareUrl) return;

        if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
            try {
                await navigator.share({
                    title: poi.title || "River Bank Cleanup Tracker",
                    text: "Check this point of interest in the cleanup tracker.",
                    url: shareUrl,
                });

                setShareStatusWithTimeout("Share sheet opened.");
                if (typeof onShareRecorded === "function") {
                    await onShareRecorded(poi);
                }
                return;
            } catch (error) {
                if (error?.name === "AbortError") {
                    return;
                }
            }
        }

        try {
            if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(shareUrl);
            } else {
                const textArea = document.createElement("textarea");
                textArea.value = shareUrl;
                textArea.setAttribute("readonly", "");
                textArea.style.position = "absolute";
                textArea.style.left = "-9999px";
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand("copy");
                document.body.removeChild(textArea);
            }

            setShareStatusWithTimeout("Share link copied.");
            if (typeof onShareRecorded === "function") {
                await onShareRecorded(poi);
            }
        } catch {
            setShareStatusWithTimeout("Could not copy automatically.");
        }
    };

    const isMobileView = isMobile;
    const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 0;
    const isCompactMobile = isMobileView && viewportWidth <= 400;
    const isPlannerOpenOnMobile = isMobileView && !isTidePlannerCollapsed;
    const contentPadding = isMobileView
        ? (isCompactMobile
            ? (isPlannerOpenOnMobile ? "8px 10px" : "10px 12px")
            : (isPlannerOpenOnMobile ? "10px 12px" : "12px 14px"))
        : "14px 16px";
    const contentGap = isMobileView
        ? (isCompactMobile ? (isPlannerOpenOnMobile ? "6px" : "8px") : "9px")
        : "10px";
    const hasImages = poi.poi_images && poi.poi_images.length > 0;
    const statusColor = poi.status === "published" ? "#059669" : "#d97706";
    const statusBg = poi.status === "published" ? "#d1fae5" : "#fef3c7";
    const likeCountLabel = Number.isFinite(Number(likeCount)) ? Number(likeCount) : 0;
    const shareCountLabel = Number.isFinite(Number(shareCount)) ? Number(shareCount) : 0;

    const cardStyle = isMobileView
        ? {
              position: "fixed",
                            left: "max(6px, env(safe-area-inset-left))",
                            right: "max(6px, env(safe-area-inset-right))",
                            top: "max(6px, env(safe-area-inset-top))",
                            bottom: "auto",
                            maxHeight: "calc(100svh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 12px)",
              zIndex: 1200,
                            borderRadius: "18px",
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
                        padding: isMobileView
                            ? (isCompactMobile
                                ? (isPlannerOpenOnMobile ? "8px 10px" : "10px 12px")
                                : (isPlannerOpenOnMobile ? "10px 12px" : "12px 14px"))
                            : "14px 16px",
                        borderBottom: "1px solid #e2e8f0",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        flexWrap: isMobileView ? "wrap" : "nowrap",
                        gap: isMobileView ? "8px" : "0",
                        background: "linear-gradient(145deg, #f8fafc 0%, #ffffff 100%)",
                    }}
                >
                    <div
                        style={{
                            flex: isMobileView
                                ? (isCompactMobile ? "1 1 140px" : "1 1 210px")
                                : "1 1 220px",
                            minWidth: 0,
                        }}
                    >
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
                            {poi.is_pub && (
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
                                    🍺 Pub
                                </span>
                            )}
                            {poi.is_cleanup_supporter && (
                                <span
                                    style={{
                                        fontSize: "0.7rem",
                                        background: "#fef3c7",
                                        color: "#92400e",
                                        padding: "3px 8px",
                                        borderRadius: "4px",
                                        fontWeight: 700,
                                    }}
                                >
                                    ★ Cleanup Supporter
                                </span>
                            )}
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
                            gap: "5px",
                            marginLeft: "auto",
                            flexWrap: "nowrap",
                            justifyContent: "flex-end",
                            width: "auto",
                        }}
                    >
                        {canManage && (
                            <button
                                type="button"
                                onClick={() => onEdit?.(poi.id)}
                                style={{
                                    padding: "5px 9px",
                                    border: "1px solid #bfdbfe",
                                    background: "#dbeafe",
                                    color: "#1e40af",
                                    borderRadius: "6px",
                                    cursor: "pointer",
                                    fontSize: "0.74rem",
                                    fontWeight: 600,
                                    lineHeight: 1.1,
                                    flex: "0 0 auto",
                                    whiteSpace: "nowrap",
                                }}
                            >
                                Edit
                            </button>
                        )}
                        {shareUrl ? (
                            <button
                                type="button"
                                onClick={handleShare}
                                style={{
                                    padding: "5px 9px",
                                    border: "1px solid #fed7aa",
                                    background: "#ffedd5",
                                    color: "#9a3412",
                                    borderRadius: "6px",
                                    cursor: "pointer",
                                    fontSize: "0.74rem",
                                    fontWeight: 700,
                                    lineHeight: 1.1,
                                    flex: "0 0 auto",
                                    whiteSpace: "nowrap",
                                }}
                                aria-label="Share point of interest"
                            >
                                Share ({shareCountLabel})
                            </button>
                        ) : null}
                        {typeof onLike === "function" ? (
                            <button
                                type="button"
                                onClick={() => onLike(poi)}
                                disabled={isSubmittingInteraction}
                                style={{
                                    padding: "5px 9px",
                                    border: "1px solid #bbf7d0",
                                    background: "#dcfce7",
                                    color: "#166534",
                                    borderRadius: "6px",
                                    cursor: isSubmittingInteraction ? "not-allowed" : "pointer",
                                    fontSize: "0.74rem",
                                    fontWeight: 700,
                                    lineHeight: 1.1,
                                    flex: "0 0 auto",
                                    whiteSpace: "nowrap",
                                    opacity: isSubmittingInteraction ? 0.65 : 1,
                                }}
                                aria-label="Like point of interest"
                            >
                                Like ({likeCountLabel})
                            </button>
                        ) : null}
                        <button
                            type="button"
                            onClick={onClose}
                            style={{
                                padding: "5px 9px",
                                border: "1px solid #cbd5e1",
                                background: "#f1f5f9",
                                color: "#334155",
                                borderRadius: "6px",
                                cursor: "pointer",
                                fontSize: "0.88rem",
                                lineHeight: 1,
                                flex: "0 0 auto",
                                whiteSpace: "nowrap",
                            }}
                        >
                            ✕
                        </button>
                    </div>
                </div>

                {shareStatus ? (
                    <div
                        style={{
                            padding: "6px 12px",
                            background: "#fff7ed",
                            borderBottom: "1px solid #fed7aa",
                            color: "#9a3412",
                            fontSize: "0.78rem",
                            fontWeight: 600,
                        }}
                    >
                        {shareStatus}
                    </div>
                ) : null}

                {interactionStatus ? (
                    <div
                        style={{
                            padding: "6px 12px",
                            background: "#ecfeff",
                            borderBottom: "1px solid #a5f3fc",
                            color: "#155e75",
                            fontSize: "0.78rem",
                            fontWeight: 600,
                        }}
                    >
                        {interactionStatus}
                    </div>
                ) : null}

                {interactionError ? (
                    <div
                        style={{
                            padding: "6px 12px",
                            background: "#fef2f2",
                            borderBottom: "1px solid #fecaca",
                            color: "#991b1b",
                            fontSize: "0.78rem",
                            fontWeight: 600,
                        }}
                    >
                        {interactionError}
                    </div>
                ) : null}

                {!isMobileView && hasImages ? (
                    <div
                        style={{
                            flex: "0 0 auto",
                            padding: "8px 14px 6px",
                            borderBottom: "1px solid #e2e8f0",
                            background: "#ffffff",
                        }}
                    >
                        <ImageCarousel images={poi.poi_images} />
                    </div>
                ) : null}

                {/* Scrollable Content */}
                <div
                    style={{
                        flex: 1,
                        minHeight: 0,
                        overflowY: "auto",
                        WebkitOverflowScrolling: "touch",
                        padding: isMobileView ? contentPadding : "8px 14px 10px",
                        display: "grid",
                        alignContent: "start",
                        gridAutoRows: "max-content",
                        gap: contentGap,
                    }}
                >
                    {/* Image Carousel */}
                    {isMobileView && hasImages && (
                        <ImageCarousel images={poi.poi_images} />
                    )}

                    {/* Summary */}
                    {poi.summary && (
                        <div
                            style={
                                isMobileView
                                    ? {
                                          maxHeight: isCompactMobile ? "78px" : "122px",
                                          overflowY: "auto",
                                          paddingRight: "2px",
                                      }
                                    : undefined
                            }
                        >
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
                        <div
                            style={
                                isMobileView
                                    ? {
                                          maxHeight: isCompactMobile ? "112px" : "180px",
                                          overflowY: "auto",
                                          paddingRight: "2px",
                                      }
                                    : undefined
                            }
                        >
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
                            padding: "6px 0",
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
                        {(w3wLoading || w3wWords) ? (
                            <div style={{ marginTop: "4px" }}>
                                <strong style={{ color: "#334155" }}>What3Words:</strong>{" "}
                                {w3wLoading ? (
                                    <span style={{ opacity: 0.4 }}>···</span>
                                ) : (
                                    <a
                                        href={`https://what3words.com/${w3wWords}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        style={{ textDecoration: "none", color: "#334155" }}
                                    >
                                        <span style={{ color: "#E11D1C", fontWeight: 700 }}>///</span>{w3wWords}
                                    </a>
                                )}
                            </div>
                        ) : null}
                    </div>

                    {/* External Links */}
                    {(poi.google_maps_url || poi.wiki_url) && (
                        <div
                            style={{
                                display: "flex",
                                flexWrap: "wrap",
                                alignItems: "flex-start",
                                justifyContent: "flex-start",
                                gap: "6px",
                                paddingTop: "2px",
                            }}
                        >
                            {poi.google_maps_url && (
                                <a
                                    href={poi.google_maps_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        alignSelf: "flex-start",
                                        width: "fit-content",
                                        maxWidth: "100%",
                                        minHeight: "34px",
                                        padding: "8px 10px",
                                        background: "#fee2e2",
                                        color: "#991b1b",
                                        border: "1px solid #fca5a5",
                                        borderRadius: "8px",
                                        textDecoration: "none",
                                        fontSize: "0.82rem",
                                        fontWeight: 600,
                                        lineHeight: 1.25,
                                        textAlign: "center",
                                        whiteSpace: "nowrap",
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
                                        display: "inline-flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        alignSelf: "flex-start",
                                        width: "fit-content",
                                        maxWidth: "100%",
                                        minHeight: "34px",
                                        padding: "8px 10px",
                                        background: "#dbeafe",
                                        color: "#1e40af",
                                        border: "1px solid #93c5fd",
                                        borderRadius: "8px",
                                        textDecoration: "none",
                                        fontSize: "0.82rem",
                                        fontWeight: 600,
                                        lineHeight: 1.25,
                                        textAlign: "center",
                                        whiteSpace: "nowrap",
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

                    {typeof onSubmitComment === "function" ? (
                        <div style={{ display: "grid", gap: "8px", borderTop: "1px solid #e2e8f0", paddingTop: "8px" }}>
                            <div style={{ fontSize: "0.78rem", fontWeight: 800, color: "#334155", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                                Comments
                            </div>
                            <textarea
                                value={commentDraft}
                                onChange={(event) => onCommentDraftChange?.(event.target.value)}
                                placeholder="Write a comment. It will be reviewed before publishing."
                                rows={3}
                                disabled={isSubmittingInteraction}
                                style={{
                                    width: "100%",
                                    borderRadius: "8px",
                                    border: "1px solid #cbd5e1",
                                    padding: "8px 10px",
                                    fontSize: "0.82rem",
                                    resize: "vertical",
                                    boxSizing: "border-box",
                                }}
                            />
                            <div style={{ display: "flex", justifyContent: "flex-end" }}>
                                <button
                                    type="button"
                                    onClick={() => onSubmitComment(poi)}
                                    disabled={isSubmittingInteraction}
                                    style={{
                                        border: "1px solid #0f172a",
                                        background: "#0f172a",
                                        color: "#fff",
                                        borderRadius: "8px",
                                        padding: "8px 12px",
                                        fontSize: "0.78rem",
                                        fontWeight: 700,
                                        cursor: isSubmittingInteraction ? "not-allowed" : "pointer",
                                        opacity: isSubmittingInteraction ? 0.65 : 1,
                                    }}
                                >
                                    {isSubmittingInteraction ? "Saving..." : "Submit for review"}
                                </button>
                            </div>

                            {isLoadingComments ? (
                                <div style={{ fontSize: "0.78rem", color: "#64748b" }}>Loading comments...</div>
                            ) : commentsError ? (
                                <div style={{ fontSize: "0.78rem", color: "#991b1b" }}>{commentsError}</div>
                            ) : comments.length ? (
                                <div style={{ display: "grid", gap: "6px" }}>
                                    {comments.slice(0, 8).map((comment) => (
                                        <div
                                            key={comment.id}
                                            style={{
                                                border: "1px solid #e2e8f0",
                                                borderRadius: "8px",
                                                padding: "8px",
                                                background: "#f8fafc",
                                            }}
                                        >
                                            <div style={{ fontSize: "0.8rem", color: "#334155", whiteSpace: "pre-wrap" }}>{comment.body}</div>
                                            <div style={{ marginTop: "4px", fontSize: "0.7rem", color: "#64748b" }}>
                                                {new Date(comment.created_at).toLocaleDateString("en-GB")}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div style={{ fontSize: "0.78rem", color: "#64748b" }}>No approved comments yet.</div>
                            )}
                        </div>
                    ) : null}
                </div>
            </div>
        </>
    );
}
