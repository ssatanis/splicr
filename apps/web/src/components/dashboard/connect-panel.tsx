"use client";

/**
 * The Connect page body. Everything interactive lives here: the real key list,
 * the create dialog, revoke with a confirmation step, and the integration
 * snippets, which rebuild themselves from whichever screen is selected and from
 * a freshly minted key while it is still on screen.
 *
 * The page above this passes rows that came out of Postgres. Mutations go
 * through the Server Actions in lib/data/actions, which re-check the caller's
 * role server side, so the disabled states here are courtesy rather than
 * security.
 */

import {
  Ban,
  Check,
  CircleAlert,
  Copy,
  KeyRound,
  Loader2,
  Plus,
  ShieldCheck,
  TriangleAlert,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useTransition } from "react";

import {
  CONNECT_SCOPES,
  KEY_PLACEHOLDER,
  SCREEN_PLACEHOLDER,
  curlSnippet,
  type SnippetInputs,
} from "@/lib/connect/config";
import { createApiKey, revokeApiKey } from "@/lib/data/actions";
import {
  API_SCOPE_LABEL,
  DEFAULT_API_SCOPES,
  ROLE_LABEL,
  type ApiKey,
  type ApiScope,
  type OrgRole,
} from "@/lib/data/types";
import { cn, formatNumber } from "@/lib/utils";

import { Card, Empty, PageHeader } from "./ui";

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

type CopyState = "idle" | "copied" | "failed";

/**
 * Copy to the clipboard and say so for two seconds.
 *
 * `navigator.clipboard` is unavailable over plain http on some browsers and can
 * reject when the document is not focused, so a failure is reported rather than
 * swallowed: the text is on screen and selectable either way.
 */
function useCopy(): [CopyState, (value: string) => void] {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback((value: string) => {
    const settle = (next: CopyState) => {
      setState(next);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setState("idle"), 2200);
    };

    if (!navigator.clipboard?.writeText) {
      settle("failed");
      return;
    }

    navigator.clipboard.writeText(value).then(
      () => settle("copied"),
      () => settle("failed"),
    );
  }, []);

  return [state, copy];
}

function CopyButton({
  value,
  label = "Copy",
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [state, copy] = useCopy();

  return (
    <button
      type="button"
      onClick={() => copy(value)}
      aria-live="polite"
      className={cn("btn btn-ghost btn-sm shrink-0", className)}
    >
      {state === "copied" ? (
        <Check className="w-4 h-4 text-cyan-600" />
      ) : state === "failed" ? (
        <CircleAlert className="w-4 h-4 text-orange-500" />
      ) : (
        <Copy className="w-4 h-4" />
      )}
      {state === "copied" ? "Copied" : state === "failed" ? "Select and copy" : label}
    </button>
  );
}

/** A dark snippet with its own copy button. Scrolls sideways, never the page. */
function CodeBlock({ code, label }: { code: string; label: string }) {
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="label-sm">{label}</span>
        <CopyButton value={code} />
      </div>
      <pre className="rounded-2xl bg-teal-950 text-white/90 text-xs leading-relaxed p-4 overflow-x-auto thin-scroll">
        {code}
      </pre>
    </div>
  );
}

function ScopeChips({ scopes }: { scopes: string[] }) {
  if (scopes.length === 0) {
    return <span className="text-xs text-muted">no scopes</span>;
  }
  return (
    <span className="flex flex-wrap gap-1.5">
      {scopes.map((scope) => (
        <span
          key={scope}
          className="rounded-md bg-mist-soft px-1.5 py-0.5 font-mono text-[11px] text-ink"
        >
          {scope}
        </span>
      ))}
    </span>
  );
}

const STATUS_STYLE: Record<ApiKey["status"], string> = {
  active: "bg-cyan-50 text-cyan-700",
  expired: "bg-orange-50 text-orange-700",
  revoked: "bg-mist-soft text-muted",
};

function KeyStatus({ status }: { status: ApiKey["status"] }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs capitalize",
        STATUS_STYLE[status],
      )}
    >
      {status === "revoked" && <Ban className="w-3 h-3" />}
      {status}
    </span>
  );
}

/**
 * This component renders on the server and then hydrates, so the formatter is
 * pinned to UTC. Left to the runtime's own zone, a timestamp near midnight would
 * format as one day on the server and another in the browser, which React
 * reports as a hydration mismatch.
 */
const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function formatDay(iso: string | null): string {
  if (!iso) return "never";
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? "unknown" : DATE_FORMAT.format(parsed);
}

// ---------------------------------------------------------------------------
// Create dialog
// ---------------------------------------------------------------------------

/**
 * The dialog contents live in their own component that only exists while the
 * dialog is open, so closing and reopening starts from `useState` initialisers
 * rather than from an effect that resets four fields.
 */
function CreateKeyForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (key: string, name: string) => void;
}) {
  const titleId = useId();
  const nameId = useId();

  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ApiScope[]>([...DEFAULT_API_SCOPES]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // A stable ref callback, so it runs on mount and not on every keystroke.
  const focusOnMount = useCallback((node: HTMLInputElement | null) => {
    node?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggle = (scope: ApiScope) => {
    setScopes((current) =>
      current.includes(scope) ? current.filter((value) => value !== scope) : [...current, scope],
    );
  };

  const submit = () => {
    if (pending) return;
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError("Give the key a name, so you can tell it apart later.");
      return;
    }
    if (scopes.length === 0) {
      setError("Pick at least one scope. A key with no scopes can read nothing.");
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = await createApiKey(trimmed, scopes);
      if (result.ok) {
        onCreated(result.key, result.apiKey.name);
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-teal-950/45 cursor-default"
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        initial={{ opacity: 0, y: 18, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.99 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full sm:max-w-lg max-h-[90vh] overflow-y-auto thin-scroll bg-white rounded-t-3xl sm:rounded-3xl border border-line p-5 md:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="text-ink text-lg font-medium">
              New API key
            </h2>
            <p className="text-sm text-muted mt-0.5">
              The key is shown once, then only its hash is kept.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="icon-btn w-9 h-9 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-5">
          <label htmlFor={nameId} className="label-sm">
            Name
          </label>
          <input
            id={nameId}
            ref={focusOnMount}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
            maxLength={80}
            placeholder="Lab notebook sync"
            className="underline-input"
          />
        </div>

        <fieldset className="mt-5">
          <legend className="label-sm mb-2">Scopes</legend>
          <div className="space-y-1">
            {CONNECT_SCOPES.map((scope) => {
              const checked = scopes.includes(scope);
              return (
                <label
                  key={scope}
                  className={cn(
                    "flex items-start gap-3 rounded-2xl border px-3 py-2.5 cursor-pointer transition-colors",
                    checked ? "border-cyan-500 bg-cyan-50/50" : "border-line hover:bg-mist-soft",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(scope)}
                    className="mt-1 w-4 h-4 accent-cyan-500 shrink-0"
                  />
                  <span className="min-w-0">
                    <span className="block font-mono text-xs text-ink">{scope}</span>
                    <span className="block text-xs text-muted">{API_SCOPE_LABEL[scope]}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {error && (
          <p className="mt-4 flex items-start gap-2 text-sm text-orange-700">
            <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </p>
        )}

        <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="btn btn-orange btn-sm disabled:opacity-60"
          >
            {pending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <KeyRound className="w-4 h-4" />
            )}
            {pending ? "Creating" : "Create key"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/** Mounts the form only while open, and animates it in and out. */
function CreateKeyDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (key: string, name: string) => void;
}) {
  return (
    <AnimatePresence>
      {open && <CreateKeyForm onClose={onClose} onCreated={onCreated} />}
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------
// Key row
// ---------------------------------------------------------------------------

function KeyRow({ apiKey, canManage }: { apiKey: ApiKey; canManage: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const revoke = () => {
    setError(null);
    startTransition(async () => {
      const result = await revokeApiKey(apiKey.id);
      if (result.ok) {
        setConfirming(false);
      } else {
        setError(result.error);
        setConfirming(false);
      }
    });
  };

  const revoked = apiKey.status === "revoked";

  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <span
            className={cn(
              "w-9 h-9 rounded-full flex items-center justify-center shrink-0",
              revoked ? "bg-mist-soft text-muted" : "bg-cyan-50 text-cyan-700",
            )}
          >
            <KeyRound className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn("font-medium break-words", revoked ? "text-muted" : "text-ink")}
              >
                {apiKey.name}
              </span>
              <KeyStatus status={apiKey.status} />
            </div>
            <div className="mt-1 font-mono text-xs text-muted break-all">
              {apiKey.key_prefix}
              <span aria-hidden="true">{"…"}</span>
              <span className="sr-only"> followed by the hidden part of the key</span>
            </div>
            <div className="mt-2">
              <ScopeChips scopes={apiKey.scopes} />
            </div>
          </div>
        </div>

        <div className="sm:text-right shrink-0 space-y-1.5">
          <div className="text-xs text-muted">
            created {formatDay(apiKey.created_at)}
            <span aria-hidden="true"> · </span>
            used {formatDay(apiKey.last_used_at)}
          </div>
          {revoked ? (
            <div className="text-xs text-muted">revoked {formatDay(apiKey.revoked_at)}</div>
          ) : apiKey.status === "expired" ? (
            <div className="text-xs text-orange-700">expired {formatDay(apiKey.expires_at)}</div>
          ) : canManage ? (
            confirming ? (
              <div className="flex flex-wrap sm:justify-end items-center gap-2">
                <span className="text-xs text-ink">Revoke it?</span>
                <button
                  type="button"
                  onClick={revoke}
                  disabled={pending}
                  className="btn btn-orange btn-sm disabled:opacity-60"
                >
                  {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  Yes, revoke
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={pending}
                  className="btn btn-ghost btn-sm"
                >
                  Keep
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="btn btn-ghost btn-sm"
              >
                <Ban className="w-3.5 h-3.5" />
                Revoke
              </button>
            )
          ) : null}
        </div>
      </div>

      {confirming && !pending && (
        <p className="mt-2 text-xs text-muted sm:text-right">
          Anything using this key starts getting 401 on its next request. The row stays, so the
          audit trail survives.
        </p>
      )}
      {error && (
        <p className="mt-2 flex items-start gap-2 text-sm text-orange-700">
          <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export interface ConnectScreenOption {
  id: string;
  name: string;
  n_hits: number;
}

export interface ConnectPanelProps {
  keys: ApiKey[];
  screens: ConnectScreenOption[];
  origin: string;
  orgName: string;
  role: OrgRole | null;
  /** Owners and admins only, and never in demo mode. */
  canManage: boolean;
  /** True when the visitor has no session and is browsing the demo. */
  isDemo: boolean;
  /**
   * True when `keys` are the demo stand-ins rather than rows from the database.
   * The card says so, because a reader must never mistake a fixture for a
   * credential that exists.
   */
  keysAreDemo: boolean;
}

export function ConnectPanel({
  keys,
  screens,
  origin,
  orgName,
  role,
  canManage,
  isDemo,
  keysAreDemo,
}: ConnectPanelProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [minted, setMinted] = useState<{ key: string; name: string } | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  // Derived rather than stored, so a screen that disappears from the list (the
  // page revalidates after every write) cannot leave a dead id in the snippet.
  const screenId =
    picked !== null && screens.some((screen) => screen.id === picked)
      ? picked
      : (screens[0]?.id ?? "");

  const snippetInputs: SnippetInputs = useMemo(
    () => ({
      origin,
      screenId: screenId || SCREEN_PLACEHOLDER,
      apiKey: minted?.key ?? KEY_PLACEHOLDER,
    }),
    [origin, screenId, minted],
  );

  const curl = useMemo(() => curlSnippet(snippetInputs), [snippetInputs]);

  const liveKeys = keys.filter((key) => key.status === "active").length;

  const createButton = (
    <button
      type="button"
      onClick={() => setDialogOpen(true)}
      disabled={!canManage}
      className="btn btn-orange btn-sm disabled:opacity-50 disabled:cursor-not-allowed"
      title={canManage ? undefined : "Owners and admins can create keys"}
    >
      <Plus className="w-4 h-4" /> New API key
    </button>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Connect"
        title="Read your results from anywhere"
        body="A scoped key and a REST endpoint, so a script, a notebook or a pipeline can pull this workspace's hits directly instead of waiting on an exported CSV."
        actions={createButton}
      />

      {isDemo && (
        <div className="rounded-3xl border border-line bg-white p-4 md:p-5 flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-cyan-600 shrink-0 mt-0.5" />
          <div className="text-sm">
            <div className="text-ink font-medium">You are browsing the SplicR demo</div>
            <p className="text-muted mt-1">
              The demo has no workspace of its own, so there are no keys to list and nothing can be
              created here. The snippets below are real and point at this instance. Sign in to mint
              a key against your own screens.
            </p>
          </div>
        </div>
      )}

      {!isDemo && !canManage && (
        <div className="rounded-3xl border border-line bg-white p-4 md:p-5 flex items-start gap-3">
          <TriangleAlert className="w-5 h-5 text-orange-500 shrink-0 mt-0.5" />
          <div className="text-sm">
            <div className="text-ink font-medium">Keys are an owner and admin matter</div>
            <p className="text-muted mt-1">
              Your role in {orgName} is {role ? ROLE_LABEL[role].toLowerCase() : "unassigned"}, so
              this list is empty for you even if the workspace has keys. Ask an owner or an admin
              to mint one, then paste it into the snippets below.
            </p>
          </div>
        </div>
      )}

      {minted && (
        <div className="rounded-3xl border border-orange-300 bg-orange-50/60 p-4 md:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <TriangleAlert className="w-5 h-5 text-orange-600 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="text-ink font-medium">
                  Copy {minted.name} now. This is the only time it is shown.
                </div>
                <p className="text-sm text-body mt-1">
                  SplicR keeps only a sha-256 hash of this key, so nobody, including us, can read
                  it back or send it to you again. Lose it and the fix is to revoke it and mint
                  another.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setMinted(null)}
              aria-label="Hide the key"
              className="icon-btn w-9 h-9 shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-2">
            <code className="flex-1 min-w-0 rounded-2xl bg-teal-950 text-white px-4 py-3 font-mono text-xs break-all">
              {minted.key}
            </code>
            <CopyButton value={minted.key} label="Copy key" className="bg-white" />
          </div>
          <p className="mt-3 text-xs text-muted">
            The snippets below already use it. They fall back to a placeholder once you dismiss
            this box.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <Card
          title="API keys"
          subtitle={
            keysAreDemo
              ? "Demo data. These are not real keys and none of them can authenticate anything."
              : keys.length > 0
                ? `${formatNumber(liveKeys)} live of ${formatNumber(keys.length)} in ${orgName}`
                : `Scoped to ${orgName}. Revoke any time.`
          }
          className="min-w-0 lg:col-span-2"
        >
          {keys.length === 0 ? (
            <Empty
              title={isDemo ? "No keys in the demo workspace" : "No API keys yet"}
              body="A key lets a script read this workspace over HTTP: the hits from a finished screen, their artifact flags, the QC verdict. Each key carries scopes, so a reader cannot write, and revoking one takes effect on its next request."
              action={canManage ? createButton : undefined}
            />
          ) : (
            <ul className="divide-y divide-line">
              {keys.map((apiKey) => (
                <KeyRow key={apiKey.id} apiKey={apiKey} canManage={canManage} />
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="REST"
          subtitle="Returns recorded hits for one screen when Connect and the database are configured."
          className="min-w-0 lg:col-span-2"
        >
          {screens.length > 1 && (
            <label className="block">
              <span className="label-sm">Screen in the example</span>
              <select
                value={screenId}
                onChange={(event) => setPicked(event.target.value)}
                className="underline-input appearance-none cursor-pointer"
              >
                {screens.map((screen) => (
                  <option key={screen.id} value={screen.id}>
                    {screen.name} ({formatNumber(screen.n_hits)} hits)
                  </option>
                ))}
              </select>
            </label>
          )}
          {screens.length === 1 && (
            <p className="text-sm text-muted">
              Pointed at {screens[0].name}, {formatNumber(screens[0].n_hits)} hits.
            </p>
          )}
          {screens.length === 0 && (
            <p className="text-sm text-muted">
              {isDemo
                ? "The demo workspace holds no screens of its own, so the example carries a placeholder id. Sign in and your own screen id appears here."
                : "This workspace has no screens yet, so the example uses a placeholder id. Run a screen and the real id appears here."}
            </p>
          )}

          <CodeBlock label="curl" code={curl} />
          <p className="mt-3 text-xs text-muted">
            <code className="font-mono">chance_real</code> and{" "}
            <code className="font-mono">chance_interval</code> are legacy names for stored,
            uncalibrated model outputs. They are not validation probabilities or validated
            confidence intervals; <code className="font-mono">validation_probability</code> is null.
            <code className="font-mono"> min_chance</code> filters the stored score.
            Small FDR and p-values retain their recorded numeric precision, including exponent notation.
            Missing values remain null; this endpoint cannot recover precision lost upstream.
          </p>

          <div className="mt-4 grid sm:grid-cols-2 gap-x-6 gap-y-2 text-xs">
            <div>
              <div className="label-sm">Filters</div>
              <p className="text-muted mt-1">
                <code className="font-mono">max_fdr</code>,{" "}
                <code className="font-mono">min_chance</code>,{" "}
                <code className="font-mono">direction</code>,{" "}
                <code className="font-mono">verdict</code>,{" "}
                <code className="font-mono">limit</code> up to 500, and{" "}
                <code className="font-mono">offset</code>.
              </p>
            </div>
            <div>
              <div className="label-sm">Answers</div>
              <p className="text-muted mt-1">
                401 with no key or a revoked one, 403 when the key lacks{" "}
                <code className="font-mono">hits:read</code>, 404 for a screen another workspace
                owns.
              </p>
            </div>
          </div>
        </Card>

      </div>

      <CreateKeyDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={(key, name) => {
          setDialogOpen(false);
          setMinted({ key, name });
        }}
      />
    </div>
  );
}
