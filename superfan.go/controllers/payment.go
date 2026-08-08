package controllers

import (
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
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
	if rawErr != nil && rawErr.Error() != "" {
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

// Webhook handles POST /v1/payment/webhook/:provider
func (pc *PaymentController) Webhook(c *gin.Context) {
	providerParam := c.Param("provider")

	var req providers.VerifyTransactionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.SendError(c, http.StatusBadRequest, "BAD_REQUEST", "invalid request payload")
		return
	}

	var currency string
	switch providerParam {
	case "monnify":
		currency = "NGN"
	case "bitnob":
		currency = "USDC"
	default:
		utils.SendError(c, http.StatusBadRequest, "BAD_REQUEST", "unknown provider webhook")
		return
	}

	err := pc.paymentService.HandleDepositWebhook(c.Request.Context(), currency, req)
	if err != nil {
		utils.SendError(c, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", err.Error())
		return
	}

	utils.Success(c, http.StatusOK, "Webhook processed successfully", nil)
}

func RegisterPaymentRoutes(rg *gin.RouterGroup, pc *PaymentController) {
	paymentGroup := rg.Group("/payment")
	paymentGroup.GET("/wallet-transactions", pc.GetWalletTransactions)
	paymentGroup.POST("/deposit", pc.InitiateDeposit)
	paymentGroup.POST("/initialize-transaction", pc.InitializeTransaction)
	paymentGroup.POST("/init-payment-by-transfer", pc.InitPaymentByTransfer)
	paymentGroup.POST("/charge-card", pc.ChargeCard)
	paymentGroup.GET("/query-transaction", pc.QueryTransaction)
	paymentGroup.POST("/simulate-address-deposit", pc.SimulateAddressDeposit)
	paymentGroup.POST("/webhook/:provider", pc.Webhook)
	paymentGroup.GET("/user-wallet-balance", pc.GetUserWalletBalance)
	paymentGroup.GET("/payments/history", pc.GetPaymentHistory)
	paymentGroup.POST("/trf-btw-wallets/:userId", pc.TransferBetweenWallets)
	paymentGroup.GET("/banks", pc.GetBanks)
	paymentGroup.GET("/banks/validate", pc.ValidateBankAccount)
	paymentGroup.POST("/create-withdrawal-bank", pc.CreateUserWithdrawalBank)
	paymentGroup.GET("/user-withdrawal-banks", pc.GetUserWithdrawalBanks)
	paymentGroup.GET("/user-withdrawal-banks/:userId", pc.GetUserWithdrawalBanks)
	paymentGroup.POST("/connect-withdrawal-wallet", pc.CreateUserWithdrawalWallet)
	paymentGroup.GET("/user-withdrawal-wallets/:userId", pc.GetUserWithdrawalWallets)
	paymentGroup.POST("/wallet-withdrawal", pc.WalletWithdrawal)
	paymentGroup.POST("/validate-otp", pc.ValidateOTP)
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
	userID := int(userIDFloat)
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

	// Pass charge payload (card + txRef) through to service
	chargePayload := map[string]interface{}{
		"transactionReference": txRef,
		"card":                 cardMap,
		"amount":               amount,
	}

	res, err := pc.paymentService.ChargeCardAndCreditWallet(c.Request.Context(), userID, amount, currency, chargePayload)
	if err != nil {
		sendDetailedError(c, http.StatusInternalServerError, "CHARGE_CARD_FAILED", "Card charge failed", err)
		return
	}

	log.Printf("[PaymentController] ChargeCard success - userID=%d txRef=%s", userID, txRef)
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

	txRef, _ := req["transactionReference"].(string)
	if txRef == "" {
		txRef = fmt.Sprintf("MNFY-TRF-%d", time.Now().UnixNano())
	}

	mockAccNumber := fmt.Sprintf("971%d", time.Now().UnixNano()%10000000)
	expiryDate := time.Now().Add(30 * time.Minute).Format(time.RFC3339)

	res := map[string]interface{}{
		"requestSuccessful": true,
		"responseCode":      "0",
		"responseMessage":   "Virtual Account Generated Successfully",
		"responseBody": map[string]interface{}{
			"accountNumber": mockAccNumber,
			"accountName":   "Superfan - User",
			"bankName":      "Moniepoint MFB / Wema Bank",
			"bankCode":      "035",
			"expiresOn":     expiryDate,
			"totalPayable":  1050,
			"fee":           50,
		},
	}

	c.JSON(http.StatusOK, res)
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
// Accepts body: { amount: number, fromAccountType: "gold" | "personal" }
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
		sendDetailedError(c, http.StatusBadRequest, "BAD_REQUEST", "fromAccountType is required ('gold' or 'personal')", nil)
		return
	}

	log.Printf("[PaymentController] TransferBetweenWallets - userId=%d amount=%.2f fromAccountType=%s", userId, amount, fromAccountType)

	wallet, err := pc.paymentService.TransferBetweenWallets(c.Request.Context(), userId, amount, fromAccountType)
	if err != nil {
		sendDetailedError(c, http.StatusBadRequest, "TRANSFER_FAILED", err.Error(), err)
		return
	}

	log.Printf("[PaymentController] TransferBetweenWallets success - userId=%d newPersonal=%.2f newGold=%.2f", userId, wallet.PersonalBalance, wallet.GoldBalance)

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
				"personalBalance": wallet.PersonalBalance,
				"goldBalance":     wallet.GoldBalance,
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

// ValidateOTP handles POST /v1/payment/validate-otp
func (pc *PaymentController) ValidateOTP(c *gin.Context) {
	var req map[string]interface{}
	if err := c.ShouldBindJSON(&req); err != nil {
		sendDetailedError(c, http.StatusBadRequest, "BAD_REQUEST", "Invalid request payload", err)
		return
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



