package services

import (
	"encoding/json"
	"testing"
	"time"

	"quiz.superfan.com/apis/models"
)

func TestMapOngoingQuizToSessionV2UsesSubmissionMode(t *testing.T) {
	record := &models.OngoingQuiz{
		ID:             "session-1",
		UserID:         42,
		Questions:      json.RawMessage("[]"),
		Answers:        json.RawMessage("[]"),
		CreatedAt:      time.Now().UTC(),
		SubmissionMode: "end_of_quiz",
	}

	session := mapOngoingQuizToSessionV2(record, false)
	if session.SubmissionMode != "end_of_quiz" {
		t.Fatalf("expected submissionMode to be preserved, got %q", session.SubmissionMode)
	}
}
