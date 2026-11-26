package controllers

import (
	"log"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"quiz.superfan.com/apis/middleware"
	"quiz.superfan.com/apis/services"
	"quiz.superfan.com/apis/utils"
)

type LedgerController struct {
	ledgerService services.LedgerService
}

func NewLedgerController(ls services.LedgerService) *LedgerController {
	return &LedgerController{ledgerService: ls}
}

func RegisterLedgerRoutes(router *gin.RouterGroup, lc *LedgerController) {
	ledgerGroup := router.Group("/admin/ledger")
	ledgerGroup.Use(middleware.InternalOrAuthRequired(), middleware.InternalOrAdminRequired())
	{
		ledgerGroup.GET("", lc.GetLedgerEntries)
		ledgerGroup.GET("/summary", lc.GetLedgerSummary)
		ledgerGroup.GET("/reconciliation", lc.GetReconciliation)
	}
}

func ledgerFilters(c *gin.Context) map[string]interface{} {
	filters := make(map[string]interface{})

	if status := c.Query("status"); status != "" {
		filters["status"] = status
	}
	if statuses := c.Query("statuses"); statuses != "" {
		filters["statuses"] = statuses
	}
	if currency := c.Query("currency"); currency != "" {
		filters["currency"] = currency
	}
	if currencies := c.Query("currencies"); currencies != "" {
		filters["currencies"] = currencies
	}
	if trxType := c.Query("transactionType"); trxType != "" {
		filters["transactionType"] = trxType
	}
	if trxTypes := c.Query("transactionTypes"); trxTypes != "" {
		filters["transactionTypes"] = trxTypes
	}
	if accountType := c.Query("accountType"); accountType != "" {
		filters["accountType"] = accountType
	}
	if accounts := c.Query("accounts"); accounts != "" {
		filters["accounts"] = accounts
	}
	if providers := c.Query("providers"); providers != "" {
		filters["providers"] = providers
	}
	if user := c.Query("user"); user != "" {
		filters["user"] = user
	} else if userId := c.Query("userId"); userId != "" {
		filters["user"] = userId
	}
	if username := c.Query("username"); username != "" {
		filters["username"] = username
	}
	if dateFrom := c.Query("dateFrom"); dateFrom != "" {
		filters["dateFrom"] = dateFrom
	}
	if dateTo := c.Query("dateTo"); dateTo != "" {
		filters["dateTo"] = dateTo
	}
	return filters
}

func (lc *LedgerController) GetLedgerEntries(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	search := c.Query("search")

	entries, total, summary, err := lc.ledgerService.GetLedgerEntries(page, limit, ledgerFilters(c), search)
	if err != nil {
		log.Printf("[LEDGER_ERROR] GetLedgerEntries failed: %v", err)
		utils.SendError(c, http.StatusInternalServerError, "LEDGER_ERROR", "Failed to fetch ledger entries")
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":  "success",
		"message": "Ledger entries retrieved successfully",
		"data": gin.H{
			"entries": entries,
			"total":   total,
			"summary": summary,
			"page":    page,
			"limit":   limit,
		},
	})
}

// GetLedgerSummary handles GET /admin/ledger/summary — aggregate balances for the
// admin ledger dashboard cards, without the paginated journal rows.
func (lc *LedgerController) GetLedgerSummary(c *gin.Context) {
	summary, err := lc.ledgerService.GetLedgerSummary(ledgerFilters(c), c.Query("search"))
	if err != nil {
		log.Printf("[LEDGER_ERROR] GetLedgerSummary failed: %v", err)
		utils.SendError(c, http.StatusInternalServerError, "LEDGER_ERROR", "Failed to fetch ledger summary")
		return
	}

	utils.Success(c, http.StatusOK, "Ledger summary retrieved successfully", summary)
}

// GetReconciliation handles GET /admin/ledger/reconciliation — verifies trial balance and wallet liabilities.
func (lc *LedgerController) GetReconciliation(c *gin.Context) {
	report, err := lc.ledgerService.GetReconciliation(c.Request.Context())
	if err != nil {
		log.Printf("[LEDGER_ERROR] GetReconciliation failed: %v", err)
		utils.SendError(c, http.StatusInternalServerError, "RECONCILIATION_ERROR", "Failed to run ledger reconciliation")
		return
	}

	utils.Success(c, http.StatusOK, "Ledger reconciliation completed", report)
}

// BroadcastLedgerUpdate is a helper to broadcast new transactions to the admin dashboard via WebSockets.
func BroadcastLedgerUpdate(entry interface{}) {
	BroadcastToRoom("admin_ledger", map[string]interface{}{
		"event": "ledger_update",
		"data":  entry,
	})
}
