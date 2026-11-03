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

func TestLiveQuizRewardAmountConvertsPointsToNaira(t *testing.T) {
	t.Setenv("POINTS_TO_NAIRA_RATE", "1000")

	if got := liveQuizRewardAmount(2500); got != 2.5 {
		t.Fatalf("expected live quiz reward of 2.5 naira, got %v", got)
	}
}

func TestLiveQuizRewardReferenceIsStablePerQuizAndUser(t *testing.T) {
	first := liveQuizRewardReference("quiz-1", "user-1")
	second := liveQuizRewardReference("quiz-1", "user-1")
	differentUser := liveQuizRewardReference("quiz-1", "user-2")
	differentQuiz := liveQuizRewardReference("quiz-2", "user-1")

	if first != second {
		t.Fatalf("expected stable reward reference, got %q and %q", first, second)
	}
	if first == differentUser || first == differentQuiz {
		t.Fatalf("expected reward reference to vary by quiz and user")
	}
}
