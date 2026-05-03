import { supabase } from "./supabaseClient";

const EMPTY_PROFILE = {
    display_name: "",
    avatar_url: "",
    is_facebook_group_member: false,
    is_bmc_supporter: false,
    supporter_points: 0,
    supporter_note: "",
    supporter_verified_at: null,
    delete_requested_at: null,
};

const PROFILE_SELECT_FIELDS = [
    "id",
    "display_name",
    "avatar_url",
    "is_facebook_group_member",
    "is_bmc_supporter",
    "supporter_points",
    "supporter_note",
    "supporter_verified_at",
    "delete_requested_at",
    "created_at",
    "updated_at",
].join(", ");

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
        .select(PROFILE_SELECT_FIELDS)
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
        .select(PROFILE_SELECT_FIELDS)
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
        .select(PROFILE_SELECT_FIELDS)
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

export async function listProfilesForAdmin() {
    const { data, error } = await supabase
        .from("profiles")
        .select(PROFILE_SELECT_FIELDS)
        .order("updated_at", { ascending: false });

    if (error) {
        return { profiles: [], error };
    }

    return {
        profiles: Array.isArray(data)
            ? data.map((profile) => ({
                ...EMPTY_PROFILE,
                ...profile,
            }))
            : [],
        error: null,
    };
}

export async function updateProfileForAdmin(profileId, updates) {
    const safeUpdates = {
        is_facebook_group_member: Boolean(updates?.is_facebook_group_member),
        is_bmc_supporter: Boolean(updates?.is_bmc_supporter),
        supporter_points: Number.isFinite(Number(updates?.supporter_points))
            ? Number(updates.supporter_points)
            : 0,
        supporter_note: normalizeText(updates?.supporter_note),
        supporter_verified_at: updates?.supporter_verified_at || new Date().toISOString(),
    };

    const { data, error } = await supabase
        .from("profiles")
        .update(safeUpdates)
        .eq("id", profileId)
        .select(PROFILE_SELECT_FIELDS)
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

export async function requestAccountDeletion(userId) {
    if (!userId) {
        return { profile: null, error: new Error("Missing user id") };
    }

    const { data, error } = await supabase
        .from("profiles")
        .update({ delete_requested_at: new Date().toISOString() })
        .eq("id", userId)
        .select(PROFILE_SELECT_FIELDS)
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

export async function cancelAccountDeletion(userId) {
    if (!userId) {
        return { profile: null, error: new Error("Missing user id") };
    }

    const { data, error } = await supabase
        .from("profiles")
        .update({ delete_requested_at: null })
        .eq("id", userId)
        .select(PROFILE_SELECT_FIELDS)
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
