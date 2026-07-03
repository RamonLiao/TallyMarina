# Task 2 Report: Journal-entry artifact (signature element)

## Status
DONE

## Files Created
1. `web/src/landing/sampleEntry.ts` — Data module exporting `JournalLine` type, `sampleEntry` object (tx digest + 3-line balanced entry), and `totals()` function
2. `web/src/landing/__tests__/sampleEntry.test.ts` — Unit tests verifying balance invariant (Dr = Cr), presence of both debit and credit lines, and valid Sui tx digest
3. `web/src/landing/JournalArtifact.tsx` — React component rendering a journal table with memo, tx digest (truncated), and balanced totals row; uses semantic HTML (`<figure>`, `<table>`, `<tfoot>`); design tokens applied for Dr/Cr colors (via CSS classes `.dr`, `.cr`)

## Process Execution (TDD)
- **Step 1:** Written failing test ✓
- **Step 2:** Test failed as expected (module not found) ✓
- **Step 3:** Written sampleEntry.ts with sample entry + totals function ✓
- **Step 4:** Test passed (3/3) ✓
- **Step 5:** Built JournalArtifact component ✓
- **Step 6:** Committed ✓

## Test Results
```
 ✓ src/landing/__tests__/sampleEntry.test.ts  (3 tests)
 
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

All three assertions verified:
1. Balance invariant: debits (12,500.0) === credits (12,500.0) ✓
2. At least one debit line and one credit line present ✓
3. Valid Sui tx digest format (0x-prefixed 64 hex chars) ✓

## Commit
- Hash: `ed0ee2f`
- Message: `feat(landing): balanced double-entry journal artifact (signature element)`
- Branch: `feat/landing-page`

## Implementation Notes
- Component uses design token CSS classes (`.dr` for debit, `.cr` for credit) — actual color definitions are in later task's `landing.css`
- `fmt()` function suppresses zero values (empty string) for clean table presentation
- `truncate()` shows first 10 + last 6 chars of tx digest with ellipsis for readability
- Table uses semantic HTML with proper `<thead>`, `<tbody>`, `<tfoot>` structure and `scope="col"` on headers
- Sample entry balances at 12,500 (3 lines: +12,480 SUI, -12,500 USDC, +20 fees)
- Component receives no props; consumes sample entry directly

## Known Concerns
None. All steps completed as specified. Component ready for visual styling in Task 3.
