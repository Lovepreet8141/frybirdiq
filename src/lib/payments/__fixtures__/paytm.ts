/**
 * CONSTRUCTED FROM THE PUBLISHED DOCS, NOT CAPTURED FROM PAYTM.
 *
 * No Paytm account exists yet, so nothing here was ever sent or received by
 * the real gateway. The shapes follow the Initiate Transaction, Transaction
 * Status, Refund and Refund Status pages on paytmpayments.com/docs and the
 * Payment Status callback page. Every id, key and mid is obviously fake. When
 * the owner has staging credentials, replace these with captured sandbox
 * responses and keep the constructed ones as the fail-closed cases.
 */

import { generateChecksum } from "../paytm";

export const TEST_MID = "TESTMID0000000000001";
/** 16 bytes, as AES-128 needs. A throwaway. */
export const TEST_KEY = "TestKey123456789";
export const TEST_WEBSITE = "WEBSTAGING";
export const TEST_CALLBACK = "https://example.test/api/paytm/callback";
export const ORDER_ID = "0b6f7c8e-1111-4222-8333-444455556666";
export const TXN_ID = "20260920111212800110168000000000001";

/** A signed Paytm response envelope for `body`, signed the way Paytm signs (over JSON.stringify(body)). */
export function signed(body: Record<string, unknown>, key: string = TEST_KEY): string {
  return JSON.stringify({ head: { signature: generateChecksum(JSON.stringify(body), key) }, body });
}

export const initiateOk = { resultInfo: { resultStatus: "S", resultCode: "0000", resultMsg: "Success" }, txnToken: "fake-txn-token-0001" };
export const initiateRejected = { resultInfo: { resultStatus: "F", resultCode: "1007", resultMsg: "Invalid checksum" } };

export const statusSuccess = {
  resultInfo: { resultStatus: "TXN_SUCCESS", resultCode: "01", resultMsg: "Txn Success" },
  txnId: TXN_ID,
  orderId: ORDER_ID,
  txnAmount: "940.00",
  paymentMode: "UPI",
};
export const statusFailure = { ...statusSuccess, resultInfo: { resultStatus: "TXN_FAILURE", resultCode: "227", resultMsg: "Your payment has been declined by your bank." } };
export const statusPending = { ...statusSuccess, resultInfo: { resultStatus: "PENDING", resultCode: "400", resultMsg: "Transaction status not confirmed yet." } };
export const statusNoRecord = { resultInfo: { resultStatus: "NO_RECORD_FOUND", resultCode: "334", resultMsg: "Invalid Order ID." } };
export const statusUnknown = { ...statusSuccess, resultInfo: { resultStatus: "SOMETHING_NEW", resultCode: "999", resultMsg: "?" } };

export const refundSuccess = { resultInfo: { resultStatus: "TXN_SUCCESS", resultCode: "10", resultMsg: "Refund Successful" }, refundId: "fake-paytm-refund-1", refundAmount: "940.00", txnId: TXN_ID };
export const refundPending = { resultInfo: { resultStatus: "PENDING", resultCode: "601", resultMsg: "Refund request was raised for this transaction." }, refundId: "fake-paytm-refund-1" };
export const refundRefused = { resultInfo: { resultStatus: "TXN_FAILURE", resultCode: "620", resultMsg: "Insufficient balance." } };
export const refundDuplicate = { resultInfo: { resultStatus: "TXN_FAILURE", resultCode: "617", resultMsg: "Duplicate refund request." } };
export const refundNoRecord = { resultInfo: { resultStatus: "NO_RECORD_FOUND", resultCode: "631", resultMsg: "Refund record not found." } };

/** Callback form fields, before the checksum is added. */
export const callbackFields = { ORDERID: ORDER_ID, TXNID: TXN_ID, TXNAMOUNT: "940.00", STATUS: "TXN_SUCCESS", RESPCODE: "01", RESPMSG: "Txn Success", PAYMENTMODE: "UPI" };
