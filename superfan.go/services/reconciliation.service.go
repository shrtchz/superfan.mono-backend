package services

import (
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"quiz.superfan.com/apis/models"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	reconciliationMaxSourceRows = 1000
	reconciliationMaxImportRows = 5000
)

var ErrReconciliationInvalid = errors.New("invalid reconciliation request")

type ReconciliationItem struct {
	RowKey          string   `json:"rowKey"`
	Date            string   `json:"date"`
	StatementSource string   `json:"statementSource"`
	ProviderBankRef string   `json:"providerBankRef"`
	StatementAmount float64  `json:"statementAmount"`
	Currency        string   `json:"currency"`
	LedgerEntry     string   `json:"ledgerEntry"`
	LedgerAmount    *float64 `json:"ledgerAmount"`
	Difference      float64  `json:"difference"`
	Status          string   `json:"status"`
	Reason          string   `json:"reason"`
	ResolutionNote  string   `json:"resolutionNote,omitempty"`
	ResolvedBy      string   `json:"resolvedBy,omitempty"`
}

type ReconciliationCounts struct {
	Matched    int `json:"matched"`
	Exceptions int `json:"exceptions"`
	InTransit  int `json:"inTransit"`
	Resolved   int `json:"resolved"`
}

type ReconciliationResult struct {
	Items  []ReconciliationItem `json:"items"`
	Total  int64                `json:"total"`
	Page   int                  `json:"page"`
	Limit  int                  `json:"limit"`
	Counts ReconciliationCounts `json:"counts"`
}

type ReconciliationImportRow struct {
	Reference   string  `json:"reference"`
	Amount      float64 `json:"amount"`
	Currency    string  `json:"currency"`
	Status      string  `json:"status"`
	Date        string  `json:"date"`
	Provider    string  `json:"provider"`
	Description string  `json:"description"`
}

type reconLedgerTx struct {
	ID        uint
	TrxRef    string
	Amount    float64
	Currency  string
	Status    string
	CreatedAt time.Time
}

type reconCandidate struct {
	item           ReconciliationItem
	sortTime       time.Time
	providerStatus string
}

func (s *ledgerServiceImpl) ListReconciliation(page, limit int, status, search string) (*ReconciliationResult, error) {
	if page < 1 {
		page = 1
	}
	if limit <= 0 {
		limit = 25
	}
	if limit > 100 {
		limit = 100
	}

	candidates, err := s.loadReconciliationCandidates()
	if err != nil {
		return nil, err
	}

	ledgerMap, err := s.lookupLedgerTransactions(candidates)
	if err != nil {
		return nil, err
	}

	resolutions, err := s.loadReconciliationResolutions()
	if err != nil {
		return nil, err
	}

	for index := range candidates {
		ref := strings.ToUpper(strings.TrimSpace(candidates[index].item.ProviderBankRef))
		ledger := ledgerMap[ref]
		itemStatus, reason := classifyReconciliation(candidates[index].providerStatus, candidates[index].item.StatementAmount, ledger)
		if ledger != nil {
			candidates[index].item.LedgerEntry = ledger.TrxRef
			amount := round2(ledger.Amount)
			candidates[index].item.LedgerAmount = &amount
			candidates[index].item.Difference = round2(candidates[index].item.StatementAmount - ledger.Amount)
		}
		candidates[index].item.Status = itemStatus
		candidates[index].item.Reason = reason
		if resolution, ok := resolutions[candidates[index].item.RowKey]; ok {
			candidates[index].item.Status = "Resolved"
			resolvedBy := ""
			if resolution.ResolvedBy != nil {
				resolvedBy = *resolution.ResolvedBy
			}
			note := ""
			if resolution.Note != nil {
				note = *resolution.Note
			}
			candidates[index].item.ResolvedBy = resolvedBy
			candidates[index].item.ResolutionNote = note
		}
	}

	searchTerm := strings.ToLower(strings.TrimSpace(search))
	filtered := make([]reconCandidate, 0, len(candidates))
	for _, candidate := range candidates {
		item := candidate.item
		if searchTerm != "" {
			haystack := strings.ToLower(strings.Join([]string{
				item.ProviderBankRef, item.StatementSource, item.LedgerEntry, item.Reason, item.ResolutionNote,
			}, " "))
			if !strings.Contains(haystack, searchTerm) {
				continue
			}
		}
		filtered = append(filtered, candidate)
	}

	counts := ReconciliationCounts{}
	for _, candidate := range filtered {
		switch candidate.item.Status {
		case "Matched":
			counts.Matched++
		case "Exception":
			counts.Exceptions++
		case "In transit":
			counts.InTransit++
		case "Resolved":
			counts.Resolved++
		}
	}

	statusFilter := strings.ToLower(strings.TrimSpace(status))
	if statusFilter != "" && statusFilter != "all" {
		kept := filtered[:0]
		for _, candidate := range filtered {
			if strings.EqualFold(candidate.item.Status, statusFilter) {
				kept = append(kept, candidate)
			}
		}
		filtered = kept
	}

	sort.SliceStable(filtered, func(i, j int) bool {
		return filtered[i].sortTime.After(filtered[j].sortTime)
	})

	total := int64(len(filtered))
	start := (page - 1) * limit
	if start > len(filtered) {
		start = len(filtered)
	}
	end := start + limit
	if end > len(filtered) {
		end = len(filtered)
	}

	items := make([]ReconciliationItem, 0, end-start)
	for _, candidate := range filtered[start:end] {
		items = append(items, candidate.item)
	}

	return &ReconciliationResult{
		Items:  items,
		Total:  total,
		Page:   page,
		Limit:  limit,
		Counts: counts,
	}, nil
}

func (s *ledgerServiceImpl) loadReconciliationCandidates() ([]reconCandidate, error) {
	candidates := make([]reconCandidate, 0, 256)

	var bankTransfers []models.BankTransfer
	if err := s.db.
		Where(`UPPER(COALESCE(CAST("status" AS TEXT), '')) IN ?`, []string{"PAID", "SUCCESS", "COMPLETED", "FAILED"}).
		Order(`"createdAt" DESC`).
		Limit(reconciliationMaxSourceRows).
		Find(&bankTransfers).Error; err != nil {
		return nil, err
	}
	for _, bankTx := range bankTransfers {
		ref := firstNonEmpty(bankTx.TransactionReference, bankTx.PaymentReference)
		paidAt := bankTx.RequestTime
		if bankTx.PaidAt != nil {
			paidAt = *bankTx.PaidAt
		} else if bankTx.CompletedAt != nil {
			paidAt = *bankTx.CompletedAt
		}
		provider := providerFromReference(ref)
		source := "Provider report"
		if provider != "" {
			source = provider + " report"
		}
		amount := bankTx.Amount
		if amount <= 0 {
			amount = bankTx.TotalPayable - bankTx.Fee
		}
		candidates = append(candidates, reconCandidate{
			sortTime:       paidAt,
			providerStatus: bankTx.Status,
			item: ReconciliationItem{
				RowKey:          fmt.Sprintf("bank_transfer:%d", bankTx.ID),
				Date:            formatReconDate(&paidAt),
				StatementSource: source,
				ProviderBankRef: ref,
				StatementAmount: round2(amount),
				Currency:        "NGN",
			},
		})
	}

	var cardFundings []models.CardFunding
	if err := s.db.Order(`"createdAt" DESC`).Limit(reconciliationMaxSourceRows).Find(&cardFundings).Error; err != nil {
		return nil, err
	}
	for _, funding := range cardFundings {
		provider := providerFromReference(funding.Reference)
		source := "Card funding"
		if provider != "" {
			source = provider + " card funding"
		}
		candidates = append(candidates, reconCandidate{
			sortTime:       funding.CreatedAt,
			providerStatus: funding.Status,
			item: ReconciliationItem{
				RowKey:          fmt.Sprintf("card_funding:%d", funding.ID),
				Date:            formatReconDate(&funding.CreatedAt),
				StatementSource: source,
				ProviderBankRef: funding.Reference,
				StatementAmount: round2(funding.Amount),
				Currency:        defaultCurrency(funding.Currency),
			},
		})
	}

	var payouts []models.Payout
	if err := s.db.Order(`"createdAt" DESC`).Limit(reconciliationMaxSourceRows).Find(&payouts).Error; err != nil {
		return nil, err
	}
	for _, payout := range payouts {
		source := "Payout"
		if payout.Provider != nil && strings.TrimSpace(*payout.Provider) != "" {
			source = *payout.Provider + " payout"
		} else if provider := providerFromReference(payout.Reference); provider != "" {
			source = provider + " payout"
		}
		ref := firstNonEmpty(payout.Reference, derefString(payout.ProviderRef))
		settled := payout.CreatedAt
		if payout.ProcessedAt != nil {
			settled = *payout.ProcessedAt
		}
		candidates = append(candidates, reconCandidate{
			sortTime:       settled,
			providerStatus: payout.Status,
			item: ReconciliationItem{
				RowKey:          fmt.Sprintf("payout:%d", payout.ID),
				Date:            formatReconDate(&settled),
				StatementSource: source,
				ProviderBankRef: ref,
				StatementAmount: round2(payout.Amount),
				Currency:        defaultCurrency(payout.Currency),
			},
		})
	}

	var statements []models.ReconciliationStatementRow
	if err := s.db.Order(`"createdAt" DESC`).Limit(reconciliationMaxSourceRows).Find(&statements).Error; err != nil {
		return nil, err
	}
	for _, statement := range statements {
		statementDate := statement.CreatedAt
		if statement.StatementDate != nil {
			statementDate = *statement.StatementDate
		}
		candidates = append(candidates, reconCandidate{
			sortTime:       statementDate,
			providerStatus: statement.Status,
			item: ReconciliationItem{
				RowKey:          fmt.Sprintf("statement:%d", statement.ID),
				Date:            formatReconDate(&statementDate),
				StatementSource: statement.Source,
				ProviderBankRef: statement.ProviderRef,
				StatementAmount: round2(statement.Amount),
				Currency:        defaultCurrency(statement.Currency),
			},
		})
	}

	return candidates, nil
}

func (s *ledgerServiceImpl) lookupLedgerTransactions(candidates []reconCandidate) (map[string]*reconLedgerTx, error) {
	unique := make(map[string]struct{})
	for _, candidate := range candidates {
		ref := strings.ToUpper(strings.TrimSpace(candidate.item.ProviderBankRef))
		if ref != "" {
			unique[ref] = struct{}{}
		}
	}
	refs := make([]string, 0, len(unique))
	for ref := range unique {
		refs = append(refs, ref)
	}

	ledgerMap := make(map[string]*reconLedgerTx, len(refs))
	const chunkSize = 500
	for start := 0; start < len(refs); start += chunkSize {
		end := start + chunkSize
		if end > len(refs) {
			end = len(refs)
		}
		var rows []models.WalletTransaction
		if err := s.db.
			Select(`id, "trx_ref", amount, currency, "status", "createdAt"`).
			Where(`UPPER(COALESCE("trx_ref", '')) IN ?`, refs[start:end]).
			Order(`"createdAt" DESC`).
			Find(&rows).Error; err != nil {
			return nil, err
		}
		for _, row := range rows {
			if row.TrxRef == nil {
				continue
			}
			key := strings.ToUpper(strings.TrimSpace(*row.TrxRef))
			if key == "" {
				continue
			}
			candidate := &reconLedgerTx{
				ID:        uint(row.ID),
				TrxRef:    strings.TrimSpace(*row.TrxRef),
				Amount:    row.Amount,
				Currency:  defaultCurrency(row.Currency),
				Status:    derefString(row.Status),
				CreatedAt: row.CreatedAt,
			}
			existing, ok := ledgerMap[key]
			if !ok || (isSettledStatus(candidate.Status) && !isSettledStatus(existing.Status)) {
				ledgerMap[key] = candidate
			}
		}
	}
	return ledgerMap, nil
}

func (s *ledgerServiceImpl) loadReconciliationResolutions() (map[string]models.ReconciliationResolution, error) {
	var resolutions []models.ReconciliationResolution
	if err := s.db.Find(&resolutions).Error; err != nil {
		return nil, err
	}
	byKey := make(map[string]models.ReconciliationResolution, len(resolutions))
	for _, resolution := range resolutions {
		byKey[resolution.RowKey] = resolution
	}
	return byKey, nil
}

func (s *ledgerServiceImpl) ResolveReconciliation(rowKey, note, resolvedBy string) (*models.ReconciliationResolution, error) {
	rowKey = strings.TrimSpace(rowKey)
	resolvedBy = strings.TrimSpace(resolvedBy)
	if rowKey == "" {
		return nil, fmt.Errorf("%w: row key is required", ErrReconciliationInvalid)
	}
	if resolvedBy == "" {
		return nil, fmt.Errorf("%w: resolver name is required", ErrReconciliationInvalid)
	}

	now := time.Now().UTC()
	notePtr := optionalString(note)
	resolution := models.ReconciliationResolution{
		RowKey:     rowKey,
		Note:       notePtr,
		ResolvedBy: &resolvedBy,
		ResolvedAt: now,
		CreatedAt:  now,
	}
	if err := s.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "rowKey"}},
		DoUpdates: clause.AssignmentColumns([]string{"note", "resolvedBy", "resolvedAt"}),
	}).Create(&resolution).Error; err != nil {
		return nil, err
	}

	var stored models.ReconciliationResolution
	if err := s.db.Where(`"rowKey" = ?`, rowKey).First(&stored).Error; err != nil {
		return nil, err
	}
	return &stored, nil
}

func (s *ledgerServiceImpl) ImportReconciliationRows(sourceType, source, importedBy string, rows []ReconciliationImportRow) (int, error) {
	sourceType = strings.ToLower(strings.TrimSpace(sourceType))
	if sourceType != "provider" && sourceType != "bank" {
		return 0, fmt.Errorf("%w: source type must be 'provider' or 'bank'", ErrReconciliationInvalid)
	}
	if len(rows) == 0 {
		return 0, fmt.Errorf("%w: no statement rows supplied", ErrReconciliationInvalid)
	}
	if len(rows) > reconciliationMaxImportRows {
		return 0, fmt.Errorf("%w: a single import is limited to %d rows", ErrReconciliationInvalid, reconciliationMaxImportRows)
	}

	defaultSource := strings.TrimSpace(source)
	if defaultSource == "" {
		if sourceType == "bank" {
			defaultSource = "Bank statement"
		} else {
			defaultSource = "Provider report"
		}
	}

	now := time.Now().UTC()
	records := make([]models.ReconciliationStatementRow, 0, len(rows))
	for index, row := range rows {
		reference := strings.TrimSpace(row.Reference)
		if reference == "" {
			return 0, fmt.Errorf("%w: row %d has no provider reference", ErrReconciliationInvalid, index+1)
		}
		if row.Amount <= 0 {
			return 0, fmt.Errorf("%w: row %d has a non-positive amount", ErrReconciliationInvalid, index+1)
		}
		rowSource := strings.TrimSpace(row.Provider)
		if rowSource == "" {
			if provider := providerFromReference(reference); provider != "" && sourceType == "provider" {
				rowSource = provider + " report"
			}
		}
		if rowSource == "" {
			rowSource = defaultSource
		}
		records = append(records, models.ReconciliationStatementRow{
			SourceType:    sourceType,
			Source:        rowSource,
			ProviderRef:   reference,
			Amount:        round2(row.Amount),
			Currency:      defaultCurrency(row.Currency),
			Status:        strings.TrimSpace(row.Status),
			StatementDate: parseStatementDate(row.Date),
			Description:   strings.TrimSpace(row.Description),
			ImportedBy:    optionalString(importedBy),
			CreatedAt:     now,
		})
	}

	if err := s.db.Transaction(func(tx *gorm.DB) error {
		for index := range records {
			if err := tx.Create(&records[index]).Error; err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		return 0, err
	}
	return len(records), nil
}

func classifyReconciliation(providerStatus string, providerAmount float64, ledger *reconLedgerTx) (string, string) {
	if ledger == nil {
		if isPendingStatus(providerStatus) {
			return "In transit", "Provider transaction is still settling; no ledger entry yet"
		}
		if isFailedStatus(providerStatus) {
			return "Exception", "Provider transaction failed or expired without a ledger entry"
		}
		return "Exception", "No ledger entry matches this provider reference"
	}

	difference := round2(math.Abs(providerAmount - ledger.Amount))
	if difference > 0.02 {
		return "Exception", fmt.Sprintf("Amount differs by %s %.2f", ledger.Currency, difference)
	}
	if isFailedStatus(ledger.Status) {
		return "Exception", "Ledger entry for this reference failed or was reversed"
	}
	if !isSettledStatus(ledger.Status) {
		return "In transit", "Provider settled; ledger entry is still pending"
	}
	return "Matched", "Provider reference matched; amounts agree"
}

func isPendingStatus(status string) bool {
	switch strings.ToUpper(strings.TrimSpace(status)) {
	case "PENDING", "PROCESSING", "REQUESTED", "INITIATED", "QUEUED", "IN_PROGRESS", "IN TRANSIT", "HOLD":
		return true
	}
	return false
}

func isSettledStatus(status string) bool {
	switch strings.ToUpper(strings.TrimSpace(status)) {
	case "SUCCESS", "SUCCESSFUL", "SUCCEEDED", "PAID", "COMPLETED", "CREDITED", "SETTLED":
		return true
	}
	return false
}

func isFailedStatus(status string) bool {
	switch strings.ToUpper(strings.TrimSpace(status)) {
	case "FAILED", "FAILURE", "CANCELLED", "CANCELED", "REVERSED", "REJECTED", "EXPIRED":
		return true
	}
	return false
}

func providerFromReference(reference string) string {
	upper := strings.ToUpper(strings.TrimSpace(reference))
	switch {
	case strings.HasPrefix(upper, "MNFY"):
		return "Monnify"
	case strings.HasPrefix(upper, "FLW"):
		return "Flutterwave"
	case strings.HasPrefix(upper, "BIT"):
		return "Bitnob"
	case strings.HasPrefix(upper, "BACHS"):
		return "Bachs"
	default:
		return ""
	}
}

var statementDateLayouts = []string{
	time.RFC3339,
	"2006-01-02T15:04:05",
	"2006-01-02 15:04:05",
	"2006-01-02",
	"02/01/2006",
	"2/1/2006",
	"01/02/2006",
	"02-01-2006",
	"2 Jan 2006",
	"Jan 2 2006",
	"Jan 2, 2006",
}

func parseStatementDate(value string) *time.Time {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	for _, layout := range statementDateLayouts {
		if parsed, err := time.Parse(layout, value); err == nil {
			parsed = parsed.UTC()
			return &parsed
		}
	}
	return nil
}

func formatReconDate(value *time.Time) string {
	if value == nil || value.IsZero() {
		return ""
	}
	return value.UTC().Format(time.RFC3339)
}

func defaultCurrency(currency string) string {
	currency = strings.ToUpper(strings.TrimSpace(currency))
	if currency == "" {
		return "NGN"
	}
	return currency
}

func round2(value float64) float64 {
	return math.Round(value*100) / 100
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func derefString(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func optionalString(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}
