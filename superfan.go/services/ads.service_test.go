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

	headline := "Test Headline " + time.Now().Format("15:04:05")
	desc := "Test Description"
	btn := "Apply now"
	web := "https://superfan.ng"
	media := []string{"/videos/playcommentary.mp4"}

	req := &services.CreateCampaignRequest{
		Headline:        headline,
		Description:     &desc,
		ButtonLabel:     &btn,
		WebsiteURL:      &web,
		MediaURLs:       media,
		DailyFee:        500,
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

	// Test Log Event
	err = svc.LogAdEvent(ctx, &services.LogAdEventRequest{
		CampaignID: created.ID,
		EventType:  models.AdEventTypeViewStart,
	})
	if err != nil {
		t.Fatalf("LogAdEvent failed: %v", err)
	}

	// Test Eligibility
	eligibility, err := svc.GetPlacementEligibility(ctx, 0, "QUIZ_MIDPOINT")
	if err != nil {
		t.Fatalf("GetPlacementEligibility failed: %v", err)
	}
	if !eligibility.Eligible {
		t.Errorf("expected free/guest user to be eligible")
	}

	// Cleanup test campaign
	db.Where("id = ?", created.ID).Delete(&models.AdCampaign{})
	db.Where("campaignId = ?", created.ID).Delete(&models.AdPlacement{})
	db.Where("campaignId = ?", created.ID).Delete(&models.AdEvent{})
}
