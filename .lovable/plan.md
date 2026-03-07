

## Plan: Add Sales Target Feature to Inventory

### What we're building
A "Sales Target" field on each inventory item where users can set a target number of units to sell within a chosen period (week, month, quarter, or financial year). This will be visible in the inventory table and editable via the Add/Edit dialog.

### Database Changes
Add two columns to `inventory_items`:
- `sales_target_quantity` (integer, nullable, default null) — the target number of units
- `sales_target_period` (text, nullable, default null) — one of: `week`, `month`, `quarter`, `financial_year`

### Frontend Changes

1. **`InventoryItem` type** (`ReorderConfirmDialog.tsx`): Add `sales_target_quantity` and `sales_target_period` to the interface.

2. **`AddEditItemDialog.tsx`**: Add two new fields in the form:
   - A number input for "Sales Target (units)"
   - A select dropdown for "Target Period" with options: Week, Month, Quarter, Financial Year
   - Wire these into the form state and `onSave` payload.

3. **`InventoryTable.tsx`**: Add a "Sales Target" column showing the target quantity and period (e.g., "500 / month"). Show a dash or "Not set" if no target is configured.

4. **`Inventory.tsx`**: Include the new fields in the insert/update payload sent to the database.

### Summary of files to change
- **Migration**: Add `sales_target_quantity` and `sales_target_period` columns to `inventory_items`
- `src/components/inventory/ReorderConfirmDialog.tsx` — update type
- `src/components/inventory/AddEditItemDialog.tsx` — add form fields
- `src/components/inventory/InventoryTable.tsx` — add table column
- `src/pages/Inventory.tsx` — include new fields in mutation payload

