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


