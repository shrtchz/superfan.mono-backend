package services

import (
	"encoding/json"
	"testing"
	"time"

	"gorm.io/gorm"
)

func TestBuildOngoingLiveQuizRecordSetsTimestamps(t *testing.T) {
	submittedAt := time.Date(2026, 7, 24, 18, 17, 33, 0, time.UTC)
	record := buildOngoingLiveQuizRecord("5", []string{"quiz-1"}, []byte(`[]`), submittedAt)

	if record.CreatedAt != submittedAt || record.UpdatedAt != submittedAt {
		t.Fatalf("expected created and updated timestamps to be set to %v, got created=%v updated=%v", submittedAt, record.CreatedAt, record.UpdatedAt)
	}
}

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

func TestShouldCreateLiveQuizRecord(t *testing.T) {
	if !shouldCreateLiveQuizRecord(gorm.ErrRecordNotFound) {
		t.Fatal("expected missing-record lookup to create a new row")
	}

	if shouldCreateLiveQuizRecord(nil) {
		t.Fatal("expected existing record lookup to update instead of create")
	}
}
