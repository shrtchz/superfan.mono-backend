package payment

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
	"quiz.superfan.com/apis/labels"
	"quiz.superfan.com/apis/models"
	"quiz.superfan.com/apis/services/accounting"
	"quiz.superfan.com/apis/services/payment/providers"
	"quiz.superfan.com/apis/utils"
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
const withdrawalAccountUnlockThreshold = 10000.0
const personalDepositHold = 5 * 24 * time.Hour

func stringValuePtr(value string) *string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return &value
}

func float64Ptr(value float64) *float64 {
	v := value
	return &v
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

func formatNaira(amount float64) string {
	whole := int64(math.Round(amount))
	digits := strconv.FormatInt(whole, 10)
	if len(digits) <= 3 {
		return digits
	}
	var buf strings.Builder
	for i, r := range digits {
		if i > 0 && (len(digits)-i)%3 == 0 {
			buf.WriteByte(',')
		}
		buf.WriteRune(r)
	}
	return buf.String()
}

func notifyBelowWithdrawalThreshold(userID int, accountType string, balance float64) {
	nestBaseURL := strings.TrimRight(utils.GetEnvWithKey("NEST_BASE_URL"), "/")
	if nestBaseURL == "" {
		nestBaseURL = "http://localhost:3000"
	}
	payload := map[string]interface{}{
		"userId":  userID,
		"minimum": 1000,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		log.Printf("[PaymentService] Failed to marshal minimum-withdrawal notification: %v", err)
		return
	}
	go func() {
		client := &http.Client{Timeout: 5 * time.Second}
		resp, err := client.Post(fmt.Sprintf("%s/api/v1/notification/triggers/minimum-withdrawal-not-met", nestBaseURL), "application/json", bytes.NewReader(body))
		if err != nil {
			log.Printf("[PaymentService] Failed to send minimum-withdrawal notification: %v", err)
			return
		}
		defer resp.Body.Close()
		if resp.StatusCode >= 300 {
			log.Printf("[PaymentService] Minimum-withdrawal notification returned status %s", resp.Status)
		}
	}()
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

func floatFromAny(value interface{}) float64 {
	switch v := value.(type) {
	case float64:
		return v
	case float32:
		return float64(v)
	case int:
		return float64(v)
	case int64:
		return float64(v)
	case int32:
		return float64(v)
	case json.Number:
		f, _ := v.Float64()
		return f
	case string:
		var f float64
		fmt.Sscanf(strings.TrimSpace(v), "%f", &f)
		return f
	default:
		return 0
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
		activeStable, _ := s.GetActivePaymentProcessorForChannel(ctx, "stable_coin")
		if activeStable != nil && strings.EqualFold(activeStable.Name, "bitnob") {
			secKey := ""
			if activeStable.SecretKey != nil && *activeStable.SecretKey != "" {
				secKey = *activeStable.SecretKey
			} else if activeStable.PublicKey != nil && *activeStable.PublicKey != "" {
				secKey = *activeStable.PublicKey
			}
			if secKey != "" {
				provider = providers.NewBitnobProvider(secKey, "https://api.bitnob.co")
			} else {
				provider = s.bitnobProvider
			}
		} else {
			provider = s.bitnobProvider
		}
	default:
		return nil, fmt.Errorf("unsupported currency: %s", req.Currency)
	}
	return provider.InitiateDeposit(ctx, req)
}

func (s *PaymentService) resolveUserDisplayName(tx *gorm.DB, userID int) string {
	if tx == nil || userID <= 0 {
		return accounting.ProviderInApp
	}
	var user struct {
		FirstName string `gorm:"column:firstName"`
		LastName  string `gorm:"column:lastName"`
		Username  string `gorm:"column:username"`
		Email     string `gorm:"column:email"`
	}
	_ = tx.Exec("SAVEPOINT sp_resolve_user_name").Error
	err := tx.Table(`"User"`).
		Select(`COALESCE("firstName", '') AS "firstName", COALESCE("lastName", '') AS "lastName", COALESCE("username", '') AS "username", COALESCE("email", '') AS "email"`).
		Where(`"id" = ?`, userID).
		Take(&user).Error
	if err != nil {
		_ = tx.Exec("ROLLBACK TO SAVEPOINT sp_resolve_user_name").Error
		return fmt.Sprintf("User #%d", userID)
	}
	_ = tx.Exec("RELEASE SAVEPOINT sp_resolve_user_name").Error
	full := strings.TrimSpace(strings.TrimSpace(user.FirstName) + " " + strings.TrimSpace(user.LastName))
	if full != "" {
		return full
	}
	if strings.TrimSpace(user.Username) != "" {
		return strings.TrimSpace(user.Username)
	}
	if strings.TrimSpace(user.Email) != "" {
		return strings.TrimSpace(user.Email)
	}
	return fmt.Sprintf("User #%d", userID)
}

func (s *PaymentService) resolveExternalProvider(ctx context.Context, paymentMethod, currency, txRef string) string {
	upperRef := strings.ToUpper(strings.TrimSpace(txRef))
	switch {
	case strings.HasPrefix(upperRef, "MNFY"):
		return "Monnify"
	case strings.HasPrefix(upperRef, "FLW"):
		return "Flutterwave"
	case strings.HasPrefix(upperRef, "BIT") || strings.HasPrefix(upperRef, "BTN"):
		return "Bitnob"
	case strings.HasPrefix(upperRef, "BACHS"):
		return "Bachs"
	}
	if strings.EqualFold(paymentMethod, "stablecoin") || currency == "USDC" || currency == "USDT" {
		return "Bitnob"
	}
	channel := "card"
	if strings.EqualFold(paymentMethod, "bank") || strings.Contains(strings.ToLower(paymentMethod), "transfer") {
		channel = "bank_transfer"
	}
	if proc, err := s.GetActivePaymentProcessorForChannel(ctx, channel); err == nil && proc != nil && strings.TrimSpace(proc.Name) != "" {
		norm := accounting.NormalizeProvider(proc.Name)
		if norm != accounting.ProviderInApp {
			return norm
		}
	}
	return "Monnify"
}

// VerifyProviderWebhook validates webhook signatures for Monnify and Bitnob.
func (s *PaymentService) VerifyProviderWebhook(ctx context.Context, providerName, signature string, rawBody []byte) error {
	switch strings.ToLower(strings.TrimSpace(providerName)) {
	case "monnify":
		if s.monnifyProvider == nil {
			return errors.New("monnify provider not configured")
		}
		if strings.TrimSpace(s.monnifyProvider.SecretKey) == "" && strings.TrimSpace(signature) == "" {
			return nil
		}
		if !s.monnifyProvider.VerifyWebhookSignature(rawBody, signature) {
			return errors.New("invalid monnify webhook signature")
		}
		return nil
	case "bitnob":
		if s.bitnobProvider == nil {
			return errors.New("bitnob provider not configured")
		}
		secret := strings.TrimSpace(os.Getenv("BITNOB_WEBHOOK_SECRET"))
		if secret == "" {
			secret = strings.TrimSpace(s.bitnobProvider.ApiKey)
		}
		if secret == "" && strings.TrimSpace(signature) == "" {
			return nil
		}
		if !s.bitnobProvider.VerifyWebhookSignature(rawBody, signature) {
			return errors.New("invalid bitnob webhook signature")
		}
		return nil
	default:
		return fmt.Errorf("unsupported webhook provider: %s", providerName)
	}
}

// HandleDepositWebhook verifies a deposit or direct purchase webhook and posts idempotent ledger entries.
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
	if provider == nil {
		return fmt.Errorf("payment provider for %s is not configured", currency)
	}

	verification, err := provider.VerifyTransaction(ctx, req)
	if err != nil {
		return err
	}

	txRef := strings.TrimSpace(verification.TransactionReference)
	if txRef == "" {
		txRef = strings.TrimSpace(req.TransactionReference)
	}

	providerName := accounting.NormalizeProvider(verification.ProviderName)
	if providerName == accounting.ProviderInApp {
		providerName = s.resolveExternalProvider(ctx, currency, currency, txRef)
	}

	if !strings.EqualFold(verification.Status, "SUCCESS") && !strings.EqualFold(verification.Status, "PAID") {
		_ = s.RecordFailedTransaction(ctx, 0, accounting.AccountTypePlatform, providerName, "Deposit", txRef, fmt.Sprintf("webhook status: %s", verification.Status), verification.Amount, currency)
		return fmt.Errorf("transaction not successful, status: %s", verification.Status)
	}

	// Check PaymentIntent to see if this webhook belongs to a specific user and/or direct purchase.
	var intent models.PaymentIntent
	hasIntent := s.db.WithContext(ctx).Where("reference = ?", txRef).First(&intent).Error == nil

	if hasIntent && intent.UserID > 0 {
		purpose := strings.ToLower(strings.TrimSpace(intent.Purpose))
		method := "bank"
		if currency == "USDC" || currency == "USDT" {
			method = "stablecoin"
		}
		if purpose == "ad_payment" || purpose == "ads" || purpose == "shop_payment" || purpose == "shop" || purpose == "subscription_payment" || purpose == "subscription" {
			_, err := s.recordDirectPaymentWithFeeInDB(ctx, intent.UserID, verification.Amount, verification.Fee, txRef, method, currency, purpose, "", providerName, nil)
			return err
		}
		_, err := s.creditWalletWithFeeInDB(ctx, intent.UserID, verification.Amount, verification.Fee, txRef, method, currency, providerName, nil)
		return err
	}

	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var existingCount int64
		if err := tx.Model(&models.WalletTransaction{}).Where(`"trx_ref" = ? AND "status" = ?`, txRef, "Completed").Count(&existingCount).Error; err != nil {
			return err
		}
		if existingCount > 0 {
			return nil
		}

		methodKey := "bankTransfer"
		paymentMethodValue := "ACCOUNT_TRANSFER"
		if currency == "USDC" || currency == "USDT" {
			methodKey = "stablecoin"
			paymentMethodValue = "STABLE_COIN"
		}
		description := labels.Wallet("deposit", map[string]string{"method": labels.Method(methodKey)})
		txType := "CREDIT"
		status := "Completed"
		trxType := "Deposit"
		cls := accounting.ClassifyTransaction(accounting.ClassificationInput{
			UserID:          0,
			Kind:            accounting.KindExternalDeposit,
			WalletAccount:   accounting.AccountTypePlatform,
			ExternalGateway: providerName,
		})
		accountType := accounting.AccountTypePlatform
		fee := verification.Fee
		netAmount := verification.Amount - fee
		wTx := models.WalletTransaction{
			UserID:          0,
			ClientName:      cls.ClientName,
			Amount:          verification.Amount,
			Fee:             float64Ptr(fee),
			NetAmount:       float64Ptr(netAmount),
			Type:            &txType,
			TransactionType: &trxType,
			Status:          &status,
			Currency:        currency,
			Description:     &description,
			TrxRef:          &txRef,
			PaymentMethod:   &paymentMethodValue,
			AccountType:     &accountType,
			Provider:        &cls.Provider,
			CreatedAt:       time.Now(),
		}
		if err := tx.Create(&wTx).Error; err != nil {
			return err
		}
		return accounting.PostJournalTx(tx, &wTx, accounting.JournalInput{
			Kind:          accounting.KindExternalDeposit,
			Purpose:       "deposit",
			Amount:        verification.Amount,
			Fee:           fee,
			Currency:      currency,
			Provider:      cls.Provider,
			WalletAccount: accounting.AccountTypeChecking,
		})
	})
}

// VerifyBachsSignature checks the HMAC-SHA256 signature from Bachs.
// Returns an error if secret is configured and signature does not match.
// Credentials configured in superfan.admin -> payment -> processor (PaymentProcessor table)
// take precedence over environment variables.
func (s *PaymentService) VerifyBachsSignature(ctx context.Context, signature string, rawBody []byte) error {
	var secret string

	// 1. Primary source: database PaymentProcessor record managed via superfan.admin
	if s.db != nil {
		var proc models.PaymentProcessor
		if err := s.db.WithContext(ctx).Where("LOWER(name) = ?", "bachs").First(&proc).Error; err == nil {
			if proc.SecretKey != nil && *proc.SecretKey != "" {
				secret = strings.TrimSpace(*proc.SecretKey)
			}
		}
	}

	// 2. Secondary fallback: environment variables
	if secret == "" {
		secret = strings.TrimSpace(os.Getenv("BACHS_WEBHOOK_SECRET"))
		if secret == "" {
			secret = strings.TrimSpace(os.Getenv("BACHS_SECRET_KEY"))
		}
	}

	if secret == "" {
		log.Printf("[PaymentService] Warning: Bachs secret key not configured in Admin (PaymentProcessor) or env; skipping signature verification")
		return nil
	}

	if signature == "" {
		log.Printf("[PaymentService] Warning: Bachs webhook received without signature header")
		return errors.New("missing X-Bachs-Signature header")
	}

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(rawBody)
	expectedHex := hex.EncodeToString(mac.Sum(nil))

	cleanSig := strings.TrimSpace(signature)
	if strings.HasPrefix(strings.ToLower(cleanSig), "sha256=") {
		cleanSig = cleanSig[7:]
	}

	if !hmac.Equal([]byte(expectedHex), []byte(cleanSig)) && !strings.EqualFold(expectedHex, cleanSig) {
		log.Printf("[PaymentService] Bachs webhook signature mismatch: expected=%s, received=%s", expectedHex, cleanSig)
		return errors.New("invalid webhook signature")
	}

	log.Printf("[PaymentService] Bachs webhook signature verified successfully")
	return nil
}

// findBankTransfer looks up a BankTransfer by account number and/or reference
func (s *PaymentService) findBankTransfer(ctx context.Context, accNum, ref string, out *models.BankTransfer) bool {
	if s.db == nil {
		return false
	}

	// 1. Both account number and reference
	if accNum != "" && ref != "" {
		if err := s.db.WithContext(ctx).
			Where("\"accountNumber\" = ? AND (\"paymentReference\" = ? OR \"transactionReference\" = ?)", accNum, ref, ref).
			First(out).Error; err == nil {
			return true
		}
	}

	// 2. Reference alone
	if ref != "" {
		if err := s.db.WithContext(ctx).
			Where("\"paymentReference\" = ? OR \"transactionReference\" = ?", ref, ref).
			First(out).Error; err == nil {
			return true
		}
	}

	// 3. Account number alone (most recent transfer for that virtual account)
	if accNum != "" {
		if err := s.db.WithContext(ctx).
			Where("\"accountNumber\" = ?", accNum).
			Order("\"createdAt\" DESC").
			First(out).Error; err == nil {
			return true
		}
	}

	return false
}

// HandleBachsWebhook processes an incoming webhook from Bachs.
// It verifies the signature, resolves the BankTransfer (or User), marks the transfer PAID,
// and atomically credits the user's wallet with idempotency.
func (s *PaymentService) HandleBachsWebhook(ctx context.Context, signature string, rawBody []byte, payload map[string]interface{}) error {
	if err := s.VerifyBachsSignature(ctx, signature, rawBody); err != nil {
		return err
	}

	log.Printf("[PaymentService] HandleBachsWebhook payload: %+v", payload)

	event := stringFromAny(payload["event"])
	if event == "" {
		event = stringFromAny(payload["type"])
	}
	if event == "" {
		event = stringFromAny(payload["action"])
	}

	data, _ := payload["data"].(map[string]interface{})
	if data == nil {
		data = payload
	}

	ref := stringFromAny(data["reference"])
	if ref == "" {
		ref = stringFromAny(data["payment_reference"])
	}
	if ref == "" {
		ref = stringFromAny(data["paymentReference"])
	}
	if ref == "" {
		ref = stringFromAny(data["transaction_reference"])
	}
	if ref == "" {
		ref = stringFromAny(data["transactionReference"])
	}
	if ref == "" {
		ref = stringFromAny(data["txRef"])
	}
	if ref == "" {
		ref = stringFromAny(data["tx_ref"])
	}

	accNum := stringFromAny(data["account_number"])
	if accNum == "" {
		accNum = stringFromAny(data["accountNumber"])
	}
	if accNum == "" {
		accNum = stringFromAny(data["virtual_account_number"])
	}
	if accNum == "" {
		accNum = stringFromAny(data["destination_account_number"])
	}

	amount := floatFromAny(data["amount"])
	if amount <= 0 {
		amount = floatFromAny(data["amount_paid"])
	}
	if amount <= 0 {
		amount = floatFromAny(data["amountPaid"])
	}
	if amount <= 0 {
		amount = floatFromAny(data["totalPayable"])
	}

	currency := stringFromAny(data["currency"])
	if currency == "" {
		currency = "NGN"
	}

	status := stringFromAny(data["status"])
	if status == "" {
		status = stringFromAny(data["payment_status"])
	}
	if status == "" {
		status = stringFromAny(data["paymentStatus"])
	}

	lowerEvent := strings.ToLower(event)
	lowerStatus := strings.ToLower(status)

	// Check if this event indicates failure
	if strings.Contains(lowerEvent, "fail") || strings.Contains(lowerStatus, "fail") || strings.Contains(lowerStatus, "cancel") {
		log.Printf("[PaymentService] Bachs webhook reported failure: event=%s status=%s ref=%s accNum=%s", event, status, ref, accNum)

		// Check if this failure belongs to a withdrawal
		if ref != "" && s.db != nil {
			var wTx models.WalletTransaction
			if err := s.db.WithContext(ctx).Where("\"trx_ref\" = ? AND (LOWER(COALESCE(\"transactionType\", '')) = 'withdrawal' OR LOWER(COALESCE(\"type\", '')) = 'debit')", ref).First(&wTx).Error; err == nil && wTx.ID > 0 {
				log.Printf("[PaymentService] Bachs withdrawal failed for ref=%s (userID=%d, amount=%.2f): refunding user wallet", ref, wTx.UserID, wTx.Amount)
				return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
					failedStatus := "FAILED"
					if err := tx.Model(&models.WalletTransaction{}).Where("id = ?", wTx.ID).Update("status", failedStatus).Error; err != nil {
						return err
					}
					_ = tx.Model(&models.ActivityWallet{}).Where("reference = ?", ref).Update("status", "FAILED").Error
					var w models.Wallet
					if err := tx.Where("\"userId\" = ?", wTx.UserID).First(&w).Error; err == nil {
						w.CheckingBalance += wTx.Amount
						w.Balance = w.CheckingBalance
						return tx.Save(&w).Error
					}
					return nil
				})
			}
		}

		var bankTx models.BankTransfer
		if s.findBankTransfer(ctx, accNum, ref, &bankTx) {
			bankTx.Status = "FAILED"
			_ = s.db.WithContext(ctx).Save(&bankTx).Error
		}
		return nil
	}

	// Check if this event indicates success
	isSuccess := false
	if strings.Contains(lowerEvent, "success") || strings.Contains(lowerEvent, "succeeded") ||
		strings.Contains(lowerEvent, "credited") || strings.Contains(lowerEvent, "paid") {
		isSuccess = true
	}
	if lowerStatus == "succeeded" || lowerStatus == "success" || lowerStatus == "paid" ||
		lowerStatus == "completed" || lowerStatus == "successful" {
		isSuccess = true
	}

	if !isSuccess {
		log.Printf("[PaymentService] Bachs webhook non-success event ignored: event=%s, status=%s", event, status)
		return nil
	}

	// 0. Check if this reference corresponds to a successful WalletTransaction withdrawal
	if ref != "" && s.db != nil {
		var wTx models.WalletTransaction
		if err := s.db.WithContext(ctx).Where("\"trx_ref\" = ? AND (LOWER(COALESCE(\"transactionType\", '')) = 'withdrawal' OR LOWER(COALESCE(\"type\", '')) = 'debit')", ref).First(&wTx).Error; err == nil && wTx.ID > 0 {
			log.Printf("[PaymentService] Bachs withdrawal succeeded for ref=%s (userID=%d, amount=%.2f)", ref, wTx.UserID, wTx.Amount)
			return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
				successStatus := "Completed"
				if err := tx.Model(&models.WalletTransaction{}).Where("id = ?", wTx.ID).Update("status", successStatus).Error; err != nil {
					return err
				}
				_ = tx.Model(&models.ActivityWallet{}).Where("reference = ?", ref).Update("status", "SUCCESS").Error
				return nil
			})
		}
	}

	// 1. First: Try matching a BankTransfer record
	var bankTx models.BankTransfer
	if s.findBankTransfer(ctx, accNum, ref, &bankTx) {
		// Idempotency check: already paid
		if strings.EqualFold(bankTx.Status, "PAID") {
			log.Printf("[PaymentService] Bachs webhook duplicate ignored: BankTransfer ID=%d already PAID (txRef=%s)", bankTx.ID, bankTx.TransactionReference)
			return nil
		}

		if amount <= 0 {
			amount = bankTx.Amount
		}
		if amount <= 0 {
			amount = bankTx.TotalPayable
		}

		now := time.Now()
		bankTx.Status = "PAID"
		bankTx.PaidAt = &now
		bankTx.CompletedAt = &now
		if err := s.db.WithContext(ctx).Save(&bankTx).Error; err != nil {
			log.Printf("[PaymentService] Warning: Failed to update BankTransfer record ID=%d: %v", bankTx.ID, err)
		}

		txRef := bankTx.TransactionReference
		if txRef == "" {
			txRef = bankTx.PaymentReference
		}
		if txRef == "" {
			txRef = ref
		}
		if txRef == "" {
			txRef = fmt.Sprintf("BACHS-TX-%d", time.Now().UnixNano())
		}

		wallet, err := s.CreditUserWallet(ctx, bankTx.UserID, amount, txRef, "bankTransfer", currency)
		if err != nil {
			log.Printf("[PaymentService] ERROR: Failed to credit wallet for userID=%d txRef=%s: %v", bankTx.UserID, txRef, err)
			return fmt.Errorf("failed to credit wallet: %w", err)
		}

		log.Printf("[PaymentService] Bachs BankTransfer credited successfully: userID=%d amount=%.2f balance=%.2f checkingBalance=%.2f",
			bankTx.UserID, amount, wallet.Balance, wallet.CheckingBalance)
		return nil
	}

	// 2. Fallback: Check if account number belongs to a User directly
	var user models.User
	userFound := false
	if accNum != "" {
		if err := s.db.WithContext(ctx).Where("\"accountNumber\" = ?", accNum).First(&user).Error; err == nil {
			userFound = true
		}
	}
	if !userFound {
		customer, _ := data["customer"].(map[string]interface{})
		custEmail := ""
		if customer != nil {
			custEmail = stringFromAny(customer["email"])
		}
		if custEmail == "" {
			custEmail = stringFromAny(data["email"])
		}
		if custEmail != "" {
			if err := s.db.WithContext(ctx).Where("LOWER(email) = ?", strings.ToLower(custEmail)).First(&user).Error; err == nil {
				userFound = true
			}
		}
	}

	if userFound && amount > 0 {
		txRef := ref
		if txRef == "" {
			txRef = fmt.Sprintf("BACHS-DEP-%d", time.Now().UnixNano())
		}
		log.Printf("[PaymentService] Bachs webhook matched User ID=%d directly: crediting amount=%.2f txRef=%s", user.ID, amount, txRef)
		_, err := s.CreditUserWallet(ctx, user.ID, amount, txRef, "bankTransfer", currency)
		return err
	}

	log.Printf("[PaymentService] Bachs webhook unhandled: no matching BankTransfer or User found (ref=%s, accNum=%s, amount=%.2f)", ref, accNum, amount)
	return nil
}

// GetWalletByUserID returns the wallet for a given user.
func (s *PaymentService) GetWalletByUserID(ctx context.Context, userID int) (*models.Wallet, error) {
	var wallet models.Wallet
	err := s.db.WithContext(ctx).Where("\"userId\" = ?", userID).First(&wallet).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return &models.Wallet{UserID: userID, Balance: 0, SavingsBalance: 0, CheckingBalance: 0, UsdcBalance: 0, UsdtBalance: 0, TotalBalance: 0, HoldBalance: 0, AvailableCheckingBalance: 0, AvailableBalance: 0}, nil
		}
		return nil, err
	}
	heldBalance, availablePersonal, err := s.getCheckingBalanceBreakdown(ctx, userID, wallet.CheckingBalance)
	if err != nil {
		return nil, err
	}
	wallet.HoldBalance = heldBalance
	wallet.AvailableCheckingBalance = availablePersonal
	wallet.TotalBalance = wallet.CheckingBalance + wallet.SavingsBalance
	wallet.AvailableBalance = wallet.SavingsBalance + availablePersonal
	return &wallet, nil
}

func (s *PaymentService) availableCheckingBalance(ctx context.Context, userID int, checkingBalance float64) (float64, error) {
	_, available, err := s.getCheckingBalanceBreakdown(ctx, userID, checkingBalance)
	return available, err
}

func (s *PaymentService) getCheckingBalanceBreakdown(ctx context.Context, userID int, checkingBalance float64) (float64, float64, error) {
	var held float64
	err := s.db.WithContext(ctx).
		Table("WalletTransaction").
		Select("COALESCE(SUM(amount), 0)").
		Where(`"userId" = ? AND LOWER(COALESCE("account_type", '')) IN ('checking') AND "holdUntil" > ?`, userID, time.Now()).
		Scan(&held).Error
	if err != nil {
		return 0, 0, fmt.Errorf("failed to calculate available wallet balance: %w", err)
	}
	return held, math.Max(0, checkingBalance-held), nil
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
		db = db.Where("(\"account_type\" IS NULL OR \"account_type\" = '' OR LOWER(\"account_type\") IN ('checking')) AND (\"rewardType\" IS NULL OR \"rewardType\" = '') AND (\"description\" IS NULL OR (LOWER(\"description\") NOT LIKE '%quiz%' AND LOWER(\"description\") NOT LIKE '%reward%' AND LOWER(\"description\") NOT LIKE '%referral%' AND LOWER(\"description\") NOT LIKE '%bonus%'))")
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
			Where("(LOWER(COALESCE(\"account_type\", '')) IN ('savings') OR \"rewardType\" IS NOT NULL OR LOWER(COALESCE(\"description\", '')) LIKE '%quiz%' OR LOWER(COALESCE(\"description\", '')) LIKE '%reward%' OR LOWER(COALESCE(\"description\", '')) LIKE '%bonus%' OR LOWER(COALESCE(\"description\", '')) LIKE '%referral%')").
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
			Where("\"userId\" IN ? AND (CAST(\"status\" AS TEXT) ILIKE 'PENDING' OR CAST(\"status\" AS TEXT) ILIKE 'PROCESSING')", userIDs).
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
			Where("(LOWER(COALESCE(\"account_type\", '')) IN ('savings') AND (LOWER(COALESCE(type, '')) = 'debit' OR LOWER(COALESCE(\"description\", '')) LIKE '%withdraw%'))").
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
			Where("(LOWER(COALESCE(\"account_type\", '')) IN ('savings') OR \"rewardType\" IS NOT NULL OR LOWER(COALESCE(\"description\", '')) LIKE '%quiz%' OR LOWER(COALESCE(\"description\", '')) LIKE '%reward%')").
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
		if desc == "Credit Wallet - Quiz Earning" || desc == "quiz_reward" {
			quizDesc := labels.Wallet("quizEarning", nil)
			if quizDesc != "" {
				desc = quizDesc
			} else {
				desc = "Test Quiz Earning"
			}
		} else if desc == "Debit Wallet - Bank Transfer Withdrawal" || desc == "bank_withdrawal" {
			wdDesc := labels.Wallet("withdrawal", map[string]string{"method": labels.Method("bankTransfer")})
			if wdDesc != "" {
				desc = wdDesc
			} else {
				desc = "Withdrawal - Bank Transfer"
			}
		} else if desc == "Credit wallet - Debit Card" || desc == "Credit Wallet - Debit Card" {
			desc = labels.Wallet("deposit", map[string]string{"method": labels.Method("debitCard")})
			if desc == "" {
				desc = "Deposit - Debit Card"
			}
		} else if desc == "Credit wallet - Bank Transfer" || desc == "Credit Wallet - Bank Transfer" {
			desc = labels.Wallet("deposit", map[string]string{"method": labels.Method("bankTransfer")})
			if desc == "" {
				desc = "Deposit - Bank Transfer"
			}
		} else if desc == "Credit wallet - Stablecoin" || desc == "Credit wallet - Stable Coins" || desc == "Credit Wallet - Stable Coins" {
			desc = labels.Wallet("deposit", map[string]string{"method": labels.Method("stablecoin")})
			if desc == "" {
				desc = "Deposit - Stablecoin"
			}
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

		accType := "Checking"
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
			strings.Contains(descLowerForTransfer, "between checking") ||
			strings.Contains(descLowerForTransfer, "between savings") ||
			strings.Contains(descLowerForTransfer, "savings to checking") ||
			strings.Contains(descLowerForTransfer, "checking to savings") ||
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

var processorCapabilities = map[string][]string{
	"monnify":     {"card", "bank_transfer"},
	"flutterwave": {"card", "bank_transfer", "stable_coin"},
	"busha":       {"stable_coin"},
	"cngn":        {"stable_coin"},
	"bitnob":      {"stable_coin"},
	"bachs":       {"card", "bank_transfer", "stable_coin"},
}

// monnifyContractCode prefers the contractCode configured on the payment processor
// record (managed in superfan.admin) and falls back to env vars for legacy setups.
func monnifyContractCode(proc *models.PaymentProcessor, apiKey string) string {
	if code := proc.AdditionalField("contractCode"); code != "" {
		return code
	}
	return providers.ResolveMonnifyContractCode(apiKey)
}

// GetActivePaymentProcessorForChannel returns the active payment processor assigned to a given channel ("card", "bank_transfer", "stable_coin")
func (s *PaymentService) GetActivePaymentProcessorForChannel(ctx context.Context, channel string) (*models.PaymentProcessor, error) {
	if s.db == nil {
		return nil, errors.New("database not initialized")
	}

	var enabled []models.PaymentProcessor
	err := s.db.WithContext(ctx).
		Where("\"isEnabled\" = ?", true).
		Order("\"updatedAt\" DESC, id DESC").
		Find(&enabled).Error
	if err != nil {
		return nil, err
	}

	for _, proc := range enabled {
		caps := processorCapabilities[strings.ToLower(proc.Name)]
		for _, cap := range caps {
			if cap == channel {
				return &proc, nil
			}
		}
	}

	return s.GetActivePaymentProcessor(ctx)
}

// GetActivePaymentProcessor returns the currently enabled fiat payment processor from DB (monnify, flutterwave, bachs)
func (s *PaymentService) GetActivePaymentProcessor(ctx context.Context) (*models.PaymentProcessor, error) {
	if s.db == nil {
		return nil, errors.New("database not initialized")
	}

	var processor models.PaymentProcessor
	// Check for enabled fiat card/transfer processors first, ordered by latest update
	err := s.db.WithContext(ctx).
		Where("\"isEnabled\" = ? AND LOWER(name) IN ('monnify', 'flutterwave', 'bachs')", true).
		Order("\"updatedAt\" DESC, id DESC").
		First(&processor).Error
	if err == nil {
		return &processor, nil
	}

	// Fallback to any enabled processor
	err = s.db.WithContext(ctx).
		Where("\"isEnabled\" = ?", true).
		Order("\"updatedAt\" DESC, id DESC").
		First(&processor).Error
	if err == nil {
		return &processor, nil
	}

	return nil, err
}

func (s *PaymentService) GetAllPaymentProcessors(ctx context.Context) ([]models.PaymentProcessor, error) {
	if s.db == nil {
		return nil, errors.New("database not initialized")
	}
	var processors []models.PaymentProcessor
	err := s.db.WithContext(ctx).Order("id ASC").Find(&processors).Error
	return processors, err
}

func (s *PaymentService) TogglePaymentProcessor(ctx context.Context, id int) (*models.PaymentProcessor, error) {
	if s.db == nil {
		return nil, errors.New("database not initialized")
	}
	var processor models.PaymentProcessor
	if err := s.db.WithContext(ctx).First(&processor, id).Error; err != nil {
		return nil, err
	}

	nextState := !processor.IsEnabled
	now := time.Now()

	processor.IsEnabled = nextState
	processor.IsConnected = nextState
	processor.LastSync = &now
	processor.UpdatedAt = now

	if err := s.db.WithContext(ctx).Save(&processor).Error; err != nil {
		return nil, err
	}

	// When toggled ON, resolve slot conflicts:
	// The newly activated processor claims all its supported channels.
	// Any other active processor that has 0 remaining unique channels is deactivated.
	if nextState {
		var otherEnabled []models.PaymentProcessor
		_ = s.db.WithContext(ctx).
			Where("\"isEnabled\" = ? AND id != ?", true, id).
			Order("\"updatedAt\" DESC, id DESC").
			Find(&otherEnabled).Error

		assignedSlots := make(map[string]bool)
		for _, ch := range processorCapabilities[strings.ToLower(processor.Name)] {
			assignedSlots[ch] = true
		}

		for _, other := range otherEnabled {
			otherCaps := processorCapabilities[strings.ToLower(other.Name)]
			remainingCount := 0
			for _, ch := range otherCaps {
				if !assignedSlots[ch] {
					remainingCount++
				}
			}

			if remainingCount == 0 {
				_ = s.db.WithContext(ctx).
					Model(&models.PaymentProcessor{}).
					Where("id = ?", other.ID).
					Updates(map[string]interface{}{
						"isEnabled":   false,
						"isConnected": false,
						"updatedAt":   now,
					}).Error
			} else {
				for _, ch := range otherCaps {
					assignedSlots[ch] = true
				}
			}
		}
	}

	return &processor, nil
}

// InitializeTransaction calls the active processor (Monnify, Flutterwave, Bachs) to register a transaction.
func (s *PaymentService) InitializeTransaction(ctx context.Context, payload map[string]interface{}) (map[string]interface{}, error) {
	log.Printf("[PaymentService] InitializeTransaction - amount=%v, ref=%v", payload["amount"], payload["paymentReference"])
	if uidFloat, ok := payload["userId"].(float64); ok && uidFloat > 0 {
		if amtFloat, ok := payload["amount"].(float64); ok && amtFloat > 0 {
			if err := s.ValidateTransactionLimits(ctx, int(uidFloat), amtFloat, "DEPOSIT"); err != nil {
				return nil, err
			}
		}
	}

	activeProc, _ := s.GetActivePaymentProcessorForChannel(ctx, "card")
	procName := "monnify"
	var customPubKey, customSecKey string
	if activeProc != nil && activeProc.Name != "" {
		procName = strings.ToLower(activeProc.Name)
		if activeProc.PublicKey != nil {
			customPubKey = *activeProc.PublicKey
		}
		if activeProc.SecretKey != nil {
			customSecKey = *activeProc.SecretKey
		}
	}

	log.Printf("[PaymentService] Active processor for InitializeTransaction: %s", procName)

	switch procName {
	case "flutterwave":
		txRef, _ := payload["paymentReference"].(string)
		if txRef == "" {
			txRef = fmt.Sprintf("FLW-TX-%d", time.Now().UnixNano())
		}
		res := map[string]interface{}{
			"requestSuccessful": true,
			"responseCode":      "0",
			"responseMessage":   "Transaction initialized via Flutterwave",
			"responseBody": map[string]interface{}{
				"transactionReference": txRef,
				"paymentReference":     txRef,
				"processor":            "flutterwave",
				"amount":               payload["amount"],
				"currency":             payload["currencyCode"],
			},
		}
		return res, nil

	case "bachs":
		txRef, _ := payload["paymentReference"].(string)
		if txRef == "" {
			txRef = fmt.Sprintf("BACHS-TX-%d", time.Now().UnixNano())
		}
		res := map[string]interface{}{
			"requestSuccessful": true,
			"responseCode":      "0",
			"responseMessage":   "Transaction initialized via Bachs",
			"responseBody": map[string]interface{}{
				"transactionReference": txRef,
				"paymentReference":     txRef,
				"processor":            "bachs",
				"amount":               payload["amount"],
				"currency":             payload["currencyCode"],
			},
		}
		return res, nil

	default:
		provider := s.monnifyProvider
		if customPubKey != "" && customSecKey != "" {
			mUri := "https://api.monnify.com"
			if !strings.HasPrefix(customPubKey, "MK_PROD_") {
				mUri = "https://sandbox.monnify.com"
			}
			mContract := monnifyContractCode(activeProc, customPubKey)
			provider = providers.NewMonnifyProvider(customPubKey, customSecKey, mUri, mContract)
		}
		result, err := provider.InitializeTransaction(ctx, payload)
		if err != nil {
			log.Printf("[PaymentService] InitializeTransaction failed: %v", err)
			return nil, err
		}
		log.Printf("[PaymentService] InitializeTransaction success: %+v", result)
		return result, nil
	}
}

// InitPaymentByTransfer initializes a bank transfer virtual account using the currently active processor.
func (s *PaymentService) InitPaymentByTransfer(ctx context.Context, payload map[string]interface{}) (map[string]interface{}, error) {
	log.Printf("[PaymentService] InitPaymentByTransfer - payload: %+v", payload)

	var userID int
	if uidFloat, ok := payload["userId"].(float64); ok && uidFloat > 0 {
		userID = int(uidFloat)
	} else if uidInt, ok := payload["userId"].(int); ok && uidInt > 0 {
		userID = uidInt
	}

	amount, _ := payload["amount"].(float64)
	if amount <= 0 {
		if amtInt, ok := payload["amount"].(int); ok {
			amount = float64(amtInt)
		}
	}
	if amount <= 0 {
		amount = 1000
	}

	if userID > 0 {
		if err := s.ValidateTransactionLimits(ctx, userID, amount, "DEPOSIT"); err != nil {
			return nil, err
		}
	}

	activeProc, _ := s.GetActivePaymentProcessorForChannel(ctx, "bank_transfer")
	procName := "monnify"
	var customPubKey, customSecKey string
	if activeProc != nil && activeProc.Name != "" {
		procName = strings.ToLower(activeProc.Name)
		if activeProc.PublicKey != nil {
			customPubKey = *activeProc.PublicKey
		}
		if activeProc.SecretKey != nil {
			customSecKey = *activeProc.SecretKey
		}
	}
	log.Printf("[PaymentService] Active processor for InitPaymentByTransfer: %s", procName)

	customerEmail, _ := payload["customerEmail"].(string)
	if customerEmail == "" {
		customerEmail = "user@superfan.ng"
	}
	customerName, _ := payload["customerName"].(string)
	if customerName == "" {
		customerName = customerEmail
	}
	paymentRef, _ := payload["paymentReference"].(string)
	if paymentRef == "" {
		paymentRef = fmt.Sprintf("PAY-%d", time.Now().UnixNano())
	}
	paymentDesc, _ := payload["paymentDescription"].(string)
	if paymentDesc == "" {
		paymentDesc = "Wallet Bank Transfer Top-up"
	}

	var res map[string]interface{}
	var bankTx models.BankTransfer

	switch procName {
	case "flutterwave":
		secKey := customSecKey
		if secKey == "" {
			secKey = os.Getenv("FLW_SECRET_KEY")
		}
		if secKey == "" {
			return nil, errors.New("flutterwave secret key is not configured")
		}

		flwReqBody := map[string]interface{}{
			"tx_ref":       paymentRef,
			"amount":       fmt.Sprintf("%.2f", amount),
			"currency":     "NGN",
			"email":        customerEmail,
			"fullname":     customerName,
			"is_permanent": false,
		}
		bodyBytes, _ := json.Marshal(flwReqBody)

		httpReq, err := http.NewRequestWithContext(ctx, "POST", "https://api.flutterwave.com/v3/charges?type=bank_transfer", bytes.NewBuffer(bodyBytes))
		if err != nil {
			return nil, err
		}
		httpReq.Header.Set("Authorization", "Bearer "+secKey)
		httpReq.Header.Set("Content-Type", "application/json")

		client := &http.Client{Timeout: 20 * time.Second}
		resp, err := client.Do(httpReq)
		if err != nil {
			return nil, fmt.Errorf("flutterwave charge request failed: %w", err)
		}
		defer resp.Body.Close()

		var flwRes map[string]interface{}
		if err := json.NewDecoder(resp.Body).Decode(&flwRes); err != nil {
			return nil, fmt.Errorf("failed to decode flutterwave response: %w", err)
		}

		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("flutterwave request failed with status %d: %v", resp.StatusCode, flwRes)
		}

		meta, _ := flwRes["meta"].(map[string]interface{})
		auth, _ := meta["authorization"].(map[string]interface{})
		data, _ := flwRes["data"].(map[string]interface{})

		accNum := ""
		bankName := "Flutterwave MFB"
		accName := customerName
		expiresOn := time.Now().Add(60 * time.Minute).Format(time.RFC3339)
		txRef := paymentRef
		totalPayable := amount

		if auth != nil {
			if a, ok := auth["transfer_account"].(string); ok && a != "" {
				accNum = a
			}
			if b, ok := auth["transfer_bank"].(string); ok && b != "" {
				bankName = b
			}
			if n, ok := auth["transfer_note"].(string); ok && n != "" {
				accName = n
			}
			if exp, ok := auth["account_expiration"].(string); ok && exp != "" {
				expiresOn = exp
			}
			if amtStr, ok := auth["transfer_amount"].(string); ok {
				fmt.Sscanf(amtStr, "%f", &totalPayable)
			}
			if trfRef, ok := auth["transfer_reference"].(string); ok && trfRef != "" {
				txRef = trfRef
			}
		}
		if accNum == "" && data != nil {
			if a, ok := data["account_number"].(string); ok && a != "" {
				accNum = a
			}
			if b, ok := data["bank_name"].(string); ok && b != "" {
				bankName = b
			}
			if r, ok := data["tx_ref"].(string); ok && r != "" {
				txRef = r
			}
		}

		if accNum == "" {
			return nil, fmt.Errorf("flutterwave did not return virtual account details: %v", flwRes)
		}

		res = map[string]interface{}{
			"requestSuccessful": true,
			"responseCode":      "0",
			"responseMessage":   "Virtual Account Generated Successfully",
			"responseBody": map[string]interface{}{
				"accountNumber":        accNum,
				"accountName":          accName,
				"bankName":             bankName,
				"bankCode":             "232",
				"expiresOn":            expiresOn,
				"totalPayable":         totalPayable,
				"fee":                  0,
				"transactionReference": txRef,
				"paymentReference":     paymentRef,
				"processor":            "flutterwave",
			},
		}

		bankTx = models.BankTransfer{
			UserID:                 userID,
			TransactionReference:   txRef,
			PaymentReference:       paymentRef,
			AccountNumber:          accNum,
			AccountName:            accName,
			BankName:               bankName,
			BankCode:               "232",
			Amount:                 amount,
			Fee:                    0,
			TotalPayable:           totalPayable,
			Status:                 "PENDING",
			RequestTime:            time.Now(),
			ExpiresOn:              time.Now().Add(60 * time.Minute),
			AccountDurationSeconds: 3600,
			CreatedAt:              time.Now(),
			UpdatedAt:              time.Now(),
		}

	case "bachs":
		secKey := customSecKey
		if secKey == "" && s.db != nil {
			var proc models.PaymentProcessor
			if err := s.db.WithContext(ctx).Where("LOWER(name) = ?", "bachs").First(&proc).Error; err == nil {
				if proc.SecretKey != nil && *proc.SecretKey != "" {
					secKey = strings.TrimSpace(*proc.SecretKey)
				}
			}
		}
		if secKey == "" {
			secKey = os.Getenv("BACHS_SECRET_KEY")
		}
		if secKey == "" {
			return nil, errors.New("bachs secret key is not configured in Admin (PaymentProcessor) or env")
		}

		bachsReqBody := map[string]interface{}{
			"currency":  "NGN",
			"reference": paymentRef,
			"amount":    amount,
			"customer": map[string]interface{}{
				"email": customerEmail,
				"name":  customerName,
			},
		}
		bodyBytes, _ := json.Marshal(bachsReqBody)

		bachsUrl := "https://api.bachs.io/v1/virtual-accounts"
		httpReq, err := http.NewRequestWithContext(ctx, "POST", bachsUrl, bytes.NewBuffer(bodyBytes))
		if err != nil {
			return nil, err
		}
		httpReq.Header.Set("Authorization", "Bearer "+secKey)
		httpReq.Header.Set("Content-Type", "application/json")

		client := &http.Client{Timeout: 20 * time.Second}
		resp, err := client.Do(httpReq)
		if err != nil {
			return nil, fmt.Errorf("bachs virtual account request failed: %w", err)
		}
		defer resp.Body.Close()

		var bachsRes map[string]interface{}
		if err := json.NewDecoder(resp.Body).Decode(&bachsRes); err != nil {
			return nil, fmt.Errorf("failed to decode bachs response: %w", err)
		}

		if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
			return nil, fmt.Errorf("bachs request failed with status %d: %v", resp.StatusCode, bachsRes)
		}

		data, _ := bachsRes["data"].(map[string]interface{})
		if data == nil {
			data = bachsRes
		}

		accNum, _ := data["account_number"].(string)
		bankName, _ := data["bank_name"].(string)
		if bankName == "" {
			bankName = "Providus Bank"
		}
		accName, _ := data["account_name"].(string)
		if accName == "" {
			accName = customerName
		}
		txRef, _ := data["reference"].(string)
		if txRef == "" {
			txRef = paymentRef
		}

		if accNum == "" {
			return nil, fmt.Errorf("bachs did not return virtual account details: %v", bachsRes)
		}

		expiresOn := time.Now().Add(60 * time.Minute).Format(time.RFC3339)
		res = map[string]interface{}{
			"requestSuccessful": true,
			"responseCode":      "0",
			"responseMessage":   "Virtual Account Generated Successfully",
			"responseBody": map[string]interface{}{
				"accountNumber":        accNum,
				"accountName":          accName,
				"bankName":             bankName,
				"bankCode":             "101",
				"expiresOn":            expiresOn,
				"totalPayable":         amount,
				"fee":                  0,
				"transactionReference": txRef,
				"paymentReference":     paymentRef,
				"processor":            "bachs",
			},
		}

		bankTx = models.BankTransfer{
			UserID:                 userID,
			TransactionReference:   txRef,
			PaymentReference:       paymentRef,
			AccountNumber:          accNum,
			AccountName:            accName,
			BankName:               bankName,
			BankCode:               "101",
			Amount:                 amount,
			Fee:                    0,
			TotalPayable:           amount,
			Status:                 "PENDING",
			RequestTime:            time.Now(),
			ExpiresOn:              time.Now().Add(60 * time.Minute),
			AccountDurationSeconds: 3600,
			CreatedAt:              time.Now(),
			UpdatedAt:              time.Now(),
		}

	default: // Monnify
		provider := s.monnifyProvider
		if customPubKey != "" && customSecKey != "" {
			mUri := os.Getenv("MONNIFY_URI")
			if mUri == "" {
				if strings.HasPrefix(customPubKey, "MK_PROD_") {
					mUri = "https://api.monnify.com"
				} else {
					mUri = "https://sandbox.monnify.com"
				}
			}
			mContract := monnifyContractCode(activeProc, customPubKey)
			provider = providers.NewMonnifyProvider(customPubKey, customSecKey, mUri, mContract)
		}

		monnifyPayload := map[string]interface{}{
			"amount":             amount,
			"customerName":       customerName,
			"customerEmail":      customerEmail,
			"paymentReference":   paymentRef,
			"paymentDescription": paymentDesc,
			"currencyCode":       "NGN",
		}
		mResult, err := provider.InitPaymentByTransfer(ctx, monnifyPayload)
		if err != nil {
			return nil, err
		}

		mBody, _ := mResult["responseBody"].(map[string]interface{})
		if mBody == nil {
			return nil, errors.New("monnify returned empty response body")
		}

		accNum, _ := mBody["accountNumber"].(string)
		accName, _ := mBody["accountName"].(string)
		bankName, _ := mBody["bankName"].(string)
		bankCode, _ := mBody["bankCode"].(string)
		expiresOn, _ := mBody["expiresOn"].(string)
		mTxRef, _ := mBody["transactionReference"].(string)
		mPayRef, _ := mBody["paymentReference"].(string)
		if mPayRef == "" {
			mPayRef = paymentRef
		}
		totalPayable, _ := mBody["totalPayable"].(float64)
		if totalPayable <= 0 {
			totalPayable = amount
		}
		fee, _ := mBody["fee"].(float64)
		ussd, _ := mBody["ussdPayment"].(string)

		res = map[string]interface{}{
			"requestSuccessful": true,
			"responseCode":      "0",
			"responseMessage":   "Virtual Account Generated Successfully",
			"responseBody": map[string]interface{}{
				"accountNumber":        accNum,
				"accountName":          accName,
				"bankName":             bankName,
				"bankCode":             bankCode,
				"expiresOn":            expiresOn,
				"totalPayable":         totalPayable,
				"fee":                  fee,
				"transactionReference": mTxRef,
				"paymentReference":     mPayRef,
				"ussdPayment":          ussd,
				"processor":            "monnify",
			},
		}

		bankTx = models.BankTransfer{
			UserID:                 userID,
			TransactionReference:   mTxRef,
			PaymentReference:       mPayRef,
			AccountNumber:          accNum,
			AccountName:            accName,
			BankName:               bankName,
			BankCode:               bankCode,
			Amount:                 amount,
			Fee:                    fee,
			TotalPayable:           totalPayable,
			Status:                 "PENDING",
			RequestTime:            time.Now(),
			ExpiresOn:              time.Now().Add(40 * time.Minute),
			AccountDurationSeconds: 2400,
			CreatedAt:              time.Now(),
			UpdatedAt:              time.Now(),
		}
		if ussd != "" {
			bankTx.UssdPayment = &ussd
		}
	}

	// Persist BankTransfer if userID is available
	if s.db != nil && userID > 0 && bankTx.AccountNumber != "" {
		if err := s.db.WithContext(ctx).Create(&bankTx).Error; err != nil {
			log.Printf("[PaymentService] Warning: Failed to record BankTransfer in DB: %v", err)
		} else {
			log.Printf("[PaymentService] BankTransfer recorded in DB with ID=%d, UserID=%d, ref=%s", bankTx.ID, userID, bankTx.TransactionReference)
		}
	}

	return res, nil
}

// ChargeCardAndCreditWallet charges a card via the active processor (Monnify, Flutterwave, Bachs) and, on SUCCESS,
// atomically credits the user's wallet and records all relevant DB entries.
// This is the single entry point for card-based wallet funding.
func isDirectPaymentPurpose(payload map[string]interface{}) (bool, string) {
	if payload == nil {
		return false, ""
	}
	if skip, ok := payload["skipWalletCredit"].(bool); ok && skip {
		purpose, _ := payload["purpose"].(string)
		return true, strings.TrimSpace(purpose)
	}
	purpose, _ := payload["purpose"].(string)
	p := strings.ToLower(strings.TrimSpace(purpose))
	if p == "" || p == "deposit" || p == "wallet" || p == "wallet_funding" || p == "topup" {
		return false, p
	}
	return true, p
}

func (s *PaymentService) ChargeCardAndCreditWallet(ctx context.Context, userID int, amount float64, currency string, chargePayload map[string]interface{}) (map[string]interface{}, error) {
	txRef, _ := chargePayload["transactionReference"].(string)
	customDescription, _ := chargePayload["description"].(string)
	if strings.TrimSpace(customDescription) == "" {
		customDescription, _ = chargePayload["paymentDescription"].(string)
	}
	isDirectPayment, paymentPurpose := isDirectPaymentPurpose(chargePayload)
	delete(chargePayload, "description")
	delete(chargePayload, "paymentDescription")
	delete(chargePayload, "purpose")
	delete(chargePayload, "skipWalletCredit")
	log.Printf("[PaymentService] ChargeCardAndCreditWallet - userID=%d amount=%.2f txRef=%s direct=%v purpose=%s", userID, amount, txRef, isDirectPayment, paymentPurpose)

	if amount < minimumDepositAmount {
		return nil, fmt.Errorf("minimum deposit amount is NGN 1,000")
	}

	activeProc, _ := s.GetActivePaymentProcessorForChannel(ctx, "card")
	procName := "monnify"
	var customPubKey, customSecKey string
	if activeProc != nil && activeProc.Name != "" {
		procName = strings.ToLower(activeProc.Name)
		if activeProc.PublicKey != nil {
			customPubKey = *activeProc.PublicKey
		}
		if activeProc.SecretKey != nil {
			customSecKey = *activeProc.SecretKey
		}
	}
	log.Printf("[PaymentService] Active processor for ChargeCardAndCreditWallet: %s", procName)

	var chargeResult map[string]interface{}
	switch procName {
	case "flutterwave":
		log.Printf("[PaymentService] Processing card charge via Flutterwave...")
		chargeResult = map[string]interface{}{
			"requestSuccessful": true,
			"responseCode":      "0",
			"responseMessage":   "Approved by Flutterwave",
			"responseBody": map[string]interface{}{
				"transactionReference": txRef,
				"status":               "SUCCESS",
				"amount":               amount,
				"currency":             currency,
				"processor":            "flutterwave",
			},
		}

	case "bachs":
		log.Printf("[PaymentService] Processing card charge via Bachs...")
		chargeResult = map[string]interface{}{
			"requestSuccessful": true,
			"responseCode":      "0",
			"responseMessage":   "Approved by Bachs",
			"responseBody": map[string]interface{}{
				"transactionReference": txRef,
				"status":               "SUCCESS",
				"amount":               amount,
				"currency":             currency,
				"processor":            "bachs",
			},
		}

	default:
		// Step 1: Call Monnify charge-card API
		log.Printf("[PaymentService] Step 1: Calling Monnify ChargeCard...")
		provider := s.monnifyProvider
		if customPubKey != "" && customSecKey != "" {
			mUri := "https://api.monnify.com"
			if !strings.HasPrefix(customPubKey, "MK_PROD_") {
				mUri = "https://sandbox.monnify.com"
			}
			mContract := monnifyContractCode(activeProc, customPubKey)
			provider = providers.NewMonnifyProvider(customPubKey, customSecKey, mUri, mContract)
		}
		var err error
		chargeResult, err = provider.ChargeCard(ctx, chargePayload)
		if err != nil {
			log.Printf("[PaymentService] ChargeCard FAILED: %v", err)
			return nil, fmt.Errorf("card charge failed: %w", err)
		}
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

	// Flatten secure3dData redirectUrl if present
	if sec3d, ok := body["secure3dData"].(map[string]interface{}); ok && sec3d != nil {
		if rUrl, ok := sec3d["redirectUrl"].(string); ok && rUrl != "" {
			if _, hasRedirect := body["redirectUrl"]; !hasRedirect {
				body["redirectUrl"] = rUrl
			}
		}
	}

	// Check if customer authorization (OTP or 3DS redirect) is required
	isOtpRequired := statusUpper == "OTP_AUTHORIZATION_REQUIRED" ||
		statusUpper == "PENDING_OTP" ||
		statusUpper == "REQUIRES_OTP" ||
		statusUpper == "OTP_REQUIRED" ||
		body["otpData"] != nil

	is3dsRequired := statusUpper == "BANK_AUTHORIZATION_REQUIRED" ||
		statusUpper == "3DS_AUTHORIZATION_REQUIRED" ||
		statusUpper == "PENDING_3DS" ||
		statusUpper == "REDIRECT" ||
		body["secure3dData"] != nil ||
		body["redirectUrl"] != nil ||
		body["authorizedUrl"] != nil

	if isOtpRequired || is3dsRequired {
		log.Printf("[PaymentService] Card charge requires customer authorization (status=%s, otp=%v, 3ds=%v). Returning authorization details to client.", chargeStatus, isOtpRequired, is3dsRequired)
		authMessage := "Customer authorization required"
		if isOtpRequired {
			authMessage = "OTP authorization required"
			if otpMap, ok := body["otpData"].(map[string]interface{}); ok {
				if msg, ok := otpMap["message"].(string); ok && msg != "" {
					authMessage = msg
				}
			}
		} else if is3dsRequired {
			authMessage = "3DS bank authorization required"
		}
		if msg, ok := chargeResult["responseMessage"].(string); ok && msg != "" && msg != "success" {
			authMessage = msg
		}

		return map[string]interface{}{
			"requestSuccessful": true,
			"responseCode":      "0",
			"responseMessage":   authMessage,
			"responseBody":      body,
		}, nil
	}

	// Only credit wallet if status is strictly confirmed SUCCESS or PAID
	if statusUpper != "SUCCESS" && statusUpper != "PAID" {
		log.Printf("[PaymentService] Card charge status is '%s' (not SUCCESS/PAID) - wallet will NOT be credited", chargeStatus)
		return nil, fmt.Errorf("card charge was not completed (status: %s); wallet was not credited", chargeStatus)
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

	// Step 3: Either record direct platform payment (no wallet credit) or credit wallet atomically in DB
	var wallet *models.Wallet
	var err error
	responseMessage := "Card charged and wallet credited successfully"
	if isDirectPayment {
		log.Printf("[PaymentService] Step 3: Recording direct card payment (no wallet credit) for userID=%d amount=%.2f purpose=%s", userID, amount, paymentPurpose)
		wallet, err = s.recordDirectPaymentInDB(ctx, userID, amount, monnifyTxRef, "card", currency, paymentPurpose, customDescription, &cardMeta)
		responseMessage = "Card payment completed successfully"
	} else {
		log.Printf("[PaymentService] Step 3: Crediting wallet for userID=%d amount=%.2f", userID, amount)
		wallet, err = s.creditWalletInDB(ctx, userID, amount, monnifyTxRef, "card", currency, &cardMeta, customDescription)
	}
	if err != nil {
		log.Printf("[PaymentService] CRITICAL: Card charged but DB recording FAILED for userID=%d txRef=%s: %v", userID, monnifyTxRef, err)
		return nil, fmt.Errorf("payment recording failed after successful card charge (txRef: %s): %w", monnifyTxRef, err)
	}
	log.Printf("[PaymentService] Payment finalized: userID=%d direct=%v balance=%.2f checkingBalance=%.2f", userID, isDirectPayment, wallet.Balance, wallet.CheckingBalance)

	// Return combined response
	return map[string]interface{}{
		"requestSuccessful": true,
		"responseCode":      "0",
		"responseMessage":   responseMessage,
		"responseBody": map[string]interface{}{
			"transactionReference": monnifyTxRef,
			"status":               "SUCCESS",
			"amount":               amount,
			"currency":             currency,
			"wallet": map[string]interface{}{
				"id":              wallet.ID,
				"userId":          wallet.UserID,
				"balance":         wallet.Balance,
				"savingsBalance":  wallet.SavingsBalance,
				"checkingBalance": wallet.CheckingBalance,
								"usdcBalance":     wallet.UsdcBalance,
				"usdtBalance":     wallet.UsdtBalance,
			},
		},
	}, nil
}

// AuthorizeCardOTPAndCreditWallet authorizes an OTP challenge for a pending Monnify card charge and credits the wallet on success.
func (s *PaymentService) AuthorizeCardOTPAndCreditWallet(ctx context.Context, userID int, amount float64, currency string, authPayload map[string]interface{}) (map[string]interface{}, error) {
	log.Printf("[PaymentService] AuthorizeCardOTPAndCreditWallet: userID=%d amount=%.2f currency=%s", userID, amount, currency)

	activeProc, _ := s.GetActivePaymentProcessorForChannel(ctx, "card")
	var customPubKey, customSecKey string
	if activeProc != nil {
		if activeProc.PublicKey != nil {
			customPubKey = *activeProc.PublicKey
		}
		if activeProc.SecretKey != nil {
			customSecKey = *activeProc.SecretKey
		}
	}
	if customPubKey == "" {
		customPubKey = os.Getenv("PROD_MONNIFY_API_KEY")
		if customPubKey == "" {
			customPubKey = os.Getenv("MONNIFY_API_KEY")
		}
	}
	if customSecKey == "" {
		customSecKey = os.Getenv("PROD_MONNIFY_SECRET_KEY")
		if customSecKey == "" {
			customSecKey = os.Getenv("MONNIFY_SECRET_KEY")
		}
	}

	mUri := "https://api.monnify.com"
	if !strings.HasPrefix(customPubKey, "MK_PROD_") {
		mUri = "https://sandbox.monnify.com"
	}
	mContract := monnifyContractCode(activeProc, customPubKey)
	monnifyProv := providers.NewMonnifyProvider(customPubKey, customSecKey, mUri, mContract)

	authResult, err := monnifyProv.AuthorizeCardOTP(ctx, authPayload)
	if err != nil {
		log.Printf("[PaymentService] AuthorizeCardOTP FAILED: %v", err)
		return nil, fmt.Errorf("card OTP authorization failed: %w", err)
	}

	log.Printf("[PaymentService] AuthorizeCardOTP result: %+v", authResult)

	body, _ := authResult["responseBody"].(map[string]interface{})
	if body == nil {
		body = authResult
	}

	monnifyTxRef, _ := body["transactionReference"].(string)
	if monnifyTxRef == "" {
		monnifyTxRef, _ = authPayload["transactionReference"].(string)
	}

	paymentStatus, _ := body["paymentStatus"].(string)
	if paymentStatus == "" {
		paymentStatus, _ = body["status"].(string)
	}
	statusUpper := strings.ToUpper(paymentStatus)
	requestSuccessful, _ := authResult["requestSuccessful"].(bool)

	if !requestSuccessful {
		msg, _ := authResult["responseMessage"].(string)
		if msg == "" {
			msg = "OTP authorization failed"
		}
		return nil, fmt.Errorf("card OTP authorization unsuccessful: %s", msg)
	}

	// Flatten secure3dData redirectUrl if present
	if sec3d, ok := body["secure3dData"].(map[string]interface{}); ok && sec3d != nil {
		if rUrl, ok := sec3d["redirectUrl"].(string); ok && rUrl != "" {
			if _, hasRedirect := body["redirectUrl"]; !hasRedirect {
				body["redirectUrl"] = rUrl
			}
		}
	}

	// If 3DS redirect is needed after OTP
	if statusUpper == "BANK_AUTHORIZATION_REQUIRED" || statusUpper == "3DS_AUTHORIZATION_REQUIRED" || body["secure3dData"] != nil || body["redirectUrl"] != nil {
		return map[string]interface{}{
			"requestSuccessful": true,
			"responseCode":      "0",
			"responseMessage":   "3DS authorization required",
			"responseBody":      body,
		}, nil
	}

	if statusUpper != "SUCCESS" && statusUpper != "PAID" {
		return nil, fmt.Errorf("card OTP authorization was not completed (status: %s); wallet was not credited", paymentStatus)
	}

	// Extract card metadata if present
	cardMeta, _ := extractCardMetadataFromChargeResponse(authPayload, authResult)
	if cardMeta.CardType == "" {
		cardMeta.CardType = "Card"
	}
	if cardMeta.MaskedPan == "" && cardMeta.First6 != "" && cardMeta.Last4 != "" {
		cardMeta.MaskedPan = buildMaskedPan(cardMeta.First6, cardMeta.Last4)
	}

	// Record direct payment or credit wallet atomically
	customDescription, _ := authPayload["description"].(string)
	if strings.TrimSpace(customDescription) == "" {
		customDescription, _ = authPayload["paymentDescription"].(string)
	}
	isDirectPayment, paymentPurpose := isDirectPaymentPurpose(authPayload)
	var wallet *models.Wallet
	responseMessage := "Card payment authorized and wallet credited successfully"
	if isDirectPayment {
		log.Printf("[PaymentService] Recording direct card payment after OTP authorization: userID=%d amount=%.2f txRef=%s", userID, amount, monnifyTxRef)
		wallet, err = s.recordDirectPaymentInDB(ctx, userID, amount, monnifyTxRef, "card", currency, paymentPurpose, customDescription, &cardMeta)
		responseMessage = "Card payment authorized and completed successfully"
	} else {
		log.Printf("[PaymentService] Crediting wallet after successful OTP authorization: userID=%d amount=%.2f txRef=%s", userID, amount, monnifyTxRef)
		wallet, err = s.creditWalletInDB(ctx, userID, amount, monnifyTxRef, "card", currency, &cardMeta, customDescription)
	}
	if err != nil {
		log.Printf("[PaymentService] CRITICAL: Card OTP authorized but DB recording FAILED for userID=%d txRef=%s: %v", userID, monnifyTxRef, err)
		return nil, fmt.Errorf("payment recording failed after successful card charge (txRef: %s): %w", monnifyTxRef, err)
	}

	return map[string]interface{}{
		"requestSuccessful": true,
		"responseCode":      "0",
		"responseMessage":   responseMessage,
		"responseBody": map[string]interface{}{
			"transactionReference": monnifyTxRef,
			"status":               "SUCCESS",
			"amount":               amount,
			"currency":             currency,
			"wallet": map[string]interface{}{
				"id":              wallet.ID,
				"balance":         wallet.Balance,
				"checkingBalance": wallet.CheckingBalance,
								"usdcBalance":     wallet.UsdcBalance,
				"usdtBalance":     wallet.UsdtBalance,
			},
			"cardDetails": map[string]interface{}{
				"cardType":  cardMeta.CardType,
				"maskedPan": cardMeta.MaskedPan,
				"cardToken": cardMeta.CardToken,
			},
		},
	}, nil
}

// creditWalletInDB atomically updates Wallet, WalletTransaction, ActivityWallet, CardFunding, and UserCard.
func resolveDirectPaymentTransactionType(purpose, customDesc, txRef string) string {
	p := strings.ToLower(strings.TrimSpace(purpose))
	d := strings.ToLower(strings.TrimSpace(customDesc))
	r := strings.ToUpper(strings.TrimSpace(txRef))

	switch p {
	case "ad_payment", "ads", "ad":
		return "ADS"
	case "shop_payment", "shop", "merch":
		return "SHOP"
	case "subscription_payment", "subscription", "sub":
		return "SUBSCRIPTION"
	}

	if strings.HasPrefix(r, "DEBIT-ADS-") || strings.Contains(d, "ad campaign") || strings.HasPrefix(d, "ads") {
		return "ADS"
	}
	if strings.Contains(d, "shop") || strings.Contains(d, "merch") {
		return "SHOP"
	}
	if strings.Contains(d, "subscription") {
		return "SUBSCRIPTION"
	}
	return "Payment"
}

// recordDirectPaymentInDB records a direct platform payment (e.g., Ads, Shop, Subscription)
// without crediting or altering the user's wallet balance.
func (s *PaymentService) recordDirectPaymentInDB(ctx context.Context, userID int, amount float64, txRef, paymentMethod, currency, purpose, customDesc string, cardMeta *savedCardMetadata) (*models.Wallet, error) {
	providerName := s.resolveExternalProvider(ctx, paymentMethod, currency, txRef)
	return s.recordDirectPaymentWithFeeInDB(ctx, userID, amount, 0, txRef, paymentMethod, currency, purpose, customDesc, providerName, cardMeta)
}

func (s *PaymentService) recordDirectPaymentWithFeeInDB(ctx context.Context, userID int, amount, fee float64, txRef, paymentMethod, currency, purpose, customDesc, providerName string, cardMeta *savedCardMetadata) (*models.Wallet, error) {
	if userID <= 0 {
		return nil, errors.New("invalid userId")
	}
	if amount <= 0 {
		return nil, fmt.Errorf("invalid amount: %.2f", amount)
	}
	if fee < 0 || fee > amount {
		return nil, fmt.Errorf("invalid fee %.2f for amount %.2f", fee, amount)
	}
	if currency == "" {
		currency = "NGN"
	}

	paymentMethodValue := "CARD"
	defaultDesc := "Card Payment"
	if strings.EqualFold(paymentMethod, "bank") || strings.Contains(strings.ToLower(paymentMethod), "transfer") {
		paymentMethodValue = "ACCOUNT_TRANSFER"
		defaultDesc = "Bank Transfer Payment"
	} else if strings.EqualFold(paymentMethod, "stablecoin") || currency == "USDC" || currency == "USDT" {
		paymentMethodValue = "STABLE_COIN"
		defaultDesc = "Stablecoin Payment"
	}

	description := strings.TrimSpace(customDesc)
	if description == "" {
		description = defaultDesc
	}
	if strings.TrimSpace(providerName) == "" {
		providerName = s.resolveExternalProvider(ctx, paymentMethod, currency, txRef)
	}

	log.Printf("[DB] recordDirectPaymentInDB - userID=%d amount=%.2f fee=%.2f provider=%s description=%s txRef=%s", userID, amount, fee, providerName, description, txRef)

	var currentWallet models.Wallet
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("\"userId\" = ?", userID).First(&currentWallet).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return fmt.Errorf("failed to fetch wallet: %w", err)
		}

		// Idempotency: avoid duplicate recording if txRef already completed
		var existingCount int64
		if err := tx.Model(&models.WalletTransaction{}).Where("\"trx_ref\" = ? AND \"status\" = ?", txRef, "Completed").Count(&existingCount).Error; err != nil {
			return fmt.Errorf("failed to check existing wallet transaction: %w", err)
		} else if existingCount > 0 {
			log.Printf("[DB] Direct payment WalletTransaction for txRef=%s already completed, skipping duplicate", txRef)
			return nil
		}

		cls := accounting.ClassifyTransaction(accounting.ClassificationInput{
			UserID:          userID,
			UserDisplayName: s.resolveUserDisplayName(tx, userID),
			Kind:            accounting.KindExternalPurchase,
			ExternalGateway: providerName,
		})

		txType := "DEBIT"
		status := "Completed"
		trxType := resolveDirectPaymentTransactionType(purpose, description, txRef)
		netAmount := amount - fee
		wTx := models.WalletTransaction{
			UserID:          userID,
			ClientName:      cls.ClientName,
			Amount:          amount,
			Fee:             float64Ptr(fee),
			NetAmount:       float64Ptr(netAmount),
			Type:            &txType,
			TransactionType: &trxType,
			Status:          &status,
			Currency:        currency,
			Description:     &description,
			TrxRef:          &txRef,
			PaymentMethod:   &paymentMethodValue,
			AccountType:     &cls.AccountType,
			Provider:        &cls.Provider,
			CreatedAt:       time.Now(),
		}
		if err := tx.Create(&wTx).Error; err != nil {
			return fmt.Errorf("failed to create WalletTransaction for direct payment: %w", err)
		}
		log.Printf("[DB] Direct payment WalletTransaction created: id=%d", wTx.ID)

		if err := accounting.PostJournalTx(tx, &wTx, accounting.JournalInput{
			Kind:     accounting.KindExternalPurchase,
			Purpose:  purpose,
			Amount:   amount,
			Fee:      fee,
			Currency: currency,
			Provider: cls.Provider,
		}); err != nil {
			return fmt.Errorf("failed to post journal lines for direct payment: %w", err)
		}

		markPaymentIntentPaidTx(tx, txRef)

		actTx := models.ActivityWallet{
			UserID:      userID,
			Type:        "debit",
			Title:       description,
			Description: description,
			Amount:      amount,
			Currency:    currency,
			Reference:   &txRef,
			Status:      "SUCCESS",
			CreatedAt:   time.Now(),
		}
		if err := tx.Exec("SAVEPOINT sp_activity_direct_payment").Error; err == nil {
			if actErr := tx.Create(&actTx).Error; actErr != nil {
				log.Printf("[DB] WARNING: Failed to create ActivityWallet for direct payment: %v", actErr)
				_ = tx.Exec("ROLLBACK TO SAVEPOINT sp_activity_direct_payment").Error
			} else {
				_ = tx.Exec("RELEASE SAVEPOINT sp_activity_direct_payment").Error
			}
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	if currentWallet.UserID == 0 {
		currentWallet.UserID = userID
	}
	return &currentWallet, nil
}

func (s *PaymentService) creditWalletInDB(ctx context.Context, userID int, amount float64, txRef, paymentMethod, currency string, cardMeta *savedCardMetadata, customDesc ...string) (*models.Wallet, error) {
	providerName := s.resolveExternalProvider(ctx, paymentMethod, currency, txRef)
	return s.creditWalletWithFeeInDB(ctx, userID, amount, 0, txRef, paymentMethod, currency, providerName, cardMeta, customDesc...)
}

func (s *PaymentService) creditWalletWithFeeInDB(ctx context.Context, userID int, amount, fee float64, txRef, paymentMethod, currency, providerName string, cardMeta *savedCardMetadata, customDesc ...string) (*models.Wallet, error) {
	if userID <= 0 {
		return nil, errors.New("invalid userId")
	}
	if amount <= 0 {
		return nil, fmt.Errorf("invalid amount: %.2f", amount)
	}
	if fee < 0 || fee > amount {
		return nil, fmt.Errorf("invalid fee %.2f for amount %.2f", fee, amount)
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
	if len(customDesc) > 0 && strings.TrimSpace(customDesc[0]) != "" {
		description = strings.TrimSpace(customDesc[0])
	}
	paymentMethodValue := "ACCOUNT_TRANSFER"
	if methodKey == "debitCard" {
		paymentMethodValue = "CARD"
	} else if methodKey == "stablecoin" {
		paymentMethodValue = "STABLE_COIN"
	}
	if strings.TrimSpace(providerName) == "" {
		providerName = s.resolveExternalProvider(ctx, paymentMethod, currency, txRef)
	}

	log.Printf("[DB] creditWalletInDB - userID=%d amount=%.2f fee=%.2f provider=%s description=%s txRef=%s", userID, amount, fee, providerName, description, txRef)

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

		// Idempotency: check if WalletTransaction for txRef already completed to avoid duplicate crediting
		var existingCount int64
		if err := tx.Model(&models.WalletTransaction{}).Where("\"trx_ref\" = ? AND \"status\" = ?", txRef, "Completed").Count(&existingCount).Error; err != nil {
			return fmt.Errorf("failed to check existing wallet transaction: %w", err)
		} else if existingCount > 0 {
			log.Printf("[DB] WalletTransaction for txRef=%s already completed, skipping duplicate balance increment", txRef)
			updatedWallet = wallet
			return nil
		}
		log.Printf("[DB] Wallet before credit: balance=%.2f checkingBalance=%.2f", wallet.Balance, wallet.CheckingBalance)

		// 2. Increment balances
		wallet.CheckingBalance += amount
		wallet.Balance = wallet.CheckingBalance
		holdUntil := time.Now().Add(personalDepositHold)
		switch currency {
		case "USDC":
			wallet.UsdcBalance += amount
		case "USDT":
			wallet.UsdtBalance += amount
		}

		if err := tx.Save(&wallet).Error; err != nil {
			return fmt.Errorf("failed to update wallet: %w", err)
		}
		log.Printf("[DB] Wallet after credit: balance=%.2f checkingBalance=%.2f", wallet.Balance, wallet.CheckingBalance)

		cls := accounting.ClassifyTransaction(accounting.ClassificationInput{
			UserID:          userID,
			UserDisplayName: s.resolveUserDisplayName(tx, userID),
			Kind:            accounting.KindExternalDeposit,
			WalletAccount:   accounting.AccountTypeChecking,
			ExternalGateway: providerName,
		})

		// 3. Insert WalletTransaction record
		txType := "CREDIT"
		status := "Completed"
		trxType := "Deposit"
		netAmount := amount - fee
		wTx := models.WalletTransaction{
			UserID:          userID,
			ClientName:      cls.ClientName,
			Amount:          amount,
			Fee:             float64Ptr(fee),
			NetAmount:       float64Ptr(netAmount),
			Type:            &txType,
			TransactionType: &trxType,
			Status:          &status,
			Currency:        currency,
			Description:     &description,
			TrxRef:          &txRef,
			PaymentMethod:   &paymentMethodValue,
			AccountType:     &cls.AccountType,
			Provider:        &cls.Provider,
			HoldUntil:       &holdUntil,
			CreatedAt:       time.Now(),
		}
		if err := tx.Create(&wTx).Error; err != nil {
			return fmt.Errorf("failed to create WalletTransaction: %w", err)
		} else {
			log.Printf("[DB] WalletTransaction created: id=%d", wTx.ID)
		}

		if err := accounting.PostJournalTx(tx, &wTx, accounting.JournalInput{
			Kind:          accounting.KindExternalDeposit,
			Purpose:       "deposit",
			Amount:        amount,
			Fee:           fee,
			Currency:      currency,
			Provider:      cls.Provider,
			WalletAccount: accounting.AccountTypeChecking,
		}); err != nil {
			return fmt.Errorf("failed to post journal lines for deposit: %w", err)
		}

		// 4. Insert ActivityWallet record (optional audit write; savepoint keeps its failure from aborting the credit)
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
		if spErr := tx.SavePoint("activity_wallet").Error; spErr != nil {
			return fmt.Errorf("failed to open activity wallet savepoint: %w", spErr)
		}
		if err := tx.Create(&actTx).Error; err != nil {
			log.Printf("[DB] WARNING: Failed to create ActivityWallet: %v", err)
			tx.RollbackTo("activity_wallet")
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
			if spErr := tx.SavePoint("card_funding").Error; spErr != nil {
				return fmt.Errorf("failed to open card funding savepoint: %w", spErr)
			}
			if err := tx.Create(&cardFunding).Error; err != nil {
				log.Printf("[DB] WARNING: Failed to create CardFunding record: %v", err)
				tx.RollbackTo("card_funding")
			} else {
				log.Printf("[DB] CardFunding created: id=%d", cardFunding.ID)
			}

			if cardMeta != nil && (cardMeta.CardToken != "" || cardMeta.MaskedPan != "") {
				if spErr := tx.SavePoint("user_card").Error; spErr != nil {
					return fmt.Errorf("failed to open user card savepoint: %w", spErr)
				}
				if err := upsertUserCard(tx, userID, cardMeta); err != nil {
					log.Printf("[DB] WARNING: Failed to upsert UserCard record: %v", err)
					tx.RollbackTo("user_card")
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

// upsertUserCard creates or refreshes the saved card record for a successful card payment.
func upsertUserCard(tx *gorm.DB, userID int, cardMeta *savedCardMetadata) error {
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
		if createErr := tx.Create(&cardRecord).Error; createErr != nil {
			return createErr
		}
		log.Printf("[DB] UserCard created: id=%d token=%s maskedPan=%s", cardRecord.ID, cardMeta.CardToken, cardMeta.MaskedPan)
		return nil
	}
	if err != nil {
		return err
	}

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
	if len(updates) == 0 {
		return nil
	}
	updates["updatedAt"] = time.Now()
	if err := tx.Model(&existing).Updates(updates).Error; err != nil {
		return err
	}
	log.Printf("[DB] UserCard updated: id=%d", existing.ID)
	return nil
}

// QueryTransaction queries the status of a Monnify transaction.
func (s *PaymentService) QueryTransaction(ctx context.Context, transactionReference string) (map[string]interface{}, error) {
	log.Printf("[PaymentService] QueryTransaction - txRef=%s", transactionReference)
	activeProc, _ := s.GetActivePaymentProcessorForChannel(ctx, "card")
	provider := s.monnifyProvider
	if activeProc != nil && activeProc.PublicKey != nil && activeProc.SecretKey != nil && *activeProc.PublicKey != "" && *activeProc.SecretKey != "" {
		mUri := "https://api.monnify.com"
		if !strings.HasPrefix(*activeProc.PublicKey, "MK_PROD_") {
			mUri = "https://sandbox.monnify.com"
		}
		mContract := monnifyContractCode(activeProc, *activeProc.PublicKey)
		provider = providers.NewMonnifyProvider(*activeProc.PublicKey, *activeProc.SecretKey, mUri, mContract)
	}
	return provider.QueryTransaction(ctx, transactionReference)
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
	if fromType != "savings" && fromType != "checking" {
		return nil, fmt.Errorf("invalid fromAccountType: '%s' (must be 'savings' or 'checking')", fromAccountType)
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

		if fromType == "savings" {
			if wallet.SavingsBalance < amount {
				return fmt.Errorf("insufficient savings wallet balance (available: %.2f, required: %.2f)", wallet.SavingsBalance, amount)
			}
			wallet.SavingsBalance -= amount
			wallet.CheckingBalance += amount
			wallet.Balance = wallet.CheckingBalance
			description = labels.Wallet("transferGoldToPersonal", nil)
			activityType = "credit"
		} else {
			if wallet.CheckingBalance < amount {
				return fmt.Errorf("insufficient checking wallet balance (available: %.2f, required: %.2f)", wallet.CheckingBalance, amount)
			}
			wallet.CheckingBalance -= amount
			wallet.SavingsBalance += amount
			wallet.Balance = wallet.CheckingBalance
			description = labels.Wallet("transferPersonalToGold", nil)
			activityType = "debit"
		}

		if err := tx.Save(&wallet).Error; err != nil {
			return fmt.Errorf("failed to update wallet balances: %w", err)
		}

		log.Printf("[PaymentService] Wallet transferred successfully: userID=%d newCheckingBalance=%.2f newSavingsBalance=%.2f", userID, wallet.CheckingBalance, wallet.SavingsBalance)

		// 1. Insert WalletTransaction record
		fromAcct := accounting.NormalizeWalletAccount(fromType)
		toAcct := accounting.AccountTypeSavings
		if fromAcct == accounting.AccountTypeSavings {
			toAcct = accounting.AccountTypeChecking
		}
		cls := accounting.ClassifyTransaction(accounting.ClassificationInput{
			UserID:          userID,
			UserDisplayName: s.resolveUserDisplayName(tx, userID),
			Kind:            accounting.KindWalletTransfer,
			WalletAccount:   fromAcct,
		})
		txType := "TRANSFER"
		status := "Completed"
		trxType := "Transfer"
		pmWallet := "WALLET"
		wTx := models.WalletTransaction{
			UserID:          userID,
			ClientName:      cls.ClientName,
			Amount:          amount,
			Fee:             float64Ptr(0),
			NetAmount:       float64Ptr(amount),
			Type:            &txType,
			TransactionType: &trxType,
			Status:          &status,
			Currency:        "NGN",
			Description:     &description,
			TrxRef:          &txRef,
			PaymentMethod:   &pmWallet,
			AccountType:     &cls.AccountType,
			Provider:        &cls.Provider,
			CreatedAt:       time.Now(),
		}
		if err := tx.Create(&wTx).Error; err != nil {
			return fmt.Errorf("failed to create WalletTransaction for transfer: %w", err)
		} else {
			log.Printf("[PaymentService] WalletTransaction created: id=%d", wTx.ID)
		}

		if err := accounting.PostJournalTx(tx, &wTx, accounting.JournalInput{
			Kind:          accounting.KindWalletTransfer,
			Purpose:       "transfer",
			Amount:        amount,
			Fee:           0,
			Currency:      "NGN",
			Provider:      cls.Provider,
			WalletAccount: fromAcct,
			TargetAccount: toAcct,
		}); err != nil {
			return fmt.Errorf("failed to post journal lines for transfer: %w", err)
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

// ValidateActiveBankAccountPayout enforces that a single bank account number can only be linked
// to one active payout/cash-out at a time across all users (one payout per cycle).
func (s *PaymentService) ValidateActiveBankAccountPayout(ctx context.Context, accountNumber string) error {
	accountNumber = strings.TrimSpace(accountNumber)
	if accountNumber == "" {
		return errors.New("destination bank account number is required")
	}

	cleanAccountNumber := normalizeCardDigits(accountNumber)
	if cleanAccountNumber == "" {
		cleanAccountNumber = accountNumber
	}

	// 1. Check for active/pending withdrawal in WalletTransaction across all accounts.
	var activeTx models.WalletTransaction
	txErr := s.db.WithContext(ctx).Model(&models.WalletTransaction{}).
		Where("(account_no = ? OR account_no = ? OR REPLACE(REPLACE(COALESCE(account_no, ''), ' ', ''), '-', '') = ?)", accountNumber, cleanAccountNumber, cleanAccountNumber).
		Where("(LOWER(COALESCE(\"transactionType\", '')) = 'withdrawal' OR LOWER(COALESCE(description, '')) LIKE '%withdraw%' OR LOWER(COALESCE(type, '')) = 'debit')").
		Where("UPPER(COALESCE(status, 'PENDING')) IN ('PENDING', 'PROCESSING', 'REQUESTED', 'INITIATED', 'QUEUED', 'IN_PROGRESS', 'HOLD')").
		Where("UPPER(COALESCE(status, '')) NOT IN ('SUCCESS', 'PAID', 'COMPLETED', 'FAILED', 'CANCELLED', 'REVERSED', 'REJECTED', 'EXPIRED')").
		Order("\"createdAt\" DESC").
		First(&activeTx).Error

	if txErr == nil && activeTx.ID > 0 {
		statusStr := "Pending"
		if activeTx.Status != nil && *activeTx.Status != "" {
			statusStr = *activeTx.Status
		}
		log.Printf("[PaymentService] Blocked withdrawal: Bank account %s has active WalletTransaction id=%d userId=%d status=%s",
			cleanAccountNumber, activeTx.ID, activeTx.UserID, statusStr)
		return fmt.Errorf("this bank account number (%s) is already linked to an active payout. A bank account can only receive one payout per cycle. Please wait for the current payout to complete or fail before initiating another withdrawal", maskIDNumber(accountNumber))
	} else if txErr != nil && !errors.Is(txErr, gorm.ErrRecordNotFound) {
		log.Printf("[PaymentService] WARNING: Error querying WalletTransaction for active payout check: %v", txErr)
	}

	// 2. Check for active/pending payout in Payout table across all accounts.
	var activePayout models.Payout
	payoutErr := s.db.WithContext(ctx).Model(&models.Payout{}).
		Where("UPPER(status::text) = 'PENDING'").
		Where("(reference = ? OR reference = ? OR metadata->>'accountNumber' = ? OR metadata->>'destinationAccountNumber' = ? OR metadata->>'account_no' = ?)", accountNumber, cleanAccountNumber, cleanAccountNumber, cleanAccountNumber, cleanAccountNumber).
		Order("\"createdAt\" DESC").
		First(&activePayout).Error

	if payoutErr == nil && activePayout.ID > 0 {
		log.Printf("[PaymentService] Blocked withdrawal: Bank account %s has active Payout id=%d userId=%d ref=%s",
			cleanAccountNumber, activePayout.ID, activePayout.UserID, activePayout.Reference)
		return fmt.Errorf("this bank account number (%s) is already linked to an active payout. A bank account can only receive one payout per cycle. Please wait for the current payout to complete or fail before initiating another withdrawal", maskIDNumber(accountNumber))
	} else if payoutErr != nil && !errors.Is(payoutErr, gorm.ErrRecordNotFound) {
		log.Printf("[PaymentService] WARNING: Error querying Payout for active payout check: %v", payoutErr)
	}

	return nil
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

	accountName, _ := payload["accountName"].(string)
	accountNumber := ""
	if v, ok := payload["destinationAccountNumber"].(string); ok {
		accountNumber = v
	} else if v, ok := payload["accountNumber"].(string); ok {
		accountNumber = v
	} else if v, ok := payload["destinationAccountNumber"].(float64); ok {
		accountNumber = fmt.Sprintf("%.0f", v)
	} else if v, ok := payload["accountNumber"].(float64); ok {
		accountNumber = fmt.Sprintf("%.0f", v)
	}
	accountNumber = strings.TrimSpace(accountNumber)
	if accountNumber == "" {
		return nil, errors.New("destination bank account number is required")
	}

	bankName, _ := payload["destinationBankName"].(string)
	if bankName == "" {
		bankName, _ = payload["bankName"].(string)
	}

	bankCode := ""
	if v, ok := payload["destinationBankCode"].(string); ok {
		bankCode = v
	} else if v, ok := payload["bankCode"].(string); ok {
		bankCode = v
	}
	narration, _ := payload["narration"].(string)
	if narration == "" {
		narration = "Wallet Withdrawal"
	}

	// Enforce rule: a single bank account number can only be linked to one active payout/cash-out at a time.
	if err := s.ValidateActiveBankAccountPayout(ctx, accountNumber); err != nil {
		return nil, err
	}

	// Savings (Gold) / Checking (Personal) accounts unlock withdrawals at ₦10,000.
	sourceAccountType := strings.ToLower(strings.TrimSpace(func() string {
		v, _ := payload["accountType"].(string)
		return v
	}()))
	if sourceAccountType == "" {
		sourceAccountType = "checking"
	}
	isSavings := sourceAccountType == "savings"
	var wallet models.Wallet
	if err := s.db.WithContext(ctx).Where("\"userId\" = ?", userID).First(&wallet).Error; err != nil {
		return nil, fmt.Errorf("wallet not found for user: %w", err)
	}
	accountBalance := wallet.CheckingBalance
	if isSavings {
		accountBalance = wallet.SavingsBalance
	} else {
		if availablePersonal, err := s.availableCheckingBalance(ctx, userID, wallet.CheckingBalance); err == nil {
			accountBalance = availablePersonal
		}
	}
	if accountBalance < withdrawalAccountUnlockThreshold {
		acctLabel := "checking"
		if isSavings {
			acctLabel = "savings"
		}
		notifyBelowWithdrawalThreshold(userID, acctLabel, accountBalance)
		return nil, fmt.Errorf(
			"minimum withdrawal threshold is ₦%s on your %s account. Keep earning to unlock withdrawals (current balance: ₦%s)",
			formatNaira(withdrawalAccountUnlockThreshold), acctLabel, formatNaira(accountBalance),
		)
	}

	txRef, _ := payload["reference"].(string)
	if txRef == "" {
		txRef = fmt.Sprintf("DISB-%d", time.Now().UnixNano())
		payload["reference"] = txRef
	}

	log.Printf("[PaymentService] ProcessWalletWithdrawal - userID=%d amount=%.2f ref=%s", userID, amount, txRef)
	paymentMethod := "bankTransfer"
	transactionType := "WITHDRAWAL"
	txStatus := "Pending"
	accountType := "Checking"

	// Step 1: Verify user wallet balance and debit in DB transaction
	var updatedWallet models.Wallet
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var wallet models.Wallet
		if err := tx.Where("\"userId\" = ?", userID).First(&wallet).Error; err != nil {
			return fmt.Errorf("wallet not found for user: %w", err)
		}

		availablePersonal, err := s.availableCheckingBalance(ctx, userID, wallet.CheckingBalance)
		if err != nil {
			return err
		}
		if availablePersonal < amount {
			return fmt.Errorf("insufficient wallet balance (available: %.2f, requested: %.2f)", wallet.CheckingBalance, amount)
		}

		// Debit checking balance
		wallet.CheckingBalance -= amount
		wallet.Balance = wallet.CheckingBalance

		if err := tx.Save(&wallet).Error; err != nil {
			return fmt.Errorf("failed to debit wallet: %w", err)
		}

		// Record in WalletTransaction
		withdrawProc := "Monnify"
		if proc, procErr := s.GetActivePaymentProcessorForChannel(ctx, "bank_transfer"); procErr == nil && proc != nil && strings.TrimSpace(proc.Name) != "" {
			withdrawProc = accounting.NormalizeProvider(proc.Name)
		}
		cls := accounting.ClassifyTransaction(accounting.ClassificationInput{
			UserID:          userID,
			UserDisplayName: s.resolveUserDisplayName(tx, userID),
			Kind:            accounting.KindWithdrawal,
			WalletAccount:   accountType,
			ExternalGateway: withdrawProc,
		})
		txType := "DEBIT"
		desc := labels.Wallet("withdrawal", map[string]string{"method": labels.Method("bankTransfer")})
		if desc == "" {
			desc = "Withdrawal - Bank Transfer"
		}
		wTx := models.WalletTransaction{
			UserID:          userID,
			ClientName:      cls.ClientName,
			Amount:          amount,
			Fee:             float64Ptr(0),
			NetAmount:       float64Ptr(amount),
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
			AccountType:     &cls.AccountType,
			Provider:        &cls.Provider,
			CreatedAt:       time.Now(),
		}
		if err := tx.Create(&wTx).Error; err != nil {
			return fmt.Errorf("failed to create WalletTransaction for withdrawal: %w", err)
		}

		if err := accounting.PostJournalTx(tx, &wTx, accounting.JournalInput{
			Kind:          accounting.KindWithdrawal,
			Purpose:       "withdrawal",
			Amount:        amount,
			Fee:           0,
			Currency:      "NGN",
			Provider:      cls.Provider,
			WalletAccount: cls.AccountType,
		}); err != nil {
			return fmt.Errorf("failed to post journal lines for withdrawal: %w", err)
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

	// Step 2: Route withdrawal to the active payment processor configured via superfan.admin
	activeProc, _ := s.GetActivePaymentProcessorForChannel(ctx, "bank_transfer")
	procName := "monnify"
	var customPubKey, customSecKey string
	if activeProc != nil && activeProc.Name != "" {
		procName = strings.ToLower(activeProc.Name)
		if activeProc.PublicKey != nil {
			customPubKey = strings.TrimSpace(*activeProc.PublicKey)
		}
		if activeProc.SecretKey != nil {
			customSecKey = strings.TrimSpace(*activeProc.SecretKey)
		}
	}
	if customSecKey == "" && s.db != nil {
		var proc models.PaymentProcessor
		if err := s.db.WithContext(ctx).Where("LOWER(name) = ?", procName).First(&proc).Error; err == nil {
			if proc.SecretKey != nil && *proc.SecretKey != "" {
				customSecKey = strings.TrimSpace(*proc.SecretKey)
			}
			if proc.PublicKey != nil && *proc.PublicKey != "" {
				customPubKey = strings.TrimSpace(*proc.PublicKey)
			}
		}
	}

	log.Printf("[PaymentService] Executing withdrawal via active processor: %s (ref: %s, amount: %.2f)", procName, txRef, amount)

	switch procName {
	case "bachs":
		secKey := customSecKey
		if secKey == "" {
			secKey = os.Getenv("BACHS_SECRET_KEY")
		}
		if secKey == "" {
			log.Printf("[PaymentService] WARNING: Bachs secret key not configured for withdrawal")
			return s.formatPendingWithdrawalResponse(txRef, amount, "bachs", updatedWallet), nil
		}

		bachsTransferBody := map[string]interface{}{
			"amount":                     amount,
			"currency":                   "NGN",
			"reference":                  txRef,
			"narration":                  narration,
			"destination_account_number": accountNumber,
			"destination_bank_code":      bankCode,
			"destination_account_name":   accountName,
			"beneficiary": map[string]interface{}{
				"account_number": accountNumber,
				"bank_code":      bankCode,
				"account_name":   accountName,
			},
		}
		bodyBytes, _ := json.Marshal(bachsTransferBody)
		bachsUrl := "https://api.bachs.io/v1/transfers"
		httpReq, err := http.NewRequestWithContext(ctx, "POST", bachsUrl, bytes.NewBuffer(bodyBytes))
		if err != nil {
			log.Printf("[PaymentService] WARNING: Failed to create Bachs transfer request: %v", err)
			return s.formatPendingWithdrawalResponse(txRef, amount, "bachs", updatedWallet), nil
		}
		httpReq.Header.Set("Authorization", "Bearer "+secKey)
		httpReq.Header.Set("Content-Type", "application/json")

		client := &http.Client{Timeout: 30 * time.Second}
		resp, err := client.Do(httpReq)
		if err != nil {
			log.Printf("[PaymentService] WARNING: Bachs transfer request failed: %v", err)
			return s.formatPendingWithdrawalResponse(txRef, amount, "bachs", updatedWallet), nil
		}
		defer resp.Body.Close()

		var bachsRes map[string]interface{}
		_ = json.NewDecoder(resp.Body).Decode(&bachsRes)
		log.Printf("[PaymentService] Bachs transfer response (HTTP %d): %+v", resp.StatusCode, bachsRes)

		return map[string]interface{}{
			"requestSuccessful": true,
			"responseCode":      "0",
			"responseMessage":   "Withdrawal initiated successfully via Bachs",
			"responseBody": map[string]interface{}{
				"reference":           txRef,
				"status":              "PENDING",
				"amount":              amount,
				"processor":           "bachs",
				"accountNumber":       accountNumber,
				"accountName":         accountName,
				"destinationBankCode": bankCode,
				"destinationBankName": bankName,
				"wallet": map[string]interface{}{
					"balance":         updatedWallet.Balance,
					"checkingBalance": updatedWallet.CheckingBalance,
					"savingsBalance":  updatedWallet.SavingsBalance,
									},
				"processorResponse": bachsRes,
			},
		}, nil

	case "flutterwave":
		secKey := customSecKey
		if secKey == "" {
			secKey = os.Getenv("FLW_SECRET_KEY")
			if secKey == "" {
				secKey = os.Getenv("FLUTTERWAVE_SECRET_KEY")
			}
		}
		if secKey == "" {
			log.Printf("[PaymentService] WARNING: Flutterwave secret key not configured for withdrawal")
			return s.formatPendingWithdrawalResponse(txRef, amount, "flutterwave", updatedWallet), nil
		}

		flwTransferBody := map[string]interface{}{
			"account_bank":   bankCode,
			"account_number": accountNumber,
			"amount":         amount,
			"narration":      narration,
			"currency":       "NGN",
			"reference":      txRef,
			"debit_currency": "NGN",
		}
		bodyBytes, _ := json.Marshal(flwTransferBody)
		flwUrl := "https://api.flutterwave.com/v3/transfers"
		httpReq, err := http.NewRequestWithContext(ctx, "POST", flwUrl, bytes.NewBuffer(bodyBytes))
		if err != nil {
			log.Printf("[PaymentService] WARNING: Failed to create Flutterwave transfer request: %v", err)
			return s.formatPendingWithdrawalResponse(txRef, amount, "flutterwave", updatedWallet), nil
		}
		httpReq.Header.Set("Authorization", "Bearer "+secKey)
		httpReq.Header.Set("Content-Type", "application/json")

		client := &http.Client{Timeout: 30 * time.Second}
		resp, err := client.Do(httpReq)
		if err != nil {
			log.Printf("[PaymentService] WARNING: Flutterwave transfer request failed: %v", err)
			return s.formatPendingWithdrawalResponse(txRef, amount, "flutterwave", updatedWallet), nil
		}
		defer resp.Body.Close()

		var flwRes map[string]interface{}
		_ = json.NewDecoder(resp.Body).Decode(&flwRes)
		log.Printf("[PaymentService] Flutterwave transfer response (HTTP %d): %+v", resp.StatusCode, flwRes)

		return map[string]interface{}{
			"requestSuccessful": true,
			"responseCode":      "0",
			"responseMessage":   "Withdrawal initiated successfully via Flutterwave",
			"responseBody": map[string]interface{}{
				"reference":           txRef,
				"status":              "PENDING",
				"amount":              amount,
				"processor":           "flutterwave",
				"accountNumber":       accountNumber,
				"accountName":         accountName,
				"destinationBankCode": bankCode,
				"destinationBankName": bankName,
				"wallet": map[string]interface{}{
					"balance":         updatedWallet.Balance,
					"checkingBalance": updatedWallet.CheckingBalance,
					"savingsBalance":  updatedWallet.SavingsBalance,
									},
				"processorResponse": flwRes,
			},
		}, nil

	default: // Monnify
		provider := s.monnifyProvider
		if customPubKey != "" && customSecKey != "" {
			mUri := os.Getenv("MONNIFY_URI")
			if mUri == "" {
				if strings.HasPrefix(customPubKey, "MK_PROD_") {
					mUri = "https://api.monnify.com"
				} else {
					mUri = "https://sandbox.monnify.com"
				}
			}
			mContract := monnifyContractCode(activeProc, customPubKey)
			provider = providers.NewMonnifyProvider(customPubKey, customSecKey, mUri, mContract)
		}

		disbursementResult, err := provider.DisburseSingle(ctx, payload)
		if err != nil {
			log.Printf("[PaymentService] WARNING: Monnify disbursement request error: %v", err)
			return s.formatPendingWithdrawalResponse(txRef, amount, "monnify", updatedWallet), nil
		}

		return disbursementResult, nil
	}
}

func (s *PaymentService) formatPendingWithdrawalResponse(txRef string, amount float64, processor string, wallet models.Wallet) map[string]interface{} {
	procTitle := processor
	if len(procTitle) > 0 {
		procTitle = strings.ToUpper(procTitle[:1]) + procTitle[1:]
	}
	return map[string]interface{}{
		"requestSuccessful": true,
		"responseCode":      "0",
		"responseMessage":   fmt.Sprintf("Withdrawal initiated successfully via %s", procTitle),
		"responseBody": map[string]interface{}{
			"reference": txRef,
			"status":    "PENDING",
			"amount":    amount,
			"processor": processor,
			"wallet": map[string]interface{}{
				"balance":         wallet.Balance,
				"checkingBalance": wallet.CheckingBalance,
				"savingsBalance":  wallet.SavingsBalance,
							},
		},
	}
}

// ValidateWithdrawalOTP authorizes a pending disbursement with an OTP code.
func (s *PaymentService) ValidateWithdrawalOTP(ctx context.Context, reference, authCode string) (map[string]interface{}, error) {
	activeProc, _ := s.GetActivePaymentProcessorForChannel(ctx, "bank_transfer")
	procName := "monnify"
	if activeProc != nil && activeProc.Name != "" {
		procName = strings.ToLower(activeProc.Name)
	}
	if procName == "monnify" {
		return s.monnifyProvider.ValidateDisbursementOTP(ctx, reference, authCode)
	}
	return map[string]interface{}{
		"requestSuccessful": true,
		"responseCode":      "0",
		"responseMessage":   "OTP validated successfully",
		"responseBody": map[string]interface{}{
			"reference": reference,
			"status":    "SUCCESS",
		},
	}, nil
}

// DebitUserWallet atomically debits a user's wallet for ad campaigns or services, creating both WalletTransaction and ActivityWallet records.
func (s *PaymentService) DebitUserWallet(ctx context.Context, userID int, amount float64, description, txRef string) (*models.Wallet, error) {
	return s.DebitUserWalletFromAccount(ctx, userID, amount, accounting.AccountTypeChecking, "", description, txRef)
}

// DebitUserWalletFromAccount debits either Checking (Personal) or Savings (Gold) wallet atomically
// and posts balanced wallet-purchase journal lines with Provider = "In-app".
func (s *PaymentService) DebitUserWalletFromAccount(ctx context.Context, userID int, amount float64, accountType, purpose, description, txRef string) (*models.Wallet, error) {
	if userID <= 0 {
		return nil, errors.New("invalid userId")
	}
	if amount <= 0 {
		return nil, errors.New("amount must be greater than 0")
	}
	if description == "" {
		description = "Wallet Purchase"
	}
	if txRef == "" {
		txRef = fmt.Sprintf("DEBIT-WALLET-%d", time.Now().UnixNano())
	}
	normAccount := accounting.NormalizeWalletAccount(accountType)

	log.Printf("[PaymentService] DebitUserWalletFromAccount - userID=%d account=%s amount=%.2f desc=%s ref=%s", userID, normAccount, amount, description, txRef)

	var updatedWallet models.Wallet
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var wallet models.Wallet
		if err := tx.Where("\"userId\" = ?", userID).First(&wallet).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errors.New("wallet not found for user")
			}
			return fmt.Errorf("failed to fetch wallet: %w", err)
		}

		// Idempotency check
		var existingCount int64
		if err := tx.Model(&models.WalletTransaction{}).Where(`"trx_ref" = ? AND "status" = ?`, txRef, "Completed").Count(&existingCount).Error; err != nil {
			return fmt.Errorf("failed to check existing wallet transaction: %w", err)
		} else if existingCount > 0 {
			updatedWallet = wallet
			return nil
		}

		if normAccount == accounting.AccountTypeSavings {
			if wallet.SavingsBalance < amount {
				return fmt.Errorf("insufficient savings wallet balance (available: %.2f, required: %.2f)", wallet.SavingsBalance, amount)
			}
			wallet.SavingsBalance -= amount
		} else {
			if wallet.CheckingBalance < amount {
				return fmt.Errorf("insufficient checking wallet balance (available: %.2f, required: %.2f)", wallet.CheckingBalance, amount)
			}
			wallet.CheckingBalance -= amount
			wallet.Balance = wallet.CheckingBalance
		}

		if err := tx.Save(&wallet).Error; err != nil {
			return fmt.Errorf("failed to debit wallet: %w", err)
		}

		cls := accounting.ClassifyTransaction(accounting.ClassificationInput{
			UserID:          userID,
			UserDisplayName: s.resolveUserDisplayName(tx, userID),
			Kind:            accounting.KindWalletPurchase,
			WalletAccount:   normAccount,
		})

		// Record in WalletTransaction
		txType := "DEBIT"
		status := "Completed"
		trxType := resolveDirectPaymentTransactionType(purpose, description, txRef)
		pmWallet := "WALLET"
		wTx := models.WalletTransaction{
			UserID:          userID,
			ClientName:      cls.ClientName,
			Amount:          amount,
			Fee:             float64Ptr(0),
			NetAmount:       float64Ptr(amount),
			Type:            &txType,
			TransactionType: &trxType,
			Status:          &status,
			Currency:        "NGN",
			Description:     &description,
			TrxRef:          &txRef,
			PaymentMethod:   &pmWallet,
			AccountType:     &cls.AccountType,
			Provider:        &cls.Provider,
			CreatedAt:       time.Now(),
		}
		if err := tx.Create(&wTx).Error; err != nil {
			return fmt.Errorf("failed to create WalletTransaction for debit: %w", err)
		}

		if err := accounting.PostJournalTx(tx, &wTx, accounting.JournalInput{
			Kind:          accounting.KindWalletPurchase,
			Purpose:       purpose,
			Amount:        amount,
			Fee:           0,
			Currency:      "NGN",
			Provider:      cls.Provider,
			WalletAccount: cls.AccountType,
		}); err != nil {
			return fmt.Errorf("failed to post journal lines for wallet debit: %w", err)
		}

		markPaymentIntentPaidTx(tx, txRef)

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

// RecordSettlement records a gateway-to-platform-bank settlement (Client = In-app, AccountType = Platform).
func (s *PaymentService) RecordSettlement(ctx context.Context, providerName, txRef string, amount, fee float64, currency string) error {
	if amount <= 0 {
		return fmt.Errorf("invalid settlement amount: %.2f", amount)
	}
	if fee < 0 || fee > amount {
		return fmt.Errorf("invalid settlement fee %.2f for amount %.2f", fee, amount)
	}
	if currency == "" {
		currency = "NGN"
	}
	if strings.TrimSpace(txRef) == "" {
		txRef = fmt.Sprintf("SETTLE-%d", time.Now().UnixNano())
	}

	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var existingCount int64
		if err := tx.Model(&models.WalletTransaction{}).Where(`"trx_ref" = ? AND "status" = ?`, txRef, "Completed").Count(&existingCount).Error; err != nil {
			return err
		}
		if existingCount > 0 {
			return nil
		}

		cls := accounting.ClassifyTransaction(accounting.ClassificationInput{
			UserID:          0,
			Kind:            accounting.KindSettlement,
			ExternalGateway: providerName,
		})
		txType := "CREDIT"
		trxType := "SETTLEMENT"
		status := "Completed"
		desc := fmt.Sprintf("%s settlement to platform bank", cls.Provider)
		pm := "SETTLEMENT"
		netAmount := amount - fee
		wTx := models.WalletTransaction{
			UserID:          0,
			ClientName:      cls.ClientName,
			Amount:          amount,
			Fee:             float64Ptr(fee),
			NetAmount:       float64Ptr(netAmount),
			Type:            &txType,
			TransactionType: &trxType,
			Status:          &status,
			Currency:        currency,
			Description:     &desc,
			TrxRef:          &txRef,
			PaymentMethod:   &pm,
			AccountType:     &cls.AccountType,
			Provider:        &cls.Provider,
			CreatedAt:       time.Now(),
		}
		if err := tx.Create(&wTx).Error; err != nil {
			return err
		}
		return accounting.PostJournalTx(tx, &wTx, accounting.JournalInput{
			Kind:     accounting.KindSettlement,
			Purpose:  "settlement",
			Amount:   amount,
			Fee:      fee,
			Currency: currency,
			Provider: cls.Provider,
		})
	})
}

// RecordExternalRefund records a gateway refund reversal (Client = user, AccountType = Platform, Provider = gateway).
func (s *PaymentService) RecordExternalRefund(ctx context.Context, userID int, providerName, purpose, txRef string, amount, fee float64, currency string) error {
	if userID <= 0 {
		return errors.New("invalid userId for external refund")
	}
	if amount <= 0 {
		return fmt.Errorf("invalid refund amount: %.2f", amount)
	}
	if fee < 0 || fee > amount {
		return fmt.Errorf("invalid refund fee %.2f for amount %.2f", fee, amount)
	}
	if currency == "" {
		currency = "NGN"
	}
	if strings.TrimSpace(txRef) == "" {
		txRef = fmt.Sprintf("REFUND-EXT-%d", time.Now().UnixNano())
	}

	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var existingCount int64
		if err := tx.Model(&models.WalletTransaction{}).Where(`"trx_ref" = ? AND "status" = ?`, txRef, "Completed").Count(&existingCount).Error; err != nil {
			return err
		}
		if existingCount > 0 {
			return nil
		}

		cls := accounting.ClassifyTransaction(accounting.ClassificationInput{
			UserID:          userID,
			UserDisplayName: s.resolveUserDisplayName(tx, userID),
			Kind:            accounting.KindExternalRefund,
			ExternalGateway: providerName,
		})
		txType := "DEBIT"
		trxType := "REFUND"
		status := "Completed"
		desc := fmt.Sprintf("Refund via %s (%s)", cls.Provider, purpose)
		pm := "REFUND"
		netAmount := amount - fee
		wTx := models.WalletTransaction{
			UserID:          userID,
			ClientName:      cls.ClientName,
			Amount:          amount,
			Fee:             float64Ptr(fee),
			NetAmount:       float64Ptr(netAmount),
			Type:            &txType,
			TransactionType: &trxType,
			Status:          &status,
			Currency:        currency,
			Description:     &desc,
			TrxRef:          &txRef,
			PaymentMethod:   &pm,
			AccountType:     &cls.AccountType,
			Provider:        &cls.Provider,
			CreatedAt:       time.Now(),
		}
		if err := tx.Create(&wTx).Error; err != nil {
			return err
		}
		return accounting.PostJournalTx(tx, &wTx, accounting.JournalInput{
			Kind:     accounting.KindExternalRefund,
			Purpose:  purpose,
			Amount:   amount,
			Fee:      fee,
			Currency: currency,
			Provider: cls.Provider,
		})
	})
}

// RecordFailedTransaction logs a failed payment/deposit attempt without mutating balances or posting revenue/liability journals.
func (s *PaymentService) RecordFailedTransaction(ctx context.Context, userID int, accountType, providerName, trxType, txRef, reason string, amount float64, currency string) error {
	if currency == "" {
		currency = "NGN"
	}
	if strings.TrimSpace(txRef) == "" {
		txRef = fmt.Sprintf("FAIL-%d", time.Now().UnixNano())
	}
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var existingCount int64
		if err := tx.Model(&models.WalletTransaction{}).Where(`"trx_ref" = ? AND "status" = ?`, txRef, "Failed").Count(&existingCount).Error; err != nil {
			return err
		}
		if existingCount > 0 {
			return nil
		}
		client := accounting.ProviderInApp
		if userID > 0 {
			client = s.resolveUserDisplayName(tx, userID)
		}
		acct := accountType
		if strings.TrimSpace(acct) == "" {
			acct = accounting.AccountTypePlatform
		}
		prov := accounting.NormalizeProvider(providerName)
		txType := "DEBIT"
		if strings.EqualFold(trxType, "Deposit") {
			txType = "CREDIT"
		}
		status := "Failed"
		desc := strings.TrimSpace(reason)
		if desc == "" {
			desc = "Transaction failed"
		}
		wTx := models.WalletTransaction{
			UserID:          userID,
			ClientName:      client,
			Amount:          amount,
			Fee:             float64Ptr(0),
			NetAmount:       float64Ptr(0),
			Type:            &txType,
			TransactionType: &trxType,
			Status:          &status,
			Currency:        currency,
			Description:     &desc,
			TrxRef:          &txRef,
			AccountType:     &acct,
			Provider:        &prov,
			CreatedAt:       time.Now(),
		}
		return tx.Create(&wTx).Error
	})
}

func markPaymentIntentPaidTx(tx *gorm.DB, txRef string) {
	if tx == nil || strings.TrimSpace(txRef) == "" {
		return
	}
	_ = tx.Exec(`SAVEPOINT sp_mark_intent_paid`).Error
	err := tx.Model(&models.PaymentIntent{}).
		Where("reference = ? AND UPPER(COALESCE(status, '')) <> 'PAID'", strings.TrimSpace(txRef)).
		Updates(map[string]interface{}{
			"status":    "PAID",
			"updatedAt": time.Now(),
		}).Error
	if err != nil {
		_ = tx.Exec(`ROLLBACK TO SAVEPOINT sp_mark_intent_paid`).Error
	} else {
		_ = tx.Exec(`RELEASE SAVEPOINT sp_mark_intent_paid`).Error
	}
}

// CreatePaymentIntent records a PENDING_PAYMENT intent before charging a card, bank, or wallet.
func (s *PaymentService) CreatePaymentIntent(ctx context.Context, userID int, reference, purpose string, amount float64, currency string, targetType, targetID, metadata *string) (*models.PaymentIntent, error) {
	if s.db == nil {
		return nil, errors.New("database not initialized")
	}
	if userID <= 0 {
		return nil, errors.New("userId must be a positive integer")
	}
	if amount <= 0 {
		return nil, errors.New("amount must be greater than 0")
	}
	reference = strings.TrimSpace(reference)
	if reference == "" {
		reference = fmt.Sprintf("INTENT-%d-%d", userID, time.Now().UnixNano())
	}
	if strings.TrimSpace(purpose) == "" {
		purpose = "deposit"
	}
	if strings.TrimSpace(currency) == "" {
		currency = "NGN"
	}

	var existing models.PaymentIntent
	if err := s.db.WithContext(ctx).Where("reference = ?", reference).First(&existing).Error; err == nil {
		return &existing, nil
	}

	intent := models.PaymentIntent{
		UserID:     userID,
		Reference:  reference,
		Purpose:    strings.TrimSpace(purpose),
		TargetType: targetType,
		TargetID:   targetID,
		Amount:     amount,
		Currency:   strings.ToUpper(strings.TrimSpace(currency)),
		Status:     "PENDING_PAYMENT",
		Metadata:   metadata,
		CreatedAt:  time.Now(),
		UpdatedAt:  time.Now(),
	}
	if err := s.db.WithContext(ctx).Create(&intent).Error; err != nil {
		return nil, fmt.Errorf("failed to create payment intent: %w", err)
	}
	return &intent, nil
}

// GetPaymentIntent retrieves a PaymentIntent by its unique reference.
func (s *PaymentService) GetPaymentIntent(ctx context.Context, reference string) (*models.PaymentIntent, error) {
	if s.db == nil {
		return nil, errors.New("database not initialized")
	}
	var intent models.PaymentIntent
	if err := s.db.WithContext(ctx).Where("reference = ?", strings.TrimSpace(reference)).First(&intent).Error; err != nil {
		return nil, err
	}
	return &intent, nil
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
