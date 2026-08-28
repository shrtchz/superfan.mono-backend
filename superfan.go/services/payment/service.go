package payment

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math"
	"strings"
	"time"

	"gorm.io/gorm"
	"quiz.superfan.com/apis/labels"
	"quiz.superfan.com/apis/models"
	"quiz.superfan.com/apis/services/payment/providers"
)

type PaymentService struct {
	db              *gorm.DB
	monnifyProvider *providers.MonnifyProvider
	bitnobProvider  *providers.BitnobProvider
}

type savedCardMetadata struct {
	CardToken string
	Last4     string
	First6    string
	MaskedPan string
	CardType  string
	Expiry    string
}

const minimumDepositAmount = 1000.0
const minimumWithdrawalAmount = 1000.0
const personalDepositHold = 5 * 24 * time.Hour

func stringValuePtr(value string) *string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return &value
}

func normalizeCardDigits(value string) string {
	var digits strings.Builder
	for _, r := range value {
		if r >= '0' && r <= '9' {
			digits.WriteRune(r)
		}
	}
	return digits.String()
}

func normalizeCardExpiry(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	trimmed = strings.ReplaceAll(trimmed, " ", "")
	if strings.Contains(trimmed, "/") {
		return trimmed
	}
	digits := normalizeCardDigits(trimmed)
	if len(digits) != 4 {
		return trimmed
	}
	return digits[:2] + "/" + digits[2:]
}

func buildMaskedPan(first6, last4 string) string {
	first := normalizeCardDigits(first6)
	last := normalizeCardDigits(last4)
	if len(first) >= 6 && len(last) >= 4 {
		return first[:6] + "******" + last[len(last)-4:]
	}
	if len(last) >= 4 {
		return "******" + last[len(last)-4:]
	}
	return first
}

func inferCardTypeFromBin(first6 string, brand string) string {
	brand = strings.TrimSpace(brand)
	if brand != "" {
		return brand
	}
	bin := normalizeCardDigits(first6)
	if strings.HasPrefix(bin, "4") {
		return "Visa"
	}
	if strings.HasPrefix(bin, "5") || strings.HasPrefix(bin, "2") {
		return "Mastercard"
	}
	if strings.HasPrefix(bin, "506") || strings.HasPrefix(bin, "6500") {
		return "Verve"
	}
	return "Card"
}

func stringFromAny(value interface{}) string {
	switch v := value.(type) {
	case string:
		return strings.TrimSpace(v)
	case fmt.Stringer:
		return strings.TrimSpace(v.String())
	case nil:
		return ""
	default:
		return strings.TrimSpace(fmt.Sprint(v))
	}
}

func extractCardMetadataFromChargeResponse(payload map[string]interface{}, chargeResult map[string]interface{}) (savedCardMetadata, error) {
	meta := savedCardMetadata{}
	cardMap, _ := payload["card"].(map[string]interface{})
	if cardMap == nil {
		cardMap = payload
	}

	if cardMap != nil {
		meta.CardToken = stringFromAny(cardMap["token"])
		if meta.CardToken == "" {
			meta.CardToken = stringFromAny(cardMap["cardToken"])
		}
		if meta.CardToken == "" {
			meta.CardToken = stringFromAny(cardMap["authorizationCode"])
		}
		if meta.CardType == "" {
			meta.CardType = stringFromAny(cardMap["type"])
		}
		if meta.CardType == "" {
			meta.CardType = stringFromAny(cardMap["brand"])
		}
		if meta.Expiry == "" {
			meta.Expiry = normalizeCardExpiry(stringFromAny(cardMap["expiry"]))
		}
		if meta.Expiry == "" {
			meta.Expiry = normalizeCardExpiry(stringFromAny(cardMap["expiryDate"]))
		}
		if meta.First6 == "" {
			meta.First6 = normalizeCardDigits(stringFromAny(cardMap["first6"]))
		}
		if meta.First6 == "" {
			meta.First6 = normalizeCardDigits(stringFromAny(cardMap["first_6digits"]))
		}
		if meta.Last4 == "" {
			meta.Last4 = normalizeCardDigits(stringFromAny(cardMap["last4"]))
		}
		if meta.Last4 == "" {
			meta.Last4 = normalizeCardDigits(stringFromAny(cardMap["last_4digits"]))
		}
		if meta.First6 == "" || meta.Last4 == "" {
			number := normalizeCardDigits(stringFromAny(cardMap["number"]))
			if len(number) >= 10 {
				if meta.First6 == "" && len(number) >= 6 {
					meta.First6 = number[:6]
				}
				if meta.Last4 == "" && len(number) >= 4 {
					meta.Last4 = number[len(number)-4:]
				}
			}
		}
	}

	body, _ := chargeResult["responseBody"].(map[string]interface{})
	if body == nil {
		body = chargeResult
	}
	if body != nil {
		cardDetails, _ := body["cardDetails"].(map[string]interface{})
		if cardDetails == nil {
			cardDetails = map[string]interface{}{}
		}
		merged := map[string]interface{}{}
		for k, v := range body {
			merged[k] = v
		}
		for k, v := range cardDetails {
			merged[k] = v
		}
		if meta.CardToken == "" {
			meta.CardToken = stringFromAny(merged["cardToken"])
		}
		if meta.CardToken == "" {
			meta.CardToken = stringFromAny(merged["token"])
		}
		if meta.CardType == "" {
			meta.CardType = inferCardTypeFromBin(stringFromAny(merged["first6"]), stringFromAny(merged["brand"]))
		}
		if meta.CardType == "" {
			meta.CardType = inferCardTypeFromBin(stringFromAny(merged["first_6digits"]), stringFromAny(merged["cardType"]))
		}
		if meta.Expiry == "" {
			meta.Expiry = normalizeCardExpiry(stringFromAny(merged["expiry"]))
		}
		if meta.Expiry == "" {
			meta.Expiry = normalizeCardExpiry(stringFromAny(merged["expiryDate"]))
		}
		if meta.First6 == "" {
			meta.First6 = normalizeCardDigits(stringFromAny(merged["first6"]))
		}
		if meta.First6 == "" {
			meta.First6 = normalizeCardDigits(stringFromAny(merged["first_6digits"]))
		}
		if meta.Last4 == "" {
			meta.Last4 = normalizeCardDigits(stringFromAny(merged["last4"]))
		}
		if meta.Last4 == "" {
			meta.Last4 = normalizeCardDigits(stringFromAny(merged["last_4digits"]))
		}
		if meta.First6 == "" || meta.Last4 == "" {
			number := normalizeCardDigits(stringFromAny(merged["number"]))
			if len(number) >= 10 {
				if meta.First6 == "" && len(number) >= 6 {
					meta.First6 = number[:6]
				}
				if meta.Last4 == "" && len(number) >= 4 {
					meta.Last4 = number[len(number)-4:]
				}
			}
		}
	}

	if meta.CardType == "" {
		meta.CardType = inferCardTypeFromBin(meta.First6, "")
	}
	if meta.Last4 == "" && meta.MaskedPan != "" {
		meta.Last4 = normalizeCardDigits(meta.MaskedPan)
	}
	if meta.MaskedPan == "" {
		meta.MaskedPan = buildMaskedPan(meta.First6, meta.Last4)
	}

	if meta.CardToken == "" && meta.MaskedPan == "" {
		return meta, errors.New("card details are missing from the successful charge response")
	}
	return meta, nil
}

func NewPaymentService(db *gorm.DB, monnify *providers.MonnifyProvider, bitnob *providers.BitnobProvider) *PaymentService {
	return &PaymentService{
		db:              db,
		monnifyProvider: monnify,
		bitnobProvider:  bitnob,
	}
}

// ValidateTransactionLimits enforces withdrawal minimums and KYC tier transaction limits (SCRUM-350)
func (s *PaymentService) ValidateTransactionLimits(ctx context.Context, userID int, amount float64, txType string) error {
	if amount <= 0 {
		return fmt.Errorf("transaction amount must be greater than zero")
	}

	// 1. Enforce the minimum withdrawal amount on all withdrawal requests.
	if strings.EqualFold(txType, "WITHDRAWAL") && amount < minimumWithdrawalAmount {
		return fmt.Errorf("minimum withdrawal amount is ₦%.0f. Requested: ₦%.2f", minimumWithdrawalAmount, amount)
	}

	// 2. Fetch user's KYC tier from User model
	var user models.User
	tier := "TIER_0"
	if err := s.db.WithContext(ctx).Where("id = ?", userID).First(&user).Error; err == nil {
		if user.KycTier != nil && *user.KycTier != "" {
			tier = strings.ToUpper(*user.KycTier)
		}
	}

	dailyLimit := 10000.0
	monthlyLimit := 50000.0
	if tier == "TIER_1" {
		dailyLimit = 500000.0
		monthlyLimit = 5000000.0
	}

	// 3. Compute rolling calendar day and month totals from WalletTransaction
	now := time.Now()
	startOfDay := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	startOfMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())

	type TxRow struct {
		Amount    float64
		CreatedAt time.Time
	}
	var txRows []TxRow
	// Only count withdrawal transactions, not ad payments (debits)
	// Withdrawals have "withdrawal" in the description
	err := s.db.WithContext(ctx).
		Table("WalletTransaction").
		Select("amount, \"createdAt\"").
		Where("\"userId\" = ? AND \"createdAt\" >= ?", userID, startOfMonth).
		Where("(status IS NULL OR UPPER(status) IN ('SUCCESS', 'PAID', 'COMPLETED'))").
		Where("LOWER(description) LIKE ?", "%withdrawal%").
		Find(&txRows).Error

	if err != nil {
		log.Printf("[PaymentService] WARNING: Failed to query transactions for limit check: %v", err)
	}

	dailyUsed := 0.0
	monthlyUsed := 0.0
	for _, row := range txRows {
		absAmt := math.Abs(row.Amount)
		monthlyUsed += absAmt
		if !row.CreatedAt.Before(startOfDay) {
			dailyUsed += absAmt
		}
	}

	// 4. Enforce daily limit
	if dailyUsed+amount > dailyLimit {
		if tier == "TIER_0" {
			return fmt.Errorf("transaction of ₦%.2f exceeds your daily limit of ₦%.2f (Used today: ₦%.2f, Remaining: ₦%.2f). Complete KYC identity verification to increase your limit to ₦500,000/day", amount, dailyLimit, dailyUsed, math.Max(0, dailyLimit-dailyUsed))
		}
		return fmt.Errorf("transaction of ₦%.2f exceeds your daily limit of ₦%.2f (Used today: ₦%.2f, Remaining: ₦%.2f)", amount, dailyLimit, dailyUsed, math.Max(0, dailyLimit-dailyUsed))
	}

	// 5. Enforce monthly limit
	if monthlyUsed+amount > monthlyLimit {
		if tier == "TIER_0" {
			return fmt.Errorf("transaction of ₦%.2f exceeds your monthly limit of ₦%.2f (Used this month: ₦%.2f, Remaining: ₦%.2f). Complete KYC identity verification to increase your limit to ₦5,000,000/month", amount, monthlyLimit, monthlyUsed, math.Max(0, monthlyLimit-monthlyUsed))
		}
		return fmt.Errorf("transaction of ₦%.2f exceeds your monthly limit of ₦%.2f (Used this month: ₦%.2f, Remaining: ₦%.2f)", amount, monthlyLimit, monthlyUsed, math.Max(0, monthlyLimit-monthlyUsed))
	}

	return nil
}

// InitiateDeposit starts the deposit process via provider.
func (s *PaymentService) InitiateDeposit(ctx context.Context, req providers.DepositRequest) (*providers.DepositResponse, error) {
	if req.Amount < minimumDepositAmount {
		return nil, fmt.Errorf("minimum deposit amount is NGN 1,000")
	}
	if req.UserID > 0 && req.Amount > 0 {
	}

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
		methodKey := "bankTransfer"
		switch currency {
		case "USDC", "USDT":
			methodKey = "stablecoin"
		}
		description := labels.Wallet("deposit", map[string]string{"method": labels.Method(methodKey)})
		txType := "CREDIT"
		status := "Completed"
		trxType := "Deposit"
		wTx := models.WalletTransaction{
			UserID:          0, // Stub or handled via relation
			Amount:          verification.Amount,
			Type:            &txType,
			TransactionType: &trxType,
			Status:          &status,
			Currency:        currency,
			Description:     &description,
			TrxRef:          &verification.TransactionReference,
			CreatedAt:       time.Now(),
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
			return &models.Wallet{UserID: userID, Balance: 0, GoldBalance: 0, PersonalBalance: 0, UsdcBalance: 0, UsdtBalance: 0, TotalBalance: 0, HoldBalance: 0, AvailablePersonalBalance: 0, AvailableBalance: 0}, nil
		}
		return nil, err
	}
	heldBalance, availablePersonal, err := s.getPersonalBalanceBreakdown(ctx, userID, wallet.PersonalBalance)
	if err != nil {
		return nil, err
	}
	wallet.HoldBalance = heldBalance
	wallet.AvailablePersonalBalance = availablePersonal
	wallet.TotalBalance = wallet.PersonalBalance + wallet.GoldBalance
	wallet.AvailableBalance = wallet.GoldBalance + availablePersonal
	return &wallet, nil
}

func (s *PaymentService) availablePersonalBalance(ctx context.Context, userID int, personalBalance float64) (float64, error) {
	_, available, err := s.getPersonalBalanceBreakdown(ctx, userID, personalBalance)
	return available, err
}

func (s *PaymentService) getPersonalBalanceBreakdown(ctx context.Context, userID int, personalBalance float64) (float64, float64, error) {
	var held float64
	err := s.db.WithContext(ctx).
		Table("WalletTransaction").
		Select("COALESCE(SUM(amount), 0)").
		Where(`"userId" = ? AND LOWER(COALESCE("account_type", '')) = 'personal' AND "holdUntil" > ?`, userID, time.Now()).
		Scan(&held).Error
	if err != nil {
		return 0, 0, fmt.Errorf("failed to calculate available wallet balance: %w", err)
	}
	return held, math.Max(0, personalBalance-held), nil
}

// GetExchangeRates returns live conversion rates for currencies
func (s *PaymentService) GetExchangeRates(ctx context.Context) (map[string]interface{}, error) {
	var rates []models.ExchangeRate
	_ = s.db.WithContext(ctx).Order(`"updatedAt" DESC`).Find(&rates).Error

	usdtRate := 1500.0
	usdcRate := 1500.0
	cngnRate := 1.0

	for _, r := range rates {
		from := strings.ToUpper(strings.TrimSpace(r.FromCurrency))
		to := strings.ToUpper(strings.TrimSpace(r.ToCurrency))
		if (from == "USDT" && (to == "NGN" || to == "")) || (from == "USD" && to == "NGN") {
			if r.Rate > 0 {
				usdtRate = r.Rate
			}
		}
		if (from == "USDC" && (to == "NGN" || to == "")) || (from == "USD" && to == "NGN") {
			if r.Rate > 0 {
				usdcRate = r.Rate
			}
		}
		if from == "CNGN" && (to == "NGN" || to == "") {
			if r.Rate > 0 {
				cngnRate = r.Rate
			}
		}
	}

	return map[string]interface{}{
		"base": "NGN",
		"rates": map[string]float64{
			"NGN":  1.0,
			"cNGN": 1.0 / cngnRate,
			"USDT": 1.0 / usdtRate,
			"USDC": 1.0 / usdcRate,
		},
		"pricesInNgn": map[string]float64{
			"NGN":  1.0,
			"cNGN": cngnRate,
			"USDT": usdtRate,
			"USDC": usdcRate,
		},
	}, nil
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
	LastPayout      *string    `json:"last_payout"`
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
	if filter.AccountType != "" && !strings.EqualFold(filter.AccountType, "all") {
		db = db.Where("\"account_type\" = ?", filter.AccountType)
	} else if filter.AccountType == "" {
		// Default to Personal Wallet deposits/withdrawals; exclude quiz rewards, gold credits, and referral bonuses
		db = db.Where("(\"account_type\" IS NULL OR \"account_type\" = '' OR LOWER(\"account_type\") = 'personal') AND (\"rewardType\" IS NULL OR \"rewardType\" = '') AND (\"description\" IS NULL OR (LOWER(\"description\") NOT LIKE '%quiz%' AND LOWER(\"description\") NOT LIKE '%reward%' AND LOWER(\"description\") NOT LIKE '%referral%' AND LOWER(\"description\") NOT LIKE '%bonus%'))")
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
	lastPayoutDescMap := make(map[int]string)
	payoutCountMap := make(map[int]float64)
	pendingPayoutsMap := make(map[int]float64)

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

		// 6. Total earnings are all positive credits recorded in the Gold wallet (rewards, quizzes, referrals, ads).
		type SumResult struct {
			UserID int     `gorm:"column:userId"`
			Total  float64 `gorm:"column:total"`
		}
		var earningsList []SumResult
		if err := s.db.WithContext(ctx).Model(&models.WalletTransaction{}).
			Select("\"userId\", SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as total").
			Where("\"userId\" IN ?", userIDs).
			Where("(LOWER(COALESCE(\"account_type\", '')) = 'gold' OR \"rewardType\" IS NOT NULL OR LOWER(COALESCE(\"description\", '')) LIKE '%quiz%' OR LOWER(COALESCE(\"description\", '')) LIKE '%reward%' OR LOWER(COALESCE(\"description\", '')) LIKE '%bonus%' OR LOWER(COALESCE(\"description\", '')) LIKE '%referral%')").
			Where("(status IS NULL OR UPPER(status) IN ('SUCCESS', 'PAID', 'COMPLETED'))").
			Group("\"userId\"").
			Scan(&earningsList).Error; err == nil {
			for _, res := range earningsList {
				totalEarningsMap[res.UserID] = res.Total
			}
		}

		// 7. Compute total pending payout/withdrawal amount per user from Payout and WalletTransaction
		type PendingResult struct {
			UserID int     `gorm:"column:userId"`
			Total  float64 `gorm:"column:total"`
		}
		var pendingPayoutsList []PendingResult
		if err := s.db.WithContext(ctx).Model(&models.Payout{}).
			Select("\"userId\", SUM(amount) as total").
			Where("\"userId\" IN ? AND (\"status\" ILIKE 'PENDING' OR \"status\" ILIKE 'PROCESSING')", userIDs).
			Group("\"userId\"").
			Scan(&pendingPayoutsList).Error; err == nil {
			for _, res := range pendingPayoutsList {
				pendingPayoutsMap[res.UserID] += res.Total
			}
		}
		var pendingTxList []PendingResult
		if err := s.db.WithContext(ctx).Model(&models.WalletTransaction{}).
			Select("\"userId\", SUM(CASE WHEN amount > 0 THEN amount ELSE -amount END) as total").
			Where("\"userId\" IN ? AND \"status\" ILIKE 'PENDING' AND (LOWER(COALESCE(type, '')) = 'debit' OR LOWER(COALESCE(\"description\", '')) LIKE '%withdraw%')", userIDs).
			Group("\"userId\"").
			Scan(&pendingTxList).Error; err == nil {
			for _, res := range pendingTxList {
				pendingPayoutsMap[res.UserID] += res.Total
			}
		}

		// 8. Count payouts/withdrawals per user from Payout table and Gold Wallet debits
		type CountResult struct {
			UserID int     `gorm:"column:userId"`
			Count  float64 `gorm:"column:count"`
		}
		var txPayoutCountList []CountResult
		if err := s.db.WithContext(ctx).Model(&models.WalletTransaction{}).
			Select("\"userId\", COUNT(*) as count").
			Where("\"userId\" IN ?", userIDs).
			Where("(LOWER(COALESCE(\"account_type\", '')) = 'gold' AND (LOWER(COALESCE(type, '')) = 'debit' OR LOWER(COALESCE(\"description\", '')) LIKE '%withdraw%'))").
			Group("\"userId\"").
			Scan(&txPayoutCountList).Error; err == nil {
			for _, res := range txPayoutCountList {
				payoutCountMap[res.UserID] += res.Count
			}
		}
		var payoutCountList []CountResult
		if err := s.db.WithContext(ctx).Model(&models.Payout{}).
			Select("\"userId\", COUNT(*) as count").
			Where("\"userId\" IN ?", userIDs).
			Group("\"userId\"").
			Scan(&payoutCountList).Error; err == nil {
			for _, res := range payoutCountList {
				payoutCountMap[res.UserID] += res.Count
			}
		}

		// 9. Use the latest actual payout date / reference as the last payout value.
		var payoutList []models.Payout
		if err := s.db.WithContext(ctx).Model(&models.Payout{}).
			Where("\"userId\" IN ?", userIDs).
			Order("\"createdAt\" DESC").
			Find(&payoutList).Error; err == nil {
			for _, payout := range payoutList {
				if _, exists := lastPayoutDescMap[payout.UserID]; !exists {
					lastPayoutDescMap[payout.UserID] = payout.CreatedAt.Format(time.RFC3339)
				}
			}
		}
		var goldTxList []models.WalletTransaction
		if err := s.db.WithContext(ctx).Model(&models.WalletTransaction{}).
			Where("\"userId\" IN ?", userIDs).
			Where("(LOWER(COALESCE(\"account_type\", '')) = 'gold' OR \"rewardType\" IS NOT NULL OR LOWER(COALESCE(\"description\", '')) LIKE '%quiz%' OR LOWER(COALESCE(\"description\", '')) LIKE '%reward%')").
			Order("\"createdAt\" DESC").
			Find(&goldTxList).Error; err == nil {
			for _, gtx := range goldTxList {
				if _, exists := lastPayoutDescMap[gtx.UserID]; !exists {
					lastPayoutDescMap[gtx.UserID] = gtx.CreatedAt.Format(time.RFC3339)
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
		descLowerForTransfer := strings.ToLower(desc)
		txTypeLowerForTransfer := strings.ToLower(transactionType)
		isInternalTransfer := txTypeLowerForTransfer == "transfer" ||
			strings.Contains(descLowerForTransfer, "transfer from") ||
			strings.Contains(descLowerForTransfer, "transfer to") ||
			strings.Contains(descLowerForTransfer, "between personal") ||
			strings.Contains(descLowerForTransfer, "between gold") ||
			strings.Contains(descLowerForTransfer, "gold to personal") ||
			strings.Contains(descLowerForTransfer, "personal to gold") ||
			strings.Contains(descLowerForTransfer, "trf-btw-wallets")

		if isInternalTransfer {
			bankName = nil
			cardToken = nil
			accountNo = nil
			walletAddress = nil
		} else {
			if tx.BankName == nil || *tx.BankName == "" {
				if tx.Currency == "USDC" || tx.Currency == "USDT" {
					scName := tx.Currency
					bankName = &scName
				} else {
					bankName = nil
				}
			}
			if tx.AccountNo == nil || *tx.AccountNo == "" {
				accountNo = nil
			}
			if tx.WalletAddress == nil || *tx.WalletAddress == "" {
				walletAddress = nil
			}
		}

		// 8. Pending Balance (Total pending payout amount)
		var pendingBal *float64
		if val, ok := pendingPayoutsMap[tx.UserID]; ok {
			pendingBal = &val
		} else {
			zero := 0.0
			pendingBal = &zero
		}

		// 9. Total Earnings (Ads, Quiz, Live Quiz, Referral)
		var totalEarnings *float64
		if val, ok := totalEarningsMap[tx.UserID]; ok && val > 0 {
			totalEarnings = &val
		} else if tx.TotalEarnings != nil && *tx.TotalEarnings > 0 {
			totalEarnings = tx.TotalEarnings
		} else {
			zero := 0.0
			totalEarnings = &zero
		}

		// 10. Last Payout (Description of the newest / most recent earning)
		var lastPayout *string
		if desc, ok := lastPayoutDescMap[tx.UserID]; ok && desc != "" {
			lastPayout = &desc
		} else {
			defaultDesc := "N/A"
			lastPayout = &defaultDesc
		}

		// 11. Payouts (Number of earnings the user has)
		var payoutsCount *float64
		if count, ok := payoutCountMap[tx.UserID]; ok {
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
	if uidFloat, ok := payload["userId"].(float64); ok && uidFloat > 0 {
		if amtFloat, ok := payload["amount"].(float64); ok && amtFloat > 0 {
			if err := s.ValidateTransactionLimits(ctx, int(uidFloat), amtFloat, "DEPOSIT"); err != nil {
				return nil, err
			}
		}
	}
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

	if amount < minimumDepositAmount {
		return nil, fmt.Errorf("minimum deposit amount is NGN 1,000")
	}

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

	cardMeta, metaErr := extractCardMetadataFromChargeResponse(chargePayload, chargeResult)
	if metaErr != nil {
		log.Printf("[PaymentService] WARNING: unable to extract reusable card metadata from successful charge response: %v", metaErr)
	}
	if cardMeta.CardType == "" {
		cardMeta.CardType = "Card"
	}
	if cardMeta.MaskedPan == "" && cardMeta.First6 != "" && cardMeta.Last4 != "" {
		cardMeta.MaskedPan = buildMaskedPan(cardMeta.First6, cardMeta.Last4)
	}
	if cardMeta.CardToken == "" {
		if rawToken, ok := chargePayload["card"].(map[string]interface{})["token"]; ok {
			cardMeta.CardToken = stringFromAny(rawToken)
		}
	}

	// Step 3: Credit wallet atomically in DB
	log.Printf("[PaymentService] Step 3: Crediting wallet for userID=%d amount=%.2f", userID, amount)
	wallet, err := s.creditWalletInDB(ctx, userID, amount, monnifyTxRef, "card", currency, &cardMeta)
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

// creditWalletInDB atomically updates Wallet, WalletTransaction, ActivityWallet, CardFunding, and UserCard.
func (s *PaymentService) creditWalletInDB(ctx context.Context, userID int, amount float64, txRef, paymentMethod, currency string, cardMeta *savedCardMetadata) (*models.Wallet, error) {
	if userID <= 0 {
		return nil, errors.New("invalid userId")
	}
	if amount <= 0 {
		return nil, fmt.Errorf("invalid amount: %.2f", amount)
	}
	if currency == "" {
		currency = "NGN"
	}

	methodKey := "debitCard"
	if strings.EqualFold(paymentMethod, "bank") || strings.Contains(strings.ToLower(paymentMethod), "transfer") {
		methodKey = "bankTransfer"
	} else if strings.EqualFold(paymentMethod, "stablecoin") || currency == "USDC" || currency == "USDT" {
		methodKey = "stablecoin"
	}
	description := labels.Wallet("deposit", map[string]string{"method": labels.Method(methodKey)})
	paymentMethodValue := "ACCOUNT_TRANSFER"
	if methodKey == "debitCard" {
		paymentMethodValue = "CARD"
	} else if methodKey == "stablecoin" {
		paymentMethodValue = "STABLE_COIN"
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
		holdUntil := time.Now().Add(personalDepositHold)
		accountType := "Personal"
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
		status := "Completed"
		trxType := "Deposit"
		wTx := models.WalletTransaction{
			UserID:          userID,
			Amount:          amount,
			Type:            &txType,
			TransactionType: &trxType,
			Status:          &status,
			Currency:        currency,
			Description:     &description,
			TrxRef:          &txRef,
			PaymentMethod:   &paymentMethodValue,
			AccountType:     &accountType,
			HoldUntil:       &holdUntil,
			CreatedAt:       time.Now(),
		}
		if err := tx.Create(&wTx).Error; err != nil {
			return fmt.Errorf("failed to create WalletTransaction: %w", err)
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

		// 5. Insert CardFunding record for audit and persist reusable card metadata.
		if strings.EqualFold(paymentMethod, "card") {
			cardFunding := models.CardFunding{
				UserID:    userID,
				WalletID:  &wallet.ID,
				Amount:    amount,
				Currency:  currency,
				Reference: txRef,
				Status:    "SUCCESS",
				CardToken: func() string {
					if cardMeta != nil {
						return cardMeta.CardToken
					}
					return ""
				}(),
				CardLast4: func() string {
					if cardMeta != nil {
						return cardMeta.Last4
					}
					return ""
				}(),
				CreatedAt: time.Now(),
				UpdatedAt: time.Now(),
			}
			if err := tx.Create(&cardFunding).Error; err != nil {
				log.Printf("[DB] WARNING: Failed to create CardFunding record: %v", err)
			} else {
				log.Printf("[DB] CardFunding created: id=%d", cardFunding.ID)
			}

			if cardMeta != nil && (cardMeta.CardToken != "" || cardMeta.MaskedPan != "") {
				var existing models.UserCard
				err := tx.Where("\"userId\" = ? AND (COALESCE(\"cardToken\", '') = ? OR COALESCE(\"maskedPan\", '') = ?)", userID, cardMeta.CardToken, cardMeta.MaskedPan).First(&existing).Error
				if errors.Is(err, gorm.ErrRecordNotFound) {
					cardRecord := models.UserCard{
						UserID:    userID,
						CardToken: stringValuePtr(cardMeta.CardToken),
						MaskedPan: stringValuePtr(cardMeta.MaskedPan),
						CardType:  stringValuePtr(cardMeta.CardType),
						Expiry:    stringValuePtr(cardMeta.Expiry),
						IsDefault: true,
						CreatedAt: time.Now(),
						UpdatedAt: time.Now(),
					}
					if err := tx.Create(&cardRecord).Error; err != nil {
						log.Printf("[DB] WARNING: Failed to create UserCard record: %v", err)
					} else {
						log.Printf("[DB] UserCard created: id=%d token=%s maskedPan=%s", cardRecord.ID, cardMeta.CardToken, cardMeta.MaskedPan)
					}
				} else if err == nil {
					updates := map[string]interface{}{}
					if cardMeta.CardToken != "" {
						updates["cardToken"] = cardMeta.CardToken
					}
					if cardMeta.MaskedPan != "" {
						updates["maskedPan"] = cardMeta.MaskedPan
					}
					if cardMeta.CardType != "" {
						updates["cardType"] = cardMeta.CardType
					}
					if cardMeta.Expiry != "" {
						updates["expiry"] = cardMeta.Expiry
					}
					if len(updates) > 0 {
						updates["updatedAt"] = time.Now()
						if err := tx.Model(&existing).Updates(updates).Error; err != nil {
							log.Printf("[DB] WARNING: Failed to update UserCard record: %v", err)
						} else {
							log.Printf("[DB] UserCard updated: id=%d", existing.ID)
						}
					}
				} else {
					log.Printf("[DB] WARNING: Failed to query existing UserCard: %v", err)
				}
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
	return s.creditWalletInDB(ctx, userID, amount, txRef, paymentMethod, currency, nil)
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
			description = labels.Wallet("transferGoldToPersonal", nil)
			activityType = "credit"
		} else {
			if wallet.PersonalBalance < amount {
				return fmt.Errorf("insufficient personal wallet balance (available: %.2f, required: %.2f)", wallet.PersonalBalance, amount)
			}
			wallet.PersonalBalance -= amount
			wallet.GoldBalance += amount
			wallet.Balance = wallet.PersonalBalance
			description = labels.Wallet("transferPersonalToGold", nil)
			activityType = "debit"
		}

		if err := tx.Save(&wallet).Error; err != nil {
			return fmt.Errorf("failed to update wallet balances: %w", err)
		}

		log.Printf("[PaymentService] Wallet transferred successfully: userID=%d newPersonalBalance=%.2f newGoldBalance=%.2f", userID, wallet.PersonalBalance, wallet.GoldBalance)

		// 1. Insert WalletTransaction record
		txType := "TRANSFER"
		status := "Completed"
		trxType := "Transfer"
		wTx := models.WalletTransaction{
			UserID:          userID,
			Amount:          amount,
			Type:            &txType,
			TransactionType: &trxType,
			Status:          &status,
			Currency:        "NGN",
			Description:     &description,
			TrxRef:          &txRef,
			CreatedAt:       time.Now(),
		}
		if err := tx.Create(&wTx).Error; err != nil {
			return fmt.Errorf("failed to create WalletTransaction for transfer: %w", err)
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

	// Enforce the minimum withdrawal and KYC transaction limits (SCRUM-350).
	if err := s.ValidateTransactionLimits(ctx, userID, amount, "WITHDRAWAL"); err != nil {
		return nil, err
	}

	txRef, _ := payload["reference"].(string)
	if txRef == "" {
		txRef = fmt.Sprintf("DISB-%d", time.Now().UnixNano())
		payload["reference"] = txRef
	}

	log.Printf("[PaymentService] ProcessWalletWithdrawal - userID=%d amount=%.2f ref=%s", userID, amount, txRef)
	accountName, _ := payload["accountName"].(string)
	accountNumber, _ := payload["destinationAccountNumber"].(string)
	if accountNumber == "" {
		accountNumber, _ = payload["accountNumber"].(string)
	}
	bankName, _ := payload["destinationBankName"].(string)
	if bankName == "" {
		bankName, _ = payload["bankName"].(string)
	}
	paymentMethod := "bankTransfer"
	transactionType := "WITHDRAWAL"
	txStatus := "Pending"
	accountType := "Personal"

	// Step 1: Verify user wallet balance and debit in DB transaction
	var updatedWallet models.Wallet
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var wallet models.Wallet
		if err := tx.Where("\"userId\" = ?", userID).First(&wallet).Error; err != nil {
			return fmt.Errorf("wallet not found for user: %w", err)
		}

		availablePersonal, err := s.availablePersonalBalance(ctx, userID, wallet.PersonalBalance)
		if err != nil {
			return err
		}
		if availablePersonal < amount {
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
			UserID:          userID,
			Amount:          amount,
			Type:            &txType,
			TransactionType: &transactionType,
			Status:          &txStatus,
			Currency:        "NGN",
			Description:     &desc,
			TrxRef:          &txRef,
			AccountName:     &accountName,
			AccountNo:       &accountNumber,
			BankName:        &bankName,
			PaymentMethod:   &paymentMethod,
			AccountType:     &accountType,
			CreatedAt:       time.Now(),
		}
		if err := tx.Create(&wTx).Error; err != nil {
			return fmt.Errorf("failed to create WalletTransaction for withdrawal: %w", err)
		}

		// Record in ActivityWallet
		actTx := models.ActivityWallet{
			UserID:      userID,
			Type:        "debit",
			Title:       desc,
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

// DebitUserWallet atomically debits a user's wallet for ad campaigns or services, creating both WalletTransaction and ActivityWallet records.
func (s *PaymentService) DebitUserWallet(ctx context.Context, userID int, amount float64, description, txRef string) (*models.Wallet, error) {
	if userID <= 0 {
		return nil, errors.New("invalid userId")
	}
	if amount <= 0 {
		return nil, errors.New("amount must be greater than 0")
	}
	if description == "" {
		description = "Ad Fee Wallet Debit"
	}
	if txRef == "" {
		txRef = fmt.Sprintf("DEBIT-ADS-%d", time.Now().UnixNano())
	}

	log.Printf("[PaymentService] DebitUserWallet - userID=%d amount=%.2f desc=%s ref=%s", userID, amount, description, txRef)

	var updatedWallet models.Wallet
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var wallet models.Wallet
		if err := tx.Where("\"userId\" = ?", userID).First(&wallet).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errors.New("wallet not found for user")
			}
			return fmt.Errorf("failed to fetch wallet: %w", err)
		}

		if wallet.PersonalBalance < amount {
			return fmt.Errorf("insufficient wallet balance (available: %.2f, required: %.2f)", wallet.PersonalBalance, amount)
		}

		// Debit personal balance
		wallet.PersonalBalance -= amount
		wallet.Balance = wallet.PersonalBalance

		if err := tx.Save(&wallet).Error; err != nil {
			return fmt.Errorf("failed to debit wallet: %w", err)
		}

		// Record in WalletTransaction
		txType := "DEBIT"
		status := "Completed"
		trxType := "Payment"
		wTx := models.WalletTransaction{
			UserID:          userID,
			Amount:          amount,
			Type:            &txType,
			TransactionType: &trxType,
			Status:          &status,
			Currency:        "NGN",
			Description:     &description,
			TrxRef:          &txRef,
			CreatedAt:       time.Now(),
		}
		if err := tx.Create(&wTx).Error; err != nil {
			return fmt.Errorf("failed to create WalletTransaction for debit: %w", err)
		}

		// Record in ActivityWallet
		actTx := models.ActivityWallet{
			UserID:      userID,
			Type:        "debit",
			Title:       description,
			Description: description,
			Amount:      amount,
			Currency:    "NGN",
			Reference:   &txRef,
			Status:      "SUCCESS",
			CreatedAt:   time.Now(),
		}
		if err := tx.Create(&actTx).Error; err != nil {
			log.Printf("[PaymentService] WARNING: Failed to create ActivityWallet for debit: %v", err)
		}

		updatedWallet = wallet
		return nil
	})

	if err != nil {
		return nil, err
	}

	return &updatedWallet, nil
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
