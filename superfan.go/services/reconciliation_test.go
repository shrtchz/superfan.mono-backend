package services

import (
	"errors"
	"testing"
)

func TestClassifyReconciliation(t *testing.T) {
	ledger := func(amount float64, status string) *reconLedgerTx {
		return &reconLedgerTx{TrxRef: "MNFY-TEST", Amount: amount, Currency: "NGN", Status: status}
	}

	cases := []struct {
		name           string
		providerStatus string
		providerAmount float64
		ledger         *reconLedgerTx
		wantStatus     string
	}{
		{"pending provider without ledger", "PENDING", 5000, nil, "In transit"},
		{"failed provider without ledger", "FAILED", 5000, nil, "Exception"},
		{"settled provider without ledger", "PAID", 5000, nil, "Exception"},
		{"amount mismatch", "PAID", 5000, ledger(4500, "Completed"), "Exception"},
		{"pending ledger", "PAID", 5000, ledger(5000, "Pending"), "In transit"},
		{"failed ledger", "PAID", 5000, ledger(5000, "FAILED"), "Exception"},
		{"matched", "PAID", 5000, ledger(5000, "Completed"), "Matched"},
		{"matched within rounding", "PAID", 5000.00, ledger(5000.01, "Completed"), "Matched"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			status, reason := classifyReconciliation(tc.providerStatus, tc.providerAmount, tc.ledger)
			if status != tc.wantStatus {
				t.Fatalf("status = %q, want %q (reason: %s)", status, tc.wantStatus, reason)
			}
			if reason == "" {
				t.Fatal("expected a reason for every classification")
			}
		})
	}
}

func TestProviderFromReference(t *testing.T) {
	cases := map[string]string{
		"MNFY-1234":   "Monnify",
		"FLW-abc":     "Flutterwave",
		"BIT-991":     "Bitnob",
		"BACHS-TX-01": "Bachs",
		"TXN-2026-01": "",
		"":            "",
	}
	for ref, want := range cases {
		if got := providerFromReference(ref); got != want {
			t.Fatalf("providerFromReference(%q) = %q, want %q", ref, got, want)
		}
	}
}

func TestParseStatementDate(t *testing.T) {
	cases := []string{
		"2026-08-26",
		"2026-08-26T11:30:00Z",
		"26/08/2026",
		"Aug 26, 2026",
	}
	for _, value := range cases {
		if parsed := parseStatementDate(value); parsed == nil {
			t.Fatalf("expected %q to parse", value)
		}
	}
	if parsed := parseStatementDate("not-a-date"); parsed != nil {
		t.Fatalf("expected unparseable date to return nil, got %v", parsed)
	}
}

func TestImportReconciliationRowsValidation(t *testing.T) {
	service := &ledgerServiceImpl{}

	if _, err := service.ImportReconciliationRows("", "", "", []ReconciliationImportRow{{Reference: "X", Amount: 1}}); !errors.Is(err, ErrReconciliationInvalid) {
		t.Fatalf("expected invalid source type error, got %v", err)
	}
	if _, err := service.ImportReconciliationRows("provider", "", "", nil); !errors.Is(err, ErrReconciliationInvalid) {
		t.Fatalf("expected empty rows error, got %v", err)
	}
	if _, err := service.ImportReconciliationRows("provider", "", "", []ReconciliationImportRow{{Amount: 100}}); !errors.Is(err, ErrReconciliationInvalid) {
		t.Fatalf("expected missing reference error, got %v", err)
	}
	if _, err := service.ImportReconciliationRows("provider", "", "", []ReconciliationImportRow{{Reference: "MNFY-1", Amount: 0}}); !errors.Is(err, ErrReconciliationInvalid) {
		t.Fatalf("expected non-positive amount error, got %v", err)
	}
}

func TestResolveReconciliationValidation(t *testing.T) {
	service := &ledgerServiceImpl{}

	if _, err := service.ResolveReconciliation("", "note", "admin"); !errors.Is(err, ErrReconciliationInvalid) {
		t.Fatalf("expected row key error, got %v", err)
	}
	if _, err := service.ResolveReconciliation("bank_transfer:1", "note", ""); !errors.Is(err, ErrReconciliationInvalid) {
		t.Fatalf("expected resolver error, got %v", err)
	}
}
