import { hasSupabaseConfig, supabase } from "./supabaseClient";

const ITEMS_STORAGE_KEY = "cleanup-items-v1";
const CANONICAL_LINKS_URL = "https://rivercleanup.co.uk/links/";
const LINKS_FETCH_TIMEOUT_MS = 4500;

const ASSUMED_ITEM_WEIGHTS_KG = {
    trolley: 28,
    bike: 15,
    historic: 1,
    motorbike: 180,
    misc: 30,
};

const TYPE_COUNT_ORDER = ["trolley", "bike", "motorbike", "historic", "misc"];
const TYPE_COUNT_LABELS = {
    trolley: ["trolley", "trolleys"],
    bike: ["bike", "bikes"],
    motorbike: ["motorbike", "motorbikes"],
    historic: ["historic find", "historic finds"],
    misc: ["misc item", "misc items"],
};

const DEFAULT_WEIGHT_KG = ASSUMED_ITEM_WEIGHTS_KG.misc;

const normalizeType = (value) => String(value || "").toLowerCase().trim();

const clampRecoveredCount = (total, recovered) => {
    const normalizedTotal = Number.isFinite(Number(total)) ? Number(total) : 0;
    const normalizedRecovered = Number.isFinite(Number(recovered)) ? Number(recovered) : 0;
    return Math.max(0, Math.min(normalizedTotal, normalizedRecovered));
};

const getTotalCount = (row) => {
    const primary = Number(row?.total_count);
    if (Number.isFinite(primary)) return Math.max(1, primary);

    const fallback = Number(row?.total);
    if (Number.isFinite(fallback)) return Math.max(1, fallback);

    return 1;
};

const getRecoveredCount = (row) => {
    const primary = Number(row?.recovered_count);
    if (Number.isFinite(primary)) return Math.max(0, primary);

    const fallback = Number(row?.recovered);
    if (Number.isFinite(fallback)) return Math.max(0, fallback);

    return 0;
};

const formatWeightLabel = (valueKg) => {
    const rounded = Math.round(valueKg);
    return `${rounded.toLocaleString("en-GB")} kg recovered to date`;
};

const weightNode = document.getElementById("weight-total");
const itemBreakdownNode = document.getElementById("item-breakdown");
const shareButtonNode = document.getElementById("share-links-button");
const shareStatusNode = document.getElementById("share-status");
let shareStatusTimer = null;

const setWeightText = (text) => {
    if (!weightNode) return;
    weightNode.textContent = text;
};

const setItemBreakdownText = (text) => {
    if (!itemBreakdownNode) return;
    itemBreakdownNode.textContent = text;
};

const setShareStatusText = (text) => {
    if (!shareStatusNode) return;
    shareStatusNode.textContent = text;

    if (shareStatusTimer) {
        window.clearTimeout(shareStatusTimer);
        shareStatusTimer = null;
    }

    if (!text) return;
    shareStatusTimer = window.setTimeout(() => {
        if (shareStatusNode.textContent === text) {
            shareStatusNode.textContent = "";
        }
        shareStatusTimer = null;
    }, 2400);
};

const readCachedItems = () => {
    if (typeof window === "undefined") return [];

    try {
        const raw = window.localStorage.getItem(ITEMS_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const computeEstimatedRecoveredKg = (rows) =>
    rows.reduce((sum, row) => {
        const totalCount = getTotalCount(row);
        const recovered = getRecoveredCount(row);
        const recoveredCount = clampRecoveredCount(totalCount, recovered);
        if (recoveredCount <= 0) return sum;

        const explicitWeight = Number(row?.estimated_weight_kg);
        const fallbackWeight = ASSUMED_ITEM_WEIGHTS_KG[normalizeType(row?.type)] ?? DEFAULT_WEIGHT_KG;
        const weightPerItem = Number.isFinite(explicitWeight) && explicitWeight > 0 ? explicitWeight : fallbackWeight;

        return sum + recoveredCount * weightPerItem;
    }, 0);

const buildRecoveredTypeBreakdown = (rows) => {
    const totalsByType = {
        trolley: 0,
        bike: 0,
        motorbike: 0,
        historic: 0,
        misc: 0,
    };

    rows.forEach((row) => {
        const totalCount = getTotalCount(row);
        const recovered = getRecoveredCount(row);
        const recoveredCount = clampRecoveredCount(totalCount, recovered);
        if (recoveredCount <= 0) return;

        const typeKey = normalizeType(row?.type);
        const normalizedType = Object.prototype.hasOwnProperty.call(totalsByType, typeKey)
            ? typeKey
            : "misc";
        totalsByType[normalizedType] += recoveredCount;
    });

    const parts = TYPE_COUNT_ORDER
        .map((type) => {
            const count = totalsByType[type] || 0;
            if (count <= 0) return "";
            const [singular, plural] = TYPE_COUNT_LABELS[type];
            return `${count.toLocaleString("en-GB")} ${count === 1 ? singular : plural}`;
        })
        .filter(Boolean);

    return parts.length > 0 ? parts.join(" • ") : "No recovered items yet";
};

const fetchItemsWithTimeout = async (timeoutMs = LINKS_FETCH_TIMEOUT_MS) => {
    let timeoutHandle;
    const timeoutPromise = new Promise((resolve) => {
        timeoutHandle = window.setTimeout(() => {
            resolve({
                data: null,
                error: new Error("Items request timed out"),
            });
        }, timeoutMs);
    });

    const result = await Promise.race([
        supabase.from("items").select("*"),
        timeoutPromise,
    ]);

    window.clearTimeout(timeoutHandle);
    return result;
};

const handleShareLinks = async () => {
    const shareData = {
        title: "River Lune Cleanup links",
        text: "Quick links for River Lune Cleanup",
        url: CANONICAL_LINKS_URL,
    };

    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        try {
            await navigator.share(shareData);
            setShareStatusText("Thanks for sharing this page.");
            return;
        } catch (error) {
            if (error?.name === "AbortError") {
                return;
            }
        }
    }

    try {
        if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(CANONICAL_LINKS_URL);
            setShareStatusText("Link copied to clipboard.");
            return;
        }

        setShareStatusText("Sharing not supported in this browser.");
    } catch {
        setShareStatusText("Unable to share right now. Please try again.");
    }
};

if (shareButtonNode) {
    shareButtonNode.addEventListener("click", () => {
        void handleShareLinks();
    });
}

const loadRecoveredWeight = async () => {
    if (!hasSupabaseConfig) {
        const cachedItems = readCachedItems();
        if (cachedItems.length > 0) {
            setWeightText(formatWeightLabel(computeEstimatedRecoveredKg(cachedItems)));
            setItemBreakdownText(buildRecoveredTypeBreakdown(cachedItems));
            return;
        }

        console.warn("[links] Supabase config missing and no cached items available.");
        setWeightText("Recovered weight unavailable");
        setItemBreakdownText("Recovered item counts unavailable");
        return;
    }

    const { data, error } = await fetchItemsWithTimeout();

    if (!error && Array.isArray(data) && data.length > 0) {
        setWeightText(formatWeightLabel(computeEstimatedRecoveredKg(data)));
        setItemBreakdownText(buildRecoveredTypeBreakdown(data));
        return;
    }

    const cachedItems = readCachedItems();
    if (cachedItems.length > 0) {
        console.warn("[links] Using cached items fallback for recovered weight.");
        setWeightText(formatWeightLabel(computeEstimatedRecoveredKg(cachedItems)));
        setItemBreakdownText(buildRecoveredTypeBreakdown(cachedItems));
        return;
    }

    if (error) {
        console.warn("[links] Failed to fetch recovered weight from Supabase:", error.message || error);
    } else {
        console.warn("[links] Items query returned no rows and no cached fallback.");
    }

    setWeightText("Recovered weight unavailable");
    setItemBreakdownText("Recovered item counts unavailable");
};

loadRecoveredWeight();
