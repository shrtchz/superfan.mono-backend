package utils

// LedgerEvents is a buffered channel for broadcasting new WalletTransactions
// to the admin WebSocket without causing circular dependencies.
var LedgerEvents = make(chan interface{}, 100)
