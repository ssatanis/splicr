"use client";

import { ImageUp, Loader2, Trash2 } from "lucide-react";
import { useRef, useState, useTransition } from "react";

import { removeLabLogo, uploadLabLogo } from "@/lib/data/actions";
import { cn, initials } from "@/lib/utils";

/**
 * The lab's own logo, uploaded rather than linked.
 *
 * A URL field asked every lab to host a file somewhere first, which most of
 * them cannot do and none of them should have to. This takes the file.
 *
 * It is not a `<form>` and it is not inside one. The lab panel around it is a
 * form of its own, forms do not nest, and posting several megabytes of PNG
 * every time somebody edits the lab's time zone would be absurd. So the file
 * goes straight to the Server Action from here, and the panel underneath never
 * sees it.
 *
 * The preview is a background image, not an `<img>`. It is decorative, it has
 * to letterbox inside a fixed square whatever shape the lab's mark is, and it
 * lives on the storage origin rather than this one, so the element that would
 * otherwise need width, height and a remote-pattern allowance earns none of
 * them.
 */
export function LabLogoField({
  orgName,
  logoUrl,
  canEdit,
  lockedReason,
}: {
  orgName: string;
  logoUrl: string | null;
  canEdit: boolean;
  /** Why this is read only, shown instead of the controls. */
  lockedReason?: string;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  function choose(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Clear the picker straight away, so choosing the same file twice after a
    // failure still fires a change event.
    event.target.value = "";
    if (!file) return;

    setNote(null);
    const body = new FormData();
    body.set("logo", file);
    startTransition(async () => {
      const result = await uploadLabLogo(body);
      setNote(
        result.ok
          ? { tone: "ok", text: "Logo saved." }
          : { tone: "err", text: result.error },
      );
    });
  }

  function remove() {
    setNote(null);
    startTransition(async () => {
      const result = await removeLabLogo();
      setNote(
        result.ok
          ? { tone: "ok", text: "Logo removed." }
          : { tone: "err", text: result.error },
      );
    });
  }

  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <div className="flex items-center gap-4">
        <LogoPreview orgName={orgName} logoUrl={logoUrl} />

        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-ink">Lab logo</div>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            Shown beside the workspace name in the sidebar. PNG, JPEG or WebP, up to 2 MB.
          </p>

          {canEdit ? (
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <input
                ref={input}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={choose}
                aria-label="Lab logo image file"
              />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={pending}
                onClick={() => input.current?.click()}
              >
                {pending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <ImageUp className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {logoUrl ? "Replace" : "Upload a logo"}
              </button>
              {logoUrl && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm text-muted"
                  disabled={pending}
                  onClick={remove}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Remove
                </button>
              )}
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted">
              {lockedReason ?? "Only an owner or an admin can change the lab logo."}
            </p>
          )}

          {note && (
            <p
              role={note.tone === "err" ? "alert" : "status"}
              className={cn(
                "mt-2 text-xs",
                note.tone === "err" ? "text-red-700" : "text-teal-700",
              )}
            >
              {note.text}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** The current mark, or the lab's initials while there is not one. */
export function LogoPreview({
  orgName,
  logoUrl,
  className,
}: {
  orgName: string;
  logoUrl: string | null;
  className?: string;
}) {
  if (logoUrl) {
    return (
      <span
        role="img"
        aria-label={`${orgName} logo`}
        className={cn(
          "h-16 w-16 shrink-0 rounded-xl border border-line bg-white bg-contain bg-center bg-no-repeat",
          className,
        )}
        style={{ backgroundImage: `url(${JSON.stringify(logoUrl)})` }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-dashed border-line-strong bg-mist-soft text-[15px] font-medium text-muted",
        className,
      )}
    >
      {initials(orgName)}
    </span>
  );
}
