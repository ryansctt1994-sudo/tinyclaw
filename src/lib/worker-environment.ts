/**
 * Minimal inherited environment for provider subprocesses.
 *
 * Security property: an ambient secret present in the TinyClaw parent process
 * is NOT copied into the child unless it is explicitly listed below.
 *
 * This is environment construction, not kernel-level sandboxing. The child
 * can still read host files accessible to its OS identity and may access
 * credentials through other channels. PATH entries are not authenticated.
 * Authenticating providers must use an independently reviewed, scoped
 * credential delivery mechanism rather than expanding this allowlist.
 */
const INHERITED_WORKER_KEYS = [
    'PATH',
    'LANG',
    'LC_ALL',
    'TMPDIR',
    'TMP',
    'TEMP',
    // Windows process startup / executable resolution keys.
    'SystemRoot',
    'WINDIR',
    'PATHEXT',
] as const;

/**
 * The returned object is constructed from scratch. No spread of process.env,
 * HOME, USERPROFILE, XDG_CONFIG_HOME, NODE_OPTIONS, or cloud/API credentials.
 */
export function buildWorkerEnvironment(
    parent: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
    const child: NodeJS.ProcessEnv = {};
    for (const key of INHERITED_WORKER_KEYS) {
        const value = parent[key];
        if (typeof value === 'string' && value.length > 0) {
            child[key] = value;
        }
    }
    return child;
}
