package accounting

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"gorm.io/gorm"
	"quiz.superfan.com/apis/models"
)

const (
	AccountCodeCashBank          = "1010"
	AccountCodeProviderClearing  = "1021"
	AccountCodeCheckingLiability = "2010"
	AccountCodeEscrowLiability   = "2015"
	AccountCodeSavingsLiability  = "2020"
	AccountCodeAdRevenue         = "4010"
	AccountCodeSubRevenue        = "4020"
	AccountCodeShopRevenue       = "4030"
	AccountCodeOtherRevenue      = "4090"
	AccountCodeProcessingFees    = "5010"
	AccountCodeRewardsExpense    = "5020"

	AccountTypePlatform = "Platform"
	AccountTypeChecking = "Checking"
	AccountTypeSavings  = "Savings"

	ProviderInApp = "In-app"
)

// TxKind represents the accounting category of a ledger entry.
type TxKind string

const (
	KindExternalPurchase TxKind = "external_purchase"
	KindWalletPurchase   TxKind = "wallet_purchase"
	KindExternalDeposit  TxKind = "external_deposit"
	KindWalletTransfer   TxKind = "wallet_transfer"
	KindRewardCredit     TxKind = "reward_credit"
	KindWithdrawal       TxKind = "withdrawal"
	KindSettlement       TxKind = "settlement"
	KindWalletRefund     TxKind = "wallet_refund"
	KindExternalRefund   TxKind = "external_refund"
	KindEscrowHold       TxKind = "escrow_hold"
	KindEscrowRelease    TxKind = "escrow_release"
)

type ClassificationInput struct {
	UserID          int
	UserDisplayName string
	Kind            TxKind
	WalletAccount   string // Checking | Savings (for wallet-side transactions)
	ExternalGateway string // Monnify | Flutterwave | Bitnob | Bachs
}

type ClassificationResult struct {
	ClientName  string
	AccountType string
	Provider    string
}

func round2(v float64) float64 {
	return math.Round(v*100) / 100
}

// NormalizeProvider maps raw gateway/channel strings to canonical provider names.
func NormalizeProvider(raw string) string {
	key := strings.ToLower(strings.TrimSpace(raw))
	switch {
	case key == "" || key == "in-app" || key == "inapp" || key == "in app" || key == "wallet" || key == "superfanvault":
		return ProviderInApp
	case strings.Contains(key, "monnify") || strings.HasPrefix(key, "mnfy"):
		return "Monnify"
	case strings.Contains(key, "flutterwave") || strings.HasPrefix(key, "flw"):
		return "Flutterwave"
	case strings.Contains(key, "bitnob") || strings.HasPrefix(key, "bit") || strings.HasPrefix(key, "btn"):
		return "Bitnob"
	case strings.Contains(key, "bachs"):
		return "Bachs"
	default:
		return strings.TrimSpace(raw)
	}
}

// NormalizeWalletAccount returns "Savings" or "Checking".
func NormalizeWalletAccount(raw string) string {
	key := strings.ToLower(strings.TrimSpace(raw))
	if key == "savings" || key == "gold" {
		return AccountTypeSavings
	}
	return AccountTypeChecking
}

// ClassifyTransaction enforces distinct Client, Account Type, and Provider rules.
func ClassifyTransaction(in ClassificationInput) ClassificationResult {
	client := ProviderInApp
	if in.UserID > 0 {
		name := strings.TrimSpace(in.UserDisplayName)
		if name != "" {
			client = name
		} else {
			client = fmt.Sprintf("User #%d", in.UserID)
		}
	}

	var accountType string
	var provider string

	switch in.Kind {
	case KindExternalPurchase, KindExternalRefund:
		accountType = AccountTypePlatform
		provider = NormalizeProvider(in.ExternalGateway)
		if provider == ProviderInApp {
			provider = "Monnify"
		}
	case KindSettlement:
		client = ProviderInApp
		accountType = AccountTypePlatform
		provider = NormalizeProvider(in.ExternalGateway)
	case KindWalletPurchase, KindWalletTransfer:
		accountType = NormalizeWalletAccount(in.WalletAccount)
		provider = ProviderInApp
	case KindRewardCredit:
		accountType = AccountTypeSavings
		provider = ProviderInApp
	case KindWalletRefund:
		accountType = NormalizeWalletAccount(in.WalletAccount)
		provider = ProviderInApp
	case KindExternalDeposit, KindWithdrawal:
		accountType = NormalizeWalletAccount(in.WalletAccount)
		provider = NormalizeProvider(in.ExternalGateway)
	default:
		accountType = AccountTypePlatform
		provider = NormalizeProvider(in.ExternalGateway)
	}

	return ClassificationResult{
		ClientName:  client,
		AccountType: accountType,
		Provider:    provider,
	}
}

type JournalInput struct {
	TransactionID int
	TrxRef        string
	Kind          TxKind
	Purpose       string // ad_payment | shop_payment | subscription_payment | deposit | ...
	Amount        float64
	Fee           float64
	Currency      string
	Provider      string
	WalletAccount string // Checking | Savings (or source for transfer)
	TargetAccount string // Savings | Checking (destination for transfer)
	CreatedAt     time.Time
}

func revenueAccountForPurpose(purpose string) (string, string) {
	p := strings.ToLower(strings.TrimSpace(purpose))
	switch {
	case strings.Contains(p, "ad"):
		return AccountCodeAdRevenue, "Ad revenue"
	case strings.Contains(p, "sub"):
		return AccountCodeSubRevenue, "Subscription revenue"
	case strings.Contains(p, "shop") || strings.Contains(p, "merch") || strings.Contains(p, "order"):
		return AccountCodeShopRevenue, "Shop revenue"
	default:
		return AccountCodeOtherRevenue, "Platform revenue"
	}
}

func walletLiabilityAccount(walletAccount string) (string, string, string) {
	norm := NormalizeWalletAccount(walletAccount)
	if norm == AccountTypeSavings {
		return AccountCodeSavingsLiability, "Savings wallet liability", AccountTypeSavings
	}
	return AccountCodeCheckingLiability, "Checking wallet liability", AccountTypeChecking
}

// BuildJournalLines builds a strictly balanced set of double-entry journal lines.
func BuildJournalLines(in JournalInput) ([]models.LedgerJournalLine, error) {
	amount := round2(in.Amount)
	fee := round2(in.Fee)
	if amount <= 0 {
		return nil, errors.New("journal amount must be greater than 0")
	}
	if fee < 0 {
		return nil, errors.New("provider fee cannot be negative")
	}
	if fee > amount {
		return nil, fmt.Errorf("provider fee (%.2f) cannot exceed gross amount (%.2f)", fee, amount)
	}

	currency := strings.ToUpper(strings.TrimSpace(in.Currency))
	if currency == "" {
		currency = "NGN"
	}
	now := in.CreatedAt
	if now.IsZero() {
		now = time.Now()
	}

	provider := NormalizeProvider(in.Provider)
	clearingName := fmt.Sprintf("%s clearing", provider)
	if provider == ProviderInApp {
		clearingName = "Cash / Bank"
	}

	var lines []models.LedgerJournalLine
	add := func(code, name, acctType string, debit, credit float64) {
		lines = append(lines, models.LedgerJournalLine{
			TransactionID: in.TransactionID,
			TrxRef:        in.TrxRef,
			AccountCode:   code,
			AccountName:   name,
			AccountType:   acctType,
			Debit:         round2(debit),
			Credit:        round2(credit),
			Currency:      currency,
			CreatedAt:     now,
		})
	}

	switch in.Kind {
	case KindExternalPurchase:
		net := round2(amount - fee)
		revCode, revName := revenueAccountForPurpose(in.Purpose)
		add(AccountCodeProviderClearing, clearingName, AccountTypePlatform, net, 0)
		if fee > 0 {
			add(AccountCodeProcessingFees, "Payment processing fees", AccountTypePlatform, fee, 0)
		}
		add(revCode, revName, AccountTypePlatform, 0, amount)

	case KindWalletPurchase:
		liabCode, liabName, liabType := walletLiabilityAccount(in.WalletAccount)
		revCode, revName := revenueAccountForPurpose(in.Purpose)
		add(liabCode, liabName, liabType, amount, 0)
		add(revCode, revName, AccountTypePlatform, 0, amount)

	case KindExternalDeposit:
		net := round2(amount - fee)
		liabCode, liabName, liabType := walletLiabilityAccount(in.WalletAccount)
		add(AccountCodeProviderClearing, clearingName, AccountTypePlatform, net, 0)
		if fee > 0 {
			add(AccountCodeProcessingFees, "Payment processing fees", AccountTypePlatform, fee, 0)
		}
		add(liabCode, liabName, liabType, 0, amount)

	case KindWalletTransfer:
		srcCode, srcName, srcType := walletLiabilityAccount(in.WalletAccount)
		dstCode, dstName, dstType := walletLiabilityAccount(in.TargetAccount)
		add(srcCode, srcName, srcType, amount, 0)
		add(dstCode, dstName, dstType, 0, amount)

	case KindRewardCredit:
		add(AccountCodeRewardsExpense, "Rewards expense", AccountTypePlatform, amount, 0)
		add(AccountCodeSavingsLiability, "Savings wallet liability", AccountTypeSavings, 0, amount)

	case KindWithdrawal:
		liabCode, liabName, liabType := walletLiabilityAccount(in.WalletAccount)
		add(liabCode, liabName, liabType, amount, 0)
		add(AccountCodeProviderClearing, clearingName, AccountTypePlatform, 0, amount)

	case KindSettlement:
		add(AccountCodeCashBank, "Cash / Bank", AccountTypePlatform, amount, 0)
		add(AccountCodeProviderClearing, clearingName, AccountTypePlatform, 0, amount)

	case KindWalletRefund:
		revCode, revName := revenueAccountForPurpose(in.Purpose)
		liabCode, liabName, liabType := walletLiabilityAccount(in.WalletAccount)
		add(revCode, revName, AccountTypePlatform, amount, 0)
		add(liabCode, liabName, liabType, 0, amount)

	case KindExternalRefund:
		net := round2(amount - fee)
		revCode, revName := revenueAccountForPurpose(in.Purpose)
		add(revCode, revName, AccountTypePlatform, amount, 0)
		add(AccountCodeProviderClearing, clearingName, AccountTypePlatform, 0, net)
		if fee > 0 {
			add(AccountCodeProcessingFees, "Payment processing fees", AccountTypePlatform, 0, fee)
		}

	case KindEscrowHold:
		liabCode, liabName, liabType := walletLiabilityAccount(in.WalletAccount)
		add(liabCode, liabName, liabType, amount, 0)
		add(AccountCodeEscrowLiability, "Versus escrow liability", AccountTypePlatform, 0, amount)

	case KindEscrowRelease:
		liabCode, liabName, liabType := walletLiabilityAccount(in.WalletAccount)
		add(AccountCodeEscrowLiability, "Versus escrow liability", AccountTypePlatform, amount, 0)
		add(liabCode, liabName, liabType, 0, amount)

	default:
		return nil, fmt.Errorf("unsupported journal transaction kind: %s", in.Kind)
	}

	if err := AssertBalanced(lines); err != nil {
		return nil, err
	}
	return lines, nil
}

// AssertBalanced verifies that total debits equal total credits to the nearest kobo/cent.
func AssertBalanced(lines []models.LedgerJournalLine) error {
	if len(lines) < 2 {
		return errors.New("journal entry must have at least 2 lines")
	}
	var sumDebit, sumCredit float64
	for _, l := range lines {
		sumDebit += l.Debit
		sumCredit += l.Credit
	}
	if math.Round(sumDebit*100) != math.Round(sumCredit*100) {
		return fmt.Errorf("unbalanced journal entry: debits=%.2f credits=%.2f", sumDebit, sumCredit)
	}
	return nil
}

// PostJournalTx atomically persists balanced journal lines for a WalletTransaction.
func PostJournalTx(tx *gorm.DB, wTx *models.WalletTransaction, in JournalInput) error {
	if tx == nil || wTx == nil {
		return errors.New("transaction and wallet transaction are required")
	}
	in.TransactionID = wTx.ID
	if in.TrxRef == "" && wTx.TrxRef != nil {
		in.TrxRef = *wTx.TrxRef
	}
	if in.CreatedAt.IsZero() {
		in.CreatedAt = wTx.CreatedAt
	}

	lines, err := BuildJournalLines(in)
	if err != nil {
		return err
	}
	return tx.Create(&lines).Error
}

type ReconciliationReport struct {
	TotalDebits           float64 `json:"totalDebits"`
	TotalCredits          float64 `json:"totalCredits"`
	TrialBalanceDiff      float64 `json:"trialBalanceDiff"`
	JournalBalanced       bool    `json:"journalBalanced"`
	WalletCheckingTotal   float64 `json:"walletCheckingTotal"`
	LedgerCheckingLiab    float64 `json:"ledgerCheckingLiab"`
	CheckingDiff          float64 `json:"checkingDiff"`
	WalletSavingsTotal    float64 `json:"walletSavingsTotal"`
	LedgerSavingsLiab     float64 `json:"ledgerSavingsLiab"`
	SavingsDiff           float64 `json:"savingsDiff"`
	IsReconciled          bool    `json:"isReconciled"`
}

// ReconcileWalletsAndLedger verifies trial balance and wallet-to-ledger liability tie-out.
func ReconcileWalletsAndLedger(ctx context.Context, db *gorm.DB) (*ReconciliationReport, error) {
	if db == nil {
		return nil, errors.New("database is nil")
	}
	var report ReconciliationReport

	var tb struct {
		TotalDebits  float64
		TotalCredits float64
	}
	if err := db.WithContext(ctx).Model(&models.LedgerJournalLine{}).
		Select("COALESCE(SUM(debit), 0) AS total_debits, COALESCE(SUM(credit), 0) AS total_credits").
		Scan(&tb).Error; err != nil {
		return nil, err
	}
	report.TotalDebits = round2(tb.TotalDebits)
	report.TotalCredits = round2(tb.TotalCredits)
	report.TrialBalanceDiff = round2(tb.TotalDebits - tb.TotalCredits)
	report.JournalBalanced = math.Round(report.TrialBalanceDiff*100) == 0

	var wSums struct {
		Checking float64
		Savings  float64
	}
	if err := db.WithContext(ctx).Model(&models.Wallet{}).
		Select(`COALESCE(SUM("checkingBalance"), 0) AS checking, COALESCE(SUM("savingsBalance"), 0) AS savings`).
		Scan(&wSums).Error; err != nil {
		return nil, err
	}
	report.WalletCheckingTotal = round2(wSums.Checking)
	report.WalletSavingsTotal = round2(wSums.Savings)

	var lSums struct {
		CheckingLiab float64
		SavingsLiab  float64
	}
	if err := db.WithContext(ctx).Model(&models.LedgerJournalLine{}).
		Select(
			`COALESCE(SUM(CASE WHEN "accountCode" = ? THEN credit - debit ELSE 0 END), 0) AS checking_liab, ` +
				`COALESCE(SUM(CASE WHEN "accountCode" = ? THEN credit - debit ELSE 0 END), 0) AS savings_liab`,
			AccountCodeCheckingLiability, AccountCodeSavingsLiability,
		).Scan(&lSums).Error; err != nil {
		return nil, err
	}
	report.LedgerCheckingLiab = round2(lSums.CheckingLiab)
	report.LedgerSavingsLiab = round2(lSums.SavingsLiab)
	report.CheckingDiff = round2(report.WalletCheckingTotal - report.LedgerCheckingLiab)
	report.SavingsDiff = round2(report.WalletSavingsTotal - report.LedgerSavingsLiab)
	report.IsReconciled = report.JournalBalanced &&
		math.Round(report.CheckingDiff*100) == 0 &&
		math.Round(report.SavingsDiff*100) == 0

	return &report, nil
}
