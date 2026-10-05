import { ModalClient } from "modal";

const client = new ModalClient({ tokenId: "ak-fake123", tokenSecret: undefined });
try {
  const worker = await client.functions.fromName("splicr-ingest", "process_private_screen");
  console.log("Got worker");
  await worker.spawn();
  console.log("Spawned");
} catch (e) {
  console.error("Error:", e.message);
} finally {
  client.close();
}
