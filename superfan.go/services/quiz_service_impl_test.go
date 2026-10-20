package services

import (
	"testing"

	"quiz.superfan.com/apis/models"
)

func TestBuildTopWinnerCandidatesFromAttempts(t *testing.T) {
	attempts := []models.LiveQuizAttempt{
		{UserID: "user-1", IsWinner: true, IsCompleted: true, Earning: 50},
		{UserID: "user-2", IsWinner: true, IsCompleted: true, Earning: 80},
		{UserID: "user-3", IsWinner: false, IsCompleted: true, Earning: 20},
	}

	winners := buildTopWinnerCandidatesFromAttempts(attempts)
	if len(winners) != 2 {
		t.Fatalf("expected 2 winners, got %d", len(winners))
	}

	first := winners[0]
	if first["username"] != "user-1" {
		t.Fatalf("expected first winner username to be user-1, got %v", first["username"])
	}

	if first["amountWon"] != 50 {
		t.Fatalf("expected first winner amount to be 50, got %v", first["amountWon"])
	}

	second := winners[1]
	if second["rank"] != 2 {
		t.Fatalf("expected second winner rank to be 2, got %v", second["rank"])
	}
}
