package services

import (
	"context"
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"

	"quiz.superfan.com/apis/models"
	"quiz.superfan.com/apis/services/accounting"

	"gorm.io/gorm"
)

type LedgerService interface {
	GetLedgerEntries(page, limit int, filters map[string]interface{}, search string) ([]models.WalletTransaction, int64, *models.LedgerSummary, error)
	GetLedgerSummary(filters map[string]interface{}, search string) (*models.LedgerSummary, error)
	GetReconciliation(ctx context.Context) (*accounting.ReconciliationReport, error)
	CreateLedgerApproval(input CreateLedgerApprovalInput) (*models.LedgerApproval, error)
	ListLedgerApprovals(page, limit int, status, search string) ([]models.LedgerApproval, int64, error)
	ApproveLedgerApproval(id uint, reviewer, note string) (*models.LedgerApproval, error)
	RejectLedgerApproval(id uint, reviewer, note string) (*models.LedgerApproval, error)
	ListReconciliation(page, limit int, status, search string) (*ReconciliationResult, error)
	ResolveReconciliation(rowKey, note, resolvedBy string) (*models.ReconciliationResolution, error)
	ImportReconciliationRows(sourceType, source, importedBy string, rows []ReconciliationImportRow) (int, error)
	GetPeriodCloseReport(ctx context.Context, period string) (*PeriodCloseReport, error)
	ClosePeriod(ctx context.Context, input ClosePeriodInput) (*models.LedgerPeriodClose, error)
	ListClosedPeriods(ctx context.Context) ([]models.LedgerPeriodClose, error)
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

// userNameMatchSQL matches ledger rows whose user (first/last/full/username)
// looks like the single bound LIKE pattern. Five placeholders.
const userNameMatchSQL = `"userId" IN (SELECT id FROM "User" WHERE "firstName" ILIKE ? OR "lastName" ILIKE ? OR username ILIKE ? ` +
	`OR ("firstName" || ' ' || "lastName") ILIKE ? OR ("lastName" || ' ' || "firstName") ILIKE ?)`

func (s *ledgerServiceImpl) baseQuery(filters map[string]interface{}, search string) *gorm.DB {
	// base has no ORDER BY — ORDER BY breaks PostgreSQL COUNT(*) subqueries.
	// We apply the order only for the final Find step.
	base := s.db.Model(&models.WalletTransaction{})

	if search != "" {
		searchStr := "%" + search + "%"
		base = base.Where(
			`description ILIKE ? OR trx_ref ILIKE ? OR username ILIKE ? OR `+userNameMatchSQL,
			searchStr, searchStr, searchStr, searchStr, searchStr, searchStr, searchStr, searchStr,
		)
	}

	for k, v := range filters {
		value := strings.TrimSpace(fmt.Sprint(v))
		if value == "" {
			continue
		}
		switch k {
		case "statuses":
			base = base.Where(`UPPER(COALESCE("status", '')) IN ?`, upperAll(splitCSV(value)))
		case "transactionTypes":
			base = base.Where(`UPPER(COALESCE("transactionType", '')) IN ?`, upperAll(splitCSV(value)))
		case "currencies":
			base = base.Where(`UPPER(COALESCE("currency", '')) IN ?`, upperAll(splitCSV(value)))
		case "accountType", "accountTypes":
			base = base.Where(`UPPER(COALESCE("account_type", '')) IN ?`, upperAll(splitCSV(value)))
		case "accounts":
			if ors := accountConditions(splitCSV(value)); len(ors) > 0 {
				base = base.Where("(" + strings.Join(ors, " OR ") + ")")
			}
		case "providers":
			if ors, args := providerConditions(splitCSV(value)); len(ors) > 0 {
				base = base.Where("("+strings.Join(ors, " OR ")+")", args...)
			}
		case "user":
			// Accepts a numeric user id, a name, or a username.
			if id, err := strconv.Atoi(value); err == nil {
				base = base.Where(`"userId" = ?`, id)
			} else {
				like := "%" + value + "%"
				base = base.Where(userNameMatchSQL, like, like, like, like, like)
			}
		case "dateFrom":
			if ts, ok := parseLedgerDate(value, false); ok {
				base = base.Where(`"createdAt" >= ?`, ts)
			}
		case "dateTo":
			if ts, ok := parseLedgerDate(value, true); ok {
				base = base.Where(`"createdAt" <= ?`, ts)
			}
		default:
			base = base.Where(quoteColumn(k)+" = ?", v)
		}
	}
	return base
}

// accountConditions maps the UI's account names onto the stored account_type
// values. "Platform" rows have no account_type.
func accountConditions(names []string) []string {
	var ors []string
	for _, name := range upperAll(names) {
		switch name {
		case "CHECKING", "PERSONAL":
			ors = append(ors, `UPPER(COALESCE("account_type", '')) IN ('CHECKING', 'PERSONAL')`)
		case "SAVINGS", "GOLD":
			ors = append(ors, `UPPER(COALESCE("account_type", '')) IN ('SAVINGS', 'GOLD')`)
		case "PLATFORM":
			ors = append(ors, `UPPER(COALESCE("account_type", '')) IN ('', 'PLATFORM')`)
		}
	}
	return ors
}

// providerConditions best-effort maps providers onto the columns the ledger
// actually stores: explicit provider column, transaction refs (e.g. "MNFY|..."),
// and bank transfers carry the bank name. In-app rows are internal wallet transactions.
func providerConditions(names []string) ([]string, []interface{}) {
	var ors []string
	var args []interface{}
	ref := `COALESCE("trx_ref", "reference", '')`
	bank := `COALESCE("bank_name", '')`
	prov := `UPPER(COALESCE("provider", ''))`
	add := func(cond string, arg interface{}) {
		ors = append(ors, cond)
		if arg != nil {
			args = append(args, arg)
		}
	}
	for _, name := range upperAll(names) {
		switch name {
		case "MONNIFY":
			add(prov+` = ?`, "MONNIFY")
			add(ref+` ILIKE ?`, "MNFY%")
			add(bank+` ILIKE ?`, "%MONNIFY%")
		case "FLUTTERWAVE":
			add(prov+` = ?`, "FLUTTERWAVE")
			add(ref+` ILIKE ?`, "FLW%")
			add(bank+` ILIKE ?`, "%FLUTTERWAVE%")
		case "BITNOB":
			add(prov+` = ?`, "BITNOB")
			add(ref+` ILIKE ?`, "BIT%")
			add(bank+` ILIKE ?`, "%BITNOB%")
		case "BACHS":
			add(prov+` = ?`, "BACHS")
			add(ref+` ILIKE ?`, "BACHS%")
			add(bank+` ILIKE ?`, "%BACHS%")
		case "IN-APP", "IN APP", "INAPP":
			add(prov+` = ?`, "IN-APP")
			add(`(`+prov+` = '' AND COALESCE("payment_method", '') = '' AND `+ref+` NOT ILIKE 'MNFY%' AND `+ref+` NOT ILIKE 'FLW%' AND `+ref+` NOT ILIKE 'BIT%' AND `+ref+` NOT ILIKE 'BACHS%')`, nil)
		}
	}
	return ors, args
}

func splitCSV(value string) []string {
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

func upperAll(values []string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		out = append(out, strings.ToUpper(value))
	}
	return out
}

// parseLedgerDate accepts YYYY-MM-DD or RFC3339; endOfDay widens a bare date to
// 23:59:59.999999999 so the "to" filter is inclusive.
func parseLedgerDate(value string, endOfDay bool) (time.Time, bool) {
	if ts, err := time.Parse(time.RFC3339, value); err == nil {
		return ts, true
	}
	ts, err := time.Parse("2006-01-02", value)
	if err != nil {
		return time.Time{}, false
	}
	if endOfDay {
		return ts.Add(24*time.Hour - time.Nanosecond), true
	}
	return ts, true
}

func (s *ledgerServiceImpl) GetLedgerEntries(page, limit int, filters map[string]interface{}, search string) ([]models.WalletTransaction, int64, *models.LedgerSummary, error) {
	if s.db == nil {
		return nil, 0, nil, fmt.Errorf("database connection is not initialised (DATABASE_URL may not be set)")
	}

	var entries []models.WalletTransaction
	var total int64

	base := s.baseQuery(filters, search)

	// --- Count (fresh session fork, no ORDER BY) ---
	if err := base.Session(&gorm.Session{}).Count(&total).Error; err != nil {
		return nil, 0, nil, fmt.Errorf("count query failed: %w", err)
	}

	summary, err := s.computeSummary(base)
	if err != nil {
		return nil, 0, nil, err
	}

	// --- Paginated rows (fresh session fork, with ORDER BY) ---
	offset := (page - 1) * limit
	err = base.Session(&gorm.Session{}).
		Order(`"createdAt" DESC`).
		Offset(offset).
		Limit(limit).
		Find(&entries).Error
	if err != nil {
		return nil, 0, nil, fmt.Errorf("entries query failed: %w", err)
	}

	s.attachClientNames(entries)
	s.attachJournalLines(entries)

	return entries, total, summary, nil
}

func (s *ledgerServiceImpl) attachJournalLines(entries []models.WalletTransaction) {
	if len(entries) == 0 || s.db == nil {
		return
	}
	ids := make([]int, 0, len(entries))
	for _, e := range entries {
		ids = append(ids, e.ID)
	}
	var lines []models.LedgerJournalLine
	if err := s.db.Where(`"transactionId" IN ?`, ids).Order("id ASC").Find(&lines).Error; err != nil {
		log.Printf("[LEDGER] journal line lookup failed: %v", err)
		return
	}
	byTx := make(map[int][]models.LedgerJournalLine, len(entries))
	for _, l := range lines {
		byTx[l.TransactionID] = append(byTx[l.TransactionID], l)
	}
	for i := range entries {
		if jLines, ok := byTx[entries[i].ID]; ok {
			entries[i].JournalLines = jLines
		}
	}
}

// attachClientNames fills the display-only ClientName field by resolving the
// page's userIds against the User table; WalletTransaction.username is usually
// empty because names live on User.
func (s *ledgerServiceImpl) attachClientNames(entries []models.WalletTransaction) {
	if len(entries) == 0 {
		return
	}
	seen := make(map[int]struct{}, len(entries))
	ids := make([]int, 0, len(entries))
	for _, entry := range entries {
		if entry.UserID == 0 {
			continue
		}
		if _, ok := seen[entry.UserID]; ok {
			continue
		}
		seen[entry.UserID] = struct{}{}
		ids = append(ids, entry.UserID)
	}
	if len(ids) == 0 {
		return
	}

	var users []models.User
	if err := s.db.Select(`id, "firstName", "lastName", username`).Where("id IN ?", ids).Find(&users).Error; err != nil {
		log.Printf("[LEDGER] client name lookup failed: %v", err)
		return
	}

	names := make(map[int]string, len(users))
	for _, user := range users {
		name := strings.TrimSpace(strings.TrimSpace(user.FirstName) + " " + strings.TrimSpace(user.LastName))
		if name == "" {
			name = strings.TrimSpace(user.Username)
		}
		names[user.ID] = name
	}

	for i := range entries {
		if entries[i].UserID <= 0 || isSystemRewardEntry(&entries[i]) || strings.EqualFold(strings.TrimSpace(entries[i].ClientName), accounting.ProviderInApp) {
			entries[i].ClientName = accounting.ProviderInApp
			continue
		}
		if resolved := names[entries[i].UserID]; resolved != "" {
			entries[i].ClientName = resolved
		}
	}
}

func isSystemRewardEntry(entry *models.WalletTransaction) bool {
	if entry == nil {
		return false
	}
	txType := strings.ToUpper(strings.TrimSpace(derefStr(entry.TransactionType)))
	if txType == "REWARD" || txType == "BONUS" {
		return true
	}
	ref := strings.ToUpper(strings.TrimSpace(derefStr(entry.TrxRef)))
	return strings.HasPrefix(ref, "QUIZ_") ||
		strings.HasPrefix(ref, "ADSREW-") ||
		strings.HasPrefix(ref, "REFERRAL") ||
		strings.HasPrefix(ref, "LIVE_QUIZ_")
}

func derefStr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func (s *ledgerServiceImpl) GetReconciliation(ctx context.Context) (*accounting.ReconciliationReport, error) {
	return accounting.ReconcileWalletsAndLedger(ctx, s.db)
}

func (s *ledgerServiceImpl) GetLedgerSummary(filters map[string]interface{}, search string) (*models.LedgerSummary, error) {
	if s.db == nil {
		return nil, fmt.Errorf("database connection is not initialised (DATABASE_URL may not be set)")
	}
	return s.computeSummary(s.baseQuery(filters, search))
}

func (s *ledgerServiceImpl) computeSummary(base *gorm.DB) (*models.LedgerSummary, error) {
	var summary models.LedgerSummary
	if err := base.Session(&gorm.Session{}).Select(
		`COALESCE(SUM(CASE WHEN ("transactionType" IN ('Deposit', 'Reward', 'Bonus', 'FUNDING') OR "type" IN ('Credit', 'credit', 'CREDIT')) AND status IN ('SUCCESS', 'Completed') AND currency = 'NGN' THEN amount ELSE 0 END), 0) as total_credits, ` +
			`COALESCE(SUM(CASE WHEN ("transactionType" IN ('Withdrawal', 'WITHDRAWAL') OR "type" IN ('Debit', 'debit', 'DEBIT')) AND status IN ('SUCCESS', 'Completed') AND currency = 'NGN' THEN amount ELSE 0 END), 0) as total_debits, ` +
			`COALESCE(SUM(CASE WHEN status = 'PENDING' AND currency = 'NGN' THEN amount ELSE 0 END), 0) as pending_settlement, ` +
			`COALESCE(SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END), 0) as pending_count, ` +
			`COALESCE(SUM(CASE WHEN "transactionType" IN ('Deposit', 'FUNDING') AND status IN ('SUCCESS', 'Completed') AND currency = 'NGN' THEN amount ELSE 0 END), 0) as cash_bank, ` +
			`COALESCE(SUM(CASE WHEN status = 'PENDING' AND "type" IN ('Credit', 'credit', 'CREDIT') AND currency = 'NGN' THEN amount ELSE 0 END), 0) as provider_clearing, ` +
			`COALESCE(SUM(CASE WHEN "transactionType" = 'Fee' AND status IN ('SUCCESS', 'Completed') AND currency = 'NGN' THEN amount ELSE 0 END), 0) as platform_revenue`,
	).Scan(&summary).Error; err != nil {
		return nil, fmt.Errorf("summary query failed: %w", err)
	}

	// Wallet balances are the source of truth for amounts owed to users.
	summary.CheckingWalletLiab = s.sumOrZero(`SELECT COALESCE(SUM("checkingBalance"), 0) AS total FROM "Wallet"`, "checking wallet liability")
	summary.SavingsWalletLiab = s.sumOrZero(`SELECT COALESCE(SUM("savingsBalance"), 0) AS total FROM "Wallet"`, "savings wallet liability")

	summary.RevenueAds = s.sumOrZero(
		`SELECT COALESCE(SUM("totalFee"), 0) AS total FROM "AdCampaign" WHERE UPPER(COALESCE("paymentStatus", '')) IN ('PAID', 'SUCCESS', 'COMPLETED')`,
		"ad revenue",
	)
	summary.RevenueSubs = s.sumOrZero(
		`SELECT COALESCE(SUM(amount), 0) AS total FROM "SubscriptionDebit" WHERE UPPER(COALESCE(status, '')) = 'SUCCESS'`,
		"subscription revenue",
	)
	summary.RevenueShop = s.sumOrZero(
		`SELECT COALESCE(SUM("totalAmount"), 0) AS total FROM "Order" WHERE UPPER(COALESCE("paymentStatus", '')) = 'PAID' AND UPPER(COALESCE(status::text, '')) <> 'CANCELLED'`,
		"shop revenue",
	)
	summary.RewardsExpense = s.sumOrZero(
		`SELECT COALESCE(SUM(amount), 0) AS total FROM "Reward" WHERE currency = 'NGN' AND status::text IN ('PAID_OUT', 'SUCCESS', 'COMPLETED')`,
		"rewards expense",
	)

	var rewards []struct {
		Type   string
		Amount float64
	}
	err := s.db.Raw(
		`SELECT "type", COALESCE(SUM(amount), 0) AS amount FROM "Reward" ` +
			`WHERE currency = 'NGN' AND status::text IN ('PAID_OUT', 'SUCCESS', 'COMPLETED') ` +
			`GROUP BY "type" ORDER BY amount DESC LIMIT 2`,
	).Scan(&rewards).Error
	if err != nil {
		log.Printf("[LEDGER] reward breakdown query failed: %v", err)
	}
	summary.RewardBreakdown = make([]models.LedgerCategoryAmount, 0, len(rewards))
	for _, reward := range rewards {
		summary.RewardBreakdown = append(summary.RewardBreakdown, models.LedgerCategoryAmount{
			Label:  prettyRewardLabel(reward.Type),
			Amount: reward.Amount,
		})
	}

	return &summary, nil
}

// sumOrZero runs a single-column SUM query, tolerating a missing table/column
// so one absent table cannot break the whole ledger summary.
func (s *ledgerServiceImpl) sumOrZero(sql, label string) float64 {
	var row struct{ Total float64 }
	if err := s.db.Raw(sql).Scan(&row).Error; err != nil {
		log.Printf("[LEDGER] %s query failed: %v", label, err)
		return 0
	}
	return row.Total
}

func prettyRewardLabel(raw string) string {
	key := strings.ToLower(strings.TrimSpace(raw))
	switch {
	case key == "":
		return "Reward"
	case strings.Contains(key, "jackpot"):
		return "Jackpot"
	case strings.Contains(key, "live_quiz") || strings.Contains(key, "live-quiz"):
		return "Live Quiz"
	case strings.Contains(key, "quiz"):
		return "Test Quiz"
	case strings.Contains(key, "versus"):
		return "Versus"
	case strings.Contains(key, "referral"):
		return "Referral"
	case strings.Contains(key, "ad"):
		return "Ads"
	}
	words := strings.FieldsFunc(key, func(r rune) bool { return r == '_' || r == '-' || r == ' ' })
	for i, word := range words {
		words[i] = strings.ToUpper(word[:1]) + word[1:]
	}
	return strings.Join(words, " ")
}
