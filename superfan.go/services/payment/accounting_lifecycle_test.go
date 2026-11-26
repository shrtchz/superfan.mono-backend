package payment

import (
	"context"
	"crypto/hmac"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"quiz.superfan.com/apis/services/payment/providers"
)

func signSHA512(secret string, body []byte) string {
	mac := hmac.New(sha512.New, []byte(secret))
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

func TestWebhookSignatureVerificationMonnifyAndBitnob(t *testing.T) {
	monnifySecret := "test_monnify_secret_key"
	bitnobSecret := "test_bitnob_webhook_secret"
	t.Setenv("BITNOB_WEBHOOK_SECRET", bitnobSecret)

	svc := &PaymentService{
		monnifyProvider: providers.NewMonnifyProvider("MK_TEST_123", monnifySecret, "https://sandbox.monnify.com", "12345"),
		bitnobProvider:  providers.NewBitnobProvider("sandbox_key", "https://sandboxapi.bitnob.co"),
	}

	payload := []byte(`{"transactionReference":"MNFY-123456","amount":10000}`)
	validMonnifySig := signSHA512(monnifySecret, payload)
	if err := svc.VerifyProviderWebhook(context.Background(), "monnify", validMonnifySig, payload); err != nil {
		t.Fatalf("expected valid Monnify signature to pass, got: %v", err)
	}
	if err := svc.VerifyProviderWebhook(context.Background(), "monnify", "deadbeef", payload); err == nil {
		t.Fatalf("expected invalid Monnify signature to fail")
	}
	if err := svc.VerifyProviderWebhook(context.Background(), "monnify", "", payload); err == nil {
		t.Fatalf("expected missing Monnify signature to fail when secret is configured")
	}

	validBitnobSig := signSHA512(bitnobSecret, payload)
	if err := svc.VerifyProviderWebhook(context.Background(), "bitnob", validBitnobSig, payload); err != nil {
		t.Fatalf("expected valid Bitnob signature to pass, got: %v", err)
	}
	if err := svc.VerifyProviderWebhook(context.Background(), "bitnob", "bad-sig", payload); err == nil {
		t.Fatalf("expected invalid Bitnob signature to fail")
	}
}

func TestMonnifyVerifyTransactionExtractsFeeAndSettlement(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/auth/login":
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"requestSuccessful": true,
				"responseBody": map[string]interface{}{
					"accessToken": "tok_test",
				},
			})
		default:
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"requestSuccessful": true,
				"responseBody": map[string]interface{}{
					"transactionReference": "MNFY-999",
					"paymentStatus":        "PAID",
					"amountPaid":           10000.0,
					"settlementAmount":     9900.0,
					"fee":                  100.0,
					"currency":             "NGN",
				},
			})
		}
	}))
	defer srv.Close()

	provider := providers.NewMonnifyProvider("TEST_KEY_123", "SK_TEST_123", srv.URL, "12345")
	provider.BaseURL = srv.URL
	res, err := provider.VerifyTransaction(context.Background(), providers.VerifyTransactionRequest{
		TransactionReference: "MNFY-999",
	})
	if err != nil {
		t.Fatalf("VerifyTransaction failed: %v", err)
	}
	if res.Amount != 10000 {
		t.Fatalf("Amount = %.2f, want 10000", res.Amount)
	}
	if res.Fee != 100 {
		t.Fatalf("Fee = %.2f, want 100", res.Fee)
	}
	if res.SettlementAmount != 9900 {
		t.Fatalf("SettlementAmount = %.2f, want 9900", res.SettlementAmount)
	}
	if res.ProviderName != "Monnify" {
		t.Fatalf("ProviderName = %q, want Monnify", res.ProviderName)
	}
}
