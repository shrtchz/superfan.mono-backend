package controllers

import (
	"log"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
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
	// Protected by auth middleware normally, assuming it's applied to the router group
	ledgerGroup := router.Group("/admin/ledger")
	{
		ledgerGroup.GET("", lc.GetLedgerEntries)
	}
}

func (lc *LedgerController) GetLedgerEntries(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	search := c.Query("search")

	filters := make(map[string]interface{})
	
	if status := c.Query("status"); status != "" {
		filters["status"] = status
	}
	if currency := c.Query("currency"); currency != "" {
		filters["currency"] = currency
	}
	if trxType := c.Query("transactionType"); trxType != "" {
		filters["transactionType"] = trxType
	}
	if userId := c.Query("userId"); userId != "" {
		filters["userId"] = userId
	}
	if username := c.Query("username"); username != "" {
		filters["username"] = username
	}

	entries, total, summary, err := lc.ledgerService.GetLedgerEntries(page, limit, filters, search)
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

// BroadcastLedgerUpdate is a helper to broadcast new transactions to the admin dashboard via WebSockets.
func BroadcastLedgerUpdate(entry interface{}) {
	BroadcastToRoom("admin_ledger", map[string]interface{}{
		"event": "ledger_update",
		"data":  entry,
	})
}
