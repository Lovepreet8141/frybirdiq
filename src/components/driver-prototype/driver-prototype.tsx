"use client";

import Link from "next/link";
import { useEffect, useReducer, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ClipboardList, Map as MapIcon, UserRound, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { activeJobs, driverDemoReducer, initialDemoState, offeredJobs } from "./demo";
import { JobScreen, JobsScreen, MapScreen, ProfileScreen, ShiftScreen } from "./screens";
import { Toast } from "./ui";

type Tab = "jobs" | "map" | "shift" | "profile";
type Screen = { readonly kind: "tab"; readonly tab: Tab } | { readonly kind: "job"; readonly id: string; readonly from: Tab };

const TABS: readonly { readonly id: Tab; readonly label: string; readonly icon: typeof ClipboardList }[] = [
  { id: "jobs", label: "Jobs", icon: ClipboardList },
  { id: "map", label: "Map", icon: MapIcon },
  { id: "shift", label: "Shift", icon: Wallet },
  { id: "profile", label: "Profile", icon: UserRound },
];

/**
 * The FRYBIRD Driver App, as an interactive prototype.
 *
 * Runs entirely in this component’s state on invented data. On a phone it
 * fills the screen; on a laptop it sits in a phone-sized frame beside the
 * reviewer’s notes, so the flow can be walked through and discussed
 * before any dispatch, tracking or routing is designed for real.
 */
export function DriverPrototype() {
  const [state, dispatch] = useReducer(driverDemoReducer, undefined, initialDemoState);
  const [screen, setScreen] = useState<Screen>({ kind: "tab", tab: "jobs" });
  const [toast, setToast] = useState<string | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  const tab = screen.kind === "tab" ? screen.tab : screen.from;
  const openJob = (id: string) => setScreen({ kind: "job", id, from: tab });
  const job = screen.kind === "job" ? state.jobs.find((entry) => entry.id === screen.id) : undefined;
  const badge = offeredJobs(state).length;

  const content = (() => {
    if (screen.kind === "job" && job) {
      return <JobScreen key={`job-${job.id}`} job={job} store={state.store} dispatch={dispatch} onBack={() => setScreen({ kind: "tab", tab: screen.from })} onToast={setToast} />;
    }
    switch (tab) {
      case "map":
        return <MapScreen key="map" state={state} onOpenJob={openJob} />;
      case "shift":
        return <ShiftScreen key="shift" state={state} dispatch={dispatch} onToast={setToast} />;
      case "profile":
        return <ProfileScreen key="profile" state={state} dispatch={dispatch} onToast={setToast} />;
      default:
        return <JobsScreen key="jobs" state={state} dispatch={dispatch} onOpenJob={openJob} onToast={setToast} />;
    }
  })();

  const phone = (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
      {/* A stand-in status bar so the frame reads as a phone. */}
      <div className="flex h-9 shrink-0 items-center justify-between bg-panel px-5 text-[12px] font-semibold">
        <span className="tabular">8:04</span>
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <span aria-hidden="true">●●●</span>
          <span className="rounded-[3px] border border-current px-1 text-[10px] leading-[14px]">82</span>
        </span>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={screen.kind === "job" ? `job-${screen.id}` : tab}
            className="absolute inset-0 flex flex-col"
            initial={reduced ? false : { opacity: 0, x: screen.kind === "job" ? 24 : 0, y: screen.kind === "job" ? 0 : 6 }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, x: screen.kind === "job" ? 24 : 0, transition: { duration: 0.12 } }}
            transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
          >
            {content}
          </motion.div>
        </AnimatePresence>
        <Toast message={toast} />
      </div>

      <nav aria-label="Driver app sections" className="grid shrink-0 grid-cols-4 border-t border-border bg-panel pb-[env(safe-area-inset-bottom)]">
        {TABS.map((item) => {
          const active = tab === item.id && screen.kind === "tab";
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setScreen({ kind: "tab", tab: item.id })}
              aria-current={active ? "page" : undefined}
              className={cn("relative flex min-h-[60px] touch-manipulation flex-col items-center justify-center gap-1 text-[10.5px] font-semibold transition-colors duration-[120ms]", active ? "text-primary" : "text-muted-foreground active:text-foreground")}
            >
              <item.icon aria-hidden="true" className="size-5" />
              {item.label}
              {item.id === "jobs" && badge > 0 && (
                <span className="tabular absolute right-[calc(50%-22px)] top-2 flex min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-[18px] text-primary-foreground" aria-label={`${badge} new`}>
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );

  return (
    <div className="flex min-h-dvh flex-col md:flex-row md:items-start md:justify-center md:gap-10 md:px-8 md:py-10">
      {/* Phone: the whole viewport on a phone; a device frame from md up. */}
      <div className="flex min-h-dvh flex-col md:min-h-0 md:shrink-0">
        <div className="flex min-h-dvh flex-col md:h-[820px] md:min-h-0 md:w-[392px] md:overflow-hidden md:rounded-[38px] md:border-[8px] md:border-foreground md:bg-foreground md:shadow-[0_30px_80px_rgba(0,0,0,0.28)]">
          <div className="flex min-h-dvh flex-col md:min-h-0 md:flex-1 md:overflow-hidden md:rounded-[30px]">{phone}</div>
        </div>
      </div>

      <ReviewerNotes state={state} onJump={(next) => setScreen(next)} onSimulate={() => dispatch({ type: "SIMULATE_OFFER" })} onReset={() => dispatch({ type: "RESET" })} />
    </div>
  );
}

function ReviewerNotes({ state, onJump, onSimulate, onReset }: { state: ReturnType<typeof initialDemoState>; onJump: (screen: Screen) => void; onSimulate: () => void; onReset: () => void }) {
  const run = activeJobs(state);
  const firstJob = run[0] ?? state.jobs[0];
  return (
    <aside className="hidden w-full max-w-[420px] flex-col gap-5 md:flex" aria-label="Prototype notes">
      <div>
        <p className="text-[11px] font-semibold tracking-[0.04em] text-muted-foreground">FRYBIRD IQ · Design prototype</p>
        <h1 className="mt-1 font-heading text-[26px] font-semibold leading-[1.15] tracking-[-0.015em]">Driver App</h1>
        <p className="mt-2 text-[13.5px] leading-[1.5] text-muted-foreground">
          The rider’s phone, end to end, on invented data. Nothing here touches real orders, riders, devices or locations. Walk the flow, then decide what the real dispatch, tracking and routing must do.
        </p>
      </div>

      <section className="rounded-xl border border-border bg-panel">
        <div className="px-5 pt-4 pb-3">
          <h2 className="font-heading text-sm font-semibold">Walk it through</h2>
        </div>
        <ol className="flex flex-col divide-y divide-border border-t border-border text-[13.5px]">
          <li className="flex items-center justify-between gap-3 px-5 py-2.5">
            <span>1. Accept the offered job (45 s countdown)</span>
            <button type="button" onClick={() => onJump({ kind: "tab", tab: "jobs" })} className="shrink-0 text-[12.5px] font-semibold underline-offset-4 hover:underline">
              Jobs
            </button>
          </li>
          <li className="flex items-center justify-between gap-3 px-5 py-2.5">
            <span>2. Open a stop, check the bag, pick up</span>
            {firstJob && (
              <button type="button" onClick={() => onJump({ kind: "job", id: firstJob.id, from: "jobs" })} className="shrink-0 text-[12.5px] font-semibold underline-offset-4 hover:underline">
                #{firstJob.orderNumber}
              </button>
            )}
          </li>
          <li className="flex items-center justify-between gap-3 px-5 py-2.5">
            <span>3. Navigate, arrive, deliver with cash and the code</span>
            <span className="text-[12.5px] text-muted-foreground">on the stop</span>
          </li>
          <li className="flex items-center justify-between gap-3 px-5 py-2.5">
            <span>4. Try “Couldn’t deliver”</span>
            <span className="text-[12.5px] text-muted-foreground">on the stop</span>
          </li>
          <li className="flex items-center justify-between gap-3 px-5 py-2.5">
            <span>5. See the run on the map</span>
            <button type="button" onClick={() => onJump({ kind: "tab", tab: "map" })} className="shrink-0 text-[12.5px] font-semibold underline-offset-4 hover:underline">
              Map
            </button>
          </li>
          <li className="flex items-center justify-between gap-3 px-5 py-2.5">
            <span>6. End the shift and hand in cash</span>
            <button type="button" onClick={() => onJump({ kind: "tab", tab: "shift" })} className="shrink-0 text-[12.5px] font-semibold underline-offset-4 hover:underline">
              Shift
            </button>
          </li>
        </ol>
        <div className="flex flex-wrap gap-2 border-t border-border px-5 py-3">
          <button type="button" onClick={onSimulate} disabled={state.pending.length === 0} className="inline-flex h-9 items-center rounded-md bg-inverse px-3 text-[13px] font-semibold text-inverse-foreground transition-colors duration-[120ms] hover:bg-inverse/85 disabled:opacity-50">
            Simulate a new job{state.pending.length > 0 ? ` (${state.pending.length} left)` : ""}
          </button>
          <button type="button" onClick={onReset} className="inline-flex h-9 items-center rounded-md border border-border bg-panel px-3 text-[13px] font-semibold transition-colors duration-[120ms] hover:border-border-strong">
            Reset demo
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-panel">
        <div className="px-5 pt-4 pb-3">
          <h2 className="font-heading text-sm font-semibold">How it maps to the order lifecycle</h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">The server already has these statuses. The prototype adds the moments in between that only the rider sees.</p>
        </div>
        <table className="w-full border-t border-border text-[13px]">
          <tbody className="divide-y divide-border">
            <tr><td className="px-5 py-2 font-medium">Offer · Accept</td><td className="px-5 py-2 text-muted-foreground">Order is READY, assigned to a rider (new)</td></tr>
            <tr><td className="px-5 py-2 font-medium">Picked up</td><td className="px-5 py-2 text-muted-foreground">READY → OUT_FOR_DELIVERY</td></tr>
            <tr><td className="px-5 py-2 font-medium">On the way · At the door</td><td className="px-5 py-2 text-muted-foreground">Rider-side only (new)</td></tr>
            <tr><td className="px-5 py-2 font-medium">Delivered</td><td className="px-5 py-2 text-muted-foreground">OUT_FOR_DELIVERY → COMPLETED, cash recorded against the rider</td></tr>
            <tr><td className="px-5 py-2 font-medium">Couldn’t deliver</td><td className="px-5 py-2 text-muted-foreground">OUT_FOR_DELIVERY → FAILED, with a reason</td></tr>
            <tr><td className="px-5 py-2 font-medium">Hand in cash</td><td className="px-5 py-2 text-muted-foreground">Counter confirms; closes the shift (new)</td></tr>
          </tbody>
        </table>
      </section>

      <section className="rounded-xl border border-border bg-panel">
        <div className="px-5 pt-4 pb-3">
          <h2 className="font-heading text-sm font-semibold">Decisions to make before the real build</h2>
        </div>
        <ul className="flex flex-col divide-y divide-border border-t border-border text-[13.5px]">
          <li className="px-5 py-2.5">Does the counter assign a rider, or do riders accept offers? The prototype shows offers with a countdown.</li>
          <li className="px-5 py-2.5">Is a customer delivery code required, optional, or not used? The prototype makes it optional.</li>
          <li className="px-5 py-2.5">Is a doorstep photo wanted for every delivery, only for cash, or never?</li>
          <li className="px-5 py-2.5">Should stops be re-ordered automatically by distance, or always in the order the kitchen finished them?</li>
          <li className="px-5 py-2.5">Who confirms the cash handover, and does that close the shift?</li>
          <li className="px-5 py-2.5">Does the customer see the rider’s live position, or only “on the way” and a call button?</li>
        </ul>
      </section>

      <p className="text-[12.5px] text-muted-foreground">
        Prototype only. <Link href="/app/deliveries" className="font-semibold underline-offset-4 hover:underline">Today’s real Deliveries screen</Link> is unchanged.
      </p>
    </aside>
  );
}
