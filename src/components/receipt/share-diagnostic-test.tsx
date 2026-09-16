"use client";

import { useEffect, useState } from "react";

/**
 * TEMPORARY, standalone diagnostic — no order/customer data touched at all.
 * Generates a tiny, known-good synthetic image (drawn locally, not the
 * invoice) and runs the exact same canShare/share calls the real invoice
 * share button uses, so its result can be compared against the real
 * invoice's result on the same device: if this tiny file shares
 * successfully but the invoice doesn't, the problem is specific to the
 * generated invoice file; if both fail the same way, it's the device/
 * browser/WhatsApp combination, not anything FRYBIRD IQ generates.
 *
 * Meant to be deleted once the Web Share investigation concludes.
 */

function makeSyntheticFile(type: "image/jpeg" | "image/png", filename: string): Promise<{ file: File; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 200;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      reject(new Error("Could not get a 2D canvas context."));
      return;
    }
    ctx.fillStyle = "#D92B2B";
    ctx.fillRect(0, 0, 200, 200);
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 24px sans-serif";
    ctx.fillText("TEST", 55, 105);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("canvas.toBlob returned null."));
          return;
        }
        resolve({ file: new File([blob], filename, { type }), width: canvas.width, height: canvas.height });
      },
      type,
      0.92,
    );
  });
}

interface OneResult {
  fileName: string | null;
  fileType: string | null;
  fileSize: number | null;
  width: number | null;
  height: number | null;
  canShare: boolean | null;
  genError: string | null;
  shareOutcome: string | null;
  shareErrorName: string | null;
  shareErrorMessage: string | null;
}

const EMPTY: OneResult = {
  fileName: null,
  fileType: null,
  fileSize: null,
  width: null,
  height: null,
  canShare: null,
  genError: null,
  shareOutcome: null,
  shareErrorName: null,
  shareErrorMessage: null,
};

function TestRow({ type, label }: { type: "image/jpeg" | "image/png"; label: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<OneResult>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    const ext = type === "image/jpeg" ? "jpg" : "png";
    makeSyntheticFile(type, `test.${ext}`)
      .then(({ file: generated, width, height }) => {
        if (cancelled) return;
        let shareable: boolean | null = null;
        try {
          shareable =
            typeof navigator !== "undefined" && !!navigator.share && !!navigator.canShare
              ? navigator.canShare({ files: [generated] })
              : false;
        } catch (error) {
          shareable = false;
          setResult((prev) => ({ ...prev, genError: error instanceof Error ? error.message : String(error) }));
        }
        setFile(generated);
        setResult((prev) => ({ ...prev, fileName: generated.name, fileType: generated.type, fileSize: generated.size, width, height, canShare: shareable }));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setResult((prev) => ({ ...prev, genError: error instanceof Error ? error.message : String(error) }));
      });
    return () => {
      cancelled = true;
    };
  }, [type]);

  function share() {
    if (!file) return;
    setResult((prev) => ({ ...prev, shareOutcome: "pending", shareErrorName: null, shareErrorMessage: null }));
    navigator.share({ title: "", files: [file] }).then(
      () => setResult((prev) => ({ ...prev, shareOutcome: "resolved" })),
      (error: unknown) => {
        const name = error instanceof DOMException || error instanceof Error ? error.name : "UnknownError";
        if (name === "AbortError") {
          setResult((prev) => ({ ...prev, shareOutcome: "cancelled" }));
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        setResult((prev) => ({ ...prev, shareOutcome: "rejected", shareErrorName: name, shareErrorMessage: message }));
      },
    );
  }

  return (
    <div className="rounded-md border border-border-strong p-4">
      <h2 className="font-heading text-base font-bold">{label}</h2>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <dt>File name</dt>
        <dd>{result.fileName ?? "—"}</dd>
        <dt>File type</dt>
        <dd>{result.fileType ?? "—"}</dd>
        <dt>File size</dt>
        <dd>{result.fileSize !== null ? `${result.fileSize.toLocaleString()} bytes` : "—"}</dd>
        <dt>Dimensions</dt>
        <dd>{result.width !== null ? `${result.width} × ${result.height}px` : "—"}</dd>
        <dt>Generation error</dt>
        <dd>{result.genError ?? "—"}</dd>
        <dt>{"canShare({files})"}</dt>
        <dd>{result.canShare === null ? "—" : String(result.canShare)}</dd>
        <dt>share() outcome</dt>
        <dd>{result.shareOutcome ?? "—"}</dd>
        <dt>Error name</dt>
        <dd>{result.shareErrorName ?? "—"}</dd>
        <dt>Error message</dt>
        <dd className="break-all">{result.shareErrorMessage ?? "—"}</dd>
      </dl>
      <button
        type="button"
        onClick={share}
        disabled={!file || !result.canShare}
        className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-md bg-[var(--red-ink)] px-4 text-sm font-semibold text-[var(--cream)] transition-colors hover:bg-[var(--red-deep)] disabled:opacity-50"
      >
        Share test {label}
      </button>
    </div>
  );
}

export function ShareDiagnosticTest() {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground break-all">
        User agent: {typeof navigator !== "undefined" ? navigator.userAgent : "—"}
      </p>
      <TestRow label="JPEG" type="image/jpeg" />
      <TestRow label="PNG" type="image/png" />
    </div>
  );
}
