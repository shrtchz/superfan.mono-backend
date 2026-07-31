package services

import "testing"

func TestResolveQuizCountdownLabelUsesPhaseOverride(t *testing.T) {
	t.Parallel()

	got := resolveQuizCountdownLabel(
		"Waiting for Live Quiz to start; starts in 5 minutes.",
		"before",
		"Be ready!",
		"",
		"",
	)

	if got != "Be ready!" {
		t.Fatalf("expected before-phase override, got %q", got)
	}
}

func TestResolveQuizCountdownLabelFallsBackToDefaultWhenNoOverrideExists(t *testing.T) {
	t.Parallel()

	got := resolveQuizCountdownLabel(
		"Select an answer by clicking on the 3 dots in front of the live quiz.",
		"during",
		"",
		"",
		"",
	)

	if got != "Select an answer by clicking on the 3 dots in front of the live quiz." {
		t.Fatalf("expected default label when no override exists, got %q", got)
	}
}
