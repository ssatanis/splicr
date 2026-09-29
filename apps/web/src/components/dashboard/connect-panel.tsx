"use client";

/**
 * The Connect page body: the workspace's API keys, and how to use one.
 *
 * Everything interactive lives here: the key list, the create drawer, revoke with
 * a confirmation step, and the snippets, which rebuild themselves from the chosen
 * language, the chosen screen and a freshly minted key while it is still on
 * screen.
 *
 * The page above passes rows that came out of Postgres. Mutations go through the
 * Server Actions in lib/data/actions, which re-check the caller's role on the
 * server, so the disabled states here are courtesy and not security.
 *
 * What the page does not do is claim more than the endpoint does. Only one scope
 * is checked by any endpoint today, so the others are labelled as reserved, and
 * there is no remote MCP server, which the page says.
 */

import { Ban, Check, CircleAlert, Copy, KeyRound, Loader2, Plus, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useTransition } from "react";

import {
  CONNECT_SCOPES,
  HITS_FIELDS,
  HITS_PARAMS,
  HITS_STATUS,
  KEY_PLACEHOLDER,
  LIVE_SCOPES,
  SCREEN_PLACEHOLDER,
  SNIPPET_LANGUAGES,
  scopeIsLive,
  snippetFor,
  type SnippetInputs,
  type SnippetLanguage,
} from "@/lib/connect/config";
import { createApiKey, revokeApiKey } from "@/lib/data/actions";
import { API_SCOPE_LABEL, ROLE_LABEL, type ApiKey, type ApiScope, type OrgRole } from "@/lib/data/types";
import { cn, formatNumber } from "@/lib/utils";

import { ModalDrawer } from "./drawer";
import { DenseTable, Empty, FootNote, PageHeader, Panel, Segmented, StatusChip, Th } from "./ui";

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

type CopyState = "idle" | "copied" | "failed";

/**
 * Copy to the clipboard and say so for a couple of seconds.
 *
 * `navigator.clipboard` is missing over plain http in some browsers and can
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
      timer.current = setTimeout(() => setState("idle"), 2400);
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

function CopyButton({ value, label = "Copy", subject }: { value: string; label?: string; subject: string }) {
  const [state, copy] = useCopy();
  return (
    <>
      <button
        type="button"
        onClick={() => copy(value)}
        className="btn btn-ghost h-7 shrink-0 rounded-md px-2.5 py-0 text-[11px]"
      >
        {state === "copied" ? (
          <Check className="h-3.5 w-3.5 text-cyan-600" aria-hidden="true" />
        ) : state === "failed" ? (
          <CircleAlert className="h-3.5 w-3.5 text-orange-500" aria-hidden="true" />
        ) : (
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        {state === "copied" ? "Copied" : state === "failed" ? "Select and copy" : label}
        <span className="sr-only"> {subject}</span>
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {state === "copied" ? `${subject} copied to the clipboard.` : state === "failed" ? `${subject} could not be copied. Select it and copy by hand.` : ""}
      </span>
    </>
  );
}

function ScopeChips({ scopes }: { scopes: string[] }) {
  if (scopes.length === 0) return <span className="text-[11px] text-muted">no scopes</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {scopes.map((scope) => (
        <span
          key={scope}
          className={cn(
            "rounded px-1.5 py-0.5 font-mono text-[10.5px]",
            scope === "hits:read" ? "bg-cyan-50 text-cyan-700" : "bg-mist-soft text-body",
          )}
          title={scope === "hits:read" ? "Read hits: the one scope an endpoint checks today" : "Reserved: no endpoint checks this scope yet"}
        >
          {scope}
        </span>
      ))}
    </span>
  );
}

/**
 * The formatter is pinned to UTC. The component renders on the server and then
 * hydrates, so left to the runtime's own zone a timestamp near midnight would
 * format as one day in one place and another in the other, which React reports
 * as a hydration mismatch.
 */
const DATE_FORMAT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function formatDay(iso: string | null): string {
  if (!iso) return "Never";
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? "Unknown" : DATE_FORMAT.format(parsed);
}

const KEY_TONE = { active: "ok", expired: "run", revoked: "idle" } as const;

// ---------------------------------------------------------------------------
// Create drawer
// ---------------------------------------------------------------------------

function CreateKeyDrawer({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (key: string, name: string) => void;
}) {
  const nameId = useId();
  const [name, setName] = useState("");
  // Only the live scope is on by default: a key is a credential, and the
  // narrowest one that does the job is the right starting point.
  const [scopes, setScopes] = useState<ApiScope[]>([...LIVE_SCOPES]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = (scope: ApiScope) =>
    setScopes((current) => (current.includes(scope) ? current.filter((value) => value !== scope) : [...current, scope]));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
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
      if (result.ok) onCreated(result.key, result.apiKey.name);
      else setError(result.error);
    });
  };

  const noLive = scopes.length > 0 && !scopes.some(scopeIsLive);

  return (
    <ModalDrawer title="New API key" eyebrow="Connect" onClose={onClose} closeLabel="Close the new key form">
      <form onSubmit={submit} noValidate className="mt-5 space-y-5">
        <p className="text-[12.5px] leading-snug text-body">
          The key is shown once. SplicR keeps only its hash, so nobody can read it back, and the fix for a lost key is to
          revoke it and make another.
        </p>

        <div>
          <label htmlFor={nameId} className="mb-1 block text-[12px] text-ink">
            Name
          </label>
          <input
            id={nameId}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
            maxLength={80}
            placeholder="Lab notebook sync"
            autoComplete="off"
            aria-invalid={error && name.trim() === "" ? true : undefined}
            className="h-8 w-full rounded-md border border-line bg-white px-2 text-[13px] text-ink outline-none focus:border-cyan-500"
          />
        </div>

        <fieldset>
          <legend className="mb-1.5 text-[12px] text-ink">Scopes</legend>
          <div className="space-y-1.5">
            {CONNECT_SCOPES.map((scope) => {
              const checked = scopes.includes(scope);
              const live = scopeIsLive(scope);
              return (
                <label
                  key={scope}
                  className={cn(
                    "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors duration-[var(--dur-1)]",
                    checked ? "border-cyan-500 bg-cyan-50/60" : "border-line hover:bg-mist-soft",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      toggle(scope);
                      setError(null);
                    }}
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-cyan-600"
                  />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[12px] text-ink">{scope}</span>
                      <StatusChip tone={live ? "ok" : "idle"}>{live ? "Live" : "Reserved"}</StatusChip>
                    </span>
                    <span className="block text-[11.5px] leading-snug text-muted">
                      {API_SCOPE_LABEL[scope]}.{" "}
                      {live ? "Gates GET /api/v1/hits." : "No endpoint checks this scope yet, so it grants nothing today."}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          {noLive && (
            <p className="mt-2 rounded-md bg-orange-50 px-2.5 py-1.5 text-[11.5px] leading-snug text-orange-700">
              None of the chosen scopes is live, so this key cannot read anything yet. Add hits:read to read hits.
            </p>
          )}
        </fieldset>

        {error && (
          <p role="alert" className="flex items-start gap-2 text-[12.5px] text-orange-700">
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <button type="submit" disabled={pending} className="btn btn-orange rounded-lg px-4 py-2 text-[13px] disabled:opacity-60">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <KeyRound className="h-4 w-4" aria-hidden="true" />}
            {pending ? "Creating" : "Create key"}
          </button>
          <button type="button" onClick={onClose} disabled={pending} className="btn btn-ghost rounded-lg px-3 py-2 text-[13px]">
            Cancel
          </button>
        </div>
      </form>
    </ModalDrawer>
  );
}

// ---------------------------------------------------------------------------
// Key rows
// ---------------------------------------------------------------------------

function KeyRow({ apiKey, canManage }: { apiKey: ApiKey; canManage: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const revoked = apiKey.status === "revoked";

  const revoke = () => {
    setError(null);
    startTransition(async () => {
      const result = await revokeApiKey(apiKey.id);
      if (!result.ok) setError(result.error);
      setConfirming(false);
    });
  };

  return (
    <>
      <tr>
        <td>
          <span className={cn("block max-w-[220px] truncate font-medium", revoked ? "text-muted" : "text-ink")} title={apiKey.name}>
            {apiKey.name}
          </span>
          <span className="block font-mono text-[11px] text-muted">
            {apiKey.key_prefix}
            <span aria-hidden="true">{"…"}</span>
            <span className="sr-only"> followed by the hidden part of the key</span>
          </span>
        </td>
        <td>
          <ScopeChips scopes={apiKey.scopes} />
        </td>
        <td>
          <StatusChip tone={KEY_TONE[apiKey.status]}>
            {revoked && <Ban className="h-2.5 w-2.5" aria-hidden="true" />}
            {apiKey.status}
          </StatusChip>
        </td>
        <td className="text-muted">{formatDay(apiKey.created_at)}</td>
        <td className="text-muted">{formatDay(apiKey.last_used_at)}</td>
        <td className="text-right">
          {revoked ? (
            <span className="text-[11px] text-muted">Revoked {formatDay(apiKey.revoked_at)}</span>
          ) : apiKey.status === "expired" ? (
            <span className="text-[11px] text-orange-700">Expired {formatDay(apiKey.expires_at)}</span>
          ) : canManage ? (
            confirming ? (
              <span className="inline-flex items-center gap-2">
                <span className="text-[11px] text-ink">Revoke it?</span>
                <button
                  type="button"
                  onClick={revoke}
                  disabled={pending}
                  className="rounded-md bg-orange-500 px-2 py-1 text-[11px] text-white hover:bg-orange-600 disabled:opacity-60"
                >
                  {pending ? <Loader2 className="h-3 w-3 animate-spin" aria-label="Revoking" /> : "Yes, revoke"}
                </button>
                <button type="button" onClick={() => setConfirming(false)} disabled={pending} className="text-[11px] text-muted underline">
                  Keep
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="btn btn-ghost h-7 rounded-md px-2.5 py-0 text-[11px]"
              >
                <Ban className="h-3 w-3" aria-hidden="true" /> Revoke
                <span className="sr-only"> {apiKey.name}</span>
              </button>
            )
          ) : null}
        </td>
      </tr>
      {(confirming || error) && (
        <tr>
          <td colSpan={6} className="!py-1.5 text-[11.5px] leading-snug">
            {confirming && !pending && (
              <span className="text-muted">
                Anything using this key gets a 401 on its next request. The row stays, so the record of its use survives.
              </span>
            )}
            {error && (
              <span role="alert" className="flex items-start gap-1.5 text-orange-700">
                <CircleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                {error}
              </span>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// The page body
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
   * The panel says so, because a reader must never mistake a fixture for a
   * credential that exists.
   */
  keysAreDemo: boolean;
}

function Callout({ tone, title, children }: { tone: "info" | "warn"; title: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[12.5px] leading-snug",
        tone === "warn" ? "border-orange-100 bg-orange-50" : "border-line bg-white",
      )}
    >
      {tone === "warn" ? (
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" aria-hidden="true" />
      ) : (
        <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-cyan-600" aria-hidden="true" />
      )}
      <div className="min-w-0">
        <div className="font-medium text-ink">{title}</div>
        <p className="mt-0.5 text-body">{children}</p>
      </div>
    </div>
  );
}

export function ConnectPanel({ keys, screens, origin, orgName, role, canManage, isDemo, keysAreDemo }: ConnectPanelProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [minted, setMinted] = useState<{ key: string; name: string } | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [language, setLanguage] = useState<SnippetLanguage>("curl");
  const mintedRef = useRef<HTMLDivElement>(null);

  // Derived rather than stored, so a screen that disappears from the list (the
  // page revalidates after every write) cannot leave a dead id in the snippet.
  const screenId =
    picked !== null && screens.some((screen) => screen.id === picked) ? picked : (screens[0]?.id ?? "");

  const snippetInputs: SnippetInputs = useMemo(
    () => ({ origin, screenId: screenId || SCREEN_PLACEHOLDER, apiKey: minted?.key ?? KEY_PLACEHOLDER }),
    [origin, screenId, minted],
  );
  const code = useMemo(() => snippetFor(language, snippetInputs), [language, snippetInputs]);

  const liveKeys = keys.filter((key) => key.status === "active").length;

  // A key that has just been made is the one thing on the page that cannot be
  // recovered, so the reader is brought to it rather than left to find it.
  useEffect(() => {
    if (minted) mintedRef.current?.focus();
  }, [minted]);

  const createButton = (
    <button
      type="button"
      onClick={() => setDrawerOpen(true)}
      disabled={!canManage}
      className="btn btn-orange h-8 rounded-lg px-3 py-0 text-[12.5px] disabled:cursor-not-allowed disabled:opacity-50"
      title={canManage ? undefined : "Owners and admins can create keys"}
    >
      <Plus className="h-4 w-4" aria-hidden="true" /> New API key
    </button>
  );

  return (
    <div className="flex flex-col gap-3 pb-6">
      <PageHeader
        dense
        title="Connect"
        body="Read this workspace's hit results from a script, a notebook or a pipeline."
        actions={createButton}
      />

      {isDemo && (
        <Callout tone="info" title="You are browsing the demo">
          The demo has no workspace of its own, so nothing is stored and no key can be created. The snippets below are real
          and point at this instance. Sign in to make a key against your own screens.
        </Callout>
      )}

      {!isDemo && !canManage && (
        <Callout tone="warn" title="Keys are an owner and admin matter">
          Your role in {orgName} is {role ? ROLE_LABEL[role].toLowerCase() : "unassigned"}, so this list is empty for you even
          if the workspace has keys. Ask an owner or an admin to make one, then paste it into the snippets below.
        </Callout>
      )}

      {minted && (
        <div
          ref={mintedRef}
          tabIndex={-1}
          role="region"
          aria-label={`New key ${minted.name}`}
          className="rounded-lg border border-orange-300 bg-orange-50/70 p-3 outline-none"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2.5">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" aria-hidden="true" />
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-ink">Copy {minted.name} now. This is the only time it is shown.</div>
                <p className="mt-0.5 text-[12px] leading-snug text-body">
                  SplicR keeps only a sha-256 hash of this key, so nobody, including us, can read it back. If it is lost, revoke
                  it and make another.
                </p>
              </div>
            </div>
            <button type="button" onClick={() => setMinted(null)} aria-label="Hide the key" className="icon-btn h-8 w-8 shrink-0">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 break-all rounded-lg bg-teal-950 px-3 py-2 font-mono text-[12px] text-white">{minted.key}</code>
            <CopyButton value={minted.key} label="Copy key" subject={`the key ${minted.name}`} />
          </div>
          <p className="mt-2 text-[11.5px] text-muted">The snippets below already use it. They fall back to a placeholder once you hide this box.</p>
        </div>
      )}

      <Panel
        title="API keys"
        count={keysAreDemo ? "sample rows" : keys.length > 0 ? `${formatNumber(liveKeys)} live of ${formatNumber(keys.length)}` : orgName}
        caveat={keysAreDemo ? "Sample rows. None of these is a real key, and none can authenticate anything." : undefined}
        body="flush"
        footer={
          <FootNote>
            Only hits:read is checked by an endpoint today. Every other scope is reserved for endpoints that do not exist yet.
          </FootNote>
        }
      >
        {keys.length === 0 ? (
          <div className="p-4">
            <Empty
              title={isDemo ? "No keys in the demo workspace" : "No API keys yet"}
              body="A key lets a script read this workspace over HTTP: the hits from a screen, their artifact flags and the recorded statistics. Each key carries scopes, and revoking one takes effect on its next request."
              action={canManage ? createButton : undefined}
            />
          </div>
        ) : (
          <DenseTable minWidth={760}>
            <caption className="sr-only">API keys for {orgName}, with scopes, status and last use</caption>
            <thead>
              <tr>
                <Th>Key</Th>
                <Th>Scopes</Th>
                <Th>Status</Th>
                <Th>Created</Th>
                <Th>Last used</Th>
                <Th align="right">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {keys.map((apiKey) => (
                <KeyRow key={apiKey.id} apiKey={apiKey} canManage={canManage} />
              ))}
            </tbody>
          </DenseTable>
        )}
      </Panel>

      <Panel
        title="Read hits"
        count="GET /api/v1/hits"
        control={
          <Segmented
            label="Snippet language"
            value={language}
            onChange={setLanguage}
            options={SNIPPET_LANGUAGES.map((option) => ({ value: option.value, label: option.label }))}
          />
        }
        footer={
          <FootNote>
            Read only. There is no write endpoint and no remote MCP server yet.
          </FootNote>
        }
      >
        {screens.length > 1 && (
          <div className="mb-3 max-w-md">
            <label htmlFor="connect-screen" className="mb-1 block text-[12px] text-ink">
              Screen in the example
            </label>
            <select
              id="connect-screen"
              value={screenId}
              onChange={(event) => setPicked(event.target.value)}
              className="h-8 w-full rounded-md border border-line bg-white px-2 pr-6 text-[13px] text-ink outline-none focus:border-cyan-500"
            >
              {screens.map((screen) => (
                <option key={screen.id} value={screen.id}>
                  {screen.name} ({formatNumber(screen.n_hits)} hits)
                </option>
              ))}
            </select>
          </div>
        )}
        {screens.length === 1 && (
          <p className="mb-3 text-[12.5px] text-muted">
            Pointed at {screens[0].name}, {formatNumber(screens[0].n_hits)} hits.
          </p>
        )}
        {screens.length === 0 && (
          <p className="mb-3 text-[12.5px] text-muted">
            {isDemo
              ? "The demo workspace holds no screens of its own, so the example carries a placeholder id."
              : "This workspace has no screens yet, so the example uses a placeholder id. Once a screen exists its real id appears here."}
          </p>
        )}

        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-[11px] uppercase tracking-[0.08em] text-muted">
            {SNIPPET_LANGUAGES.find((option) => option.value === language)?.label}
          </span>
          <CopyButton value={code} subject={`the ${language} snippet`} />
        </div>
        <pre
          tabIndex={0}
          aria-label={`${language} example`}
          className="thin-scroll overflow-x-auto rounded-lg bg-teal-950 p-3.5 text-[12px] leading-relaxed text-white/90"
        >
          {code}
        </pre>

        <p className="mt-3 text-[11.5px] leading-snug text-muted">
          <code className="font-mono">chance_real</code> and <code className="font-mono">chance_interval</code> are stored,
          uncalibrated model outputs, not validation probabilities or confidence intervals. <code className="font-mono">validation_probability</code>{" "}
          is null. Small p-values and FDRs keep their recorded precision, exponent notation included, and a missing value stays
          null.
        </p>
      </Panel>

      <div className="grid grid-cols-12 gap-4">
        <Panel title="Parameters" count={`${HITS_PARAMS.length}`} span={8} body="flush">
          <DenseTable minWidth={460} compact>
            <caption className="sr-only">Query parameters of GET /api/v1/hits</caption>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Value</Th>
                <Th>Meaning</Th>
              </tr>
            </thead>
            <tbody>
              {HITS_PARAMS.map((row) => (
                <tr key={row.name}>
                  <td className="font-mono text-[11.5px] text-ink">{row.name}</td>
                  <td className="text-body">{row.type}</td>
                  <td className="whitespace-normal text-body">{row.note}</td>
                </tr>
              ))}
            </tbody>
          </DenseTable>
        </Panel>
        <Panel title="Answers" count={`${HITS_STATUS.length} statuses`} span={4} body="flush">
          <DenseTable minWidth={300} compact>
            <caption className="sr-only">Status codes GET /api/v1/hits can return</caption>
            <thead>
              <tr>
                <Th>Code</Th>
                <Th>Meaning</Th>
              </tr>
            </thead>
            <tbody>
              {HITS_STATUS.map((row) => (
                <tr key={row.code}>
                  <td className="num text-ink">{row.code}</td>
                  <td className="whitespace-normal text-body">{row.meaning}</td>
                </tr>
              ))}
            </tbody>
          </DenseTable>
        </Panel>
      </div>

      <Panel
        title="Each hit"
        count={`${HITS_FIELDS.length} fields`}
        body="flush"
        footer={<FootNote>Listed from the endpoint&apos;s own output, so a field cannot be documented and missing, or returned and undocumented</FootNote>}
      >
        <DenseTable minWidth={620} compact>
          <caption className="sr-only">Fields in each hit the endpoint returns</caption>
          <thead>
            <tr>
              <Th>Field</Th>
              <Th>Type</Th>
              <Th>Meaning</Th>
            </tr>
          </thead>
          <tbody>
            {HITS_FIELDS.map((row) => (
              <tr key={row.name}>
                <td className="font-mono text-[11.5px] text-ink">{row.name}</td>
                <td className="text-body">{row.type}</td>
                <td className="whitespace-normal text-body">{row.note}</td>
              </tr>
            ))}
          </tbody>
        </DenseTable>
      </Panel>

      {drawerOpen && (
        <CreateKeyDrawer
          onClose={() => setDrawerOpen(false)}
          onCreated={(key, name) => {
            setDrawerOpen(false);
            setMinted({ key, name });
          }}
        />
      )}
    </div>
  );
}
