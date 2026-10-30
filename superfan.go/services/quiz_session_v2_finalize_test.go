package services

import "testing"

func TestCalculateSessionAccuracyPercent(t *testing.T) {
	tests := []struct {
		name           string
		correctAnswers int
		totalQuestions int
		want           int
	}{
		{name: "partial quit uses full test question count", correctAnswers: 2, totalQuestions: 10, want: 20},
		{name: "rounds to nearest integer", correctAnswers: 1, totalQuestions: 3, want: 33},
		{name: "no correct answers", correctAnswers: 0, totalQuestions: 10, want: 0},
		{name: "zero questions", correctAnswers: 0, totalQuestions: 0, want: 0},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := calculateSessionAccuracyPercent(test.correctAnswers, test.totalQuestions); got != test.want {
				t.Fatalf("calculateSessionAccuracyPercent(%d, %d) = %d, want %d", test.correctAnswers, test.totalQuestions, got, test.want)
			}
		})
	}
}
