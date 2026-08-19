package controllers

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"quiz.superfan.com/apis/models"
	"quiz.superfan.com/apis/services"
	"quiz.superfan.com/apis/utils"
)

type AdsController struct {
	adsService services.AdsService
}

func NewAdsController(as services.AdsService) *AdsController {
	return &AdsController{
		adsService: as,
	}
}

// CreateCampaign handles POST /v2/ads/campaigns
func (ac *AdsController) CreateCampaign(c *gin.Context) {
	var req services.CreateCampaignRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.SendError(c, http.StatusBadRequest, "BAD_REQUEST", "invalid request payload: "+err.Error())
		return
	}

	campaign, err := ac.adsService.CreateCampaign(c.Request.Context(), &req)
	if err != nil {
		utils.SendError(c, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", err.Error())
		return
	}

	utils.Success(c, http.StatusCreated, "Campaign created successfully", campaign)
}

// GetCampaigns handles GET /v2/ads/campaigns
func (ac *AdsController) GetCampaigns(c *gin.Context) {
	var query services.CampaignListQuery
	if err := c.ShouldBindQuery(&query); err != nil {
		utils.SendError(c, http.StatusBadRequest, "BAD_REQUEST", "invalid query parameters")
		return
	}

	res, err := ac.adsService.GetCampaigns(c.Request.Context(), &query)
	if err != nil {
		utils.SendError(c, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", err.Error())
		return
	}

	utils.Success(c, http.StatusOK, "Campaigns retrieved successfully", res)
}

// GetInventoryStats handles GET /v2/ads/inventory/stats
func (ac *AdsController) GetInventoryStats(c *gin.Context) {
	res, err := ac.adsService.GetInventoryStats(c.Request.Context())
	if err != nil {
		utils.SendError(c, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", err.Error())
		return
	}

	utils.Success(c, http.StatusOK, "Inventory stats retrieved successfully", res)
}

// UpdateCampaignStatus handles PATCH /v2/ads/campaigns/:id/status
func (ac *AdsController) UpdateCampaignStatus(c *gin.Context) {
	idParam := c.Param("id")
	id, err := strconv.Atoi(idParam)
	if err != nil {
		utils.SendError(c, http.StatusBadRequest, "BAD_REQUEST", "invalid campaign ID")
		return
	}

	var req struct {
		Status models.AdStatus `json:"status" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.SendError(c, http.StatusBadRequest, "BAD_REQUEST", "invalid status payload")
		return
	}

	campaign, err := ac.adsService.UpdateCampaignStatus(c.Request.Context(), id, req.Status)
	if err != nil {
		utils.SendError(c, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", err.Error())
		return
	}

	utils.Success(c, http.StatusOK, "Campaign status updated successfully", campaign)
}

// ApproveCampaign handles POST /v2/ads/campaigns/:id/approve
func (ac *AdsController) ApproveCampaign(c *gin.Context) {
	idParam := c.Param("id")
	id, err := strconv.Atoi(idParam)
	if err != nil {
		utils.SendError(c, http.StatusBadRequest, "BAD_REQUEST", "invalid campaign ID")
		return
	}

	campaign, err := ac.adsService.UpdateCampaignStatus(c.Request.Context(), id, models.AdStatusActive)
	if err != nil {
		utils.SendError(c, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", err.Error())
		return
	}

	utils.Success(c, http.StatusOK, "Campaign approved successfully", campaign)
}

// RejectCampaign handles POST /v2/ads/campaigns/:id/reject
func (ac *AdsController) RejectCampaign(c *gin.Context) {
	idParam := c.Param("id")
	id, err := strconv.Atoi(idParam)
	if err != nil {
		utils.SendError(c, http.StatusBadRequest, "BAD_REQUEST", "invalid campaign ID")
		return
	}

	campaign, err := ac.adsService.UpdateCampaignStatus(c.Request.Context(), id, models.AdStatusPaused)
	if err != nil {
		utils.SendError(c, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", err.Error())
		return
	}

	utils.Success(c, http.StatusOK, "Campaign rejected successfully", campaign)
}

// LogAdEvent handles POST /v2/ads/events
func (ac *AdsController) LogAdEvent(c *gin.Context) {
	var req services.LogAdEventRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.SendError(c, http.StatusBadRequest, "BAD_REQUEST", "invalid event payload")
		return
	}

	if err := ac.adsService.LogAdEvent(c.Request.Context(), &req); err != nil {
		utils.SendError(c, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", err.Error())
		return
	}

	utils.Success(c, http.StatusOK, "Event logged successfully", nil)
}

// GetPlacementEligibility handles GET /v2/ads/placement/:key/eligibility
func (ac *AdsController) GetPlacementEligibility(c *gin.Context) {
	key := c.Param("key")
	if key == "" {
		key = "QUIZ_MIDPOINT"
	}

	userIdStr := c.Query("userId")
	userId := 0
	if userIdStr != "" {
		userId, _ = strconv.Atoi(userIdStr)
	}

	res, err := ac.adsService.GetPlacementEligibility(c.Request.Context(), userId, key)
	if err != nil {
		utils.SendError(c, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", err.Error())
		return
	}

	utils.Success(c, http.StatusOK, "Eligibility determined successfully", res)
}

// RegisterAdsRoutes registers all ads routes under a given router group
func RegisterAdsRoutes(rg *gin.RouterGroup, ac *AdsController) {
	adsGroup := rg.Group("/ads")
	{
		adsGroup.POST("/campaigns", ac.CreateCampaign)
		adsGroup.GET("/campaigns", ac.GetCampaigns)
		adsGroup.GET("/inventory/stats", ac.GetInventoryStats)
		adsGroup.PATCH("/campaigns/:id/status", ac.UpdateCampaignStatus)
		adsGroup.POST("/campaigns/:id/approve", ac.ApproveCampaign)
		adsGroup.POST("/campaigns/:id/reject", ac.RejectCampaign)
		adsGroup.POST("/events", ac.LogAdEvent)
		adsGroup.GET("/placement/:key/eligibility", ac.GetPlacementEligibility)
	}
}
