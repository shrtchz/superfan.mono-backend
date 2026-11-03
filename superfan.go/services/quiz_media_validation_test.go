package services

import "testing"

func TestValidateVideoDurationSeconds(t *testing.T) {
	if err := validateVideoDurationSeconds(120); err != nil {
		t.Fatalf("expected 120s video to pass validation, got: %v", err)
	}

	if err := validateVideoDurationSeconds(121); err == nil {
		t.Fatal("expected 121s video to fail validation")
	}
}
