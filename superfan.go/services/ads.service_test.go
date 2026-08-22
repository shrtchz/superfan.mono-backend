package services_test

import (
	"context"
	"os"
	"testing"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"quiz.superfan.com/apis/models"
	"quiz.superfan.com/apis/services"
	"quiz.superfan.com/apis/utils"
)

func TestAdsService_PricingAndEstimation(t *testing.T) {
	svc := services.NewAdsService(nil)
	ctx := context.Background()

	// 1. Test Quiz Ad Q1 (CPM)
	q1Res, err := svc.EstimateAdCost(ctx, &services.EstimateAdCostRequest{
		PlacementType: "QUIZ_AD_Q1",
		Days:          3,
	})
	if err != nil {
		t.Fatalf("EstimateAdCost failed for QUIZ_AD_Q1: %v", err)
	}
	if q1Res.Pricing.DailyFee != 15000 {
		t.Errorf("expected dailyFee 15000, got %d", q1Res.Pricing.DailyFee)
	}
	if q1Res.Pricing.TotalFee != 45000 {
		t.Errorf("expected totalFee 45000 for 3 days, got %d", q1Res.Pricing.TotalFee)
	}
	if q1Res.FormatRules.DurationSec != 30 || q1Res.FormatRules.SkipAllowed != false {
		t.Errorf("expected 30s non-skippable format for Q1")
	}

	// 2. Test Mid-Quiz Ad (CPM + Points Award)
	midRes, err := svc.EstimateAdCost(ctx, &services.EstimateAdCostRequest{
		PlacementType: "MID_QUIZ_AD",
		Days:          2,
	})
	if err != nil {
		t.Fatalf("EstimateAdCost failed for MID_QUIZ_AD: %v", err)
	}
	if midRes.Pricing.DailyFee != 12500 {
		t.Errorf("expected dailyFee 12500, got %d", midRes.Pricing.DailyFee)
	}
	if midRes.Pricing.TotalFee != 25000 {
		t.Errorf("expected totalFee 25000 for 2 days, got %d", midRes.Pricing.TotalFee)
	}
	if !midRes.FormatRules.PointsAwardActive || midRes.FormatRules.PointsAwardAmount != 200 {
		t.Errorf("expected points award active with 200 PTS for mid-quiz")
	}

	// 3. Test Post-Quiz Ad (CPA - NGN 150/view)
	postRes, err := svc.EstimateAdCost(ctx, &services.EstimateAdCostRequest{
		PlacementType: "POST_QUIZ_AD",
		Days:          1,
	})
	if err != nil {
		t.Fatalf("EstimateAdCost failed for POST_QUIZ_AD: %v", err)
	}
	if postRes.Pricing.DailyFee != 750000 {
		t.Errorf("expected dailyFee 750000 (5000 * 150), got %d", postRes.Pricing.DailyFee)
	}
	if postRes.Pricing.Rate != 150 {
		t.Errorf("expected CPA rate 150, got %d", postRes.Pricing.Rate)
	}

	// 4. Test Sponsored Questions (Blocks of 25)
	sponsRes, err := svc.EstimateAdCost(ctx, &services.EstimateAdCostRequest{
		PlacementType:  "SPONSORED_QUESTIONS",
		QuestionBlocks: 3,
	})
	if err != nil {
		t.Fatalf("EstimateAdCost failed for SPONSORED_QUESTIONS: %v", err)
	}
	if sponsRes.Pricing.TotalFee != 75000 {
		t.Errorf("expected totalFee 75000 (3 * 25000), got %d", sponsRes.Pricing.TotalFee)
	}

	// 5. Test Placements Catalog
	placements, err := svc.GetAllPlacements(ctx)
	if err != nil {
		t.Fatalf("GetAllPlacements failed: %v", err)
	}
	if len(placements) != 5 {
		t.Errorf("expected 5 placements in catalog, got %d", len(placements))
	}
}

func TestAdsService_Integration(t *testing.T) {
	utils.LoadEnv()
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		t.Skip("Skipping DB integration test; DATABASE_URL not set")
	}

	db, err := gorm.Open(postgres.Open(dbURL), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to connect database: %v", err)
	}

	svc := services.NewAdsService(db)
	ctx := context.Background()

	// Ensure DB table schema has latest columns
	_ = db.AutoMigrate(&models.AdCampaign{}, &models.AdPlacement{}, &models.AdEvent{})

	headline := "Test Launch Headline " + time.Now().Format("15:04:05")
	desc := "Test Description"
	btn := "Apply now"
	web := "https://superfan.ng"
	media := []string{"/videos/playcommentary.mp4"}
	placementType := "MID_QUIZ_AD"

	req := &services.CreateCampaignRequest{
		Headline:        headline,
		Description:     &desc,
		ButtonLabel:     &btn,
		WebsiteURL:      &web,
		MediaURLs:       media,
		PlacementType:   &placementType,
		Days:            7,
		StartDate:       time.Now().Format("2006-01-02"),
		RunContinuously: false,
	}

	created, err := svc.CreateCampaign(ctx, req)
	if err != nil {
		t.Fatalf("CreateCampaign failed: %v", err)
	}

	if created.ID == 0 {
		t.Errorf("expected non-zero ID, got %d", created.ID)
	}
	if created.DailyFee <= 0 || created.TotalFee <= 0 {
		t.Errorf("expected automated pricing to calculate daily/total fees, got %d / %d", created.DailyFee, created.TotalFee)
	}

	// Test GetCampaigns
	listRes, err := svc.GetCampaigns(ctx, &services.CampaignListQuery{Page: 1, Limit: 10})
	if err != nil {
		t.Fatalf("GetCampaigns failed: %v", err)
	}
	if listRes.TotalCount <= 0 {
		t.Errorf("expected > 0 campaigns, got %d", listRes.TotalCount)
	}

	// Test Inventory Stats
	stats, err := svc.GetInventoryStats(ctx)
	if err != nil {
		t.Fatalf("GetInventoryStats failed: %v", err)
	}
	if stats.TotalAds <= 0 {
		t.Errorf("expected > 0 total ads, got %d", stats.TotalAds)
	}

	// Test Eligibility
	eligibility, err := svc.GetPlacementEligibility(ctx, 0, "MID_QUIZ_AD")
	if err != nil {
		t.Fatalf("GetPlacementEligibility failed: %v", err)
	}
	if !eligibility.Eligible {
		t.Errorf("expected free/guest user to be eligible")
	}

	// Cleanup test campaign
	db.Where("id = ?", created.ID).Delete(&models.AdCampaign{})
	db.Where(`"campaignId" = ?`, created.ID).Delete(&models.AdPlacement{})
	db.Where(`"campaignId" = ?`, created.ID).Delete(&models.AdEvent{})
}
