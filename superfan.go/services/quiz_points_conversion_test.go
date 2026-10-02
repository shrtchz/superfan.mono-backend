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

	if got := getPointsToNairaRate(); got != defaultPointsToNairaRate {
		t.Fatalf("expected default conversion rate %d, got %d", defaultPointsToNairaRate, got)
	}
}

func TestConvertTotalEarningToRewardAmountsUsesBaseEarning(t *testing.T) {
	t.Setenv("POINTS_TO_NAIRA_RATE", "1000")

	amountInNaira, finalNairaAmount, finalUSDCAmount, finalUSDTAmount := convertTotalEarningToRewardAmounts(2500)

	if amountInNaira != 2.5 {
		t.Fatalf("expected naira amount 2.5, got %v", amountInNaira)
	}
	if finalNairaAmount != 2 {
		t.Fatalf("expected rounded naira amount 2, got %d", finalNairaAmount)
	}
	if finalUSDCAmount != 0 {
		t.Fatalf("expected zero USDC amount for the default exchange rates, got %d", finalUSDCAmount)
	}
	if finalUSDTAmount != 0 {
		t.Fatalf("expected zero USDT amount for the default exchange rates, got %d", finalUSDTAmount)
	}
}
