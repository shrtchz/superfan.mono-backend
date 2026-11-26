package services

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestParseAccountingPeriod(t *testing.T) {
	start, label, err := parseAccountingPeriod("2026-08")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if start.Location() != time.UTC || start.Day() != 1 || start.Month() != time.August || start.Year() != 2026 {
		t.Fatalf("unexpected start: %v", start)
	}
	if label != "August 2026" {
		t.Fatalf("unexpected label: %q", label)
	}

	if _, _, err := parseAccountingPeriod("2026-13"); err == nil {
		t.Fatal("expected error for month 13")
	} else if !errors.Is(err, ErrPeriodInvalid) {
		t.Fatalf("expected ErrPeriodInvalid, got %v", err)
	}

	now := time.Now().UTC()
	start, _, err = parseAccountingPeriod("  ")
	if err != nil {
		t.Fatalf("unexpected error for empty period: %v", err)
	}
	previous := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC).AddDate(0, -1, 0)
	if !start.Equal(previous) {
		t.Fatalf("expected previous month %v, got %v", previous, start)
	}
}

func TestBuildPeriodCloseChecks(t *testing.T) {
	clean := &PeriodCloseReport{
		JournalDebits:  1000,
		JournalCredits: 1000,
		JournalDiff:    0,
		CheckingDiff:   0,
		SavingsDiff:    0,
	}
	checks := buildPeriodCloseChecks(clean, true)
	if len(checks) != 5 {
		t.Fatalf("expected 5 checks, got %d", len(checks))
	}
	for _, check := range checks {
		if !check.Complete {
			t.Fatalf("expected clean report check %q to pass", check.Key)
		}
		if check.Detail == "" {
			t.Fatalf("check %q is missing detail text", check.Key)
		}
	}

	blocked := &PeriodCloseReport{
		JournalDebits:       20000,
		JournalCredits:      7655,
		JournalDiff:         12345,
		CheckingDiff:        -5,
		SavingsDiff:         0,
		ReconExceptions:     2,
		PendingApprovals:    1,
		MissingJournalCount: 3,
	}
	checks = buildPeriodCloseChecks(blocked, false)
	for _, check := range checks {
		if check.Complete {
			t.Fatalf("expected check %q to fail", check.Key)
		}
		if !strings.Contains(check.Detail, ",") && check.Key == "trial_balance" {
			t.Fatalf("expected grouped amount in detail, got %q", check.Detail)
		}
	}

	// Period balances but the global journal does not: trial balance must fail.
	globalOut := buildPeriodCloseChecks(&PeriodCloseReport{}, false)
	if globalOut[0].Complete {
		t.Fatal("expected trial balance check to fail when global journal is unbalanced")
	}
}

func TestFormatNairaAmount(t *testing.T) {
	cases := map[float64]string{
		0:           "₦0.00",
		999:         "₦999.00",
		1000:        "₦1,000.00",
		1234567.891: "₦1,234,567.89",
		-2500.5:     "-₦2,500.50",
	}
	for input, want := range cases {
		if got := formatNairaAmount(input); got != want {
			t.Fatalf("formatNairaAmount(%v) = %q, want %q", input, got, want)
		}
	}
}
