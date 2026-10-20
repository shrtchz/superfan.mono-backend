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

func TestAllValidCDNUrls(t *testing.T) {
	tests := []struct {
		name     string
		urls     []string
		expected bool
	}{
		{
			name:     "empty slice",
			urls:     []string{},
			expected: false,
		},
		{
			name:     "valid Cloudinary secure urls",
			urls:     []string{"https://res.cloudinary.com/demo/image/upload/v1234/test.jpg"},
			expected: true,
		},
		{
			name:     "multiple valid Cloudinary urls",
			urls:     []string{"https://res.cloudinary.com/demo/image/upload/v1234/1.jpg", "https://cloudinary.com/images/2.png"},
			expected: true,
		},
		{
			name:     "airtable temporary url",
			urls:     []string{"https://v5.airtableusercontent.com/v3/u/12/xyz.png"},
			expected: false,
		},
		{
			name:     "mixed urls",
			urls:     []string{"https://res.cloudinary.com/demo/image/upload/v1234/test.jpg", "https://v5.airtableusercontent.com/v3/u/12/xyz.png"},
			expected: false,
		},
		{
			name:     "empty string inside slice",
			urls:     []string{""},
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := allValidCDNUrls(tt.urls)
			if result != tt.expected {
				t.Errorf("allValidCDNUrls(%v) = %v, expected %v", tt.urls, result, tt.expected)
			}
		})
	}
}

