

## Problem

When a new PO is processed, it never reaches the Order Lifecycle page. The root cause is in the `process-po` edge function (lines 622-688):

1. **Missing columns on `po_orders`**: The function tries to update `suggested_payment_type`, `suggestion_reason`, and `risk_flag` — none of which exist in the `po_orders` table. This update fails silently, leaving the order stuck in `pending` status.

2. **Missing columns on `customer_master`**: The function queries `default_payment_mode`, `default_credit_days`, `credit_limit`, `outstanding_amount`, `has_overdue_invoices` — none of which exist. This causes the suggestion engine to fail.

3. **Order Lifecycle filter**: The Order Lifecycle page only shows orders with statuses `UNDER_REVIEW`, `AWAITING_PAYMENT`, `SO_CREATED`, `DISPATCHED`, `INVOICED`, `PAYMENT_PENDING`, `PAYMENT_COMPLETED`. Orders stuck in `pending` never appear.

## Plan

### 1. Add missing columns to `po_orders` table
- `suggested_payment_type` (text, nullable)
- `suggestion_reason` (text, nullable)
- `risk_flag` (text, nullable, default `'NONE'`)

### 2. Add missing columns to `customer_master` table
- `default_payment_mode` (text, nullable)
- `default_credit_days` (integer, nullable, default 30)
- `credit_limit` (numeric, nullable, default 0)
- `outstanding_amount` (numeric, nullable, default 0)
- `has_overdue_invoices` (boolean, nullable, default false)

### 3. Fix any existing `pending` orders
- Run an UPDATE to move any current `pending` orders to `UNDER_REVIEW` so they appear in the lifecycle.

### 4. Update Order Lifecycle page
- Display `suggested_payment_type`, `suggestion_reason`, and `risk_flag` in the `PaymentDecisionDialog` so reviewers can see the AI suggestion.

