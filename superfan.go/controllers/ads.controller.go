package controllers

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"quiz.superfan.com/apis/middleware"
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

// GetMyCampaigns handles GET /v2/ads/campaigns/mine.
func (ac *AdsController) GetMyCampaigns(c *gin.Context) {
	userIDValue, ok := c.Get(middleware.ContextUserIDKey)
	userID, ok := userIDValue.(int)
	if !ok || userID <= 0 {
		utils.SendError(c, http.StatusUnauthorized, "UNAUTHORIZED", "authenticated user not found")
		return
	}

	var query services.CampaignListQuery
	if err := c.ShouldBindQuery(&query); err != nil {
		utils.SendError(c, http.StatusBadRequest, "BAD_REQUEST", "invalid query parameters")
		return
	}
	query.UserID = &userID

	res, err := ac.adsService.GetCampaigns(c.Request.Context(), &query)
	if err != nil {
		utils.SendError(c, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", err.Error())
		return
	}

	utils.Success(c, http.StatusOK, "User campaigns retrieved successfully", res)
}

// GetMyInsights handles GET /v2/ads/campaigns/mine/insights.
func (ac *AdsController) GetMyInsights(c *gin.Context) {
	userIDValue, ok := c.Get(middleware.ContextUserIDKey)
	userID, ok := userIDValue.(int)
	if !ok || userID <= 0 {
		utils.SendError(c, http.StatusUnauthorized, "UNAUTHORIZED", "authenticated user not found")
		return
	}

	query := &services.AdInsightsQuery{UserID: userID}
	for name, target := range map[string]**time.Time{
		"startDate": &query.StartDate,
		"endDate":   &query.EndDate,
	} {
		value := c.Query(name)
		if value == "" {
			continue
		}
		parsed, err := parseAdDate(value, name == "endDate")
		if err != nil {
			utils.SendError(c, http.StatusBadRequest, "BAD_REQUEST", fmt.Sprintf("invalid %s; use YYYY-MM-DD or RFC3339", name))
			return
		}
		*target = &parsed
	}

	res, err := ac.adsService.GetMyInsights(c.Request.Context(), query)
	if err != nil {
		utils.SendError(c, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	utils.Success(c, http.StatusOK, "Ad insights retrieved successfully", res)
}

func parseAdDate(value string, endOfDay bool) (time.Time, error) {
	if parsed, err := time.Parse(time.RFC3339, value); err == nil {
		return parsed, nil
	}
	parsed, err := time.Parse("2006-01-02", value)
	if err != nil {
		return time.Time{}, err
	}
	if endOfDay {
		return parsed.Add(24*time.Hour - time.Nanosecond), nil
	}
	return parsed, nil
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
		key = "MID_QUIZ_AD"
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

// GetPlacements handles GET /v2/ads/placements
func (ac *AdsController) GetPlacements(c *gin.Context) {
	placements, err := ac.adsService.GetAllPlacements(c.Request.Context())
	if err != nil {
		utils.SendError(c, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", err.Error())
		return
	}

	utils.Success(c, http.StatusOK, "Placements retrieved successfully", placements)
}

// GetRewardAdQuota handles GET /v2/ads/reward-quota
func (ac *AdsController) GetRewardAdQuota(c *gin.Context) {
	userID, err := strconv.Atoi(c.Query("userId"))
	if err != nil || userID <= 0 {
		utils.SendError(c, http.StatusBadRequest, "BAD_REQUEST", "a valid userId is required")
		return
	}

	quota, err := ac.adsService.GetRewardAdQuota(c.Request.Context(), userID)
	if err != nil {
		utils.SendError(c, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", err.Error())
		return
	}

	utils.Success(c, http.StatusOK, "Reward ad quota retrieved successfully", quota)
}

// EstimateAdCost handles POST /v2/ads/estimate
func (ac *AdsController) EstimateAdCost(c *gin.Context) {
	var req services.EstimateAdCostRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.SendError(c, http.StatusBadRequest, "BAD_REQUEST", "invalid estimate payload: "+err.Error())
		return
	}

	estimate, err := ac.adsService.EstimateAdCost(c.Request.Context(), &req)
	if err != nil {
		utils.SendError(c, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", err.Error())
		return
	}

	utils.Success(c, http.StatusOK, "Ad cost and reach estimated successfully", estimate)
}

// AwardMidQuizReward handles POST /v2/ads/reward
func (ac *AdsController) AwardMidQuizReward(c *gin.Context) {
	var req services.AwardAdRewardRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.SendError(c, http.StatusBadRequest, "BAD_REQUEST", "invalid reward request payload: "+err.Error())
		return
	}

	res, err := ac.adsService.AwardMidQuizAdReward(c.Request.Context(), &req)
	if err != nil {
		utils.SendError(c, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", err.Error())
		return
	}

	utils.Success(c, http.StatusOK, res.Message, res)
}

// RegisterAdsRoutes registers all ads routes under a given router group
func RegisterAdsRoutes(rg *gin.RouterGroup, ac *AdsController) {
	adsGroup := rg.Group("/ads")
	{
		adsGroup.GET("/placements", ac.GetPlacements)
		adsGroup.GET("/reward-quota", ac.GetRewardAdQuota)
		adsGroup.POST("/estimate", ac.EstimateAdCost)
		adsGroup.POST("/reward", ac.AwardMidQuizReward)
		adsGroup.POST("/campaigns", ac.CreateCampaign)
		adsGroup.GET("/campaigns", ac.GetCampaigns)
		authenticatedAdsGroup := rg.Group("/ads", middleware.AuthRequired())
		authenticatedAdsGroup.GET("/campaigns/mine", ac.GetMyCampaigns)
		authenticatedAdsGroup.GET("/campaigns/mine/insights", ac.GetMyInsights)
		adsGroup.GET("/inventory/stats", ac.GetInventoryStats)
		adsGroup.PATCH("/campaigns/:id/status", ac.UpdateCampaignStatus)
		adsGroup.POST("/campaigns/:id/approve", ac.ApproveCampaign)
		adsGroup.POST("/campaigns/:id/reject", ac.RejectCampaign)
		adsGroup.POST("/events", ac.LogAdEvent)
		adsGroup.GET("/placement/:key/eligibility", ac.GetPlacementEligibility)
	}
}
