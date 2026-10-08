import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAllowedWorkingDirectory } from "./security.js";

export const MAX_SESSION_FILE_BYTES = 20 * 1024 * 1024;

export type SessionFile = {
  bytes: Buffer;
  name: string;
  contentType: string;
};

export class SessionFileError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export async function readSessionFile(
  cwd: string,
  reference: string,
  allowedRoots: string[],
  maxBytes = MAX_SESSION_FILE_BYTES,
): Promise<SessionFile> {
  let realCwd: string;
  try {
    realCwd = resolveAllowedWorkingDirectory(cwd, allowedRoots);
  } catch {
    throw new SessionFileError(403, "Session files are not available for this working directory");
  }

  const candidate = resolveFileReference(realCwd, reference);
  let realFile: string;
  try {
    realFile = await realpath(candidate);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) throw new SessionFileError(404, "File not found");
    throw new SessionFileError(403, "File cannot be accessed");
  }

  const fromCwd = relative(realCwd, realFile);
  if (fromCwd.startsWith("..") || isAbsolute(fromCwd)) {
    throw new SessionFileError(403, "File is outside the session working directory");
  }

  let handle;
  try {
    handle = await open(realFile, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new SessionFileError(400, "Only regular files can be read");
    if (metadata.size > maxBytes) throw new SessionFileError(413, "File is too large to preview");
    return {
      bytes: await handle.readFile(),
      name: basename(realFile),
      contentType: contentTypeForFile(realFile),
    };
  } catch (error) {
    if (error instanceof SessionFileError) throw error;
    if (hasErrorCode(error, "ENOENT")) throw new SessionFileError(404, "File not found");
    throw new SessionFileError(403, "File cannot be accessed");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function resolveFileReference(cwd: string, rawReference: string): string {
  const reference = rawReference.trim();
  if (!reference || reference.length > 4_096 || reference.includes("\0")) {
    throw new SessionFileError(400, "File path is invalid");
  }

  if (reference.startsWith("file:")) {
    try {
      const fileUrl = new URL(reference);
      fileUrl.search = "";
      fileUrl.hash = "";
      return fileURLToPath(fileUrl);
    } catch {
      throw new SessionFileError(400, "File URL is invalid");
    }
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(reference)) {
    // Allow single-letter prefixes (Windows drive letters like C:)
    if (/^[a-z]:[\\\/]/i.test(reference)) {
      // This is a Windows absolute path, not a URL
    } else {
      throw new SessionFileError(400, "Only local file paths are supported");
    }
  }

  const pathWithoutSuffix = reference.split(/[?#]/, 1)[0] ?? reference;
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathWithoutSuffix);
  } catch {
    throw new SessionFileError(400, "File path is invalid");
  }
  return isAbsolute(decodedPath) ? resolve(decodedPath) : resolve(cwd, decodedPath);
}

function contentTypeForFile(path: string): string {
  const extension = extname(path).toLowerCase();
  return MIME_TYPES[extension] ?? "application/octet-stream";
}

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

const MIME_TYPES: Record<string, string> = {
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".csv": "text/csv; charset=utf-8",
  ".gif": "image/gif",
  ".htm": "text/html; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".xml": "application/xml; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
  ".yml": "text/yaml; charset=utf-8",
};
