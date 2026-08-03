package services

import "testing"

func TestGetPointsToNairaRateUsesConfiguredValue(t *testing.T) {
	t.Setenv("POINTS_TO_NAIRA_RATE", "2500")

	if got := getPointsToNairaRate(); got != 2500 {
		t.Fatalf("expected configured conversion rate 2500, got %d", got)
	}
}

func TestGetPointsToNairaRateFallsBackToDefault(t *testing.T) {
	t.Setenv("POINTS_TO_NAIRA_RATE", "")

	if got := getPointsToNairaRate(); got != 1000 {
		t.Fatalf("expected default conversion rate 1000, got %d", got)
	}
}
