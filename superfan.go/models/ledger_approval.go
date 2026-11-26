package models

import "time"

const (
	LedgerApprovalStatusAwaiting = "Awaiting approval"
	LedgerApprovalStatusApproved = "Approved"
	LedgerApprovalStatusRejected = "Rejected"
)

const (
	LedgerApprovalKindAdjustment = "Adjustment"
	LedgerApprovalKindReversal   = "Reversal"
	LedgerApprovalKindCorrection = "Correction"
)

type LedgerApprovalLine struct {
	AccountCode    string   `json:"accountCode"`
	AccountName    string   `json:"accountName"`
	Classification string   `json:"classification"`
	Debit          *float64 `json:"debit"`
	Credit         *float64 `json:"credit"`
	Memo           string   `json:"memo"`
}

// LedgerApproval is a maker-checker request for a manual double-entry posting.
// Nothing reaches the general ledger until a second admin approves it.
type LedgerApproval struct {
	ID            uint                 `gorm:"column:id;primaryKey;autoIncrement" json:"id"`
	Reference     string               `gorm:"column:reference;uniqueIndex" json:"reference"`
	Kind          string               `gorm:"column:kind" json:"kind"`
	Status        string               `gorm:"column:status;index" json:"status"`
	Description   string               `gorm:"column:description" json:"description"`
	ClientName    string               `gorm:"column:clientName" json:"clientName"`
	AccountType   string               `gorm:"column:accountType" json:"accountType"`
	Currency      string               `gorm:"column:currency" json:"currency"`
	Amount        float64              `gorm:"column:amount" json:"amount"`
	Reason        string               `gorm:"column:reason" json:"reason"`
	RequestedBy   string               `gorm:"column:requestedBy" json:"requestedBy"`
	RequestedAt   time.Time            `gorm:"column:requestedAt" json:"requestedAt"`
	ReviewedBy    *string              `gorm:"column:reviewedBy" json:"reviewedBy"`
	ReviewedAt    *time.Time           `gorm:"column:reviewedAt" json:"reviewedAt"`
	ReviewNote    *string              `gorm:"column:reviewNote" json:"reviewNote"`
	ReversalOf    *string              `gorm:"column:reversalOf" json:"reversalOf"`
	CorrectsEntry *string              `gorm:"column:correctsEntry" json:"correctsEntry"`
	Lines         []LedgerApprovalLine `gorm:"column:lines;type:jsonb;serializer:json" json:"lines"`
	CreatedAt     time.Time            `gorm:"column:createdAt" json:"createdAt"`
	UpdatedAt     time.Time            `gorm:"column:updatedAt" json:"updatedAt"`
}

func (LedgerApproval) TableName() string {
	return "LedgerApproval"
}
