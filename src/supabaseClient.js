import { createClient } from "@supabase/supabase-js";

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || "").trim();
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim();

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);

function createMissingSupabaseConfigError() {
    return {
        message:
            "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.",
    };
}

function createMissingSupabaseClient() {
    const error = createMissingSupabaseConfigError();

    const queryBuilder = {
        select: async () => ({ data: null, error }),
        update: () => ({
            eq: async () => ({ error }),
        }),
        delete: () => ({
            eq: async () => ({ error }),
        }),
        insert: () => ({
            select: () => ({
                single: async () => ({ data: null, error }),
            }),
        }),
        eq: async () => ({ error }),
    };

    return {
        auth: {
            getUser: async () => ({ data: { user: null }, error }),
            onAuthStateChange: () => ({
                data: {
                    subscription: {
                        unsubscribe: () => {},
                    },
                },
            }),
            signInWithOAuth: async () => ({ error }),
            signOut: async () => ({ error }),
        },
        from: () => queryBuilder,
        storage: {
            from: () => ({
                upload: async () => ({ error }),
                getPublicUrl: () => ({ data: { publicUrl: "" } }),
            }),
        },
    };
}

if (!hasSupabaseConfig) {
    console.warn(
        "Supabase config is missing. App will run in local read-only mode until env vars are provided.",
    );
}

export const supabase = hasSupabaseConfig
    ? createClient(supabaseUrl, supabaseAnonKey)
    : createMissingSupabaseClient();
