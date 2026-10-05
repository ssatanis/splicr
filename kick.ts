import { kickPrivateScreenQueue } from "./apps/web/src/lib/ingest/modal.ts";
kickPrivateScreenQueue(1).then(console.log).catch(console.error);
