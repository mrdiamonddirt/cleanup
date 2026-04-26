import React, { useEffect, useMemo, useState } from "react";

const MAX_POI_IMAGES = 10;

const isValidUrl = (url) => {
    if (!url) return true;
    try {
        new URL(url);
        return true;
    } catch {
        return false;
    }
};

const toSlug = (value) =>
    String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");

const isFiniteCoordinate = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;

export default function PoiPanel({
    isOpen,
    onClose,
    canManageItems,
    isMobile,
    mode,
    initialPoi,
    onSavePoi,
    onDeletePoi,
    onUploadPoiImage,
    onRefresh,
    pendingLocation,
}) {
    const [title, setTitle] = useState("");
    const [slug, setSlug] = useState("");
    const [summary, setSummary] = useState("");
    const [description, setDescription] = useState("");
    const [latitude, setLatitude] = useState("");
    const [longitude, setLongitude] = useState("");
    const [periodStartYear, setPeriodStartYear] = useState("");
    const [periodEndYear, setPeriodEndYear] = useState("");
    const [isPub, setIsPub] = useState(false);
    const [isCleanupSupporter, setIsCleanupSupporter] = useState(false);
    const [isHistoric, setIsHistoric] = useState(false);
    const [isMuseum, setIsMuseum] = useState(false);
    const [googleMapsUrl, setGoogleMapsUrl] = useState("");
    const [wikiUrl, setWikiUrl] = useState("");
    const [status, setStatus] = useState("draft");
    const [imageRows, setImageRows] = useState([]);
    const [isSaving, setIsSaving] = useState(false);
    const [statusMessage, setStatusMessage] = useState("");
    const [hasManuallyEditedLatitude, setHasManuallyEditedLatitude] = useState(false);
    const [hasManuallyEditedLongitude, setHasManuallyEditedLongitude] = useState(false);

    const isEditMode = mode === "edit";
    const existingImageCount = Number(initialPoi?.poi_images?.length || 0);
    const maxNewImages = Math.max(MAX_POI_IMAGES - existingImageCount, 0);
    const detailsGridColumns = isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))";

    const resetForm = () => {
        setTitle("");
        setSlug("");
        setSummary("");
        setDescription("");
        setLatitude("");
        setLongitude("");
        setPeriodStartYear("");
        setPeriodEndYear("");
        setIsPub(false);
        setIsCleanupSupporter(false);
        setIsHistoric(false);
        setIsMuseum(false);
        setGoogleMapsUrl("");
        setWikiUrl("");
        setStatus("draft");
        setImageRows([]);
        setStatusMessage("");
        setHasManuallyEditedLatitude(false);
        setHasManuallyEditedLongitude(false);
    };

    const canSave = useMemo(() => {
        if (!canManageItems || isSaving) return false;
        if (!title.trim() || !slug.trim()) return false;
        if (!isValidUrl(googleMapsUrl) || !isValidUrl(wikiUrl)) return false;

        const lat = Number.parseFloat(latitude);
        const lng = Number.parseFloat(longitude);
        return isFiniteCoordinate(lat, -90, 90) && isFiniteCoordinate(lng, -180, 180);
    }, [canManageItems, isSaving, title, slug, latitude, longitude, googleMapsUrl, wikiUrl]);

    useEffect(() => {
        if (!isOpen || !canManageItems || isEditMode || !pendingLocation) return;

        const nextLatitude = Number(pendingLocation?.y);
        const nextLongitude = Number(pendingLocation?.x);
        if (!isFiniteCoordinate(nextLatitude, -90, 90) || !isFiniteCoordinate(nextLongitude, -180, 180)) {
            return;
        }

        if (!hasManuallyEditedLatitude) {
            setLatitude(nextLatitude.toFixed(6));
        }
        if (!hasManuallyEditedLongitude) {
            setLongitude(nextLongitude.toFixed(6));
        }
    }, [
        isOpen,
        canManageItems,
        isEditMode,
        pendingLocation,
        hasManuallyEditedLatitude,
        hasManuallyEditedLongitude,
    ]);

    useEffect(() => {
        if (!isOpen || !isEditMode || !initialPoi) return;

        setTitle(String(initialPoi.title || ""));
        setSlug(toSlug(initialPoi.slug || initialPoi.title || ""));
        setSummary(String(initialPoi.summary || ""));
        setDescription(String(initialPoi.description || ""));
        setLatitude(Number.isFinite(Number(initialPoi.latitude)) ? Number(initialPoi.latitude).toFixed(6) : "");
        setLongitude(Number.isFinite(Number(initialPoi.longitude)) ? Number(initialPoi.longitude).toFixed(6) : "");
        setPeriodStartYear(Number.isFinite(Number(initialPoi.period_start_year)) ? String(initialPoi.period_start_year) : "");
        setPeriodEndYear(Number.isFinite(Number(initialPoi.period_end_year)) ? String(initialPoi.period_end_year) : "");
        setIsPub(Boolean(initialPoi.is_pub));
        setIsCleanupSupporter(Boolean(initialPoi.is_cleanup_supporter));
        setIsHistoric(Boolean(initialPoi.is_historic));
        setIsMuseum(Boolean(initialPoi.is_museum));
        setGoogleMapsUrl(String(initialPoi.google_maps_url || ""));
        setWikiUrl(String(initialPoi.wiki_url || ""));
        setStatus(initialPoi.status === "published" ? "published" : "draft");
        setImageRows([]);
        setStatusMessage("");
        setHasManuallyEditedLatitude(false);
        setHasManuallyEditedLongitude(false);
    }, [isOpen, isEditMode, initialPoi]);

    if (!isOpen) return null;

    const handleClose = () => {
        if (isSaving) return;
        resetForm();
        onClose();
    };

    const handleTitleBlur = () => {
        if (slug.trim()) return;
        setSlug(toSlug(title));
    };

    const handleImagePick = async (event) => {
        const files = Array.from(event.target.files || []);
        if (!files.length) return;

        const unsupportedFiles = files.filter((f) => {
            const type = (f.type || "").toLowerCase();
            const name = (f.name || "").toLowerCase();
            return (
                type === "image/heic" ||
                type === "image/heif" ||
                name.endsWith(".heic") ||
                name.endsWith(".heif")
            );
        });

        if (unsupportedFiles.length > 0) {
            setStatusMessage(
                "HEIC/HEIF images from iPhone/iCloud cannot be displayed by browsers. Please convert to JPEG or PNG first. On iPhone: open the photo in Photos app → Share → Save as File (choose JPEG), or use a free converter app.",
            );
            event.target.value = "";
            return;
        }

        if (imageRows.length + files.length > maxNewImages) {
            setStatusMessage(`You can upload up to ${maxNewImages} more image(s).`);
            return;
        }

        setIsSaving(true);
        setStatusMessage("Uploading images...");

        try {
            const uploadedRows = [];
            for (const file of files) {
                const imageUrl = await onUploadPoiImage(file);
                uploadedRows.push({
                    image_url: imageUrl,
                    alt_text: title ? `${title} image` : "POI image",
                    caption: "",
                });
            }
            setImageRows((prev) => [...prev, ...uploadedRows]);
            setStatusMessage("Images uploaded.");
        } catch {
            setStatusMessage("Some images could not be uploaded. Please try again.");
        } finally {
            setIsSaving(false);
            event.target.value = "";
        }
    };

    const handleSave = async () => {
        if (!canSave) return;

        const startYear = Number.parseInt(periodStartYear, 10);
        const endYear = Number.parseInt(periodEndYear, 10);

        setIsSaving(true);
        setStatusMessage("Saving POI...");

        try {
            await onSavePoi({
                poiId: initialPoi?.id || null,
                title: title.trim(),
                slug: toSlug(slug),
                summary: summary.trim(),
                description: description.trim(),
                latitude: Number.parseFloat(latitude),
                longitude: Number.parseFloat(longitude),
                period_start_year: Number.isFinite(startYear) ? startYear : null,
                period_end_year: Number.isFinite(endYear) ? endYear : null,
                is_pub: isPub,
                is_cleanup_supporter: isCleanupSupporter,
                is_historic: isHistoric,
                is_museum: isMuseum,
                google_maps_url: googleMapsUrl.trim() || null,
                wiki_url: wikiUrl.trim() || null,
                status,
                is_public: status === "published",
                imageRows,
            });

            await onRefresh();
            setStatusMessage("POI saved.");
            if (!isEditMode) {
                resetForm();
            }
        } catch {
            setStatusMessage("Could not save POI. Please check values and try again.");
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!isEditMode || !initialPoi?.id || !onDeletePoi) return;

        const confirmed = window.confirm(`Delete \"${initialPoi.title || "this POI"}\"? This cannot be undone.`);
        if (!confirmed) return;

        setIsSaving(true);
        setStatusMessage("Deleting POI...");

        try {
            await onDeletePoi(initialPoi.id);
            await onRefresh();
            setStatusMessage("POI deleted.");
            resetForm();
        } catch {
            setStatusMessage("Could not delete POI. Please try again.");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <>
            <div
                onClick={handleClose}
                style={{
                    position: "fixed",
                    inset: 0,
                    background: "rgba(2,6,23,0.45)",
                    zIndex: 1300,
                }}
            />
            <div
                style={{
                    position: "fixed",
                    zIndex: 1301,
                    left: "50%",
                    top: "50%",
                    transform: "translate(-50%, -50%)",
                    width: isMobile ? "calc(100vw - 12px)" : "min(760px, calc(100vw - 24px))",
                    maxHeight: isMobile ? "calc(100vh - 12px)" : "calc(100vh - 24px)",
                    overflowY: "auto",
                    borderRadius: isMobile ? "12px" : "16px",
                    border: "1px solid #dbeafe",
                    background: "linear-gradient(180deg, #f8fbff 0%, #ffffff 100%)",
                    boxShadow: "0 22px 46px rgba(15,23,42,0.28)",
                    padding: isMobile ? "10px" : "14px",
                    boxSizing: "border-box",
                }}
            >
                <div
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: "10px",
                        padding: "10px",
                        borderRadius: "12px",
                        border: "1px solid #bfdbfe",
                        background: "linear-gradient(145deg, #eff6ff 0%, #ffffff 100%)",
                    }}
                >
                    <div style={{ display: "grid", gap: "2px" }}>
                        <strong style={{ fontSize: "1rem", color: "#0f172a" }}>
                            {isEditMode ? "Edit POI" : "Create POI"}
                        </strong>
                        <span style={{ fontSize: "0.74rem", color: "#475569" }}>
                            {isEditMode ? "Update details, media, and publication status" : "Create a new place of interest with map coordinates"}
                        </span>
                    </div>
                    <button
                        type="button"
                        onClick={handleClose}
                        style={{
                            border: "1px solid #cbd5e1",
                            background: "#fff",
                            borderRadius: "8px",
                            padding: "5px 8px",
                            cursor: "pointer",
                        }}
                    >
                        Close
                    </button>
                </div>

                {!canManageItems ? (
                    <div
                        style={{
                            color: "#b45309",
                            fontSize: "0.82rem",
                            border: "1px solid #fde68a",
                            borderRadius: "10px",
                            padding: "8px 10px",
                            background: "#fefce8",
                            marginBottom: "10px",
                        }}
                    >
                        This account is view-only for POI management.
                    </div>
                ) : null}

                <div
                    style={{
                        display: "grid",
                        gap: "8px",
                        gridTemplateColumns: detailsGridColumns,
                    }}
                >
                    <div
                        style={{
                            display: "grid",
                            gap: "8px",
                            gridColumn: "1 / -1",
                            border: "1px solid #dbeafe",
                            borderRadius: "12px",
                            background: "#ffffff",
                            padding: "10px",
                        }}
                    >
                        <div style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "#1d4ed8", fontWeight: 800 }}>
                            Content
                        </div>
                        <label style={{ display: "grid", gap: "4px", fontSize: "0.78rem", color: "#334155" }}>
                            <span>Title</span>
                            <input value={title} onChange={(event) => setTitle(event.target.value)} onBlur={handleTitleBlur} style={{ border: "1px solid #cbd5e1", borderRadius: "8px", padding: "8px" }} />
                        </label>
                        <label style={{ display: "grid", gap: "4px", fontSize: "0.78rem", color: "#334155" }}>
                            <span>Slug</span>
                            <input value={slug} onChange={(event) => setSlug(toSlug(event.target.value))} style={{ border: "1px solid #cbd5e1", borderRadius: "8px", padding: "8px" }} />
                        </label>
                        <label style={{ display: "grid", gap: "4px", fontSize: "0.78rem", color: "#334155" }}>
                            <span style={{ fontWeight: 700, color: "#0f172a" }}>Summary</span>
                            <span style={{ fontSize: "0.71rem", color: "#64748b" }}>Short preview for cards and social snippets.</span>
                            <input value={summary} onChange={(event) => setSummary(event.target.value)} style={{ border: "1px solid #cbd5e1", borderRadius: "8px", padding: "8px" }} />
                        </label>
                        <label
                            style={{
                                display: "grid",
                                gap: "4px",
                                fontSize: "0.78rem",
                                color: "#334155",
                                border: "1px solid #e2e8f0",
                                borderRadius: "10px",
                                background: "#f8fafc",
                                padding: "8px",
                            }}
                        >
                            <span style={{ fontWeight: 700, color: "#0f172a" }}>Description</span>
                            <span style={{ fontSize: "0.71rem", color: "#64748b" }}>Full narrative and historical context shown on detail pages.</span>
                            <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={isMobile ? 5 : 6} style={{ border: "1px solid #cbd5e1", borderRadius: "8px", padding: "8px", resize: "vertical", background: "#fff" }} />
                        </label>
                    </div>

                    <div
                        style={{
                            display: "grid",
                            gap: "8px",
                            border: "1px solid #dbeafe",
                            borderRadius: "12px",
                            background: "#ffffff",
                            padding: "10px",
                        }}
                    >
                        <div style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "#0f766e", fontWeight: 800 }}>
                            Coordinates
                        </div>
                        <label style={{ display: "grid", gap: "4px", fontSize: "0.78rem", color: "#334155" }}>
                            <span>Latitude</span>
                            <input
                                value={latitude}
                                onChange={(event) => {
                                    setLatitude(event.target.value);
                                    setHasManuallyEditedLatitude(true);
                                }}
                                placeholder="54.0527"
                                style={{ border: "1px solid #cbd5e1", borderRadius: "8px", padding: "8px" }}
                            />
                        </label>
                        <label style={{ display: "grid", gap: "4px", fontSize: "0.78rem", color: "#334155" }}>
                            <span>Longitude</span>
                            <input
                                value={longitude}
                                onChange={(event) => {
                                    setLongitude(event.target.value);
                                    setHasManuallyEditedLongitude(true);
                                }}
                                placeholder="-2.8012"
                                style={{ border: "1px solid #cbd5e1", borderRadius: "8px", padding: "8px" }}
                            />
                        </label>
                        <label style={{ display: "grid", gap: "4px", fontSize: "0.78rem", color: "#334155" }}>
                            <span>Period Start Year</span>
                            <input value={periodStartYear} onChange={(event) => setPeriodStartYear(event.target.value)} style={{ border: "1px solid #cbd5e1", borderRadius: "8px", padding: "8px" }} />
                        </label>
                        <label style={{ display: "grid", gap: "4px", fontSize: "0.78rem", color: "#334155" }}>
                            <span>Period End Year</span>
                            <input value={periodEndYear} onChange={(event) => setPeriodEndYear(event.target.value)} style={{ border: "1px solid #cbd5e1", borderRadius: "8px", padding: "8px" }} />
                        </label>
                    </div>

                    <div
                        style={{
                            display: "grid",
                            gap: "8px",
                            border: "1px solid #dbeafe",
                            borderRadius: "12px",
                            background: "#ffffff",
                            padding: "10px",
                        }}
                    >
                        <div style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "#9a3412", fontWeight: 800 }}>
                            Visibility And Media
                        </div>
                        <label style={{ display: "grid", gap: "4px", fontSize: "0.78rem", color: "#334155" }}>
                            <span>Status</span>
                            <select value={status} onChange={(event) => setStatus(event.target.value)} style={{ border: "1px solid #cbd5e1", borderRadius: "8px", padding: "8px" }}>
                                <option value="draft">Draft</option>
                                <option value="published">Published</option>
                            </select>
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.78rem", color: "#334155" }}>
                            <input type="checkbox" checked={isPub} onChange={(event) => setIsPub(event.target.checked)} />
                            <span>Mark as pub</span>
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.78rem", color: "#334155" }}>
                            <input type="checkbox" checked={isCleanupSupporter} onChange={(event) => setIsCleanupSupporter(event.target.checked)} />
                            <span>Highlight as cleanup supporter</span>
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.78rem", color: "#334155" }}>
                            <input type="checkbox" checked={isHistoric} onChange={(event) => setIsHistoric(event.target.checked)} />
                            <span>Mark as historic</span>
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.78rem", color: "#334155" }}>
                            <input type="checkbox" checked={isMuseum} onChange={(event) => setIsMuseum(event.target.checked)} />
                            <span>Mark as museum</span>
                        </label>
                        <label style={{ display: "grid", gap: "4px", fontSize: "0.78rem", color: "#334155" }}>
                            <span>Google Maps URL (optional)</span>
                            <input
                                type="url"
                                value={googleMapsUrl}
                                onChange={(event) => setGoogleMapsUrl(event.target.value)}
                                placeholder="https://maps.google.com/..."
                                style={{ border: isValidUrl(googleMapsUrl) ? "1px solid #cbd5e1" : "1px solid #dc2626", borderRadius: "8px", padding: "8px" }}
                            />
                        </label>
                        <label style={{ display: "grid", gap: "4px", fontSize: "0.78rem", color: "#334155" }}>
                            <span>Wiki URL (optional)</span>
                            <input
                                type="url"
                                value={wikiUrl}
                                onChange={(event) => setWikiUrl(event.target.value)}
                                placeholder="https://en.wikipedia.org/wiki/..."
                                style={{ border: isValidUrl(wikiUrl) ? "1px solid #cbd5e1" : "1px solid #dc2626", borderRadius: "8px", padding: "8px" }}
                            />
                        </label>
                        <label style={{ display: "grid", gap: "4px", fontSize: "0.78rem", color: "#334155" }}>
                            <span>
                                {isEditMode ? `New Images (${imageRows.length}/${Math.max(MAX_POI_IMAGES - existingImageCount, 0)})` : `Images (${imageRows.length}/${MAX_POI_IMAGES})`}
                            </span>
                            <input type="file" accept="image/*" multiple onChange={handleImagePick} disabled={isSaving || imageRows.length >= maxNewImages} />
                        </label>
                    </div>
                </div>

                {isEditMode ? (
                    <div style={{ marginTop: "8px", fontSize: "0.78rem", color: "#64748b" }}>
                        Existing images: {existingImageCount}. New uploads are appended to this POI.
                    </div>
                ) : null}

                {imageRows.length ? (
                    <div style={{ marginTop: "10px", display: "grid", gap: "6px" }}>
                        {imageRows.map((row, index) => (
                            <div key={`${row.image_url}-${index}`} style={{ display: "grid", gap: "4px", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "7px" }}>
                                <div style={{ fontSize: "0.72rem", color: "#64748b" }}>Image {index + 1}</div>
                                <input
                                    value={row.caption || ""}
                                    onChange={(event) => {
                                        const nextCaption = event.target.value;
                                        setImageRows((prev) => prev.map((item, i) => (i === index ? { ...item, caption: nextCaption } : item)));
                                    }}
                                    placeholder="Caption"
                                    style={{ border: "1px solid #cbd5e1", borderRadius: "6px", padding: "6px" }}
                                />
                                <input
                                    value={row.alt_text || ""}
                                    onChange={(event) => {
                                        const nextAlt = event.target.value;
                                        setImageRows((prev) => prev.map((item, i) => (i === index ? { ...item, alt_text: nextAlt } : item)));
                                    }}
                                    placeholder="Alt text"
                                    style={{ border: "1px solid #cbd5e1", borderRadius: "6px", padding: "6px" }}
                                />
                            </div>
                        ))}
                    </div>
                ) : null}

                {statusMessage ? (
                    <div
                        style={{
                            marginTop: "10px",
                            fontSize: "0.8rem",
                            color: "#334155",
                            border: "1px solid #bfdbfe",
                            borderRadius: "10px",
                            padding: "7px 9px",
                            background: "#eff6ff",
                        }}
                    >
                        {statusMessage}
                    </div>
                ) : null}

                <div style={{ marginTop: "12px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={!canSave}
                        style={{
                            border: "1px solid #2563eb",
                            background: "#2563eb",
                            color: "#fff",
                            borderRadius: "8px",
                            padding: "8px 12px",
                            fontWeight: 700,
                            cursor: canSave ? "pointer" : "not-allowed",
                            opacity: canSave ? 1 : 0.6,
                        }}
                    >
                        {isEditMode ? "Save Changes" : "Save POI"}
                    </button>
                    {isEditMode ? (
                        <button
                            type="button"
                            onClick={handleDelete}
                            disabled={isSaving}
                            style={{
                                border: "1px solid #dc2626",
                                background: "#fff1f2",
                                color: "#b91c1c",
                                borderRadius: "8px",
                                padding: "8px 12px",
                                fontWeight: 700,
                                cursor: isSaving ? "not-allowed" : "pointer",
                                opacity: isSaving ? 0.6 : 1,
                            }}
                        >
                            Delete POI
                        </button>
                    ) : null}
                    <button
                        type="button"
                        onClick={async () => {
                            setIsSaving(true);
                            await onRefresh();
                            setIsSaving(false);
                            setStatusMessage("Refreshed from database.");
                        }}
                        disabled={isSaving}
                        style={{
                            border: "1px solid #cbd5e1",
                            background: "#fff",
                            color: "#0f172a",
                            borderRadius: "8px",
                            padding: "8px 12px",
                            fontWeight: 700,
                            cursor: isSaving ? "not-allowed" : "pointer",
                            opacity: isSaving ? 0.6 : 1,
                        }}
                    >
                        Refresh
                    </button>
                </div>
            </div>
        </>
    );
}
