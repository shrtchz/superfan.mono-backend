package controllers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"quiz.superfan.com/apis/middleware"
	"quiz.superfan.com/apis/services/payment"
	"quiz.superfan.com/apis/services/payment/providers"
	"quiz.superfan.com/apis/utils"
)

type PaymentController struct {
	paymentService *payment.PaymentService
}

func NewPaymentController(ps *payment.PaymentService) *PaymentController {
	return &PaymentController{
		paymentService: ps,
	}
}

func sendDetailedError(c *gin.Context, statusCode int, errCode string, message string, rawErr error) {
	errMsg := message
	if rawErr != nil && rawErr.Error() != "" && rawErr.Error() != message {
		errMsg = fmt.Sprintf("%s: %s", message, rawErr.Error())
	}
	log.Printf("[PaymentController] ERROR %s (%d): %s", errCode, statusCode, errMsg)
	c.JSON(statusCode, map[string]interface{}{
		"requestSuccessful": false,
		"responseCode":      "99",
		"responseMessage":   errMsg,
		"code":              errCode,
		"message":           errMsg,
		"error":             errMsg,
	})
}

// InitiateDeposit handles POST /v1/payment/deposit
func (pc *PaymentController) InitiateDeposit(c *gin.Context) {
	var req providers.DepositRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.SendError(c, http.StatusBadRequest, "BAD_REQUEST", "invalid request payload")
		return
	}

	res, err := pc.paymentService.InitiateDeposit(c.Request.Context(), req)
	if err != nil {
		utils.SendError(c, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", err.Error())
		return
	}

	utils.Success(c, http.StatusOK, "Deposit initiated", res)
}

// Webhook handles POST /v1/payment/webhook/:provider, /api/v1/payment/webhook/:provider, /webhooks/:provider
func (pc *PaymentController) Webhook(c *gin.Context) {
	providerParam := strings.ToLower(c.Param("provider"))

	rawBody, err := io.ReadAll(c.Request.Body)
	if err != nil {
		utils.SendError(c, http.StatusBadRequest, "BAD_REQUEST", "invalid request payload")
		return
	}
	c.Request.Body = io.NopCloser(bytes.NewBuffer(rawBody))

	// Detect provider from headers or query if not in URL param
	if providerParam == "" {
		if c.GetHeader("X-Bachs-Signature") != "" || c.GetHeader("x-bachs-signature") != "" || c.GetHeader("Bachs-Signature") != "" {
			providerParam = "bachs"
		}
	}

	switch providerParam {
	case "bachs":
		signature := c.GetHeader("X-Bachs-Signature")
		if signature == "" {
			signature = c.GetHeader("x-bachs-signature")
		}
		if signature == "" {
			signature = c.GetHeader("Bachs-Signature")
		}

		var payload map[string]interface{}
		if err := json.Unmarshal(rawBody, &payload); err != nil {
			utils.SendError(c, http.StatusBadRequest, "BAD_REQUEST", "invalid json body")
			return
		}

		if err := pc.paymentService.HandleBachsWebhook(c.Request.Context(), signature, rawBody, payload); err != nil {
			log.Printf("[PaymentController] Bachs webhook error: %v", err)
			utils.SendError(c, http.StatusBadRequest, "WEBHOOK_FAILED", err.Error())
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"status":  "success",
			"message": "Bachs webhook processed successfully",
		})
		return

	case "monnify":
		signature := c.GetHeader("monnify-signature")
		if signature == "" {
			signature = c.GetHeader("Monnify-Signature")
		}
		if err := pc.paymentService.VerifyProviderWebhook(c.Request.Context(), "monnify", signature, rawBody); err != nil {
			log.Printf("[PaymentController] Monnify webhook signature error: %v", err)
			utils.SendError(c, http.StatusUnauthorized, "UNAUTHORIZED", err.Error())
			return
		}
		txRef := extractWebhookReference(rawBody, "eventData", "transactionReference", "paymentReference", "reference")
		if txRef == "" {
			utils.SendError(c, http.StatusBadRequest, "BAD_REQUEST", "missing transaction reference in webhook payload")
			return
		}
		if err := pc.paymentService.HandleDepositWebhook(c.Request.Context(), "NGN", providers.VerifyTransactionRequest{TransactionReference: txRef}); err != nil {
			utils.SendError(c, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", err.Error())
			return
		}
		utils.Success(c, http.StatusOK, "Webhook processed successfully", nil)

	case "bitnob":
		signature := c.GetHeader("x-bitnob-signature")
		if signature == "" {
			signature = c.GetHeader("X-Bitnob-Signature")
		}
		if err := pc.paymentService.VerifyProviderWebhook(c.Request.Context(), "bitnob", signature, rawBody); err != nil {
			log.Printf("[PaymentController] Bitnob webhook signature error: %v", err)
			utils.SendError(c, http.StatusUnauthorized, "UNAUTHORIZED", err.Error())
			return
		}
		txRef := extractWebhookReference(rawBody, "data", "reference", "transactionReference", "id")
		if txRef == "" {
			utils.SendError(c, http.StatusBadRequest, "BAD_REQUEST", "missing transaction reference in webhook payload")
			return
		}
		if err := pc.paymentService.HandleDepositWebhook(c.Request.Context(), "USDC", providers.VerifyTransactionRequest{TransactionReference: txRef}); err != nil {
			utils.SendError(c, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", err.Error())
			return
		}
		utils.Success(c, http.StatusOK, "Webhook processed successfully", nil)

	default:
		utils.SendError(c, http.StatusBadRequest, "BAD_REQUEST", "unknown provider webhook")
		return
	}
}

func extractWebhookReference(rawBody []byte, nestedKey string, keys ...string) string {
	var body map[string]interface{}
	if err := json.Unmarshal(rawBody, &body); err != nil {
		return ""
	}
	for _, k := range keys {
		if v, ok := body[k].(string); ok && strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	if nested, ok := body[nestedKey].(map[string]interface{}); ok {
		for _, k := range keys {
			if v, ok := nested[k].(string); ok && strings.TrimSpace(v) != "" {
				return strings.TrimSpace(v)
			}
		}
	}
	return ""
}

func RegisterPaymentRoutes(rg *gin.RouterGroup, pc *PaymentController) {
	paymentGroup := rg.Group("/payment")

	// Public payment provider webhooks (verified via provider signature/HMAC)
	paymentGroup.POST("/webhook/:provider", pc.Webhook)
	paymentGroup.POST("/webhook", pc.Webhook)
	paymentGroup.POST("/webhooks/:provider", pc.Webhook)
	paymentGroup.POST("/webhooks", pc.Webhook)
	rg.POST("/webhooks/:provider", pc.Webhook)
	rg.POST("/webhooks", pc.Webhook)

	// Authenticated user & internal service payment endpoints
	authed := paymentGroup.Group("", middleware.InternalOrAuthRequired())
	authed.GET("/banks", pc.GetBanks)
	authed.GET("/banks/validate", pc.ValidateBankAccount)
	authed.GET("/rates", pc.GetRates)
	authed.GET("/convert", pc.ConvertCurrency)
	authed.POST("/convert", pc.ConvertCurrency)
	authed.POST("/intent", pc.CreatePaymentIntent)
	authed.GET("/intent/:reference", pc.GetPaymentIntent)
	authed.GET("/wallet-transactions", pc.GetWalletTransactions)
	authed.POST("/deposit", pc.InitiateDeposit)
	authed.POST("/initialize-transaction", pc.InitializeTransaction)
	authed.POST("/init-payment-by-transfer", pc.InitPaymentByTransfer)
	authed.POST("/charge-card", pc.ChargeCard)
	authed.POST("/authorize-card-otp", pc.AuthorizeCardOTP)
	authed.GET("/query-transaction", pc.QueryTransaction)
	authed.POST("/simulate-address-deposit", pc.SimulateAddressDeposit)
	authed.GET("/user-wallet-balance", pc.GetUserWalletBalance)
	authed.GET("/payments/history", pc.GetPaymentHistory)
	authed.POST("/trf-btw-wallets/:userId", pc.TransferBetweenWallets)
	authed.POST("/create-withdrawal-bank", pc.CreateUserWithdrawalBank)
	authed.GET("/user-withdrawal-banks", pc.GetUserWithdrawalBanks)
	authed.GET("/user-withdrawal-banks/:userId", pc.GetUserWithdrawalBanks)
	authed.POST("/connect-withdrawal-wallet", pc.CreateUserWithdrawalWallet)
	authed.GET("/user-withdrawal-wallets/:userId", pc.GetUserWithdrawalWallets)
	authed.POST("/wallet-withdrawal", pc.WalletWithdrawal)
	authed.POST("/debit", pc.DebitWallet)
	authed.POST("/validate-otp", pc.ValidateOTP)

	// Admin-only payment processor configuration
	adminOnly := paymentGroup.Group("", middleware.InternalOrAuthRequired(), middleware.InternalOrAdminRequired())
	adminOnly.GET("/processors", pc.GetProcessors)
	adminOnly.PATCH("/processors/:id/toggle", pc.ToggleProcessor)
}

// resolveAuthorizedUserID enforces that an authenticated non-admin caller
// cannot charge or debit another user's ID.
func resolveAuthorizedUserID(c *gin.Context, requestedUserID int) (int, bool) {
	authUserID := c.GetInt(middleware.ContextUserIDKey)
	if authUserID <= 0 {
		return requestedUserID, true
	}
	if requestedUserID <= 0 {
		return authUserID, true
	}
	if requestedUserID != authUserID && !middleware.IsAdmin(c) {
		return 0, false
	}
	return requestedUserID, true
}

// CreatePaymentIntent handles POST /v1/payment/intent
func (pc *PaymentController) CreatePaymentIntent(c *gin.Context) {
	var req struct {
		UserID     int     `json:"userId"`
		Reference  string  `json:"reference"`
		Purpose    string  `json:"purpose"`
		Amount     float64 `json:"amount"`
		Currency   string  `json:"currency"`
		TargetType *string `json:"targetType"`
		TargetID   *string `json:"targetId"`
		Metadata   *string `json:"metadata"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		sendDetailedError(c, http.StatusBadRequest, "BAD_REQUEST", "Invalid request payload", err)
		return
	}

	userID, allowed := resolveAuthorizedUserID(c, req.UserID)
	if !allowed {
		sendDetailedError(c, http.StatusForbidden, "FORBIDDEN", "Cannot create payment intent for another user", nil)
		return
	}
	if userID <= 0 {
		sendDetailedError(c, http.StatusBadRequest, "BAD_REQUEST", "userId must be a positive integer", nil)
		return
	}

	intent, err := pc.paymentService.CreatePaymentIntent(
		c.Request.Context(),
		userID,
		req.Reference,
		req.Purpose,
		req.Amount,
		req.Currency,
		req.TargetType,
		req.TargetID,
		req.Metadata,
	)
	if err != nil {
		sendDetailedError(c, http.StatusBadRequest, "PAYMENT_INTENT_FAILED", err.Error(), err)
		return
	}

	c.JSON(http.StatusCreated, map[string]interface{}{
		"requestSuccessful": true,
		"responseCode":      "0",
		"responseMessage":   "Payment intent created",
		"responseBody":      intent,
	})
}

// GetPaymentIntent handles GET /v1/payment/intent/:reference
func (pc *PaymentController) GetPaymentIntent(c *gin.Context) {
	ref := strings.TrimSpace(c.Param("reference"))
	if ref == "" {
		sendDetailedError(c, http.StatusBadRequest, "BAD_REQUEST", "reference is required", nil)
		return
	}
	intent, err := pc.paymentService.GetPaymentIntent(c.Request.Context(), ref)
	if err != nil {
		sendDetailedError(c, http.StatusNotFound, "NOT_FOUND", "Payment intent not found", err)
		return
	}
	authUserID := c.GetInt(middleware.ContextUserIDKey)
	if authUserID > 0 && intent.UserID != authUserID && !middleware.IsAdmin(c) {
		sendDetailedError(c, http.StatusForbidden, "FORBIDDEN", "Access denied", nil)
		return
	}
	c.JSON(http.StatusOK, map[string]interface{}{
		"requestSuccessful": true,
		"responseCode":      "0",
		"responseBody":      intent,
	})
}

// GetWalletTransactions handles GET /v1/payment/wallet-transactions
func (pc *PaymentController) GetWalletTransactions(c *gin.Context) {
	var filter payment.WalletTransactionFilter

	if uidStr := c.Query("userId"); uidStr != "" {
		fmt.Sscanf(uidStr, "%d", &filter.UserID)
	}
	filter.AccountType = c.Query("accountType")
	filter.Type = c.Query("type")
	filter.Currency = c.Query("currency")
	filter.Status = c.Query("status")

	if pageStr := c.Query("page"); pageStr != "" {
		fmt.Sscanf(pageStr, "%d", &filter.Page)
	}
	if limitStr := c.Query("limit"); limitStr != "" {
		fmt.Sscanf(limitStr, "%d", &filter.Limit)
	} else if perPageStr := c.Query("perPage"); perPageStr != "" {
		fmt.Sscanf(perPageStr, "%d", &filter.Limit)
	}

	if startStr := c.Query("startDate"); startStr != "" {
		if t, err := time.Parse(time.RFC3339, startStr); err == nil {
			filter.StartDate = &t
		}
	}
	if endStr := c.Query("endDate"); endStr != "" {
		if t, err := time.Parse(time.RFC3339, endStr); err == nil {
			filter.EndDate = &t
		}
	}

	transactions, total, err := pc.paymentService.GetWalletTransactions(c.Request.Context(), filter)
	if err != nil {
		sendDetailedError(c, http.StatusInternalServerError, "FETCH_TRANSACTIONS_FAILED", "Failed to fetch wallet transactions", err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"requestSuccessful": true,
		"responseCode":      "0",
		"responseMessage":   "Wallet transactions fetched successfully",
		"data":              transactions,
		"total":             total,
		"page":              filter.Page,
		"limit":             filter.Limit,
	})
}

// InitializeTransaction handles POST /v1/payment/initialize-transaction
// Accepts: { amount, customerEmail, customerName, paymentReference, currencyCode }
// Returns Monnify transactionReference in responseBody for card charging.
func (pc *PaymentController) InitializeTransaction(c *gin.Context) {
	log.Printf("[PaymentController] POST /v1/payment/initialize-transaction")

	var req map[string]interface{}
	if err := c.ShouldBindJSON(&req); err != nil {
		sendDetailedError(c, http.StatusBadRequest, "BAD_REQUEST", "Invalid request payload", err)
		return
	}

	log.Printf("[PaymentController] InitializeTransaction request: %+v", req)

	// Validate required fields
	amount, _ := req["amount"].(float64)
	if amount <= 0 {
		sendDetailedError(c, http.StatusBadRequest, "BAD_REQUEST", "amount must be greater than 0", nil)
		return
	}
	customerEmail, _ := req["customerEmail"].(string)
	if customerEmail == "" {
		sendDetailedError(c, http.StatusBadRequest, "BAD_REQUEST", "customerEmail is required", nil)
		return
	}

	res, err := pc.paymentService.InitializeTransaction(c.Request.Context(), req)
	if err != nil {
		sendDetailedError(c, http.StatusInternalServerError, "INIT_TRANSACTION_FAILED", "Failed to initialize transaction", err)
		return
	}

	log.Printf("[PaymentController] InitializeTransaction success: %+v", res)
	c.JSON(http.StatusOK, res)
}

// ChargeCard handles POST /v1/payment/charge-card
// Accepts: {
//   transactionReference: string,  -- from InitializeTransaction responseBody
//   userId: number,                -- user to credit wallet for
//   amount: number,                -- amount in NGN
//   currency: string,              -- "NGN"
//   card: { number, expiryMonth, expiryYear, cvv, pin }
// }
// Returns combined charge result + updated wallet on success.
// The wallet is credited atomically ONLY after a confirmed successful card charge.
func (pc *PaymentController) ChargeCard(c *gin.Context) {
	log.Printf("[PaymentController] POST /v1/payment/charge-card")

	var req map[string]interface{}
	if err := c.ShouldBindJSON(&req); err != nil {
		sendDetailedError(c, http.StatusBadRequest, "BAD_REQUEST", "Invalid request payload", err)
		return
	}

	// Validate required fields
	txRef, _ := req["transactionReference"].(string)
	if txRef == "" {
		sendDetailedError(c, http.StatusBadRequest, "BAD_REQUEST", "transactionReference is required", nil)
		return
	}

	userIDFloat, _ := req["userId"].(float64)
	userID, allowed := resolveAuthorizedUserID(c, int(userIDFloat))
	if !allowed {
		sendDetailedError(c, http.StatusForbidden, "FORBIDDEN", "Cannot charge card for another user", nil)
		return
	}
	if userID <= 0 {
		sendDetailedError(c, http.StatusBadRequest, "BAD_REQUEST", "userId must be a positive integer", nil)
		return
	}

	amount, _ := req["amount"].(float64)
	if amount <= 0 {
		sendDetailedError(c, http.StatusBadRequest, "BAD_REQUEST", "amount must be greater than 0", nil)
		return
	}

	currency, _ := req["currency"].(string)
	if currency == "" {
		currency = "NGN"
	}

	cardMap, _ := req["card"].(map[string]interface{})
	if cardMap == nil {
		sendDetailedError(c, http.StatusBadRequest, "BAD_REQUEST", "card details are required", nil)
		return
	}

	log.Printf("[PaymentController] ChargeCard - userID=%d amount=%.2f txRef=%s currency=%s", userID, amount, txRef, currency)

	// Pass charge payload (card + txRef + optional description) through to service
	chargePayload := map[string]interface{}{
		"transactionReference": txRef,
		"card":                 cardMap,
		"amount":               amount,
	}
	if desc, _ := req["description"].(string); strings.TrimSpace(desc) != "" {
		chargePayload["description"] = strings.TrimSpace(desc)
	} else if desc, _ := req["paymentDescription"].(string); strings.TrimSpace(desc) != "" {
		chargePayload["description"] = strings.TrimSpace(desc)
	}
	if purpose, _ := req["purpose"].(string); strings.TrimSpace(purpose) != "" {
		chargePayload["purpose"] = strings.TrimSpace(purpose)
	}
	if skipCredit, ok := req["skipWalletCredit"].(bool); ok && skipCredit {
		chargePayload["skipWalletCredit"] = true
	}

	res, err := pc.paymentService.ChargeCardAndCreditWallet(c.Request.Context(), userID, amount, currency, chargePayload)
	if err != nil {
		sendDetailedError(c, http.StatusInternalServerError, "CHARGE_CARD_FAILED", "Card charge failed", err)
		return
	}

	log.Printf("[PaymentController] ChargeCard success - userID=%d txRef=%s", userID, txRef)
	c.JSON(http.StatusOK, res)
}

// AuthorizeCardOTP handles POST /v1/payment/authorize-card-otp
// Accepts: {
//   transactionReference: string,
//   tokenId: string,
//   token: string, (or otp)
//   userId: number,
//   amount: number,
//   currency: string
// }
func (pc *PaymentController) AuthorizeCardOTP(c *gin.Context) {
	log.Printf("[PaymentController] POST /v1/payment/authorize-card-otp")

	var req map[string]interface{}
	if err := c.ShouldBindJSON(&req); err != nil {
		sendDetailedError(c, http.StatusBadRequest, "BAD_REQUEST", "Invalid request payload", err)
		return
	}

	txRef, _ := req["transactionReference"].(string)
	if txRef == "" {
		txRef, _ = req["reference"].(string)
	}
	if txRef == "" {
		sendDetailedError(c, http.StatusBadRequest, "BAD_REQUEST", "transactionReference is required", nil)
		return
	}

	userIDFloat, _ := req["userId"].(float64)
	userID, allowed := resolveAuthorizedUserID(c, int(userIDFloat))
	if !allowed {
		sendDetailedError(c, http.StatusForbidden, "FORBIDDEN", "Cannot charge card for another user", nil)
		return
	}
	if userID <= 0 {
		sendDetailedError(c, http.StatusBadRequest, "BAD_REQUEST", "userId must be a positive integer", nil)
		return
	}

	amount, _ := req["amount"].(float64)
	if amount <= 0 {
		sendDetailedError(c, http.StatusBadRequest, "BAD_REQUEST", "amount must be greater than 0", nil)
		return
	}

	currency, _ := req["currency"].(string)
	if currency == "" {
		currency = "NGN"
	}

	res, err := pc.paymentService.AuthorizeCardOTPAndCreditWallet(c.Request.Context(), userID, amount, currency, req)
	if err != nil {
		sendDetailedError(c, http.StatusBadRequest, "AUTHORIZE_OTP_FAILED", err.Error(), err)
		return
	}

	log.Printf("[PaymentController] AuthorizeCardOTP success - userID=%d txRef=%s", userID, txRef)
	c.JSON(http.StatusOK, res)
}

// QueryTransaction handles GET /v1/payment/query-transaction?transactionReference=...
func (pc *PaymentController) QueryTransaction(c *gin.Context) {
	txRef := c.Query("transactionReference")
	if txRef == "" {
		sendDetailedError(c, http.StatusBadRequest, "BAD_REQUEST", "transactionReference query param is required", nil)
		return
	}

	log.Printf("[PaymentController] GET /v1/payment/query-transaction?transactionReference=%s", txRef)

	res, err := pc.paymentService.QueryTransaction(c.Request.Context(), txRef)
	if err != nil {
		sendDetailedError(c, http.StatusInternalServerError, "QUERY_TRANSACTION_FAILED", "Failed to query transaction", err)
		return
	}

	// Auto-credit wallet if payment is confirmed PAID/SUCCESS and userId is provided or in metadata
	if body, ok := res["responseBody"].(map[string]interface{}); ok && body != nil {
		payStatus, _ := body["paymentStatus"].(string)
		if payStatus == "" {
			payStatus, _ = body["status"].(string)
		}
		if strings.EqualFold(payStatus, "PAID") || strings.EqualFold(payStatus, "SUCCESS") {
			userID := 0
			if uidStr := c.Query("userId"); uidStr != "" {
				fmt.Sscanf(uidStr, "%d", &userID)
			}
			if userID <= 0 {
				if meta, ok := body["metaData"].(map[string]interface{}); ok && meta != nil {
					if uidFloat, ok := meta["userId"].(float64); ok {
						userID = int(uidFloat)
					}
				}
			}
			if userID > 0 {
				amountPaid := 0.0
				if amtFloat, ok := body["amountPaid"].(float64); ok {
					amountPaid = amtFloat
				} else if amtStr, ok := body["amountPaid"].(string); ok {
					fmt.Sscanf(amtStr, "%f", &amountPaid)
				}
				currency, _ := body["currency"].(string)
				if currency == "" {
					currency = "NGN"
				}
				if amountPaid > 0 {
					log.Printf("[PaymentController] Confirmed PAID query for txRef=%s: ensuring wallet credit for userID=%d amount=%.2f", txRef, userID, amountPaid)
					if _, creditErr := pc.paymentService.CreditUserWallet(c.Request.Context(), userID, amountPaid, txRef, "card", currency); creditErr != nil {
						log.Printf("[PaymentController] WARNING: QueryTransaction auto-credit failed: %v", creditErr)
					}
				}
			}
		}
	}

	log.Printf("[PaymentController] QueryTransaction result: %+v", res)
	c.JSON(http.StatusOK, res)
}

// InitPaymentByTransfer handles POST /v1/payment/init-payment-by-transfer
func (pc *PaymentController) InitPaymentByTransfer(c *gin.Context) {
	var req map[string]interface{}
	if err := c.ShouldBindJSON(&req); err != nil {
		sendDetailedError(c, http.StatusBadRequest, "BAD_REQUEST", "Invalid request payload", err)
		return
	}

	res, err := pc.paymentService.InitPaymentByTransfer(c.Request.Context(), req)
	if err != nil {
		sendDetailedError(c, http.StatusInternalServerError, "INIT_TRANSFER_FAILED", err.Error(), err)
		return
	}

	c.JSON(http.StatusOK, res)
}

// GetProcessors handles GET /v1/payment/processors
func (pc *PaymentController) GetProcessors(c *gin.Context) {
	processors, err := pc.paymentService.GetAllPaymentProcessors(c.Request.Context())
	if err != nil {
		sendDetailedError(c, http.StatusInternalServerError, "FETCH_PROCESSORS_FAILED", "Failed to fetch payment processors", err)
		return
	}
	c.JSON(http.StatusOK, processors)
}

// ToggleProcessor handles PATCH /v1/payment/processors/:id/toggle
func (pc *PaymentController) ToggleProcessor(c *gin.Context) {
	idStr := c.Param("id")
	var id int
	if _, err := fmt.Sscanf(idStr, "%d", &id); err != nil || id <= 0 {
		sendDetailedError(c, http.StatusBadRequest, "BAD_REQUEST", "Invalid processor id", nil)
		return
	}

	processor, err := pc.paymentService.TogglePaymentProcessor(c.Request.Context(), id)
	if err != nil {
		sendDetailedError(c, http.StatusInternalServerError, "TOGGLE_PROCESSOR_FAILED", "Failed to toggle processor", err)
		return
	}
	c.JSON(http.StatusOK, processor)
}

// SimulateAddressDeposit handles POST /v1/payment/simulate-address-deposit
func (pc *PaymentController) SimulateAddressDeposit(c *gin.Context) {
	var req providers.SimulateAddressDepositRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.SendError(c, http.StatusBadRequest, "BAD_REQUEST", "invalid request payload")
		return
	}

	res, err := pc.paymentService.SimulateAddressDeposit(c.Request.Context(), req)
	if err != nil {
		utils.SendError(c, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", err.Error())
		return
	}

	utils.Success(c, http.StatusOK, "Address deposit simulated successfully", res)
}

// GetRates handles GET /v1/payment/rates
func (pc *PaymentController) GetRates(c *gin.Context) {
	rates, err := pc.paymentService.GetExchangeRates(c.Request.Context())
	if err != nil {
		utils.SendError(c, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", err.Error())
		return
	}
	c.JSON(http.StatusOK, rates)
}

// ConvertCurrency handles GET and POST /v1/payment/convert
func (pc *PaymentController) ConvertCurrency(c *gin.Context) {
	amount := 1.0
	fromCurrency := "NGN"
	toCurrency := "USDT"

	if c.Request.Method == http.MethodPost {
		var req map[string]interface{}
		if err := c.ShouldBindJSON(&req); err == nil {
			if a, ok := req["amount"].(float64); ok {
				amount = a
			}
			if f, ok := req["fromCurrency"].(string); ok && f != "" {
				fromCurrency = f
			}
			if t, ok := req["targetCurrency"].(string); ok && t != "" {
				toCurrency = t
			} else if t2, ok := req["toCurrency"].(string); ok && t2 != "" {
				toCurrency = t2
			}
		}
	} else {
		amountStr := c.Query("amount")
		if amountStr != "" {
			fmt.Sscanf(amountStr, "%f", &amount)
		}
		if f := c.Query("fromCurrency"); f != "" {
			fromCurrency = f
		} else if f2 := c.Query("from"); f2 != "" {
			fromCurrency = f2
		}
		if t := c.Query("targetCurrency"); t != "" {
			toCurrency = t
		} else if t2 := c.Query("toCurrency"); t2 != "" {
			toCurrency = t2
		} else if t3 := c.Query("to"); t3 != "" {
			toCurrency = t3
		}
	}

	ratesData, err := pc.paymentService.GetExchangeRates(c.Request.Context())
	if err != nil {
		utils.SendError(c, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", err.Error())
		return
	}

	ratesMap, _ := ratesData["rates"].(map[string]float64)
	pricesMap, _ := ratesData["pricesInNgn"].(map[string]float64)

	toRate := ratesMap[strings.ToUpper(toCurrency)]
	if toRate == 0 {
		toRate = 1.0 / 1500.0
	}
	convertedAmount := amount * toRate

	c.JSON(http.StatusOK, map[string]interface{}{
		"success":           true,
		"requestSuccessful": true,
		"amount":            amount,
		"fromCurrency":      fromCurrency,
		"toCurrency":        toCurrency,
		"rate":              toRate,
		"priceInNgn":        pricesMap[strings.ToUpper(toCurrency)],
		"convertedAmount":   convertedAmount,
		"timestamp":         time.Now().Format(time.RFC3339),
	})
}

// GetUserWalletBalance handles GET /v1/payment/user-wallet-balance?userId=...
func (pc *PaymentController) GetUserWalletBalance(c *gin.Context) {
	userIdStr := c.Query("userId")
	if userIdStr == "" {
		utils.SendError(c, http.StatusBadRequest, "BAD_REQUEST", "missing userId")
		return
	}

	userId := 0
	fmt.Sscanf(userIdStr, "%d", &userId)

	wallet, err := pc.paymentService.GetWalletByUserID(c.Request.Context(), userId)
	if err != nil {
		utils.SendError(c, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", err.Error())
		return
	}

	utils.Success(c, http.StatusOK, "Wallet balance success", map[string]interface{}{
		"responseBody": wallet,
	})
}

// GetPaymentHistory handles GET /v1/payment/payments/history?userId=...
func (pc *PaymentController) GetPaymentHistory(c *gin.Context) {
	userIdStr := c.Query("userId")
	if userIdStr == "" {
		utils.SendError(c, http.StatusBadRequest, "BAD_REQUEST", "missing userId")
		return
	}
	userId := 0
	fmt.Sscanf(userIdStr, "%d", &userId)

	history, err := pc.paymentService.GetPaymentHistoryByUserID(c.Request.Context(), userId)
	if err != nil {
		utils.SendError(c, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", err.Error())
		return
	}

	utils.Success(c, http.StatusOK, "Payment history fetched", map[string]interface{}{
		"responseBody": history,
	})
}

// TransferBetweenWallets handles POST /v1/payment/trf-btw-wallets/:userId
// Accepts body: { amount: number, fromAccountType: "savings" | "checking" }
func (pc *PaymentController) TransferBetweenWallets(c *gin.Context) {
	userIdStr := c.Param("userId")
	userId := 0
	fmt.Sscanf(userIdStr, "%d", &userId)
	if userId <= 0 {
		sendDetailedError(c, http.StatusBadRequest, "BAD_REQUEST", "invalid or missing userId in URL path", nil)
		return
	}

	var req map[string]interface{}
	if err := c.ShouldBindJSON(&req); err != nil {
		sendDetailedError(c, http.StatusBadRequest, "BAD_REQUEST", "invalid request payload", err)
		return
	}

	amount := 0.0
	switch v := req["amount"].(type) {
	case float64:
		amount = v
	case int:
		amount = float64(v)
	case string:
		fmt.Sscanf(v, "%f", &amount)
	}

	if amount <= 0 {
		sendDetailedError(c, http.StatusBadRequest, "BAD_REQUEST", "amount must be greater than 0", nil)
		return
	}

	fromAccountType, _ := req["fromAccountType"].(string)
	if fromAccountType == "" {
		sendDetailedError(c, http.StatusBadRequest, "BAD_REQUEST", "fromAccountType is required ('savings' or 'checking')", nil)
		return
	}

	log.Printf("[PaymentController] TransferBetweenWallets - userId=%d amount=%.2f fromAccountType=%s", userId, amount, fromAccountType)

	wallet, err := pc.paymentService.TransferBetweenWallets(c.Request.Context(), userId, amount, fromAccountType)
	if err != nil {
		sendDetailedError(c, http.StatusBadRequest, "TRANSFER_FAILED", err.Error(), err)
		return
	}

	log.Printf("[PaymentController] TransferBetweenWallets success - userId=%d newChecking=%.2f newSavings=%.2f", userId, wallet.CheckingBalance, wallet.SavingsBalance)

	c.JSON(http.StatusOK, map[string]interface{}{
		"requestSuccessful": true,
		"responseCode":      "0",
		"responseMessage":   "Transfer completed successfully",
		"responseBody": map[string]interface{}{
			"userId":          userId,
			"status":          "SUCCESS",
			"amount":          amount,
			"fromAccountType": fromAccountType,
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
	})
}

// GetBanks handles GET /v1/payment/banks
func (pc *PaymentController) GetBanks(c *gin.Context) {
	banks, err := pc.paymentService.GetBanks(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusOK, providers.DefaultNigerianBanks())
		return
	}
	c.JSON(http.StatusOK, banks)
}

// ValidateBankAccount handles GET /v1/payment/banks/validate?accountNumber=...&bankCode=...
func (pc *PaymentController) ValidateBankAccount(c *gin.Context) {
	accNum := c.Query("accountNumber")
	bankCode := c.Query("bankCode")
	if accNum == "" || bankCode == "" {
		sendDetailedError(c, http.StatusBadRequest, "BAD_REQUEST", "accountNumber and bankCode are required query parameters", nil)
		return
	}

	res, err := pc.paymentService.ValidateBankAccount(c.Request.Context(), accNum, bankCode)
	if err != nil {
		sendDetailedError(c, http.StatusInternalServerError, "VALIDATE_ACCOUNT_FAILED", "Failed to validate bank account", err)
		return
	}

	c.JSON(http.StatusOK, res)
}

// WalletWithdrawal handles POST /v1/payment/wallet-withdrawal
func (pc *PaymentController) WalletWithdrawal(c *gin.Context) {
	var req map[string]interface{}
	if err := c.ShouldBindJSON(&req); err != nil {
		sendDetailedError(c, http.StatusBadRequest, "BAD_REQUEST", "Invalid request payload", err)
		return
	}

	amount := 0.0
	switch v := req["amount"].(type) {
	case float64:
		amount = v
	case int:
		amount = float64(v)
	case string:
		fmt.Sscanf(v, "%f", &amount)
	}

	if amount <= 0 {
		sendDetailedError(c, http.StatusBadRequest, "BAD_REQUEST", "amount must be greater than 0", nil)
		return
	}

	userId := 0
	if uid, ok := req["userId"].(float64); ok {
		userId = int(uid)
	} else if uidStr, ok := req["userId"].(string); ok {
		fmt.Sscanf(uidStr, "%d", &userId)
	}
	if userId <= 0 {
		fmt.Sscanf(c.Query("userId"), "%d", &userId)
	}

	log.Printf("[PaymentController] WalletWithdrawal - userId=%d amount=%.2f req=%+v", userId, amount, req)

	res, err := pc.paymentService.ProcessWalletWithdrawal(c.Request.Context(), userId, amount, req)
	if err != nil {
		sendDetailedError(c, http.StatusBadRequest, "WITHDRAWAL_FAILED", err.Error(), err)
		return
	}

	c.JSON(http.StatusOK, res)
}

// DebitWallet handles POST /v1/payment/debit
// Debits a user's wallet for ad campaigns, subscriptions, or fees.
func (pc *PaymentController) DebitWallet(c *gin.Context) {
	var req map[string]interface{}
	if err := c.ShouldBindJSON(&req); err != nil {
		sendDetailedError(c, http.StatusBadRequest, "BAD_REQUEST", "Invalid request payload", err)
		return
	}

	amount := 0.0
	switch v := req["amount"].(type) {
	case float64:
		amount = v
	case int:
		amount = float64(v)
	case string:
		fmt.Sscanf(v, "%f", &amount)
	}

	if amount <= 0 {
		sendDetailedError(c, http.StatusBadRequest, "BAD_REQUEST", "amount must be greater than 0", nil)
		return
	}

	userId := 0
	if uid, ok := req["userId"].(float64); ok {
		userId = int(uid)
	} else if uidStr, ok := req["userId"].(string); ok {
		fmt.Sscanf(uidStr, "%d", &userId)
	}
	if userId <= 0 {
		fmt.Sscanf(c.Query("userId"), "%d", &userId)
	}
	var allowed bool
	userId, allowed = resolveAuthorizedUserID(c, userId)
	if !allowed {
		sendDetailedError(c, http.StatusForbidden, "FORBIDDEN", "Cannot debit another user's wallet", nil)
		return
	}
	if userId <= 0 {
		sendDetailedError(c, http.StatusBadRequest, "BAD_REQUEST", "userId must be a positive integer", nil)
		return
	}

	description, _ := req["description"].(string)
	if description == "" {
		description = "Ad Fee Wallet Debit"
	}

	txRef, _ := req["reference"].(string)
	if txRef == "" {
		txRef = fmt.Sprintf("DEBIT-ADS-%d", time.Now().UnixNano())
	}

	log.Printf("[PaymentController] DebitWallet - userId=%d amount=%.2f desc=%s ref=%s", userId, amount, description, txRef)

	res, err := pc.paymentService.DebitUserWallet(c.Request.Context(), userId, amount, description, txRef)
	if err != nil {
		sendDetailedError(c, http.StatusBadRequest, "DEBIT_FAILED", err.Error(), err)
		return
	}

	c.JSON(http.StatusOK, map[string]interface{}{
		"requestSuccessful": true,
		"responseCode":      "0",
		"responseMessage":   "Wallet debited successfully",
		"responseBody":      res,
	})
}

// ValidateOTP handles POST /v1/payment/validate-otp
func (pc *PaymentController) ValidateOTP(c *gin.Context) {
	var req map[string]interface{}
	if err := c.ShouldBindJSON(&req); err != nil {
		sendDetailedError(c, http.StatusBadRequest, "BAD_REQUEST", "Invalid request payload", err)
		return
	}

	// If tokenId or transactionReference is provided, route to card OTP authorization
	_, hasTokenId := req["tokenId"]
	_, hasTxRef := req["transactionReference"]
	if hasTokenId || hasTxRef {
		userIDFloat, _ := req["userId"].(float64)
		userID := int(userIDFloat)
		amount, _ := req["amount"].(float64)
		currency, _ := req["currency"].(string)
		if currency == "" {
			currency = "NGN"
		}
		if userID > 0 && amount > 0 {
			res, err := pc.paymentService.AuthorizeCardOTPAndCreditWallet(c.Request.Context(), userID, amount, currency, req)
			if err != nil {
				sendDetailedError(c, http.StatusBadRequest, "AUTHORIZE_OTP_FAILED", err.Error(), err)
				return
			}
			c.JSON(http.StatusOK, res)
			return
		}
	}

	ref, _ := req["reference"].(string)
	authCode, _ := req["authorizationCode"].(string)
	if ref == "" || authCode == "" {
		sendDetailedError(c, http.StatusBadRequest, "BAD_REQUEST", "reference and authorizationCode are required", nil)
		return
	}

	res, err := pc.paymentService.ValidateWithdrawalOTP(c.Request.Context(), ref, authCode)
	if err != nil {
		sendDetailedError(c, http.StatusInternalServerError, "VALIDATE_OTP_FAILED", err.Error(), err)
		return
	}

	c.JSON(http.StatusOK, res)
}

// CreateUserWithdrawalBank handles POST /v1/payment/create-withdrawal-bank
func (pc *PaymentController) CreateUserWithdrawalBank(c *gin.Context) {
	var req struct {
		UserID        int    `json:"userId"`
		AccountName   string `json:"accountName"`
		AccountNumber string `json:"accountNumber"`
		BankName      string `json:"bankName"`
		BankCode      string `json:"bankCode"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		sendDetailedError(c, http.StatusBadRequest, "BAD_REQUEST", "Invalid request payload", err)
		return
	}

	if req.UserID <= 0 {
		fmt.Sscanf(c.Query("userId"), "%d", &req.UserID)
	}

	log.Printf("[PaymentController] CreateUserWithdrawalBank - userId=%d bankName=%s accNum=%s", req.UserID, req.BankName, req.AccountNumber)

	bank, err := pc.paymentService.CreateUserWithdrawalBank(c.Request.Context(), req.UserID, req.AccountName, req.AccountNumber, req.BankName, req.BankCode)
	if err != nil {
		sendDetailedError(c, http.StatusInternalServerError, "CREATE_BANK_FAILED", err.Error(), err)
		return
	}

	c.JSON(http.StatusOK, map[string]interface{}{
		"requestSuccessful": true,
		"responseCode":      "0",
		"responseMessage":   "Bank account saved successfully",
		"id":                bank.ID,
		"accountName":       bank.AccountName,
		"accountNumber":     bank.AccountNumber,
		"bankName":          bank.BankName,
		"bankCode":          bank.BankCode,
		"data":              bank,
	})
}

// GetUserWithdrawalBanks handles GET /v1/payment/user-withdrawal-banks
func (pc *PaymentController) GetUserWithdrawalBanks(c *gin.Context) {
	userIdStr := c.Param("userId")
	if userIdStr == "" {
		userIdStr = c.Query("userId")
	}
	userId := 0
	fmt.Sscanf(userIdStr, "%d", &userId)
	if userId <= 0 {
		sendDetailedError(c, http.StatusBadRequest, "BAD_REQUEST", "invalid or missing userId", nil)
		return
	}

	banks, err := pc.paymentService.GetUserWithdrawalBanks(c.Request.Context(), userId)
	if err != nil {
		sendDetailedError(c, http.StatusInternalServerError, "FETCH_BANKS_FAILED", err.Error(), err)
		return
	}

	c.JSON(http.StatusOK, banks)
}

// CreateUserWithdrawalWallet handles POST /v1/payment/connect-withdrawal-wallet
func (pc *PaymentController) CreateUserWithdrawalWallet(c *gin.Context) {
	var req struct {
		UserID        int    `json:"userId"`
		WalletAddress string `json:"walletAddress"`
		Symbol        string `json:"symbol"`
		Network       string `json:"network"`
		RecipientID   string `json:"recipientId"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		sendDetailedError(c, http.StatusBadRequest, "BAD_REQUEST", "Invalid request payload", err)
		return
	}

	if req.UserID <= 0 {
		fmt.Sscanf(c.Query("userId"), "%d", &req.UserID)
	}

	wallet, err := pc.paymentService.CreateUserWithdrawalWallet(c.Request.Context(), req.UserID, req.WalletAddress, req.Symbol, req.Network, req.RecipientID)
	if err != nil {
		sendDetailedError(c, http.StatusInternalServerError, "CREATE_WALLET_FAILED", err.Error(), err)
		return
	}

	c.JSON(http.StatusOK, map[string]interface{}{
		"requestSuccessful": true,
		"responseCode":      "0",
		"responseMessage":   "Crypto wallet saved successfully",
		"data":              wallet,
	})
}

// GetUserWithdrawalWallets handles GET /v1/payment/user-withdrawal-wallets/:userId
func (pc *PaymentController) GetUserWithdrawalWallets(c *gin.Context) {
	userIdStr := c.Param("userId")
	if userIdStr == "" {
		userIdStr = c.Query("userId")
	}
	userId := 0
	fmt.Sscanf(userIdStr, "%d", &userId)
	if userId <= 0 {
		sendDetailedError(c, http.StatusBadRequest, "BAD_REQUEST", "invalid or missing userId", nil)
		return
	}

	wallets, err := pc.paymentService.GetUserWithdrawalWallets(c.Request.Context(), userId)
	if err != nil {
		sendDetailedError(c, http.StatusInternalServerError, "FETCH_WALLETS_FAILED", err.Error(), err)
		return
	}

	c.JSON(http.StatusOK, wallets)
}



