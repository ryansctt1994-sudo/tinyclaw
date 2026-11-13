import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { AgentConfig, TeamConfig } from './types';
import { SCRIPT_DIR, resolveClaudeModel, resolveCodexModel, resolveOpenCodeModel } from './config';
import { log } from './logging';
import { ensureAgentDirectory, updateAgentTeammates } from './agent';
import { buildCodexArgs, buildClaudeArgs, assertOpenCodeAuthorized } from './provider-policy';
import { buildWorkerEnvironment } from './worker-environment';

export interface CommandLimits {
    timeoutMs?: number;
    maxOutputBytes?: number;
}

/**
 * Bound unattended provider CLI execution. Limits apply to the direct CLI
 * process only; do not assume child process trees are safely isolated.
 */
export async function runCommand(
    command: string, args: string[], cwd?: string, limits: CommandLimits = {}
): Promise<string> {
    const timeoutMs = limits.timeoutMs ?? (10 * 60 * 1000);
    const maxOutputBytes = limits.maxOutputBytes ?? (8 * 1024 * 1024);
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 ||
        !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0) {
        throw new Error('Invalid provider command limits');
    }
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: cwd || SCRIPT_DIR,
            env: buildWorkerEnvironment(),
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        let capturedBytes = 0;
        let failure: Error | null = null;
        let killTimer: NodeJS.Timeout | null = null;

        function terminate(reason: string): void {
            if (failure) return;
            failure = new Error(reason);
            child.kill('SIGTERM');
            killTimer = setTimeout(() => child.kill('SIGKILL'), 2000);
            killTimer.unref();
        }

        const timer = setTimeout(
            () => terminate(`Provider command exceeded ${timeoutMs}ms deadline`),
            timeoutMs
        );
        timer.unref();

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
            if (failure) return;
            capturedBytes += Buffer.byteLength(chunk, 'utf8');
            if (capturedBytes > maxOutputBytes) {
                terminate('Provider command exceeded combined output byte limit');
                return;
            }
            stdout += chunk;
        });
        child.stderr.on('data', (chunk: string) => {
            if (failure) return;
            capturedBytes += Buffer.byteLength(chunk, 'utf8');
            if (capturedBytes > maxOutputBytes) {
                terminate('Provider command exceeded combined output byte limit');
                return;
            }
            stderr += chunk;
        });
        child.on('error', (error) => {
            failure = error;
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            if (killTimer) clearTimeout(killTimer);
            if (failure) {
                reject(failure);
            } else if (code === 0) {
                resolve(stdout);
            } else {
                reject(new Error(stderr.trim().slice(0, 4096) ||
                    `Command exited with code ${code}`));
            }
        });
    });
}

/**
 * Invoke a single agent with a message. Contains all Claude/Codex invocation logic.
 * Returns the raw response text.
 */
export async function invokeAgent(
    agent: AgentConfig,
    agentId: string,
    message: string,
    workspacePath: string,
    shouldReset: boolean,
    agents: Record<string, AgentConfig> = {},
    teams: Record<string, TeamConfig> = {}
): Promise<string> {
    // Ensure agent directory exists with config files
    const agentDir = path.join(workspacePath, agentId);
    const isNewAgent = !fs.existsSync(agentDir);
    ensureAgentDirectory(agentDir);
    if (isNewAgent) {
        log('INFO', `Initialized agent directory with config files: ${agentDir}`);
    }

    // Update AGENTS.md with current teammate info
    updateAgentTeammates(agentDir, agentId, agents, teams);

    // Resolve working directory
    const workingDir = agent.working_directory
        ? (path.isAbsolute(agent.working_directory)
            ? agent.working_directory
            : path.join(workspacePath, agent.working_directory))
        : agentDir;

    const provider = agent.provider || 'anthropic';

    if (provider === 'openai') {
        log('INFO', `Using Codex CLI (agent: ${agentId})`);

        const shouldResume = !shouldReset;

        if (shouldReset) {
            log('INFO', `🔄 Resetting Codex conversation for agent: ${agentId}`);
        }

        const modelId = resolveCodexModel(agent.model);
        const codexArgs = buildCodexArgs(modelId, message, shouldResume);

        const codexOutput = await runCommand('codex', codexArgs, workingDir);

        // Parse JSONL output and extract final agent_message
        let response = '';
        const lines = codexOutput.trim().split('\n');
        for (const line of lines) {
            try {
                const json = JSON.parse(line);
                if (json.type === 'item.completed' && json.item?.type === 'agent_message') {
                    response = json.item.text;
                }
            } catch (e) {
                // Ignore lines that aren't valid JSON
            }
        }

        return response || 'Sorry, I could not generate a response from Codex.';
    } else if (provider === 'opencode') {
        assertOpenCodeAuthorized();
        // OpenCode CLI — non-interactive mode via `opencode run`.
        // Outputs JSONL with --format json; extract "text" type events for the response.
        // Model passed via --model in provider/model format (e.g. opencode/claude-sonnet-4-5).
        // Supports -c flag for conversation continuation (resumes last session).
        const modelId = resolveOpenCodeModel(agent.model);
        log('INFO', `Using OpenCode CLI (agent: ${agentId}, model: ${modelId})`);

        const continueConversation = !shouldReset;

        if (shouldReset) {
            log('INFO', `🔄 Resetting OpenCode conversation for agent: ${agentId}`);
        }

        const opencodeArgs = ['run', '--format', 'json'];
        if (modelId) {
            opencodeArgs.push('--model', modelId);
        }
        if (continueConversation) {
            opencodeArgs.push('-c');
        }
        opencodeArgs.push(message);

        const opencodeOutput = await runCommand('opencode', opencodeArgs, workingDir);

        // Parse JSONL output and collect all text parts
        let response = '';
        const lines = opencodeOutput.trim().split('\n');
        for (const line of lines) {
            try {
                const json = JSON.parse(line);
                if (json.type === 'text' && json.part?.text) {
                    response = json.part.text;
                }
            } catch (e) {
                // Ignore lines that aren't valid JSON
            }
        }

        return response || 'Sorry, I could not generate a response from OpenCode.';
    } else {
        // Default to Claude (Anthropic)
        log('INFO', `Using Claude provider (agent: ${agentId})`);

        const continueConversation = !shouldReset;

        if (shouldReset) {
            log('INFO', `🔄 Resetting conversation for agent: ${agentId}`);
        }

        const modelId = resolveClaudeModel(agent.model);
        const claudeArgs = buildClaudeArgs(modelId, message, continueConversation);

        return await runCommand('claude', claudeArgs, workingDir);
    }
}
