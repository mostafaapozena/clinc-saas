// Process lifecycle flags for readiness (docs/operations/RUNBOOK.md). `indexesReady` is set once
// every model's indexes are built (unique constraints are part of correctness); `shuttingDown` is
// set on SIGTERM/SIGINT so load balancers stop sending traffic before connections close.
export const lifecycle = { indexesReady: false, shuttingDown: false };
