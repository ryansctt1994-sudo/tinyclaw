/**
 * Offline execution evidence, version 1. No authorization is conveyed.
 *
 * The payload is deliberately restricted to ASCII constants, lowercase
 * hexadecimal strings, and safe integer milliseconds. Lexicographically
 * sorted JSON keys are JCS-compatible for this limited type set, but this
 * module is not a general-purpose RFC 8785 implementation.
 *
 * Digest != signature. A hash detects alteration relative to a trusted
 * reference; it does not authenticate the producer or establish replay
 * prevention. Callers must independently protect receipt custody.
 */
import { createHash, randomBytes } from 'node:crypto';

const DOMAIN = Buffer.from('TinyClaw.ExecutionReceipt.v1\0', 'utf8');
const HEX64 = /^[0-9a-f]{64}$/;
const HEX32 = /^[0-9a-f]{32}$/;
const STATUSES = new Set(['completed', 'failed', 'refused']);

export interface ReceiptInput {
    agent_sha256: string;
    skill_sha256: string;
    input_sha256: string;
    output_sha256: string;
    timestamp_ms: number;
    attempt_id: string;
    status: 'completed' | 'failed' | 'refused';
}

export interface ExecutionReceipt extends ReceiptInput {
    schema: 'tinyclaw.execution-receipt.v1';
    authority: 'none';
    digest_sha256: string;
}

const INPUT_KEYS = [
    'agent_sha256', 'attempt_id', 'input_sha256', 'output_sha256',
    'skill_sha256', 'status', 'timestamp_ms',
] as const;

const PAYLOAD_KEYS = [
    'agent_sha256', 'attempt_id', 'authority', 'input_sha256',
    'output_sha256', 'schema', 'skill_sha256', 'status', 'timestamp_ms',
] as const;

function sameKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
    const keys = Object.keys(value).sort();
    return keys.length === expected.length && keys.every((key, i) => key === expected[i]);
}

function validInput(value: unknown): value is ReceiptInput {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const obj = value as Record<string, unknown>;
    if (!sameKeys(obj, INPUT_KEYS)) return false;
    return ['agent_sha256', 'skill_sha256', 'input_sha256', 'output_sha256']
        .every(key => typeof obj[key] === 'string' && HEX64.test(obj[key] as string))
        && typeof obj.attempt_id === 'string' && HEX32.test(obj.attempt_id)
        && typeof obj.status === 'string' && STATUSES.has(obj.status)
        && typeof obj.timestamp_ms === 'number'
        && Number.isSafeInteger(obj.timestamp_ms) && obj.timestamp_ms >= 0;
}

function serializePayload(payload: Record<string, unknown>): Buffer {
    if (!sameKeys(payload, PAYLOAD_KEYS)) throw new Error('Unknown or missing receipt field');
    const canonical: Record<string, unknown> = {};
    for (const key of PAYLOAD_KEYS) canonical[key] = payload[key];
    return Buffer.from(JSON.stringify(canonical), 'utf8');
}

function digest(payload: Record<string, unknown>): string {
    return createHash('sha256').update(DOMAIN).update(serializePayload(payload)).digest('hex');
}

/** Explicit hash of source bytes; never hash user-controlled path text. */
export function hashContent(bytes: Buffer | Uint8Array | string): string {
    return createHash('sha256').update(bytes).digest('hex');
}

/** Random attempt id identifies a run; it is not a replay ledger by itself. */
export function newAttemptId(): string {
    return randomBytes(16).toString('hex');
}

export function createReceipt(input: ReceiptInput): ExecutionReceipt {
    if (!validInput(input)) throw new Error('Invalid execution receipt input');
    const payload = {
        agent_sha256: input.agent_sha256,
        attempt_id: input.attempt_id,
        authority: 'none' as const,
        input_sha256: input.input_sha256,
        output_sha256: input.output_sha256,
        schema: 'tinyclaw.execution-receipt.v1' as const,
        skill_sha256: input.skill_sha256,
        status: input.status,
        timestamp_ms: input.timestamp_ms,
    };
    return { ...payload, digest_sha256: digest(payload) };
}

export function verifyReceipt(value: unknown): value is ExecutionReceipt {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const obj = value as Record<string, unknown>;
    const { digest_sha256: actual, ...payload } = obj;
    if (typeof actual !== 'string' || !HEX64.test(actual)
        || !sameKeys(payload, PAYLOAD_KEYS)
        || payload.authority !== 'none'
        || payload.schema !== 'tinyclaw.execution-receipt.v1') return false;
    const { schema: _schema, authority: _authority, ...input } = payload;
    if (!validInput(input)) return false;
    return digest(payload) === actual;
}
