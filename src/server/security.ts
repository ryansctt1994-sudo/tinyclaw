/** Browser requests are limited to the local TinyOffice origins by default. */
export function allowedBrowserOrigins(env: Record<string, string | undefined> = process.env): Set<string> {
    const origins = new Set(['http://localhost:3000', 'http://127.0.0.1:3000']);
    for (const origin of (env.TINYCLAW_ALLOWED_ORIGINS || '').split(',')) {
        const trimmed = origin.trim();
        if (trimmed) origins.add(trimmed);
    }
    return origins;
}

/** A missing Origin is allowed for local CLI/channel integrations. */
export function isBrowserOriginAllowed(origin: string | undefined, origins: ReadonlySet<string>): boolean {
    return !origin || origins.has(origin);
}

/** Only bind to loopback unless an operator explicitly configures another host. */
export function apiHost(env: Record<string, string | undefined> = process.env): string {
    return env.TINYCLAW_API_HOST?.trim() || '127.0.0.1';
}
