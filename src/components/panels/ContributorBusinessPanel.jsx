import React, { useEffect, useMemo, useState } from "react";

const emptyFormState = {
    id: null,
    name: "",
    description: "",
    websiteUrl: "",
    contributionNote: "",
    logoUrl: "",
    lat: "",
    lng: "",
    searchAddress: "",
};

const buildStorageFilePath = (fileName) => {
    const extension = fileName.includes(".") ? fileName.split(".").pop() : "png";
    const randomPart = Math.random().toString(36).slice(2, 10);
    return `${Date.now()}-${randomPart}.${extension}`;
};

const parseCoordinate = (value, type) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;

    if (type === "lat" && (parsed < -90 || parsed > 90)) return null;
    if (type === "lng" && (parsed < -180 || parsed > 180)) return null;

    return parsed;
};

const normalizeWebsiteUrl = (value) => {
    const trimmed = String(value || "").trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
    return `https://${trimmed}`;
};

const getErrorMessage = (error, fallbackMessage) => {
    const message =
        error && typeof error === "object" && "message" in error
            ? String(error.message || "").trim()
            : String(error || "").trim();
    return message ? `${fallbackMessage}: ${message}` : fallbackMessage;
};

export default function ContributorBusinessPanel({
    isOpen,
    onClose,
    contributors,
    supabase,
    canManageItems,
    onContributorAdded,
    onContributorUpdated,
    onContributorDeleted,
}) {
    const [form, setForm] = useState(emptyFormState);
    const [logoFile, setLogoFile] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSearchingAddress, setIsSearchingAddress] = useState(false);
    const [statusMessage, setStatusMessage] = useState("");

    useEffect(() => {
        if (!isOpen) {
            setForm(emptyFormState);
            setLogoFile(null);
            setStatusMessage("");
            setIsSubmitting(false);
            setIsSearchingAddress(false);
        }
    }, [isOpen]);

    const sortedContributors = useMemo(() => {
        if (!Array.isArray(contributors)) return [];

        return [...contributors].sort((a, b) => {
            const aName = String(a?.name || "").toLowerCase();
            const bName = String(b?.name || "").toLowerCase();
            return aName.localeCompare(bName);
        });
    }, [contributors]);

    if (!isOpen) return null;

    const resetForm = () => {
        setForm(emptyFormState);
        setLogoFile(null);
        setStatusMessage("");
    };

    const startEditing = (contributor) => {
        setForm({
            id: contributor.id,
            name: contributor.name || "",
            description: contributor.description || "",
            websiteUrl: contributor.website_url || "",
            contributionNote: contributor.contribution_note || "",
            logoUrl: contributor.logo_url || "",
            lat: contributor.lat != null ? String(contributor.lat) : "",
            lng: contributor.lng != null ? String(contributor.lng) : "",
            searchAddress: "",
        });
        setLogoFile(null);
        setStatusMessage("");
    };

    const handleAddressSearch = async () => {
        const query = String(form.searchAddress || "").trim();
        if (!query) {
            setStatusMessage("Enter an address to search.");
            return;
        }

        setIsSearchingAddress(true);
        setStatusMessage("Searching address...");

        try {
            const response = await fetch(
                `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(query)}`,
                {
                    headers: {
                        Accept: "application/json",
                    },
                },
            );

            if (!response.ok) {
                throw new Error("Address search failed");
            }

            const results = await response.json();
            const firstResult = Array.isArray(results) ? results[0] : null;

            if (!firstResult) {
                setStatusMessage("No address match found.");
                return;
            }

            setForm((prev) => ({
                ...prev,
                lat: String(firstResult.lat || ""),
                lng: String(firstResult.lon || ""),
            }));
            setStatusMessage(`Using location: ${firstResult.display_name || "address result"}`);
        } catch (error) {
            setStatusMessage(getErrorMessage(error, "Could not search address right now"));
        } finally {
            setIsSearchingAddress(false);
        }
    };

    const uploadLogoIfNeeded = async () => {
        if (!logoFile) return form.logoUrl || "";

        const filePath = buildStorageFilePath(logoFile.name || "logo.png");
        const { error: uploadError } = await supabase.storage
            .from("contributor-logos")
            .upload(filePath, logoFile);

        if (uploadError) {
            throw uploadError;
        }

        const { data } = supabase.storage.from("contributor-logos").getPublicUrl(filePath);
        return data?.publicUrl || "";
    };

    const handleSubmit = async (event) => {
        event.preventDefault();

        const name = String(form.name || "").trim();
        const lat = parseCoordinate(form.lat, "lat");
        const lng = parseCoordinate(form.lng, "lng");

        if (!name) {
            setStatusMessage("Business name is required.");
            return;
        }

        if (lat === null || lng === null) {
            setStatusMessage("Valid latitude and longitude are required.");
            return;
        }

        setIsSubmitting(true);
        setStatusMessage(form.id ? "Updating business..." : "Saving business...");

        try {
            const finalLogoUrl = await uploadLogoIfNeeded();
            const payload = {
                name,
                description: String(form.description || "").trim() || null,
                website_url: normalizeWebsiteUrl(form.websiteUrl) || null,
                contribution_note: String(form.contributionNote || "").trim() || null,
                logo_url: finalLogoUrl || null,
                lat,
                lng,
            };

            if (form.id) {
                const { error } = await supabase.from("contributors").update(payload).eq("id", form.id);
                if (error) throw error;
                setStatusMessage("Business updated.");
                onContributorUpdated?.();
            } else {
                const { error } = await supabase.from("contributors").insert([payload]);
                if (error) throw error;
                setStatusMessage("Business added.");
                onContributorAdded?.();
            }

            setForm(emptyFormState);
            setLogoFile(null);
        } catch (error) {
            setStatusMessage(getErrorMessage(error, "Could not save business"));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async (contributorId) => {
        if (!canManageItems) return;

        const confirmed = window.confirm("Delete this contributor business?");
        if (!confirmed) return;

        setStatusMessage("Deleting business...");

        const { error } = await supabase.from("contributors").delete().eq("id", contributorId);

        if (error) {
            setStatusMessage(getErrorMessage(error, "Could not delete business"));
            return;
        }

        if (form.id === contributorId) {
            resetForm();
        }

        setStatusMessage("Business deleted.");
        onContributorDeleted?.();
    };

    const isEditing = Boolean(form.id);

    return (
        <>
            <div
                onClick={onClose}
                style={{
                    position: "fixed",
                    inset: 0,
                    background: "rgba(2, 6, 23, 0.45)",
                    zIndex: 1598,
                }}
            />
            <div
                style={{
                    position: "fixed",
                    zIndex: 1599,
                    top: "max(12px, env(safe-area-inset-top, 0px) + 10px)",
                    left: "50%",
                    transform: "translateX(-50%)",
                    width: "min(920px, calc(100vw - 18px))",
                    maxHeight: "calc(100dvh - 24px)",
                    overflow: "auto",
                    boxSizing: "border-box",
                    borderRadius: "16px",
                    border: "1px solid #dbeafe",
                    background: "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,250,252,0.96))",
                    boxShadow: "0 28px 56px rgba(15,23,42,0.3)",
                    padding: "12px",
                    display: "grid",
                    gap: "10px",
                }}
            >
                <div
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: "8px",
                    }}
                >
                    <div>
                        <strong style={{ fontSize: "1rem", color: "#0f172a" }}>Contributors</strong>
                        <div style={{ fontSize: "0.8rem", color: "#475569", marginTop: "2px" }}>
                            {canManageItems
                                ? "Add or edit businesses that contributed to the cleanup."
                                : "Supporters and businesses that have contributed to the cleanup."}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        style={{
                            border: "1px solid #cbd5e1",
                            borderRadius: "999px",
                            background: "#fff",
                            color: "#334155",
                            width: "34px",
                            height: "34px",
                            fontWeight: 700,
                            cursor: "pointer",
                        }}
                        aria-label="Close contributor businesses panel"
                    >
                        ×
                    </button>
                </div>

                <div
                    style={{
                        display: "grid",
                        gap: "10px",
                        gridTemplateColumns: canManageItems ? "repeat(auto-fit, minmax(280px, 1fr))" : "1fr",
                    }}
                >
                    <div
                        style={{
                            border: "1px solid #dbeafe",
                            borderRadius: "12px",
                            background: "#f8fbff",
                            padding: "10px",
                            display: "grid",
                            gap: "8px",
                        }}
                    >
                        <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "#1e3a8a" }}>
                            Supporters ({sortedContributors.length})
                        </div>
                        <div
                            style={{
                                display: "grid",
                                gap: "8px",
                                maxHeight: canManageItems ? "45dvh" : "60dvh",
                                overflow: "auto",
                                gridTemplateColumns: canManageItems ? "1fr" : "repeat(auto-fit, minmax(260px, 1fr))",
                            }}
                        >
                            {sortedContributors.length ? (
                                sortedContributors.map((contributor) => (
                                    <div
                                        key={contributor.id}
                                        style={{
                                            border: "1px solid #dbe5f4",
                                            borderRadius: "12px",
                                            background: "linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)",
                                            padding: "9px",
                                            display: "grid",
                                            gap: "7px",
                                        }}
                                    >
                                        <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                                            <div
                                                style={{
                                                    width: "40px",
                                                    height: "40px",
                                                    borderRadius: "10px",
                                                    border: "1px solid #cbd5e1",
                                                    background: "#f8fafc",
                                                    boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.75)",
                                                    display: "grid",
                                                    placeItems: "center",
                                                    overflow: "hidden",
                                                    flexShrink: 0,
                                                }}
                                            >
                                                {contributor.logo_url ? (
                                                    <img
                                                        src={contributor.logo_url}
                                                        alt=""
                                                        style={{
                                                            width: "100%",
                                                            height: "100%",
                                                            maxWidth: "34px",
                                                            maxHeight: "34px",
                                                            objectFit: "contain",
                                                            borderRadius: "6px",
                                                        }}
                                                    />
                                                ) : (
                                                    <div
                                                        style={{
                                                            width: "100%",
                                                            height: "100%",
                                                            maxWidth: "34px",
                                                            maxHeight: "34px",
                                                            borderRadius: "8px",
                                                            border: "1px dashed #94a3b8",
                                                            background: "linear-gradient(140deg, #e2e8f0, #cbd5e1)",
                                                        }}
                                                    />
                                                )}
                                            </div>
                                            <div style={{ display: "grid", gap: "4px", minWidth: 0 }}>
                                                <strong
                                                    style={{
                                                        color: "#0f172a",
                                                        fontSize: "0.84rem",
                                                        lineHeight: 1.25,
                                                        wordBreak: "break-word",
                                                    }}
                                                >
                                                    {contributor.name}
                                                </strong>
                                                <span
                                                    style={{
                                                        display: "inline-flex",
                                                        width: "fit-content",
                                                        alignItems: "center",
                                                        justifyContent: "center",
                                                        padding: "2px 6px",
                                                        borderRadius: "999px",
                                                        border: "1px solid #fcd34d",
                                                        background: "#fffbeb",
                                                        color: "#92400e",
                                                        fontSize: "0.64rem",
                                                        fontWeight: 700,
                                                        letterSpacing: "0.02em",
                                                    }}
                                                >
                                                    Contributed
                                                </span>
                                            </div>
                                        </div>
                                        {contributor.description ? (
                                            <div
                                                style={{
                                                    fontSize: "0.76rem",
                                                    color: "#334155",
                                                    lineHeight: 1.42,
                                                    wordBreak: "break-word",
                                                }}
                                            >
                                                {contributor.description}
                                            </div>
                                        ) : null}
                                        {contributor.contribution_note ? (
                                            <div
                                                style={{
                                                    fontSize: "0.74rem",
                                                    color: "#1e3a8a",
                                                    fontWeight: 600,
                                                    lineHeight: 1.42,
                                                    background: "#eff6ff",
                                                    border: "1px solid #dbeafe",
                                                    borderRadius: "8px",
                                                    padding: "6px 7px",
                                                    wordBreak: "break-word",
                                                }}
                                            >
                                                {contributor.contribution_note}
                                            </div>
                                        ) : null}
                                        {contributor.website_url || (Number.isFinite(Number(contributor.lat)) && Number.isFinite(Number(contributor.lng))) ? (
                                            <div
                                                style={{
                                                    display: "flex",
                                                    justifyContent: "center",
                                                    alignItems: "center",
                                                    gap: "6px",
                                                    flexWrap: "wrap",
                                                }}
                                            >
                                                {contributor.website_url ? (
                                                    <a
                                                        href={contributor.website_url}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        style={{
                                                            display: "inline-flex",
                                                            alignItems: "center",
                                                            justifyContent: "center",
                                                            width: "fit-content",
                                                            minHeight: "30px",
                                                            borderRadius: "999px",
                                                            border: "1px solid #93c5fd",
                                                            background: "#eff6ff",
                                                            color: "#1d4ed8",
                                                            padding: "0 11px",
                                                            fontSize: "0.74rem",
                                                            fontWeight: 700,
                                                            textDecoration: "none",
                                                            lineHeight: 1,
                                                        }}
                                                    >
                                                        Visit Website
                                                    </a>
                                                ) : null}
                                                {Number.isFinite(Number(contributor.lat)) && Number.isFinite(Number(contributor.lng)) ? (
                                                    <a
                                                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${contributor.lat},${contributor.lng}`)}`}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        style={{
                                                            display: "inline-flex",
                                                            alignItems: "center",
                                                            justifyContent: "center",
                                                            width: "fit-content",
                                                            minHeight: "30px",
                                                            borderRadius: "999px",
                                                            border: "1px solid #2563eb",
                                                            background: "linear-gradient(180deg, #3b82f6 0%, #1d4ed8 100%)",
                                                            color: "#ffffff",
                                                            padding: "0 11px",
                                                            fontSize: "0.74rem",
                                                            fontWeight: 700,
                                                            textDecoration: "none",
                                                            lineHeight: 1,
                                                        }}
                                                    >
                                                        Open In Google Maps
                                                    </a>
                                                ) : null}
                                            </div>
                                        ) : null}
                                        {canManageItems ? (
                                            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                                                <button
                                                    type="button"
                                                    onClick={() => startEditing(contributor)}
                                                    style={{
                                                        border: "1px solid #93c5fd",
                                                        background: "#eff6ff",
                                                        color: "#1d4ed8",
                                                        borderRadius: "999px",
                                                        padding: "4px 10px",
                                                        fontSize: "0.75rem",
                                                        fontWeight: 700,
                                                        cursor: "pointer",
                                                    }}
                                                >
                                                    Edit
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleDelete(contributor.id)}
                                                    style={{
                                                        border: "1px solid #fecaca",
                                                        background: "#fff1f2",
                                                        color: "#b91c1c",
                                                        borderRadius: "999px",
                                                        padding: "4px 10px",
                                                        fontSize: "0.75rem",
                                                        fontWeight: 700,
                                                        cursor: "pointer",
                                                    }}
                                                >
                                                    Delete
                                                </button>
                                            </div>
                                        ) : null}
                                    </div>
                                ))
                            ) : (
                                <div style={{ fontSize: "0.78rem", color: "#64748b" }}>
                                    No contributors yet.
                                </div>
                            )}
                        </div>
                    </div>

                    {canManageItems ? (
                        <form
                            onSubmit={handleSubmit}
                            style={{
                                border: "1px solid #dbeafe",
                                borderRadius: "12px",
                                background: "#ffffff",
                                padding: "10px",
                                display: "grid",
                                gap: "8px",
                            }}
                        >
                            <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "#1e3a8a" }}>
                                {isEditing ? "Edit contributor" : "Add contributor"}
                            </div>

                        <label style={{ display: "grid", gap: "4px", fontSize: "0.75rem", color: "#475569" }}>
                            <span>Name *</span>
                            <input
                                type="text"
                                required
                                value={form.name}
                                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                                style={{ border: "1px solid #cbd5e1", borderRadius: "8px", padding: "8px" }}
                            />
                        </label>

                        <label style={{ display: "grid", gap: "4px", fontSize: "0.75rem", color: "#475569" }}>
                            <span>Description</span>
                            <textarea
                                value={form.description}
                                onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                                rows={2}
                                style={{ border: "1px solid #cbd5e1", borderRadius: "8px", padding: "8px", resize: "vertical" }}
                            />
                        </label>

                        <label style={{ display: "grid", gap: "4px", fontSize: "0.75rem", color: "#475569" }}>
                            <span>Website URL</span>
                            <input
                                type="url"
                                value={form.websiteUrl}
                                onChange={(event) => setForm((prev) => ({ ...prev, websiteUrl: event.target.value }))}
                                placeholder="https://example.com"
                                style={{ border: "1px solid #cbd5e1", borderRadius: "8px", padding: "8px" }}
                            />
                        </label>

                        <label style={{ display: "grid", gap: "4px", fontSize: "0.75rem", color: "#475569" }}>
                            <span>Contribution note</span>
                            <textarea
                                value={form.contributionNote}
                                onChange={(event) => setForm((prev) => ({ ...prev, contributionNote: event.target.value }))}
                                rows={2}
                                style={{ border: "1px solid #cbd5e1", borderRadius: "8px", padding: "8px", resize: "vertical" }}
                            />
                        </label>

                        <div style={{ display: "grid", gap: "6px" }}>
                            <label style={{ display: "grid", gap: "4px", fontSize: "0.75rem", color: "#475569" }}>
                                <span>Search by address</span>
                                <div style={{ display: "flex", gap: "6px" }}>
                                    <input
                                        type="text"
                                        value={form.searchAddress}
                                        onChange={(event) => setForm((prev) => ({ ...prev, searchAddress: event.target.value }))}
                                        placeholder="Business address"
                                        style={{
                                            flex: 1,
                                            border: "1px solid #cbd5e1",
                                            borderRadius: "8px",
                                            padding: "8px",
                                            minWidth: 0,
                                        }}
                                    />
                                    <button
                                        type="button"
                                        onClick={handleAddressSearch}
                                        disabled={isSearchingAddress}
                                        style={{
                                            border: "1px solid #93c5fd",
                                            background: "#eff6ff",
                                            color: "#1d4ed8",
                                            borderRadius: "8px",
                                            padding: "0 10px",
                                            fontWeight: 700,
                                            cursor: isSearchingAddress ? "wait" : "pointer",
                                        }}
                                    >
                                        Find
                                    </button>
                                </div>
                            </label>
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "6px" }}>
                            <label style={{ display: "grid", gap: "4px", fontSize: "0.75rem", color: "#475569" }}>
                                <span>Latitude *</span>
                                <input
                                    type="number"
                                    step="any"
                                    value={form.lat}
                                    onChange={(event) => setForm((prev) => ({ ...prev, lat: event.target.value }))}
                                    style={{ border: "1px solid #cbd5e1", borderRadius: "8px", padding: "8px" }}
                                />
                            </label>
                            <label style={{ display: "grid", gap: "4px", fontSize: "0.75rem", color: "#475569" }}>
                                <span>Longitude *</span>
                                <input
                                    type="number"
                                    step="any"
                                    value={form.lng}
                                    onChange={(event) => setForm((prev) => ({ ...prev, lng: event.target.value }))}
                                    style={{ border: "1px solid #cbd5e1", borderRadius: "8px", padding: "8px" }}
                                />
                            </label>
                        </div>

                        <label style={{ display: "grid", gap: "4px", fontSize: "0.75rem", color: "#475569" }}>
                            <span>Logo image</span>
                            <input
                                type="file"
                                accept="image/*"
                                onChange={(event) => setLogoFile(event.target.files?.[0] || null)}
                            />
                        </label>

                        {form.logoUrl ? (
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <img
                                    src={form.logoUrl}
                                    alt="Business logo preview"
                                    style={{
                                        width: "38px",
                                        height: "38px",
                                        borderRadius: "999px",
                                        objectFit: "cover",
                                        border: "1px solid #cbd5e1",
                                    }}
                                />
                                <span style={{ fontSize: "0.74rem", color: "#64748b" }}>
                                    Current logo URL saved
                                </span>
                            </div>
                        ) : null}

                            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                                <button
                                    type="submit"
                                    disabled={isSubmitting}
                                    style={{
                                        border: "1px solid #1d4ed8",
                                        background: "#1d4ed8",
                                        color: "#fff",
                                        borderRadius: "999px",
                                        padding: "8px 14px",
                                        fontSize: "0.78rem",
                                        fontWeight: 700,
                                        cursor: isSubmitting ? "wait" : "pointer",
                                    }}
                                >
                                    {isSubmitting ? "Saving..." : isEditing ? "Update contributor" : "Add contributor"}
                                </button>
                                <button
                                    type="button"
                                    onClick={resetForm}
                                    style={{
                                        border: "1px solid #cbd5e1",
                                        background: "#fff",
                                        color: "#334155",
                                        borderRadius: "999px",
                                        padding: "8px 14px",
                                        fontSize: "0.78rem",
                                        fontWeight: 700,
                                        cursor: "pointer",
                                    }}
                                >
                                    Reset form
                                </button>
                            </div>
                        </form>
                    ) : null}
                </div>

                {statusMessage ? (
                    <div
                        style={{
                            border: "1px solid #dbeafe",
                            background: "#f8fbff",
                            color: "#1e3a8a",
                            borderRadius: "10px",
                            padding: "8px 10px",
                            fontSize: "0.8rem",
                        }}
                    >
                        {statusMessage}
                    </div>
                ) : null}
            </div>
        </>
    );
}
