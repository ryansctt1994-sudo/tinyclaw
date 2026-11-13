/**
 * CLI policy for unattended agents. Non-interactive agents must not inherit
 * permission-bypass flags from the host user's global CLI configuration.
 *
 * These bounds reduce the executable surface; they are not a substitute for
 * operating-system/container isolation or a reviewed network/credential policy.
 */
export function buildCodexArgs(modelId: string, message: string, resume: boolean): string[] {
    const args = ['exec'];
    if (resume) args.push('resume', '--last');
    if (modelId) args.push('--model', modelId);
    args.push('--skip-git-repo-check', '--sandbox', 'read-only',
        '--ask-for-approval', 'never', '--json', message);
    return args;
}

export function buildClaudeArgs(modelId: string, message: string, resume: boolean): string[] {
    // Plan mode + no built-in tools or MCP tools prevents unattended tool effects.
    const args = ['--permission-mode', 'plan', '--tools', '',
        '--disallowedTools', 'mcp__*'];
    if (modelId) args.push('--model', modelId);
    if (resume) args.push('-c');
    args.push('-p', message);
    return args;
}

/** OpenCode's CLI execution isolation is unverified in this repository. */
export function assertOpenCodeAuthorized(env: NodeJS.ProcessEnv = process.env): void {
    if (env.TINYCLAW_ALLOW_UNSANDBOXED_OPENCODE !== '1') {
        throw new Error(
            'OpenCode disabled by default: no verified sandbox boundary. ' +
            'Explicitly set TINYCLAW_ALLOW_UNSANDBOXED_OPENCODE=1 only inside a separately isolated test container.'
        );
    }
}
