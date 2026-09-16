"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Download, Loader2, MessageCircle } from "lucide-react";
import { whatsappOrderLink } from "@/lib/notifications/actions";
import { canShareFile, describeError, isShareCancelled, renderElementToJpegFile } from "@/lib/receipt/share-image";

interface ReceiptShareProps {
  readonly children: React.ReactNode;
  readonly filename: string;
  readonly message: string;
  readonly orderId: string;
  readonly phone: string | null;
}

interface ShareDiagnostics {
  readonly fileName: string | null;
  readonly fileType: string | null;
  readonly fileSizeBytes: number | null;
  readonly canvasWidth: number | null;
  readonly canvasHeight: number | null;
  readonly canShareResult: boolean | null;
  readonly shareInvoked: boolean;
  readonly sharePayloadKeys: readonly string[] | null;
  readonly shareOutcome: "pending" | "resolved" | "cancelled" | "rejected" | null;
  readonly shareErrorName: string | null;
  readonly shareErrorMessage: string | null;
}

const EMPTY_DIAG: ShareDiagnostics = {
  fileName: null,
  fileType: null,
  fileSizeBytes: null,
  canvasWidth: null,
  canvasHeight: null,
  canShareResult: null,
  shareInvoked: false,
  sharePayloadKeys: null,
  shareOutcome: null,
  shareErrorName: null,
  shareErrorMessage: null,
};

/**
 * TEMPORARY: this component carries a "Diagnostic info" panel (collapsed by
 * default) added specifically for the Web Share investigation — real facts
 * about the generated file and the actual share() call, read off the real
 * device, since nothing in this environment can open a phone. Meant to come
 * back out once the investigation concludes; it changes no default-visible
 * behaviour for an ordinary customer.
 *
 * Wraps the (unmodified, server-rendered) invoice with the native-share
 * flow: press Send on WhatsApp → the OS/browser share sheet opens with the
 * invoice already attached as an image → pick WhatsApp → pick a contact →
 * send. No WhatsApp Business API, no server upload — the image is rendered
 * from this exact DOM, client-side, and handed to `navigator.share`.
 *
 * The image is generated as soon as this mounts, not on click: `navigator
 * .share` must run inside the click's own user-activation window, and
 * rendering the DOM to a canvas is the one genuinely slow step here. By the
 * time a person has read the receipt and reached for the button, `file` is
 * already sitting in state — the click handler itself is synchronous.
 */
export function ReceiptShare({ children, filename, message, orderId, phone }: ReceiptShareProps) {
  const captureRef = useRef<HTMLDivElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"preparing" | "ready" | "unsupported" | "error">("preparing");
  const [genErrorDetail, setGenErrorDetail] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [linkPending, setLinkPending] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const [diag, setDiag] = useState<ShareDiagnostics>(EMPTY_DIAG);

  useEffect(() => {
    const node = captureRef.current;
    if (!node) return;
    let cancelled = false;
    setStatus("preparing");
    renderElementToJpegFile(node, filename)
      .then(({ file: generated, canvasWidth, canvasHeight }) => {
        if (cancelled) return;
        const shareable = canShareFile(generated);
        setFile(generated);
        setDiag((prev) => ({
          ...prev,
          fileName: generated.name,
          fileType: generated.type,
          fileSizeBytes: generated.size,
          canvasWidth,
          canvasHeight,
          canShareResult: shareable,
        }));
        setStatus(shareable ? "ready" : "unsupported");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setGenErrorDetail(describeError(error));
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [filename]);

  // Memoised, not effect+state: the URL is a pure function of `file` (React
  // may discard and recompute a memo, but never for a `file` that's still
  // current), and creating it during render — rather than a beat later, in
  // an effect — means the download link is correct on its very first paint.
  const objectUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);

  // Deliberately synchronous: called directly from onClick, no await before
  // navigator.share, so the browser still sees this as the same user
  // gesture that started the click.
  //
  // files only, title explicitly blank — no `text`. Every step of this call
  // is now recorded into `diag` (payload shape, resolve/reject, exact
  // error) rather than assumed from silence — see the diagnostic panel.
  function handleShare() {
    if (!file) return;
    setShareError(null);
    const payload = { title: "", files: [file] };
    setDiag((prev) => ({
      ...prev,
      shareInvoked: true,
      sharePayloadKeys: Object.keys(payload),
      shareOutcome: "pending",
      shareErrorName: null,
      shareErrorMessage: null,
    }));
    navigator.share(payload).then(
      () => setDiag((prev) => ({ ...prev, shareOutcome: "resolved" })),
      (error: unknown) => {
        if (isShareCancelled(error)) {
          setDiag((prev) => ({ ...prev, shareOutcome: "cancelled" }));
          return;
        }
        const name = error instanceof DOMException || error instanceof Error ? error.name : "UnknownError";
        const msg = describeError(error);
        setDiag((prev) => ({ ...prev, shareOutcome: "rejected", shareErrorName: name, shareErrorMessage: msg }));
        setShareError(`Couldn't open the share sheet (${msg}). Try downloading the image instead.`);
      },
    );
  }

  function copyMessage() {
    if (!navigator.clipboard?.writeText) {
      setCopyStatus("error");
      return;
    }
    navigator.clipboard.writeText(message).then(
      () => setCopyStatus("copied"),
      () => setCopyStatus("error"),
    );
  }

  useEffect(() => {
    if (copyStatus === "idle") return;
    const timer = setTimeout(() => setCopyStatus("idle"), 2000);
    return () => clearTimeout(timer);
  }, [copyStatus]);

  function requestTextLink() {
    setLinkPending(true);
    setLinkError(null);
    whatsappOrderLink({ orderId }).then((result) => {
      setLinkPending(false);
      if (!result.ok) {
        setLinkError(result.error);
        return;
      }
      window.open(result.url, "_blank", "noopener,noreferrer");
    });
  }

  return (
    <>
      <div ref={captureRef}>{children}</div>

      <div className="mt-4 flex flex-col items-end gap-2 print:hidden">
        {status !== "preparing" && (
          <p className="text-xs font-semibold text-muted-foreground">
            Native image share:{" "}
            {status === "ready"
              ? "SUPPORTED (native share sheet will open)"
              : status === "unsupported"
                ? "NOT SUPPORTED on this browser (canShare returned false — fallback shown below)"
                : "FAILED to prepare image (fallback shown below)"}
          </p>
        )}

        {(status === "ready" || status === "preparing") && (
          <div className="flex flex-col items-end gap-1">
            <p className="max-w-[26rem] text-right text-sm text-muted-foreground">{message}</p>
            <button
              type="button"
              onClick={copyMessage}
              className="inline-flex min-h-[32px] items-center gap-1.5 rounded-md px-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
            >
              {copyStatus === "copied" ? (
                <>
                  <Check className="size-3.5" aria-hidden="true" />
                  Copied
                </>
              ) : copyStatus === "error" ? (
                <>
                  <Copy className="size-3.5" aria-hidden="true" />
                  Couldn&rsquo;t copy — select the text above
                </>
              ) : (
                <>
                  <Copy className="size-3.5" aria-hidden="true" />
                  Copy message
                </>
              )}
            </button>
          </div>
        )}

        {status === "ready" && (
          <button
            type="button"
            onClick={handleShare}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-md bg-[var(--red-ink)] px-4 text-sm font-semibold text-[var(--cream)] transition-colors hover:bg-[var(--red-deep)]"
          >
            <MessageCircle className="size-4" aria-hidden="true" />
            Send on WhatsApp
          </button>
        )}

        {status === "preparing" && (
          <span className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-border-strong px-4 text-sm font-semibold text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Preparing invoice image…
          </span>
        )}

        {(status === "unsupported" || status === "error") && (
          <div className="flex flex-col items-end gap-2">
            <p className="max-w-[26rem] text-right text-sm text-muted-foreground">
              {status === "unsupported"
                ? "Image sharing isn’t supported on this device. Download the invoice image and share it through WhatsApp."
                : "Couldn’t prepare the invoice image on this device. Download it below, or send the order link instead."}
            </p>
            {status === "error" && genErrorDetail && (
              <p className="max-w-[26rem] text-right text-xs text-muted-foreground/70">{genErrorDetail}</p>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              {objectUrl && (
                <a
                  href={objectUrl}
                  download={filename}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-md bg-[var(--red-ink)] px-4 text-sm font-semibold text-[var(--cream)] transition-colors hover:bg-[var(--red-deep)]"
                >
                  <Download className="size-4" aria-hidden="true" />
                  Download invoice image
                </a>
              )}
              {phone && (
                <button
                  type="button"
                  onClick={requestTextLink}
                  disabled={linkPending}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-border-strong px-4 text-sm font-semibold transition-colors hover:bg-surface disabled:opacity-50"
                >
                  {linkPending ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <MessageCircle className="size-4" aria-hidden="true" />
                  )}
                  Send order link via WhatsApp (no image)
                </button>
              )}
            </div>
            {linkError && (
              <p role="alert" className="text-sm text-muted-foreground">
                {linkError}
              </p>
            )}
          </div>
        )}

        {shareError && (
          <p role="alert" className="text-sm text-muted-foreground">
            {shareError}
          </p>
        )}

        <details className="mt-2 w-full max-w-[26rem] rounded-md border border-border-strong p-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer font-semibold text-foreground">Diagnostic info (temporary)</summary>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt>navigator.share</dt>
            <dd>{typeof navigator !== "undefined" && !!navigator.share ? "present" : "missing"}</dd>
            <dt>navigator.canShare</dt>
            <dd>{typeof navigator !== "undefined" && !!navigator.canShare ? "present" : "missing"}</dd>
            <dt>File name</dt>
            <dd className="break-all">{diag.fileName ?? "—"}</dd>
            <dt>File type</dt>
            <dd>{diag.fileType ?? "—"}</dd>
            <dt>File size</dt>
            <dd>{diag.fileSizeBytes !== null ? `${diag.fileSizeBytes.toLocaleString()} bytes` : "—"}</dd>
            <dt>Canvas size</dt>
            <dd>{diag.canvasWidth !== null ? `${diag.canvasWidth} × ${diag.canvasHeight}px` : "—"}</dd>
            <dt>{"canShare({files})"}</dt>
            <dd>{diag.canShareResult === null ? "—" : String(diag.canShareResult)}</dd>
            <dt>share() called</dt>
            <dd>{diag.shareInvoked ? "yes" : "no"}</dd>
            <dt>Payload keys</dt>
            <dd>{diag.sharePayloadKeys ? diag.sharePayloadKeys.join(", ") : "—"}</dd>
            <dt>share() outcome</dt>
            <dd>{diag.shareOutcome ?? "—"}</dd>
            <dt>Error name</dt>
            <dd>{diag.shareErrorName ?? "—"}</dd>
            <dt>Error message</dt>
            <dd className="break-all">{diag.shareErrorMessage ?? "—"}</dd>
            <dt>User agent</dt>
            <dd className="break-all">{typeof navigator !== "undefined" ? navigator.userAgent : "—"}</dd>
          </dl>
        </details>
      </div>
    </>
  );
}
