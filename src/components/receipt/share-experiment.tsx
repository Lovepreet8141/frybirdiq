"use client";

import { useEffect, useState } from "react";
import { canShareFile, describeError, isShareCancelled, type RenderedImage } from "@/lib/receipt/share-image";

interface Facts {
  readonly fileName: string | null;
  readonly fileType: string | null;
  readonly fileSize: number | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly canShare: boolean | null;
  readonly genError: string | null;
  readonly shareOutcome: "pending" | "resolved" | "cancelled" | "rejected" | null;
  readonly shareErrorName: string | null;
  readonly shareErrorMessage: string | null;
}

const EMPTY: Facts = {
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

/**
 * TEMPORARY — one row of the Web Share investigation: generate a file via
 * `generate`, report its real properties and `canShare` result, and offer
 * an on-demand "Try share" so the actual `navigator.share` outcome for
 * *this specific file* can be compared against every other row on the same
 * device, same page load. Used by both the real invoice's experiment panel
 * and the standalone /share-diagnostic page — one implementation, not two.
 */
export function ShareExperiment({
  label,
  autoRun = false,
  generate,
}: {
  label: string;
  autoRun?: boolean;
  generate: () => Promise<RenderedImage>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [facts, setFacts] = useState<Facts>(EMPTY);
  const [running, setRunning] = useState(false);

  function run() {
    setRunning(true);
    setFacts(EMPTY);
    generate()
      .then(({ file: generated, canvasWidth, canvasHeight }) => {
        const shareable = canShareFile(generated);
        setFile(generated);
        setFacts((prev) => ({
          ...prev,
          fileName: generated.name,
          fileType: generated.type,
          fileSize: generated.size,
          width: canvasWidth,
          height: canvasHeight,
          canShare: shareable,
        }));
        setRunning(false);
      })
      .catch((error: unknown) => {
        setFacts((prev) => ({ ...prev, genError: describeError(error) }));
        setRunning(false);
      });
  }

  // Auto-run rows only ever run once, on mount — the button re-runs on demand
  // after that. Deferred a tick so the effect body itself never calls
  // setState synchronously (run()'s first lines do).
  useEffect(() => {
    if (!autoRun) return;
    const id = setTimeout(run, 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function share() {
    if (!file) return;
    setFacts((prev) => ({ ...prev, shareOutcome: "pending", shareErrorName: null, shareErrorMessage: null }));
    navigator.share({ title: "", files: [file] }).then(
      () => setFacts((prev) => ({ ...prev, shareOutcome: "resolved" })),
      (error: unknown) => {
        if (isShareCancelled(error)) {
          setFacts((prev) => ({ ...prev, shareOutcome: "cancelled" }));
          return;
        }
        const name = error instanceof DOMException || error instanceof Error ? error.name : "UnknownError";
        setFacts((prev) => ({ ...prev, shareOutcome: "rejected", shareErrorName: name, shareErrorMessage: describeError(error) }));
      },
    );
  }

  const area = facts.width !== null && facts.height !== null ? facts.width * facts.height : null;

  return (
    <div className="rounded-md border border-border-strong p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-heading text-sm font-bold text-foreground">{label}</h3>
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="text-xs font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          {running ? "Running…" : file ? "Re-run" : "Run"}
        </button>
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted-foreground">
        <dt>File</dt>
        <dd className="break-all">
          {facts.fileName ?? "—"} {facts.fileType ? `(${facts.fileType})` : ""}
        </dd>
        <dt>Size</dt>
        <dd>{facts.fileSize !== null ? `${facts.fileSize.toLocaleString()} bytes` : "—"}</dd>
        <dt>Dimensions</dt>
        <dd>{facts.width !== null ? `${facts.width} × ${facts.height}px (${area?.toLocaleString()} px area)` : "—"}</dd>
        <dt>Gen error</dt>
        <dd>{facts.genError ?? "—"}</dd>
        <dt>{"canShare({files})"}</dt>
        <dd>{facts.canShare === null ? "—" : String(facts.canShare)}</dd>
        <dt>share() outcome</dt>
        <dd>{facts.shareOutcome ?? "—"}</dd>
        <dt>Error</dt>
        <dd className="break-all">{facts.shareErrorName ? `${facts.shareErrorName}: ${facts.shareErrorMessage}` : "—"}</dd>
      </dl>
      {file && facts.canShare && (
        <button
          type="button"
          onClick={share}
          className="mt-2 inline-flex min-h-[36px] items-center rounded-md bg-[var(--red-ink)] px-3 text-xs font-semibold text-[var(--cream)]"
        >
          Try share
        </button>
      )}
    </div>
  );
}
