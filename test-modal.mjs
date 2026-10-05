import { ModalClient } from "modal";
import dotenv from "dotenv";
dotenv.config({ path: "./apps/web/.env.local" });

const tokenId = process.env.MODAL_API_KEY;
console.log("Token ID:", tokenId);
const client = new ModalClient({ tokenId, tokenSecret: undefined });
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
