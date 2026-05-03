import { supabase } from "./supabaseClient";

const EMPTY_PROFILE = {
    display_name: "",
    avatar_url: "",
};

function normalizeText(value) {
    if (typeof value !== "string") return "";
    return value.trim();
}

function getProfileSeedFromUser(user) {
    const metadata = user?.user_metadata || {};
    const displayNameCandidates = [
        metadata.full_name,
        metadata.name,
        metadata.preferred_username,
        metadata.user_name,
        metadata.username,
        metadata.login,
    ];
    const avatarCandidates = [
        metadata.avatar_url,
        metadata.picture,
    ];

    const display_name = displayNameCandidates
        .map(normalizeText)
        .find(Boolean) || "";
    const avatar_url = avatarCandidates
        .map(normalizeText)
        .find(Boolean) || "";

    return {
        id: user?.id,
        display_name,
        avatar_url,
    };
}

function isMissingProfileError(error) {
    const code = String(error?.code || "").trim();
    const message = String(error?.message || "").toLowerCase();
    return code === "PGRST116" || message.includes("no rows");
}

export async function ensureProfileForUser(user) {
    if (!user?.id) {
        return { profile: null, error: new Error("Missing user id") };
    }

    const {
        data: existingProfile,
        error: existingProfileError,
    } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url, created_at, updated_at")
        .eq("id", user.id)
        .single();

    if (!existingProfileError && existingProfile) {
        return { profile: existingProfile, error: null };
    }

    if (existingProfileError && !isMissingProfileError(existingProfileError)) {
        return { profile: null, error: existingProfileError };
    }

    const seed = getProfileSeedFromUser(user);
    const { data, error } = await supabase
        .from("profiles")
        .insert(seed)
        .select("id, display_name, avatar_url, created_at, updated_at")
        .single();

    if (error) {
        return { profile: null, error };
    }

    return { profile: data || null, error: null };
}

export async function updateProfileForUser(userId, updates) {
    const safeUpdates = {
        display_name: normalizeText(updates?.display_name),
        avatar_url: normalizeText(updates?.avatar_url),
    };

    const { data, error } = await supabase
        .from("profiles")
        .update(safeUpdates)
        .eq("id", userId)
        .select("id, display_name, avatar_url, created_at, updated_at")
        .single();

    if (error) {
        return { profile: null, error };
    }

    return {
        profile: {
            ...EMPTY_PROFILE,
            ...(data || {}),
        },
        error: null,
    };
}
