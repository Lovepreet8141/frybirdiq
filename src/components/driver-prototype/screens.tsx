"use client";

import { useEffect, useState } from "react";
import { Bike, Camera, Check, ExternalLink, MapPin, Phone, RotateCcw, Sparkles, Store, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatINR, paise } from "@/lib/money";
import { formatDistance } from "@/lib/delivery";
import { EmptyState } from "@/components/states";
import { DEMO_OTP, FAIL_REASONS, type CompletedDemoJob, type DemoJob, type DriverDemoAction, type DriverDemoState, activeJobs, cashInHand, demoClock, distanceToday, offeredJobs } from "./demo";
import { BigButton, Card, Dot, Label, Money, Sheet, StatusWord, StepBar, Toggle, TopBar } from "./ui";

type Dispatch = (action: DriverDemoAction) => void;

const STEPS = ["Accepted", "Picked up", "On the way", "At the door", "Done"] as const;

function stepIndex(state: DemoJob["state"]): number {
  switch (state) {
    case "ACCEPTED":
      return 1;
    case "PICKED_UP":
      return 2;
    case "ARRIVED":
      return 3;
    case "DELIVERED":
    case "FAILED":
      return 4;
    default:
      return 0;
  }
}

function stateWord(job: DemoJob) {
  switch (job.state) {
    case "OFFERED":
      return <StatusWord tone="flag">New offer</StatusWord>;
    case "ACCEPTED":
      return <StatusWord tone="neutral">Collect at store</StatusWord>;
    case "PICKED_UP":
      return <StatusWord tone="gain">On the way</StatusWord>;
    case "ARRIVED":
      return <StatusWord tone="gain">At the door</StatusWord>;
    case "DELIVERED":
      return <StatusWord tone="gain">Delivered</StatusWord>;
    case "FAILED":
      return <StatusWord tone="loss">Not delivered</StatusWord>;
    case "DECLINED":
      return <StatusWord tone="neutral">Declined</StatusWord>;
  }
}

function PayLine({ job, className }: { job: DemoJob; className?: string }) {
  return job.paidOnline ? <StatusWord tone="gain" className={className}>Paid online</StatusWord> : <StatusWord tone="flag" className={className}>Collect cash</StatusWord>;
}

/* ------------------------------------------------------------------ Jobs */

export function JobsScreen({ state, dispatch, onOpenJob, onToast }: { state: DriverDemoState; dispatch: Dispatch; onOpenJob: (id: string) => void; onToast: (message: string) => void }) {
  const offers = offeredJobs(state);
  const run = activeJobs(state);

  return (
    <div className="flex flex-1 flex-col">
      <TopBar
        title={`Hi, ${state.driver.name.split(" ")[0]}`}
        subtitle={state.online ? `${run.length} on your run · ${state.completed.length} done today` : "You’re offline — no new jobs"}
        right={
          <div className="flex items-center gap-2 pr-1">
            <span className={cn("text-[12.5px] font-semibold", state.online ? "text-gain" : "text-muted-foreground")}>{state.online ? "Online" : "Offline"}</span>
            <Toggle checked={state.online} onChange={(online) => dispatch({ type: "SET_ONLINE", online })} label="Online" />
          </div>
        }
      />

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pt-4 pb-6">
        {state.shiftEnded && (
          <p className="rounded-lg border-l-2 border-flag bg-flag-soft/60 px-4 py-3 text-[13.5px]">Shift ended. Hand the cash to the counter. Reset the demo from Profile to start again.</p>
        )}

        {!state.online && offers.length === 0 && run.length === 0 && (
          <EmptyState title="You’re offline." detail="Go online to receive delivery jobs from the counter." />
        )}

        {offers.map((job) => (
          <OfferCard key={job.id} job={job} online={state.online} dispatch={dispatch} onToast={onToast} />
        ))}

        {run.length > 0 && (
          <section className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
              <Label>Your run</Label>
              <span className="text-[12px] text-muted-foreground">In the order you’ll go</span>
            </div>
            {run.map((job, index) => (
              <Card key={job.id} onClick={() => onOpenJob(job.id)} className="px-4 py-3.5">
                <div className="flex items-start gap-3">
                  <span className="tabular flex size-8 shrink-0 items-center justify-center rounded-full bg-inverse text-[13px] font-semibold text-inverse-foreground">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-[15px] font-semibold">
                        #{job.orderNumber} <span className="font-medium text-muted-foreground">· {job.customerName}</span>
                      </p>
                      <span className="tabular shrink-0 text-[13px] text-muted-foreground">{formatDistance(job.distanceMetres)}</span>
                    </div>
                    <p className="truncate text-[13.5px] text-muted-foreground">{job.address.line1}</p>
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      {stateWord(job)}
                      <span className="tabular text-[14px] font-semibold">{formatINR(job.total)}</span>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </section>
        )}

        {state.online && offers.length === 0 && run.length === 0 && !state.shiftEnded && (
          <EmptyState title="Nothing to deliver right now." detail="You’ll hear a chime and see the job here the moment the kitchen has one ready." />
        )}

        {state.completed.length > 0 && (
          <section className="flex flex-col gap-2">
            <Label>Done today</Label>
            <Card className="divide-y divide-border">
              {state.completed
                .slice()
                .reverse()
                .slice(0, 3)
                .map((job) => (
                  <CompletedRow key={job.id} job={job} />
                ))}
            </Card>
          </section>
        )}
      </div>
    </div>
  );
}

function OfferCard({ job, online, dispatch, onToast }: { job: DemoJob; online: boolean; dispatch: Dispatch; onToast: (message: string) => void }) {
  const [secondsLeft, setSecondsLeft] = useState(45);
  useEffect(() => {
    if (!online) return;
    const timer = setInterval(() => setSecondsLeft((value) => (value > 0 ? value - 1 : 0)), 1000);
    return () => clearInterval(timer);
  }, [online]);
  useEffect(() => {
    if (secondsLeft === 0) {
      dispatch({ type: "DECLINE", id: job.id });
      onToast(`Offer #${job.orderNumber} timed out — it goes back to the counter.`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once when the countdown hits zero
  }, [secondsLeft]);

  return (
    <Card className="overflow-hidden border-inverse">
      <div className="flex items-center justify-between bg-inverse px-4 py-2 text-inverse-foreground">
        <span className="flex items-center gap-2 text-[13px] font-semibold">
          <Sparkles className="size-4" aria-hidden="true" />
          New delivery
        </span>
        <span className="tabular text-[13px]">{online ? `${secondsLeft}s to accept` : "Offline"}</span>
      </div>
      <div className="flex flex-col gap-3 px-4 pt-3 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[16px] font-semibold">#{job.orderNumber}</p>
            <p className="truncate text-[14px] text-muted-foreground">{job.address.line1}</p>
            <p className="tabular mt-0.5 text-[13px] text-muted-foreground">
              {formatDistance(job.distanceMetres)} · about {job.etaMinutes} min
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Money amount={formatINR(job.total)} size="sm" />
            <PayLine job={job} />
          </div>
        </div>
        <p className="text-[13px] text-muted-foreground">
          {job.items.reduce((sum, item) => sum + item.quantity, 0)} items · ready {job.readyAt}
        </p>
        <div className="grid grid-cols-[1fr_2fr] gap-2">
          <BigButton tone="outline" onClick={() => dispatch({ type: "DECLINE", id: job.id })}>
            Decline
          </BigButton>
          <BigButton tone="primary" disabled={!online} onClick={() => dispatch({ type: "ACCEPT", id: job.id })}>
            <Check className="size-5" aria-hidden="true" />
            Accept
          </BigButton>
        </div>
      </div>
    </Card>
  );
}

function CompletedRow({ job }: { job: CompletedDemoJob }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Dot tone={job.outcome === "DELIVERED" ? "gain" : "loss"} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-semibold">
          #{job.orderNumber} <span className="font-medium text-muted-foreground">· {job.customerName}</span>
        </p>
        <p className="truncate text-[12.5px] text-muted-foreground">
          {job.deliveredAt} · {job.line1}
        </p>
      </div>
      <div className="flex flex-col items-end">
        <span className="tabular text-[14px] font-semibold">{formatINR(job.total)}</span>
        <span className="text-[11.5px] text-muted-foreground">{job.outcome === "FAILED" ? "Not delivered" : job.cashCollected > 0n ? "Cash taken" : "Paid online"}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- Job */

export function JobScreen({ job, store, dispatch, onBack, onToast }: { job: DemoJob; store: DriverDemoState["store"]; dispatch: Dispatch; onBack: () => void; onToast: (message: string) => void }) {
  const [sheet, setSheet] = useState<"pickup" | "deliver" | "fail" | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<number>>(() => new Set());
  const [otp, setOtp] = useState("");
  const [cashTaken, setCashTaken] = useState(!job.paidOnline);
  const [failReason, setFailReason] = useState<string>(FAIL_REASONS[0]);
  const closed = job.state === "DELIVERED" || job.state === "FAILED" || job.state === "DECLINED";
  const allPicked = picked.size === job.items.length;
  const mapsHref = `https://www.google.com/maps/dir/?api=1&origin=${store.lat},${store.lng}&destination=${job.address.lat},${job.address.lng}`;

  function togglePicked(index: number) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  const primary = (() => {
    switch (job.state) {
      case "OFFERED":
        return (
          <BigButton tone="primary" onClick={() => dispatch({ type: "ACCEPT", id: job.id })}>
            <Check className="size-5" aria-hidden="true" />
            Accept this delivery
          </BigButton>
        );
      case "ACCEPTED":
        return (
          <BigButton tone="primary" onClick={() => setSheet("pickup")}>
            <Store className="size-5" aria-hidden="true" />
            Picked up from store
          </BigButton>
        );
      case "PICKED_UP":
        return (
          <BigButton tone="primary" onClick={() => dispatch({ type: "ARRIVE", id: job.id })}>
            <MapPin className="size-5" aria-hidden="true" />
            I’ve arrived
          </BigButton>
        );
      case "ARRIVED":
        return (
          <BigButton tone="primary" onClick={() => setSheet("deliver")}>
            <Check className="size-5" aria-hidden="true" />
            {job.paidOnline ? "Delivered" : `Delivered · took ${formatINR(job.total)}`}
          </BigButton>
        );
      default:
        return null;
    }
  })();

  return (
    <div className="relative flex flex-1 flex-col">
      <TopBar title={`#${job.orderNumber}`} subtitle={job.customerName} onBack={onBack} right={<span className="pr-2">{stateWord(job)}</span>} />

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pt-4 pb-4">
        {!closed && <StepBar steps={STEPS} current={stepIndex(job.state)} />}

        {/* The money is the hero: what the door is worth and whether cash changes hands. */}
        <div className="flex items-end justify-between gap-3">
          <div>
            <Label>{job.paidOnline ? "Order value" : "Collect at the door"}</Label>
            <Money amount={formatINR(job.total)} size="lg" className="mt-1 block" />
          </div>
          <PayLine job={job} className="mb-1 text-[13.5px]" />
        </div>

        <Card className="gap-3 px-4 py-4">
          <div className="flex items-start gap-3">
            <MapPin className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-[16px] font-semibold leading-snug">{job.address.line1}</p>
              <p className="text-[13.5px] text-muted-foreground">{job.address.landmark}</p>
              <p className="tabular mt-1 text-[13px] text-muted-foreground">
                {formatDistance(job.distanceMetres)} from the store · about {job.etaMinutes} min
              </p>
            </div>
          </div>
          <div className="grid grid-cols-[2fr_1fr] gap-2">
            <a
              href={mapsHref}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-[48px] touch-manipulation items-center justify-center gap-2 rounded-lg bg-inverse px-3 text-[15px] font-semibold text-inverse-foreground transition-colors duration-[120ms] hover:bg-inverse/85"
            >
              <ExternalLink className="size-4" aria-hidden="true" />
              Navigate
            </a>
            <BigButton tone="outline" className="min-h-[48px] rounded-lg text-[15px]" onClick={() => onToast(`Demo: a real app would call ${job.customerName} on ${job.customerPhone}.`)}>
              <Phone className="size-4" aria-hidden="true" />
              Call
            </BigButton>
          </div>
        </Card>

        <Card className="px-4 py-3.5">
          <Label className="mb-2">Bag check</Label>
          <ul className="flex flex-col gap-1.5">
            {job.items.map((item, index) => (
              <li key={index} className="flex items-baseline gap-2 text-[15px]">
                <span className="tabular w-7 shrink-0 font-semibold">{item.quantity}×</span>
                <span className="min-w-0 flex-1">
                  {item.name}
                  {item.modifiers.length > 0 && <span className="text-muted-foreground"> · {item.modifiers.join(", ")}</span>}
                </span>
              </li>
            ))}
          </ul>
        </Card>

        {job.notes && (
          <div className="rounded-lg border-l-2 border-flag bg-flag-soft/60 px-4 py-3 text-[14px]">
            <Label className="mb-0.5">Customer note</Label>
            {job.notes}
          </div>
        )}

        {job.state === "FAILED" && (
          <div className="rounded-lg border-l-2 border-loss bg-loss-soft/60 px-4 py-3 text-[14px]">
            <Label className="mb-0.5">Not delivered · {job.deliveredAt}</Label>
            {job.failReason}. The counter has been told and will call the customer.
          </div>
        )}
        {job.state === "DELIVERED" && (
          <div className="rounded-lg border-l-2 border-gain bg-gain-soft/60 px-4 py-3 text-[14px]">
            <Label className="mb-0.5">Delivered · {job.deliveredAt}</Label>
            {job.cashCollected && job.cashCollected > 0n ? `${formatINR(job.cashCollected)} cash taken. Hand it in at the end of the shift.` : "Nothing to collect — paid online."}
          </div>
        )}
      </div>

      {!closed && (
        <div className="flex shrink-0 flex-col gap-1.5 border-t border-border bg-panel px-4 pt-3 pb-[max(env(safe-area-inset-bottom),12px)]">
          {primary}
          {(job.state === "PICKED_UP" || job.state === "ARRIVED") && (
            <BigButton tone="quiet" onClick={() => setSheet("fail")}>
              Couldn’t deliver
            </BigButton>
          )}
          {job.state === "OFFERED" && (
            <BigButton tone="quiet" onClick={() => dispatch({ type: "DECLINE", id: job.id })}>
              Decline
            </BigButton>
          )}
        </div>
      )}

      {/* Pick-up: tick every line before leaving the counter. A missed item is the most common complaint a delivery gets. */}
      <Sheet open={sheet === "pickup"} onClose={() => setSheet(null)} title="Check the bag">
        <p className="text-[13.5px] text-muted-foreground">Tick each item as you pack it. The counter sees this order as picked up once you confirm.</p>
        <ul className="flex flex-col gap-1.5">
          {job.items.map((item, index) => {
            const on = picked.has(index);
            return (
              <li key={index}>
                <button type="button" onClick={() => togglePicked(index)} aria-pressed={on} className={cn("flex min-h-[52px] w-full touch-manipulation items-center gap-3 rounded-lg border px-3 text-left text-[15px] transition-colors duration-[120ms]", on ? "border-gain bg-gain-soft/60" : "border-border bg-panel active:bg-surface-muted")}>
                  <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-md border", on ? "border-gain bg-gain text-white" : "border-border-strong")} aria-hidden="true">
                    {on && <Check className="size-4" />}
                  </span>
                  <span className="tabular w-7 shrink-0 font-semibold">{item.quantity}×</span>
                  <span className="min-w-0 flex-1">{item.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <BigButton
          tone="primary"
          disabled={!allPicked}
          onClick={() => {
            dispatch({ type: "PICK_UP", id: job.id });
            setSheet(null);
          }}
        >
          {allPicked ? "Picked up, heading out" : `${job.items.length - picked.size} left to check`}
        </BigButton>
      </Sheet>

      {/* Delivered: cash and the handover are one event at the door (see delivery-card.tsx). */}
      <Sheet open={sheet === "deliver"} onClose={() => setSheet(null)} title="Confirm delivery">
        {!job.paidOnline && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3">
            <div>
              <p className="text-[15px] font-semibold">Cash collected</p>
              <p className="tabular text-[13px] text-muted-foreground">{formatINR(job.total)} due</p>
            </div>
            <Toggle checked={cashTaken} onChange={setCashTaken} label="Cash collected" />
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="demo-otp" className="text-[13px] font-semibold">
            Customer’s delivery code
          </label>
          <input
            id="demo-otp"
            inputMode="numeric"
            maxLength={4}
            value={otp}
            onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder="4 digits"
            className="tabular h-14 w-full rounded-lg border border-border bg-panel px-4 text-center font-money text-[28px] tracking-[0.3em] outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20"
          />
          <p className="text-[12.5px] text-muted-foreground">
            Demo code is <span className="tabular font-semibold">{DEMO_OTP}</span>. Whether a code is required at all is a review question.
          </p>
        </div>
        <BigButton tone="outline" className="min-h-[48px] rounded-lg text-[15px]" onClick={() => onToast("Demo: a real app would open the camera for a doorstep photo.")}>
          <Camera className="size-4" aria-hidden="true" />
          Add a doorstep photo
        </BigButton>
        <BigButton
          tone="primary"
          disabled={otp.length > 0 && otp !== DEMO_OTP}
          onClick={() => {
            dispatch({ type: "DELIVER", id: job.id, cashCollected: !job.paidOnline && cashTaken ? job.total : paise(0), at: demoClock(new Date()) });
            setSheet(null);
          }}
        >
          <Check className="size-5" aria-hidden="true" />
          {otp.length === 4 ? "Delivered" : "Delivered without a code"}
        </BigButton>
        {otp.length > 0 && otp !== DEMO_OTP && <p className="text-center text-[13px] text-loss">That code doesn’t match.</p>}
      </Sheet>

      {/* Couldn’t deliver: one reason, then the counter takes over. Maps to FAILED. */}
      <Sheet open={sheet === "fail"} onClose={() => setSheet(null)} title="Couldn’t deliver">
        <p className="text-[13.5px] text-muted-foreground">Pick what happened. The counter gets it straight away and decides what to do with the food and the money.</p>
        <ul className="flex flex-col gap-1.5" role="radiogroup" aria-label="Reason">
          {FAIL_REASONS.map((reason) => {
            const on = failReason === reason;
            return (
              <li key={reason}>
                <button type="button" role="radio" aria-checked={on} onClick={() => setFailReason(reason)} className={cn("flex min-h-[48px] w-full touch-manipulation items-center gap-3 rounded-lg border px-3 text-left text-[15px] transition-colors duration-[120ms]", on ? "border-foreground bg-surface-muted" : "border-border bg-panel active:bg-surface-muted")}>
                  <span className={cn("size-4 shrink-0 rounded-full border-2", on ? "border-foreground bg-foreground" : "border-border-strong")} aria-hidden="true" />
                  {reason}
                </button>
              </li>
            );
          })}
        </ul>
        <BigButton
          tone="loss"
          onClick={() => {
            dispatch({ type: "FAIL", id: job.id, reason: failReason, at: demoClock(new Date()) });
            setSheet(null);
          }}
        >
          Mark as not delivered
        </BigButton>
      </Sheet>
    </div>
  );
}

/* ------------------------------------------------------------------- Map */

/**
 * An illustrative route sketch. There is no GPS, no tiles and no routing
 * in the prototype — this shows what the map screen is *for*: the store,
 * the stops in order, and where the rider is on that line.
 */
export function MapScreen({ state, onOpenJob }: { state: DriverDemoState; onOpenJob: (id: string) => void }) {
  const run = activeJobs(state);
  const points = [state.store, ...run.map((job) => job.address)];
  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);
  const pad = 0.004;
  const minLat = Math.min(...lats) - pad;
  const maxLat = Math.max(...lats) + pad;
  const minLng = Math.min(...lngs) - pad;
  const maxLng = Math.max(...lngs) + pad;
  const W = 360;
  const H = 300;
  const x = (lng: number) => ((lng - minLng) / (maxLng - minLng)) * W;
  const y = (lat: number) => H - ((lat - minLat) / (maxLat - minLat)) * H;
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${x(point.lng).toFixed(1)} ${y(point.lat).toFixed(1)}`).join(" ");
  const rider = run.find((job) => job.state === "PICKED_UP" || job.state === "ARRIVED");
  const riderPoint = rider ? (rider.state === "ARRIVED" ? rider.address : { lat: (state.store.lat + rider.address.lat) / 2, lng: (state.store.lng + rider.address.lng) / 2 }) : state.store;

  return (
    <div className="flex flex-1 flex-col">
      <TopBar title="Map" subtitle={run.length === 0 ? "No stops on your run" : `${run.length} ${run.length === 1 ? "stop" : "stops"} · illustrative`} />
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pt-4 pb-6">
        <div className="overflow-hidden rounded-xl border border-border bg-ramp-5/40">
          <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Sketch of the route from the store to each stop">
            <defs>
              <pattern id="demo-grid" width="24" height="24" patternUnits="userSpaceOnUse">
                <path d="M 24 0 L 0 0 0 24" fill="none" stroke="currentColor" strokeOpacity="0.08" />
              </pattern>
            </defs>
            <rect width={W} height={H} fill="url(#demo-grid)" className="text-foreground" />
            {run.length > 0 && <path d={path} fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="6 6" strokeLinecap="round" className="text-foreground/50" />}
            <g>
              <circle cx={x(state.store.lng)} cy={y(state.store.lat)} r="11" className="fill-primary" />
              <text x={x(state.store.lng)} y={y(state.store.lat) + 4} textAnchor="middle" className="fill-white text-[11px] font-bold">
                F
              </text>
            </g>
            {run.map((job, index) => (
              <g key={job.id}>
                <circle cx={x(job.address.lng)} cy={y(job.address.lat)} r="11" className={job.state === "ARRIVED" ? "fill-gain" : "fill-inverse"} />
                <text x={x(job.address.lng)} y={y(job.address.lat) + 4} textAnchor="middle" className="fill-white text-[11px] font-bold">
                  {index + 1}
                </text>
              </g>
            ))}
            <circle cx={x(riderPoint.lng)} cy={y(riderPoint.lat)} r="16" className="fill-gain/25" />
            <circle cx={x(riderPoint.lng)} cy={y(riderPoint.lat)} r="6" className="fill-gain stroke-white" strokeWidth="2" />
          </svg>
        </div>
        <p className="text-[12.5px] leading-[1.45] text-muted-foreground">
          Illustrative only. The real app would show live tiles, the rider’s GPS position and the road route. Whether stops are re-ordered automatically is a review question.
        </p>

        <section className="flex flex-col gap-2">
          <Label>Stops</Label>
          <Card className="divide-y divide-border">
            <div className="flex items-center gap-3 px-4 py-3">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-[12px] font-bold text-primary-foreground">F</span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold">{state.store.name}</p>
                <p className="truncate text-[12.5px] text-muted-foreground">{state.store.line1}</p>
              </div>
            </div>
            {run.map((job, index) => (
              <button key={job.id} type="button" onClick={() => onOpenJob(job.id)} className="flex w-full touch-manipulation items-center gap-3 px-4 py-3 text-left transition-colors duration-[120ms] active:bg-surface-muted">
                <span className={cn("tabular flex size-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white", job.state === "ARRIVED" ? "bg-gain" : "bg-inverse")}>{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold">
                    #{job.orderNumber} · {job.customerName}
                  </p>
                  <p className="truncate text-[12.5px] text-muted-foreground">{job.address.line1}</p>
                </div>
                <span className="tabular shrink-0 text-[13px] text-muted-foreground">{formatDistance(job.distanceMetres)}</span>
              </button>
            ))}
            {run.length === 0 && <p className="px-4 py-6 text-center text-[13.5px] text-muted-foreground">Accept a job and it appears here.</p>}
          </Card>
        </section>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- Shift */

export function ShiftScreen({ state, dispatch, onToast }: { state: DriverDemoState; dispatch: Dispatch; onToast: (message: string) => void }) {
  const [handover, setHandover] = useState(false);
  const cash = cashInHand(state);
  const delivered = state.completed.filter((job) => job.outcome === "DELIVERED");
  const onTime = delivered.filter((job) => job.onTime).length;
  const km = distanceToday(state);

  return (
    <div className="relative flex flex-1 flex-col">
      <TopBar title="Shift" subtitle={state.shiftEnded ? "Ended" : `Started ${state.shiftStartedAt}`} />
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pt-4 pb-6">
        <div className="grid grid-cols-2 gap-3">
          <Card className="px-4 py-3.5">
            <Label>Cash in hand</Label>
            <Money amount={formatINR(cash)} size="md" className="mt-1.5 block" />
            <p className="mt-1 text-[12px] text-muted-foreground">Hand in at the counter</p>
          </Card>
          <Card className="px-4 py-3.5">
            <Label>Delivered</Label>
            <p className="tabular mt-1.5 font-money text-[28px] leading-none">{delivered.length}</p>
            <p className="mt-1 text-[12px] text-muted-foreground">{state.completed.length - delivered.length} not delivered</p>
          </Card>
          <Card className="px-4 py-3.5">
            <Label>Distance</Label>
            <p className="tabular mt-1.5 font-money text-[28px] leading-none">{formatDistance(km)}</p>
            <p className="mt-1 text-[12px] text-muted-foreground">Store to door, added up</p>
          </Card>
          <Card className="px-4 py-3.5">
            <Label>On time</Label>
            <p className="tabular mt-1.5 font-money text-[28px] leading-none">{delivered.length === 0 ? "—" : `${onTime}/${delivered.length}`}</p>
            <p className="mt-1 text-[12px] text-muted-foreground">Against the promised time</p>
          </Card>
        </div>

        <section className="flex flex-col gap-2">
          <Label>Today</Label>
          <Card className="divide-y divide-border">
            {state.completed
              .slice()
              .reverse()
              .map((job) => (
                <CompletedRow key={job.id} job={job} />
              ))}
            {state.completed.length === 0 && <p className="px-4 py-6 text-center text-[13.5px] text-muted-foreground">Nothing delivered yet.</p>}
          </Card>
        </section>

        {!state.shiftEnded && (
          <BigButton tone="inverse" onClick={() => setHandover(true)}>
            <Wallet className="size-5" aria-hidden="true" />
            End shift and hand in cash
          </BigButton>
        )}
      </div>

      <Sheet open={handover} onClose={() => setHandover(false)} title="Hand in cash">
        <div className="flex flex-col items-center gap-1 py-2">
          <Label>Give the counter</Label>
          <Money amount={formatINR(cash)} size="lg" />
          <p className="text-[13px] text-muted-foreground">{delivered.filter((job) => job.cashCollected > 0n).length} cash deliveries</p>
        </div>
        <p className="text-[13.5px] text-muted-foreground">The counter confirms the amount on their screen. In the real app that confirmation is what closes your shift — you never mark it yourself.</p>
        <BigButton
          tone="primary"
          onClick={() => {
            dispatch({ type: "END_SHIFT" });
            setHandover(false);
            onToast("Demo: the counter would confirm the cash and close the shift.");
          }}
        >
          Counter has the cash
        </BigButton>
      </Sheet>
    </div>
  );
}

/* --------------------------------------------------------------- Profile */

export function ProfileScreen({ state, dispatch, onToast }: { state: DriverDemoState; dispatch: Dispatch; onToast: (message: string) => void }) {
  return (
    <div className="flex flex-1 flex-col">
      <TopBar title="Profile" />
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pt-4 pb-6">
        <Card className="flex-row items-center gap-3 px-4 py-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-secondary text-[16px] font-bold" aria-hidden="true">
            {state.driver.name.charAt(0)}
          </span>
          <div className="min-w-0">
            <p className="text-[16px] font-semibold">{state.driver.name}</p>
            <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <Bike className="size-3.5" aria-hidden="true" />
              {state.driver.vehicle}
            </p>
          </div>
        </Card>

        <Card className="divide-y divide-border">
          <div className="flex items-center justify-between gap-3 px-4 py-3.5">
            <div>
              <p className="text-[15px] font-semibold">New job chime</p>
              <p className="text-[12.5px] text-muted-foreground">Sound when an offer arrives</p>
            </div>
            <Toggle checked={state.sound} onChange={(sound) => dispatch({ type: "SET_SOUND", sound })} label="New job chime" />
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-3.5">
            <div>
              <p className="text-[15px] font-semibold">Online</p>
              <p className="text-[12.5px] text-muted-foreground">Receive delivery jobs</p>
            </div>
            <Toggle checked={state.online} onChange={(online) => dispatch({ type: "SET_ONLINE", online })} label="Online" />
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-3.5">
            <div>
              <p className="text-[15px] font-semibold">Phone</p>
              <p className="tabular text-[12.5px] text-muted-foreground">{state.driver.phone}</p>
            </div>
            <span className="text-[12.5px] text-muted-foreground">Demo</span>
          </div>
        </Card>

        <section className="flex flex-col gap-2">
          <Label>Prototype controls</Label>
          <Card className="divide-y divide-border">
            <button type="button" onClick={() => (state.pending.length > 0 ? dispatch({ type: "SIMULATE_OFFER" }) : onToast("No more demo jobs to offer. Reset the demo to start again."))} className="flex min-h-[52px] w-full touch-manipulation items-center gap-3 px-4 text-left text-[15px] font-semibold transition-colors duration-[120ms] active:bg-surface-muted">
              <Sparkles className="size-4 text-muted-foreground" aria-hidden="true" />
              Simulate a new job
              <span className="tabular ml-auto text-[12.5px] font-normal text-muted-foreground">{state.pending.length} left</span>
            </button>
            <button type="button" onClick={() => dispatch({ type: "RESET" })} className="flex min-h-[52px] w-full touch-manipulation items-center gap-3 px-4 text-left text-[15px] font-semibold transition-colors duration-[120ms] active:bg-surface-muted">
              <RotateCcw className="size-4 text-muted-foreground" aria-hidden="true" />
              Reset the demo
            </button>
          </Card>
          <p className="text-[12.5px] leading-[1.45] text-muted-foreground">Everything on this phone is invented. Nothing here reads or writes real orders, drivers, devices or locations.</p>
        </section>
      </div>
    </div>
  );
}
