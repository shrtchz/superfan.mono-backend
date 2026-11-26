package services

import (
	"errors"
	"fmt"
	"math"
	"math/rand"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"quiz.superfan.com/apis/models"
)

var (
	ErrApprovalNotFound          = errors.New("approval request not found")
	ErrApprovalInvalid           = errors.New("invalid approval request")
	ErrApprovalDuplicateRef      = errors.New("an approval request with this reference already exists")
	ErrApprovalAlreadyReviewed   = errors.New("this approval request has already been reviewed")
	ErrApprovalSelfReview        = errors.New("you cannot review your own request")
	ErrApprovalRejectionNeedsWhy = errors.New("a reason is required to reject a request")
)

type CreateLedgerApprovalInput struct {
	Reference     string
	Kind          string
	Description   string
	ClientName    string
	AccountType   string
	Currency      string
	Reason        string
	RequestedBy   string
	ReversalOf    *string
	CorrectsEntry *string
	Lines         []models.LedgerApprovalLine
}

func amountInCents(value float64) int64 {
	return int64(math.Round(value * 100))
}

func (s *ledgerServiceImpl) CreateLedgerApproval(input CreateLedgerApprovalInput) (*models.LedgerApproval, error) {
	kind := strings.TrimSpace(input.Kind)
	if kind == "" {
		kind = models.LedgerApprovalKindAdjustment
	}
	switch kind {
	case models.LedgerApprovalKindAdjustment, models.LedgerApprovalKindReversal, models.LedgerApprovalKindCorrection:
	default:
		return nil, fmt.Errorf("%w: unknown kind %q", ErrApprovalInvalid, input.Kind)
	}

	description := strings.TrimSpace(input.Description)
	reason := strings.TrimSpace(input.Reason)
	requestedBy := strings.TrimSpace(input.RequestedBy)
	if description == "" || reason == "" || requestedBy == "" {
		return nil, fmt.Errorf("%w: description, reason and requestedBy are required", ErrApprovalInvalid)
	}
	if locked, err := s.periodLocked(time.Now()); err != nil {
		return nil, err
	} else if locked {
		return nil, ErrPeriodLocked
	}
	if len(input.Lines) < 2 {
		return nil, fmt.Errorf("%w: at least two ledger lines are required", ErrApprovalInvalid)
	}

	var debitCents, creditCents int64
	lines := make([]models.LedgerApprovalLine, 0, len(input.Lines))
	for _, line := range input.Lines {
		line.AccountCode = strings.TrimSpace(line.AccountCode)
		line.AccountName = strings.TrimSpace(line.AccountName)
		if line.AccountCode == "" || line.AccountName == "" {
			return nil, fmt.Errorf("%w: every line needs a GL account", ErrApprovalInvalid)
		}
		debit, credit := 0.0, 0.0
		if line.Debit != nil {
			debit = *line.Debit
		}
		if line.Credit != nil {
			credit = *line.Credit
		}
		if debit < 0 || credit < 0 {
			return nil, fmt.Errorf("%w: line amounts cannot be negative", ErrApprovalInvalid)
		}
		if debit > 0 && credit > 0 {
			return nil, fmt.Errorf("%w: a line cannot carry both a debit and a credit", ErrApprovalInvalid)
		}
		if debit == 0 && credit == 0 {
			return nil, fmt.Errorf("%w: every line needs a debit or a credit", ErrApprovalInvalid)
		}
		debitCents += amountInCents(debit)
		creditCents += amountInCents(credit)
		if debit > 0 {
			value := debit
			line.Debit = &value
			line.Credit = nil
		} else {
			value := credit
			line.Credit = &value
			line.Debit = nil
		}
		lines = append(lines, line)
	}
	if debitCents == 0 || debitCents != creditCents {
		return nil, fmt.Errorf("%w: debits and credits must balance", ErrApprovalInvalid)
	}

	currency := strings.ToUpper(strings.TrimSpace(input.Currency))
	if currency == "" {
		currency = "NGN"
	}

	reference := strings.TrimSpace(input.Reference)
	if reference == "" {
		generated, err := s.nextApprovalReference(kind)
		if err != nil {
			return nil, err
		}
		reference = generated
	}

	approval := &models.LedgerApproval{
		Reference:     reference,
		Kind:          kind,
		Status:        models.LedgerApprovalStatusAwaiting,
		Description:   description,
		ClientName:    strings.TrimSpace(input.ClientName),
		AccountType:   strings.TrimSpace(input.AccountType),
		Currency:      currency,
		Amount:        float64(debitCents) / 100,
		Reason:        reason,
		RequestedBy:   requestedBy,
		RequestedAt:   time.Now(),
		ReversalOf:    cleanOptional(input.ReversalOf),
		CorrectsEntry: cleanOptional(input.CorrectsEntry),
		Lines:         lines,
	}

	err := s.db.Create(approval).Error
	if err != nil {
		if isUniqueViolation(err) {
			return nil, ErrApprovalDuplicateRef
		}
		return nil, err
	}
	return approval, nil
}

func (s *ledgerServiceImpl) nextApprovalReference(kind string) (string, error) {
	prefix := "ADJ"
	if kind == models.LedgerApprovalKindReversal {
		prefix = "REV"
	}
	year := time.Now().Year()
	for attempt := 0; attempt < 8; attempt++ {
		candidate := fmt.Sprintf("%s-%d-%04d", prefix, year, rand.Intn(9000)+1000)
		var count int64
		if err := s.db.Model(&models.LedgerApproval{}).Where("reference = ?", candidate).Count(&count).Error; err != nil {
			return "", err
		}
		if count == 0 {
			return candidate, nil
		}
	}
	return "", errors.New("could not allocate an approval reference")
}

func cleanOptional(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func (s *ledgerServiceImpl) ListLedgerApprovals(page, limit int, status, search string) ([]models.LedgerApproval, int64, error) {
	if page < 1 {
		page = 1
	}
	if limit < 1 {
		limit = 10
	}
	if limit > 100 {
		limit = 100
	}

	query := s.db.Model(&models.LedgerApproval{})
	if statusValue := strings.TrimSpace(status); statusValue != "" && !strings.EqualFold(statusValue, "all") {
		query = query.Where(`UPPER("status") = ?`, strings.ToUpper(statusValue))
	}
	if searchValue := strings.TrimSpace(search); searchValue != "" {
		pattern := "%" + searchValue + "%"
		query = query.Where(
			`"reference" ILIKE ? OR "description" ILIKE ? OR "clientName" ILIKE ? OR "requestedBy" ILIKE ?`,
			pattern, pattern, pattern, pattern,
		)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var approvals []models.LedgerApproval
	err := query.
		Order(`"requestedAt" DESC, id DESC`).
		Offset((page - 1) * limit).
		Limit(limit).
		Find(&approvals).Error
	if err != nil {
		return nil, 0, err
	}
	return approvals, total, nil
}

func (s *ledgerServiceImpl) ApproveLedgerApproval(id uint, reviewer, note string) (*models.LedgerApproval, error) {
	return s.reviewLedgerApproval(id, models.LedgerApprovalStatusApproved, reviewer, note)
}

func (s *ledgerServiceImpl) RejectLedgerApproval(id uint, reviewer, note string) (*models.LedgerApproval, error) {
	if strings.TrimSpace(note) == "" {
		return nil, ErrApprovalRejectionNeedsWhy
	}
	return s.reviewLedgerApproval(id, models.LedgerApprovalStatusRejected, reviewer, note)
}

func (s *ledgerServiceImpl) reviewLedgerApproval(id uint, nextStatus, reviewer, note string) (*models.LedgerApproval, error) {
	reviewer = strings.TrimSpace(reviewer)
	if reviewer == "" {
		return nil, fmt.Errorf("%w: reviewer is required", ErrApprovalInvalid)
	}

	var updated models.LedgerApproval
	err := s.db.Transaction(func(tx *gorm.DB) error {
		var approval models.LedgerApproval
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&approval, id).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrApprovalNotFound
		}
		if err != nil {
			return err
		}
		if approval.Status != models.LedgerApprovalStatusAwaiting {
			return ErrApprovalAlreadyReviewed
		}
		if strings.EqualFold(strings.TrimSpace(approval.RequestedBy), reviewer) {
			return ErrApprovalSelfReview
		}

		now := time.Now()
		updates := map[string]interface{}{
			"status":     nextStatus,
			"reviewedBy": reviewer,
			"reviewedAt": now,
		}
		if noteValue := strings.TrimSpace(note); noteValue != "" {
			updates["reviewNote"] = noteValue
		}
		if err := tx.Model(&approval).Updates(updates).Error; err != nil {
			return err
		}

		approval.Status = nextStatus
		approval.ReviewedBy = &reviewer
		approval.ReviewedAt = &now
		if noteValue := strings.TrimSpace(note); noteValue != "" {
			approval.ReviewNote = &noteValue
		}
		updated = approval
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &updated, nil
}

func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "duplicate key") || strings.Contains(message, "unique constraint")
}
