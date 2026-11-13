import fs from 'fs';
import path from 'path';

/**
 * Resolve an outgoing attachment to an existing regular file confined to the
 * TinyClaw exchange directory. Resolve both sides through realpath so that
 * symlinks (including symlinked parent directories) cannot escape it.
 *
 * This is a filesystem containment check, not a substitute for trusting the
 * contents of files placed in the exchange directory.
 */
export function resolveOutgoingFile(candidate: string, filesDirectory: string): string | null {
    // Agents must use absolute [send_file: ...] paths; relative paths are ambiguous.
    if (!path.isAbsolute(candidate)) return null;

    try {
        const root = fs.realpathSync(filesDirectory);
        const target = fs.realpathSync(candidate);
        const relative = path.relative(root, target);

        if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
            return null;
        }
        if (!fs.statSync(target).isFile()) return null;
        return target;
    } catch {
        // Nonexistent paths, missing exchange directory, or inaccessible files
        // must fail closed without throwing from a messaging pipeline.
        return null;
    }
}

/** Collect only allowed attachment paths from agent-emitted [send_file: ...] tags. */
export function collectOutgoingFiles(response: string, fileSet: Set<string>, filesDirectory: string): void {
    const fileRegex = /\[send_file:\s*([^\]]+)\]/g;
    let match: RegExpExecArray | null;
    while ((match = fileRegex.exec(response)) !== null) {
        const resolved = resolveOutgoingFile(match[1].trim(), filesDirectory);
        if (resolved) fileSet.add(resolved);
    }
}
