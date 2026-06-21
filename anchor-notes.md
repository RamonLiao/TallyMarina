# anchor-notes.md

## P126 Transport Spike — Findings

### Resolved @mysten/sui version
`@mysten/sui@2.19.0`

### Step 4 (testnet tx send) deferred — needs SUI_PRIVATE_KEY from user

Step 4 was not executed because no `SUI_PRIVATE_KEY` is available in the current environment.
Once the key is provided, run:

```bash
cd services/anchor-svc
SUI_PRIVATE_KEY=<your_key> npm run spike
```

Record the resulting digest and transport construction here after a successful run.
