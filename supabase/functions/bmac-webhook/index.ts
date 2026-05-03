import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.3";

type JsonRecord = Record<string, unknown>;

const BMAC_SECRET_HEADER_NAMES = [
    "x-bmc-webhook-secret",
    "x-bmac-webhook-secret",
    "x-bmc-secret",
    "x-bmac-secret",
    "x-webhook-secret",
];

function asObject(value: unknown): JsonRecord | null {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as JsonRecord
        : null;
}

function normalizeText(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value: unknown): string {
    return normalizeText(value).toLowerCase();
}

function getNestedValue(record: JsonRecord, path: string): unknown {
    const segments = path.split(".");
    let current: unknown = record;

    for (const segment of segments) {
        const currentObject = asObject(current);
        if (!currentObject || !(segment in currentObject)) {
            return undefined;
        }
        current = currentObject[segment];
    }

    return current;
}

function firstText(record: JsonRecord, paths: string[]): string {
    for (const path of paths) {
        const value = getNestedValue(record, path);
        const normalized = normalizeText(value);
        if (normalized) {
            return normalized;
        }
    }

    return "";
}

function firstNumber(record: JsonRecord, paths: string[]): number | null {
    for (const path of paths) {
        const value = getNestedValue(record, path);

        if (typeof value === "number" && Number.isFinite(value)) {
            return value;
        }

        if (typeof value === "string") {
            const parsed = Number.parseFloat(value.trim());
            if (Number.isFinite(parsed)) {
                return parsed;
            }
        }
    }

    return null;
}

function canonicalizeJson(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map((entry) => canonicalizeJson(entry)).join(",")}]`;
    }

    if (value && typeof value === "object") {
        const record = value as JsonRecord;
        const keys = Object.keys(record).sort();
        return `{${keys
            .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(record[key])}`)
            .join(",")}}`;
    }

    return JSON.stringify(value);
}

async function sha256Hex(value: string): Promise<string> {
    const encoded = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", encoded);
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

function timingSafeEqual(left: string, right: string): boolean {
    const leftBytes = new TextEncoder().encode(left);
    const rightBytes = new TextEncoder().encode(right);

    if (leftBytes.length !== rightBytes.length) {
        return false;
    }

    let diff = 0;
    for (let index = 0; index < leftBytes.length; index += 1) {
        diff |= leftBytes[index] ^ rightBytes[index];
    }

    return diff === 0;
}

function extractEventType(payload: JsonRecord, request: Request): string {
    const headerEventType = [
        request.headers.get("x-bmc-event"),
        request.headers.get("x-bmac-event"),
        request.headers.get("x-event-type"),
    ]
        .map((value) => normalizeText(value))
        .find(Boolean);

    if (headerEventType) {
        return headerEventType;
    }

    return firstText(payload, [
        "type",
        "event_type",
        "event.type",
        "name",
        "data.type",
    ]) || "support.created";
}

async function extractEventKey(payload: JsonRecord, eventType: string): Promise<string> {
    const sourceId = firstText(payload, [
        "id",
        "event_id",
        "webhook_id",
        "data.id",
        "support_id",
        "support.id",
        "data.support_id",
        "transaction_id",
        "payment_id",
    ]);

    if (sourceId) {
        return `${eventType}:${sourceId}`;
    }

    const fingerprint = await sha256Hex(canonicalizeJson(payload));
    return `${eventType}:sha256:${fingerprint}`;
}

function extractSupporterEmail(payload: JsonRecord): string {
    return normalizeEmail(firstText(payload, [
        "supporter_email",
        "email",
        "support_email",
        "payer_email",
        "support.email",
        "supporter.email",
        "data.email",
        "data.supporter_email",
        "data.support.email",
        "data.supporter.email",
    ]));
}

function extractSupporterName(payload: JsonRecord): string {
    return firstText(payload, [
        "supporter_name",
        "name",
        "supporter.name",
        "support.name",
        "data.name",
        "data.supporter_name",
        "data.supporter.name",
    ]);
}

function extractNote(payload: JsonRecord): string {
    return firstText(payload, [
        "message",
        "support_message",
        "supporter_message",
        "note",
        "data.message",
        "data.support_message",
        "support.message",
    ]);
}

function extractAmountPence(payload: JsonRecord): number {
    const minorUnits = firstNumber(payload, [
        "amount_pence",
        "amount_cents",
        "data.amount_pence",
        "data.amount_cents",
        "support.amount_pence",
        "support.amount_cents",
    ]);

    if (minorUnits !== null) {
        return Math.round(minorUnits);
    }

    const majorUnits = firstNumber(payload, [
        "amount",
        "support_amount",
        "total_amount",
        "support_coffee_price",
        "data.amount",
        "data.total_amount",
        "support.amount",
        "support.total_amount",
    ]);

    if (majorUnits === null) {
        throw new Error("Unable to determine contribution amount from webhook payload");
    }

    return Math.round(majorUnits * 100);
}

function getVerificationCandidates(payload: JsonRecord, request: Request): string[] {
    const candidates = [
        ...BMAC_SECRET_HEADER_NAMES.map((headerName) => request.headers.get(headerName)),
        firstText(payload, [
            "verification_token",
            "webhook_secret",
            "secret",
            "data.verification_token",
            "data.webhook_secret",
        ]),
    ];

    return candidates
        .map((value) => normalizeText(value))
        .filter(Boolean);
}

serve(async (request) => {
    if (request.method !== "POST") {
        return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    const webhookSecret = normalizeText(Deno.env.get("BMAC_WEBHOOK_SECRET"));
    const supabaseUrl = normalizeText(Deno.env.get("SUPABASE_URL"));
    const serviceRoleKey = normalizeText(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));

    if (!webhookSecret || !supabaseUrl || !serviceRoleKey) {
        return Response.json({ error: "Webhook environment is not configured" }, { status: 500 });
    }

    let payload: JsonRecord;
    try {
        const parsed = await request.json();
        payload = asObject(parsed) || {};
    } catch {
        return Response.json({ error: "Invalid JSON payload" }, { status: 400 });
    }

    const verificationCandidates = getVerificationCandidates(payload, request);
    const isVerified = verificationCandidates.some((candidate) => timingSafeEqual(candidate, webhookSecret));

    if (!isVerified) {
        return Response.json({ error: "Invalid webhook secret" }, { status: 401 });
    }

    try {
        const eventType = extractEventType(payload, request);
        const sourceKey = await extractEventKey(payload, eventType);
        const amountPence = extractAmountPence(payload);
        const supporterEmail = extractSupporterEmail(payload);
        const supporterName = extractSupporterName(payload);
        const note = extractNote(payload);

        const supabase = createClient(supabaseUrl, serviceRoleKey, {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
            },
        });

        const { data, error } = await supabase.rpc("ingest_bmac_webhook_event", {
            p_event_type: eventType,
            p_source_key: sourceKey,
            p_supporter_email: supporterEmail || null,
            p_supporter_name: supporterName,
            p_amount_pence: amountPence,
            p_note: note,
            p_payload: payload,
        });

        if (error) {
            console.error("Failed to ingest BMAC webhook", error);
            return Response.json({ error: "Failed to ingest webhook event" }, { status: 500 });
        }

        const result = Array.isArray(data) ? (data[0] ?? null) : data;
        return Response.json({ ok: true, result }, { status: 200 });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        console.error("Invalid BMAC webhook payload", error);
        return Response.json({ error: message }, { status: 400 });
    }
});