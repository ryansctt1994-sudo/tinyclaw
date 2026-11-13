/**
 * API Server — HTTP endpoints for Mission Control and external integrations.
 *
 * Runs on a configurable port (env TINYCLAW_API_PORT, default 3777) and
 * provides REST + SSE access to agents, teams, settings, queue status,
 * events, logs, and chat histories.
 */

import http from 'http';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { RESPONSE_ALREADY_SENT } from '@hono/node-server/utils/response';
import { Conversation } from '../lib/types';
import { log } from '../lib/logging';
import { addSSEClient, removeSSEClient } from './sse';
import { allowedBrowserOrigins, isBrowserOriginAllowed, apiHost } from './security';

import messagesRoutes from './routes/messages';
import agentsRoutes from './routes/agents';
import teamsRoutes from './routes/teams';
import settingsRoutes from './routes/settings';
import { createQueueRoutes } from './routes/queue';
import tasksRoutes from './routes/tasks';
import logsRoutes from './routes/logs';
import chatsRoutes from './routes/chats';

const API_PORT = parseInt(process.env.TINYCLAW_API_PORT || '3777', 10);

/**
 * Create and start the API server.
 *
 * @param conversations  Live reference to the queue-processor conversation map
 *                       so the /api/queue/status endpoint can report active count.
 * @returns The http.Server instance (for graceful shutdown).
 */
export function startApiServer(
    conversations: Map<string, Conversation>
): http.Server {
    const app = new Hono();

    // Reject unapproved browser origins before handling requests. Restricting
    // CORS headers alone would not block simple cross-site requests.
    const origins = allowedBrowserOrigins();
    app.use('/*', async (c, next) => {
        const origin = c.req.header('Origin');
        if (!isBrowserOriginAllowed(origin, origins)) {
            return c.json({ error: 'Browser origin not allowed' }, 403);
        }
        await next();
    });
    app.use('/*', cors({ origin: (origin) => origins.has(origin) ? origin : '' }));

    // Mount route modules
    app.route('/', messagesRoutes);
    app.route('/', agentsRoutes);
    app.route('/', teamsRoutes);
    app.route('/', settingsRoutes);
    app.route('/', createQueueRoutes(conversations));
    app.route('/', tasksRoutes);
    app.route('/', logsRoutes);
    app.route('/', chatsRoutes);

    // SSE endpoint — needs raw Node.js response for streaming
    app.get('/api/events/stream', (c) => {
        const nodeRes = (c.env as { outgoing: http.ServerResponse }).outgoing;
        const headers: Record<string, string> = {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        };
        const origin = c.req.header('Origin');
        if (origin && origins.has(origin)) {
            headers['Access-Control-Allow-Origin'] = origin;
            headers['Vary'] = 'Origin';
        }
        nodeRes.writeHead(200, headers);
        nodeRes.write(`event: connected\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);
        addSSEClient(nodeRes);
        nodeRes.on('close', () => removeSSEClient(nodeRes));
        return RESPONSE_ALREADY_SENT;
    });

    // 404 fallback
    app.notFound((c) => {
        return c.json({ error: 'Not found' }, 404);
    });

    // Error handler
    app.onError((err, c) => {
        log('ERROR', `[API] ${err.message}`);
        return c.json({ error: 'Internal server error' }, 500);
    });

    const hostname = apiHost();
    const server = serve({
        fetch: app.fetch,
        port: API_PORT,
        hostname,
    }, () => {
        log('INFO', `API server listening on http://${hostname}:${API_PORT}`);
        if (!['127.0.0.1', 'localhost', '::1'].includes(hostname)) {
            log('WARN', 'API bound beyond loopback; restrict network access and require external authentication');
        }
    });

    return server as unknown as http.Server;
}
