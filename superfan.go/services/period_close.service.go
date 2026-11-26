package services

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"quiz.superfan.com/apis/models"
	"quiz.superfan.com/apis/services/accounting"

	"gorm.io/gorm"
)

var (
	ErrPeriodInvalid       = errors.New("invalid accounting period")
	ErrPeriodAlreadyClosed = errors.New("accounting period is already closed")
	ErrPeriodCloseBlocked  = errors.New("period close is blocked by unresolved checks")
	ErrPeriodLocked        = errors.New("accounting period is locked")
)

type PeriodCloseCheck struct {
	Key      string `json:"key"`
	Label    string `json:"label"`
	Detail   string `json:"detail"`
	Complete bool   `json:"complete"`
}

type PeriodTrialBalanceRow struct {
	AccountCode string  `json:"accountCode"`
	AccountName string  `json:"accountName"`
	AccountType string  `json:"accountType"`
	Debit       float64 `json:"debit"`
	Credit      float64 `json:"credit"`
	Net         float64 `json:"net"`
}

type PeriodCloseReport struct {
	Period              string                  `json:"period"`
	Label               string                  `json:"label"`
	Closed              bool                    `json:"closed"`
	ClosedBy            string                  `json:"closedBy,omitempty"`
	ClosedAt            string                  `json:"closedAt,omitempty"`
	Checks              []PeriodCloseCheck      `json:"checks"`
	JournalDebits       float64                 `json:"journalDebits"`
	JournalCredits      float64                 `json:"journalCredits"`
	JournalDiff         float64                 `json:"journalDiff"`
	WalletChecking      float64                 `json:"walletChecking"`
	WalletSavings       float64                 `json:"walletSavings"`
	LedgerChecking      float64                 `json:"ledgerChecking"`
	LedgerSavings       float64                 `json:"ledgerSavings"`
	CheckingDiff        float64                 `json:"checkingDiff"`
	SavingsDiff         float64                 `json:"savingsDiff"`
	ReconExceptions     int64                   `json:"reconExceptions"`
	PendingApprovals    int64                   `json:"pendingApprovals"`
	MissingJournalCount int64                   `json:"missingJournalCount"`
	TotalRevenue        float64                 `json:"totalRevenue"`
	TrialBalance        []PeriodTrialBalanceRow `json:"trialBalance"`
}

type ClosePeriodInput struct {
	Period   string
	ClosedBy string
	Note     string
}

func (s *ledgerServiceImpl) GetPeriodCloseReport(ctx context.Context, period string) (*PeriodCloseReport, error) {
	start, label, err := parseAccountingPeriod(period)
	if err != nil {
		return nil, err
	}
	end := start.AddDate(0, 1, 0)
	report := &PeriodCloseReport{
		Period: start.Format("2006-01"),
		Label:  label,
	}

	var closed models.LedgerPeriodClose
	if err := s.db.WithContext(ctx).Where(`"period" = ?`, report.Period).First(&closed).Error; err == nil {
		report.Closed = true
		report.ClosedBy = closed.ClosedBy
		report.ClosedAt = closed.ClosedAt.UTC().Format(time.RFC3339)
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	var totals struct {
		Debits  float64
		Credits float64
	}
	if err := s.db.WithContext(ctx).Model(&models.LedgerJournalLine{}).
		Select(`COALESCE(SUM(debit), 0) AS debits, COALESCE(SUM(credit), 0) AS credits`).
		Where(`"createdAt" >= ? AND "createdAt" < ?`, start, end).
		Scan(&totals).Error; err != nil {
		return nil, err
	}
	report.JournalDebits = round2(totals.Debits)
	report.JournalCredits = round2(totals.Credits)
	report.JournalDiff = round2(totals.Debits - totals.Credits)

	if err := s.db.WithContext(ctx).Model(&models.LedgerJournalLine{}).
		Select(`"accountCode" AS account_code, MAX("accountName") AS account_name, MAX("accountType") AS account_type, COALESCE(SUM(debit), 0) AS debit, COALESCE(SUM(credit), 0) AS credit`).
		Where(`"createdAt" >= ? AND "createdAt" < ?`, start, end).
		Group(`"accountCode"`).
		Order(`"accountCode"`).
		Scan(&report.TrialBalance).Error; err != nil {
		return nil, err
	}
	for index := range report.TrialBalance {
		report.TrialBalance[index].Debit = round2(report.TrialBalance[index].Debit)
		report.TrialBalance[index].Credit = round2(report.TrialBalance[index].Credit)
		report.TrialBalance[index].Net = round2(report.TrialBalance[index].Credit - report.TrialBalance[index].Debit)
		if strings.HasPrefix(report.TrialBalance[index].AccountCode, "4") {
			report.TotalRevenue += report.TrialBalance[index].Net
		}
	}
	report.TotalRevenue = round2(report.TotalRevenue)

	reconciliation, err := s.ListReconciliation(1, 1, "Exception", "")
	if err != nil {
		return nil, err
	}
	report.ReconExceptions = reconciliation.Total

	if err := s.db.WithContext(ctx).Model(&models.LedgerApproval{}).
		Where(`UPPER(COALESCE("status", '')) = ?`, "AWAITING APPROVAL").
		Count(&report.PendingApprovals).Error; err != nil {
		return nil, err
	}

	if err := s.db.WithContext(ctx).Model(&models.WalletTransaction{}).
		Where(`"createdAt" >= ? AND "createdAt" < ?`, start, end).
		Where(`UPPER(COALESCE("status", '')) IN ?`, []string{"SUCCESS", "COMPLETED"}).
		Where(`NOT EXISTS (SELECT 1 FROM "LedgerJournalLine" jl WHERE jl."transactionId" = "WalletTransaction".id)`).
		Count(&report.MissingJournalCount).Error; err != nil {
		return nil, err
	}

	tieOut, err := accounting.ReconcileWalletsAndLedger(ctx, s.db)
	if err != nil {
		return nil, err
	}
	report.WalletChecking = tieOut.WalletCheckingTotal
	report.WalletSavings = tieOut.WalletSavingsTotal
	report.LedgerChecking = tieOut.LedgerCheckingLiab
	report.LedgerSavings = tieOut.LedgerSavingsLiab
	report.CheckingDiff = tieOut.CheckingDiff
	report.SavingsDiff = tieOut.SavingsDiff

	report.Checks = buildPeriodCloseChecks(report, tieOut.JournalBalanced)
	return report, nil
}

func (s *ledgerServiceImpl) ClosePeriod(ctx context.Context, input ClosePeriodInput) (*models.LedgerPeriodClose, error) {
	start, _, err := parseAccountingPeriod(input.Period)
	if err != nil {
		return nil, err
	}
	closedBy := strings.TrimSpace(input.ClosedBy)
	if closedBy == "" {
		return nil, fmt.Errorf("%w: closedBy is required", ErrPeriodInvalid)
	}
	now := time.Now().UTC()
	currentMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	if !start.Before(currentMonth) {
		return nil, fmt.Errorf("%w: cannot close the current or a future period", ErrPeriodInvalid)
	}

	report, err := s.GetPeriodCloseReport(ctx, start.Format("2006-01"))
	if err != nil {
		return nil, err
	}
	if report.Closed {
		return nil, ErrPeriodAlreadyClosed
	}
	for _, check := range report.Checks {
		if !check.Complete {
			return nil, fmt.Errorf("%w: %s", ErrPeriodCloseBlocked, check.Label)
		}
	}

	record := models.LedgerPeriodClose{
		Period:                   report.Period,
		ClosedBy:                 closedBy,
		ClosedAt:                 now,
		Note:                     optionalString(input.Note),
		JournalDebits:            report.JournalDebits,
		JournalCredits:           report.JournalCredits,
		WalletChecking:           report.WalletChecking,
		WalletSavings:            report.WalletSavings,
		LedgerChecking:           report.LedgerChecking,
		LedgerSavings:            report.LedgerSavings,
		ReconciliationExceptions: report.ReconExceptions,
		PendingApprovals:         report.PendingApprovals,
		TotalRevenue:             report.TotalRevenue,
		CreatedAt:                now,
	}
	if err := s.db.WithContext(ctx).Create(&record).Error; err != nil {
		if isUniqueViolation(err) {
			return nil, ErrPeriodAlreadyClosed
		}
		return nil, err
	}
	return &record, nil
}

func (s *ledgerServiceImpl) ListClosedPeriods(ctx context.Context) ([]models.LedgerPeriodClose, error) {
	var periods []models.LedgerPeriodClose
	if err := s.db.WithContext(ctx).
		Order(`"period" DESC`).
		Find(&periods).Error; err != nil {
		return nil, err
	}
	return periods, nil
}

// periodLocked reports whether the calendar month containing "at" is closed.
func (s *ledgerServiceImpl) periodLocked(at time.Time) (bool, error) {
	if s.db == nil {
		return false, nil
	}
	var count int64
	if err := s.db.Model(&models.LedgerPeriodClose{}).
		Where(`"period" = ?`, at.UTC().Format("2006-01")).
		Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

func parseAccountingPeriod(period string) (time.Time, string, error) {
	trimmed := strings.TrimSpace(period)
	if trimmed == "" {
		now := time.Now().UTC()
		start := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC).AddDate(0, -1, 0)
		return start, start.Format("January 2006"), nil
	}
	parsed, err := time.Parse("2006-01", trimmed)
	if err != nil {
		return time.Time{}, "", fmt.Errorf("%w: expected YYYY-MM, got %q", ErrPeriodInvalid, period)
	}
	start := time.Date(parsed.Year(), parsed.Month(), 1, 0, 0, 0, 0, time.UTC)
	return start, start.Format("January 2006"), nil
}

func buildPeriodCloseChecks(report *PeriodCloseReport, globalJournalBalanced bool) []PeriodCloseCheck {
	periodBalanced := math.Abs(report.JournalDiff) < 0.005
	walletsTieOut := math.Abs(report.CheckingDiff) < 0.005 && math.Abs(report.SavingsDiff) < 0.005
	journalCoverage := report.MissingJournalCount == 0

	trialDetail := fmt.Sprintf("Debits %s = credits %s", formatNairaAmount(report.JournalDebits), formatNairaAmount(report.JournalCredits))
	if !periodBalanced {
		trialDetail = fmt.Sprintf("Out by %s", formatNairaAmount(report.JournalDiff))
	} else if !globalJournalBalanced {
		trialDetail = "Period balances, but earlier journal entries are out of balance"
	}

	tieOutDetail := "Checking and Savings wallets match the general ledger"
	if !walletsTieOut {
		tieOutDetail = fmt.Sprintf(
			"Checking differs by %s · Savings differs by %s",
			formatNairaAmount(report.CheckingDiff),
			formatNairaAmount(report.SavingsDiff),
		)
	}

	reconDetail := "No open exceptions"
	if report.ReconExceptions > 0 {
		reconDetail = fmt.Sprintf("%d exception(s) still open in Reconciliation", report.ReconExceptions)
	}

	approvalsDetail := "Approvals queue is empty"
	if report.PendingApprovals > 0 {
		approvalsDetail = fmt.Sprintf("%d request(s) awaiting approval", report.PendingApprovals)
	}

	coverageDetail := "Every completed transaction has balanced journal lines"
	if !journalCoverage {
		coverageDetail = fmt.Sprintf("%d completed transaction(s) have no journal lines", report.MissingJournalCount)
	}

	return []PeriodCloseCheck{
		{Key: "trial_balance", Label: "Trial balance is balanced", Detail: trialDetail, Complete: periodBalanced && globalJournalBalanced},
		{Key: "wallet_tie_out", Label: "User wallets tie out to the general ledger", Detail: tieOutDetail, Complete: walletsTieOut},
		{Key: "reconciliation", Label: "All reconciliation exceptions resolved", Detail: reconDetail, Complete: report.ReconExceptions == 0},
		{Key: "approvals", Label: "No adjustments awaiting approval", Detail: approvalsDetail, Complete: report.PendingApprovals == 0},
		{Key: "journal_coverage", Label: "Journal entries cover every ledger transaction", Detail: coverageDetail, Complete: journalCoverage},
	}
}

func formatNairaAmount(value float64) string {
	sign := ""
	if value < 0 {
		sign = "-"
		value = math.Abs(value)
	}
	base := strconv.FormatFloat(math.Round(value*100)/100, 'f', 2, 64)
	parts := strings.SplitN(base, ".", 2)
	whole := parts[0]
	grouped := ""
	for index, digit := range whole {
		if index > 0 && (len(whole)-index)%3 == 0 {
			grouped += ","
		}
		grouped += string(digit)
	}
	fraction := ""
	if len(parts) == 2 {
		fraction = "." + parts[1]
	}
	return fmt.Sprintf("%s₦%s%s", sign, grouped, fraction)
}
