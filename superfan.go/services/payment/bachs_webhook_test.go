package payment

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"testing"
)

func TestVerifyBachsSignature(t *testing.T) {
	svc := &PaymentService{}
	ctx := context.Background()

	testSecret := "test_bachs_secret_key_12345"
	os.Setenv("BACHS_WEBHOOK_SECRET", testSecret)
	defer os.Unsetenv("BACHS_WEBHOOK_SECRET")

	rawBody := []byte(`{"event":"collection.succeeded","data":{"reference":"BACHS-TX-1001","amount":5000,"account_number":"1234567890"}}`)

	// Compute valid signature
	mac := hmac.New(sha256.New, []byte(testSecret))
	mac.Write(rawBody)
	validSig := hex.EncodeToString(mac.Sum(nil))

	// 1. Valid signature
	if err := svc.VerifyBachsSignature(ctx, validSig, rawBody); err != nil {
		t.Fatalf("expected valid signature to pass, got: %v", err)
	}

	// 2. Valid signature with sha256= prefix
	if err := svc.VerifyBachsSignature(ctx, "sha256="+validSig, rawBody); err != nil {
		t.Fatalf("expected signature with sha256= prefix to pass, got: %v", err)
	}

	// 3. Invalid signature
	if err := svc.VerifyBachsSignature(ctx, "invalid_sig_here", rawBody); err == nil {
		t.Fatalf("expected invalid signature to fail, but it passed")
	}

	// 4. Missing signature when secret is configured
	if err := svc.VerifyBachsSignature(ctx, "", rawBody); err == nil {
		t.Fatalf("expected missing signature to fail when secret is set, but it passed")
	}

	// 5. No secret configured in env
	os.Unsetenv("BACHS_WEBHOOK_SECRET")
	os.Unsetenv("BACHS_SECRET_KEY")
	if err := svc.VerifyBachsSignature(ctx, "", rawBody); err != nil {
		t.Fatalf("expected empty secret to log warning and pass for dev, got: %v", err)
	}
}

func TestFloatFromAny(t *testing.T) {
	tests := []struct {
		input    interface{}
		expected float64
	}{
		{float64(5000.5), 5000.5},
		{float32(100.25), float64(float32(100.25))},
		{int(2500), 2500},
		{int64(9999), 9999},
		{"1500.75", 1500.75},
		{"  3000  ", 3000},
		{nil, 0},
	}

	for _, tt := range tests {
		actual := floatFromAny(tt.input)
		if actual != tt.expected {
			t.Errorf("floatFromAny(%v) = %v; expected %v", tt.input, actual, tt.expected)
		}
	}
}
