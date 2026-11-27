package controllers

import (
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"quiz.superfan.com/apis/middleware"
	"quiz.superfan.com/apis/models"
	"quiz.superfan.com/apis/services"
	"quiz.superfan.com/apis/utils"
)

type LedgerController struct {
	ledgerService services.LedgerService
}

func NewLedgerController(ls services.LedgerService) *LedgerController {
	return &LedgerController{ledgerService: ls}
}

func resolveLedgerActor(c *gin.Context, fallback string) (string, error) {
	userID := c.GetInt(middleware.ContextUserIDKey)
	if userID <= 0 {
		if c.GetString(middleware.ContextAuthSource) == "internal" || middleware.HasValidInternalServiceKey(c) {
			return strings.TrimSpace(fallback), nil
		}
		return "", errors.New("authenticated user is required")
	}
	if utils.DB == nil {
		if email := strings.TrimSpace(c.GetString(middleware.ContextUserEmailKey)); email != "" {
			return email, nil
		}
		return fmt.Sprintf("user:%d", userID), nil
	}
	var user models.User
	if err := utils.DB.WithContext(c.Request.Context()).Select("id", "username", "email", "firstName", "lastName").First(&user, userID).Error; err != nil {
		if email := strings.TrimSpace(c.GetString(middleware.ContextUserEmailKey)); email != "" {
			return email, nil
		}
		return "", err
	}
	if strings.TrimSpace(user.Email) != "" {
		return strings.TrimSpace(user.Email), nil
	}
	if strings.TrimSpace(user.Username) != "" {
		return strings.TrimSpace(user.Username), nil
	}
	fullName := strings.TrimSpace(strings.TrimSpace(user.FirstName) + " " + strings.TrimSpace(user.LastName))
	if fullName != "" {
		return fullName, nil
	}
	return fmt.Sprintf("user:%d", userID), nil
}

func RegisterLedgerRoutes(router *gin.RouterGroup, lc *LedgerController) {
	ledgerGroup := router.Group("/admin/ledger")
	ledgerGroup.Use(middleware.InternalOrAuthRequired(), middleware.InternalOrAdminRequired())
	{
		ledgerGroup.GET("", lc.GetLedgerEntries)
		ledgerGroup.GET("/summary", lc.GetLedgerSummary)
		ledgerGroup.GET("/reconciliation", lc.GetReconciliation)
		ledgerGroup.GET("/approvals", lc.GetLedgerApprovals)
		ledgerGroup.POST("/approvals", lc.CreateLedgerApproval)
		ledgerGroup.POST("/approvals/:id/approve", lc.ApproveLedgerApproval)
		ledgerGroup.POST("/approvals/:id/reject", lc.RejectLedgerApproval)
		ledgerGroup.GET("/reconciliation/entries", lc.GetLedgerReconciliation)
		ledgerGroup.POST("/reconciliation/resolve", lc.ResolveLedgerReconciliation)
		ledgerGroup.POST("/reconciliation/import", lc.ImportLedgerReconciliation)
		ledgerGroup.GET("/period-close", lc.GetPeriodClose)
		ledgerGroup.POST("/period-close", lc.ClosePeriod)
		ledgerGroup.GET("/period-close/pack", lc.GetPeriodClosePack)
	}
}

type createLedgerApprovalRequest struct {
	Reference     string                      `json:"reference"`
	Kind          string                      `json:"kind"`
	Description   string                      `json:"description"`
	ClientName    string                      `json:"clientName"`
	AccountType   string                      `json:"accountType"`
	Currency      string                      `json:"currency"`
	Reason        string                      `json:"reason"`
	RequestedBy   string                      `json:"requestedBy"`
	ReversalOf    *string                     `json:"reversalOf"`
	CorrectsEntry *string                     `json:"correctsEntry"`
	Lines         []models.LedgerApprovalLine `json:"lines"`
}

type reviewLedgerApprovalRequest struct {
	Reviewer string `json:"reviewer"`
	Note     string `json:"note"`
}

func sendApprovalError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, services.ErrApprovalNotFound):
		utils.SendError(c, http.StatusNotFound, "APPROVAL_NOT_FOUND", err.Error())
	case errors.Is(err, services.ErrApprovalDuplicateRef):
		utils.SendError(c, http.StatusConflict, "APPROVAL_DUPLICATE_REFERENCE", err.Error())
	case errors.Is(err, services.ErrApprovalAlreadyReviewed):
		utils.SendError(c, http.StatusConflict, "APPROVAL_ALREADY_REVIEWED", err.Error())
	case errors.Is(err, services.ErrApprovalSelfReview):
		utils.SendError(c, http.StatusForbidden, "APPROVAL_SELF_REVIEW", err.Error())
	case errors.Is(err, services.ErrApprovalRejectionNeedsWhy), errors.Is(err, services.ErrApprovalInvalid):
		utils.SendError(c, http.StatusBadRequest, "APPROVAL_INVALID", err.Error())
	case errors.Is(err, services.ErrPeriodLocked):
		utils.SendError(c, http.StatusConflict, "PERIOD_LOCKED", err.Error())
	default:
		log.Printf("[LEDGER_ERROR] approval request failed: %v", err)
		utils.SendError(c, http.StatusInternalServerError, "LEDGER_ERROR", "Failed to process approval request")
	}
}

func (lc *LedgerController) GetLedgerApprovals(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "10"))

	approvals, total, err := lc.ledgerService.ListLedgerApprovals(page, limit, c.Query("status"), c.Query("search"))
	if err != nil {
		sendApprovalError(c, err)
		return
	}

	utils.Success(c, http.StatusOK, "Approval requests retrieved successfully", gin.H{
		"approvals": approvals,
		"total":     total,
		"page":      page,
		"limit":     limit,
	})
}

func (lc *LedgerController) CreateLedgerApproval(c *gin.Context) {
	var body createLedgerApprovalRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		utils.SendError(c, http.StatusBadRequest, "INVALID_BODY", "Invalid approval request payload")
		return
	}

	requestedBy, err := resolveLedgerActor(c, body.RequestedBy)
	if err != nil {
		utils.SendError(c, http.StatusUnauthorized, "UNAUTHORIZED", err.Error())
		return
	}

	approval, err := lc.ledgerService.CreateLedgerApproval(services.CreateLedgerApprovalInput{
		Reference:     body.Reference,
		Kind:          body.Kind,
		Description:   body.Description,
		ClientName:    body.ClientName,
		AccountType:   body.AccountType,
		Currency:      body.Currency,
		Reason:        body.Reason,
		RequestedBy:   requestedBy,
		ReversalOf:    body.ReversalOf,
		CorrectsEntry: body.CorrectsEntry,
		Lines:         body.Lines,
	})
	if err != nil {
		sendApprovalError(c, err)
		return
	}

	utils.Success(c, http.StatusCreated, "Approval request sent", approval)
}

func (lc *LedgerController) ApproveLedgerApproval(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		utils.SendError(c, http.StatusBadRequest, "INVALID_ID", "Invalid approval request id")
		return
	}
	var body reviewLedgerApprovalRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		utils.SendError(c, http.StatusBadRequest, "INVALID_BODY", "Invalid approval review payload")
		return
	}

	reviewer, err := resolveLedgerActor(c, body.Reviewer)
	if err != nil {
		utils.SendError(c, http.StatusUnauthorized, "UNAUTHORIZED", err.Error())
		return
	}

	approval, err := lc.ledgerService.ApproveLedgerApproval(uint(id), reviewer, body.Note)
	if err != nil {
		sendApprovalError(c, err)
		return
	}

	utils.Success(c, http.StatusOK, "Approval request approved", approval)
}

func (lc *LedgerController) RejectLedgerApproval(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		utils.SendError(c, http.StatusBadRequest, "INVALID_ID", "Invalid approval request id")
		return
	}
	var body reviewLedgerApprovalRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		utils.SendError(c, http.StatusBadRequest, "INVALID_BODY", "Invalid approval review payload")
		return
	}

	reviewer, err := resolveLedgerActor(c, body.Reviewer)
	if err != nil {
		utils.SendError(c, http.StatusUnauthorized, "UNAUTHORIZED", err.Error())
		return
	}

	approval, err := lc.ledgerService.RejectLedgerApproval(uint(id), reviewer, body.Note)
	if err != nil {
		sendApprovalError(c, err)
		return
	}

	utils.Success(c, http.StatusOK, "Approval request rejected", approval)
}

type resolveReconciliationRequest struct {
	RowKey     string `json:"rowKey"`
	Note       string `json:"note"`
	ResolvedBy string `json:"resolvedBy"`
}

type importReconciliationRequest struct {
	SourceType string                              `json:"sourceType"`
	Source     string                              `json:"source"`
	ImportedBy string                              `json:"importedBy"`
	Rows       []services.ReconciliationImportRow `json:"rows"`
}

func sendReconciliationError(c *gin.Context, err error) {
	if errors.Is(err, services.ErrReconciliationInvalid) {
		utils.SendError(c, http.StatusBadRequest, "RECONCILIATION_INVALID", err.Error())
		return
	}
	log.Printf("[LEDGER_ERROR] reconciliation request failed: %v", err)
	utils.SendError(c, http.StatusInternalServerError, "LEDGER_ERROR", "Failed to process reconciliation request")
}

func (lc *LedgerController) GetLedgerReconciliation(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "25"))

	result, err := lc.ledgerService.ListReconciliation(page, limit, c.Query("status"), c.Query("search"))
	if err != nil {
		sendReconciliationError(c, err)
		return
	}

	utils.Success(c, http.StatusOK, "Reconciliation rows retrieved successfully", result)
}

func (lc *LedgerController) ResolveLedgerReconciliation(c *gin.Context) {
	var body resolveReconciliationRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		utils.SendError(c, http.StatusBadRequest, "INVALID_BODY", "Invalid reconciliation resolution payload")
		return
	}

	resolvedBy, err := resolveLedgerActor(c, body.ResolvedBy)
	if err != nil {
		utils.SendError(c, http.StatusUnauthorized, "UNAUTHORIZED", err.Error())
		return
	}

	resolution, err := lc.ledgerService.ResolveReconciliation(body.RowKey, body.Note, resolvedBy)
	if err != nil {
		sendReconciliationError(c, err)
		return
	}

	utils.Success(c, http.StatusOK, "Reconciliation row resolved", resolution)
}

func (lc *LedgerController) ImportLedgerReconciliation(c *gin.Context) {
	var body importReconciliationRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		utils.SendError(c, http.StatusBadRequest, "INVALID_BODY", "Invalid reconciliation import payload")
		return
	}

	importedBy, err := resolveLedgerActor(c, body.ImportedBy)
	if err != nil {
		utils.SendError(c, http.StatusUnauthorized, "UNAUTHORIZED", err.Error())
		return
	}

	imported, err := lc.ledgerService.ImportReconciliationRows(body.SourceType, body.Source, importedBy, body.Rows)
	if err != nil {
		sendReconciliationError(c, err)
		return
	}

	utils.Success(c, http.StatusCreated, "Statement rows imported", gin.H{"imported": imported})
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

type closePeriodRequest struct {
	Period   string `json:"period"`
	ClosedBy string `json:"closedBy"`
	Note     string `json:"note"`
}

func sendPeriodCloseError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, services.ErrPeriodAlreadyClosed):
		utils.SendError(c, http.StatusConflict, "PERIOD_ALREADY_CLOSED", err.Error())
	case errors.Is(err, services.ErrPeriodCloseBlocked):
		utils.SendError(c, http.StatusConflict, "PERIOD_CLOSE_BLOCKED", err.Error())
	case errors.Is(err, services.ErrPeriodLocked):
		utils.SendError(c, http.StatusConflict, "PERIOD_LOCKED", err.Error())
	case errors.Is(err, services.ErrPeriodInvalid):
		utils.SendError(c, http.StatusBadRequest, "PERIOD_INVALID", err.Error())
	default:
		log.Printf("[LEDGER_ERROR] period close failed: %v", err)
		utils.SendError(c, http.StatusInternalServerError, "PERIOD_CLOSE_ERROR", "Failed to process period close")
	}
}

// GetPeriodClose handles GET /admin/ledger/period-close — close readiness for one month plus closed history.
func (lc *LedgerController) GetPeriodClose(c *gin.Context) {
	report, err := lc.ledgerService.GetPeriodCloseReport(c.Request.Context(), c.Query("period"))
	if err != nil {
		sendPeriodCloseError(c, err)
		return
	}
	periods, err := lc.ledgerService.ListClosedPeriods(c.Request.Context())
	if err != nil {
		sendPeriodCloseError(c, err)
		return
	}

	utils.Success(c, http.StatusOK, "Period close status retrieved successfully", gin.H{
		"report":  report,
		"periods": periods,
	})
}

// ClosePeriod handles POST /admin/ledger/period-close — locks a month once every check passes.
func (lc *LedgerController) ClosePeriod(c *gin.Context) {
	var body closePeriodRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		utils.SendError(c, http.StatusBadRequest, "INVALID_BODY", "Invalid period close payload")
		return
	}

	closedBy, err := resolveLedgerActor(c, body.ClosedBy)
	if err != nil {
		utils.SendError(c, http.StatusUnauthorized, "UNAUTHORIZED", err.Error())
		return
	}

	record, err := lc.ledgerService.ClosePeriod(c.Request.Context(), services.ClosePeriodInput{
		Period:   body.Period,
		ClosedBy: closedBy,
		Note:     body.Note,
	})
	if err != nil {
		sendPeriodCloseError(c, err)
		return
	}

	utils.Success(c, http.StatusCreated, "Accounting period closed", record)
}

// GetPeriodClosePack handles GET /admin/ledger/period-close/pack — JSON audit pack for a month.
func (lc *LedgerController) GetPeriodClosePack(c *gin.Context) {
	report, err := lc.ledgerService.GetPeriodCloseReport(c.Request.Context(), c.Query("period"))
	if err != nil {
		sendPeriodCloseError(c, err)
		return
	}

	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="ledger-close-%s.json"`, report.Period))
	utils.Success(c, http.StatusOK, "Period close pack generated", gin.H{
		"generatedAt": time.Now().UTC().Format(time.RFC3339),
		"report":      report,
	})
}
