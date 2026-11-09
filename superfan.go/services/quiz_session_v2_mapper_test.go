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

func TestMapOngoingQuizToSessionV2StatusUniformity(t *testing.T) {
	now := time.Now().UTC()
	expiry := now.Add(10 * time.Minute)

	// 1. Ready state for custom quiz
	customReady := &models.OngoingQuiz{
		ID:        "custom-ready",
		UserID:    10,
		IsRandom:  false,
		Questions: json.RawMessage("[]"),
		Answers:   json.RawMessage("[]"),
		CreatedAt: now,
		QuizAttempt: &models.QuizAttempt{
			IsStarted:   false,
			IsCompleted: false,
		},
	}
	s1 := mapOngoingQuizToSessionV2(customReady, false)
	if s1.Status != "ready" {
		t.Fatalf("expected custom unstarted session to have status 'ready', got %q", s1.Status)
	}

	// 2. In progress for custom quiz once started via QuizAttempt or StartedAt
	customStarted := &models.OngoingQuiz{
		ID:        "custom-started",
		UserID:    10,
		IsRandom:  false,
		Questions: json.RawMessage("[]"),
		Answers:   json.RawMessage("[]"),
		StartedAt: &now,
		ExpiresAt: &expiry,
		CreatedAt: now,
		QuizAttempt: &models.QuizAttempt{
			IsStarted: true,
			StartedAt: &now,
			ExpiresAt: &expiry,
		},
	}
	s2 := mapOngoingQuizToSessionV2(customStarted, false)
	if s2.Status != "in_progress" {
		t.Fatalf("expected custom started session to have status 'in_progress', got %q", s2.Status)
	}
	if s2.StartedAt == nil || s2.ExpiresAt == nil {
		t.Fatalf("expected custom started session to have startedAt and expiresAt timestamps populated")
	}

	// 3. Completed state
	customCompleted := &models.OngoingQuiz{
		ID:          "custom-completed",
		UserID:      10,
		IsRandom:    false,
		IsCompleted: true,
		Questions:   json.RawMessage("[]"),
		Answers:     json.RawMessage("[]"),
		CreatedAt:   now,
	}
	s3 := mapOngoingQuizToSessionV2(customCompleted, false)
	if s3.Status != "completed" {
		t.Fatalf("expected completed session to have status 'completed', got %q", s3.Status)
	}
}
