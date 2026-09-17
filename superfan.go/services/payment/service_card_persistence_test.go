package payment

import "testing"

func TestExtractCardMetadataFromChargeResponse(t *testing.T) {
	payload := map[string]interface{}{
		"card": map[string]interface{}{
			"token":       "tok_visa_4242",
			"number":      "4242424242424242",
			"expiryMonth": "09",
			"expiryYear":  "2035",
			"cvv":         "123",
		},
	}
	result := map[string]interface{}{
		"responseBody": map[string]interface{}{
			"status": "SUCCESS",
			"cardDetails": map[string]interface{}{
				"cardToken": "tok_visa_4242",
				"last4":     "4242",
				"first6":    "424242",
				"brand":     "Visa",
				"expiry":    "09/35",
			},
		},
	}

	meta, err := extractCardMetadataFromChargeResponse(payload, result)
	if err != nil {
		t.Fatalf("extractCardMetadataFromChargeResponse() returned error: %v", err)
	}

	if meta.CardToken != "tok_visa_4242" {
		t.Fatalf("expected CardToken to be preserved, got %q", meta.CardToken)
	}
	if meta.Last4 != "4242" {
		t.Fatalf("expected Last4 to be 4242, got %q", meta.Last4)
	}
	if meta.MaskedPan != "424242******4242" {
		t.Fatalf("expected MaskedPan to be 424242******4242, got %q", meta.MaskedPan)
	}
	if meta.CardType != "Visa" {
		t.Fatalf("expected CardType to be Visa, got %q", meta.CardType)
	}
}
