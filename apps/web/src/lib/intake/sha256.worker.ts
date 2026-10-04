/// <reference lib="webworker" />
/**
 * Checksums a File without blocking the page.
 *
 * The worker reads the file's own stream, so the bytes never cross back to the
 * main thread: a 40 GB FASTQ costs one 64 KB chunk of memory here and nothing
 * at all there. Progress is reported every 16 MB rather than every chunk,
 * because a message per 64 KB is 640,000 messages for that file and the posting
 * costs more than the hashing.
 */
import { Sha256 } from "./sha256-core";

export interface HashRequest {
  id: string;
  file: File;
}

export type HashResponse =
  | { id: string; kind: "progress"; bytes: number }
  | { id: string; kind: "done"; hex: string }
  | { id: string; kind: "error"; message: string };

const REPORT_EVERY = 16 * 1024 * 1024;

const post = (message: HashResponse) => (self as unknown as Worker).postMessage(message);

self.onmessage = async (event: MessageEvent<HashRequest>) => {
  const { id, file } = event.data;
  try {
    const hasher = new Sha256();
    const reader = file.stream().getReader();
    let read = 0;
    let reported = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hasher.update(value);
      read += value.length;
      if (read - reported >= REPORT_EVERY) {
        reported = read;
        post({ id, kind: "progress", bytes: read });
      }
    }
    post({ id, kind: "done", hex: hasher.hex() });
  } catch (error) {
    post({ id, kind: "error", message: error instanceof Error ? error.message : "checksum failed" });
  }
};
