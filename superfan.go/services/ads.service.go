package services

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/lib/pq"
	"gorm.io/gorm"
	"quiz.superfan.com/apis/models"
)

type AdsService interface {
	CreateCampaign(ctx context.Context, req *CreateCampaignRequest) (*models.AdCampaign, error)
	GetCampaigns(ctx context.Context, query *CampaignListQuery) (*CampaignListResponse, error)
	GetInventoryStats(ctx context.Context) (*InventoryStatsResponse, error)
	UpdateCampaignStatus(ctx context.Context, id int, status models.AdStatus) (*models.AdCampaign, error)
	LogAdEvent(ctx context.Context, req *LogAdEventRequest) error
	GetPlacementEligibility(ctx context.Context, userId int, placementKey string) (*PlacementEligibilityResponse, error)
}

type adsServiceImpl struct {
	db *gorm.DB
}

func NewAdsService(db *gorm.DB) AdsService {
	return &adsServiceImpl{db: db}
}

type CreateCampaignRequest struct {
	UserID          *int               `json:"userId"`
	Username        *string            `json:"username"`
	Headline        string             `json:"headline"`
	Description     *string            `json:"description"`
	ButtonLabel     *string            `json:"buttonLabel"`
	WebsiteURL      *string            `json:"websiteUrl"`
	MediaURLs       []string           `json:"mediaUrls"`
	MediaType       *string            `json:"mediaType"`
	DailyFee        int                `json:"dailyFee"`
	TotalFee        int                `json:"totalFee"`
	Days            int                `json:"days"`
	StartDate       string             `json:"startDate"`
	StartTime       string             `json:"startTime"`
	EndDate         *string            `json:"endDate"`
	RunContinuously bool               `json:"runContinuously"`
	AgeRange        *string            `json:"ageRange"`
	PaymentMethod   *string            `json:"paymentMethod"`
	PaymentRef      *string            `json:"paymentRef"`
	PlacementKey    *string            `json:"placementKey"` // e.g. "QUIZ_MIDPOINT"
	DurationSec     *int               `json:"durationSec"`
}

type CampaignListQuery struct {
	Page    int    `form:"page,default=1"`
	Limit   int    `form:"limit,default=10"`
	Status  string `form:"status"`
	Search  string `form:"search"`
	SortBy  string `form:"sortBy,default=createdAt"`
	SortDir string `form:"sortDir,default=desc"`
}

type CampaignListResponse struct {
	Campaigns  []models.AdCampaign `json:"campaigns"`
	TotalCount int64               `json:"totalCount"`
	Page       int                 `json:"page"`
	Limit      int                 `json:"limit"`
	TotalPages int                 `json:"totalPages"`
}

type InventoryStatsResponse struct {
	TotalAds            int64   `json:"totalAds"`
	ActiveAds           int64   `json:"activeAds"`
	PausedAds           int64   `json:"pausedAds"`
	PendingAds          int64   `json:"pendingAds"`
	CompletedAds        int64   `json:"completedAds"`
	TotalRevenue        float64 `json:"totalRevenue"`
	TotalViews          int64   `json:"totalViews"`
	TotalClicks         int64   `json:"totalClicks"`
	AverageCTR          float64 `json:"averageCTR"`
	PendingApprovalCount int64  `json:"pendingApprovalCount"`
}

type LogAdEventRequest struct {
	UserID      *int               `json:"userId"`
	CampaignID  int                `json:"campaignId"`
	PlacementID *int               `json:"placementId"`
	QuizID      *string            `json:"quizId"`
	EventType   models.AdEventType `json:"eventType"`
}

type PlacementEligibilityResponse struct {
	Eligible    bool                `json:"eligible"`
	Reason      string              `json:"reason,omitempty"`
	Campaign    *models.AdCampaign  `json:"campaign,omitempty"`
	Placement   *models.AdPlacement `json:"placement,omitempty"`
}

func (s *adsServiceImpl) CreateCampaign(ctx context.Context, req *CreateCampaignRequest) (*models.AdCampaign, error) {
	if strings.TrimSpace(req.Headline) == "" {
		return nil, errors.New("headline is required")
	}

	dailyFee := req.DailyFee
	if dailyFee <= 0 {
		dailyFee = 500
	}

	days := req.Days
	if req.RunContinuously {
		days = 1
	} else if days <= 0 {
		days = 7
	}

	totalFee := req.TotalFee
	if totalFee <= 0 {
		totalFee = days * dailyFee
	}

	parsedStart, err := time.Parse("2006-01-02", req.StartDate)
	if err != nil {
		parsedStart = time.Now()
	}

	var parsedEnd *time.Time
	if !req.RunContinuously && req.EndDate != nil && *req.EndDate != "" {
		pe, err := time.Parse("2006-01-02", *req.EndDate)
		if err == nil {
			parsedEnd = &pe
		}
	}

	status := models.AdStatusActive
	paymentStatus := "PAID"
	if req.PaymentRef == nil || *req.PaymentRef == "" {
		// When initiated from admin without direct reference, set active for demo/admin creation
		paymentStatus = "PAID"
	}

	campaign := models.AdCampaign{
		UserID:          req.UserID,
		Username:        req.Username,
		Headline:        req.Headline,
		Description:     req.Description,
		ButtonLabel:     req.ButtonLabel,
		WebsiteURL:      req.WebsiteURL,
		MediaURLs:       pq.StringArray(req.MediaURLs),
		MediaType:       req.MediaType,
		DailyFee:        dailyFee,
		TotalFee:        totalFee,
		Days:            days,
		StartDate:       parsedStart,
		EndDate:         parsedEnd,
		RunContinuously: req.RunContinuously,
		AgeRange:        req.AgeRange,
		Status:          status,
		PaymentStatus:   paymentStatus,
		PaymentRef:      req.PaymentRef,
		CreatedAt:       time.Now(),
		UpdatedAt:       time.Now(),
	}

	if err := s.db.WithContext(ctx).Create(&campaign).Error; err != nil {
		return nil, fmt.Errorf("failed to create campaign: %w", err)
	}

	// Create default placement if media is provided
	placementKey := "QUIZ_MIDPOINT"
	if req.PlacementKey != nil && *req.PlacementKey != "" {
		placementKey = *req.PlacementKey
	}

	mediaUrl := "/videos/playcommentary.mp4"
	if len(req.MediaURLs) > 0 {
		mediaUrl = req.MediaURLs[0]
	}

	durationSec := 30
	if req.DurationSec != nil && *req.DurationSec > 0 {
		durationSec = *req.DurationSec
	}

	placement := models.AdPlacement{
		CampaignID:  campaign.ID,
		Key:         placementKey,
		MediaURL:    mediaUrl,
		DurationSec: durationSec,
		SkipAllowed: false,
		CreatedAt:   time.Now(),
	}
	_ = s.db.WithContext(ctx).Create(&placement).Error

	return &campaign, nil
}

func (s *adsServiceImpl) GetCampaigns(ctx context.Context, q *CampaignListQuery) (*CampaignListResponse, error) {
	var campaigns []models.AdCampaign
	var total int64

	db := s.db.WithContext(ctx).Model(&models.AdCampaign{})

	if q.Status != "" && q.Status != "all" {
		db = db.Where("LOWER(status) = ?", strings.ToLower(q.Status))
	}

	if q.Search != "" {
		searchPattern := "%" + strings.ToLower(q.Search) + "%"
		db = db.Where("LOWER(headline) LIKE ? OR LOWER(username) LIKE ?", searchPattern, searchPattern)
	}

	if err := db.Count(&total).Error; err != nil {
		return nil, err
	}

	orderClause := `"createdAt" DESC, id DESC`
	if q.SortBy != "" && q.SortBy != "createdAt" && q.SortBy != "dataCreated" && q.SortBy != "id" {
		dir := "DESC"
		if strings.ToLower(q.SortDir) == "asc" {
			dir = "ASC"
		}
		switch q.SortBy {
		case "username":
			orderClause = "username " + dir
		case "headline", "video":
			orderClause = "headline " + dir
		case "startDate":
			orderClause = `"startDate" ` + dir
		case "endDate":
			orderClause = `"endDate" ` + dir
		case "totalFee", "cost":
			orderClause = `"totalFee" ` + dir
		case "views", "view":
			orderClause = "views " + dir
		case "clicks":
			orderClause = "clicks " + dir
		case "status":
			orderClause = "status " + dir
		default:
			orderClause = `"createdAt" ` + dir + `, id ` + dir
		}
	} else if q.SortBy == "createdAt" || q.SortBy == "dataCreated" {
		dir := "DESC"
		if strings.ToLower(q.SortDir) == "asc" {
			dir = "ASC"
		}
		orderClause = `"createdAt" ` + dir + `, id ` + dir
	}

	limit := q.Limit
	if limit <= 0 {
		limit = 10
	}
	page := q.Page
	if page <= 0 {
		page = 1
	}
	offset := (page - 1) * limit

	if err := db.Order(orderClause).Offset(offset).Limit(limit).Preload("Placements").Find(&campaigns).Error; err != nil {
		return nil, err
	}

	totalPages := int(math.Ceil(float64(total) / float64(limit)))

	return &CampaignListResponse{
		Campaigns:  campaigns,
		TotalCount: total,
		Page:       page,
		Limit:      limit,
		TotalPages: totalPages,
	}, nil
}

func (s *adsServiceImpl) GetInventoryStats(ctx context.Context) (*InventoryStatsResponse, error) {
	var totalAds, activeAds, pausedAds, pendingAds, completedAds, totalViews, totalClicks int64
	var totalRevenue float64

	s.db.WithContext(ctx).Model(&models.AdCampaign{}).Count(&totalAds)
	s.db.WithContext(ctx).Model(&models.AdCampaign{}).Where("status = ?", models.AdStatusActive).Count(&activeAds)
	s.db.WithContext(ctx).Model(&models.AdCampaign{}).Where("status = ?", models.AdStatusPaused).Count(&pausedAds)
	s.db.WithContext(ctx).Model(&models.AdCampaign{}).Where("status = ?", models.AdStatusPending).Count(&pendingAds)
	s.db.WithContext(ctx).Model(&models.AdCampaign{}).Where("status = ?", models.AdStatusCompleted).Count(&completedAds)

	row := s.db.WithContext(ctx).Model(&models.AdCampaign{}).Select("COALESCE(SUM(totalFee), 0) as revenue, COALESCE(SUM(views), 0) as views, COALESCE(SUM(clicks), 0) as clicks").Row()
	_ = row.Scan(&totalRevenue, &totalViews, &totalClicks)

	avgCTR := 0.0
	if totalViews > 0 {
		avgCTR = (float64(totalClicks) / float64(totalViews)) * 100.0
	}

	return &InventoryStatsResponse{
		TotalAds:            totalAds,
		ActiveAds:           activeAds,
		PausedAds:           pausedAds,
		PendingAds:          pendingAds,
		CompletedAds:        completedAds,
		TotalRevenue:        totalRevenue,
		TotalViews:          totalViews,
		TotalClicks:         totalClicks,
		AverageCTR:          math.Round(avgCTR*10) / 10,
		PendingApprovalCount: pendingAds,
	}, nil
}

func (s *adsServiceImpl) UpdateCampaignStatus(ctx context.Context, id int, status models.AdStatus) (*models.AdCampaign, error) {
	var campaign models.AdCampaign
	if err := s.db.WithContext(ctx).First(&campaign, id).Error; err != nil {
		return nil, fmt.Errorf("campaign not found: %w", err)
	}

	campaign.Status = status
	campaign.UpdatedAt = time.Now()

	if err := s.db.WithContext(ctx).Save(&campaign).Error; err != nil {
		return nil, err
	}

	return &campaign, nil
}

func (s *adsServiceImpl) LogAdEvent(ctx context.Context, req *LogAdEventRequest) error {
	event := models.AdEvent{
		UserID:      req.UserID,
		CampaignID:  req.CampaignID,
		PlacementID: req.PlacementID,
		QuizID:      req.QuizID,
		EventType:   req.EventType,
		CreatedAt:   time.Now(),
	}

	if err := s.db.WithContext(ctx).Create(&event).Error; err != nil {
		return err
	}

	// Update campaign counters
	switch req.EventType {
	case models.AdEventTypeViewStart, models.AdEventTypeCompletion:
		_ = s.db.WithContext(ctx).Model(&models.AdCampaign{}).Where("id = ?", req.CampaignID).UpdateColumn("views", gorm.Expr("views + 1")).Error
	case models.AdEventTypeClick:
		_ = s.db.WithContext(ctx).Model(&models.AdCampaign{}).Where("id = ?", req.CampaignID).UpdateColumn("clicks", gorm.Expr("clicks + 1")).Error
	}

	return nil
}

func (s *adsServiceImpl) GetPlacementEligibility(ctx context.Context, userId int, placementKey string) (*PlacementEligibilityResponse, error) {
	// 1. Check user's subscription
	if userId > 0 {
		var user models.User
		err := s.db.WithContext(ctx).Select("id, subscriptionPlan").First(&user, userId).Error
		if err == nil && user.SubscriptionPlan != nil {
			plan := strings.ToUpper(strings.TrimSpace(*user.SubscriptionPlan))
			if plan == "PREMIUM_PRO" || plan == "PREMIUM_PRO_MAX" || plan == "PRO" || plan == "PRO_MAX" {
				return &PlacementEligibilityResponse{
					Eligible: false,
					Reason:   "User subscription plan is ad-free",
				}, nil
			}
		}
	}

	// 2. Find an active ad placement
	var placement models.AdPlacement
	err := s.db.WithContext(ctx).Where("key = ?", placementKey).Order("id DESC").First(&placement).Error
	if err != nil {
		// Fallback: system placement
		return &PlacementEligibilityResponse{
			Eligible: true,
			Placement: &models.AdPlacement{
				Key:         placementKey,
				MediaURL:    "/videos/playcommentary.mp4",
				DurationSec: 30,
				SkipAllowed: false,
			},
		}, nil
	}

	var campaign models.AdCampaign
	_ = s.db.WithContext(ctx).First(&campaign, placement.CampaignID).Error

	return &PlacementEligibilityResponse{
		Eligible:  true,
		Campaign:  &campaign,
		Placement: &placement,
	}, nil
}
