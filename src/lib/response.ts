import fs from 'fs';
import path from 'path';
import { FILES_DIR } from './config';
import { log } from './logging';
import { collectOutgoingFiles } from './file-security';

export const LONG_RESPONSE_THRESHOLD = 4000;

/**
 * If a response exceeds the threshold, save full text as a .md file
 * and return a truncated preview with the file attached.
 */
export function handleLongResponse(
    response: string,
    existingFiles: string[]
): { message: string; files: string[] } {
    if (response.length <= LONG_RESPONSE_THRESHOLD) {
        return { message: response, files: existingFiles };
    }

    // Save full response as a .md file
    const filename = `response_${Date.now()}.md`;
    const filePath = path.join(FILES_DIR, filename);
    fs.writeFileSync(filePath, response);
    log('INFO', `Long response (${response.length} chars) saved to ${filename}`);

    // Truncate to preview
    const preview = response.substring(0, LONG_RESPONSE_THRESHOLD) + '\n\n_(Full response attached as file)_';

    return { message: preview, files: [...existingFiles, filePath] };
}

/**
 * Collect only regular files under the designated exchange directory.
 * Agent-emitted paths are untrusted; they must never be able to attach
 * unrelated host files or escape via symlinks.
 */
export function collectFiles(response: string, fileSet: Set<string>): void {
    collectOutgoingFiles(response, fileSet, FILES_DIR);
}
