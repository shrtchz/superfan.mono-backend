package services

import (
	"encoding/json"
	"testing"
	"time"
)

func TestMergeLiveQuizSubmissionAnswers(t *testing.T) {
	payload, err := mergeLiveQuizSubmissionAnswers(nil, "quiz-1", "Option A", time.Date(2026, 7, 24, 17, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("merge failed: %v", err)
	}

	var answers []liveQuizSubmission
	if err := json.Unmarshal(payload, &answers); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}

	if len(answers) != 1 {
		t.Fatalf("expected 1 answer, got %d", len(answers))
	}

	if answers[0].QuizID != "quiz-1" || answers[0].SelectedAnswer != "Option A" {
		t.Fatalf("unexpected payload: %+v", answers[0])
	}
}
