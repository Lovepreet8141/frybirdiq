"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Loader2, MessageCircle } from "lucide-react";
import { whatsappOrderLink } from "@/lib/notifications/actions";
import { canShareFile, describeError, isShareCancelled, renderElementToJpegFile } from "@/lib/receipt/share-image";

interface ReceiptShareProps {
  readonly children: React.ReactNode;
  readonly filename: string;
  readonly message: string;
  readonly orderId: string;
  readonly phone: string | null;
}

/**
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

  useEffect(() => {
    const node = captureRef.current;
    if (!node) return;
    let cancelled = false;
    setStatus("preparing");
    renderElementToJpegFile(node, filename)
      .then((generated) => {
        if (cancelled) return;
        setFile(generated);
        setStatus(canShareFile(generated) ? "ready" : "unsupported");
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
  // the first navigator.share, so the browser still sees this as the same
  // user gesture that started the click.
  //
  // Tries files+caption first — valid per spec, and there's no evidence
  // against it, only evidence that this handler wasn't being reached at
  // all (see share-image.ts / the investigation that led here). If a share
  // target genuinely rejects the combined payload, retries once with the
  // image alone, in the same gesture (a .catch() continuation, not a new
  // click) — file delivery matters more than the caption riding along with
  // it. A rejection here is a real, reportable failure either way; the
  // native share sheet resolving "successfully" but the target app quietly
  // discarding the file is not something a web page can detect — nothing
  // in the Web Share API surfaces what the receiving app did with it.
  function handleShare() {
    if (!file) return;
    setShareError(null);
    navigator.share({ files: [file], text: message }).catch((error: unknown) => {
      if (isShareCancelled(error)) return;
      navigator.share({ files: [file] }).catch((retryError: unknown) => {
        if (isShareCancelled(retryError)) return;
        setShareError(`Couldn't open the share sheet (${describeError(retryError)}). Try downloading the image instead.`);
      });
    });
  }

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
        {(status === "ready" || status === "preparing") && (
          <p className="max-w-[26rem] text-right text-sm text-muted-foreground">{message}</p>
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
      </div>
    </>
  );
}
