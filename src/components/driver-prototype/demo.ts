/**
 * FRYBIRD Driver App — PROTOTYPE fixtures and state.
 *
 * Everything in this folder is a design prototype: the data is invented,
 * lives in component state, and never reaches a repository, a Server
 * Action, Supabase, GPS or a real phone dialler. Its job is to let the
 * driver experience be reviewed before dispatch, tracking and routing are
 * designed for real. Nothing here may be imported by production code.
 *
 * The job states below are the driver's view of the order lifecycle in
 * `src/domain/order-status.ts`: accepting and picking up a READY order is
 * the READY → OUT_FOR_DELIVERY step, "Delivered" is COMPLETED and
 * "Couldn't deliver" is FAILED. The prototype adds the in-between moments a
 * rider actually lives through (heading to the store, on the way, at the
 * door) which the server does not record today.
 */

import { type Paise, paise } from "@/lib/money";

export type JobState = "OFFERED" | "DECLINED" | "ACCEPTED" | "PICKED_UP" | "ARRIVED" | "DELIVERED" | "FAILED";

export interface DemoItem {
  readonly name: string;
  readonly quantity: number;
  readonly modifiers: readonly string[];
}

export interface DemoJob {
  readonly id: string;
  readonly orderNumber: string;
  readonly customerName: string;
  /** A clearly fake number — the prototype never dials it. */
  readonly customerPhone: string;
  readonly address: { readonly line1: string; readonly landmark: string; readonly lat: number; readonly lng: number };
  readonly distanceMetres: number;
  readonly etaMinutes: number;
  readonly total: Paise;
  readonly paidOnline: boolean;
  readonly items: readonly DemoItem[];
  readonly notes: string | null;
  /** "7:42 pm" — fixed strings so the server and the browser render the same thing. */
  readonly readyAt: string;
  readonly state: JobState;
  /** Set as the prototype moves the job along; shown on the shift list. */
  readonly deliveredAt?: string;
  readonly cashCollected?: Paise;
  readonly failReason?: string;
}

export interface CompletedDemoJob {
  readonly id: string;
  readonly orderNumber: string;
  readonly customerName: string;
  readonly line1: string;
  readonly total: Paise;
  readonly cashCollected: Paise;
  readonly distanceMetres: number;
  readonly deliveredAt: string;
  readonly onTime: boolean;
  readonly outcome: "DELIVERED" | "FAILED";
}

export interface DriverDemoState {
  readonly online: boolean;
  readonly driver: { readonly name: string; readonly vehicle: string; readonly phone: string };
  readonly store: { readonly name: string; readonly line1: string; readonly lat: number; readonly lng: number };
  readonly jobs: readonly DemoJob[];
  readonly completed: readonly CompletedDemoJob[];
  /** Jobs the reviewer can inject with "Simulate a new job", in order. */
  readonly pending: readonly DemoJob[];
  readonly shiftStartedAt: string;
  readonly shiftEnded: boolean;
  readonly sound: boolean;
}

export const FAIL_REASONS = ["Customer not reachable", "Wrong address", "Customer refused the order", "Cash not available", "Other"] as const;

/** Demo OTP the customer "has" — printed on the confirm sheet so a reviewer can try it. */
export const DEMO_OTP = "4821";

const STORE = { name: "FRYBIRD", line1: "Sector 9 Market, Ambala City", lat: 30.3782, lng: 76.7767 } as const;

const JOB_1: DemoJob = {
  id: "demo-1042",
  orderNumber: "1042",
  customerName: "Priya Sharma",
  customerPhone: "+91 00000 01042",
  address: { line1: "House 214, Sector 10", landmark: "Opposite the park gate, blue door", lat: 30.3712, lng: 76.7841 },
  distanceMetres: 1_800,
  etaMinutes: 7,
  total: paise(48_900),
  paidOnline: false,
  items: [
    { name: "OG Frybird Burger", quantity: 2, modifiers: ["Medium heat"] },
    { name: "Peri Peri Fries", quantity: 1, modifiers: [] },
    { name: "Cold Coffee", quantity: 1, modifiers: ["Less ice"] },
  ],
  notes: "Ring the bell twice. Dog in the yard is friendly.",
  readyAt: "7:42 pm",
  state: "OFFERED",
};

const JOB_2: DemoJob = {
  id: "demo-1039",
  orderNumber: "1039",
  customerName: "Rohan Verma",
  customerPhone: "+91 00000 01039",
  address: { line1: "Flat 3B, Model Town", landmark: "Lift on the left, third floor", lat: 30.3844, lng: 76.7702 },
  distanceMetres: 2_600,
  etaMinutes: 10,
  total: paise(124_700),
  paidOnline: true,
  items: [
    { name: "Family Bucket (12 pc)", quantity: 1, modifiers: ["Extra hot"] },
    { name: "Coleslaw", quantity: 2, modifiers: [] },
    { name: "Pepsi 750 ml", quantity: 1, modifiers: [] },
  ],
  notes: null,
  readyAt: "7:38 pm",
  state: "ACCEPTED",
};

const JOB_3: DemoJob = {
  id: "demo-1041",
  orderNumber: "1041",
  customerName: "Anita Kaur",
  customerPhone: "+91 00000 01041",
  address: { line1: "Shop 7, Sector 7 Market", landmark: "Next to the pharmacy", lat: 30.3751, lng: 76.7699 },
  distanceMetres: 1_100,
  etaMinutes: 5,
  total: paise(32_900),
  paidOnline: false,
  items: [
    { name: "Zinger Wrap", quantity: 1, modifiers: [] },
    { name: "Chicken Popcorn", quantity: 1, modifiers: ["Regular"] },
  ],
  notes: "Call on arrival, shop counter.",
  readyAt: "7:45 pm",
  state: "ACCEPTED",
};

const JOB_4: DemoJob = {
  id: "demo-1044",
  orderNumber: "1044",
  customerName: "Sameer Khan",
  customerPhone: "+91 00000 01044",
  address: { line1: "House 88, Prem Nagar", landmark: "Behind the school", lat: 30.3699, lng: 76.7735 },
  distanceMetres: 2_200,
  etaMinutes: 9,
  total: paise(75_800),
  paidOnline: false,
  items: [
    { name: "OG Frybird Burger", quantity: 3, modifiers: [] },
    { name: "Peri Peri Fries", quantity: 2, modifiers: [] },
  ],
  notes: null,
  readyAt: "7:58 pm",
  state: "OFFERED",
};

const JOB_5: DemoJob = {
  id: "demo-1045",
  orderNumber: "1045",
  customerName: "Meera Joshi",
  customerPhone: "+91 00000 01045",
  address: { line1: "Flat 12, Green Enclave", landmark: "Gate 2, tell the guard FRYBIRD", lat: 30.3867, lng: 76.7823 },
  distanceMetres: 3_100,
  etaMinutes: 12,
  total: paise(56_400),
  paidOnline: true,
  items: [{ name: "Hot Wings (8 pc)", quantity: 2, modifiers: ["Honey glaze"] }],
  notes: null,
  readyAt: "8:06 pm",
  state: "OFFERED",
};

const COMPLETED: readonly CompletedDemoJob[] = [
  { id: "demo-1031", orderNumber: "1031", customerName: "Karan Mehta", line1: "House 12, Sector 8", total: paise(41_800), cashCollected: paise(41_800), distanceMetres: 1_400, deliveredAt: "6:12 pm", onTime: true, outcome: "DELIVERED" },
  { id: "demo-1033", orderNumber: "1033", customerName: "Neha Gupta", line1: "Flat 7, Sector 9", total: paise(89_000), cashCollected: paise(0), distanceMetres: 900, deliveredAt: "6:31 pm", onTime: true, outcome: "DELIVERED" },
  { id: "demo-1034", orderNumber: "1034", customerName: "Vikram Singh", line1: "House 3, Model Town", total: paise(63_500), cashCollected: paise(63_500), distanceMetres: 2_500, deliveredAt: "6:58 pm", onTime: false, outcome: "DELIVERED" },
  { id: "demo-1036", orderNumber: "1036", customerName: "Aarti Bansal", line1: "Shop 2, Sector 7", total: paise(27_900), cashCollected: paise(0), distanceMetres: 1_200, deliveredAt: "7:14 pm", onTime: true, outcome: "DELIVERED" },
  { id: "demo-1037", orderNumber: "1037", customerName: "Deepak Rao", line1: "House 41, Prem Nagar", total: paise(80_700), cashCollected: paise(80_700), distanceMetres: 2_300, deliveredAt: "7:29 pm", onTime: true, outcome: "DELIVERED" },
];

export function initialDemoState(): DriverDemoState {
  return {
    online: true,
    driver: { name: "Demo Rider", vehicle: "Scooter · HR 01 DEMO", phone: "+91 00000 00000" },
    store: STORE,
    jobs: [JOB_1, JOB_2, JOB_3],
    completed: COMPLETED,
    pending: [JOB_4, JOB_5],
    shiftStartedAt: "5:30 pm",
    shiftEnded: false,
    sound: true,
  };
}

export type DriverDemoAction =
  | { type: "SET_ONLINE"; online: boolean }
  | { type: "SET_SOUND"; sound: boolean }
  | { type: "ACCEPT"; id: string }
  | { type: "DECLINE"; id: string }
  | { type: "PICK_UP"; id: string }
  | { type: "ARRIVE"; id: string }
  | { type: "DELIVER"; id: string; cashCollected: Paise; at: string }
  | { type: "FAIL"; id: string; reason: string; at: string }
  | { type: "SIMULATE_OFFER" }
  | { type: "END_SHIFT" }
  | { type: "RESET" };

function updateJob(jobs: readonly DemoJob[], id: string, patch: Partial<DemoJob>): readonly DemoJob[] {
  return jobs.map((job) => (job.id === id ? { ...job, ...patch } : job));
}

export function driverDemoReducer(state: DriverDemoState, action: DriverDemoAction): DriverDemoState {
  switch (action.type) {
    case "SET_ONLINE":
      return { ...state, online: action.online };
    case "SET_SOUND":
      return { ...state, sound: action.sound };
    case "ACCEPT":
      return { ...state, jobs: updateJob(state.jobs, action.id, { state: "ACCEPTED" }) };
    case "DECLINE":
      return { ...state, jobs: updateJob(state.jobs, action.id, { state: "DECLINED" }) };
    case "PICK_UP":
      return { ...state, jobs: updateJob(state.jobs, action.id, { state: "PICKED_UP" }) };
    case "ARRIVE":
      return { ...state, jobs: updateJob(state.jobs, action.id, { state: "ARRIVED" }) };
    case "DELIVER": {
      const job = state.jobs.find((entry) => entry.id === action.id);
      if (!job) return state;
      const done: CompletedDemoJob = {
        id: job.id,
        orderNumber: job.orderNumber,
        customerName: job.customerName,
        line1: job.address.line1,
        total: job.total,
        cashCollected: action.cashCollected,
        distanceMetres: job.distanceMetres,
        deliveredAt: action.at,
        onTime: true,
        outcome: "DELIVERED",
      };
      return {
        ...state,
        jobs: updateJob(state.jobs, action.id, { state: "DELIVERED", deliveredAt: action.at, cashCollected: action.cashCollected }),
        completed: [...state.completed, done],
      };
    }
    case "FAIL": {
      const job = state.jobs.find((entry) => entry.id === action.id);
      if (!job) return state;
      const done: CompletedDemoJob = {
        id: job.id,
        orderNumber: job.orderNumber,
        customerName: job.customerName,
        line1: job.address.line1,
        total: job.total,
        cashCollected: paise(0),
        distanceMetres: job.distanceMetres,
        deliveredAt: action.at,
        onTime: false,
        outcome: "FAILED",
      };
      return {
        ...state,
        jobs: updateJob(state.jobs, action.id, { state: "FAILED", deliveredAt: action.at, failReason: action.reason }),
        completed: [...state.completed, done],
      };
    }
    case "SIMULATE_OFFER": {
      const [next, ...rest] = state.pending;
      if (!next) return state;
      return { ...state, jobs: [...state.jobs, next], pending: rest };
    }
    case "END_SHIFT":
      return { ...state, shiftEnded: true, online: false };
    case "RESET":
      return initialDemoState();
    default:
      return state;
  }
}

/** The run: what the rider still has to do, in the order they will do it. */
export function activeJobs(state: DriverDemoState): readonly DemoJob[] {
  return state.jobs.filter((job) => job.state === "ACCEPTED" || job.state === "PICKED_UP" || job.state === "ARRIVED");
}

export function offeredJobs(state: DriverDemoState): readonly DemoJob[] {
  return state.jobs.filter((job) => job.state === "OFFERED");
}

/** Cash the rider is carrying for the counter: every COD delivery closed with cash today. */
export function cashInHand(state: DriverDemoState): Paise {
  return state.completed.reduce((sum, job) => (sum + job.cashCollected) as Paise, paise(0));
}

export function distanceToday(state: DriverDemoState): number {
  return state.completed.reduce((sum, job) => sum + job.distanceMetres, 0);
}

/** "8:04 pm" in the store's clock, for the moment a demo job closes. */
export function demoClock(now: Date): string {
  return now.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" }).toLowerCase();
}
