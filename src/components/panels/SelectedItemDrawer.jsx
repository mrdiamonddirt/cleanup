import React from "react";
import { createPortal } from "react-dom";

function getStorageThumbnailUrl(url, width = 400, quality = 75) {
    if (!url) return url;
    try {
        const u = new URL(url);
        if (!u.pathname.includes("/storage/v1/object/public/")) return url;
        u.pathname = u.pathname.replace(
            "/storage/v1/object/public/",
            "/storage/v1/render/image/public/",
        );
        // Force non-cropping resize so the whole image is always visible.
        u.searchParams.set("resize", "contain");
        u.searchParams.set("width", String(width));
        u.searchParams.set("quality", String(quality));
        return u.toString();
    } catch {
        return url;
    }
}

export default function SelectedItemDrawer({
    selectedItem,
    selectedCounts,
    selectedStory,
    selectedGps,
    selectedGeoLookup,
    isResolvingGeoLookup,
    selectedMapsUrl,
    selectedWeight,
    editingItemId,
    editForm,
    isUpdatingItemId,
    isMobile,
    setSelectedItemId,
    setEditingItemId,
    setEditForm,
    setIsImageViewerOpen,
    saveItemEdits,
    removeLocation,
    startEditingItem,
    canManageItems,
    markItemRecovered,
    lastSaveResult,
    onUploadReferenceImage,
    isUploadingReferenceImage,
    onCopyShareLink,
    copiedShareItemId,
    shareCopyStatus,
    onLikeItem,
    itemLikeCount,
    itemShareCount,
    itemInteractionStatus,
    itemInteractionError,
    itemCommentDraft,
    onItemCommentDraftChange,
    onSubmitItemComment,
    itemComments,
    isLoadingItemComments,
    itemCommentsError,
    isSubmittingItemInteraction,
    TYPE_LABELS,
    normalizeType,
    formatTimeInRiver,
    isItemStoryEmpty,
    formatStoryDate,
    DetailBadge,
    formatWeightKg,
    LocationDetailsBlock,
    getDefaultWeightForType,
    parseEstimatedWeightKg,
    clampInt,
    normalizeOptionalDateInput,
}) {
    if (!selectedItem || !selectedCounts) return null;
    const useCompactLayout =
        isMobile || (typeof window !== "undefined" && window.innerWidth <= 1024);
    const useBottomSheet = isMobile;
    const useCompactDesktop = !useBottomSheet && useCompactLayout;
    const isEditingThisItem = canManageItems && editingItemId === selectedItem.id;
    const compactNoScroll = false;
    const statGridColumns = useCompactLayout ? "repeat(2, minmax(0, 1fr))" : "repeat(4, minmax(0, 1fr))";
    const imagePanelHeight = useCompactLayout ? "min(23svh, 180px)" : "208px";
    const itemTypeLabel = TYPE_LABELS[normalizeType(selectedItem.type)];
    const itemStatusLabel = selectedCounts.isRecovered ? "Recovered" : "In Water";
    const shareCountLabel = Number.isFinite(Number(itemShareCount)) ? Number(itemShareCount) : 0;
    const likeCountLabel = Number.isFinite(Number(itemLikeCount)) ? Number(itemLikeCount) : 0;
    const shareButtonLabel = copiedShareItemId === selectedItem.id && shareCopyStatus
        ? `Copied (${shareCountLabel})`
        : `Share (${shareCountLabel})`;
    const useDenseDesktopCard = !useBottomSheet && !isEditingThisItem;
    const timeInRiverLabel = formatTimeInRiver(
        selectedStory?.knownSinceDate,
        selectedStory?.recoveredOnDate,
    );
    const selectedItemPreviewSmall = getStorageThumbnailUrl(selectedItem?.image_url, 180, 52);
    const selectedItemPreviewMedium = getStorageThumbnailUrl(selectedItem?.image_url, 320, 60);
    const selectedItemPreviewLarge = getStorageThumbnailUrl(selectedItem?.image_url, 560, 68);
    const selectedItemPreviewSrcSet = [
        `${selectedItemPreviewSmall} 180w`,
        `${selectedItemPreviewMedium} 320w`,
        `${selectedItemPreviewLarge} 560w`,
    ].join(", ");
    const selectedItemPreviewSizes = useCompactLayout
        ? "calc(100vw - 56px)"
        : "240px";

    const drawerNode = (
        <>
            <div
                onClick={() => {
                    setSelectedItemId(null);
                    setEditingItemId(null);
                }}
                style={{
                    position: "fixed",
                    inset: 0,
                    background: "rgba(2, 6, 23, 0.45)",
                    zIndex: 1499,
                }}
            />

            <div
                data-drawer-version={useBottomSheet ? "v5-bottom-sheet" : "v5-desktop-card"}
                style={{
                    position: "fixed",
                    ...(useBottomSheet ? {
                        left: "8px",
                        right: "8px",
                        bottom: "max(8px, env(safe-area-inset-bottom, 0px))",
                        top: "max(10px, env(safe-area-inset-top, 0px) + 8px)",
                        width: "auto",
                        maxHeight: "calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 18px)",
                        borderRadius: "22px",
                    } : {
                        left: useCompactDesktop ? "10px" : "max(14px, env(safe-area-inset-left, 0px) + 8px)",
                        right: useCompactDesktop ? "10px" : "max(14px, env(safe-area-inset-right, 0px) + 8px)",
                        top: "max(12px, env(safe-area-inset-top, 0px) + 8px)",
                        bottom: "max(12px, env(safe-area-inset-bottom, 0px) + 8px)",
                        width: useCompactDesktop
                            ? "auto"
                            : "min(900px, calc(100vw - 36px))",
                        maxHeight: "none",
                        margin: useCompactDesktop ? "0" : "0 auto",
                        borderRadius: "18px",
                    }),
                    overflowY: compactNoScroll ? "hidden" : useBottomSheet || isEditingThisItem ? "auto" : "hidden",
                    background: "#ffffff",
                    boxShadow: "0 24px 60px rgba(0,0,0,0.32)",
                    zIndex: 1500,
                    padding: useBottomSheet
                        ? "10px 10px calc(env(safe-area-inset-bottom, 0px) + 10px)"
                        : useDenseDesktopCard ? "10px" : "12px",
                    boxSizing: "border-box",
                    display: "flex",
                    flexDirection: "column",
                    border: "1px solid rgba(219, 227, 238, 0.95)",
                }}
            >
                {useBottomSheet ? (
                    <div
                        aria-hidden="true"
                        style={{
                            width: "42px",
                            height: "5px",
                            borderRadius: "999px",
                            background: "#d7dee8",
                            margin: "0 auto 10px",
                            flexShrink: 0,
                        }}
                    />
                ) : null}

                <div
                    style={{
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        gap: "12px",
                        marginBottom: compactNoScroll ? "6px" : useBottomSheet ? "10px" : useDenseDesktopCard ? "6px" : "8px",
                        padding: useBottomSheet ? "2px 2px 8px" : "2px 2px 8px",
                        borderBottom: "1px solid rgba(226,232,240,0.92)",
                    }}
                >
                    <div style={{ minWidth: 0, display: "grid", gap: "4px" }}>
                        <div
                            style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "6px",
                                width: "fit-content",
                                padding: "4px 9px",
                                borderRadius: "999px",
                                background: "#eff6ff",
                                border: "1px solid #dbeafe",
                                color: "#1d4ed8",
                                fontSize: "0.68rem",
                                fontWeight: 700,
                                letterSpacing: "0.06em",
                                textTransform: "uppercase",
                            }}
                        >
                            <span
                                aria-hidden="true"
                                style={{
                                    width: "7px",
                                    height: "7px",
                                    borderRadius: "999px",
                                    background: selectedCounts.isRecovered ? "#22c55e" : "#f59e0b",
                                    boxShadow: selectedCounts.isRecovered
                                        ? "0 0 0 4px rgba(34,197,94,0.14)"
                                        : "0 0 0 4px rgba(245,158,11,0.14)",
                                }}
                            />
                            Cleanup Item
                        </div>
                        <strong
                            style={{
                                fontSize: useBottomSheet ? "1.12rem" : "1.22rem",
                                lineHeight: 1.1,
                                color: "#0f172a",
                            }}
                        >
                            {itemTypeLabel} recovery log
                        </strong>
                        <div
                            style={{
                                display: "flex",
                                flexWrap: "wrap",
                                gap: "8px",
                                alignItems: "center",
                                color: "#64748b",
                                fontSize: useDenseDesktopCard ? "0.77rem" : "0.8rem",
                            }}
                        >
                            <span>{new Date(selectedItem.created_at).toLocaleDateString()}</span>
                            <span aria-hidden="true" style={{ color: "#cbd5e1" }}>•</span>
                            <span style={{ color: "#334155", fontWeight: 600 }}>{itemStatusLabel}</span>
                        </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                        {typeof onLikeItem === "function" ? (
                            <button
                                onClick={() => onLikeItem(selectedItem.id)}
                                disabled={Boolean(isSubmittingItemInteraction)}
                                style={{
                                    border: "1px solid #86efac",
                                    background: "#dcfce7",
                                    color: "#166534",
                                    borderRadius: "999px",
                                    height: "34px",
                                    padding: "0 14px",
                                    fontWeight: 700,
                                    fontSize: "0.84rem",
                                    letterSpacing: "0.01em",
                                    cursor: Boolean(isSubmittingItemInteraction) ? "not-allowed" : "pointer",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    gap: "7px",
                                    boxShadow: "0 10px 18px rgba(22,163,74,0.14)",
                                    opacity: Boolean(isSubmittingItemInteraction) ? 0.7 : 1,
                                }}
                            >
                                Like ({likeCountLabel})
                            </button>
                        ) : null}
                        {onCopyShareLink ? (
                            <button
                                onClick={() => onCopyShareLink(selectedItem.id)}
                                style={{
                                    border: "1px solid #bfdbfe",
                                    background: copiedShareItemId === selectedItem.id && shareCopyStatus
                                        ? "linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%)"
                                        : "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)",
                                    color: copiedShareItemId === selectedItem.id && shareCopyStatus ? "#166534" : "#1d4ed8",
                                    borderRadius: "999px",
                                    height: "34px",
                                    padding: "0 14px",
                                    fontWeight: 700,
                                    fontSize: "0.84rem",
                                    letterSpacing: "0.01em",
                                    cursor: "pointer",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    gap: "7px",
                                    boxShadow: copiedShareItemId === selectedItem.id && shareCopyStatus
                                        ? "0 10px 18px rgba(34,197,94,0.18)"
                                        : "0 10px 18px rgba(37,99,235,0.14)",
                                    transition: "transform 160ms ease, box-shadow 160ms ease",
                                }}
                            >
                                <span aria-hidden="true" style={{ fontSize: "0.95rem", transform: "translateY(-0.5px)" }}>
                                    {copiedShareItemId === selectedItem.id && shareCopyStatus ? "✓" : "↗"}
                                </span>
                                {shareButtonLabel}
                            </button>
                        ) : null}
                        <button
                            onClick={() => {
                                setSelectedItemId(null);
                                setEditingItemId(null);
                            }}
                            style={{
                                border: "1px solid #dbe3ee",
                                background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
                                borderRadius: "999px",
                                width: "34px",
                                height: "34px",
                                fontWeight: 700,
                                cursor: "pointer",
                                color: "#475569",
                                boxShadow: "0 6px 14px rgba(15,23,42,0.08)",
                                transition: "transform 160ms ease, box-shadow 160ms ease",
                            }}
                            aria-label="Close details"
                        >
                            ×
                        </button>
                    </div>
                </div>

                {/* Two-column on desktop, stacked on mobile */}
                <div style={{
                    display: compactNoScroll ? "flex" : useCompactLayout ? "block" : "flex",
                    gap: compactNoScroll ? "10px" : useBottomSheet ? "14px" : useDenseDesktopCard ? "10px" : "12px",
                    alignItems: "flex-start",
                    flex: compactNoScroll ? 1 : "0 0 auto",
                    minHeight: 0,
                }}>
                    {/* Left: image */}
                    <div style={{
                        flexShrink: 0,
                        width: compactNoScroll ? "42%" : useCompactLayout ? "100%" : "240px",
                        marginBottom: compactNoScroll ? 0 : useCompactLayout ? "8px" : useDenseDesktopCard ? "0" : "0",
                    }}>
                        {selectedItem.image_url ? (
                            <button
                                onClick={() => setIsImageViewerOpen(true)}
                                style={{
                                    border: "1px solid #dbe3ee",
                                    background: "linear-gradient(180deg, #f8fbff 0%, #f1f5f9 100%)",
                                    width: "100%",
                                    padding: useBottomSheet ? "8px" : useDenseDesktopCard ? "8px" : "10px",
                                    cursor: "zoom-in",
                                    display: "block",
                                    borderRadius: useBottomSheet ? "18px" : "16px",
                                    boxShadow: "0 10px 24px rgba(15,23,42,0.08)",
                                }}
                            >
                                <div
                                    style={{
                                        width: "100%",
                                        height: imagePanelHeight,
                                        borderRadius: useBottomSheet ? "14px" : "12px",
                                        background: "rgba(255,255,255,0.9)",
                                        border: "1px solid rgba(203,213,225,0.9)",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        overflow: "hidden",
                                    }}
                                >
                                    <img
                                        src={selectedItemPreviewMedium}
                                        srcSet={selectedItemPreviewSrcSet}
                                        sizes={selectedItemPreviewSizes}
                                        alt="Debris evidence"
                                        loading="eager"
                                        fetchPriority="high"
                                        decoding="async"
                                        style={{
                                            width: "100%",
                                            height: "100%",
                                            objectFit: "contain",
                                            display: "block",
                                        }}
                                    />
                                </div>
                                {useBottomSheet ? (
                                    <div
                                        style={{
                                            marginTop: "6px",
                                            fontSize: "0.74rem",
                                            color: "#64748b",
                                            textAlign: "left",
                                        }}
                                    >
                                        Full image shown. Tap to expand.
                                    </div>
                                ) : null}
                            </button>
                        ) : (
                            <div style={{
                                padding: "10px",
                                color: "#999",
                                fontSize: "0.8rem",
                                fontStyle: "italic",
                                border: "1px dashed #cbd5e1",
                                borderRadius: useBottomSheet ? "18px" : "12px",
                                height: useCompactLayout ? "140px" : "220px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                            }}>
                                No photo attached
                            </div>
                        )}

                        {!isItemStoryEmpty(selectedStory) ? (
                            <div
                                style={{
                                    display: "grid",
                                    gap: "5px",
                                    marginTop: "8px",
                                    padding: compactNoScroll ? "8px 9px" : useBottomSheet ? "8px 9px" : "10px 11px",
                                    borderRadius: "12px",
                                    border: "1px solid #dbe3ee",
                                    background: "#f8fafc",
                                    color: "#334155",
                                    fontSize: compactNoScroll ? "0.78rem" : useBottomSheet ? "0.8rem" : "0.83rem",
                                    lineHeight: 1.45,
                                }}
                            >
                                {selectedStory?.knownSinceDate ? (
                                    <div>
                                        Known in river since: <strong style={{ color: "#0f172a" }}>{formatStoryDate(selectedStory.knownSinceDate)}</strong>
                                    </div>
                                ) : null}
                                {selectedStory?.recoveredOnDate ? (
                                    <div>
                                        Recovered on: <strong style={{ color: "#0f172a" }}>{formatStoryDate(selectedStory.recoveredOnDate)}</strong>
                                    </div>
                                ) : null}
                                {timeInRiverLabel ? (
                                    <div>
                                        Time in river: <strong style={{ color: "#0f172a" }}>{timeInRiverLabel}</strong>
                                    </div>
                                ) : null}
                                {selectedStory?.referenceImageUrl ? (
                                    <div style={{ color: "#1d4ed8", fontWeight: 600 }}>
                                        Includes reference image in fullscreen viewer.
                                    </div>
                                ) : null}
                                {selectedStory?.referenceImageCaption ? (
                                    <a
                                        href={selectedStory.referenceImageCaption}
                                        target="_blank"
                                        rel="noreferrer"
                                        style={{ color: "#1d4ed8", fontWeight: 700, width: "fit-content" }}
                                    >
                                        Open Street View source
                                    </a>
                                ) : null}
                            </div>
                        ) : null}

                        <div style={{ marginTop: "8px" }}>
                            <LocationDetailsBlock
                                gps={selectedGps}
                                geoLookup={selectedGeoLookup}
                                isResolving={isResolvingGeoLookup}
                                mapsUrl={selectedMapsUrl}
                                compact={compactNoScroll || useDenseDesktopCard}
                                w3wAddress={selectedItem.w3w_address ?? null}
                            />
                        </div>
                    </div>

                    {/* Right: details + actions */}
                    <div style={{
                        flex: 1,
                        minWidth: 0,
                        display: "flex",
                        flexDirection: "column",
                        minHeight: 0,
                        overflowY: useCompactLayout ? "visible" : "auto",
                        paddingRight: useCompactLayout ? 0 : "2px",
                    }}>
                        <div style={{
                            display: "grid",
                            gap: compactNoScroll ? "7px" : useBottomSheet ? "8px" : useDenseDesktopCard ? "7px" : "10px",
                            marginBottom: compactNoScroll ? "6px" : useBottomSheet ? "6px" : "6px",
                        }}>
                            <div style={{ color: "#64748b", fontSize: compactNoScroll ? "0.8rem" : "0.84rem" }}>
                                Spotted: {new Date(selectedItem.created_at).toLocaleString()}
                            </div>

                            <div style={{ display: "grid", gridTemplateColumns: statGridColumns, gap: "8px", minWidth: 0 }}>
                                <DetailBadge
                                    label="Status"
                                    value={selectedCounts.isRecovered ? "Recovered" : "In Water"}
                                    tone={selectedCounts.isRecovered ? "success" : "warning"}
                                    compact={compactNoScroll || useDenseDesktopCard}
                                />
                                <DetailBadge label="Total" value={selectedCounts.total} compact={compactNoScroll || useDenseDesktopCard} />
                                <DetailBadge label="Recovered" value={selectedCounts.recovered} compact={compactNoScroll || useDenseDesktopCard} />
                                <DetailBadge label="In Water" value={selectedCounts.inWater} compact={compactNoScroll || useDenseDesktopCard} />
                            </div>

                            {selectedWeight ? (
                                <div
                                    style={{
                                        display: "grid",
                                        gap: "2px",
                                        padding: compactNoScroll ? "8px 9px" : useBottomSheet ? "8px 9px" : "10px 11px",
                                        borderRadius: "12px",
                                        border: "1px solid #dbe3ee",
                                        background: "#f8fafc",
                                        color: "#334155",
                                        fontSize: compactNoScroll ? "0.78rem" : useBottomSheet ? "0.8rem" : "0.83rem",
                                        lineHeight: 1.45,
                                    }}
                                >
                                    <div>
                                        Est. weight per item: <strong style={{ color: "#0f172a" }}>{formatWeightKg(selectedWeight.value)}</strong>
                                        {selectedWeight.source === "default" ? " (default)" : ""}
                                    </div>
                                    <div>
                                        Est. total at location: <strong style={{ color: "#0f172a" }}>{formatWeightKg(selectedWeight.value * selectedCounts.total)}</strong>
                                    </div>
                                </div>
                            ) : null}

                            {copiedShareItemId === selectedItem.id && shareCopyStatus ? (
                                <div style={{ marginTop: "4px", color: "#0f766e", fontWeight: 600, fontSize: "0.78rem" }}>
                                    {shareCopyStatus}
                                </div>
                            ) : null}

                            {itemInteractionStatus ? (
                                <div style={{ marginTop: "4px", color: "#155e75", fontWeight: 600, fontSize: "0.78rem" }}>
                                    {itemInteractionStatus}
                                </div>
                            ) : null}

                            {itemInteractionError ? (
                                <div style={{ marginTop: "4px", color: "#991b1b", fontWeight: 600, fontSize: "0.78rem" }}>
                                    {itemInteractionError}
                                </div>
                            ) : null}
                        </div>

                        {typeof onSubmitItemComment === "function" ? (
                            <div
                                style={{
                                    display: "grid",
                                    gap: "8px",
                                    flex: useCompactLayout ? "0 0 auto" : "1 1 auto",
                                    minHeight: 0,
                                    marginBottom: compactNoScroll ? "8px" : useBottomSheet ? "12px" : "8px",
                                    padding: compactNoScroll ? "7px 8px" : useBottomSheet ? "9px 10px" : "8px 9px",
                                    borderRadius: "10px",
                                    border: "1px solid #e2e8f0",
                                    background: "#f8fafc",
                                }}
                            >
                                <div style={{ fontSize: "0.74rem", fontWeight: 800, color: "#334155", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                                    Comments
                                </div>
                                <textarea
                                    value={itemCommentDraft || ""}
                                    onChange={(event) => onItemCommentDraftChange?.(event.target.value)}
                                    placeholder="Write a comment. It will be reviewed before publishing."
                                    rows={3}
                                    disabled={Boolean(isSubmittingItemInteraction)}
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
                                        onClick={() => onSubmitItemComment(selectedItem.id)}
                                        disabled={Boolean(isSubmittingItemInteraction)}
                                        style={{
                                            border: "1px solid #0f172a",
                                            background: "#0f172a",
                                            color: "#fff",
                                            borderRadius: "8px",
                                            padding: "8px 12px",
                                            fontSize: "0.78rem",
                                            fontWeight: 700,
                                            cursor: Boolean(isSubmittingItemInteraction) ? "not-allowed" : "pointer",
                                            opacity: Boolean(isSubmittingItemInteraction) ? 0.7 : 1,
                                        }}
                                    >
                                        {Boolean(isSubmittingItemInteraction) ? "Saving..." : "Submit for review"}
                                    </button>
                                </div>

                                {isLoadingItemComments ? (
                                    <div style={{ fontSize: "0.78rem", color: "#64748b" }}>Loading comments...</div>
                                ) : itemCommentsError ? (
                                    <div style={{ fontSize: "0.78rem", color: "#991b1b" }}>{itemCommentsError}</div>
                                ) : Array.isArray(itemComments) && itemComments.length ? (
                                    <div style={{
                                        display: "grid",
                                        gap: "6px",
                                        maxHeight: useCompactLayout ? "220px" : "min(34vh, 320px)",
                                        overflowY: "auto",
                                        paddingRight: "2px",
                                    }}>
                                        {itemComments.map((comment) => (
                                            <div
                                                key={comment.id}
                                                style={{
                                                    border: "1px solid #e2e8f0",
                                                    borderRadius: "8px",
                                                    padding: "8px",
                                                    background: "#ffffff",
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

                        {canManageItems && editingItemId === selectedItem.id ? (
                            <div style={{ textAlign: "left" }}>
                                <div style={{ marginBottom: "8px" }}>
                                    <label style={{ fontSize: "0.8rem", color: "#475569" }}>Type</label>
                                    <select
                                        value={editForm.type}
                                        onChange={(e) =>
                                            setEditForm((prev) => {
                                                const nextType = e.target.value;
                                                const previousDefaultWeight = getDefaultWeightForType(prev.type);
                                                const nextDefaultWeight = getDefaultWeightForType(nextType);
                                                const parsedExistingWeight = parseEstimatedWeightKg(prev.estimatedWeight);
                                                const shouldSyncDefaultWeight =
                                                    parsedExistingWeight === null ||
                                                    Math.abs(parsedExistingWeight - previousDefaultWeight) < 0.1;

                                                return {
                                                    ...prev,
                                                    type: nextType,
                                                    estimatedWeight: shouldSyncDefaultWeight
                                                        ? String(nextDefaultWeight)
                                                        : prev.estimatedWeight,
                                                };
                                            })
                                        }
                                        style={{
                                            width: "100%",
                                            marginTop: "4px",
                                            border: "1px solid #cbd5e1",
                                            borderRadius: "6px",
                                            padding: "8px",
                                        }}
                                    >
                                        <option value="bike">Bike</option>
                                        <option value="historic">Historic find</option>
                                        <option value="motorbike">Motorbike</option>
                                        <option value="trolley">Trolley</option>
                                        <option value="misc">Misc</option>
                                    </select>
                                </div>

                                <div style={{ marginBottom: "8px" }}>
                                    <label style={{ fontSize: "0.8rem", color: "#475569" }}>Estimated Weight Per Item (kg)</label>
                                    <input
                                        type="number"
                                        min="0.1"
                                        step="0.1"
                                        value={editForm.estimatedWeight}
                                        onChange={(e) =>
                                            setEditForm((prev) => ({
                                                ...prev,
                                                estimatedWeight: e.target.value,
                                            }))
                                        }
                                        style={{
                                            width: "100%",
                                            marginTop: "4px",
                                            border: "1px solid #cbd5e1",
                                            borderRadius: "6px",
                                            padding: "8px",
                                            boxSizing: "border-box",
                                        }}
                                    />
                                </div>

                                <div style={{ marginBottom: "8px" }}>
                                    <label style={{ fontSize: "0.8rem", color: "#475569" }}>Total at Location</label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={editForm.total}
                                        onChange={(e) =>
                                            setEditForm((prev) => ({
                                                ...prev,
                                                total: clampInt(e.target.value, 1),
                                            }))
                                        }
                                        style={{
                                            width: "100%",
                                            marginTop: "4px",
                                            border: "1px solid #cbd5e1",
                                            borderRadius: "6px",
                                            padding: "8px",
                                            boxSizing: "border-box",
                                        }}
                                    />
                                </div>

                                <div style={{ marginBottom: "10px" }}>
                                    <label style={{ fontSize: "0.8rem", color: "#475569" }}>Recovered Count</label>
                                    <input
                                        type="number"
                                        min="0"
                                        max={Math.max(1, clampInt(editForm.total, 1))}
                                        value={editForm.recovered}
                                        onChange={(e) =>
                                            setEditForm((prev) => {
                                                const nextTotal = Math.max(1, clampInt(prev.total, 1));
                                                return {
                                                    ...prev,
                                                    recovered: Math.min(nextTotal, clampInt(e.target.value, 0)),
                                                };
                                            })
                                        }
                                        style={{
                                            width: "100%",
                                            marginTop: "4px",
                                            border: "1px solid #cbd5e1",
                                            borderRadius: "6px",
                                            padding: "8px",
                                            boxSizing: "border-box",
                                        }}
                                    />
                                </div>

                                <div style={{ marginBottom: "10px" }}>
                                    <label style={{ fontSize: "0.8rem", color: "#475569" }}>Latitude</label>
                                    <input
                                        type="number"
                                        step="any"
                                        placeholder="e.g. 54.0466"
                                        value={editForm.lat}
                                        onChange={(e) =>
                                            setEditForm((prev) => ({ ...prev, lat: e.target.value }))
                                        }
                                        style={{
                                            width: "100%",
                                            marginTop: "4px",
                                            border: "1px solid #cbd5e1",
                                            borderRadius: "6px",
                                            padding: "8px",
                                            boxSizing: "border-box",
                                        }}
                                    />
                                </div>

                                <div style={{ marginBottom: "10px" }}>
                                    <label style={{ fontSize: "0.8rem", color: "#475569" }}>Longitude</label>
                                    <input
                                        type="number"
                                        step="any"
                                        placeholder="e.g. -2.8007"
                                        value={editForm.lng}
                                        onChange={(e) =>
                                            setEditForm((prev) => ({ ...prev, lng: e.target.value }))
                                        }
                                        style={{
                                            width: "100%",
                                            marginTop: "4px",
                                            border: "1px solid #cbd5e1",
                                            borderRadius: "6px",
                                            padding: "8px",
                                            boxSizing: "border-box",
                                        }}
                                    />
                                </div>

                                <div style={{ marginBottom: "10px" }}>
                                    <label style={{ fontSize: "0.8rem", color: "#475569" }}>Known In River Since</label>
                                    <input
                                        type="date"
                                        value={editForm.knownSinceDate}
                                        onChange={(e) =>
                                            setEditForm((prev) => ({ ...prev, knownSinceDate: e.target.value }))
                                        }
                                        style={{
                                            width: "100%",
                                            marginTop: "4px",
                                            border: "1px solid #cbd5e1",
                                            borderRadius: "6px",
                                            padding: "8px",
                                            boxSizing: "border-box",
                                        }}
                                    />
                                </div>

                                <div style={{ marginBottom: "10px" }}>
                                    <label style={{ fontSize: "0.8rem", color: "#475569" }}>Recovered On</label>
                                    <input
                                        type="date"
                                        value={editForm.recoveredOnDate}
                                        onChange={(e) =>
                                            setEditForm((prev) => ({ ...prev, recoveredOnDate: e.target.value }))
                                        }
                                        style={{
                                            width: "100%",
                                            marginTop: "4px",
                                            border: "1px solid #cbd5e1",
                                            borderRadius: "6px",
                                            padding: "8px",
                                            boxSizing: "border-box",
                                        }}
                                    />
                                </div>

                                <div style={{ marginBottom: "10px" }}>
                                    <label style={{ fontSize: "0.8rem", color: "#475569" }}>Reference Image URL</label>
                                    <input
                                        type="url"
                                        placeholder="https://..."
                                        value={editForm.referenceImageUrl}
                                        onChange={(e) =>
                                            setEditForm((prev) => ({ ...prev, referenceImageUrl: e.target.value }))
                                        }
                                        style={{
                                            width: "100%",
                                            marginTop: "4px",
                                            border: "1px solid #cbd5e1",
                                            borderRadius: "6px",
                                            padding: "8px",
                                            boxSizing: "border-box",
                                        }}
                                    />

                                    <div style={{ marginTop: "8px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                                        <button
                                            type="button"
                                            onClick={() => onUploadReferenceImage?.()}
                                            disabled={Boolean(isUploadingReferenceImage)}
                                            style={{
                                                border: "1px solid #bfdbfe",
                                                background: "#eff6ff",
                                                color: "#1d4ed8",
                                                borderRadius: "999px",
                                                padding: "7px 12px",
                                                fontSize: "0.78rem",
                                                fontWeight: 700,
                                                cursor: isUploadingReferenceImage ? "not-allowed" : "pointer",
                                                opacity: isUploadingReferenceImage ? 0.65 : 1,
                                            }}
                                        >
                                            {isUploadingReferenceImage ? "Uploading..." : "Upload Reference Image"}
                                        </button>
                                    </div>
                                </div>

                                <div style={{ marginBottom: "12px" }}>
                                    <label style={{ fontSize: "0.8rem", color: "#475569" }}>Street View / Source Link</label>
                                    <input
                                        type="url"
                                        placeholder="https://maps.google.com/..."
                                        value={editForm.referenceImageCaption}
                                        onChange={(e) =>
                                            setEditForm((prev) => ({ ...prev, referenceImageCaption: e.target.value }))
                                        }
                                        style={{
                                            width: "100%",
                                            marginTop: "4px",
                                            border: "1px solid #cbd5e1",
                                            borderRadius: "6px",
                                            padding: "8px",
                                            boxSizing: "border-box",
                                        }}
                                    />
                                </div>

                                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                                    <button
                                        onClick={() => saveItemEdits(selectedItem.id)}
                                        disabled={isUpdatingItemId === selectedItem.id}
                                        style={{
                                            flex: "1 1 90px",
                                            padding: "10px",
                                            border: "none",
                                            background: isUpdatingItemId === selectedItem.id ? "#93c5fd" : "#1d4ed8",
                                            color: "#fff",
                                            borderRadius: "6px",
                                            fontWeight: 700,
                                            cursor: isUpdatingItemId === selectedItem.id ? "default" : "pointer",
                                        }}
                                    >
                                        {isUpdatingItemId === selectedItem.id ? "Saving\u2026" : "Save"}
                                    </button>
                                    <button
                                        onClick={() => setEditingItemId(null)}
                                        disabled={isUpdatingItemId === selectedItem.id}
                                        style={{
                                            flex: "1 1 90px",
                                            padding: "10px",
                                            border: "1px solid #cbd5e1",
                                            background: "#fff",
                                            color: "#334155",
                                            borderRadius: "6px",
                                            fontWeight: 600,
                                            cursor: "pointer",
                                        }}
                                    >
                                        Cancel
                                    </button>
                                </div>
                                {lastSaveResult?.itemId === selectedItem.id && lastSaveResult.status === "error" ? (
                                    <div style={{ marginTop: "6px", padding: "8px 10px", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "6px", fontSize: "0.82rem", color: "#b91c1c", fontWeight: 600 }}>
                                        Could not save changes. Please try again.
                                    </div>
                                ) : null}
                            </div>
                        ) : canManageItems ? (
                            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "0" }}>
                                {lastSaveResult?.itemId === selectedItem.id && lastSaveResult.status === "success" ? (
                                    <div style={{ flex: "1 1 100%", padding: "8px 10px", background: "#f0fdf4", border: "1px solid #86efac", borderRadius: "6px", fontSize: "0.82rem", color: "#15803d", fontWeight: 600, textAlign: "center" }}>
                                        Saved ✓
                                    </div>
                                ) : lastSaveResult?.itemId === selectedItem.id && lastSaveResult.status === "recovered" ? (
                                    <div style={{ flex: "1 1 100%", padding: "8px 10px", background: "#f0fdf4", border: "1px solid #86efac", borderRadius: "6px", fontSize: "0.82rem", color: "#15803d", fontWeight: 600, textAlign: "center" }}>
                                        Marked as recovered ✓
                                    </div>
                                ) : lastSaveResult?.itemId === selectedItem.id && lastSaveResult.status === "error" ? (
                                    <div style={{ flex: "1 1 100%", padding: "8px 10px", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "6px", fontSize: "0.82rem", color: "#b91c1c", fontWeight: 600, textAlign: "center" }}>
                                        Could not save. Please try again.
                                    </div>
                                ) : null}
                                {!selectedCounts.isRecovered && (
                                    <button
                                        disabled={isUpdatingItemId === selectedItem.id}
                                        style={{
                                            flex: "1 1 100%",
                                            marginTop: "0",
                                            padding: compactNoScroll ? "8px" : "10px",
                                            backgroundColor: isUpdatingItemId === selectedItem.id ? "#86efac" : "#2ecc71",
                                            color: "white",
                                            border: "none",
                                            borderRadius: "6px",
                                            fontWeight: "bold",
                                            cursor: "pointer",
                                            fontSize: compactNoScroll ? "0.8rem" : "0.9rem",
                                        }}
                                        onClick={() => {
                                            if (markItemRecovered) {
                                                markItemRecovered(selectedItem.id);
                                            }
                                        }}
                                    >
                                        {isUpdatingItemId === selectedItem.id ? "Marking\u2026" : "Mark All Recovered"}
                                    </button>
                                )}
                                <button
                                    onClick={() => startEditingItem(selectedItem)}
                                    style={{
                                        flex: "1 1 90px",
                                        padding: compactNoScroll ? "8px" : "10px",
                                        border: "1px solid #cbd5e1",
                                        background: "#fff",
                                        color: "#0f172a",
                                        borderRadius: "6px",
                                        fontWeight: 600,
                                        cursor: "pointer",
                                    }}
                                >
                                    Edit
                                </button>
                                <button
                                    onClick={() => removeLocation(selectedItem.id)}
                                    disabled={isUpdatingItemId === selectedItem.id}
                                    style={{
                                        flex: "1 1 90px",
                                        padding: compactNoScroll ? "8px" : "10px",
                                        border: "none",
                                        background: "#dc2626",
                                        color: "#fff",
                                        borderRadius: "6px",
                                        fontWeight: 700,
                                        cursor: "pointer",
                                    }}
                                >
                                    Delete
                                </button>
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>
        </>
    );

    return createPortal(drawerNode, document.body);
}
