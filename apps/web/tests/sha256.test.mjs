/**
 * The browser's SHA-256 against Node's, which is OpenSSL's.
 *
 * Checks the published FIPS 180-4 vectors, the empty message, a message that
 * lands exactly on a block boundary, one that lands exactly on the padding
 * boundary, and random input fed in awkwardly sized chunks, because the chunk
 * boundaries are where an incremental digest goes wrong.
 */
import { createHash, randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";

const { Sha256, sha256Hex } = await import("../src/lib/intake/sha256-core.ts");

const node = (buf) => createHash("sha256").update(buf).digest("hex");

test("published vectors", () => {
  assert.equal(
    sha256Hex(Buffer.from("abc")),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assert.equal(
    sha256Hex(Buffer.from("")),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
  assert.equal(
    sha256Hex(Buffer.from("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")),
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
  );
});

test("lengths around the block and padding boundaries", () => {
  for (const n of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 1000, 1 << 16]) {
    const buf = randomBytes(n);
    assert.equal(sha256Hex(buf), node(buf), `length ${n}`);
  }
});

test("chunked the same as whole", () => {
  const buf = randomBytes(300_000);
  for (const size of [1, 7, 63, 64, 65, 1023, 4096, 65_536]) {
    const h = new Sha256();
    for (let i = 0; i < buf.length; i += size) h.update(buf.subarray(i, i + size));
    assert.equal(h.hex(), node(buf), `chunk ${size}`);
  }
});
