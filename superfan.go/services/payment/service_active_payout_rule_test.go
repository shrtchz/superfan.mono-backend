package payment

import (
	"context"
	"strings"
	"testing"
)

func TestMaskIDNumber(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"0123456789", "••••6789"},
		{"12345", "••••2345"},
		{"1234", "••••1234"},
		{"", "••••"},
		{"••••6789", "••••6789"},
	}

	for _, tt := range tests {
		got := maskIDNumber(tt.input)
		if got != tt.expected {
			t.Errorf("maskIDNumber(%q) = %q; expected %q", tt.input, got, tt.expected)
		}
	}
}

func TestValidateActiveBankAccountPayout_EmptyAccount(t *testing.T) {
	svc := &PaymentService{}
	ctx := context.Background()

	err := svc.ValidateActiveBankAccountPayout(ctx, "")
	if err == nil {
		t.Fatal("expected error for empty account number, got nil")
	}
	if !strings.Contains(err.Error(), "destination bank account number is required") {
		t.Fatalf("unexpected error message: %v", err)
	}

	err = svc.ValidateActiveBankAccountPayout(ctx, "   ")
	if err == nil {
		t.Fatal("expected error for whitespace account number, got nil")
	}
}
