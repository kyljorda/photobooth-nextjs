import { US_STATES, MAX_QTY, UNIT_PRICE, SHIPPING } from './config';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ZIP_RE = /^\d{5}(-\d{4})?$/;

export const LIMITS = { name: 100, email: 254, line: 120, city: 60, zip: 10 };

function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

// Validates a name/address block. `requireName` is false for the billing
// block because the payer's name is captured separately.
export function validateAddress(addr, prefix, errors) {
  const name = str(addr?.name);
  const line1 = str(addr?.line1);
  const city = str(addr?.city);
  const state = str(addr?.state);
  const zip = str(addr?.zip);

  if (!name || name.length > LIMITS.name) errors[`${prefix}Name`] = true;
  if (!line1 || line1.length > LIMITS.line) errors[`${prefix}Addr1`] = true;
  if (str(addr?.line2).length > LIMITS.line) errors[`${prefix}Addr2`] = true;
  if (!city || city.length > LIMITS.city) errors[`${prefix}City`] = true;
  if (!state || !US_STATES.includes(state)) errors[`${prefix}State`] = true;
  if (!ZIP_RE.test(zip)) errors[`${prefix}Zip`] = true;

  return errors;
}

export function validateEmail(email) {
  const e = str(email);
  return e.length > 0 && e.length <= LIMITS.email && EMAIL_RE.test(e);
}

// Full order validation. Returns { valid, errors }. Run on the client for
// instant feedback and again on the server, which never trusts the client.
export function validateOrder(order) {
  const errors = {};

  if (!validateEmail(order?.email)) errors.shipEmail = true;

  validateAddress(order?.billingAddress, 'ship', errors);
  if (order?.isGift) validateAddress(order?.shippingAddress, 'gift', errors);

  const qty = Number(order?.quantity);
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) errors.quantity = true;

  return { valid: Object.keys(errors).length === 0, errors };
}

// The server recomputes the price. A client-supplied `amount` is never used.
export function computeAmount(quantity) {
  const qty = Math.max(1, Math.min(MAX_QTY, Number(quantity) || 1));
  return qty * UNIT_PRICE + SHIPPING;
}
