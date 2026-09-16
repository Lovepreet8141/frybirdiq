"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Download, Loader2, MessageCircle } from "lucide-react";
import { whatsappOrderLink } from "@/lib/notifications/actions";
import { ensureShareBridge } from "@/lib/hardware/printer/bridge";
import {
  canShareFile,
  describeError,
  fileToBase64,
  isShareCancelled,
  makeSyntheticTestFile,
  renderElementToImageFile,
  renderElementToJpegFile,
} from "@/lib/receipt/share-image";
import { ShareExperiment } from "./share-experiment";

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
  readonly bridgeAvailable: boolean | null;
  readonly canShareResult: boolean | null;
  readonly sharePath: "bridge" | "web-share" | null;
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
  bridgeAvailable: null,
  canShareResult: null,
  sharePath: null,
  shareInvoked: false,
  sharePayloadKeys: null,
  shareOutcome: null,
  shareErrorName: null,
  shareErrorMessage: null,
};

/**
 * Wraps the (unmodified, server-rendered) invoice with the native-share
 * flow: press Send on WhatsApp → the invoice, already generated as an
 * image, is handed off natively → pick WhatsApp → pick a contact → send.
 * No WhatsApp Business API, no server upload — the image is rendered from
 * this exact DOM, client-side, always.
 *
 * Two ways that hand-off happens, tried in this order:
 *  1. `window.FRYPOS.share` — the FRYBIRD POS Android app's own native
 *     bridge (same origin-restricted channel already used for printing).
 *     Standard Android WebView has never implemented the Web Share API at
 *     all, which is why the POS app needs this path; `navigator.share` is
 *     simply undefined inside it, not failing.
 *  2. `navigator.share({ title: "", files: [file] })` — real browsers
 *     (the customer site, staff on a normal browser). `title` deliberately
 *     blank, no `text`: documented iOS/WhatsApp behaviour drops the file
 *     when text rides in the same call.
 * Neither reaching neither: the download/wa.me-link fallback below.
 *
 * Still carries a collapsed "Diagnostic info" panel (added for the Web
 * Share investigation, kept for now to confirm which path a real device
 * actually takes) — real facts about the generated file and the actual
 * share attempt, since nothing in this environment can open a phone.
 *
 * The image is generated as soon as this mounts, not on click:
 * `navigator.share` must run inside the click's own user-activation
 * window (the bridge path has no such constraint, but generating once
 * up front keeps one code path for both), and rendering the DOM to a
 * canvas is the one genuinely slow step here. By the time a person has
 * read the receipt and reached for the button, `file` is already sitting
 * in state.
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
        const bridgeAvailable = !!ensureShareBridge();
        const webShareAvailable = canShareFile(generated);
        setFile(generated);
        setDiag((prev) => ({
          ...prev,
          fileName: generated.name,
          fileType: generated.type,
          fileSizeBytes: generated.size,
          canvasWidth,
          canvasHeight,
          bridgeAvailable,
          canShareResult: webShareAvailable,
        }));
        setStatus(bridgeAvailable || webShareAvailable ? "ready" : "unsupported");
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

  // The FRYBIRD POS app's native bridge first — the only path that works
  // inside its WebView, where navigator.share is simply undefined. Falls
  // through to navigator.share for every real browser (customer site,
  // staff elsewhere), unchanged from before this bridge existed.
  //
  // navigator.share is still called directly from onClick with no await
  // ahead of it, so the browser sees it as the same user gesture that
  // started the click — the bridge path has no such constraint (it is not
  // a Web Share API call at all, just a message to native code), so
  // base64-encoding the file first is safe there.
  function handleShare() {
    if (!file) return;
    setShareError(null);

    const bridge = ensureShareBridge();
    if (bridge) {
      setDiag((prev) => ({ ...prev, sharePath: "bridge", shareInvoked: true, shareOutcome: "pending", shareErrorName: null, shareErrorMessage: null }));
      fileToBase64(file)
        .then((data) => bridge.share({ data, mimeType: "image/jpeg", filename: file.name, text: message }))
        .then((outcome) => {
          if (outcome.shared) {
            setDiag((prev) => ({ ...prev, shareOutcome: "resolved" }));
            return;
          }
          setDiag((prev) => ({ ...prev, shareOutcome: "rejected", shareErrorName: outcome.code, shareErrorMessage: outcome.error }));
          setShareError(`Couldn't share the invoice (${outcome.error}). Try downloading the image instead.`);
        })
        .catch((error: unknown) => {
          const msg = describeError(error);
          setDiag((prev) => ({ ...prev, shareOutcome: "rejected", shareErrorName: "BRIDGE_ERROR", shareErrorMessage: msg }));
          setShareError(`Couldn't share the invoice (${msg}). Try downloading the image instead.`);
        });
      return;
    }

    const payload = { title: "", files: [file] };
    setDiag((prev) => ({
      ...prev,
      sharePath: "web-share",
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
              ? diag.bridgeAvailable
                ? "SUPPORTED via the FRYBIRD POS app's native bridge"
                : "SUPPORTED (native browser share sheet will open)"
              : status === "unsupported"
                ? "NOT SUPPORTED on this browser (fallback shown below)"
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
            <dt>FRYPOS.share bridge</dt>
            <dd>{diag.bridgeAvailable === null ? "—" : diag.bridgeAvailable ? "available" : "not available"}</dd>
            <dt>{"canShare({files})"}</dt>
            <dd>{diag.canShareResult === null ? "—" : String(diag.canShareResult)}</dd>
            <dt>Share path used</dt>
            <dd>{diag.sharePath ?? "—"}</dd>
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

        <details className="mt-2 w-full max-w-[26rem] rounded-md border border-border-strong p-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer font-semibold text-foreground">
            Capture experiments (temporary — press Run on each)
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            <ShareExperiment
              label="B: this invoice, pixelRatio 1, JPEG"
              generate={() => {
                const node = captureRef.current;
                if (!node) return Promise.reject(new Error("Receipt node not mounted."));
                return renderElementToImageFile(node, `${filename}-b.jpg`, { pixelRatio: 1, format: "image/jpeg" });
              }}
            />
            <ShareExperiment
              label="C: this invoice, pixelRatio 2, PNG"
              generate={() => {
                const node = captureRef.current;
                if (!node) return Promise.reject(new Error("Receipt node not mounted."));
                return renderElementToImageFile(node, `${filename}-c.png`, { pixelRatio: 2, format: "image/png" });
              }}
            />
            <ShareExperiment
              label="D: tiny known-good synthetic image (control, same page)"
              generate={() => makeSyntheticTestFile("image/jpeg", "control.jpg")}
            />
          </div>
        </details>
      </div>
    </>
  );
}
