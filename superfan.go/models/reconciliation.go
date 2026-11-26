package models

import "time"

// ReconciliationStatementRow is a row imported from a provider settlement
// report or a bank statement CSV. Provider-side records (BankTransfer,
// CardFunding, Payout) are derived on the fly instead of being stored here.
type ReconciliationStatementRow struct {
	ID            uint       `gorm:"column:id;primaryKey" json:"id"`
	SourceType    string     `gorm:"column:sourceType;index" json:"sourceType"`
	Source        string     `gorm:"column:source" json:"source"`
	ProviderRef   string     `gorm:"column:providerRef;index" json:"providerRef"`
	Amount        float64    `gorm:"column:amount" json:"amount"`
	Currency      string     `gorm:"column:currency;default:NGN" json:"currency"`
	Status        string     `gorm:"column:status" json:"status"`
	StatementDate *time.Time `gorm:"column:statementDate" json:"statementDate"`
	Description   string     `gorm:"column:description" json:"description"`
	ImportedBy    *string    `gorm:"column:importedBy" json:"importedBy"`
	CreatedAt     time.Time  `gorm:"column:createdAt" json:"createdAt"`
}

func (ReconciliationStatementRow) TableName() string {
	return "ReconciliationStatementRow"
}

// ReconciliationResolution records that an admin has reviewed a reconciliation
// row. RowKey is stable per row ("bank_transfer:12", "statement:34", ...),
// including rows derived on the fly that have no table of their own.
type ReconciliationResolution struct {
	ID         uint      `gorm:"column:id;primaryKey" json:"id"`
	RowKey     string    `gorm:"column:rowKey;uniqueIndex" json:"rowKey"`
	Note       *string   `gorm:"column:note" json:"note"`
	ResolvedBy *string   `gorm:"column:resolvedBy" json:"resolvedBy"`
	ResolvedAt time.Time `gorm:"column:resolvedAt" json:"resolvedAt"`
	CreatedAt  time.Time `gorm:"column:createdAt" json:"createdAt"`
}

func (ReconciliationResolution) TableName() string {
	return "ReconciliationResolution"
}
