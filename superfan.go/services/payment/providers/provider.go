package providers

import (
	"context"
)

// DepositRequest represents a generic request to initiate a deposit
type DepositRequest struct {
	UserID      int     `json:"userId" binding:"required"`
	Amount      float64 `json:"amount" binding:"required"`
	Currency    string  `json:"currency" binding:"required"` // e.g., "NGN", "USDC", "USDT"
	Description string  `json:"description"`
}

// DepositResponse represents the result of initiating a deposit
type DepositResponse struct {
	TransactionReference string
	CheckoutURL          string // If applicable
	ProviderFee          float64
	Status               string
}

// VerifyTransactionRequest represents a request to verify a deposit transaction
type VerifyTransactionRequest struct {
	TransactionReference string
}

// VerifyTransactionResponse represents the verified state of a transaction
type VerifyTransactionResponse struct {
	TransactionReference string
	Amount               float64
	Currency             string
	Status               string // e.g., "SUCCESS", "FAILED", "PENDING"
}

// PaymentProvider defines the interface that all third-party payment gateways must implement
type PaymentProvider interface {
	Name() string
	InitiateDeposit(ctx context.Context, req DepositRequest) (*DepositResponse, error)
	VerifyTransaction(ctx context.Context, req VerifyTransactionRequest) (*VerifyTransactionResponse, error)
}
