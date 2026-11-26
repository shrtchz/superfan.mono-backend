package models

import "time"

// LedgerPeriodClose records that an accounting period (calendar month) has
// been closed and locked. Totals are snapshotted at close time so the period
// pack is immutable even after later activity.
type LedgerPeriodClose struct {
	ID                       uint      `gorm:"column:id;primaryKey" json:"id"`
	Period                   string    `gorm:"column:period;uniqueIndex;size:7" json:"period"`
	ClosedBy                 string    `gorm:"column:closedBy;size:128" json:"closedBy"`
	ClosedAt                 time.Time `gorm:"column:closedAt" json:"closedAt"`
	Note                     *string   `gorm:"column:note" json:"note"`
	JournalDebits            float64   `gorm:"column:journalDebits" json:"journalDebits"`
	JournalCredits           float64   `gorm:"column:journalCredits" json:"journalCredits"`
	WalletChecking           float64   `gorm:"column:walletChecking" json:"walletChecking"`
	WalletSavings            float64   `gorm:"column:walletSavings" json:"walletSavings"`
	LedgerChecking           float64   `gorm:"column:ledgerChecking" json:"ledgerChecking"`
	LedgerSavings            float64   `gorm:"column:ledgerSavings" json:"ledgerSavings"`
	ReconciliationExceptions int64     `gorm:"column:reconciliationExceptions" json:"reconciliationExceptions"`
	PendingApprovals         int64     `gorm:"column:pendingApprovals" json:"pendingApprovals"`
	TotalRevenue             float64   `gorm:"column:totalRevenue" json:"totalRevenue"`
	CreatedAt                time.Time `gorm:"column:createdAt" json:"createdAt"`
}

func (LedgerPeriodClose) TableName() string {
	return "LedgerPeriodClose"
}
