/**
 * FRYBIRD Intelligence Engine — the Insight contract.
 *
 * Deliberately not exported: `observed()` and `ObservedSchema`. An Observed
 * quantity is minted by the repository readers through
 * `./observed-factory`, or by parsing a stored insight with `InsightSchema`.
 */
export {
  UNITS,
  QuantitySchema,
  EstimatedSchema,
  IntervalSchema,
  RangeSchema,
  estimated,
  sameUnit,
  compareQuantities,
  magnitudeOf,
  sumMagnitudes,
  type Unit,
  type Quantity,
  type Observed,
  type Estimated,
  type Interval,
  type Range,
} from "./quantity";
export {
  IdentifierSchema,
  CodeSchema,
  Sha256HexSchema,
  IstDateTimeSchema,
  PeriodSchema,
  EvidenceSchema,
  type Period,
  type Evidence,
} from "./evidence";
export { TrustRefSchema, ConfidenceSchema, type TrustRef, type Confidence } from "./trust";
export {
  CAPPED_LOW_TRUST,
  trustGate,
  trustRefFor,
  type FigureTrust,
  type GateDecision,
  type TrustGradeInput,
} from "./trust-gate";
export {
  LEDGER_PRODUCER_PREFIXES,
  isLedgerInsight,
  presentFor,
  viewerFor,
  type InsightViewer,
  type ViewerPresentations,
} from "./present-for";
export { divRoundHalfAway, integerMedian, observedMedian, observedShare } from "./observed-stats";
export {
  CLAIM_TYPES,
  ActionTierSchema,
  FactPayloadSchema,
  DetectionPayloadSchema,
  ForecastPayloadSchema,
  ExplanationPayloadSchema,
  AssumptionSchema,
  RecommendationPayloadSchema,
  ApprovalRefSchema,
  AutomationPayloadSchema,
  type ClaimType,
  type ActionTier,
} from "./claims";
export {
  INSIGHT_SCHEMA_VERSION,
  SubjectKindSchema,
  CopySchema,
  InsightSchema,
  resolvePayloadPath,
  classifySlotValue,
  findPersonalData,
  parseInsights,
  type Copy,
  type Insight,
  type InsightOf,
  type SlotValueKind,
  type PersonalDataFinding,
  type ParsedInsights,
} from "./insight";
export { MAX_PARAM_KEYS, ActionParamsSchema, parseActionParams, actionParamsHash, type ActionParams } from "./params";
export { canonicalJson, contentHashInput, sha256Hex, computeContentHash, hasValidContentHash } from "./content-hash";
export {
  present,
  factFigure,
  type Badge,
  type BadgeLabel,
  type FactFigure,
  type TrustNote,
  type RenderedCopy,
  type Presentation,
  type FactPresentation,
  type DetectionPresentation,
  type ForecastPresentation,
  type ExplanationPresentation,
  type RecommendationPresentation,
  type AutomationPresentation,
} from "./present";
