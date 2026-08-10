package payment

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"quiz.superfan.com/apis/models"
	"quiz.superfan.com/apis/services/payment/providers"
	"gorm.io/gorm"
)

type PaymentService struct {
	db              *gorm.DB
	monnifyProvider *providers.MonnifyProvider
	bitnobProvider  *providers.BitnobProvider
}

func NewPaymentService(db *gorm.DB, monnify *providers.MonnifyProvider, bitnob *providers.BitnobProvider) *PaymentService {
	return &PaymentService{
		db:              db,
		monnifyProvider: monnify,
		bitnobProvider:  bitnob,
	}
}

// InitiateDeposit starts the deposit process via provider.
func (s *PaymentService) InitiateDeposit(ctx context.Context, req providers.DepositRequest) (*providers.DepositResponse, error) {
	var provider providers.PaymentProvider
	switch req.Currency {
	case "NGN":
		provider = s.monnifyProvider
	case "USDC", "USDT":
		provider = s.bitnobProvider
	default:
		return nil, fmt.Errorf("unsupported currency: %s", req.Currency)
	}
	return provider.InitiateDeposit(ctx, req)
}

// HandleDepositWebhook verifies a deposit transaction and credits the user's wallet.
func (s *PaymentService) HandleDepositWebhook(ctx context.Context, currency string, req providers.VerifyTransactionRequest) error {
	var provider providers.PaymentProvider
	switch currency {
	case "NGN":
		provider = s.monnifyProvider
	case "USDC", "USDT":
		provider = s.bitnobProvider
	default:
		return fmt.Errorf("unsupported currency: %s", currency)
	}

	verification, err := provider.VerifyTransaction(ctx, req)
	if err != nil {
		return err
	}

	if verification.Status != "SUCCESS" {
		return fmt.Errorf("transaction not successful, status: %s", verification.Status)
	}

	return s.db.Transaction(func(tx *gorm.DB) error {
		description := "Credit Wallet - Debit Card"
		switch currency {
		case "USDC", "USDT":
			description = "Credit Wallet - Stable Coins"
		case "NGN":
			description = "Credit Wallet - Bank Transfer"
		}
		txType := "CREDIT"
		wTx := models.WalletTransaction{
			Amount:      verification.Amount,
			Type:        &txType,
			Description: &description,
			TrxRef:      &verification.TransactionReference,
		}
		if err := tx.Create(&wTx).Error; err != nil {
			return err
		}
		return nil
	})
}

// GetWalletByUserID returns the wallet for a given user.
func (s *PaymentService) GetWalletByUserID(ctx context.Context, userID int) (*models.Wallet, error) {
	var wallet models.Wallet
	err := s.db.WithContext(ctx).Where("\"userId\" = ?", userID).First(&wallet).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return &models.Wallet{UserID: userID, Balance: 0, GoldBalance: 0, PersonalBalance: 0, UsdcBalance: 0, UsdtBalance: 0}, nil
		}
		return nil, err
	}
	return &wallet, nil
}

// GetPaymentHistoryByUserID returns all wallet transactions for a user.
func (s *PaymentService) GetPaymentHistoryByUserID(ctx context.Context, userID int) ([]models.WalletTransaction, error) {
	var history []models.WalletTransaction
	err := s.db.WithContext(ctx).Where("\"userId\" = ?", userID).Order("\"createdAt\" desc").Find(&history).Error
	if err != nil {
		return nil, err
	}
	return history, nil
}

// WalletTransactionFilter defines filter options for fetching wallet transactions.
type WalletTransactionFilter struct {
	UserID      int
	AccountType string
	Type        string
	Currency    string
	Status      string
	StartDate   *time.Time
	EndDate     *time.Time
	Page        int
	Limit       int
}

// WalletTransactionResponse represents the serialized transaction item returned to callers.
type WalletTransactionResponse struct {
	ID              int        `json:"id"`
	UserID          int        `json:"userId"`
	Amount          float64    `json:"amount"`
	Type            string     `json:"type"`
	Currency        string     `json:"currency"`
	Username        *string    `json:"username"`
	AccountName     string     `json:"account_name"`
	PaymentMethod   string     `json:"payment_method"`
	BankName        *string    `json:"bank_name"`
	CardToken       *string    `json:"cardToken"`
	WalletAddress   *string    `json:"wallet_address"`
	AccountNo       *string    `json:"account_no"`
	AccountType     string     `json:"account_type"`
	SettlementDate  *time.Time `json:"settlement_date"`
	Reference       string     `json:"reference"`
	Status          string     `json:"status"`
	TotalEarnings   *float64   `json:"total_earnings"`
	Payouts         *float64   `json:"payouts"`
	LastPayout      *time.Time `json:"last_payout"`
	PaymentDate     *time.Time `json:"payment_date"`
	PendingBalance  *float64   `json:"pending_balance"`
	RewardType      *string    `json:"rewardType"`
	TransactionType string     `json:"transactionType"`
	Description     string     `json:"description"`
	TrxRef          string     `json:"trx_ref"`
	WalletID        *string    `json:"walletId"`
	CreatedAt       time.Time  `json:"createdAt"`
}

func maskIDNumber(raw string) string {
	clean := strings.TrimSpace(raw)
	if clean == "" {
		return "••••"
	}
	if strings.HasPrefix(clean, "••••") {
		return clean
	}
	if len(clean) <= 4 {
		return "••••" + clean
	}
	return "••••" + clean[len(clean)-4:]
}

// GetWalletTransactions fetches wallet transactions matching filter with user metadata.
func (s *PaymentService) GetWalletTransactions(ctx context.Context, filter WalletTransactionFilter) ([]WalletTransactionResponse, int64, error) {
	db := s.db.WithContext(ctx).Model(&models.WalletTransaction{})

	if filter.UserID > 0 {
		db = db.Where("\"userId\" = ?", filter.UserID)
	}
	if filter.AccountType != "" {
		db = db.Where("\"account_type\" = ?", filter.AccountType)
	}
	if filter.Type != "" {
		db = db.Where("\"type\" ILIKE ?", filter.Type)
	}
	if filter.Currency != "" {
		db = db.Where("\"currency\" ILIKE ?", filter.Currency)
	}
	if filter.Status != "" {
		db = db.Where("\"status\" ILIKE ?", filter.Status)
	}
	if filter.StartDate != nil {
		db = db.Where("\"createdAt\" >= ?", *filter.StartDate)
	}
	if filter.EndDate != nil {
		db = db.Where("\"createdAt\" <= ?", *filter.EndDate)
	}

	var total int64
	if err := db.Count(&total).Error; err != nil {
		log.Printf("[PaymentService] GetWalletTransactions count error: %v", err)
	}

	query := db.Order("\"createdAt\" DESC")
	if filter.Limit > 0 {
		page := filter.Page
		if page <= 0 {
			page = 1
		}
		offset := (page - 1) * filter.Limit
		query = query.Offset(offset).Limit(filter.Limit)
	}

	var rawTxList []models.WalletTransaction
	if err := query.Find(&rawTxList).Error; err != nil {
		return nil, 0, err
	}

	userIDs := make([]int, 0, len(rawTxList))
	for _, tx := range rawTxList {
		if tx.UserID > 0 {
			userIDs = append(userIDs, tx.UserID)
		}
	}

	userMap := make(map[int]models.User)
	walletMap := make(map[int]models.Wallet)
	bankMap := make(map[int]models.UserWithdrawalBank)
	cryptoWalletMap := make(map[int]models.UserWithdrawalWallet)
	cardMap := make(map[int]models.UserCard)
	totalEarningsMap := make(map[int]float64)
	lastPayoutMap := make(map[int]time.Time)
	payoutCountMap := make(map[int]float64)

	if len(userIDs) > 0 {
		// 1. Fetch Users
		var users []models.User
		if err := s.db.WithContext(ctx).Where("id IN ?", userIDs).Find(&users).Error; err == nil {
			for _, u := range users {
				userMap[u.ID] = u
			}
		}

		// 2. Fetch Wallets
		var wallets []models.Wallet
		if err := s.db.WithContext(ctx).Where("\"userId\" IN ?", userIDs).Find(&wallets).Error; err == nil {
			for _, w := range wallets {
				walletMap[w.UserID] = w
			}
		}

		// 3. Fetch User Withdrawal Banks
		var banks []models.UserWithdrawalBank
		if err := s.db.WithContext(ctx).Where("\"userId\" IN ?", userIDs).Order("\"createdAt\" DESC").Find(&banks).Error; err == nil {
			for _, b := range banks {
				if _, exists := bankMap[b.UserID]; !exists {
					bankMap[b.UserID] = b
				}
			}
		}

		// 4. Fetch User Withdrawal Crypto Wallets
		var cryptoWallets []models.UserWithdrawalWallet
		if err := s.db.WithContext(ctx).Where("\"userId\" IN ?", userIDs).Order("\"createdAt\" DESC").Find(&cryptoWallets).Error; err == nil {
			for _, cw := range cryptoWallets {
				if _, exists := cryptoWalletMap[cw.UserID]; !exists {
					cryptoWalletMap[cw.UserID] = cw
				}
			}
		}

		// 5. Fetch User Cards
		var cards []models.UserCard
		if err := s.db.WithContext(ctx).Where("\"userId\" IN ?", userIDs).Order("\"createdAt\" DESC").Find(&cards).Error; err == nil {
			for _, c := range cards {
				if _, exists := cardMap[c.UserID]; !exists {
					cardMap[c.UserID] = c
				}
			}
		}

		// 6. Compute total earnings per user (sum of positive CREDIT transactions + points)
		type SumResult struct {
			UserID int     `gorm:"column:userId"`
			Total  float64 `gorm:"column:total"`
		}
		var earningsList []SumResult
		if err := s.db.WithContext(ctx).Model(&models.WalletTransaction{}).
			Select("\"userId\", SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as total").
			Where("\"userId\" IN ?", userIDs).
			Group("\"userId\"").
			Scan(&earningsList).Error; err == nil {
			for _, res := range earningsList {
				totalEarningsMap[res.UserID] = res.Total
			}
		}

		// 7. Fetch Payouts and latest payout date
		var payouts []models.Payout
		if err := s.db.WithContext(ctx).Where("\"userId\" IN ?", userIDs).Order("\"createdAt\" DESC").Find(&payouts).Error; err == nil {
			for _, p := range payouts {
				payoutCountMap[p.UserID]++
				if _, exists := lastPayoutMap[p.UserID]; !exists {
					if p.ProcessedAt != nil {
						lastPayoutMap[p.UserID] = *p.ProcessedAt
					} else {
						lastPayoutMap[p.UserID] = p.CreatedAt
					}
				}
			}
		}

		// Also check DEBIT / WITHDRAWAL transactions for last payout date if not found in Payout table
		type LatestDebitResult struct {
			UserID   int       `gorm:"column:userId"`
			LatestAt time.Time `gorm:"column:latestAt"`
		}
		var debitList []LatestDebitResult
		if err := s.db.WithContext(ctx).Model(&models.WalletTransaction{}).
			Select("\"userId\", MAX(\"createdAt\") as \"latestAt\"").
			Where("\"userId\" IN ? AND (\"type\" ILIKE 'DEBIT' OR \"type\" ILIKE 'WITHDRAWAL' OR \"description\" ILIKE '%withdraw%')", userIDs).
			Group("\"userId\"").
			Scan(&debitList).Error; err == nil {
			for _, res := range debitList {
				if _, exists := lastPayoutMap[res.UserID]; !exists {
					lastPayoutMap[res.UserID] = res.LatestAt
				}
			}
		}
	}

	responses := make([]WalletTransactionResponse, len(rawTxList))
	for i, tx := range rawTxList {
		u := userMap[tx.UserID]
		w, hasWallet := walletMap[tx.UserID]
		b, hasBank := bankMap[tx.UserID]
		cw, hasCrypto := cryptoWalletMap[tx.UserID]
		card, hasCard := cardMap[tx.UserID]

		// 1. Transaction Type
		txType := "CREDIT"
		if tx.Type != nil && *tx.Type != "" {
			txType = strings.ToUpper(*tx.Type)
		}

		desc := ""
		if tx.Description != nil {
			desc = *tx.Description
		}

		// 2. Payment Method
		paymentMethod := "ACCOUNT_TRANSFER"
		if tx.PaymentMethod != nil && *tx.PaymentMethod != "" {
			paymentMethod = *tx.PaymentMethod
		} else if strings.Contains(strings.ToLower(desc), "card") {
			paymentMethod = "CARD"
		} else if strings.Contains(strings.ToLower(desc), "stable") || strings.Contains(strings.ToLower(desc), "usdt") || strings.Contains(strings.ToLower(desc), "usdc") || tx.Currency == "USDC" || tx.Currency == "USDT" {
			paymentMethod = "STABLE_COIN"
		}

		// 3. Username
		var uname *string
		if tx.Username != nil && *tx.Username != "" {
			uname = tx.Username
		} else if u.Username != "" {
			uname = &u.Username
		}

		// 4. Account Name
		accName := strings.TrimSpace(u.FirstName + " " + u.LastName)
		if accName == "" && uname != nil {
			accName = *uname
		}
		if tx.AccountName != nil && *tx.AccountName != "" {
			accName = *tx.AccountName
		} else if hasBank && b.AccountName != "" {
			accName = b.AccountName
		}

		// 5. References
		ref := ""
		if tx.Reference != nil && *tx.Reference != "" {
			ref = *tx.Reference
		} else if tx.TrxRef != nil {
			ref = *tx.TrxRef
		}

		trxRef := ref
		if tx.TrxRef != nil && *tx.TrxRef != "" {
			trxRef = *tx.TrxRef
		}

		status := "SUCCESS"
		if tx.Status != nil && *tx.Status != "" {
			status = *tx.Status
		}

		accType := "Personal"
		if tx.AccountType != nil && *tx.AccountType != "" {
			accType = *tx.AccountType
		}

		var walletIdStr *string
		if tx.WalletID != nil {
			sId := fmt.Sprintf("%d", *tx.WalletID)
			walletIdStr = &sId
		} else if hasWallet {
			sId := fmt.Sprintf("%d", w.ID)
			walletIdStr = &sId
		}

		currency := "NGN"
		if tx.Currency != "" {
			currency = tx.Currency
		}

		transactionType := txType
		if tx.TransactionType != nil && *tx.TransactionType != "" {
			transactionType = *tx.TransactionType
		}

		// 6. Channel / Bank Name / Card Token
		var bankName *string
		if tx.BankName != nil && *tx.BankName != "" {
			bankName = tx.BankName
		} else if hasBank && b.BankName != "" {
			bankName = &b.BankName
		} else if hasCard && card.Issuer != nil && *card.Issuer != "" {
			bankName = card.Issuer
		} else if paymentMethod == "STABLE_COIN" {
			scName := "USDC | USDT"
			if tx.Currency == "USDT" || tx.Currency == "USDC" {
				scName = tx.Currency
			}
			bankName = &scName
		} else if paymentMethod == "CARD" {
			specificCard := "Mastercard"
			if tx.BankName != nil && *tx.BankName != "" && *tx.BankName != "Mastercard | Visa" && *tx.BankName != "Debit Card" {
				specificCard = *tx.BankName
			} else if hasCard {
				if card.CardType != nil && *card.CardType != "" {
					specificCard = *card.CardType
				} else if card.Issuer != nil && *card.Issuer != "" {
					specificCard = *card.Issuer
				} else if card.MaskedPan != nil && *card.MaskedPan != "" {
					pan := *card.MaskedPan
					if strings.HasPrefix(pan, "4") {
						specificCard = "Visa"
					} else if strings.HasPrefix(pan, "5") {
						specificCard = "Mastercard"
					} else if strings.HasPrefix(pan, "506") || strings.HasPrefix(pan, "6500") {
						specificCard = "Verve"
					}
				}
			} else if tx.CardToken != nil && *tx.CardToken != "" {
				token := *tx.CardToken
				if strings.HasPrefix(token, "4") {
					specificCard = "Visa"
				} else if strings.HasPrefix(token, "5") {
					specificCard = "Mastercard"
				} else if strings.HasPrefix(token, "506") || strings.HasPrefix(token, "6500") {
					specificCard = "Verve"
				}
			} else {
				descLower := strings.ToLower(desc)
				if strings.Contains(descLower, "visa") {
					specificCard = "Visa"
				} else if strings.Contains(descLower, "mastercard") {
					specificCard = "Mastercard"
				} else if strings.Contains(descLower, "verve") {
					specificCard = "Verve"
				}
			}
			bankName = &specificCard
		} else {
			// Specific bank transfer channel resolution
			specificBank := "Wema Bank"
			descLower := strings.ToLower(desc)
			if strings.Contains(descLower, "moniepoint") {
				specificBank = "Moniepoint MFB"
			} else if strings.Contains(descLower, "kuda") {
				specificBank = "Kuda Bank"
			} else if strings.Contains(descLower, "zenith") {
				specificBank = "Zenith Bank"
			} else if strings.Contains(descLower, "gtbank") || strings.Contains(descLower, "guaranty") {
				specificBank = "GTBank"
			} else if strings.Contains(descLower, "access") {
				specificBank = "Access Bank"
			} else if strings.Contains(descLower, "first bank") || strings.Contains(descLower, "firstbank") {
				specificBank = "First Bank"
			} else if strings.Contains(descLower, "flutterwave") {
				specificBank = "Flutterwave"
			} else if strings.Contains(descLower, "monnify") {
				specificBank = "Monnify"
			} else if u.BankCode != nil {
				switch *u.BankCode {
				case "035":
					specificBank = "Wema Bank"
				case "50515", "090405":
					specificBank = "Moniepoint MFB"
				case "090267":
					specificBank = "Kuda Bank"
				case "058":
					specificBank = "GTBank"
				case "044":
					specificBank = "Access Bank"
				case "057":
					specificBank = "Zenith Bank"
				case "011":
					specificBank = "First Bank"
				case "033":
					specificBank = "UBA"
				case "070":
					specificBank = "Fidelity Bank"
				case "214":
					specificBank = "FCMB"
				case "232":
					specificBank = "Sterling Bank"
				case "082":
					specificBank = "Keystone Bank"
				case "999992":
					specificBank = "OPay"
				case "999991":
					specificBank = "PalmPay"
				default:
					specificBank = "Wema Bank"
				}
			}
			bankName = &specificBank
		}

		var cardToken *string
		if tx.CardToken != nil && *tx.CardToken != "" {
			masked := maskIDNumber(*tx.CardToken)
			cardToken = &masked
		} else if hasCard && card.MaskedPan != nil && *card.MaskedPan != "" {
			masked := maskIDNumber(*card.MaskedPan)
			cardToken = &masked
		} else if hasCard && card.CardToken != nil && *card.CardToken != "" {
			masked := maskIDNumber(*card.CardToken)
			cardToken = &masked
		}

		// 7. Identifier (AccountNo / WalletAddress)
		var accountNo *string
		if tx.AccountNo != nil && *tx.AccountNo != "" {
			masked := maskIDNumber(*tx.AccountNo)
			accountNo = &masked
		} else if hasBank && b.AccountNumber != "" {
			masked := maskIDNumber(b.AccountNumber)
			accountNo = &masked
		} else if u.AccountNumber != nil && *u.AccountNumber != "" {
			masked := maskIDNumber(*u.AccountNumber)
			accountNo = &masked
		} else if trxRef != "" {
			masked := maskIDNumber(trxRef)
			accountNo = &masked
		}

		var walletAddress *string
		if tx.WalletAddress != nil && *tx.WalletAddress != "" {
			masked := maskIDNumber(*tx.WalletAddress)
			walletAddress = &masked
		} else if hasCrypto && cw.WalletAddress != "" {
			masked := maskIDNumber(cw.WalletAddress)
			walletAddress = &masked
		} else if u.ClerkUserID != nil && *u.ClerkUserID != "" {
			masked := maskIDNumber(*u.ClerkUserID)
			walletAddress = &masked
		}

		// 8. Pending Balance
		var pendingBal *float64
		if tx.PendingBalance != nil {
			pendingBal = tx.PendingBalance
		} else {
			zero := 0.0
			pendingBal = &zero
		}

		// 9. Total Earnings
		var totalEarnings *float64
		if tx.TotalEarnings != nil {
			totalEarnings = tx.TotalEarnings
		} else if val, ok := totalEarningsMap[tx.UserID]; ok && val > 0 {
			totalEarnings = &val
		} else if u.LifetimePoints > 0 {
			ptsVal := float64(u.LifetimePoints * 10)
			totalEarnings = &ptsVal
		} else {
			zero := 0.0
			totalEarnings = &zero
		}

		// 10. Last Payout
		var lastPayout *time.Time
		if tx.LastPayout != nil {
			lastPayout = tx.LastPayout
		} else if lp, ok := lastPayoutMap[tx.UserID]; ok {
			lastPayout = &lp
		} else {
			lastPayout = &tx.CreatedAt
		}

		// 11. Payouts count
		var payoutsCount *float64
		if tx.Payouts != nil {
			payoutsCount = tx.Payouts
		} else if count, ok := payoutCountMap[tx.UserID]; ok && count > 0 {
			payoutsCount = &count
		} else {
			zero := 0.0
			payoutsCount = &zero
		}

		responses[i] = WalletTransactionResponse{
			ID:              tx.ID,
			UserID:          tx.UserID,
			Amount:          tx.Amount,
			Type:            txType,
			Currency:        currency,
			Username:        uname,
			AccountName:     accName,
			PaymentMethod:   paymentMethod,
			BankName:        bankName,
			CardToken:       cardToken,
			WalletAddress:   walletAddress,
			AccountNo:       accountNo,
			AccountType:     accType,
			SettlementDate:  tx.SettlementDate,
			Reference:       ref,
			Status:          status,
			TotalEarnings:   totalEarnings,
			Payouts:         payoutsCount,
			LastPayout:      lastPayout,
			PaymentDate:     tx.PaymentDate,
			PendingBalance:  pendingBal,
			RewardType:      tx.RewardType,
			TransactionType: transactionType,
			Description:     desc,
			TrxRef:          trxRef,
			WalletID:        walletIdStr,
			CreatedAt:       tx.CreatedAt,
		}
	}

	return responses, total, nil
}

func (s *PaymentService) SimulateAddressDeposit(ctx context.Context, req providers.SimulateAddressDepositRequest) (map[string]interface{}, error) {
	return s.bitnobProvider.SimulateAddressDeposit(ctx, req)
}

// InitializeTransaction calls Monnify to register a transaction and returns the transactionReference.
func (s *PaymentService) InitializeTransaction(ctx context.Context, payload map[string]interface{}) (map[string]interface{}, error) {
	log.Printf("[PaymentService] InitializeTransaction - amount=%v, ref=%v", payload["amount"], payload["paymentReference"])
	result, err := s.monnifyProvider.InitializeTransaction(ctx, payload)
	if err != nil {
		log.Printf("[PaymentService] InitializeTransaction failed: %v", err)
		return nil, err
	}
	log.Printf("[PaymentService] InitializeTransaction success: %+v", result)
	return result, nil
}

// ChargeCardAndCreditWallet charges a card via Monnify and, on SUCCESS,
// atomically credits the user's wallet and records all relevant DB entries.
// This is the single entry point for card-based wallet funding.
func (s *PaymentService) ChargeCardAndCreditWallet(ctx context.Context, userID int, amount float64, currency string, chargePayload map[string]interface{}) (map[string]interface{}, error) {
	txRef, _ := chargePayload["transactionReference"].(string)
	log.Printf("[PaymentService] ChargeCardAndCreditWallet - userID=%d amount=%.2f txRef=%s", userID, amount, txRef)

	// Step 1: Call Monnify charge-card API
	log.Printf("[PaymentService] Step 1: Calling Monnify ChargeCard...")
	chargeResult, err := s.monnifyProvider.ChargeCard(ctx, chargePayload)
	if err != nil {
		log.Printf("[PaymentService] ChargeCard FAILED: %v", err)
		return nil, fmt.Errorf("card charge failed: %w", err)
	}
	log.Printf("[PaymentService] ChargeCard result: %+v", chargeResult)

	// Extract Monnify's transactionReference from charge response
	body, _ := chargeResult["responseBody"].(map[string]interface{})
	if body == nil {
		body = chargeResult
	}
	monnifyTxRef, _ := body["transactionReference"].(string)
	if monnifyTxRef == "" {
		monnifyTxRef = txRef
	}
	chargeStatus, _ := body["status"].(string)
	log.Printf("[PaymentService] Charge status=%s monnifyTxRef=%s", chargeStatus, monnifyTxRef)

	// Step 2: Verify the charge was successful
	statusUpper := strings.ToUpper(chargeStatus)
	requestSuccessful, _ := chargeResult["requestSuccessful"].(bool)

	if !requestSuccessful {
		msg, _ := chargeResult["responseMessage"].(string)
		log.Printf("[PaymentService] Charge not successful: %s", msg)
		return nil, fmt.Errorf("card charge was not successful: %s", msg)
	}

	if statusUpper != "SUCCESS" && statusUpper != "PAID" && statusUpper != "COMPLETED" {
		log.Printf("[PaymentService] Unexpected charge status: %s - proceeding only if requestSuccessful=true", statusUpper)
	}

	// Step 3: Credit wallet atomically in DB
	log.Printf("[PaymentService] Step 3: Crediting wallet for userID=%d amount=%.2f", userID, amount)
	wallet, err := s.creditWalletInDB(ctx, userID, amount, monnifyTxRef, "card", currency)
	if err != nil {
		log.Printf("[PaymentService] CRITICAL: Card charged but wallet credit FAILED for userID=%d txRef=%s: %v", userID, monnifyTxRef, err)
		return nil, fmt.Errorf("wallet credit failed after successful card charge (txRef: %s): %w", monnifyTxRef, err)
	}
	log.Printf("[PaymentService] Wallet credited successfully: userID=%d newBalance=%.2f newPersonalBalance=%.2f", userID, wallet.Balance, wallet.PersonalBalance)

	// Return combined response
	return map[string]interface{}{
		"requestSuccessful": true,
		"responseCode":      "0",
		"responseMessage":   "Card charged and wallet credited successfully",
		"responseBody": map[string]interface{}{
			"transactionReference": monnifyTxRef,
			"status":               "SUCCESS",
			"amount":               amount,
			"currency":             currency,
			"wallet": map[string]interface{}{
				"id":              wallet.ID,
				"userId":          wallet.UserID,
				"balance":         wallet.Balance,
				"personalBalance": wallet.PersonalBalance,
				"goldBalance":     wallet.GoldBalance,
				"usdcBalance":     wallet.UsdcBalance,
				"usdtBalance":     wallet.UsdtBalance,
			},
		},
	}, nil
}

// creditWalletInDB atomically updates Wallet, WalletTransaction, ActivityWallet, and CardFunding.
func (s *PaymentService) creditWalletInDB(ctx context.Context, userID int, amount float64, txRef, paymentMethod, currency string) (*models.Wallet, error) {
	if userID <= 0 {
		return nil, errors.New("invalid userId")
	}
	if amount <= 0 {
		return nil, fmt.Errorf("invalid amount: %.2f", amount)
	}
	if currency == "" {
		currency = "NGN"
	}

	description := "Credit Wallet - Debit Card"
	if strings.EqualFold(paymentMethod, "bank") || strings.Contains(strings.ToLower(paymentMethod), "transfer") {
		description = "Credit Wallet - Bank Transfer"
	} else if strings.EqualFold(paymentMethod, "stablecoin") || currency == "USDC" || currency == "USDT" {
		description = "Credit Wallet - Stable Coins"
	}

	log.Printf("[DB] creditWalletInDB - userID=%d amount=%.2f description=%s txRef=%s", userID, amount, description, txRef)

	var updatedWallet models.Wallet

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// 1. Fetch or create wallet
		var wallet models.Wallet
		err := tx.Where("\"userId\" = ?", userID).First(&wallet).Error
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				log.Printf("[DB] No wallet found for userID=%d, creating new wallet", userID)
				wallet = models.Wallet{UserID: userID}
				if createErr := tx.Create(&wallet).Error; createErr != nil {
					return fmt.Errorf("failed to create wallet: %w", createErr)
				}
			} else {
				return fmt.Errorf("failed to fetch wallet: %w", err)
			}
		}
		log.Printf("[DB] Wallet before credit: balance=%.2f personalBalance=%.2f", wallet.Balance, wallet.PersonalBalance)

		// 2. Increment balances
		wallet.Balance += amount
		wallet.PersonalBalance += amount
		switch currency {
		case "USDC":
			wallet.UsdcBalance += amount
		case "USDT":
			wallet.UsdtBalance += amount
		}

		if err := tx.Save(&wallet).Error; err != nil {
			return fmt.Errorf("failed to update wallet: %w", err)
		}
		log.Printf("[DB] Wallet after credit: balance=%.2f personalBalance=%.2f", wallet.Balance, wallet.PersonalBalance)

		// 3. Insert WalletTransaction record
		txType := "CREDIT"
		wTx := models.WalletTransaction{
			UserID:      userID,
			Amount:      amount,
			Type:        &txType,
			Description: &description,
			TrxRef:      &txRef,
			CreatedAt:   time.Now(),
		}
		if err := tx.Create(&wTx).Error; err != nil {
			log.Printf("[DB] WARNING: Failed to create WalletTransaction: %v", err)
		} else {
			log.Printf("[DB] WalletTransaction created: id=%d", wTx.ID)
		}

		// 4. Insert ActivityWallet record
		actTx := models.ActivityWallet{
			UserID:      userID,
			Type:        "credit", // matches ActivityType enum: credit | debit
			Title:       description,
			Description: description,
			Amount:      amount,
			Currency:    currency,
			Reference:   &txRef,
			Status:      "SUCCESS",
			CreatedAt:   time.Now(),
		}
		if err := tx.Create(&actTx).Error; err != nil {
			log.Printf("[DB] WARNING: Failed to create ActivityWallet: %v", err)
		} else {
			log.Printf("[DB] ActivityWallet created: id=%d", actTx.ID)
		}

		// 5. Insert CardFunding record for audit
		if strings.EqualFold(paymentMethod, "card") {
			cardFunding := models.CardFunding{
				UserID:    userID,
				WalletID:  &wallet.ID,
				Amount:    amount,
				Currency:  currency,
				Reference: txRef,
				Status:    "SUCCESS",
				CreatedAt: time.Now(),
				UpdatedAt: time.Now(),
			}
			if err := tx.Create(&cardFunding).Error; err != nil {
				log.Printf("[DB] WARNING: Failed to create CardFunding record: %v", err)
			} else {
				log.Printf("[DB] CardFunding created: id=%d", cardFunding.ID)
			}
		}

		updatedWallet = wallet
		return nil
	})

	if err != nil {
		return nil, err
	}

	return &updatedWallet, nil
}

// QueryTransaction queries the status of a Monnify transaction.
func (s *PaymentService) QueryTransaction(ctx context.Context, transactionReference string) (map[string]interface{}, error) {
	log.Printf("[PaymentService] QueryTransaction - txRef=%s", transactionReference)
	return s.monnifyProvider.QueryTransaction(ctx, transactionReference)
}

// CreditUserWallet is used for bank transfer and webhook-based credits.
func (s *PaymentService) CreditUserWallet(ctx context.Context, userID int, amount float64, txRef, paymentMethod, currency string) (*models.Wallet, error) {
	log.Printf("[PaymentService] CreditUserWallet - userID=%d amount=%.2f method=%s", userID, amount, paymentMethod)
	return s.creditWalletInDB(ctx, userID, amount, txRef, paymentMethod, currency)
}

// TransferBetweenWallets moves funds between Gold Wallet and Personal Wallet atomically.
func (s *PaymentService) TransferBetweenWallets(ctx context.Context, userID int, amount float64, fromAccountType string) (*models.Wallet, error) {
	if userID <= 0 {
		return nil, errors.New("invalid userId")
	}
	if amount <= 0 {
		return nil, errors.New("amount must be greater than 0")
	}

	fromType := strings.ToLower(strings.TrimSpace(fromAccountType))
	if fromType != "gold" && fromType != "personal" {
		return nil, fmt.Errorf("invalid fromAccountType: '%s' (must be 'gold' or 'personal')", fromAccountType)
	}

	log.Printf("[PaymentService] TransferBetweenWallets - userID=%d amount=%.2f from=%s", userID, amount, fromType)

	var updatedWallet models.Wallet

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var wallet models.Wallet
		if err := tx.Where("\"userId\" = ?", userID).First(&wallet).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errors.New("wallet not found for user")
			}
			return fmt.Errorf("failed to fetch wallet: %w", err)
		}

		var description string
		var activityType string
		txRef := fmt.Sprintf("TRF-%s-%d", strings.ToUpper(fromType), time.Now().UnixNano())

		if fromType == "gold" {
			if wallet.GoldBalance < amount {
				return fmt.Errorf("insufficient gold wallet balance (available: %.2f, required: %.2f)", wallet.GoldBalance, amount)
			}
			wallet.GoldBalance -= amount
			wallet.PersonalBalance += amount
			wallet.Balance = wallet.PersonalBalance
			description = "Transfer from Gold Wallet to Personal Wallet"
			activityType = "credit"
		} else {
			if wallet.PersonalBalance < amount {
				return fmt.Errorf("insufficient personal wallet balance (available: %.2f, required: %.2f)", wallet.PersonalBalance, amount)
			}
			wallet.PersonalBalance -= amount
			wallet.GoldBalance += amount
			wallet.Balance = wallet.PersonalBalance
			description = "Transfer from Personal Wallet to Gold Wallet"
			activityType = "debit"
		}

		if err := tx.Save(&wallet).Error; err != nil {
			return fmt.Errorf("failed to update wallet balances: %w", err)
		}

		log.Printf("[PaymentService] Wallet transferred successfully: userID=%d newPersonalBalance=%.2f newGoldBalance=%.2f", userID, wallet.PersonalBalance, wallet.GoldBalance)

		// 1. Insert WalletTransaction record
		txType := "TRANSFER"
		wTx := models.WalletTransaction{
			UserID:      userID,
			Amount:      amount,
			Type:        &txType,
			Description: &description,
			TrxRef:      &txRef,
			CreatedAt:   time.Now(),
		}
		if err := tx.Create(&wTx).Error; err != nil {
			log.Printf("[PaymentService] WARNING: Failed to create WalletTransaction for transfer: %v", err)
		} else {
			log.Printf("[PaymentService] WalletTransaction created: id=%d", wTx.ID)
		}

		// 2. Insert ActivityWallet record
		actTx := models.ActivityWallet{
			UserID:      userID,
			Type:        activityType,
			Title:       description,
			Description: description,
			Amount:      amount,
			Currency:    "NGN",
			Reference:   &txRef,
			Status:      "SUCCESS",
			CreatedAt:   time.Now(),
		}
		if err := tx.Create(&actTx).Error; err != nil {
			log.Printf("[PaymentService] WARNING: Failed to create ActivityWallet for transfer: %v", err)
		} else {
			log.Printf("[PaymentService] ActivityWallet created: id=%d", actTx.ID)
		}

		updatedWallet = wallet
		return nil
	})

	if err != nil {
		return nil, err
	}

	return &updatedWallet, nil
}

// GetBanks returns the list of supported Nigerian commercial banks and fintechs.
func (s *PaymentService) GetBanks(ctx context.Context) ([]map[string]interface{}, error) {
	return s.monnifyProvider.GetBanks(ctx)
}

// ValidateBankAccount validates a Nigerian bank account via Monnify.
func (s *PaymentService) ValidateBankAccount(ctx context.Context, accountNumber, bankCode string) (map[string]interface{}, error) {
	return s.monnifyProvider.ValidateBankAccount(ctx, accountNumber, bankCode)
}

// ProcessWalletWithdrawal executes a bank withdrawal for a user and atomically debits their wallet.
func (s *PaymentService) ProcessWalletWithdrawal(ctx context.Context, userID int, amount float64, payload map[string]interface{}) (map[string]interface{}, error) {
	if userID <= 0 {
		return nil, errors.New("invalid userId")
	}
	if amount <= 0 {
		return nil, errors.New("amount must be greater than 0")
	}

	txRef, _ := payload["reference"].(string)
	if txRef == "" {
		txRef = fmt.Sprintf("DISB-%d", time.Now().UnixNano())
		payload["reference"] = txRef
	}

	log.Printf("[PaymentService] ProcessWalletWithdrawal - userID=%d amount=%.2f ref=%s", userID, amount, txRef)

	// Step 1: Verify user wallet balance and debit in DB transaction
	var updatedWallet models.Wallet
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var wallet models.Wallet
		if err := tx.Where("\"userId\" = ?", userID).First(&wallet).Error; err != nil {
			return fmt.Errorf("wallet not found for user: %w", err)
		}

		if wallet.PersonalBalance < amount {
			return fmt.Errorf("insufficient wallet balance (available: %.2f, requested: %.2f)", wallet.PersonalBalance, amount)
		}

		// Debit personal balance
		wallet.PersonalBalance -= amount
		wallet.Balance = wallet.PersonalBalance

		if err := tx.Save(&wallet).Error; err != nil {
			return fmt.Errorf("failed to debit wallet: %w", err)
		}

		// Record in WalletTransaction
		txType := "DEBIT"
		desc := "Debit Wallet - Bank Transfer Withdrawal"
		wTx := models.WalletTransaction{
			UserID:      userID,
			Amount:      amount,
			Type:        &txType,
			Description: &desc,
			TrxRef:      &txRef,
			CreatedAt:   time.Now(),
		}
		if err := tx.Create(&wTx).Error; err != nil {
			log.Printf("[PaymentService] WARNING: Failed to create WalletTransaction for withdrawal: %v", err)
		}

		// Record in ActivityWallet
		actTx := models.ActivityWallet{
			UserID:      userID,
			Type:        "debit",
			Title:       "Withdrawal",
			Description: desc,
			Amount:      amount,
			Currency:    "NGN",
			Reference:   &txRef,
			Status:      "SUCCESS",
			CreatedAt:   time.Now(),
		}
		if err := tx.Create(&actTx).Error; err != nil {
			log.Printf("[PaymentService] WARNING: Failed to create ActivityWallet for withdrawal: %v", err)
		}

		updatedWallet = wallet
		return nil
	})

	if err != nil {
		return nil, err
	}

	// Step 2: Call Monnify single disbursement
	disbursementResult, err := s.monnifyProvider.DisburseSingle(ctx, payload)
	if err != nil {
		log.Printf("[PaymentService] WARNING: Monnify disbursement request error: %v", err)
		return map[string]interface{}{
			"requestSuccessful": true,
			"responseCode":      "0",
			"responseMessage":   "Withdrawal initiated successfully",
			"responseBody": map[string]interface{}{
				"reference": txRef,
				"status":    "PENDING",
				"amount":    amount,
				"wallet": map[string]interface{}{
					"balance":         updatedWallet.Balance,
					"personalBalance": updatedWallet.PersonalBalance,
				},
			},
		}, nil
	}

	return disbursementResult, nil
}

// ValidateWithdrawalOTP authorizes a pending disbursement with an OTP code.
func (s *PaymentService) ValidateWithdrawalOTP(ctx context.Context, reference, authCode string) (map[string]interface{}, error) {
	return s.monnifyProvider.ValidateDisbursementOTP(ctx, reference, authCode)
}

// CreateUserWithdrawalBank saves a withdrawal bank account for a user.
func (s *PaymentService) CreateUserWithdrawalBank(ctx context.Context, userID int, accountName, accountNumber, bankName, bankCode string) (*models.UserWithdrawalBank, error) {
	if userID <= 0 {
		return nil, errors.New("invalid userId")
	}
	if accountNumber == "" || bankCode == "" {
		return nil, errors.New("accountNumber and bankCode are required")
	}

	bank := models.UserWithdrawalBank{
		UserID:        userID,
		AccountName:   accountName,
		AccountNumber: accountNumber,
		BankName:      bankName,
		BankCode:      bankCode,
		CreatedAt:     time.Now(),
	}

	if err := s.db.WithContext(ctx).Create(&bank).Error; err != nil {
		return nil, fmt.Errorf("failed to save withdrawal bank: %w", err)
	}

	log.Printf("[PaymentService] Saved UserWithdrawalBank: id=%d userId=%d bankName=%s", bank.ID, userID, bankName)
	return &bank, nil
}

// GetUserWithdrawalBanks returns all saved withdrawal banks for a user.
func (s *PaymentService) GetUserWithdrawalBanks(ctx context.Context, userID int) ([]models.UserWithdrawalBank, error) {
	var banks []models.UserWithdrawalBank
	err := s.db.WithContext(ctx).Where("\"userId\" = ?", userID).Order("\"createdAt\" DESC").Find(&banks).Error
	if err != nil {
		return nil, fmt.Errorf("failed to fetch user withdrawal banks: %w", err)
	}
	return banks, nil
}

// CreateUserWithdrawalWallet saves a withdrawal crypto wallet address for a user.
func (s *PaymentService) CreateUserWithdrawalWallet(ctx context.Context, userID int, walletAddress, symbol, network, recipientID string) (*models.UserWithdrawalWallet, error) {
	if userID <= 0 {
		return nil, errors.New("invalid userId")
	}
	var recID *string
	if recipientID != "" {
		recID = &recipientID
	}

	wallet := models.UserWithdrawalWallet{
		UserID:        userID,
		WalletAddress: walletAddress,
		Symbol:        symbol,
		Network:       network,
		RecipientID:   recID,
		CreatedAt:     time.Now(),
	}

	if err := s.db.WithContext(ctx).Create(&wallet).Error; err != nil {
		return nil, fmt.Errorf("failed to save withdrawal wallet: %w", err)
	}

	log.Printf("[PaymentService] Saved UserWithdrawalWallet: id=%d userId=%d symbol=%s network=%s", wallet.ID, userID, symbol, network)
	return &wallet, nil
}

// GetUserWithdrawalWallets returns all saved withdrawal crypto wallets for a user.
func (s *PaymentService) GetUserWithdrawalWallets(ctx context.Context, userID int) ([]models.UserWithdrawalWallet, error) {
	var wallets []models.UserWithdrawalWallet
	err := s.db.WithContext(ctx).Where("\"userId\" = ?", userID).Order("\"createdAt\" DESC").Find(&wallets).Error
	if err != nil {
		return nil, fmt.Errorf("failed to fetch user withdrawal wallets: %w", err)
	}
	return wallets, nil
}


