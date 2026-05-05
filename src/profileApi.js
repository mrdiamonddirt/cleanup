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

const BMAC_UNMATCHED_EVENT_SELECT_FIELDS = [
    "id",
    "event_type",
    "source_type",
    "source_key",
    "supporter_email",
    "supporter_name",
    "amount_pence",
    "note",
    "payload",
    "status",
    "matched_profile_id",
    "resolved_contribution_id",
    "created_at",
    "updated_at",
    "resolved_at",
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

function isUniqueViolationError(error) {
    return String(error?.code || "").trim() === "23505";
}

const VALID_INTERACTION_TARGET_TYPES = new Set(["poi", "item", "contributor"]);

function normalizeInteractionTarget(targetType, targetId) {
    const normalizedType = normalizeText(targetType).toLowerCase();
    const normalizedId = normalizeText(String(targetId || ""));

    if (!VALID_INTERACTION_TARGET_TYPES.has(normalizedType)) {
        return {
            targetEntityType: "",
            targetEntityId: "",
            error: new Error(`Invalid target type: ${String(targetType || "")}`),
        };
    }

    if (!normalizedId) {
        return {
            targetEntityType: normalizedType,
            targetEntityId: "",
            error: new Error("Missing target id"),
        };
    }

    return {
        targetEntityType: normalizedType,
        targetEntityId: normalizedId,
        error: null,
    };
}

function logInteractionApiWarning(message, context = {}) {
    console.warn(`[profileApi] ${message}`, context);
}

function normalizeRpcBoolean(value) {
    if (typeof value === "boolean") return value;

    if (typeof value === "number") {
        if (Number.isNaN(value)) return false;
        return value !== 0;
    }

    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (!normalized) return false;
        if (["true", "t", "1", "yes", "y"].includes(normalized)) return true;
        if (["false", "f", "0", "no", "n"].includes(normalized)) return false;
    }

    return Boolean(value);
}

function normalizeRpcNumber(value, fallback = 0) {
    const next = Number(value);
    return Number.isFinite(next) ? next : fallback;
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

    if (isUniqueViolationError(error)) {
        const {
            data: existingAfterConflict,
            error: existingAfterConflictError,
        } = await supabase
            .from("profiles")
            .select(PROFILE_SELECT_FIELDS)
            .eq("id", user.id)
            .single();

        if (!existingAfterConflictError && existingAfterConflict) {
            return { profile: existingAfterConflict, error: null };
        }
    }

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
    const { targetEntityType, targetEntityId, error: targetError } = normalizeInteractionTarget(
        targetType,
        targetId,
    );
    if (targetError) {
        logInteractionApiWarning("submitLike skipped due to invalid target", {
            targetType,
            targetId,
            message: targetError.message,
        });
        return { interaction: null, error: targetError };
    }

    const { data, error } = await supabase.rpc("submit_social_interaction", {
        p_interaction_type: "like",
        p_target_entity_type: targetEntityType,
        p_target_entity_id: targetEntityId,
        p_metadata: metadata,
    });

    if (error) {
        logInteractionApiWarning("submitLike RPC failed", {
            targetEntityType,
            targetEntityId,
            code: error.code,
            message: error.message,
        });
        return { interaction: null, error };
    }

    return { interaction: Array.isArray(data) ? data[0] || null : data || null, error: null };
}

export async function submitShare(targetType, targetId, metadata = {}) {
    const { targetEntityType, targetEntityId, error: targetError } = normalizeInteractionTarget(
        targetType,
        targetId,
    );
    if (targetError) {
        logInteractionApiWarning("submitShare skipped due to invalid target", {
            targetType,
            targetId,
            message: targetError.message,
        });
        return { interaction: null, error: targetError };
    }

    const { data, error } = await supabase.rpc("submit_social_interaction", {
        p_interaction_type: "share",
        p_target_entity_type: targetEntityType,
        p_target_entity_id: targetEntityId,
        p_metadata: metadata,
    });

    if (error) {
        logInteractionApiWarning("submitShare RPC failed", {
            targetEntityType,
            targetEntityId,
            code: error.code,
            message: error.message,
        });
        return { interaction: null, error };
    }

    return { interaction: Array.isArray(data) ? data[0] || null : data || null, error: null };
}

export async function submitCommentForReview(targetType, targetId, body, parentCommentId = null) {
    const { targetEntityType, targetEntityId, error: targetError } = normalizeInteractionTarget(
        targetType,
        targetId,
    );
    if (targetError) {
        logInteractionApiWarning("submitCommentForReview skipped due to invalid target", {
            targetType,
            targetId,
            message: targetError.message,
        });
        return { comment: null, error: targetError };
    }

    const { data, error } = await supabase.rpc("submit_comment_for_review", {
        p_target_entity_type: targetEntityType,
        p_target_entity_id: targetEntityId,
        p_body: typeof body === "string" ? body.trim() : "",
        p_parent_comment_id: parentCommentId,
    });

    if (error) {
        logInteractionApiWarning("submitCommentForReview RPC failed", {
            targetEntityType,
            targetEntityId,
            code: error.code,
            message: error.message,
        });
        return { comment: null, error };
    }

    return { comment: data || null, error: null };
}

function normalizeInteractionSummaryResponse(data) {
    const row = Array.isArray(data) ? data[0] || null : data || null;

    return {
        likeCount: normalizeRpcNumber(row?.like_count ?? row?.likeCount, 0),
        shareCount: normalizeRpcNumber(row?.share_count ?? row?.shareCount, 0),
        viewerHasLiked: normalizeRpcBoolean(row?.viewer_has_liked ?? row?.viewerHasLiked),
        viewerHasShared: normalizeRpcBoolean(row?.viewer_has_shared ?? row?.viewerHasShared),
    };
}

export async function getInteractionCountsForTarget(targetType, targetId) {
    const { targetEntityType, targetEntityId, error: targetError } = normalizeInteractionTarget(
        targetType,
        targetId,
    );
    if (targetError) {
        logInteractionApiWarning("getInteractionCountsForTarget skipped due to invalid target", {
            targetType,
            targetId,
            message: targetError.message,
        });
        return {
            likeCount: 0,
            shareCount: 0,
            viewerHasLiked: false,
            viewerHasShared: false,
            error: targetError,
        };
    }

    const { data, error } = await supabase.rpc("get_target_interaction_summary", {
        p_target_entity_type: targetEntityType,
        p_target_entity_id: targetEntityId,
    });

    if (error) {
        logInteractionApiWarning("getInteractionCountsForTarget RPC failed", {
            targetEntityType,
            targetEntityId,
            code: error.code,
            message: error.message,
        });
        return {
            likeCount: 0,
            shareCount: 0,
            viewerHasLiked: false,
            viewerHasShared: false,
            error,
        };
    }

    const summary = normalizeInteractionSummaryResponse(data);

    return {
        ...summary,
        error: null,
    };
}

export async function toggleLikeForTarget(targetType, targetId, metadata = {}) {
    const { targetEntityType, targetEntityId, error: targetError } = normalizeInteractionTarget(
        targetType,
        targetId,
    );
    if (targetError) {
        logInteractionApiWarning("toggleLikeForTarget skipped due to invalid target", {
            targetType,
            targetId,
            message: targetError.message,
        });
        return {
            interaction: null,
            summary: {
                likeCount: 0,
                shareCount: 0,
                viewerHasLiked: false,
                viewerHasShared: false,
            },
            error: targetError,
        };
    }

    const { data, error } = await supabase.rpc("toggle_like_interaction", {
        p_target_entity_type: targetEntityType,
        p_target_entity_id: targetEntityId,
        p_metadata: metadata,
    });

    if (error) {
        logInteractionApiWarning("toggleLikeForTarget RPC failed", {
            targetEntityType,
            targetEntityId,
            code: error.code,
            message: error.message,
        });
        return {
            interaction: null,
            summary: {
                likeCount: 0,
                shareCount: 0,
                viewerHasLiked: false,
                viewerHasShared: false,
            },
            error,
        };
    }

    const row = Array.isArray(data) ? data[0] || null : data || null;
    const normalizedInteraction = row
        ? {
            ...row,
            liked: normalizeRpcBoolean(row?.liked),
            points_delta: normalizeRpcNumber(row?.points_delta, 0),
            points_balance_after: normalizeRpcNumber(row?.points_balance_after, 0),
        }
        : null;

    return {
        interaction: normalizedInteraction,
        summary: normalizeInteractionSummaryResponse(normalizedInteraction),
        error: null,
    };
}

export async function listSocialLeaderboardTotals() {
    const { data, error } = await supabase.rpc("get_social_leaderboard_counts");

    if (error) {
        return { rows: [], error };
    }

    return { rows: Array.isArray(data) ? data : [], error: null };
}

export async function listPointsRules() {
    const { data, error } = await supabase
        .from("points_rules")
        .select("rule_code, display_name, points_value")
        .eq("is_active", true);

    if (error) {
        return { rules: [], error };
    }

    return { rules: Array.isArray(data) ? data : [], error: null };
}

export async function listCommentsForTarget(targetType, targetId) {
    const { targetEntityType, targetEntityId, error: targetError } = normalizeInteractionTarget(
        targetType,
        targetId,
    );
    if (targetError) {
        logInteractionApiWarning("listCommentsForTarget skipped due to invalid target", {
            targetType,
            targetId,
            message: targetError.message,
        });
        return { comments: [], error: targetError };
    }

    const { data, error } = await supabase
        .from("comments")
        .select(COMMENT_SELECT_FIELDS)
        .eq("target_entity_type", targetEntityType)
        .eq("target_entity_id", targetEntityId)
        .order("created_at", { ascending: false });

    if (error) {
        logInteractionApiWarning("listCommentsForTarget query failed", {
            targetEntityType,
            targetEntityId,
            code: error.code,
            message: error.message,
        });
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

export async function awardCommunityPointsForAdmin(profileId, pointsDelta, reason = "") {
    const parsedPointsDelta = Number.parseInt(String(pointsDelta), 10);
    const { data, error } = await supabase.rpc("award_community_points", {
        p_profile_id: profileId,
        p_points_delta: Number.isFinite(parsedPointsDelta) ? parsedPointsDelta : 0,
        p_reason: reason,
    });

    if (error) {
        return { pointEvent: null, error };
    }

    return { pointEvent: data || null, error: null };
}

export async function listUnmatchedBmacEventsForAdmin() {
    const { data, error } = await supabase
        .from("bmac_unmatched_events")
        .select(BMAC_UNMATCHED_EVENT_SELECT_FIELDS)
        .order("created_at", { ascending: false });

    if (error) {
        return { events: [], error };
    }

    return { events: Array.isArray(data) ? data : [], error: null };
}

export async function resolveUnmatchedBmacEventForAdmin(unmatchedEventId, profileId, resolutionNote = "") {
    const { data, error } = await supabase.rpc("resolve_bmac_unmatched_event", {
        p_unmatched_event_id: unmatchedEventId,
        p_profile_id: profileId,
        p_resolution_note: resolutionNote,
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

export async function listRecentPointDeltasByActionForAdmin(hoursBack = 72, limit = 2000) {
    const parsedHoursBack = Number.parseInt(String(hoursBack), 10);
    const safeHoursBack = Number.isFinite(parsedHoursBack) && parsedHoursBack > 0
        ? parsedHoursBack
        : 72;
    const parsedLimit = Number.parseInt(String(limit), 10);
    const safeLimit = Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, 5000)
        : 2000;
    const cutoff = new Date(Date.now() - safeHoursBack * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
        .from("point_events_ledger")
        .select("action_code, points_delta, created_at")
        .gte("created_at", cutoff)
        .order("created_at", { ascending: false })
        .limit(safeLimit);

    if (error) {
        return { rows: [], error };
    }

    const grouped = new Map();
    (Array.isArray(data) ? data : []).forEach((row) => {
        const actionCode = normalizeText(row?.action_code) || "unknown";
        const pointsDelta = Number.parseInt(String(row?.points_delta ?? 0), 10);
        const safePointsDelta = Number.isFinite(pointsDelta) ? pointsDelta : 0;
        const createdAt = normalizeText(row?.created_at);
        const existing = grouped.get(actionCode) || {
            actionCode,
            eventCount: 0,
            netDelta: 0,
            positiveDelta: 0,
            negativeDelta: 0,
            latestCreatedAt: "",
        };

        existing.eventCount += 1;
        existing.netDelta += safePointsDelta;
        if (safePointsDelta >= 0) {
            existing.positiveDelta += safePointsDelta;
        } else {
            existing.negativeDelta += safePointsDelta;
        }
        if (!existing.latestCreatedAt || (createdAt && createdAt > existing.latestCreatedAt)) {
            existing.latestCreatedAt = createdAt;
        }

        grouped.set(actionCode, existing);
    });

    return {
        rows: Array.from(grouped.values()).sort((left, right) => {
            if (Math.abs(right.netDelta) !== Math.abs(left.netDelta)) {
                return Math.abs(right.netDelta) - Math.abs(left.netDelta);
            }
            return right.eventCount - left.eventCount;
        }),
        error: null,
    };
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
