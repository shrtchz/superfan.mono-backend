package accounting

import (
	"math"
	"testing"
	"time"

	"quiz.superfan.com/apis/models"
)

func assertClose(t *testing.T, label string, got, want float64) {
	t.Helper()
	if math.Abs(got-want) > 0.005 {
		t.Fatalf("%s: got %.2f, want %.2f", label, got, want)
	}
}

func findLine(lines []models.LedgerJournalLine, code string) (models.LedgerJournalLine, bool) {
	for _, l := range lines {
		if l.AccountCode == code {
			return l, true
		}
	}
	return models.LedgerJournalLine{}, false
}

func TestClassifyTransactionRules(t *testing.T) {
	tests := []struct {
		name        string
		in          ClassificationInput
		wantClient  string
		wantAccount string
		wantProv    string
	}{
		{
			name: "External ad purchase via Monnify",
			in: ClassificationInput{
				UserID:          42,
				UserDisplayName: "Ada Lovelace",
				Kind:            KindExternalPurchase,
				ExternalGateway: "Monnify",
			},
			wantClient:  "Ada Lovelace",
			wantAccount: AccountTypePlatform,
			wantProv:    "Monnify",
		},
		{
			name: "External subscription via Flutterwave",
			in: ClassificationInput{
				UserID:          7,
				UserDisplayName: "Grace Hopper",
				Kind:            KindExternalPurchase,
				ExternalGateway: "flw",
			},
			wantClient:  "Grace Hopper",
			wantAccount: AccountTypePlatform,
			wantProv:    "Flutterwave",
		},
		{
			name: "External shop payment via Bitnob stablecoin",
			in: ClassificationInput{
				UserID:          9,
				UserDisplayName: "Alan Turing",
				Kind:            KindExternalPurchase,
				ExternalGateway: "bitnob",
			},
			wantClient:  "Alan Turing",
			wantAccount: AccountTypePlatform,
			wantProv:    "Bitnob",
		},
		{
			name: "Checking wallet purchase uses In-app provider",
			in: ClassificationInput{
				UserID:          11,
				UserDisplayName: "Ada Lovelace",
				Kind:            KindWalletPurchase,
				WalletAccount:   "Checking",
				ExternalGateway: "Monnify", // must be ignored for wallet purchases
			},
			wantClient:  "Ada Lovelace",
			wantAccount: AccountTypeChecking,
			wantProv:    ProviderInApp,
		},
		{
			name: "Savings wallet purchase uses Savings + In-app",
			in: ClassificationInput{
				UserID:          11,
				UserDisplayName: "Ada Lovelace",
				Kind:            KindWalletPurchase,
				WalletAccount:   "Gold",
			},
			wantClient:  "Ada Lovelace",
			wantAccount: AccountTypeSavings,
			wantProv:    ProviderInApp,
		},
		{
			name: "Internal settlement without specific user uses Client = In-app",
			in: ClassificationInput{
				UserID:          0,
				Kind:            KindSettlement,
				ExternalGateway: "Monnify",
			},
			wantClient:  ProviderInApp,
			wantAccount: AccountTypePlatform,
			wantProv:    "Monnify",
		},
		{
			name: "Internal transaction without user uses Client = In-app",
			in: ClassificationInput{
				UserID:          0,
				Kind:            KindExternalDeposit,
				WalletAccount:   "Checking",
				ExternalGateway: "Bachs",
			},
			wantClient:  ProviderInApp,
			wantAccount: AccountTypeChecking,
			wantProv:    "Bachs",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := ClassifyTransaction(tc.in)
			if got.ClientName != tc.wantClient {
				t.Fatalf("ClientName = %q, want %q", got.ClientName, tc.wantClient)
			}
			if got.AccountType != tc.wantAccount {
				t.Fatalf("AccountType = %q, want %q", got.AccountType, tc.wantAccount)
			}
			if got.Provider != tc.wantProv {
				t.Fatalf("Provider = %q, want %q", got.Provider, tc.wantProv)
			}
		})
	}
}

func TestExternalPurchaseWithFeeJournal(t *testing.T) {
	cases := []struct {
		purpose     string
		wantRevCode string
	}{
		{purpose: "ad_payment", wantRevCode: AccountCodeAdRevenue},
		{purpose: "subscription_payment", wantRevCode: AccountCodeSubRevenue},
		{purpose: "shop_payment", wantRevCode: AccountCodeShopRevenue},
	}

	for _, tc := range cases {
		t.Run(tc.purpose, func(t *testing.T) {
			lines, err := BuildJournalLines(JournalInput{
				TransactionID: 101,
				TrxRef:        "MNFY-TEST-10000",
				Kind:          KindExternalPurchase,
				Purpose:       tc.purpose,
				Amount:        10000,
				Fee:           100,
				Currency:      "NGN",
				Provider:      "Monnify",
				CreatedAt:     time.Now(),
			})
			if err != nil {
				t.Fatalf("BuildJournalLines failed: %v", err)
			}
			if err := AssertBalanced(lines); err != nil {
				t.Fatalf("AssertBalanced failed: %v", err)
			}

			clearing, ok := findLine(lines, AccountCodeProviderClearing)
			if !ok {
				t.Fatalf("missing clearing line 1021")
			}
			assertClose(t, "clearing debit", clearing.Debit, 9900)
			assertClose(t, "clearing credit", clearing.Credit, 0)
			if clearing.AccountName != "Monnify clearing" {
				t.Fatalf("clearing name = %q, want %q", clearing.AccountName, "Monnify clearing")
			}

			feeLine, ok := findLine(lines, AccountCodeProcessingFees)
			if !ok {
				t.Fatalf("missing fee line 5010")
			}
			assertClose(t, "fee debit", feeLine.Debit, 100)
			assertClose(t, "fee credit", feeLine.Credit, 0)

			revLine, ok := findLine(lines, tc.wantRevCode)
			if !ok {
				t.Fatalf("missing revenue line %s", tc.wantRevCode)
			}
			assertClose(t, "revenue debit", revLine.Debit, 0)
			assertClose(t, "revenue credit", revLine.Credit, 10000)
		})
	}
}

func TestWalletPurchaseJournalCheckingAndSavings(t *testing.T) {
	for _, acct := range []struct {
		walletAcct string
		wantLiab   string
	}{
		{walletAcct: AccountTypeChecking, wantLiab: AccountCodeCheckingLiability},
		{walletAcct: AccountTypeSavings, wantLiab: AccountCodeSavingsLiability},
	} {
		t.Run(acct.walletAcct, func(t *testing.T) {
			lines, err := BuildJournalLines(JournalInput{
				TransactionID: 202,
				TrxRef:        "WALLET-SHOP-1",
				Kind:          KindWalletPurchase,
				Purpose:       "shop_payment",
				Amount:        5000,
				Fee:           0,
				Currency:      "NGN",
				Provider:      ProviderInApp,
				WalletAccount: acct.walletAcct,
			})
			if err != nil {
				t.Fatalf("BuildJournalLines failed: %v", err)
			}
			if err := AssertBalanced(lines); err != nil {
				t.Fatalf("AssertBalanced failed: %v", err)
			}
			if _, hasClearing := findLine(lines, AccountCodeProviderClearing); hasClearing {
				t.Fatalf("wallet purchase must not hit external provider clearing 1021")
			}
			if _, hasFee := findLine(lines, AccountCodeProcessingFees); hasFee {
				t.Fatalf("wallet purchase must not post external processing fee 5010")
			}
			liab, ok := findLine(lines, acct.wantLiab)
			if !ok {
				t.Fatalf("missing liability %s", acct.wantLiab)
			}
			assertClose(t, "liability debit", liab.Debit, 5000)
			rev, ok := findLine(lines, AccountCodeShopRevenue)
			if !ok {
				t.Fatalf("missing shop revenue 4030")
			}
			assertClose(t, "revenue credit", rev.Credit, 5000)
		})
	}
}

func TestSettlementAndRefundJournals(t *testing.T) {
	settleLines, err := BuildJournalLines(JournalInput{
		TransactionID: 301,
		TrxRef:        "SETTLE-1",
		Kind:          KindSettlement,
		Amount:        25000,
		Fee:           0,
		Currency:      "NGN",
		Provider:      "Flutterwave",
	})
	if err != nil {
		t.Fatalf("settlement BuildJournalLines failed: %v", err)
	}
	if err := AssertBalanced(settleLines); err != nil {
		t.Fatalf("settlement not balanced: %v", err)
	}
	cash, _ := findLine(settleLines, AccountCodeCashBank)
	clearing, _ := findLine(settleLines, AccountCodeProviderClearing)
	assertClose(t, "settlement cash debit", cash.Debit, 25000)
	assertClose(t, "settlement clearing credit", clearing.Credit, 25000)

	walletRefundLines, err := BuildJournalLines(JournalInput{
		TransactionID: 302,
		TrxRef:        "REF-AD-1",
		Kind:          KindWalletRefund,
		Purpose:       "ad_refund",
		Amount:        3000,
		Currency:      "NGN",
		Provider:      ProviderInApp,
		WalletAccount: AccountTypeChecking,
	})
	if err != nil {
		t.Fatalf("wallet refund BuildJournalLines failed: %v", err)
	}
	if err := AssertBalanced(walletRefundLines); err != nil {
		t.Fatalf("wallet refund not balanced: %v", err)
	}
	adRev, _ := findLine(walletRefundLines, AccountCodeAdRevenue)
	checking, _ := findLine(walletRefundLines, AccountCodeCheckingLiability)
	assertClose(t, "ad refund revenue debit", adRev.Debit, 3000)
	assertClose(t, "ad refund checking credit", checking.Credit, 3000)

	extRefundLines, err := BuildJournalLines(JournalInput{
		TransactionID: 303,
		TrxRef:        "REF-EXT-1",
		Kind:          KindExternalRefund,
		Purpose:       "shop_payment",
		Amount:        10000,
		Fee:           100,
		Currency:      "NGN",
		Provider:      "Monnify",
	})
	if err != nil {
		t.Fatalf("external refund BuildJournalLines failed: %v", err)
	}
	if err := AssertBalanced(extRefundLines); err != nil {
		t.Fatalf("external refund not balanced: %v", err)
	}
	shopRev, _ := findLine(extRefundLines, AccountCodeShopRevenue)
	extClear, _ := findLine(extRefundLines, AccountCodeProviderClearing)
	extFee, _ := findLine(extRefundLines, AccountCodeProcessingFees)
	assertClose(t, "ext refund revenue debit", shopRev.Debit, 10000)
	assertClose(t, "ext refund clearing credit", extClear.Credit, 9900)
	assertClose(t, "ext refund fee credit", extFee.Credit, 100)
}

func TestAssertBalancedRejectsUnbalanced(t *testing.T) {
	err := AssertBalanced([]models.LedgerJournalLine{
		{AccountCode: AccountCodeCashBank, Debit: 100, Credit: 0},
		{AccountCode: AccountCodeAdRevenue, Debit: 0, Credit: 99},
	})
	if err == nil {
		t.Fatalf("expected error for unbalanced journal lines")
	}
}

func TestTrialBalanceAndWalletLiabilityTieOut(t *testing.T) {
	inputs := []JournalInput{
		// 1. External deposit of 20,000 NGN with 150 fee -> Checking liability +20,000
		{TransactionID: 1, TrxRef: "DEP-1", Kind: KindExternalDeposit, Amount: 20000, Fee: 150, Currency: "NGN", Provider: "Monnify", WalletAccount: AccountTypeChecking},
		// 2. External ad purchase 10,000 NGN with 100 fee -> 1021 DR 9,900, 5010 DR 100, 4010 CR 10,000
		{TransactionID: 2, TrxRef: "AD-EXT-1", Kind: KindExternalPurchase, Purpose: "ad_payment", Amount: 10000, Fee: 100, Currency: "NGN", Provider: "Monnify"},
		// 3. Wallet transfer Checking -> Savings 5,000 NGN -> Checking -5,000, Savings +5,000
		{TransactionID: 3, TrxRef: "TRF-1", Kind: KindWalletTransfer, Amount: 5000, Currency: "NGN", Provider: ProviderInApp, WalletAccount: AccountTypeChecking, TargetAccount: AccountTypeSavings},
		// 4. Savings wallet shop purchase 2,000 NGN -> Savings -2,000, 4030 CR 2,000
		{TransactionID: 4, TrxRef: "SHOP-WAL-1", Kind: KindWalletPurchase, Purpose: "shop_payment", Amount: 2000, Currency: "NGN", Provider: ProviderInApp, WalletAccount: AccountTypeSavings},
		// 5. Quiz reward 1,500 NGN -> 5020 DR 1,500, Savings +1,500
		{TransactionID: 5, TrxRef: "REW-1", Kind: KindRewardCredit, Amount: 1500, Currency: "NGN", Provider: ProviderInApp, WalletAccount: AccountTypeSavings},
		// 6. Ad refund to Checking 3,000 NGN -> 4010 DR 3,000, Checking +3,000
		{TransactionID: 6, TrxRef: "REF-1", Kind: KindWalletRefund, Purpose: "ad_refund", Amount: 3000, Currency: "NGN", Provider: ProviderInApp, WalletAccount: AccountTypeChecking},
		// 7. Settlement from Monnify 29,750 NGN -> 1010 DR 29,750, 1021 CR 29,750
		{TransactionID: 7, TrxRef: "SET-1", Kind: KindSettlement, Amount: 29750, Currency: "NGN", Provider: "Monnify"},
	}

	var allLines []models.LedgerJournalLine
	for _, in := range inputs {
		lines, err := BuildJournalLines(in)
		if err != nil {
			t.Fatalf("BuildJournalLines(%s) failed: %v", in.TrxRef, err)
		}
		allLines = append(allLines, lines...)
	}

	var totalDebit, totalCredit, checkingNet, savingsNet, clearingNet float64
	for _, l := range allLines {
		totalDebit += l.Debit
		totalCredit += l.Credit
		switch l.AccountCode {
		case AccountCodeCheckingLiability:
			checkingNet += l.Credit - l.Debit
		case AccountCodeSavingsLiability:
			savingsNet += l.Credit - l.Debit
		case AccountCodeProviderClearing:
			clearingNet += l.Debit - l.Credit
		}
	}

	assertClose(t, "trial balance debit == credit", totalDebit, totalCredit)
	assertClose(t, "checking liability tie-out", checkingNet, 18000) // 20000 - 5000 + 3000
	assertClose(t, "savings liability tie-out", savingsNet, 4500)    // 5000 - 2000 + 1500
	assertClose(t, "provider clearing settled to zero", clearingNet, 0)
}
