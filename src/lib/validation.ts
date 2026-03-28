/**
 * Data validation utilities for business rules
 */

// Indian GST number format: 2 digits + 5 uppercase letters + 4 digits + 1 letter + 1 alphanumeric + Z + 1 alphanumeric
const GST_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export function validateGSTNumber(gst: string | null | undefined): { valid: boolean; message?: string } {
  if (!gst || gst.trim() === '') {
    return { valid: true }; // GST is optional
  }
  const cleaned = gst.trim().toUpperCase();
  if (!GST_REGEX.test(cleaned)) {
    return { valid: false, message: `Invalid GST format: "${gst}". Expected: 22AAAAA0000A1Z5` };
  }
  return { valid: true };
}

export function validatePONumber(poNumber: string | null | undefined): { valid: boolean; message?: string } {
  if (!poNumber || poNumber.trim() === '') {
    return { valid: false, message: 'PO number is required' };
  }
  if (poNumber.trim().length < 2) {
    return { valid: false, message: 'PO number must be at least 2 characters' };
  }
  return { valid: true };
}

export function checkAmountMismatch(
  invoiceAmount: number | null,
  poAmount: number | null,
  thresholdPercent: number = 5
): { hasMismatch: boolean; differencePercent: number; message?: string } {
  if (invoiceAmount == null || poAmount == null || poAmount === 0) {
    return { hasMismatch: false, differencePercent: 0 };
  }
  const differencePercent = Math.abs(invoiceAmount - poAmount) / poAmount * 100;
  if (differencePercent > thresholdPercent) {
    return {
      hasMismatch: true,
      differencePercent: Math.round(differencePercent * 100) / 100,
      message: `Amount mismatch: Invoice ₹${invoiceAmount.toLocaleString()} vs PO ₹${poAmount.toLocaleString()} (${differencePercent.toFixed(1)}% difference)`,
    };
  }
  return { hasMismatch: false, differencePercent: Math.round(differencePercent * 100) / 100 };
}
