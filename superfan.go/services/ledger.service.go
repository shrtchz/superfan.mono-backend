package services

import (
	"fmt"
	"quiz.superfan.com/apis/models"
	"gorm.io/gorm"
)

type LedgerService interface {
	GetLedgerEntries(page, limit int, filters map[string]interface{}, search string) ([]models.WalletTransaction, int64, *models.LedgerSummary, error)
}

type ledgerServiceImpl struct {
	db *gorm.DB
}

func NewLedgerService(db *gorm.DB) LedgerService {
	return &ledgerServiceImpl{db: db}
}

// columnQuote wraps camelCase column names in double-quotes so PostgreSQL
// treats them as case-sensitive identifiers. Without this, PostgreSQL
// lowercases unquoted names and the WHERE clause matches nothing.
var quotedColumns = map[string]string{
	"transactionType": `"transactionType"`,
	"userId":          `"userId"`,
	"username":        `"username"`,
	"status":          `"status"`,
	"currency":        `"currency"`,
}

func quoteColumn(col string) string {
	if q, ok := quotedColumns[col]; ok {
		return q
	}
	return fmt.Sprintf(`"%s"`, col)
}

func (s *ledgerServiceImpl) GetLedgerEntries(page, limit int, filters map[string]interface{}, search string) ([]models.WalletTransaction, int64, *models.LedgerSummary, error) {
	if s.db == nil {
		return nil, 0, nil, fmt.Errorf("database connection is not initialised (DATABASE_URL may not be set)")
	}

	var entries []models.WalletTransaction
	var total int64

	// base has no ORDER BY — ORDER BY breaks PostgreSQL COUNT(*) subqueries.
	// We apply the order only for the final Find step.
	base := s.db.Model(&models.WalletTransaction{})

	if search != "" {
		searchStr := "%" + search + "%"
		base = base.Where(`description ILIKE ? OR trx_ref ILIKE ? OR username ILIKE ?`, searchStr, searchStr, searchStr)
	}

	for k, v := range filters {
		if v != "" {
			base = base.Where(quoteColumn(k)+" = ?", v)
		}
	}

	// --- Count (fresh session fork, no ORDER BY) ---
	if err := base.Session(&gorm.Session{}).Count(&total).Error; err != nil {
		return nil, 0, nil, fmt.Errorf("count query failed: %w", err)
	}

	// --- Aggregate summary (fresh session fork) ---
	var summary models.LedgerSummary
	if err := base.Session(&gorm.Session{}).Select(
		`COALESCE(SUM(CASE WHEN ("transactionType" IN ('Deposit', 'Reward', 'Bonus', 'FUNDING') OR "type" IN ('Credit', 'credit', 'CREDIT')) AND status IN ('SUCCESS', 'Completed') AND currency = 'NGN' THEN amount ELSE 0 END), 0) as total_credits, ` +
			`COALESCE(SUM(CASE WHEN ("transactionType" IN ('Withdrawal', 'WITHDRAWAL') OR "type" IN ('Debit', 'debit', 'DEBIT')) AND status IN ('SUCCESS', 'Completed') AND currency = 'NGN' THEN amount ELSE 0 END), 0) as total_debits, ` +
			`COALESCE(SUM(CASE WHEN status = 'PENDING' AND currency = 'NGN' THEN amount ELSE 0 END), 0) as pending_settlement, ` +
			`COALESCE(SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END), 0) as pending_count, ` +
			`COALESCE(SUM(CASE WHEN "transactionType" IN ('Deposit', 'FUNDING') AND status IN ('SUCCESS', 'Completed') AND currency = 'NGN' THEN amount ELSE 0 END), 0) as cash_bank, ` +
			`COALESCE(SUM(CASE WHEN "type" IN ('Credit', 'credit', 'CREDIT') AND status IN ('SUCCESS', 'Completed') AND currency = 'NGN' AND LOWER(account_type) = 'personal' THEN amount ELSE 0 END), 0) as personal_wallet_liab, ` +
			`COALESCE(SUM(CASE WHEN "type" IN ('Credit', 'credit', 'CREDIT') AND status IN ('SUCCESS', 'Completed') AND currency = 'NGN' AND LOWER(account_type) = 'gold' THEN amount ELSE 0 END), 0) as gold_wallet_liab, ` +
			`COALESCE(SUM(CASE WHEN "transactionType" = 'Fee' AND status IN ('SUCCESS', 'Completed') AND currency = 'NGN' THEN amount ELSE 0 END), 0) as platform_revenue`,
	).Scan(&summary).Error; err != nil {
		return nil, 0, nil, fmt.Errorf("summary query failed: %w", err)
	}

	// --- Paginated rows (fresh session fork, with ORDER BY) ---
	offset := (page - 1) * limit
	err := base.Session(&gorm.Session{}).
		Order(`"createdAt" DESC`).
		Offset(offset).
		Limit(limit).
		Find(&entries).Error
	if err != nil {
		return nil, 0, nil, fmt.Errorf("entries query failed: %w", err)
	}

	return entries, total, &summary, nil
}
