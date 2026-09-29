/**
 * How the Truth Loop view saves an outcome.
 *
 * The view does not know whether it is talking to the workspace or to the
 * demonstration. It is handed an adapter with three verbs, and each verb
 * resolves to a result rather than throwing. In a workspace the verbs are the
 * server actions. In the demonstration they edit a list held in the browser tab,
 * validated by the same schema, so the form behaves the same and the demo is a
 * faithful rehearsal of the real thing rather than a picture of it.
 */
import type { OutcomeRow } from "@/lib/outcomes/model";
import type { OutcomeDraft, OutcomeFormField } from "@/lib/outcomes/schema";

export type SaveResult =
  | { ok: true; outcome: OutcomeRow; note: string | null }
  | { ok: false; error: string; fieldErrors?: Partial<Record<OutcomeFormField, string>> };

export type RemoveResult = { ok: true } | { ok: false; error: string };

export interface OutcomeAdapter {
  /** True for the demonstration, so the form says nothing is saved. */
  demo: boolean;
  log: (draft: OutcomeDraft) => Promise<SaveResult>;
  update: (id: string, draft: OutcomeDraft) => Promise<SaveResult>;
  remove: (id: string) => Promise<RemoveResult>;
}
