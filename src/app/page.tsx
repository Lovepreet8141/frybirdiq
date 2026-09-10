/**
 * Phase 0 foundation specimen.
 *
 * Not the homepage — §86 is explicit that the design foundation ships before
 * any customer surface does. This route exists so the visual QA loop in §68
 * has something real to check the tokens against, and so the shell is provably
 * running before Phase 1 starts.
 *
 * Delete this when the homepage lands.
 */

import { formatBps, formatINR, fromRupees } from "@/lib/money";
import { isSupabaseConfigured } from "@/lib/env";

const TYPE_SPECIMEN = [
  { label: "Display", className: "text-5xl font-heading font-bold tracking-tight", sample: "Born crispy." },
  { label: "H1", className: "text-3xl font-heading font-bold", sample: "Built bold." },
  { label: "H2", className: "text-2xl font-heading font-semibold", sample: "Hot · Crispy · Bold" },
  { label: "Body", className: "text-base", sample: "Boneless thigh, brined overnight, double-dredged." },
  { label: "Small", className: "text-sm text-muted-foreground", sample: "Sector 9, Ambala City, Haryana" },
];

const SWATCHES = [
  { name: "Charred", token: "bg-background", hex: "#1F0705", note: "Page" },
  { name: "Charred 2", token: "bg-surface", hex: "#2B0B07", note: "Panels" },
  { name: "Cream", token: "bg-foreground", hex: "#F5EDD8", note: "Type" },
  { name: "Amber", token: "bg-primary", hex: "#F2A324", note: "Actions" },
  { name: "Ember", token: "bg-secondary", hex: "#C21F11", note: "Brand" },
  { name: "Ash", token: "bg-muted-foreground", hex: "#C3A597", note: "Secondary" },
];

const MONEY_SPECIMEN = [
  { label: "Business scale", value: formatINR(fromRupees("940000"), "whole"), note: "Indian grouping" },
  { label: "Unit cost", value: formatINR(fromRupees("33.50"), "unit"), note: "Paise shown" },
  { label: "Order total", value: formatINR(fromRupees("261.45")), note: "Paise only when present" },
  { label: "Food cost", value: formatBps(2750), note: "Basis points" },
];

export default function FoundationPage() {
  const connected = isSupabaseConfigured();

  return (
    <main className="mx-auto w-full max-w-4xl px-[var(--gutter)] py-16 flex flex-col gap-16">
      <header className="flex flex-col gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-primary">Phase 0 · Foundation</p>
        <h1 className="font-heading text-4xl font-bold tracking-tight sm:text-5xl">FRYBIRD IQ</h1>
        <p className="max-w-prose text-muted-foreground">
          The design foundation and financial core are in place. No customer surface is built yet — that is Phase 1.
        </p>
      </header>

      <section aria-labelledby="status" className="flex flex-col gap-4">
        <h2 id="status" className="font-heading text-xl font-semibold">
          Status
        </h2>
        <dl className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
          {[
            ["Money core", "Paise arithmetic, INR formatting, GST"],
            ["Domain", "Order lifecycle, sources, permissions"],
            ["Schema", "42 tables, row-level security"],
            ["Database", connected ? "Connected" : "Not connected yet"],
          ].map(([term, detail]) => (
            <div key={term} className="bg-surface px-5 py-4">
              <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{term}</dt>
              <dd className="mt-1">{detail}</dd>
            </div>
          ))}
        </dl>
        {!connected && (
          <p className="text-sm text-muted-foreground">
            Copy <code className="rounded bg-surface px-1.5 py-0.5">.env.example</code> to{" "}
            <code className="rounded bg-surface px-1.5 py-0.5">.env.local</code> and add your Supabase keys to connect.
          </p>
        )}
      </section>

      <section aria-labelledby="type" className="flex flex-col gap-4">
        <h2 id="type" className="font-heading text-xl font-semibold">
          Type
        </h2>
        <div className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-6">
          {TYPE_SPECIMEN.map(({ label, className, sample }) => (
            <div key={label} className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</span>
              <span className={className}>{sample}</span>
            </div>
          ))}
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Devanagari · descriptors only
            </span>
            <span lang="hi" className="text-lg">
              कुरकुरा चिकन बर्गर
            </span>
          </div>
        </div>
      </section>

      <section aria-labelledby="colour" className="flex flex-col gap-4">
        <h2 id="colour" className="font-heading text-xl font-semibold">
          Colour
        </h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {SWATCHES.map(({ name, token, hex, note }) => (
            <li key={name} className="overflow-hidden rounded-lg border border-border">
              <div className={`h-16 ${token}`} aria-hidden="true" />
              <div className="bg-surface px-3 py-2">
                <p className="text-sm font-semibold">{name}</p>
                <p className="tabular text-xs text-muted-foreground">
                  {hex} · {note}
                </p>
              </div>
            </li>
          ))}
        </ul>
        <p className="max-w-prose text-sm text-muted-foreground">
          Ember is 3.21:1 on charred. It carries the brand at display size and in fills, but it is never body copy —
          amber is the action colour precisely because it holds up at any size.
        </p>
      </section>

      <section aria-labelledby="money" className="flex flex-col gap-4">
        <h2 id="money" className="font-heading text-xl font-semibold">
          Money
        </h2>
        <table className="w-full border-collapse overflow-hidden rounded-lg border border-border text-left">
          <caption className="sr-only">Currency formatting produced by lib/money</caption>
          <thead>
            <tr className="bg-surface-muted">
              <th scope="col" className="px-4 py-2 text-xs font-semibold uppercase tracking-[0.08em]">
                Case
              </th>
              <th scope="col" className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-[0.08em]">
                Renders as
              </th>
              <th scope="col" className="px-4 py-2 text-xs font-semibold uppercase tracking-[0.08em]">
                Rule
              </th>
            </tr>
          </thead>
          <tbody>
            {MONEY_SPECIMEN.map(({ label, value, note }) => (
              <tr key={label} className="border-t border-border bg-surface">
                <th scope="row" className="px-4 py-3 font-normal">
                  {label}
                </th>
                <td className="tabular px-4 py-3 text-right font-semibold">{value}</td>
                <td className="px-4 py-3 text-sm text-muted-foreground">{note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
