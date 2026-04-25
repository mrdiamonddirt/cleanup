import { useState, useEffect, useRef } from "react";
import { normalizeW3WWords, resolveW3WFromCoords } from "./w3w";

// Module-level cache: "lat5dp,lng5dp" ? words string
const w3wCache = new Map();

const W3W_API_KEY = import.meta.env.VITE_W3W_API_KEY || "";

export function useW3W(lat, lng) {
    const hasCoords =
        typeof lat === "number" && isFinite(lat) &&
        typeof lng === "number" && isFinite(lng);

    const cacheKey = hasCoords
        ? `${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`
        : null;

    const cached = cacheKey ? w3wCache.get(cacheKey) : undefined;

    const [words, setWords] = useState(() => cached ?? null);
    const [loading, setLoading] = useState(!cached && Boolean(cacheKey) && Boolean(W3W_API_KEY));

    const cacheKeyRef = useRef(cacheKey);
    cacheKeyRef.current = cacheKey;

    useEffect(() => {
        if (!cacheKey || !W3W_API_KEY) {
            setWords(null);
            setLoading(false);
            return undefined;
        }

        const alreadyCached = w3wCache.get(cacheKey);
        if (alreadyCached !== undefined) {
            setWords(alreadyCached);
            setLoading(false);
            return undefined;
        }

        setWords(null);
        setLoading(true);

        const controller = new AbortController();

        resolveW3WFromCoords({
            latitude: lat,
            longitude: lng,
            apiKey: W3W_API_KEY,
            signal: controller.signal,
        })
            .then((result) => {
                const normalizedResult = normalizeW3WWords(result);
                if (normalizedResult) w3wCache.set(cacheKeyRef.current, normalizedResult);
                setWords(normalizedResult || null);
                setLoading(false);
            })
            .catch((err) => {
                if (err.name === "AbortError") return;
                console.warn("[W3W] Hook lookup failed.", err);
                setLoading(false);
            });

        return () => controller.abort();
    }, [cacheKey]); // eslint-disable-line react-hooks/exhaustive-deps

    return { words, loading };
}
