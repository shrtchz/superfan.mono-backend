package services

import (
	"testing"
	"time"

	"quiz.superfan.com/apis/models"
)

func TestCampaignHasEnded(t *testing.T) {
	startDate := time.Date(2026, 9, 30, 0, 0, 0, 0, time.UTC)
	explicitEndDate := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)

	tests := []struct {
		name     string
		campaign models.AdCampaign
		now      time.Time
		want     bool
	}{
		{
			name: "finite campaign remains active through explicit end date",
			campaign: models.AdCampaign{
				StartDate: startDate,
				EndDate:   &explicitEndDate,
				Days:      2,
			},
			now:  time.Date(2026, 10, 1, 23, 59, 59, 0, time.UTC),
			want: false,
		},
		{
			name: "finite campaign expires after explicit end date",
			campaign: models.AdCampaign{
				StartDate: startDate,
				EndDate:   &explicitEndDate,
				Days:      2,
			},
			now:  time.Date(2026, 10, 2, 0, 0, 0, 0, time.UTC),
			want: true,
		},
		{
			name: "finite campaign expires after configured duration",
			campaign: models.AdCampaign{
				StartDate: startDate,
				Days:      1,
			},
			now:  time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC),
			want: true,
		},
		{
			name: "continuous campaign does not expire",
			campaign: models.AdCampaign{
				StartDate:       startDate,
				Days:            1,
				RunContinuously: true,
			},
			now:  time.Date(2026, 10, 2, 0, 0, 0, 0, time.UTC),
			want: false,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := campaignHasEnded(&test.campaign, test.now); got != test.want {
				t.Errorf("campaignHasEnded() = %t, want %t", got, test.want)
			}
		})
	}
}
