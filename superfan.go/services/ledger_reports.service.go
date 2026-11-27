package services

import (
	"context"
	"fmt"
	"math"
	"strings"
	"time"

	"quiz.superfan.com/apis/models"
	"quiz.superfan.com/apis/services/accounting"
)

type ReportTrialBalanceRow struct {
	AccountCode string  `json:"accountCode"`
	AccountName string  `json:"accountName"`
	AccountType string  `json:"accountType"`
	Debit       float64 `json:"debit"`
	Credit      float64 `json:"credit"`
}

type ReportTrialBalanceTotals struct {
	Debit  float64 `json:"debit"`
	Credit float64 `json:"credit"`
}

type ReportTieOutRow struct {
	Account       string  `json:"account"`
	GeneralLedger float64 `json:"generalLedger"`
	UserWallets   float64 `json:"userWallets"`
	Difference    float64 `json:"difference"`
	TiedOut       bool    `json:"tiedOut"`
}

type ReportProfitLossRow struct {
	Label      string  `json:"label"`
	Amount     float64 `json:"amount"`
	Emphasized bool    `json:"emphasized"`
	NetResult  bool    `json:"netResult"`
}

type ReportClearingRow struct {
	Account string  `json:"account"`
	Balance float64 `json:"balance"`
}

type ReportBalanceSheetRow struct {
	Account string  `json:"account"`
	Amount  float64 `json:"amount"`
}

type ReportBalanceSheet struct {
	Assets           []ReportBalanceSheetRow `json:"assets"`
	Liabilities      []ReportBalanceSheetRow `json:"liabilities"`
	Equity           []ReportBalanceSheetRow `json:"equity"`
	TotalAssets      float64                 `json:"totalAssets"`
	TotalLiabilities float64                 `json:"totalLiabilities"`
	TotalEquity      float64                 `json:"totalEquity"`
	Balanced         bool                    `json:"balanced"`
}

type LedgerReports struct {
	Period                string                   `json:"period"`
	Label                 string                   `json:"label"`
	AsOf                  string                   `json:"asOf"`
	TrialBalance          []ReportTrialBalanceRow  `json:"trialBalance"`
	TrialBalanceTotals    ReportTrialBalanceTotals `json:"trialBalanceTotals"`
	Balanced              bool                     `json:"balanced"`
	TieOut                []ReportTieOutRow        `json:"tieOut"`
	ProfitLoss            []ReportProfitLossRow    `json:"profitLoss"`
	RevenueTotal          float64                  `json:"revenueTotal"`
	ExpenseTotal          float64                  `json:"expenseTotal"`
	NetResult             float64                  `json:"netResult"`
	ProviderClearing      []ReportClearingRow      `json:"providerClearing"`
	ProviderClearingTotal float64                  `json:"providerClearingTotal"`
	BalanceSheet          ReportBalanceSheet       `json:"balanceSheet"`
}

type ledgerAccountBalance struct {
	AccountCode string
	AccountName string
	Debit       float64
	Credit      float64
}

// GetLedgerReports builds the trial balance, profit & loss, balance sheet,
// wallet tie-out and provider clearing views for one accounting month.
func (s *ledgerServiceImpl) GetLedgerReports(ctx context.Context, month string) (*LedgerReports, error) {
	start, label, err := parseAccountingPeriod(month)
	if err != nil {
		return nil, err
	}
	end := start.AddDate(0, 1, 0)

	reports := &LedgerReports{
		Period: start.Format("2006-01"),
		Label:  label,
		AsOf:   end.Add(-time.Second).UTC().Format(time.RFC3339),
	}

	var cumulative []ledgerAccountBalance
	if err := s.db.WithContext(ctx).Model(&models.LedgerJournalLine{}).
		Select(`"accountCode" AS account_code, COALESCE(MAX("accountName"), '') AS account_name, COALESCE(SUM(debit), 0) AS debit, COALESCE(SUM(credit), 0) AS credit`).
		Where(`"createdAt" < ?`, end).
		Group(`"accountCode"`).
		Order(`"accountCode"`).
		Scan(&cumulative).Error; err != nil {
		return nil, err
	}

	reports.TrialBalance, reports.TrialBalanceTotals.Debit, reports.TrialBalanceTotals.Credit = buildTrialBalanceRows(cumulative)
	reports.Balanced = math.Abs(reports.TrialBalanceTotals.Debit-reports.TrialBalanceTotals.Credit) < 0.005
	reports.BalanceSheet = buildBalanceSheet(cumulative)

	var monthly []ledgerAccountBalance
	if err := s.db.WithContext(ctx).Model(&models.LedgerJournalLine{}).
		Select(`"accountCode" AS account_code, COALESCE(MAX("accountName"), '') AS account_name, COALESCE(SUM(debit), 0) AS debit, COALESCE(SUM(credit), 0) AS credit`).
		Where(`"createdAt" >= ? AND "createdAt" < ?`, start, end).
		Group(`"accountCode"`).
		Order(`"accountCode"`).
		Scan(&monthly).Error; err != nil {
		return nil, err
	}
	revenueRows, expenseRows, revenueTotal, expenseTotal := buildProfitLoss(monthly)
	reports.RevenueTotal = revenueTotal
	reports.ExpenseTotal = expenseTotal
	reports.NetResult = round2(revenueTotal + expenseTotal)
	reports.ProfitLoss = append(reports.ProfitLoss, revenueRows...)
	reports.ProfitLoss = append(reports.ProfitLoss, ReportProfitLossRow{
		Label:      "Total revenue",
		Amount:     revenueTotal,
		Emphasized: true,
	})
	reports.ProfitLoss = append(reports.ProfitLoss, expenseRows...)
	reports.ProfitLoss = append(reports.ProfitLoss, ReportProfitLossRow{
		Label:      "Total expenses",
		Amount:     expenseTotal,
		Emphasized: true,
	})
	reports.ProfitLoss = append(reports.ProfitLoss, ReportProfitLossRow{
		Label:      "Net result",
		Amount:     reports.NetResult,
		Emphasized: true,
		NetResult:  true,
	})

	if err := s.db.WithContext(ctx).Model(&models.LedgerJournalLine{}).
		Select(`"accountName" AS account, COALESCE(SUM(debit - credit), 0) AS balance`).
		Where(`"accountCode" = ? AND "createdAt" < ?`, accounting.AccountCodeProviderClearing, end).
		Group(`"accountName"`).
		Order(`"accountName"`).
		Scan(&reports.ProviderClearing).Error; err != nil {
		return nil, err
	}
	for index := range reports.ProviderClearing {
		reports.ProviderClearing[index].Account = strings.TrimSpace(reports.ProviderClearing[index].Account)
		reports.ProviderClearing[index].Balance = round2(reports.ProviderClearing[index].Balance)
		reports.ProviderClearingTotal += reports.ProviderClearing[index].Balance
	}
	reports.ProviderClearingTotal = round2(reports.ProviderClearingTotal)

	tieOut, err := accounting.ReconcileWalletsAndLedger(ctx, s.db)
	if err != nil {
		return nil, err
	}
	reports.TieOut = []ReportTieOutRow{
		{
			Account:       "2010 Checking",
			GeneralLedger: tieOut.LedgerCheckingLiab,
			UserWallets:   tieOut.WalletCheckingTotal,
			Difference:    tieOut.CheckingDiff,
			TiedOut:       math.Abs(tieOut.CheckingDiff) < 0.005,
		},
		{
			Account:       "2020 Savings",
			GeneralLedger: tieOut.LedgerSavingsLiab,
			UserWallets:   tieOut.WalletSavingsTotal,
			Difference:    tieOut.SavingsDiff,
			TiedOut:       math.Abs(tieOut.SavingsDiff) < 0.005,
		},
	}

	return reports, nil
}

// reportAccountType classifies a GL account code into its statement type.
func reportAccountType(code string) string {
	trimmed := strings.TrimSpace(code)
	if trimmed == "" {
		return "Other"
	}
	switch trimmed[0] {
	case '1':
		return "Asset"
	case '2':
		return "Liability"
	case '3':
		return "Equity"
	case '4':
		return "Revenue"
	case '5':
		return "Expense"
	default:
		return "Other"
	}
}

func balanceLabel(row ledgerAccountBalance) string {
	name := strings.TrimSpace(row.AccountName)
	if name == "" {
		return row.AccountCode
	}
	return fmt.Sprintf("%s (%s)", name, row.AccountCode)
}

func buildTrialBalanceRows(cumulative []ledgerAccountBalance) ([]ReportTrialBalanceRow, float64, float64) {
	var rows []ReportTrialBalanceRow
	var debitTotal, creditTotal float64
	for _, balance := range cumulative {
		net := round2(balance.Debit - balance.Credit)
		row := ReportTrialBalanceRow{
			AccountCode: balance.AccountCode,
			AccountName: strings.TrimSpace(balance.AccountName),
			AccountType: reportAccountType(balance.AccountCode),
		}
		if net >= 0 {
			row.Debit = net
		} else {
			row.Credit = round2(-net)
		}
		debitTotal += row.Debit
		creditTotal += row.Credit
		rows = append(rows, row)
	}
	return rows, round2(debitTotal), round2(creditTotal)
}

// buildProfitLoss returns revenue and expense rows as positive and negative
// amounts respectively, plus their totals.
func buildProfitLoss(monthly []ledgerAccountBalance) (revenueRows, expenseRows []ReportProfitLossRow, revenueTotal, expenseTotal float64) {
	for _, balance := range monthly {
		net := round2(balance.Debit - balance.Credit)
		switch reportAccountType(balance.AccountCode) {
		case "Revenue":
			amount := round2(-net)
			if amount == 0 {
				continue
			}
			revenueRows = append(revenueRows, ReportProfitLossRow{Label: balanceLabel(balance), Amount: amount})
			revenueTotal += amount
		case "Expense":
			amount := round2(-net)
			if amount == 0 {
				continue
			}
			expenseRows = append(expenseRows, ReportProfitLossRow{Label: balanceLabel(balance), Amount: amount})
			expenseTotal += amount
		}
	}
	return revenueRows, expenseRows, round2(revenueTotal), round2(expenseTotal)
}

func buildBalanceSheet(cumulative []ledgerAccountBalance) ReportBalanceSheet {
	sheet := ReportBalanceSheet{
		Assets:      []ReportBalanceSheetRow{},
		Liabilities: []ReportBalanceSheetRow{},
		Equity:      []ReportBalanceSheetRow{},
	}
	var retainedEarnings float64
	for _, balance := range cumulative {
		net := round2(balance.Debit - balance.Credit)
		switch reportAccountType(balance.AccountCode) {
		case "Asset":
			if net != 0 {
				sheet.Assets = append(sheet.Assets, ReportBalanceSheetRow{Account: balanceLabel(balance), Amount: net})
				sheet.TotalAssets += net
			}
		case "Liability":
			amount := round2(-net)
			if amount != 0 {
				sheet.Liabilities = append(sheet.Liabilities, ReportBalanceSheetRow{Account: balanceLabel(balance), Amount: amount})
				sheet.TotalLiabilities += amount
			}
		case "Equity":
			amount := round2(-net)
			if amount != 0 {
				sheet.Equity = append(sheet.Equity, ReportBalanceSheetRow{Account: balanceLabel(balance), Amount: amount})
				sheet.TotalEquity += amount
			}
		case "Revenue":
			retainedEarnings += round2(-net)
		case "Expense":
			retainedEarnings -= net
		}
	}
	retainedEarnings = round2(retainedEarnings)
	if retainedEarnings != 0 {
		sheet.Equity = append(sheet.Equity, ReportBalanceSheetRow{Account: "Retained earnings", Amount: retainedEarnings})
		sheet.TotalEquity += retainedEarnings
	}
	sheet.TotalAssets = round2(sheet.TotalAssets)
	sheet.TotalLiabilities = round2(sheet.TotalLiabilities)
	sheet.TotalEquity = round2(sheet.TotalEquity)
	sheet.Balanced = math.Abs(sheet.TotalAssets-(sheet.TotalLiabilities+sheet.TotalEquity)) < 0.005
	return sheet
}
