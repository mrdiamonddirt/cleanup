import React, { useEffect, useRef, useState } from "react";
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
        u.searchParams.set("width", String(width));
        u.searchParams.set("quality", String(quality));
        return u.toString();
    } catch {
        return url;
    }
}

export default function FullscreenImageViewer({
    isOpen,
    isMobile,
    selectedItem,
    selectedCounts,
    selectedStory,
    selectedGps,
    selectedGeoLookup,
    isResolvingGeoLookup,
    selectedMapsUrl,
    onClose,
    TYPE_LABELS,
    normalizeType,
    formatStoryDate,
    formatTimeInRiver,
    LocationDetailsBlock,
}) {
    const MIN_ZOOM = 1;
    const MAX_ZOOM = 3;
    const ZOOM_STEP = 0.25;
    const [zoomLevel, setZoomLevel] = useState(1);
    const [isDetailsVisible, setIsDetailsVisible] = useState(true);
    const [activeImageIndex, setActiveImageIndex] = useState(0);
    const [displayImageUrl, setDisplayImageUrl] = useState(null);
    const [isFullImageReady, setIsFullImageReady] = useState(false);
    const swipeTouchStartX = useRef(null);
    const prefetchedFullResUrlsRef = useRef(new Set());

    useEffect(() => {
        if (!isOpen) return;
        setZoomLevel(1);
        setIsDetailsVisible(true);
        setActiveImageIndex(0);
    }, [isOpen, selectedItem?.id]);

    const hasPrimaryImage = Boolean(selectedItem?.image_url);
    const hasReferenceImage = Boolean(selectedStory?.referenceImageUrl);
    const images = hasPrimaryImage
        ? [
            { url: selectedItem.image_url, label: null },
            ...(hasReferenceImage
                ? [{ url: selectedStory.referenceImageUrl, label: "Reference Image", sourceLink: selectedStory.referenceImageCaption }]
                : []),
        ]
        : [];
    const activeImage = images[activeImageIndex] ?? images[0] ?? null;
    const activeImageUrl = activeImage?.url ?? null;
    const canGoPrev = activeImageIndex > 0;
    const canGoNext = activeImageIndex < images.length - 1;
    const clampZoom = (value) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
    const zoomPercent = Math.round(zoomLevel * 100);

    useEffect(() => {
        if (!isOpen || !activeImageUrl) {
            setDisplayImageUrl(null);
            setIsFullImageReady(false);
            return;
        }

        const previewUrl = getStorageThumbnailUrl(activeImageUrl, 900, 72);
        const usesFullImageDirectly = previewUrl === activeImageUrl;
        setDisplayImageUrl(previewUrl);
        setIsFullImageReady(usesFullImageDirectly);

        if (usesFullImageDirectly) {
            return;
        }

        let cancelled = false;
        const fullImage = new Image();
        fullImage.src = activeImageUrl;

        const promoteFullImage = () => {
            if (cancelled) return;
            setDisplayImageUrl(activeImageUrl);
            setIsFullImageReady(true);
            prefetchedFullResUrlsRef.current.add(activeImageUrl);
        };

        fullImage.onload = promoteFullImage;
        fullImage.onerror = promoteFullImage;

        if (fullImage.complete) {
            promoteFullImage();
        }

        return () => {
            cancelled = true;
        };
    }, [isOpen, activeImageUrl]);

    useEffect(() => {
        if (!isOpen || images.length < 2) return;

        const neighbors = [
            images[activeImageIndex - 1]?.url,
            images[activeImageIndex + 1]?.url,
        ].filter(Boolean);

        neighbors.forEach((url) => {
            if (prefetchedFullResUrlsRef.current.has(url)) return;
            const img = new Image();
            img.src = url;
            img.onload = () => prefetchedFullResUrlsRef.current.add(url);
            img.onerror = () => prefetchedFullResUrlsRef.current.add(url);
        });
    }, [isOpen, images, activeImageIndex]);

    if (!isOpen || !selectedCounts || !activeImage) return null;

    const handleTouchStart = (e) => {
        if (zoomLevel > 1) { swipeTouchStartX.current = null; return; }
        swipeTouchStartX.current = e.touches[0].clientX;
    };
    const handleTouchEnd = (e) => {
        if (swipeTouchStartX.current === null || images.length < 2) return;
        const delta = e.changedTouches[0].clientX - swipeTouchStartX.current;
        swipeTouchStartX.current = null;
        if (Math.abs(delta) < 50) return;
        if (delta < 0) {
            // swipe left -> next (wrap around)
            setActiveImageIndex((i) => (i + 1) % images.length);
        } else {
            // swipe right -> prev (wrap around)
            setActiveImageIndex((i) => (i - 1 + images.length) % images.length);
        }
        setZoomLevel(1);
    };
    const timeInRiverLabel = formatTimeInRiver(
        selectedStory?.knownSinceDate,
        selectedStory?.recoveredOnDate,
    );

    const viewerNode = (
        <div
            style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0, 0, 0, 0.92)",
                zIndex: 2100,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: isMobile ? "8px" : "20px",
                boxSizing: "border-box",
            }}
        >
            <div
                style={{
                    position: "absolute",
                    top: "10px",
                    left: "10px",
                    display: "flex",
                    gap: "8px",
                    alignItems: "center",
                    padding: "8px 10px",
                    borderRadius: "999px",
                    border: "1px solid rgba(255,255,255,0.25)",
                    background: "rgba(0,0,0,0.42)",
                    color: "#fff",
                    zIndex: 2,
                }}
            >
                <button
                    type="button"
                    onClick={() => setZoomLevel((prev) => clampZoom(prev - ZOOM_STEP))}
                    disabled={zoomLevel <= MIN_ZOOM}
                    style={{
                        width: "32px",
                        height: "32px",
                        borderRadius: "50%",
                        border: "1px solid rgba(255,255,255,0.35)",
                        background: "rgba(15,23,42,0.5)",
                        color: "#fff",
                        fontSize: "1.1rem",
                        cursor: "pointer",
                        opacity: zoomLevel <= MIN_ZOOM ? 0.45 : 1,
                    }}
                    aria-label="Zoom out"
                >
                    -
                </button>

                <input
                    type="range"
                    min={MIN_ZOOM}
                    max={MAX_ZOOM}
                    step={ZOOM_STEP}
                    value={zoomLevel}
                    onChange={(event) => setZoomLevel(Number(event.target.value))}
                    aria-label="Zoom level"
                />

                <button
                    type="button"
                    onClick={() => setZoomLevel((prev) => clampZoom(prev + ZOOM_STEP))}
                    disabled={zoomLevel >= MAX_ZOOM}
                    style={{
                        width: "32px",
                        height: "32px",
                        borderRadius: "50%",
                        border: "1px solid rgba(255,255,255,0.35)",
                        background: "rgba(15,23,42,0.5)",
                        color: "#fff",
                        fontSize: "1.1rem",
                        cursor: "pointer",
                        opacity: zoomLevel >= MAX_ZOOM ? 0.45 : 1,
                    }}
                    aria-label="Zoom in"
                >
                    +
                </button>

                <button
                    type="button"
                    onClick={() => setZoomLevel(1)}
                    style={{
                        borderRadius: "999px",
                        border: "1px solid rgba(255,255,255,0.35)",
                        background: "rgba(15,23,42,0.45)",
                        color: "#fff",
                        fontSize: "0.78rem",
                        fontWeight: 700,
                        padding: "6px 9px",
                        cursor: "pointer",
                    }}
                    aria-label="Reset zoom"
                >
                    {zoomPercent}%
                </button>

                <button
                    type="button"
                    onClick={() => setIsDetailsVisible((prev) => !prev)}
                    style={{
                        borderRadius: "999px",
                        border: "1px solid rgba(255,255,255,0.35)",
                        background: "rgba(15,23,42,0.45)",
                        color: "#fff",
                        fontSize: "0.78rem",
                        fontWeight: 700,
                        padding: "6px 10px",
                        cursor: "pointer",
                    }}
                    aria-label={isDetailsVisible ? "Hide details panel" : "Show details panel"}
                >
                    {isDetailsVisible ? "Hide Details" : "Show Details"}
                </button>
            </div>

            <button
                onClick={onClose}
                style={{
                    position: "absolute",
                    top: "10px",
                    right: "10px",
                    zIndex: 3,
                    width: "40px",
                    height: "40px",
                    borderRadius: "50%",
                    border: "1px solid rgba(255,255,255,0.4)",
                    background: "rgba(0,0,0,0.4)",
                    color: "#fff",
                    fontSize: "1.3rem",
                    cursor: "pointer",
                }}
                aria-label="Close fullscreen image"
            >
                ×
            </button>

            <div
                style={{
                    position: "absolute",
                    inset: 0,
                    overflow: "auto",
                    display: "grid",
                    alignItems: "start",
                    justifyItems: "center",
                    touchAction: zoomLevel > 1 ? "pan-x pan-y pinch-zoom" : "pan-y pinch-zoom",
                    padding: isMobile ? "58px 8px 8px" : "64px 20px 20px",
                    paddingBottom: isDetailsVisible ? (isMobile ? "150px" : "172px") : (isMobile ? "12px" : "20px"),
                    boxSizing: "border-box",
                }}
                onTouchStart={images.length > 1 ? handleTouchStart : undefined}
                onTouchEnd={images.length > 1 ? handleTouchEnd : undefined}
            >
                <div
                    style={{
                        width: "100%",
                        display: "grid",
                        gap: "10px",
                        justifyItems: "center",
                    }}
                >
                    {activeImage.label ? (
                        <div
                            style={{
                                color: "rgba(226,232,240,0.9)",
                                fontSize: "0.76rem",
                                fontWeight: 700,
                                letterSpacing: "0.06em",
                                textTransform: "uppercase",
                                background: "rgba(15,23,42,0.65)",
                                padding: "4px 12px",
                                borderRadius: "999px",
                                border: "1px solid rgba(148,163,184,0.3)",
                            }}
                        >
                            {activeImage.label}
                        </div>
                    ) : null}

                    <img
                        src={displayImageUrl ?? activeImage.url}
                        alt={activeImage.label ?? "Debris evidence full size"}
                        style={{
                            width: `${zoomPercent}%`,
                            height: "auto",
                            opacity: isFullImageReady ? 1 : 0.92,
                            transition: "opacity 0.2s ease",
                        }}
                    />

                    {!isFullImageReady ? (
                        <div
                            style={{
                                color: "rgba(226,232,240,0.86)",
                                fontSize: "0.78rem",
                                fontWeight: 600,
                            }}
                        >
                            Loading full quality image...
                        </div>
                    ) : null}

                    {activeImage.sourceLink ? (
                        <a
                            href={activeImage.sourceLink}
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: "#93c5fd", fontWeight: 700, fontSize: "0.82rem", textDecoration: "underline" }}
                        >
                            Open Street View source
                        </a>
                    ) : null}
                </div>
            </div>

            {images.length > 1 ? (
                <div
                    style={{
                        position: "absolute",
                        left: "50%",
                        transform: "translateX(-50%)",
                        bottom: isDetailsVisible ? (isMobile ? "154px" : "178px") : "14px",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        zIndex: 2,
                    }}
                >
                    <button
                        type="button"
                        onClick={() => { setActiveImageIndex((i) => i - 1); setZoomLevel(1); }}
                        disabled={!canGoPrev}
                        style={{
                            width: "34px",
                            height: "34px",
                            borderRadius: "50%",
                            border: "1px solid rgba(255,255,255,0.35)",
                            background: "rgba(15,23,42,0.6)",
                            color: "#fff",
                            fontSize: "1rem",
                            cursor: canGoPrev ? "pointer" : "default",
                            opacity: canGoPrev ? 1 : 0.35,
                        }}
                        aria-label="Previous image"
                    >
                        ‹
                    </button>
                    {images.map((_, idx) => (
                        <button
                            key={idx}
                            type="button"
                            onClick={() => { setActiveImageIndex(idx); setZoomLevel(1); }}
                            style={{
                                width: idx === activeImageIndex ? "10px" : "8px",
                                height: idx === activeImageIndex ? "10px" : "8px",
                                borderRadius: "50%",
                                border: "none",
                                background: idx === activeImageIndex ? "#f8fafc" : "rgba(248,250,252,0.35)",
                                cursor: "pointer",
                                padding: 0,
                                transition: "all 0.15s",
                            }}
                            aria-label={`View image ${idx + 1}`}
                        />
                    ))}
                    <button
                        type="button"
                        onClick={() => { setActiveImageIndex((i) => i + 1); setZoomLevel(1); }}
                        disabled={!canGoNext}
                        style={{
                            width: "34px",
                            height: "34px",
                            borderRadius: "50%",
                            border: "1px solid rgba(255,255,255,0.35)",
                            background: "rgba(15,23,42,0.6)",
                            color: "#fff",
                            fontSize: "1rem",
                            cursor: canGoNext ? "pointer" : "default",
                            opacity: canGoNext ? 1 : 0.35,
                        }}
                        aria-label="Next image"
                    >
                        ›
                    </button>
                </div>
            ) : null}

            {isDetailsVisible ? (
                <div
                    style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        bottom: 0,
                        background: "linear-gradient(to top, rgba(0, 0, 0, 0.95), rgba(0, 0, 0, 0.6))",
                        color: "#f8fafc",
                        padding: "10px 14px 14px",
                        fontSize: "0.85rem",
                        lineHeight: 1.45,
                    }}
                >
                    <div style={{ display: "grid", gap: "8px" }}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", color: "#ffffff" }}>
                            <strong style={{ fontSize: "0.96rem" }}>{TYPE_LABELS[normalizeType(selectedItem.type)]}</strong>
                            <span style={{ color: "rgba(226,232,240,0.82)" }}>•</span>
                            <span style={{ color: "rgba(241,245,249,0.92)" }}>
                                {selectedCounts.isRecovered ? "Recovered" : "In Water"}
                            </span>
                        </div>

                        <div style={{ color: "rgba(226,232,240,0.86)" }}>
                            Spotted: {new Date(selectedItem.created_at).toLocaleString()}
                        </div>

                        {selectedStory?.knownSinceDate ? (
                            <div style={{ color: "rgba(226,232,240,0.86)" }}>
                                Known in river since: {formatStoryDate(selectedStory.knownSinceDate)}
                            </div>
                        ) : null}

                        {selectedStory?.recoveredOnDate ? (
                            <div style={{ color: "rgba(226,232,240,0.86)" }}>
                                Recovered on: {formatStoryDate(selectedStory.recoveredOnDate)}
                                {timeInRiverLabel ? ` (${timeInRiverLabel} in river)` : ""}
                            </div>
                        ) : null}

                        <LocationDetailsBlock
                            gps={selectedGps}
                            geoLookup={selectedGeoLookup}
                            isResolving={isResolvingGeoLookup}
                            mapsUrl={selectedMapsUrl}
                            mapPoint={{ latitude: selectedItem.y, longitude: selectedItem.x }}
                            compact
                            inverted
                            w3wAddress={selectedItem.w3w_address ?? null}
                        />
                    </div>
                </div>
            ) : null}
        </div>
    );

    return createPortal(viewerNode, document.body);
}
