import { hasSupabaseConfig, supabase } from "./supabaseClient";

const ITEMS_STORAGE_KEY = "cleanup-items-v1";

const ASSUMED_ITEM_WEIGHTS_KG = {
    trolley: 28,
    bike: 15,
    historic: 1,
    motorbike: 180,
    misc: 30,
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

const setWeightText = (text) => {
    if (!weightNode) return;
    weightNode.textContent = text;
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

const loadRecoveredWeight = async () => {
    if (!hasSupabaseConfig) {
        const cachedItems = readCachedItems();
        if (cachedItems.length > 0) {
            setWeightText(formatWeightLabel(computeEstimatedRecoveredKg(cachedItems)));
            return;
        }

        console.warn("[links] Supabase config missing and no cached items available.");
        setWeightText("Recovered weight unavailable");
        return;
    }

    const { data, error } = await supabase.from("items").select("*");

    if (!error && Array.isArray(data) && data.length > 0) {
        setWeightText(formatWeightLabel(computeEstimatedRecoveredKg(data)));
        return;
    }

    const cachedItems = readCachedItems();
    if (cachedItems.length > 0) {
        console.warn("[links] Using cached items fallback for recovered weight.");
        setWeightText(formatWeightLabel(computeEstimatedRecoveredKg(cachedItems)));
        return;
    }

    if (error) {
        console.warn("[links] Failed to fetch recovered weight from Supabase:", error.message || error);
    } else {
        console.warn("[links] Items query returned no rows and no cached fallback.");
    }

    setWeightText("Recovered weight unavailable");
};

loadRecoveredWeight();
