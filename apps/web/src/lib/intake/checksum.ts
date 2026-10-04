"use client";

/**
 * The SHA-256 of a file the researcher is about to upload, computed in a worker
 * so the page stays usable while it runs.
 *
 * It runs alongside the upload rather than before it. Reading the file twice is
 * nearly free (the second pass comes out of the page cache), and making the
 * researcher watch a progress bar finish before the upload even starts would
 * double the wall clock for no gain.
 */
import type { HashRequest, HashResponse } from "./sha256.worker";

export function hashFile(
  file: File,
  onProgress?: (bytes: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }

    const worker = new Worker(new URL("./sha256.worker.ts", import.meta.url), { type: "module" });
    const id = crypto.randomUUID();

    const finish = (fn: () => void) => {
      worker.terminate();
      signal?.removeEventListener("abort", onAbort);
      fn();
    };
    function onAbort() {
      finish(() => reject(new DOMException("aborted", "AbortError")));
    }
    signal?.addEventListener("abort", onAbort);

    worker.onmessage = (event: MessageEvent<HashResponse>) => {
      const message = event.data;
      if (message.id !== id) return;
      if (message.kind === "progress") onProgress?.(message.bytes);
      else if (message.kind === "done") finish(() => resolve(message.hex));
      else finish(() => reject(new Error(message.message)));
    };
    worker.onerror = (event) => {
      finish(() => reject(new Error(event.message || "checksum worker failed")));
    };

    worker.postMessage({ id, file } satisfies HashRequest);
  });
}
