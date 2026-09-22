# FlowTrack Pro v3.5.0

Includes a separate **Money for Disbursement** workflow.

### Funds received for disbursement
Records money received from another person or organisation that is being held for a later payout. It increases the selected wallet's physical balance but is **not treated as personal income**.

### Disbursement
Records money paid out from a held-funds receipt. A disbursement must select its source funds and cannot exceed the amount still available from that receipt.

### Dashboard
- Total balance includes physical wallet balances.
- Savings is unchanged.
- **For disbursement** shows outstanding held funds.
- Spendable excludes savings and outstanding disbursement funds.

Existing localStorage data is preserved and existing transaction types remain supported.
