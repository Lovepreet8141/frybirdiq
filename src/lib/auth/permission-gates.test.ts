/**
 * Every server action's permission gate, pinned (pay-ready).
 *
 * A server action is a public HTTP endpoint: hiding the button is not
 * authorization (§41). This test reads every "use server" module, finds what
 * each exported action checks — `requirePermission`, `staffCan`, or a local
 * `authorise(...)` helper that calls one — and compares it with the table
 * below. It fails when:
 *
 * - a gate is removed from any action (its permissions become empty);
 * - a gate is weakened or swapped for another permission;
 * - a new action appears without being added here, gated or public on purpose.
 *
 * Public actions are listed with the reason they need no staff permission.
 * money-gates.test.ts proves the money actions actually refuse at runtime.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "@/domain/permissions";
import { actionGates } from "./__test-support__/action-gates";

const GATED: Readonly<Record<string, readonly string[]>> = {
  "src/lib/auth/kitchen-action.ts#pollKitchenTickets": ["kitchen.view"],
  "src/lib/auth/order-alert-action.ts#pollNewOrders": ["orders.view"],
  "src/lib/auth/staff-actions.ts#acceptOrderAction": ["kitchen.update"],
  "src/lib/auth/staff-actions.ts#advanceOrderAction": ["kitchen.update"],
  "src/lib/auth/staff-actions.ts#assignRiderAction": ["delivery.assign"],
  "src/lib/auth/staff-actions.ts#completeDeliveryAction": ["delivery.complete"],
  "src/lib/auth/staff-actions.ts#failDeliveryAction": ["delivery.complete"],
  "src/lib/auth/staff-actions.ts#releaseDeliveryAction": ["delivery.take"],
  "src/lib/auth/staff-actions.ts#takeDeliveryAction": ["delivery.take"],
  "src/lib/auth/staff-actions.ts#markPaidAction": ["orders.update"],
  "src/lib/auth/staff-actions.ts#rejectOrderAction": ["orders.cancel"],
  "src/lib/cash/actions.ts#closeCashSessionAction": ["finance.manage"],
  "src/lib/cash/actions.ts#openCashSessionAction": ["finance.manage"],
  "src/lib/cash/actions.ts#recordCashHandoverAction": ["finance.manage"],
  "src/lib/customers/actions.ts#updateCustomerAction": ["customers.edit"],
  "src/lib/kitchen/board-action.ts#pollKitchenBoard": ["kitchen.view"],
  "src/lib/kitchen/stations-action.ts#markOrderReadyAction": ["kitchen.update"],
  "src/lib/kitchen/stations-action.ts#pollStationOrders": ["kitchen.view"],
  "src/lib/kitchen/stations-action.ts#setOrderPackedAction": ["kitchen.update"],
  "src/lib/kitchen/stations-action.ts#setLineDoneAction": ["kitchen.update"],
  "src/lib/shifts/actions.ts#correctBreakAction": ["staff.manage"],
  "src/lib/shifts/actions.ts#correctShiftAction": ["staff.manage"],
  "src/lib/finance/actions.ts#refundPaymentAction": ["orders.refund"],
  "src/lib/hardware/actions.ts#createPrintJobAction": ["orders.create",  "orders.refund"],
  "src/lib/hardware/actions.ts#deletePrinterAction": ["integrations.manage"],
  "src/lib/hardware/actions.ts#heartbeatAction": ["orders.create"],
  "src/lib/hardware/actions.ts#registerDeviceAction": ["orders.create"],
  "src/lib/hardware/actions.ts#removeDeviceAction": ["integrations.manage"],
  "src/lib/hardware/actions.ts#renameDeviceAction": ["integrations.manage"],
  "src/lib/hardware/actions.ts#reportPrintJobAction": ["orders.create"],
  "src/lib/hardware/actions.ts#reportPrinterStatusAction": ["orders.create"],
  "src/lib/hardware/actions.ts#savePrinterAction": ["integrations.manage"],
  "src/lib/hardware/actions.ts#whoAmIAction": ["orders.create"],
  "src/lib/inventory/actions.ts#recordPriceAction": ["purchasing.manage"],
  "src/lib/inventory/actions.ts#saveIngredientAction": ["purchasing.manage"],
  "src/lib/inventory/actions.ts#saveSupplierAction": ["purchasing.manage"],
  "src/lib/inventory/purchase-order-actions.ts#cancelPurchaseOrderAction": ["purchasing.manage"],
  "src/lib/inventory/purchase-order-actions.ts#createPurchaseOrderAction": ["purchasing.manage"],
  "src/lib/inventory/purchase-order-actions.ts#receivePurchaseOrderAction": ["purchasing.manage"],
  "src/lib/inventory/purchase-order-actions.ts#sendPurchaseOrderAction": ["purchasing.manage"],
  "src/lib/inventory/stock-actions.ts#adjustStockAction": ["inventory.adjust"],
  "src/lib/inventory/stock-actions.ts#countStockAction": ["inventory.adjust"],
  "src/lib/inventory/stock-actions.ts#receiveStockAction": ["inventory.adjust"],
  "src/lib/inventory/waste-actions.ts#recordWasteAction": ["inventory.waste"],
  "src/lib/iq/actions.ts#recordExpense": ["finance.manage"],
  "src/lib/iq/actions.ts#setFoodCostTarget": ["finance.manage"],
  "src/lib/loyalty/actions.ts#updateStampConfigAction": ["settings.manage"],
  "src/lib/orders/shop-status-actions.ts#pauseOrderingAction": ["orders.update"],
  "src/lib/orders/shop-status-actions.ts#previewPauseAction": ["orders.update"],
  "src/lib/orders/shop-status-actions.ts#readOrderingStatusAction": ["orders.view"],
  "src/lib/orders/shop-status-actions.ts#resumeOrderingAction": ["orders.update"],
  "src/lib/settings/closures-actions.ts#addClosedDateAction": ["settings.manage"],
  "src/lib/settings/closures-actions.ts#removeClosedDateAction": ["settings.manage"],
  "src/lib/settings/closures-actions.ts#saveWeeklyClosedDaysAction": ["settings.manage"],
  "src/lib/menu-admin/actions.ts#addComboItemAction": ["menu.edit"],
  "src/lib/menu-admin/actions.ts#addModifierAction": ["menu.edit"],
  "src/lib/menu-admin/actions.ts#bulkMarkAvailableAction": ["menu.edit"],
  "src/lib/menu-admin/actions.ts#bulkMarkUnavailableAction": ["menu.edit"],
  "src/lib/menu-admin/actions.ts#bulkMoveProductsToCategoryAction": ["menu.edit"],
  "src/lib/menu-admin/actions.ts#bulkPublishProductsAction": ["menu.publish"],
  "src/lib/menu-admin/actions.ts#bulkSetProductActiveAction": ["menu.edit"],
  "src/lib/menu-admin/actions.ts#createBareRecipeAction": ["recipes.edit"],
  "src/lib/menu-admin/actions.ts#createCategoryAction": ["menu.edit"],
  "src/lib/menu-admin/actions.ts#createModifierGroupAction": ["menu.edit"],
  "src/lib/menu-admin/actions.ts#createProductAction": ["menu.edit"],
  "src/lib/menu-admin/actions.ts#deleteAvailabilityRuleAction": ["menu.edit"],
  "src/lib/menu-admin/actions.ts#deleteCategoryAction": ["menu.edit"],
  "src/lib/menu-admin/actions.ts#deleteCategoryAvailabilityRuleAction": ["menu.edit"],
  "src/lib/menu-admin/actions.ts#deleteMediaAction": ["menu.edit"],
  "src/lib/menu-admin/actions.ts#deleteModifierAction": ["menu.edit"],
  "src/lib/menu-admin/actions.ts#deleteModifierGroupAction": ["menu.edit"],
  "src/lib/menu-admin/actions.ts#duplicateProductAction": ["menu.edit"],
  "src/lib/menu-admin/actions.ts#moveCategoryAction": ["menu.edit"],
  "src/lib/menu-admin/actions.ts#moveModifierPositionAction": ["menu.edit"],
  "src/lib/menu-admin/actions.ts#moveProductPositionAction": ["menu.edit"],
  "src/lib/menu-admin/actions.ts#moveProductToCategoryAction": ["menu.edit"],
  "src/lib/menu-admin/actions.ts#publishAllDraftsAction": ["menu.publish"],
  "src/lib/menu-admin/actions.ts#publishCategoryAction": ["menu.publish"],
  "src/lib/menu-admin/actions.ts#publishModifierGroupAction": ["menu.publish"],
  "src/lib/menu-admin/actions.ts#publishProductAction": ["menu.publish"],
  "src/lib/menu-admin/actions.ts#quickMarkAvailableAction": ["menu.edit"],
  "src/lib/menu-admin/actions.ts#quickSetAvailabilityAction": ["menu.edit"],
  "src/lib/menu-admin/actions.ts#removeComboItemAction": ["menu.edit"],
  "src/lib/menu-admin/actions.ts#saveRecipeVersionAction": ["recipes.edit"],
  "src/lib/menu-admin/actions.ts#setAvailabilityRuleAction": ["menu.edit"],
  "src/lib/menu-admin/actions.ts#setCategoryActiveAction": ["menu.edit"],
  "src/lib/menu-admin/actions.ts#setCategoryAvailabilityRuleAction": ["menu.edit"],
  "src/lib/menu-admin/actions.ts#setProductActiveAction": ["menu.edit"],
  "src/lib/menu-admin/actions.ts#setProductImagesAction": ["menu.edit"],
  "src/lib/menu-admin/actions.ts#setProductModifierGroupsAction": ["menu.edit"],
  "src/lib/menu-admin/actions.ts#updateCategoryAction": ["menu.edit"],
  "src/lib/menu-admin/actions.ts#updateModifierAction": ["menu.edit"],
  "src/lib/menu-admin/actions.ts#updateModifierGroupAction": ["menu.edit"],
  "src/lib/menu-admin/actions.ts#updateProductDetailsAction": ["menu.edit"],
  "src/lib/menu-admin/actions.ts#updateProductPriceAction": ["menu.price"],
  "src/lib/menu-admin/actions.ts#uploadMediaAction": ["menu.edit"],
  "src/lib/pos/actions.ts#lookupCustomerAction": ["customers.view"],
  "src/lib/pos/actions.ts#placeCounterOrderAction": ["orders.create"],
  "src/lib/pos/actions.ts#pollPosMenu": ["orders.create"],
  "src/lib/pos/actions.ts#priceDraftOrder": ["orders.create"],
  "src/lib/pos/table-actions.ts#assignOrderToTableAction": ["orders.update"],
  "src/lib/pos/table-actions.ts#clearTableAction": ["orders.update"],
  "src/lib/pos/table-actions.ts#createTableAction": ["settings.manage"],
  "src/lib/promotions/actions.ts#deletePromotionAction": ["promotions.manage"],
  "src/lib/promotions/actions.ts#duplicatePromotionAction": ["promotions.manage"],
  "src/lib/promotions/actions.ts#savePromotionAction": ["promotions.manage"],
  "src/lib/receipt/actions.ts#applyReceiptDesignAction": ["settings.manage"],
  "src/lib/receipt/actions.ts#restoreReceiptDesignAction": ["settings.manage"],
  "src/lib/receipt/actions.ts#saveReceiptDraftAction": ["settings.manage"],
  "src/lib/receipt/actions.ts#uploadReceiptImageAction": ["settings.manage"],
  "src/lib/settings/actions.ts#updateBusinessProfileAction": ["settings.manage"],
  "src/lib/settings/actions.ts#updateDeliveryPricingAction": ["settings.manage"],
  "src/lib/settings/actions.ts#updateLocationProfileAction": ["settings.manage"],
  "src/lib/settings/actions.ts#updateOperationsSettingsAction": ["settings.manage"],
  "src/lib/settings/actions.ts#updatePaymentSettingsAction": ["settings.manage"],
  "src/lib/settings/actions.ts#updateRiderLimitsAction": ["settings.manage"],
  "src/lib/staff/actions.ts#changeStaffRoleAction": ["staff.manage"],
  "src/lib/staff/actions.ts#deactivateStaffAction": ["staff.manage"],
  "src/lib/staff/actions.ts#inviteStaffAction": ["staff.manage"],
};

/** Any signed-in staff member, on purpose: the action acts only on the caller's own record. */
const STAFF_ONLY: Readonly<Record<string, string>> = {
  "src/lib/shifts/actions.ts#clockInAction": "a person clocks themselves in; the person comes from the session, never the form",
  "src/lib/shifts/actions.ts#startBreakAction": "a person starts their own break; the person comes from the session, never the form",
  "src/lib/shifts/actions.ts#endBreakAction": "a person ends their own break; the person comes from the session, never the form",
  "src/lib/shifts/actions.ts#clockOutAction": "a person clocks themselves out; the person comes from the session, never the form",
};

const PUBLIC: Readonly<Record<string, string>> = {
  "src/lib/auth/actions.ts#signIn": "staff sign-in itself: it is how a session is obtained",
  "src/lib/cart/actions.ts#addToCart": "the customer's own cart, held in their cookie",
  "src/lib/cart/actions.ts#applyPromoCode": "the customer's own cart, held in their cookie",
  "src/lib/cart/actions.ts#clearCart": "the customer's own cart, held in their cookie",
  "src/lib/cart/actions.ts#clearPromoCode": "the customer's own cart, held in their cookie",
  "src/lib/cart/actions.ts#removeLine": "the customer's own cart, held in their cookie",
  "src/lib/cart/actions.ts#setPointsToSpend": "the customer's own cart, held in their cookie",
  "src/lib/cart/actions.ts#setQuantity": "the customer's own cart, held in their cookie",
  "src/lib/cart/actions.ts#setRedeemReward": "the customer's own cart, held in their cookie",
  "src/lib/cart/checkout-action.ts#submitCheckout": "the customer's checkout; the server prices the cart and gates hours",
  "src/lib/cart/delivery-action.ts#quoteDeliveryAction": "the customer's delivery quote, computed from the pin on the server",
  "src/lib/customer/actions.ts#createAccount": "customer account sign-up and sign-in",
  "src/lib/customer/actions.ts#resendConfirmation": "customer account sign-up and sign-in",
  "src/lib/customer/actions.ts#signInCustomer": "customer account sign-up and sign-in",
  "src/lib/hardware/actions.ts#checkPrinterAddressAction": "pure validation of a host and port: no database, no network",
  "src/lib/home/franchise-actions.ts#submitFranchiseInquiry": "the public franchise enquiry form",
  "src/lib/notifications/actions.ts#whatsappOrderLink": "the customer's own order, bound to the signed-in customer or this device's phone",
  "src/lib/payments/actions.ts#confirmOnlinePaymentAction": "the customer's payment; Razorpay's signature and its own record are the authority",
  "src/lib/payments/actions.ts#reportOnlinePaymentFailureAction": "the customer's own order, bound to their phone; writes only a fixed note",
  "src/lib/ratings/actions.ts#rateOrder": "the customer rates their own order",
};

const found = actionGates(path.resolve(__dirname, "../../.."));

describe("server action permission gates", () => {
  it("every exported server action is accounted for, gated or public on purpose", () => {
    const listed = [...Object.keys(GATED), ...Object.keys(STAFF_ONLY), ...Object.keys(PUBLIC)].sort();
    expect(Object.keys(found).sort()).toEqual(listed);
  });

  it.each(Object.entries(GATED))("%s checks exactly %j before acting", (action, permissions) => {
    expect(found[action]?.gates).toEqual(permissions);
  });

  it.each(Object.keys(STAFF_ONLY))("%s needs a signed-in staff member and names no permission", (action) => {
    expect(found[action]?.gates).toEqual(["staff"]);
  });

  it.each(Object.keys(PUBLIC))("%s is public and checks no staff permission", (action) => {
    expect(found[action]?.gates).toEqual([]);
  });

  it("every permission named is a real one", () => {
    const named = new Set(Object.values(GATED).flat());
    expect([...named].filter((permission) => !(PERMISSIONS as readonly string[]).includes(permission))).toEqual([]);
  });
});
