import { ModalClient } from "modal";

const client = new ModalClient();
try {
  const worker = await client.functions.fromName("splicr-ingest", "process_private_screen");
  console.log("Got worker");
  await worker.spawn();
  console.log("Spawned");
} catch (e) {
  console.error("Error:", e);
} finally {
  client.close();
}
