package models

import "time"

// LedgerJournalLine stores a single balanced debit or credit line for a WalletTransaction.
type LedgerJournalLine struct {
	ID            int       `gorm:"column:id;primaryKey" json:"id"`
	TransactionID int       `gorm:"column:transactionId;index" json:"transactionId"`
	TrxRef        string    `gorm:"column:trx_ref;index;size:128" json:"trx_ref"`
	AccountCode   string    `gorm:"column:accountCode;size:32" json:"accountCode"`
	AccountName   string    `gorm:"column:accountName;size:128" json:"accountName"`
	AccountType   string    `gorm:"column:accountType;size:32" json:"accountType"` // Platform | Checking | Savings
	Debit         float64   `gorm:"column:debit;default:0" json:"debit"`
	Credit        float64   `gorm:"column:credit;default:0" json:"credit"`
	Currency      string    `gorm:"column:currency;size:16;default:NGN" json:"currency"`
	CreatedAt     time.Time `gorm:"column:createdAt" json:"createdAt"`
}

func (LedgerJournalLine) TableName() string {
	return "LedgerJournalLine"
}
