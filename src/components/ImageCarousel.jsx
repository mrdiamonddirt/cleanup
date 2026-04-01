import React, { useEffect, useState } from "react";

function isHeicUrl(url) {
    const lower = (url || "").toLowerCase();
    return lower.includes(".heic") || lower.includes(".heif");
}

export default function ImageCarousel({ images = [] }) {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [imgError, setImgError] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);

    const hasImages = images && images.length > 0;

    if (!hasImages) {
        return (
            <div
                style={{
                    width: "100%",
                    height: "200px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "#f1f5f9",
                    borderRadius: "12px",
                    color: "#94a3b8",
                    fontSize: "0.85rem",
                }}
            >
                No images available
            </div>
        );
    }

    const currentImage = images[currentIndex];
    const prevIndex = (currentIndex - 1 + images.length) % images.length;
    const nextIndex = (currentIndex + 1) % images.length;

    const handlePrev = () => {
        setCurrentIndex(prevIndex);
        setImgError(false);
    };

    const handleNext = () => {
        setCurrentIndex(nextIndex);
        setImgError(false);
    };

    useEffect(() => {
        setImgError(false);
    }, [currentIndex]);

    useEffect(() => {
        const handleKeyPress = (event) => {
            if (isFullscreen) {
                if (event.key === "Escape") setIsFullscreen(false);
                if (event.key === "ArrowLeft") handlePrev();
                if (event.key === "ArrowRight") handleNext();
                return;
            }

            if (event.key === "ArrowLeft") handlePrev();
            if (event.key === "ArrowRight") handleNext();
        };

        window.addEventListener("keydown", handleKeyPress);
        return () => window.removeEventListener("keydown", handleKeyPress);
    }, [isFullscreen, currentIndex]);

    return (
        <>
            <div
                style={{
                    display: "grid",
                    gap: "10px",
                    borderRadius: "12px",
                    overflow: "hidden",
                    background: "#f8fafc",
                    border: "1px solid #e2e8f0",
                }}
            >
                <div
                    style={{
                        position: "relative",
                        width: "100%",
                        paddingBottom: "66.67%",
                        background: "#f1f5f9",
                        borderRadius: "12px",
                        overflow: "hidden",
                        cursor: "zoom-in",
                    }}
                    onClick={() => setIsFullscreen(true)}
                >
                    {imgError || isHeicUrl(currentImage.image_url) ? (
                        <div
                            style={{
                                position: "absolute",
                                top: 0,
                                left: 0,
                                width: "100%",
                                height: "100%",
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                justifyContent: "center",
                                background: "#1e293b",
                                color: "#94a3b8",
                                padding: "16px",
                                textAlign: "center",
                                gap: "10px",
                            }}
                        >
                            <div style={{ fontSize: "1.8rem" }}>📷</div>
                            <div style={{ fontSize: "0.8rem", color: "#cbd5e1", lineHeight: 1.5 }}>
                                This image is in HEIC format which browsers cannot display.
                            </div>
                            <a
                                href={currentImage.image_url}
                                download
                                onClick={(event) => event.stopPropagation()}
                                style={{
                                    fontSize: "0.75rem",
                                    color: "#60a5fa",
                                    textDecoration: "underline",
                                }}
                            >
                                Download image
                            </a>
                        </div>
                    ) : (
                        <>
                            <img
                                src={currentImage.image_url}
                                alt={currentImage.alt_text || `Image ${currentIndex + 1}`}
                                onError={() => setImgError(true)}
                                style={{
                                    position: "absolute",
                                    inset: 0,
                                    width: "100%",
                                    height: "100%",
                                    objectFit: "contain",
                                    objectPosition: "center",
                                    imageOrientation: "from-image",
                                }}
                            />
                            {images.length > 1 && (
                                <>
                                    <div
                                        onClick={(e) => { e.stopPropagation(); handlePrev(); }}
                                        style={{ position: "absolute", left: 0, top: 0, width: "25%", height: "100%", zIndex: 2, cursor: "pointer" }}
                                    />
                                    <div
                                        onClick={(e) => { e.stopPropagation(); handleNext(); }}
                                        style={{ position: "absolute", right: 0, top: 0, width: "25%", height: "100%", zIndex: 2, cursor: "pointer" }}
                                    />
                                </>
                            )}
                            <div
                                style={{
                                    position: "absolute",
                                    top: 0,
                                    left: 0,
                                    right: 0,
                                    height: "44px",
                                    background: "linear-gradient(180deg, rgba(2,6,23,0.55) 0%, rgba(2,6,23,0) 100%)",
                                    pointerEvents: "none",
                                    zIndex: 3,
                                }}
                            />
                            {images.length > 1 && (
                                <div
                                    style={{
                                        position: "absolute",
                                        top: "8px",
                                        right: "8px",
                                        background: "rgba(15,23,42,0.7)",
                                        color: "#fff",
                                        padding: "4px 9px",
                                        borderRadius: "999px",
                                        fontSize: "0.72rem",
                                        fontWeight: 600,
                                        pointerEvents: "none",
                                        zIndex: 4,
                                    }}
                                >
                                    {currentIndex + 1} / {images.length}
                                </div>
                            )}
                        </>
                    )}
                </div>

                <div style={{ padding: "10px 12px", paddingBottom: "12px" }}>
                    {currentImage.alt_text && (
                        <div
                            style={{
                                fontSize: "0.8rem",
                                fontWeight: 600,
                                color: "#1e293b",
                                marginBottom: "4px",
                            }}
                        >
                            {currentImage.alt_text}
                        </div>
                    )}
                    {currentImage.caption && (
                        <div
                            style={{
                                fontSize: "0.75rem",
                                color: "#64748b",
                                marginBottom: "8px",
                            }}
                        >
                            {currentImage.caption}
                        </div>
                    )}

                    {images.length > 1 && (
                        <div
                            style={{
                                display: "flex",
                                gap: "6px",
                                justifyContent: "center",
                                paddingTop: "8px",
                                borderTop: "1px solid #e2e8f0",
                            }}
                        >
                            {images.map((_, index) => (
                                <button
                                    key={index}
                                    type="button"
                                    onClick={() => setCurrentIndex(index)}
                                    style={{
                                        width: index === currentIndex ? "24px" : "8px",
                                        height: "8px",
                                        borderRadius: "4px",
                                        border: "1px solid #cbd5e1",
                                        background: index === currentIndex ? "#0f766e" : "#e2e8f0",
                                        cursor: "pointer",
                                        transition: "all 0.2s ease",
                                    }}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {isFullscreen && (
                <div
                    onClick={() => setIsFullscreen(false)}
                    style={{
                        position: "fixed",
                        inset: 0,
                        background: "rgba(2,6,23,0.96)",
                        zIndex: 9999,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "14px",
                    }}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            position: "relative",
                            width: "100%",
                            height: "100%",
                            maxWidth: "96vw",
                            maxHeight: "96vh",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                        }}
                    >
                        {imgError || isHeicUrl(currentImage.image_url) ? (
                            <div
                                style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    alignItems: "center",
                                    gap: "14px",
                                    color: "#cbd5e1",
                                    textAlign: "center",
                                }}
                            >
                                <div style={{ fontSize: "3rem" }}>📷</div>
                                <div>This image cannot be previewed in browser.</div>
                                <a
                                    href={currentImage.image_url}
                                    download
                                    style={{ color: "#60a5fa", textDecoration: "underline" }}
                                >
                                    Download image
                                </a>
                            </div>
                        ) : (
                            <img
                                src={currentImage.image_url}
                                alt={currentImage.alt_text || `Image ${currentIndex + 1}`}
                                onError={() => setImgError(true)}
                                style={{
                                    maxWidth: "100%",
                                    maxHeight: "100%",
                                    objectFit: "contain",
                                    imageOrientation: "from-image",
                                }}
                            />
                        )}
                        {images.length > 1 && (
                            <>
                                <div
                                    onClick={(e) => { e.stopPropagation(); handlePrev(); }}
                                    style={{ position: "absolute", left: 0, top: 0, width: "50%", height: "100%", zIndex: 2, cursor: "pointer" }}
                                />
                                <div
                                    onClick={(e) => { e.stopPropagation(); handleNext(); }}
                                    style={{ position: "absolute", right: 0, top: 0, width: "50%", height: "100%", zIndex: 2, cursor: "pointer" }}
                                />
                            </>
                        )}
                        <button
                            type="button"
                            onClick={() => setIsFullscreen(false)}
                            aria-label="Close fullscreen image"
                            style={{
                                position: "absolute",
                                top: "12px",
                                right: "12px",
                                width: "38px",
                                height: "38px",
                                borderRadius: "999px",
                                border: "1px solid rgba(255,255,255,0.25)",
                                background: "rgba(2,6,23,0.45)",
                                color: "#fff",
                                fontSize: "1.2rem",
                                cursor: "pointer",
                                zIndex: 5,
                            }}
                        >
                            ×
                        </button>
                        {images.length > 1 && (
                            <div
                                style={{
                                    position: "absolute",
                                    bottom: "12px",
                                    left: "50%",
                                    transform: "translateX(-50%)",
                                    color: "#fff",
                                    fontSize: "0.8rem",
                                    background: "rgba(2,6,23,0.55)",
                                    padding: "5px 10px",
                                    borderRadius: "999px",
                                    pointerEvents: "none",
                                    zIndex: 5,
                                }}
                            >
                                {currentIndex + 1} / {images.length}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
    );
}
