import { customAlphabet, nanoid } from 'nanoid';

const NUM = customAlphabet('0123456789', 6);
const ALNUM = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 8);

/** Prefixed unique id, e.g. newId('ord') -> "ord_V1StGXR8..." */
export const newId = (prefix) => `${prefix}_${nanoid(21)}`;

/** Human-facing order number, e.g. FM-2026-AB7K9XQ2 */
export const newOrderNumber = () => `FM-${new Date().getFullYear()}-${ALNUM()}`;
export const newTicketNumber = () => `TK-${ALNUM()}`;

/** 6-digit numeric OTP. */
export const newOtp = () => NUM();
