package services

import (
	"errors"
	"testing"

	"quiz.superfan.com/apis/models"
)

func ptr(value float64) *float64 { return &value }

func validApprovalLines() []models.LedgerApprovalLine {
	return []models.LedgerApprovalLine{
		{AccountCode: "5001", AccountName: "Live Quiz rewards", Classification: "Expense", Debit: ptr(1500)},
		{AccountCode: "2020", AccountName: "Savings account liability", Classification: "Liability", Credit: ptr(1500)},
	}
}

func TestCreateLedgerApprovalRejectsInvalidInput(t *testing.T) {
	svc := &ledgerServiceImpl{}

	base := CreateLedgerApprovalInput{
		Description: "Compensation for quiz glitch",
		Reason:      "Verified with support ticket",
		RequestedBy: "ade.bola",
		Lines:       validApprovalLines(),
	}

	tests := []struct {
		name   string
		mutate func(*CreateLedgerApprovalInput)
	}{
		{"missing description", func(in *CreateLedgerApprovalInput) { in.Description = " " }},
		{"missing reason", func(in *CreateLedgerApprovalInput) { in.Reason = "" }},
		{"missing requester", func(in *CreateLedgerApprovalInput) { in.RequestedBy = "" }},
		{"unknown kind", func(in *CreateLedgerApprovalInput) { in.Kind = "Gift" }},
		{"single line", func(in *CreateLedgerApprovalInput) { in.Lines = in.Lines[:1] }},
		{"unbalanced", func(in *CreateLedgerApprovalInput) { in.Lines[1].Credit = ptr(1400) }},
		{"both sides on one line", func(in *CreateLedgerApprovalInput) {
			in.Lines[0].Credit = ptr(1500)
		}},
		{"zero amount", func(in *CreateLedgerApprovalInput) {
			in.Lines[0].Debit = ptr(0)
			in.Lines[1].Credit = ptr(0)
		}},
		{"missing account", func(in *CreateLedgerApprovalInput) { in.Lines[0].AccountName = "" }},
		{"negative amount", func(in *CreateLedgerApprovalInput) { in.Lines[0].Debit = ptr(-1500) }},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			input := base
			input.Lines = validApprovalLines()
			test.mutate(&input)
			if _, err := svc.CreateLedgerApproval(input); !errors.Is(err, ErrApprovalInvalid) {
				t.Fatalf("expected ErrApprovalInvalid, got %v", err)
			}
		})
	}
}

func TestRejectLedgerApprovalRequiresReason(t *testing.T) {
	svc := &ledgerServiceImpl{}
	if _, err := svc.RejectLedgerApproval(1, "reviewer", "  "); !errors.Is(err, ErrApprovalRejectionNeedsWhy) {
		t.Fatalf("expected ErrApprovalRejectionNeedsWhy, got %v", err)
	}
}

func TestReviewLedgerApprovalRequiresReviewer(t *testing.T) {
	svc := &ledgerServiceImpl{}
	if _, err := svc.ApproveLedgerApproval(1, " ", ""); !errors.Is(err, ErrApprovalInvalid) {
		t.Fatalf("expected ErrApprovalInvalid, got %v", err)
	}
}
