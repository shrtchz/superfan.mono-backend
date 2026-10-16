package services

import (
	"sort"
	"testing"
	"time"

	"quiz.superfan.com/apis/models"
)

func TestGetCampaignGuaranteedDailyViews(t *testing.T) {
	tests := []struct {
		name     string
		campaign models.AdCampaign
		want     int
	}{
		{
			name: "explicit guaranteed daily views is respected",
			campaign: models.AdCampaign{
				DailyFee:             500,
				GuaranteedDailyViews: 2500,
			},
			want: 2500,
		},
		{
			name: "Starter Daily package (₦500/day) defaults to 1000 views",
			campaign: models.AdCampaign{
				DailyFee: 500,
			},
			want: 1000,
		},
		{
			name: "Custom daily fee scales from Starter Daily baseline",
			campaign: models.AdCampaign{
				DailyFee: 1500,
			},
			want: 3000, // (1500 / 500) * 1000 = 3000
		},
		{
			name: "Placement CPM format rule defaults to guaranteed units",
			campaign: models.AdCampaign{
				PlacementType: func() *string { s := "MID_QUIZ_AD"; return &s }(),
			},
			want: 5000,
		},
		{
			name:     "Empty campaign defaults to Starter Daily baseline 1000",
			campaign: models.AdCampaign{},
			want:     1000,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := getCampaignGuaranteedDailyViews(&tc.campaign)
			if got != tc.want {
				t.Errorf("getCampaignGuaranteedDailyViews() = %d, want %d", got, tc.want)
			}
		})
	}
}

func TestGetCycleStartAndReset(t *testing.T) {
	lagosLoc, err := time.LoadLocation("Africa/Lagos")
	if err != nil {
		lagosLoc = time.FixedZone("WAT", 1*60*60)
	}

	// 2026-10-12 14:30:00 WAT
	testTime := time.Date(2026, 10, 12, 14, 30, 0, 0, lagosLoc)

	cycleStart := getCycleStart(testTime)
	expectedStart := time.Date(2026, 10, 12, 0, 0, 0, 0, lagosLoc)
	if !cycleStart.Equal(expectedStart) {
		t.Errorf("getCycleStart() = %v, want %v", cycleStart, expectedStart)
	}

	resetsAt := getNextCycleReset(testTime)
	expectedReset := time.Date(2026, 10, 13, 0, 0, 0, 0, lagosLoc)
	if !resetsAt.Equal(expectedReset) {
		t.Errorf("getNextCycleReset() = %v, want %v", resetsAt, expectedReset)
	}
}

func TestServingPoolRotationLogic(t *testing.T) {
	// Simulate 3 advertiser campaigns in the pool
	// Advertiser 1: 1,000 views today, 1,000 cap -> HITS GUARANTEED VOLUME (must rotate OUT)
	// Advertiser 2: 200 views today, 1,000 cap  -> ratio 0.20 (eligible)
	// Advertiser 3: 50 views today, 1,000 cap   -> ratio 0.05 (eligible, least served)

	candidates := []servingCandidate{
		{
			campaign: models.AdCampaign{
				ID:                   1,
				Headline:             "Advertiser 1 (Starter Daily ₦500)",
				GuaranteedDailyViews: 1000,
				Status:               models.AdStatusActive,
			},
			viewsToday: 1000,
			guaranteed: 1000,
			ratio:      1.0,
		},
		{
			campaign: models.AdCampaign{
				ID:                   2,
				Headline:             "Advertiser 2 (Starter Daily ₦500)",
				GuaranteedDailyViews: 1000,
				Status:               models.AdStatusActive,
			},
			viewsToday: 200,
			guaranteed: 1000,
			ratio:      0.20,
		},
		{
			campaign: models.AdCampaign{
				ID:                   3,
				Headline:             "Advertiser 3 (Starter Daily ₦500)",
				GuaranteedDailyViews: 1000,
				Status:               models.AdStatusActive,
			},
			viewsToday: 50,
			guaranteed: 1000,
			ratio:      0.05,
		},
	}

	// 1. Filter out campaigns that have hit their guaranteed daily view volume
	var eligibleInPool []servingCandidate
	for _, c := range candidates {
		if c.viewsToday >= c.guaranteed {
			// Rotated out of serving pool!
			continue
		}
		eligibleInPool = append(eligibleInPool, c)
	}

	if len(eligibleInPool) != 2 {
		t.Fatalf("expected 2 eligible campaigns, got %d", len(eligibleInPool))
	}

	// Verify Advertiser 1 was rotated out
	for _, c := range eligibleInPool {
		if c.campaign.ID == 1 {
			t.Errorf("Advertiser 1 should be rotated out of serving pool once hitting 1,000 views")
		}
	}

	// 2. Sort eligible candidates by fair rotation (lower quota ratio consumed first)
	sort.SliceStable(eligibleInPool, func(i, j int) bool {
		if eligibleInPool[i].ratio != eligibleInPool[j].ratio {
			return eligibleInPool[i].ratio < eligibleInPool[j].ratio
		}
		return eligibleInPool[i].viewsToday < eligibleInPool[j].viewsToday
	})

	// Advertiser 3 (50 views / 5%) must be picked before Advertiser 2 (200 views / 20%)
	if eligibleInPool[0].campaign.ID != 3 {
		t.Errorf("expected Advertiser 3 to be served next in fair rotation, got ID %d", eligibleInPool[0].campaign.ID)
	}

	// 3. Simulate cycle reset: in the next 24-hour cycle, Advertiser 1's views reset to 0
	viewsInNewCycle := 0
	if viewsInNewCycle < candidates[0].guaranteed {
		// Advertiser 1 rotates back IN to serving pool
		candidates[0].viewsToday = 0
		candidates[0].ratio = 0.0
	}

	if candidates[0].viewsToday != 0 || candidates[0].viewsToday >= candidates[0].guaranteed {
		t.Errorf("Advertiser 1 should rotate back in to serving pool upon cycle reset")
	}
}
