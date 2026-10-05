import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { getModalClient } from "./src/lib/ingest/modal.ts";
// Wait, I can't import TS easily in node without ts-node or similar.
