// DATA ZONE — NEVER import Mascot here.
// The numeric-format contract shipped in every bundle as data-dictionary.md. It exists to kill
// the silent scale error at the ERP boundary: a cross-locale importer (comma as decimal
// separator) that reinterprets "1.200000000" as "1,2" would misplace the point by nine orders
// of magnitude. The format below is locale-free and byte-exact by construction.
export const DATA_DICTIONARY = `# Data dictionary

## Numeric format
- Decimal separator is \`.\` (U+002E). No thousands separators are ever emitted.
- Negative values carry a single leading \`-\` (U+002D). No parentheses, no trailing sign.
- No locale formatting: the output is identical regardless of the reader's locale.
- Quantity columns always carry exactly \`decimals\` fractional digits; trailing zeros are
  significant and are never trimmed (\`decimals=9\` → \`1.200000000\`). A 0-decimal asset emits
  no decimal point at all (\`1200\`, never \`1200.\`).
- \`*Minor\` columns are exact integers in the asset's minor units.
- Fiat amounts (\`debit\`, \`credit\`) always carry exactly 2 fractional digits (functional
  currency minor units), independent of any asset's \`decimals\`.

## journal.csv
| column | type | notes |
|---|---|---|
| debit, credit | decimal string | functional-currency amounts, always 2 decimal places |
| currency | string | functional currency code |
| origCoinType | string | the asset's coin type as it appears on the event (may be short form); blank for legs with no asset (fiat/gas) |
| origDecimals | integer | the asset's registered scale; blank for legs with no asset |
| origQtyMinor | integer string | exact quantity in the asset's minor units; blank for legs with no asset |
| origQty | decimal string | origQtyMinor rescaled by origDecimals; lossless, never rounded; blank for legs with no asset |
| origSource | \`chain\` \\| \`manual\` \\| (empty) | \`manual\` = decimals declared by a person, not verified on chain (a disclosure, not a defect); empty = the leg carries no asset (fiat/gas) |

## quantity-recon.csv
| column | type | notes |
|---|---|---|
| coinType | string | the asset's coin type (every row is an asset; no blank rows here) |
| decimals | integer | the asset's registered scale |
| source | \`chain\` \\| \`manual\` \\| (empty) | as above; empty when the leg's origSource itself was not recorded |
| acquiredMinor, disposedMinor, netMinor | integer string | exact minor units |
| acquired, disposed, net | decimal string | the same values rescaled by decimals; lossless |

## Fail-closed guarantee
An asset leg whose \`origDecimals\` is unknown, or not a plain integer in \`[0, 36]\`, cannot appear
in this bundle: the export refuses to build rather than emit a quantity at an unregistered or
malformed scale.
`;
