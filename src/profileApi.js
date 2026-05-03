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

const POINT_EVENT_SELECT_FIELDS = [
    "id",
    "profile_id",
    "action_code",
    "points_delta",
    "balance_after",
    "source_type",
    "source_id",
    "reason",
    "metadata",
    "created_by",
    "created_at",
].join(", ");

const COMMENT_SELECT_FIELDS = [
    "id",
    "profile_id",
    "target_entity_type",
    "target_entity_id",
    "parent_comment_id",
    "body",
    "status",
    "moderation_reason",
    "approved_by",
    "approved_at",
    "rejected_by",
    "rejected_at",
    "created_at",
    "updated_at",
].join(", ");

const ADMIN_AUDIT_SELECT_FIELDS = [
    "id",
    "actor_id",
    "action_type",
    "target_table",
    "target_id",
    "reason",
    "old_values",
    "new_values",
    "metadata",
    "created_at",
].join(", ");

const USER_BAN_SELECT_FIELDS = [
    "id",
    "profile_id",
    "reason",
    "is_active",
    "created_by",
    "lifted_by",
    "created_at",
    "lifted_at",
    "metadata",
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

export async function submitLike(targetType, targetId, metadata = {}) {
    const { data, error } = await supabase.rpc("submit_social_interaction", {
        p_interaction_type: "like",
        p_target_entity_type: targetType,
        p_target_entity_id: String(targetId || "").trim(),
        p_metadata: metadata,
    });

    if (error) {
        return { interaction: null, error };
    }

    return { interaction: Array.isArray(data) ? data[0] || null : data || null, error: null };
}

export async function submitShare(targetType, targetId, metadata = {}) {
    const { data, error } = await supabase.rpc("submit_social_interaction", {
        p_interaction_type: "share",
        p_target_entity_type: targetType,
        p_target_entity_id: String(targetId || "").trim(),
        p_metadata: metadata,
    });

    if (error) {
        return { interaction: null, error };
    }

    return { interaction: Array.isArray(data) ? data[0] || null : data || null, error: null };
}

export async function submitCommentForReview(targetType, targetId, body, parentCommentId = null) {
    const { data, error } = await supabase.rpc("submit_comment_for_review", {
        p_target_entity_type: targetType,
        p_target_entity_id: String(targetId || "").trim(),
        p_body: typeof body === "string" ? body.trim() : "",
        p_parent_comment_id: parentCommentId,
    });

    if (error) {
        return { comment: null, error };
    }

    return { comment: data || null, error: null };
}

export async function getInteractionCountsForTarget(targetType, targetId) {
    const { data, error } = await supabase
        .from("social_interactions")
        .select("interaction_type")
        .eq("target_entity_type", targetType)
        .eq("target_entity_id", String(targetId || "").trim());

    if (error) {
        return {
            likeCount: 0,
            shareCount: 0,
            error,
        };
    }

    let likeCount = 0;
    let shareCount = 0;

    if (Array.isArray(data)) {
        for (const row of data) {
            if (row?.interaction_type === "like") likeCount += 1;
            if (row?.interaction_type === "share") shareCount += 1;
        }
    }

    return {
        likeCount,
        shareCount,
        error: null,
    };
}

export async function listCommentsForTarget(targetType, targetId) {
    const { data, error } = await supabase
        .from("comments")
        .select(COMMENT_SELECT_FIELDS)
        .eq("target_entity_type", targetType)
        .eq("target_entity_id", String(targetId || "").trim())
        .order("created_at", { ascending: false });

    if (error) {
        return { comments: [], error };
    }

    return { comments: Array.isArray(data) ? data : [], error: null };
}

export async function listPendingCommentsForAdmin() {
    const { data, error } = await supabase
        .from("comments")
        .select(COMMENT_SELECT_FIELDS)
        .eq("status", "pending")
        .order("created_at", { ascending: true });

    if (error) {
        return { comments: [], error };
    }

    return { comments: Array.isArray(data) ? data : [], error: null };
}

export async function approveCommentForAdmin(commentId, reason = "") {
    const { data, error } = await supabase.rpc("approve_comment", {
        p_comment_id: commentId,
        p_reason: reason,
    });

    if (error) {
        return { comment: null, error };
    }

    return { comment: data || null, error: null };
}

export async function rejectCommentForAdmin(commentId, reason = "") {
    const { data, error } = await supabase.rpc("reject_comment", {
        p_comment_id: commentId,
        p_reason: reason,
    });

    if (error) {
        return { comment: null, error };
    }

    return { comment: data || null, error: null };
}

export async function setFacebookGroupMembershipWithBonus(profileId, isMember, reason = "") {
    const { data, error } = await supabase.rpc("set_facebook_group_membership_with_bonus", {
        p_profile_id: profileId,
        p_is_member: Boolean(isMember),
        p_reason: reason,
    });

    if (error) {
        return { profile: null, error };
    }

    return { profile: data || null, error: null };
}

export async function recordBmacContributionAmount(profileId, amountPence, note = "") {
    const parsedAmountPence = Number.parseInt(String(amountPence), 10);
    const { data, error } = await supabase.rpc("record_bmac_contribution_amount", {
        p_profile_id: profileId,
        p_amount_pence: Number.isFinite(parsedAmountPence) ? parsedAmountPence : 0,
        p_note: note,
    });

    if (error) {
        return { contribution: null, error };
    }

    return { contribution: data || null, error: null };
}

export async function listPointEventsForProfile(profileId, limit = 100) {
    const { data, error } = await supabase
        .from("point_events_ledger")
        .select(POINT_EVENT_SELECT_FIELDS)
        .eq("profile_id", profileId)
        .order("created_at", { ascending: false })
        .limit(limit);

    if (error) {
        return { events: [], error };
    }

    return { events: Array.isArray(data) ? data : [], error: null };
}

export async function listAdminAuditLogs(limit = 200) {
    const { data, error } = await supabase
        .from("admin_audit_logs")
        .select(ADMIN_AUDIT_SELECT_FIELDS)
        .order("created_at", { ascending: false })
        .limit(limit);

    if (error) {
        return { logs: [], error };
    }

    return { logs: Array.isArray(data) ? data : [], error: null };
}

export async function banProfileForAdmin(profileId, reason) {
    const { data, error } = await supabase.rpc("ban_profile", {
        p_profile_id: profileId,
        p_reason: reason,
    });

    if (error) {
        return { ban: null, error };
    }

    return { ban: data || null, error: null };
}

export async function unbanProfileForAdmin(profileId, reason = "") {
    const { data, error } = await supabase.rpc("unban_profile", {
        p_profile_id: profileId,
        p_reason: reason,
    });

    if (error) {
        return { ban: null, error };
    }

    return { ban: data || null, error: null };
}

export async function listBansForAdmin() {
    const { data, error } = await supabase
        .from("user_bans")
        .select(USER_BAN_SELECT_FIELDS)
        .order("created_at", { ascending: false });

    if (error) {
        return { bans: [], error };
    }

    return { bans: Array.isArray(data) ? data : [], error: null };
}
