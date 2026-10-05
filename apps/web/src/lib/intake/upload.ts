"use client";

/**
 * Putting a file into the workspace's private upload prefix, from the browser.
 *
 * Small objects use one signed PUT. Large FASTQ lanes use S3 multipart upload:
 * the upload id is held in localStorage by object key, completed parts are
 * listed from object storage before retrying, and only missing parts are sent again.
 */

import { RESUMABLE_THRESHOLD } from "./shape";

export interface UploadOptions {
  file: File;
  screenId: string;
  key: string;
  onProgress?: (sent: number, total: number) => void;
  signal?: AbortSignal;
}

export interface UploadResult {
  storageKey: string;
}

type MultipartPart = { PartNumber: number; ETag: string };
const SMALL_UPLOAD_TIMEOUT_MS = 2 * 60 * 1000;
const PART_UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;

async function api<T>(body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch("/api/intake/r2", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || readable(response.status, ""));
  }
  return payload as T;
}

function readable(status: number, body: string): string {
  if (status === 413) return "The upload service refused the file as too large.";
  if (status === 401 || status === 403) {
    return "Your session is not allowed to write here. Sign in again, or ask an administrator for access.";
  }
  if (status === 503) return "Private uploads are not configured for this environment.";
  const detail = body.trim().slice(0, 200);
  return detail ? `Upload failed: ${detail}` : `Upload failed with status ${status}.`;
}

async function putSmall(options: UploadOptions): Promise<UploadResult> {
  const { file, screenId, onProgress, signal } = options;
  const init = await api<{ url: string; storageKey: string }>({
    action: "put",
    screenId,
    name: file.name,
    bytes: file.size,
    contentType: file.type || "application/octet-stream",
  }, signal);

  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", init.url);
    request.timeout = SMALL_UPLOAD_TIMEOUT_MS;
    request.setRequestHeader("content-type", file.type || "application/octet-stream");

    const onAbort = () => request.abort();
    signal?.addEventListener("abort", onAbort);
    const timer = window.setTimeout(() => {
      request.abort();
      reject(new Error("The upload service did not respond. Try again."));
    }, SMALL_UPLOAD_TIMEOUT_MS);
    const done = (fn: () => void) => {
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      fn();
    };

    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded, event.total);
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress?.(file.size, file.size);
        done(resolve);
      } else {
        done(() => reject(new Error(readable(request.status, request.responseText))));
      }
    };
    request.onerror = () => done(() => reject(new Error("The connection dropped during the upload.")));
    request.ontimeout = () => done(() => reject(new Error("The upload service did not respond. Try again.")));
    request.onabort = () => done(() => reject(new DOMException("aborted", "AbortError")));
    request.send(file);
  });
  return { storageKey: init.storageKey };
}

function uploadPart(url: string, blob: Blob, signal?: AbortSignal): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.timeout = PART_UPLOAD_TIMEOUT_MS;
    const onAbort = () => request.abort();
    signal?.addEventListener("abort", onAbort);
    const timer = window.setTimeout(() => {
      request.abort();
      reject(new Error("The upload service did not respond for this part. Try again."));
    }, PART_UPLOAD_TIMEOUT_MS);
    const done = (fn: () => void) => {
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      fn();
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        const etag = request.getResponseHeader("etag");
        done(() => (etag ? resolve(etag) : reject(new Error("The upload service accepted a part but did not confirm it."))));
      } else {
        done(() => reject(new Error(readable(request.status, request.responseText))));
      }
    };
    request.onerror = () => done(() => reject(new Error("The connection dropped during the upload.")));
    request.ontimeout = () => done(() => reject(new Error("The upload service did not respond for this part. Try again.")));
    request.onabort = () => done(() => reject(new DOMException("aborted", "AbortError")));
    request.send(blob);
  });
}

// Storage can be unavailable in private browsing. Resumability is optional;
// inability to persist the upload ID must never prevent the upload itself.
function getResume(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function saveResume(key: string, id: string | null): void {
  try {
    if (id) window.localStorage.setItem(key, id);
    else window.localStorage.removeItem(key);
  } catch { /* Continue uploading without persistent resume state. */ }
}

async function putMultipart(options: UploadOptions): Promise<UploadResult> {
  const { file, screenId, onProgress, signal } = options;
  const started = await api<{
    key: string;
    storageKey: string;
    uploadId: string;
    partSize: number;
  }>({
    action: "multipart",
    screenId,
    name: file.name,
    bytes: file.size,
    contentType: file.type || "application/octet-stream",
  }, signal);

  const resumeKey = `splicr:r2:${started.key}:${file.size}:${file.lastModified}`;
  const storedUploadId = getResume(resumeKey);
  let uploadId = started.uploadId;
  let held: { parts: MultipartPart[] } = { parts: [] };
  if (storedUploadId) {
    // An expired/aborted upload ID must not poison every future retry.
    try {
      held = await api<{ parts: MultipartPart[] }>({ action: "list", key: started.key, uploadId: storedUploadId }, signal);
      uploadId = storedUploadId;
      void api({ action: "abort", key: started.key, uploadId: started.uploadId }, signal).catch(() => undefined);
    } catch (error) {
      if (signal?.aborted) throw error;
    }
  }
  saveResume(resumeKey, uploadId);
  const completed = new Map<number, string>(held.parts.map((part) => [part.PartNumber, part.ETag]));
  let sent = [...completed.keys()].reduce((sum, part) => {
    const start = (part - 1) * started.partSize;
    return sum + Math.max(0, Math.min(started.partSize, file.size - start));
  }, 0);
  onProgress?.(sent, file.size);

  const totalParts = Math.ceil(file.size / started.partSize);
  try {
    for (let partNumber = 1; partNumber <= totalParts; partNumber += 1) {
      if (completed.has(partNumber)) continue;
      const start = (partNumber - 1) * started.partSize;
      const blob = file.slice(start, Math.min(file.size, start + started.partSize));
      const { url } = await api<{ url: string }>({ action: "part", key: started.key, uploadId, partNumber }, signal);
      const etag = await uploadPart(url, blob, signal);
      completed.set(partNumber, etag);
      sent += blob.size;
      onProgress?.(sent, file.size);
    }

    await api({
      action: "complete",
      key: started.key,
      uploadId,
      parts: [...completed.entries()].map(([PartNumber, ETag]) => ({ PartNumber, ETag })),
    }, signal);
    saveResume(resumeKey, null);
    onProgress?.(file.size, file.size);
    return { storageKey: started.storageKey };
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError")) {
      // Keep the upload id for retry. The next attempt asks which parts landed.
      saveResume(resumeKey, uploadId);
    }
    throw error;
  }
}

export function uploadFile(options: UploadOptions): Promise<UploadResult> {
  return options.file.size > RESUMABLE_THRESHOLD ? putMultipart(options) : putSmall(options);
}
