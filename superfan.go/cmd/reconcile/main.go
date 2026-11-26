package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/joho/godotenv"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"quiz.superfan.com/apis/models"
	"quiz.superfan.com/apis/services/accounting"
)

func main() {
	apply := flag.Bool("apply", false, "Apply additive LedgerJournalLine backfill and classify missing provider/account_type metadata")
	inspectSavings := flag.Bool("inspect-savings", false, "Inspect per-user Savings wallet vs Savings ledger net")
	flag.Parse()

	_ = godotenv.Load(".env")
	dsn := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if dsn == "" {
		log.Fatal("DATABASE_URL is not set in .env or environment")
	}

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		log.Fatalf("failed to connect to database: %v", err)
	}

	// Ensure additive schema columns and LedgerJournalLine table exist.
	if err := db.AutoMigrate(&models.WalletTransaction{}, &models.LedgerJournalLine{}); err != nil {
		log.Fatalf("AutoMigrate failed: %v", err)
	}
	fmt.Println("[OK] AutoMigrate verified for WalletTransaction and LedgerJournalLine")

	// 1. Inspect Wallet balance consistency
	var walletStats struct {
		TotalWallets      int64   `gorm:"column:total_wallets"`
			CheckingSum       float64 `gorm:"column:checking_sum"`
			SavingsSum        float64 `gorm:"column:savings_sum"`
			}
	db.Raw(`
		SELECT
			COUNT(*) AS total_wallets,
			COALESCE(SUM("checkingBalance"), 0) AS checking_sum,
			COALESCE(SUM("savingsBalance"), 0) AS savings_sum
		FROM "Wallet"
	`).Scan(&walletStats)

	fmt.Printf("Wallets: total=%d | checkingSum=%.2f | savingsSum=%.2f\n",

		walletStats.TotalWallets, walletStats.CheckingSum, walletStats.SavingsSum)

	// 2. Inspect WalletTransaction and LedgerJournalLine counts
	var txStats struct {
		TotalTx       int64 `gorm:"column:total_tx"`
		CompletedTx   int64 `gorm:"column:completed_tx"`
		JournaledTx   int64 `gorm:"column:journaled_tx"`
		TotalJournals int64 `gorm:"column:total_journals"`
		MissingProv   int64 `gorm:"column:missing_prov"`
		MissingAcct   int64 `gorm:"column:missing_acct"`
	}
	db.Raw(`
		SELECT
			(SELECT COUNT(*) FROM "WalletTransaction") AS total_tx,
			(SELECT COUNT(*) FROM "WalletTransaction" WHERE UPPER(COALESCE("status", '')) IN ('COMPLETED', 'SUCCESS', 'PAID')) AS completed_tx,
			(SELECT COUNT(DISTINCT "transactionId") FROM "LedgerJournalLine") AS journaled_tx,
			(SELECT COUNT(*) FROM "LedgerJournalLine") AS total_journals,
			(SELECT COUNT(*) FROM "WalletTransaction" WHERE COALESCE("provider", '') = '') AS missing_prov,
			(SELECT COUNT(*) FROM "WalletTransaction" WHERE COALESCE("account_type", '') = '') AS missing_acct
	`).Scan(&txStats)

	fmt.Printf("Transactions: total=%d completed=%d | journaledTx=%d journalLines=%d | missingProvider=%d missingAccountType=%d\n",
		txStats.TotalTx, txStats.CompletedTx, txStats.JournaledTx, txStats.TotalJournals, txStats.MissingProv, txStats.MissingAcct)

	// 3. Run current reconciliation
	ctx := context.Background()
	rec, err := accounting.ReconcileWalletsAndLedger(ctx, db)
	if err != nil {
		log.Fatalf("ReconcileWalletsAndLedger failed: %v", err)
	}
	fmt.Printf("Reconciliation BEFORE: debits=%.2f credits=%.2f diff=%.2f balanced=%v | checkingWallet=%.2f (ledger=%.2f diff=%.2f) | savingsWallet=%.2f (ledger=%.2f diff=%.2f) | reconciled=%v\n",
		rec.TotalDebits, rec.TotalCredits, rec.TrialBalanceDiff, rec.JournalBalanced,
		rec.WalletCheckingTotal, rec.LedgerCheckingLiab, rec.CheckingDiff,
		rec.WalletSavingsTotal, rec.LedgerSavingsLiab, rec.SavingsDiff, rec.IsReconciled)

	if *inspectSavings {
		var rows []struct {
			UserID      int     `gorm:"column:user_id"`
			SavingsBalance float64 `gorm:"column:savings_balance"`
			LedgerNet   float64 `gorm:"column:ledger_net"`
			Diff        float64 `gorm:"column:diff"`
		}
		db.Raw(`
			WITH ledger_by_user AS (
				SELECT wt."userId" AS user_id,
					COALESCE(SUM(l."credit" - l."debit"), 0) AS ledger_net
				FROM "LedgerJournalLine" l
				JOIN "WalletTransaction" wt ON wt."id" = l."transactionId"
				WHERE l."accountCode" = '2020'
				GROUP BY wt."userId"
			)
			SELECT w."userId" AS user_id,
				COALESCE(w."savingsBalance", 0) AS savings_balance,
				COALESCE(lu.ledger_net, 0) AS ledger_net,
				COALESCE(w."savingsBalance", 0) - COALESCE(lu.ledger_net, 0) AS diff
			FROM "Wallet" w
			LEFT JOIN ledger_by_user lu ON lu.user_id = w."userId"
			WHERE ABS(COALESCE(w."savingsBalance", 0) - COALESCE(lu.ledger_net, 0)) > 0.01
			ORDER BY ABS(COALESCE(w."savingsBalance", 0) - COALESCE(lu.ledger_net, 0)) DESC
		`).Scan(&rows)
		fmt.Printf("Savings drift users (%d):\n", len(rows))
		for _, r := range rows {
			fmt.Printf("  userId=%d savingsBalance=%.2f ledger2020Net=%.2f diff=%.2f\n", r.UserID, r.SavingsBalance, r.LedgerNet, r.Diff)
		}
		var txs []struct {
			ID          int     `gorm:"column:id"`
			UserID      int     `gorm:"column:userId"`
			Amount      float64 `gorm:"column:amount"`
			Type        string  `gorm:"column:type"`
			TrxType     string  `gorm:"column:transactionType"`
			AccountType string  `gorm:"column:account_type"`
			Status      string  `gorm:"column:status"`
			Desc        string  `gorm:"column:description"`
			TrxRef      string  `gorm:"column:trx_ref"`
		}
		db.Raw(`
			SELECT "id", "userId", "amount", COALESCE("type",'') AS "type", COALESCE("transactionType",'') AS "transactionType",
				COALESCE("account_type",'') AS "account_type", COALESCE("status",'') AS "status",
				COALESCE("description",'') AS "description", COALESCE("trx_ref",'') AS "trx_ref"
			FROM "WalletTransaction"
			WHERE "userId" IN (1, 4, 5)
			  AND (UPPER(COALESCE("type",'')) = 'TRANSFER' OR UPPER(COALESCE("transactionType",'')) = 'TRANSFER' OR LOWER(COALESCE("account_type",'')) IN ('savings', 'gold') OR UPPER(COALESCE("status",'')) NOT IN ('COMPLETED','SUCCESS','PAID'))
			ORDER BY "userId", "id"
		`).Scan(&txs)
		for _, t := range txs {
			fmt.Printf("    tx id=%d user=%d amt=%.2f type=%s trxType=%s acct=%s status=%s ref=%s desc=%s\n",
				t.ID, t.UserID, t.Amount, t.Type, t.TrxType, t.AccountType, t.Status, t.TrxRef, t.Desc)
		}
		return
	}

	if !*apply {
		fmt.Println("Dry-run complete. Re-run with --apply to backfill missing provider/account_type and LedgerJournalLine entries.")
		return
	}

	// 4. Backfill inside a single atomic transaction
	err = db.Transaction(func(tx *gorm.DB) error {
		// personalBalance and goldBalance columns have been dropped; nothing to sync

		// Rebuild LedgerJournalLine cleanly for all settled/held transactions
		if err := tx.Exec(`DELETE FROM "LedgerJournalLine"`).Error; err != nil {
			return err
		}

		// Fetch completed/held transactions
		var txs []models.WalletTransaction
		if err := tx.Raw(`
			SELECT wt.*
			FROM "WalletTransaction" wt
			WHERE UPPER(COALESCE(wt."status", '')) IN ('COMPLETED', 'SUCCESS', 'PAID', 'HELD')
			  AND wt."amount" > 0
			ORDER BY wt."id" ASC
		`).Scan(&txs).Error; err != nil {
			return err
		}

		var createdJournals int
		var updatedMeta int
		for i := range txs {
			wTx := &txs[i]
			in := inferJournalInput(wTx)
			cls := inferClassification(wTx, in)

			updates := map[string]interface{}{}
			if wTx.Provider == nil || strings.TrimSpace(*wTx.Provider) == "" {
				updates["provider"] = cls.Provider
			}
			if wTx.AccountType == nil || strings.TrimSpace(*wTx.AccountType) == "" {
				updates["account_type"] = cls.AccountType
			}
			if in.Kind == accounting.KindRewardCredit {
				if strVal(wTx.AccountType) != accounting.AccountTypePlatform {
					updates["account_type"] = accounting.AccountTypePlatform
				}
				if strVal(wTx.Provider) != accounting.ProviderInApp {
					updates["provider"] = accounting.ProviderInApp
				}
			}
			if len(updates) > 0 {
				if err := tx.Model(&models.WalletTransaction{}).Where(`"id" = ?`, wTx.ID).Updates(updates).Error; err != nil {
					return err
				}
				updatedMeta++
			}

			if err := accounting.PostJournalTx(tx, wTx, in); err != nil {
				return fmt.Errorf("failed to post journal for tx id=%d: %w", wTx.ID, err)
			}
			createdJournals++
		}
		fmt.Printf("[APPLY] Updated metadata on %d transactions; posted balanced journals for %d transactions.\n", updatedMeta, createdJournals)
		return nil
	})
	if err != nil {
		log.Fatalf("Apply failed (rolled back): %v", err)
	}

	recAfter, err := accounting.ReconcileWalletsAndLedger(ctx, db)
	if err != nil {
		log.Fatalf("ReconcileWalletsAndLedger after apply failed: %v", err)
	}
	fmt.Printf("Reconciliation AFTER: debits=%.2f credits=%.2f diff=%.2f balanced=%v | checkingWallet=%.2f (ledger=%.2f diff=%.2f) | savingsWallet=%.2f (ledger=%.2f diff=%.2f) | reconciled=%v\n",
		recAfter.TotalDebits, recAfter.TotalCredits, recAfter.TrialBalanceDiff, recAfter.JournalBalanced,
		recAfter.WalletCheckingTotal, recAfter.LedgerCheckingLiab, recAfter.CheckingDiff,
		recAfter.WalletSavingsTotal, recAfter.LedgerSavingsLiab, recAfter.SavingsDiff, recAfter.IsReconciled)
}

func strVal(p *string) string {
	if p == nil {
		return ""
	}
	return strings.TrimSpace(*p)
}

func inferGateway(wTx *models.WalletTransaction) string {
	if p := strVal(wTx.Provider); p != "" {
		return accounting.NormalizeProvider(p)
	}
	ref := strings.ToUpper(strVal(wTx.TrxRef))
	if ref == "" {
		ref = strings.ToUpper(strVal(wTx.Reference))
	}
	switch {
	case strings.HasPrefix(ref, "MNFY"):
		return "Monnify"
	case strings.HasPrefix(ref, "FLW"):
		return "Flutterwave"
	case strings.HasPrefix(ref, "BIT") || strings.HasPrefix(ref, "BTN"):
		return "Bitnob"
	case strings.HasPrefix(ref, "BACHS"):
		return "Bachs"
	}
	pm := strings.ToUpper(strVal(wTx.PaymentMethod))
	switch pm {
	case "WALLET", "IN-APP", "INAPP":
		return accounting.ProviderInApp
	case "CARD", "ACCOUNT_TRANSFER", "BANKTRANSFER", "BANK_TRANSFER":
		return "Monnify"
	case "STABLE_COIN":
		return "Bitnob"
	}
	if strings.EqualFold(wTx.Currency, "USDC") || strings.EqualFold(wTx.Currency, "USDT") {
		return "Bitnob"
	}
	return accounting.ProviderInApp
}

func inferPurpose(wTx *models.WalletTransaction) string {
	tt := strings.ToUpper(strVal(wTx.TransactionType))
	desc := strings.ToLower(strVal(wTx.Description))
	switch {
	case strings.Contains(tt, "AD_REFUND") || strings.Contains(desc, "ad rejection refund"):
		return "ad_refund"
	case strings.Contains(tt, "ADS") || strings.Contains(desc, "ad campaign") || strings.Contains(desc, "ads"):
		return "ad_payment"
	case strings.Contains(tt, "SUB") || strings.Contains(desc, "subscription"):
		return "subscription_payment"
	case strings.Contains(tt, "SHOP") || strings.Contains(desc, "shop") || strings.Contains(desc, "merch"):
		return "shop_payment"
	default:
		return strings.ToLower(tt)
	}
}

func inferJournalInput(wTx *models.WalletTransaction) accounting.JournalInput {
	tt := strings.ToUpper(strVal(wTx.TransactionType))
	tp := strings.ToUpper(strVal(wTx.Type))
	pm := strings.ToUpper(strVal(wTx.PaymentMethod))
	acct := accounting.NormalizeWalletAccount(strVal(wTx.AccountType))
	prov := inferGateway(wTx)
	purpose := inferPurpose(wTx)
	fee := 0.0
	if wTx.Fee != nil {
		fee = *wTx.Fee
	}
	createdAt := wTx.CreatedAt
	if createdAt.IsZero() {
		createdAt = time.Now()
	}

	var kind accounting.TxKind
	switch {
	case tt == "SETTLEMENT":
		kind = accounting.KindSettlement
	case tt == "TRANSFER" || tp == "TRANSFER":
		kind = accounting.KindWalletTransfer
	case tt == "VERSUS_ESCROW_DEBIT":
		kind = accounting.KindEscrowHold
		prov = accounting.ProviderInApp
	case tt == "VERSUS_ESCROW_REFUND" || tt == "VERSUS_WIN" || strings.Contains(tt, "VERSUS") && tp == "CREDIT":
		kind = accounting.KindEscrowRelease
		prov = accounting.ProviderInApp
	case tt == "REWARD" || strVal(wTx.RewardType) != "":
		kind = accounting.KindRewardCredit
		acct = accounting.AccountTypeSavings
		prov = accounting.ProviderInApp
	case tt == "AD_REFUND" || tt == "REFUND":
		if prov == accounting.ProviderInApp || strings.Contains(tt, "AD_REFUND") {
			kind = accounting.KindWalletRefund
			prov = accounting.ProviderInApp
		} else {
			kind = accounting.KindExternalRefund
		}
	case tt == "WITHDRAWAL":
		kind = accounting.KindWithdrawal
	case tt == "DEPOSIT":
		kind = accounting.KindExternalDeposit
	case prov != accounting.ProviderInApp && (pm == "CARD" || pm == "ACCOUNT_TRANSFER" || pm == "STABLE_COIN" || strings.EqualFold(strVal(wTx.AccountType), "Platform")):
		kind = accounting.KindExternalPurchase
	case tp == "CREDIT":
		kind = accounting.KindExternalDeposit
	default:
		kind = accounting.KindWalletPurchase
		prov = accounting.ProviderInApp
	}

	targetAcct := accounting.AccountTypeSavings
	if kind == accounting.KindWalletTransfer && acct == accounting.AccountTypeSavings {
		targetAcct = accounting.AccountTypeChecking
	}

	return accounting.JournalInput{
		TransactionID: wTx.ID,
		TrxRef:        strVal(wTx.TrxRef),
		Kind:          kind,
		Purpose:       purpose,
		Amount:        wTx.Amount,
		Fee:           fee,
		Currency:      wTx.Currency,
		Provider:      prov,
		WalletAccount: acct,
		TargetAccount: targetAcct,
		CreatedAt:     createdAt,
	}
}

func inferClassification(wTx *models.WalletTransaction, in accounting.JournalInput) accounting.ClassificationResult {
	return accounting.ClassifyTransaction(accounting.ClassificationInput{
		UserID:          wTx.UserID,
		UserDisplayName: wTx.ClientName,
		Kind:            in.Kind,
		WalletAccount:   in.WalletAccount,
		ExternalGateway: in.Provider,
	})
}
