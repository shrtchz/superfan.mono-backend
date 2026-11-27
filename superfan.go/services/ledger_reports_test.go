package services

import (
	"testing"
)

func TestReportAccountType(t *testing.T) {
	cases := map[string]string{
		"1010":  "Asset",
		"2010":  "Liability",
		"3010":  "Equity",
		"4010":  "Revenue",
		"5010":  "Expense",
		"":      "Other",
		" 5020": "Expense",
		"9000":  "Other",
	}
	for code, want := range cases {
		if got := reportAccountType(code); got != want {
			t.Fatalf("reportAccountType(%q) = %q, want %q", code, got, want)
		}
	}
}

func TestBuildTrialBalanceRows(t *testing.T) {
	rows, debitTotal, creditTotal := buildTrialBalanceRows([]ledgerAccountBalance{
		{AccountCode: "1010", AccountName: "Cash / Bank", Debit: 1000, Credit: 250},
		{AccountCode: "2010", AccountName: "Checking wallet liability", Debit: 50, Credit: 800},
		{AccountCode: "4010", AccountName: "Ad revenue", Debit: 0, Credit: 0},
	})

	if len(rows) != 3 {
		t.Fatalf("expected 3 rows, got %d", len(rows))
	}
	if rows[0].Debit != 750 || rows[0].Credit != 0 {
		t.Fatalf("expected cash net debit 750, got %+v", rows[0])
	}
	if rows[1].Credit != 750 || rows[1].Debit != 0 {
		t.Fatalf("expected liability net credit 750, got %+v", rows[1])
	}
	if rows[0].AccountType != "Asset" || rows[1].AccountType != "Liability" || rows[2].AccountType != "Revenue" {
		t.Fatalf("unexpected account types: %+v", rows)
	}
	if debitTotal != 750 || creditTotal != 750 {
		t.Fatalf("expected totals 750/750, got %v/%v", debitTotal, creditTotal)
	}
}

func TestBuildProfitLoss(t *testing.T) {
	revenues, expenses, revenueTotal, expenseTotal := buildProfitLoss([]ledgerAccountBalance{
		{AccountCode: "4010", AccountName: "Ad revenue", Debit: 0, Credit: 5000},
		{AccountCode: "4030", AccountName: "Shop revenue", Debit: 200, Credit: 1200},
		{AccountCode: "5010", AccountName: "Payment processing fees", Debit: 150, Credit: 0},
		{AccountCode: "5020", AccountName: "Rewards expense", Debit: 1000, Credit: 0},
		{AccountCode: "1010", AccountName: "Cash / Bank", Debit: 9999, Credit: 0},
	})

	if len(revenues) != 2 || len(expenses) != 2 {
		t.Fatalf("expected 2 revenue and 2 expense rows, got %d/%d", len(revenues), len(expenses))
	}
	if revenues[0].Label != "Ad revenue (4010)" || revenues[0].Amount != 5000 {
		t.Fatalf("unexpected first revenue row: %+v", revenues[0])
	}
	if revenues[1].Amount != 1000 {
		t.Fatalf("expected net shop revenue 1000, got %v", revenues[1].Amount)
	}
	if expenseTotal != -1150 {
		t.Fatalf("expected expense total -1150, got %v", expenseTotal)
	}
	if revenueTotal != 6000 {
		t.Fatalf("expected revenue total 6000, got %v", revenueTotal)
	}
	if expenses[0].Amount != -150 || expenses[1].Amount != -1000 {
		t.Fatalf("unexpected expense rows: %+v", expenses)
	}
}

func TestBuildBalanceSheet(t *testing.T) {
	sheet := buildBalanceSheet([]ledgerAccountBalance{
		{AccountCode: "1010", AccountName: "Cash / Bank", Debit: 1200, Credit: 0},
		{AccountCode: "2010", AccountName: "Checking wallet liability", Debit: 0, Credit: 700},
		{AccountCode: "4010", AccountName: "Ad revenue", Debit: 0, Credit: 900},
		{AccountCode: "5010", AccountName: "Payment processing fees", Debit: 400, Credit: 0},
	})

	if !sheet.Balanced {
		t.Fatalf("expected balanced sheet, got assets=%v liabilities=%v equity=%v",
			sheet.TotalAssets, sheet.TotalLiabilities, sheet.TotalEquity)
	}
	if sheet.TotalAssets != 1200 {
		t.Fatalf("expected assets 1200, got %v", sheet.TotalAssets)
	}
	if sheet.TotalLiabilities != 700 {
		t.Fatalf("expected liabilities 700, got %v", sheet.TotalLiabilities)
	}
	// Retained earnings = revenue (900) - expenses (400) = 500.
	if sheet.TotalEquity != 500 {
		t.Fatalf("expected equity 500, got %v", sheet.TotalEquity)
	}
	if len(sheet.Equity) != 1 || sheet.Equity[0].Account != "Retained earnings" {
		t.Fatalf("expected retained earnings row, got %+v", sheet.Equity)
	}
}
