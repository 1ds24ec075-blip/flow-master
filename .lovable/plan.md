

## Plan: Complete Missing Supplier Dashboard Features

### Overview
Build the remaining features from your original request: additional charts, action buttons, payment reminders via email, and an enhanced supplier detail view.

### Phase 1: Database Changes
Add new tables and columns to support missing features:

- **`supplier_payment_reminders`** table: Track sent reminders (supplier_id, invoice_id, sent_at, reminder_type, email_sent_to, status)
- **`supplier_debit_credit_notes`** table: Track debit/credit notes (supplier_id, note_type, amount, date, description, reference_number)
- Add `reorder_level` column to `suppliers` table (for stock threshold alerts)

### Phase 2: Monthly Purchase Trend Chart
- Add a new "Monthly Purchase Trend" line/bar chart in the PayablesCharts component
- Aggregate invoice data by month to show spending trends over the last 6-12 months

### Phase 3: Supplier Table Action Buttons
Add quick action buttons to each row in the supplier table:
- **Pay Now** -- placeholder action (toast notification, since payment gateway integration is separate)
- **Raise PO** -- navigate to the PO creation page with supplier pre-selected
- **Contact Supplier** -- open email client with supplier email pre-filled

### Phase 4: Alert Click -> Detail Pop-up + Send Email Reminder
- Make each alert clickable to open a detail dialog showing the specific issue
- Add a "Send Reminder" button that calls a backend function to email the supplier
- Create an edge function `send-payment-reminder` that sends an email via SMTP (using existing GMAIL_SMTP credentials)
- Log reminders in the `supplier_payment_reminders` table

### Phase 5: Enhanced Supplier Detail View
Add to the existing SupplierDetailDialog:
- **Average Payment Delay**: Calculate from invoice created_at vs. approved date
- **Monthly Purchase Graph**: Small bar chart showing monthly spend for the supplier
- **Payment Behavior Graph**: Line chart showing payment delay over time
- **Debit/Credit Notes section**: Table listing notes from the new DB table
- **Communication Log**: Show sent reminders from the `supplier_payment_reminders` table

### Phase 6: Additional Alerts
- **Stock below reorder level**: Compare current data against `reorder_level` on suppliers table
- **Supplier performance drop**: Compare last 3 months spend vs. previous 3 months

---

### Technical Details

**New Database Migration:**
```sql
-- Supplier payment reminders table
CREATE TABLE public.supplier_payment_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID REFERENCES public.suppliers(id),
  invoice_id UUID REFERENCES public.raw_material_invoices(id),
  reminder_type TEXT NOT NULL DEFAULT 'payment_overdue',
  email_sent_to TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.supplier_payment_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on supplier_payment_reminders" ON public.supplier_payment_reminders FOR ALL USING (true) WITH CHECK (true);

-- Debit/Credit notes table
CREATE TABLE public.supplier_debit_credit_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID REFERENCES public.suppliers(id),
  note_type TEXT NOT NULL CHECK (note_type IN ('debit', 'credit')),
  amount NUMERIC NOT NULL DEFAULT 0,
  note_date DATE NOT NULL DEFAULT CURRENT_DATE,
  description TEXT,
  reference_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.supplier_debit_credit_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on supplier_debit_credit_notes" ON public.supplier_debit_credit_notes FOR ALL USING (true) WITH CHECK (true);

-- Add reorder level to suppliers
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS reorder_level NUMERIC DEFAULT 0;
```

**New Edge Function: `send-payment-reminder`**
- Accepts supplier_id, invoice_id, reminder message
- Sends email using GMAIL_SMTP_USER / GMAIL_SMTP_PASSWORD secrets (already configured)
- Logs the reminder in `supplier_payment_reminders`

**Files to create/modify:**
- `supabase/functions/send-payment-reminder/index.ts` (new)
- `src/components/supplier-dashboard/PayablesCharts.tsx` (add monthly trend chart)
- `src/components/supplier-dashboard/SupplierTable.tsx` (add Pay Now, Raise PO, Contact buttons)
- `src/components/supplier-dashboard/SupplierAlerts.tsx` (make alerts clickable, add reminder button)
- `src/components/supplier-dashboard/SupplierDetailDialog.tsx` (add trends, payment delay, communication log, debit/credit notes)
- `src/pages/RawMaterialInvoices.tsx` (wire up new data queries and pass to components)

