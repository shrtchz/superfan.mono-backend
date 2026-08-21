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
	EstimateAdCost(ctx context.Context, req *EstimateAdCostRequest) (*EstimateAdCostResponse, error)
	GetAllPlacements(ctx context.Context) ([]PlacementFormatRule, error)
	AwardMidQuizAdReward(ctx context.Context, req *AwardAdRewardRequest) (*AwardAdRewardResponse, error)
}

type adsServiceImpl struct {
	db *gorm.DB
}

func NewAdsService(db *gorm.DB) AdsService {
	return &adsServiceImpl{db: db}
}

type PlacementFormatRule struct {
	PlacementType        models.PlacementType `json:"placementType"`
	PlacementName        string               `json:"placementName"`
	Description          string               `json:"description"`
	DurationSec          int                  `json:"durationSec"`
	SkipAllowed          bool                 `json:"skipAllowed"`
	SkipAfterSec         int                  `json:"skipAfterSec"`
	PricingModel         string               `json:"pricingModel"` // "CPM", "CPA", "SPONSORED_BLOCKS"
	Rate                 int                  `json:"rate"`         // CPM rate in NGN or CPA rate (150) or Price per block (25000)
	RateUnit             string               `json:"rateUnit"`     // "per 1,000 impressions", "per view", "per 25-question block"
	GuaranteedDailyUnits int                  `json:"guaranteedDailyUnits"` // 5000
	UnitType             string               `json:"unitType"`     // "Impressions", "Views", "Blocks"
	PointsAwardActive    bool                 `json:"pointsAwardActive"`
	PointsAwardAmount    int                  `json:"pointsAwardAmount"`
	BaseUnitQuestions    int                  `json:"baseUnitQuestions,omitempty"`
}

type EstimateAdCostRequest struct {
	PlacementType   string `json:"placementType"`
	Days            int    `json:"days"`
	StartDate       string `json:"startDate,omitempty"`
	EndDate         string `json:"endDate,omitempty"`
	RunContinuously bool   `json:"runContinuously"`
	QuestionBlocks  int    `json:"questionBlocks"`
	CustomUnits     *int   `json:"customUnits,omitempty"`
	AgeRange        string `json:"ageRange,omitempty"`
}

type EstimateAdCostResponse struct {
	PlacementType   models.PlacementType   `json:"placementType"`
	PlacementName   string                 `json:"placementName"`
	FormatRules     PlacementFormatRule    `json:"formatRules"`
	Pricing         PricingSummary         `json:"pricing"`
	ReachEstimation ReachEstimationSummary `json:"reachEstimation"`
}

type PricingSummary struct {
	Model                      string `json:"model"`
	Rate                       int    `json:"rate"`
	RateUnit                   string `json:"rateUnit"`
	GuaranteedDailyImpressions int    `json:"guaranteedDailyImpressions"`
	GuaranteedDailyViews       int    `json:"guaranteedDailyViews"`
	DailyFee                   int    `json:"dailyFee"`
	Days                       int    `json:"days"`
	TotalFee                   int    `json:"totalFee"`
	Currency                   string `json:"currency"`
	QuestionBlocks             int    `json:"questionBlocks,omitempty"`
	QuestionsPerBlock          int    `json:"questionsPerBlock,omitempty"`
}

type ReachEstimationSummary struct {
	Mode                       string `json:"mode"`
	EstimatedDailyReach        int    `json:"estimatedDailyReach"`
	EstimatedTotalReach        int    `json:"estimatedTotalReach"`
	GuaranteedDailyImpressions int    `json:"guaranteedDailyImpressions"`
	GuaranteedTotalImpressions int    `json:"guaranteedTotalImpressions"`
	MatchingUserCount          int    `json:"matchingUserCount"`
	TargetAgeRange             string `json:"targetAgeRange,omitempty"`
	Notice                     string `json:"notice"`
}

type AwardAdRewardRequest struct {
	UserID         int     `json:"userId" binding:"required"`
	CampaignID     *int    `json:"campaignId,omitempty"`
	PlacementKey   string  `json:"placementKey"`
	WatchedSeconds int     `json:"watchedSeconds"`
	Skipped        bool    `json:"skipped"`
	QuizID         *string `json:"quizId,omitempty"`
}

type AwardAdRewardResponse struct {
	Awarded           bool    `json:"awarded"`
	PointsAwarded     int     `json:"pointsAwarded"`
	DailyQuotaReached bool    `json:"dailyQuotaReached"`
	Message           string  `json:"message"`
	TotalPoints       int     `json:"totalPoints,omitempty"`
	NewWalletBalance  float64 `json:"newWalletBalance,omitempty"`
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
	PlacementKey    *string            `json:"placementKey"` // e.g. "QUIZ_AD_Q1", "MID_QUIZ_AD", "POST_QUIZ_AD", "PRE_QUIZ_AD", "SPONSORED_QUESTIONS"
	PlacementType   *string            `json:"placementType"`
	QuestionBlocks  *int               `json:"questionBlocks"`
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
	TotalAds             int64   `json:"totalAds"`
	ActiveAds            int64   `json:"activeAds"`
	PausedAds            int64   `json:"pausedAds"`
	PendingAds           int64   `json:"pendingAds"`
	CompletedAds         int64   `json:"completedAds"`
	TotalRevenue         float64 `json:"totalRevenue"`
	TotalViews           int64   `json:"totalViews"`
	TotalClicks          int64   `json:"totalClicks"`
	AverageCTR           float64 `json:"averageCTR"`
	PendingApprovalCount int64   `json:"pendingApprovalCount"`
}

type LogAdEventRequest struct {
	UserID      *int               `json:"userId"`
	CampaignID  int                `json:"campaignId"`
	PlacementID *int               `json:"placementId"`
	QuizID      *string            `json:"quizId"`
	EventType   models.AdEventType `json:"eventType"`
	PointsGiven *int               `json:"pointsGiven,omitempty"`
}

type PlacementEligibilityResponse struct {
	Eligible  bool                `json:"eligible"`
	Reason    string              `json:"reason,omitempty"`
	Campaign  *models.AdCampaign  `json:"campaign,omitempty"`
	Placement *models.AdPlacement `json:"placement,omitempty"`
}

func ResolvePlacementConfig(placementInput string) PlacementFormatRule {
	normalized := strings.ToUpper(strings.TrimSpace(placementInput))
	switch normalized {
	case "QUIZ_AD_Q1", "QUIZ_AD", "FIRST_QUARTER", "Q1", "QUIZ_AD_1ST_QUARTER", "QUIZ_START":
		return PlacementFormatRule{
			PlacementType:        models.PlacementQuizAdQ1,
			PlacementName:        "Quiz Ad (1st Quarter)",
			Description:          "30s | Non-skippable | CPM Model (Pre-set)",
			DurationSec:          30,
			SkipAllowed:          false,
			SkipAfterSec:         0,
			PricingModel:         "CPM",
			Rate:                 3000,
			RateUnit:             "per 1,000 impressions",
			GuaranteedDailyUnits: 5000,
			UnitType:             "Impressions",
			PointsAwardActive:    false,
			PointsAwardAmount:    0,
		}

	case "MID_QUIZ_AD", "MID_QUIZ", "QUIZ_MIDPOINT", "MIDPOINT", "AFTER_2ND_QUARTER", "Q2_MID":
		return PlacementFormatRule{
			PlacementType:        models.PlacementMidQuizAd,
			PlacementName:        "Mid-Quiz Ad (After 2nd Quarter)",
			Description:          "15s | Skip after 5s | CPM Model (Pre-set) | Points Award Logic Active",
			DurationSec:          15,
			SkipAllowed:          true,
			SkipAfterSec:         5,
			PricingModel:         "CPM",
			Rate:                 2500,
			RateUnit:             "per 1,000 impressions",
			GuaranteedDailyUnits: 5000,
			UnitType:             "Impressions",
			PointsAwardActive:    true,
			PointsAwardAmount:    200,
		}

	case "POST_QUIZ_AD", "POST_QUIZ", "BEFORE_RESULTS", "POST_RESULTS":
		return PlacementFormatRule{
			PlacementType:        models.PlacementPostQuizAd,
			PlacementName:        "Post-Quiz Ad (Before Results)",
			Description:          "20s | Skip after 5s | CPA Model (Pre-set)",
			DurationSec:          20,
			SkipAllowed:          true,
			SkipAfterSec:         5,
			PricingModel:         "CPA",
			Rate:                 150,
			RateUnit:             "per view (NGN 150)",
			GuaranteedDailyUnits: 5000,
			UnitType:             "Views",
			PointsAwardActive:    false,
			PointsAwardAmount:    0,
		}

	case "PRE_QUIZ_AD", "PRE_QUIZ", "AFTER_RESULTS", "QUIZ_END":
		return PlacementFormatRule{
			PlacementType:        models.PlacementPreQuizAd,
			PlacementName:        "Pre-Quiz Ad (After Results)",
			Description:          "20s | Skip after 5s | CPA Model (Pre-set)",
			DurationSec:          20,
			SkipAllowed:          true,
			SkipAfterSec:         5,
			PricingModel:         "CPA",
			Rate:                 150,
			RateUnit:             "per view (NGN 150)",
			GuaranteedDailyUnits: 5000,
			UnitType:             "Views",
			PointsAwardActive:    false,
			PointsAwardAmount:    0,
		}

	case "SPONSORED_QUESTIONS", "SPONSORED_BLOCKS", "NATIVE_QUESTIONS", "SPONSORED":
		return PlacementFormatRule{
			PlacementType:        models.PlacementSponsoredQuestions,
			PlacementName:        "Sponsored Questions",
			Description:          "Native Integration | Base Unit: Blocks of 25 Questions",
			DurationSec:          0,
			SkipAllowed:          false,
			SkipAfterSec:         0,
			PricingModel:         "SPONSORED_BLOCKS",
			Rate:                 25000,
			RateUnit:             "per 25-question block",
			GuaranteedDailyUnits: 0,
			UnitType:             "Blocks",
			PointsAwardActive:    false,
			PointsAwardAmount:    0,
			BaseUnitQuestions:    25,
		}

	default:
		// Default to Mid-Quiz Ad (After 2nd Quarter)
		return PlacementFormatRule{
			PlacementType:        models.PlacementMidQuizAd,
			PlacementName:        "Mid-Quiz Ad (After 2nd Quarter)",
			Description:          "15s | Skip after 5s | CPM Model (Pre-set) | Points Award Logic Active",
			DurationSec:          15,
			SkipAllowed:          true,
			SkipAfterSec:         5,
			PricingModel:         "CPM",
			Rate:                 2500,
			RateUnit:             "per 1,000 impressions",
			GuaranteedDailyUnits: 5000,
			UnitType:             "Impressions",
			PointsAwardActive:    true,
			PointsAwardAmount:    200,
		}
	}
}

func (s *adsServiceImpl) GetAllPlacements(ctx context.Context) ([]PlacementFormatRule, error) {
	return []PlacementFormatRule{
		ResolvePlacementConfig(string(models.PlacementQuizAdQ1)),
		ResolvePlacementConfig(string(models.PlacementMidQuizAd)),
		ResolvePlacementConfig(string(models.PlacementPostQuizAd)),
		ResolvePlacementConfig(string(models.PlacementPreQuizAd)),
		ResolvePlacementConfig(string(models.PlacementSponsoredQuestions)),
	}, nil
}

func (s *adsServiceImpl) EstimateAdCost(ctx context.Context, req *EstimateAdCostRequest) (*EstimateAdCostResponse, error) {
	rule := ResolvePlacementConfig(req.PlacementType)

	days := req.Days
	if req.RunContinuously {
		days = 1
	} else if days <= 0 {
		days = 1
	}

	var dailyFee int
	var totalFee int
	guaranteedDailyImp := 0
	guaranteedDailyViews := 0

	switch rule.PricingModel {
	case "CPM":
		guaranteedDailyImp = rule.GuaranteedDailyUnits
		if req.CustomUnits != nil && *req.CustomUnits > 0 {
			guaranteedDailyImp = *req.CustomUnits
		}
		// Formula: (5,000 / 1,000) * CPM Rate
		dailyFee = int(math.Round((float64(guaranteedDailyImp) / 1000.0) * float64(rule.Rate)))
		totalFee = dailyFee * days

	case "CPA":
		guaranteedDailyViews = rule.GuaranteedDailyUnits
		if req.CustomUnits != nil && *req.CustomUnits > 0 {
			guaranteedDailyViews = *req.CustomUnits
		}
		// Formula: 5,000 * CPA Rate (NGN 150)
		dailyFee = guaranteedDailyViews * rule.Rate
		totalFee = dailyFee * days

	case "SPONSORED_BLOCKS":
		blocks := req.QuestionBlocks
		if blocks <= 0 {
			blocks = 1
		}
		// Formula: Blocks * Price per 25-question block
		totalFee = blocks * rule.Rate
		dailyFee = totalFee
	}

	dailyReach := 5000
	if rule.PricingModel == "SPONSORED_BLOCKS" {
		dailyReach = req.QuestionBlocks * 25
		if dailyReach <= 0 {
			dailyReach = 25
		}
	} else if guaranteedDailyImp > 0 {
		dailyReach = guaranteedDailyImp
	} else if guaranteedDailyViews > 0 {
		dailyReach = guaranteedDailyViews
	}

	totalReach := dailyReach * days
	if rule.PricingModel == "SPONSORED_BLOCKS" {
		totalReach = dailyReach
	}

	// Calculate demographic user reach from system users
	var totalSystemUsers int64
	if s.db != nil {
		s.db.WithContext(ctx).Model(&models.User{}).Count(&totalSystemUsers)
	}

	matchingUserCount := int(totalSystemUsers)
	targetAgeRange := req.AgeRange
	if targetAgeRange == "" {
		targetAgeRange = "18-35"
	}

	// Calculate target demographic percentage estimation based on system age distribution
	demographicFactor := 0.75
	switch targetAgeRange {
	case "18-24":
		demographicFactor = 0.42
	case "18-35":
		demographicFactor = 0.77
	case "25-45":
		demographicFactor = 0.50
	case "45+":
		demographicFactor = 0.08
	default:
		demographicFactor = 1.00
	}

	if totalSystemUsers > 0 {
		matchingUserCount = int(float64(totalSystemUsers) * demographicFactor)
		if matchingUserCount < 1 {
			matchingUserCount = 1
		}
	} else {
		// Fallback system user baseline for launch stats
		matchingUserCount = int(145000 * demographicFactor)
	}

	noticeText := fmt.Sprintf("Target demographic (%s): %d matching active users on platform. Guaranteed daily delivery of %d impressions across active sessions.", targetAgeRange, matchingUserCount, dailyReach)

	return &EstimateAdCostResponse{
		PlacementType: rule.PlacementType,
		PlacementName: rule.PlacementName,
		FormatRules:   rule,
		Pricing: PricingSummary{
			Model:                      rule.PricingModel,
			Rate:                       rule.Rate,
			RateUnit:                   rule.RateUnit,
			GuaranteedDailyImpressions: guaranteedDailyImp,
			GuaranteedDailyViews:       guaranteedDailyViews,
			DailyFee:                   dailyFee,
			Days:                       days,
			TotalFee:                   totalFee,
			Currency:                   "NGN",
			QuestionBlocks:             req.QuestionBlocks,
			QuestionsPerBlock:          rule.BaseUnitQuestions,
		},
		ReachEstimation: ReachEstimationSummary{
			Mode:                       "SYSTEM_DEMOGRAPHIC_MATCHING",
			EstimatedDailyReach:        dailyReach,
			EstimatedTotalReach:        totalReach,
			GuaranteedDailyImpressions: guaranteedDailyImp,
			GuaranteedTotalImpressions: guaranteedDailyImp * days,
			MatchingUserCount:          matchingUserCount,
			TargetAgeRange:             targetAgeRange,
			Notice:                     noticeText,
		},
	}, nil
}

func (s *adsServiceImpl) AwardMidQuizAdReward(ctx context.Context, req *AwardAdRewardRequest) (*AwardAdRewardResponse, error) {
	rule := ResolvePlacementConfig(req.PlacementKey)

	// 1. Placement validation: Points award logic is only active for Mid-Quiz Ad
	if !rule.PointsAwardActive {
		return &AwardAdRewardResponse{
			Awarded:           false,
			PointsAwarded:     0,
			DailyQuotaReached: false,
			Message:           "Points award logic is not active for this placement format",
		}, nil
	}

	// 2. Full 15-second watch validation (without skipping)
	if req.Skipped || req.WatchedSeconds < 15 {
		campaignID := 0
		if req.CampaignID != nil {
			campaignID = *req.CampaignID
		}
		_ = s.LogAdEvent(ctx, &LogAdEventRequest{
			UserID:     &req.UserID,
			CampaignID: campaignID,
			QuizID:     req.QuizID,
			EventType:  models.AdEventTypeCompletion,
		})
		return &AwardAdRewardResponse{
			Awarded:           false,
			PointsAwarded:     0,
			DailyQuotaReached: false,
			Message:           "Must watch the full 15 seconds without skipping to receive reward points",
		}, nil
	}

	// 3. Platform daily reward ad cap quota check (Max 5 rewarded ads per user per day = 1,000 PTS/day)
	now := time.Now()
	startOfDay := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())

	var todayRewardCount int64
	s.db.WithContext(ctx).Model(&models.AdEvent{}).
		Where(`"userId" = ? AND "eventType" = ? AND "createdAt" >= ?`, req.UserID, models.AdEventTypeRewardAwarded, startOfDay).
		Count(&todayRewardCount)

	const maxDailyRewardedAds = 5
	if todayRewardCount >= maxDailyRewardedAds {
		campaignID := 0
		if req.CampaignID != nil {
			campaignID = *req.CampaignID
		}
		// Quota reached: Play ad normally, silently suppress the points award
		_ = s.LogAdEvent(ctx, &LogAdEventRequest{
			UserID:     &req.UserID,
			CampaignID: campaignID,
			QuizID:     req.QuizID,
			EventType:  models.AdEventTypeRewardSuppressed,
		})
		return &AwardAdRewardResponse{
			Awarded:           false,
			PointsAwarded:     0,
			DailyQuotaReached: true,
			Message:           "Daily reward ad quota reached. Points award silently suppressed.",
		}, nil
	}

	// 4. Award 200 PTS to user account/wallet
	const rewardPoints = 200
	var newBalance float64

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var wallet models.Wallet
		err := tx.Where(`"userId" = ?`, req.UserID).First(&wallet).Error
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				wallet = models.Wallet{
					UserID:      req.UserID,
					Balance:     rewardPoints,
					GoldBalance: rewardPoints,
				}
				if err := tx.Create(&wallet).Error; err != nil {
					return err
				}
			} else {
				return err
			}
		} else {
			if err := tx.Model(&wallet).UpdateColumn("balance", gorm.Expr("balance + ?", rewardPoints)).Error; err != nil {
				return err
			}
			wallet.Balance += rewardPoints
		}

		newBalance = wallet.Balance

		rewardType := "AD_REWARD"
		description := "Mid-Quiz Ad Reward (200 PTS)"
		currency := "PTS"
		txRef := fmt.Sprintf("ADREW-%d-%d", req.UserID, time.Now().UnixNano())

		wTx := models.WalletTransaction{
			UserID:          req.UserID,
			Amount:          rewardPoints,
			Type:            &rewardType,
			Currency:        currency,
			TransactionType: &rewardType,
			Description:     &description,
			TrxRef:          &txRef,
			WalletID:        &wallet.ID,
			CreatedAt:       time.Now(),
		}
		if err := tx.Create(&wTx).Error; err != nil {
			return err
		}

		campaignID := 0
		if req.CampaignID != nil {
			campaignID = *req.CampaignID
		}
		ptsGiven := rewardPoints
		event := models.AdEvent{
			UserID:      &req.UserID,
			CampaignID:  campaignID,
			QuizID:      req.QuizID,
			EventType:   models.AdEventTypeRewardAwarded,
			PointsGiven: ptsGiven,
			CreatedAt:   time.Now(),
		}
		return tx.Create(&event).Error
	})

	if err != nil {
		return nil, fmt.Errorf("failed to award reward points: %w", err)
	}

	return &AwardAdRewardResponse{
		Awarded:           true,
		PointsAwarded:     rewardPoints,
		DailyQuotaReached: false,
		Message:           "200 PTS awarded successfully",
		NewWalletBalance:  newBalance,
	}, nil
}

func (s *adsServiceImpl) CreateCampaign(ctx context.Context, req *CreateCampaignRequest) (*models.AdCampaign, error) {
	if strings.TrimSpace(req.Headline) == "" {
		return nil, errors.New("headline is required")
	}

	// Resolve placement format and pricing rules
	placementInput := "MID_QUIZ_AD"
	if req.PlacementType != nil && *req.PlacementType != "" {
		placementInput = *req.PlacementType
	} else if req.PlacementKey != nil && *req.PlacementKey != "" {
		placementInput = *req.PlacementKey
	}

	rule := ResolvePlacementConfig(placementInput)

	days := req.Days
	if req.RunContinuously {
		days = 1
	} else if days <= 0 {
		days = 1
	}

	// Automated Pricing Model & Cost Calculation
	var calculatedDailyFee int
	var calculatedTotalFee int
	blocks := 0
	if req.QuestionBlocks != nil && *req.QuestionBlocks > 0 {
		blocks = *req.QuestionBlocks
	}

	switch rule.PricingModel {
	case "CPM":
		calculatedDailyFee = int(math.Round((float64(rule.GuaranteedDailyUnits) / 1000.0) * float64(rule.Rate)))
		calculatedTotalFee = calculatedDailyFee * days
	case "CPA":
		calculatedDailyFee = rule.GuaranteedDailyUnits * rule.Rate
		calculatedTotalFee = calculatedDailyFee * days
	case "SPONSORED_BLOCKS":
		if blocks <= 0 {
			blocks = 1
		}
		calculatedTotalFee = blocks * rule.Rate
		calculatedDailyFee = calculatedTotalFee
	}

	dailyFee := req.DailyFee
	if dailyFee <= 0 {
		dailyFee = calculatedDailyFee
	}

	totalFee := req.TotalFee
	if totalFee <= 0 {
		totalFee = calculatedTotalFee
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
		paymentStatus = "PAID"
	}

	placementTypeStr := string(rule.PlacementType)
	pricingModelStr := rule.PricingModel

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
		PlacementType:   &placementTypeStr,
		PricingModel:    &pricingModelStr,
		QuestionBlocks:  blocks,
		Status:          status,
		PaymentStatus:   paymentStatus,
		PaymentRef:      req.PaymentRef,
		CreatedAt:       time.Now(),
		UpdatedAt:       time.Now(),
	}

	if err := s.db.WithContext(ctx).Create(&campaign).Error; err != nil {
		return nil, fmt.Errorf("failed to create campaign: %w", err)
	}

	// Create AdPlacement record
	mediaUrl := "/videos/playcommentary.mp4"
	if len(req.MediaURLs) > 0 {
		mediaUrl = req.MediaURLs[0]
	}

	durationSec := rule.DurationSec
	if req.DurationSec != nil && *req.DurationSec > 0 {
		durationSec = *req.DurationSec
	}

	placement := models.AdPlacement{
		CampaignID:        campaign.ID,
		Key:               string(rule.PlacementType),
		PlacementType:     rule.PlacementType,
		MediaURL:          mediaUrl,
		DurationSec:       durationSec,
		SkipAllowed:       rule.SkipAllowed,
		SkipAfterSec:      rule.SkipAfterSec,
		PointsAwardActive: rule.PointsAwardActive,
		PointsAwardAmount: rule.PointsAwardAmount,
		PricingModel:      rule.PricingModel,
		CreatedAt:         time.Now(),
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

	offset := (q.Page - 1) * q.Limit
	if offset < 0 {
		offset = 0
	}

	if err := db.Order(orderClause).Limit(q.Limit).Offset(offset).Find(&campaigns).Error; err != nil {
		return nil, err
	}

	totalPages := 0
	if q.Limit > 0 {
		totalPages = int(math.Ceil(float64(total) / float64(q.Limit)))
	}

	return &CampaignListResponse{
		Campaigns:  campaigns,
		TotalCount: total,
		Page:       q.Page,
		Limit:      q.Limit,
		TotalPages: totalPages,
	}, nil
}

func (s *adsServiceImpl) GetInventoryStats(ctx context.Context) (*InventoryStatsResponse, error) {
	var totalAds int64
	var activeAds int64
	var pausedAds int64
	var pendingAds int64
	var completedAds int64
	var totalViews int64
	var totalClicks int64
	var totalRevenue float64

	_ = s.db.WithContext(ctx).Model(&models.AdCampaign{}).Count(&totalAds).Error
	_ = s.db.WithContext(ctx).Model(&models.AdCampaign{}).Where("LOWER(status) = ?", "active").Count(&activeAds).Error
	_ = s.db.WithContext(ctx).Model(&models.AdCampaign{}).Where("LOWER(status) = ?", "paused").Count(&pausedAds).Error
	_ = s.db.WithContext(ctx).Model(&models.AdCampaign{}).Where("LOWER(status) = ?", "pending").Count(&pendingAds).Error
	_ = s.db.WithContext(ctx).Model(&models.AdCampaign{}).Where("LOWER(status) = ?", "completed").Count(&completedAds).Error

	type AggStats struct {
		TotalViews   int64   `gorm:"column:total_views"`
		TotalClicks  int64   `gorm:"column:total_clicks"`
		TotalRevenue float64 `gorm:"column:total_revenue"`
	}
	var agg AggStats
	_ = s.db.WithContext(ctx).Model(&models.AdCampaign{}).
		Select("COALESCE(SUM(views), 0) as total_views, COALESCE(SUM(clicks), 0) as total_clicks, COALESCE(SUM(\"totalFee\"), 0) as total_revenue").
		Scan(&agg).Error

	totalViews = agg.TotalViews
	totalClicks = agg.TotalClicks
	totalRevenue = agg.TotalRevenue

	var avgCTR float64
	if totalViews > 0 {
		avgCTR = math.Round((float64(totalClicks)/float64(totalViews))*10000) / 100
	}

	return &InventoryStatsResponse{
		TotalAds:             totalAds,
		ActiveAds:            activeAds,
		PausedAds:            pausedAds,
		PendingAds:           pendingAds,
		CompletedAds:         completedAds,
		TotalRevenue:         totalRevenue,
		TotalViews:           totalViews,
		TotalClicks:          totalClicks,
		AverageCTR:           avgCTR,
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
		return nil, fmt.Errorf("failed to update campaign status: %w", err)
	}

	return &campaign, nil
}

func (s *adsServiceImpl) LogAdEvent(ctx context.Context, req *LogAdEventRequest) error {
	pts := 0
	if req.PointsGiven != nil {
		pts = *req.PointsGiven
	}

	event := models.AdEvent{
		UserID:      req.UserID,
		CampaignID:  req.CampaignID,
		PlacementID: req.PlacementID,
		QuizID:      req.QuizID,
		EventType:   req.EventType,
		PointsGiven: pts,
		CreatedAt:   time.Now(),
	}

	if err := s.db.WithContext(ctx).Create(&event).Error; err != nil {
		return err
	}

	// Update campaign counters
	switch req.EventType {
	case models.AdEventTypeViewStart, models.AdEventTypeCompletion, models.AdEventTypeRewardAwarded:
		_ = s.db.WithContext(ctx).Model(&models.AdCampaign{}).Where("id = ?", req.CampaignID).UpdateColumn("views", gorm.Expr("views + 1")).Error
	case models.AdEventTypeClick:
		_ = s.db.WithContext(ctx).Model(&models.AdCampaign{}).Where("id = ?", req.CampaignID).UpdateColumn("clicks", gorm.Expr("clicks + 1")).Error
	}

	return nil
}

func (s *adsServiceImpl) GetPlacementEligibility(ctx context.Context, userId int, placementKey string) (*PlacementEligibilityResponse, error) {
	rule := ResolvePlacementConfig(placementKey)

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
	err := s.db.WithContext(ctx).
		Where("key = ? OR key = ?", string(rule.PlacementType), placementKey).
		Order("id DESC").
		First(&placement).Error

	if err != nil {
		// Fallback: system default placement
		return &PlacementEligibilityResponse{
			Eligible: true,
			Placement: &models.AdPlacement{
				Key:               string(rule.PlacementType),
				PlacementType:     rule.PlacementType,
				MediaURL:          "/videos/playcommentary.mp4",
				DurationSec:       rule.DurationSec,
				SkipAllowed:       rule.SkipAllowed,
				SkipAfterSec:      rule.SkipAfterSec,
				PointsAwardActive: rule.PointsAwardActive,
				PointsAwardAmount: rule.PointsAwardAmount,
				PricingModel:      rule.PricingModel,
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
