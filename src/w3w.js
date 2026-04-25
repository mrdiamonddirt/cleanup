export const normalizeW3WWords = (value) => {
    if (typeof value !== "string") return "";

    return value
        .trim()
        .replace(/^\/\/+/, "")
        .toLowerCase();
};

export const hasValidW3WCoordinates = (latitude, longitude) =>
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 && latitude <= 90 &&
    longitude >= -180 && longitude <= 180;

export async function resolveW3WFromCoords({
    latitude,
    longitude,
    apiKey,
    fetchImpl = fetch,
    signal,
}) {
    const normalizedApiKey = String(apiKey || "").trim();
    if (!normalizedApiKey) {
        console.warn("[W3W] Lookup skipped: missing VITE_W3W_API_KEY.");
        return "";
    }

    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!hasValidW3WCoordinates(lat, lng)) {
        console.warn("[W3W] Lookup skipped: invalid coordinates.", { latitude, longitude });
        return "";
    }

    const url =
        "https://api.what3words.com/v3/convert-to-3wa" +
        `?coordinates=${encodeURIComponent(`${lat},${lng}`)}` +
        "&language=en&format=json" +
        `&key=${encodeURIComponent(normalizedApiKey)}`;

    const response = await fetchImpl(url, signal ? { signal } : undefined);
    if (!response.ok) {
        console.warn("[W3W] API request failed.", { status: response.status, statusText: response.statusText });
        throw new Error(`W3W ${response.status}`);
    }

    const payload = await response.json();
    return normalizeW3WWords(payload?.words || "");
}
