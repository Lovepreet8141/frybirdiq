/**
 * FRYBIRD Intelligence Engine — action tiers, catalog, lifecycle, auto policy
 * and cooldown. Pure; the repositories and server actions apply the results.
 */
export {
  MONEY_DOMAINS,
  OPERATIONAL_DOMAINS,
  TIER_ORDER,
  isMoneyDomain,
  isExecutableTier,
  requiresApprovalByDefault,
  type MoneyDomain,
  type OperationalDomain,
  type ActionDomain,
  type TierFor,
} from "./tiers";
export {
  ACTION_CATALOG,
  ACTION_KINDS,
  isActionKind,
  isExecutableKind,
  catalogEntry,
  tierIsPermitted,
  type ActionKind,
  type A1ActionKind,
  type ExecutableActionKind,
  type HandoffActionKind,
  type CatalogEntry,
  type Undo,
  type UndoKind,
} from "./catalog";
export {
  ACTION_STATUSES,
  EXECUTION_MODES,
  INITIAL_STATUS,
  MAX_EXECUTION_ATTEMPTS,
  MODES_FOR_TIER,
  TRANSITIONS,
  checkTransition,
  isModeAllowedForTier,
  isTerminal,
  type ActionStatus,
  type ExecutionMode,
  type TransitionContext,
  type TransitionRefusal,
  type TransitionResult,
} from "./state-machine";
export {
  A1_AUTO_ALLOWED,
  AutoPolicySchema,
  AutoPolicyLimitsSchema,
  evaluateAutoPolicy,
  type AutoPolicy,
  type AutoPolicyInput,
  type ApprovalReason,
  type PolicyDecision,
} from "./policy";
export { COOLDOWN_MS, mayPropose, type LatestAction, type ProposalCheck } from "./cooldown";
