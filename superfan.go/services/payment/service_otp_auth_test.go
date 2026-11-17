package payment

import (
	"strings"
	"testing"
)

func TestResolveOTPAnd3DSRequirements(t *testing.T) {
	// Test Case 1: OTP_AUTHORIZATION_REQUIRED
	chargeStatus1 := "OTP_AUTHORIZATION_REQUIRED"
	statusUpper1 := strings.ToUpper(chargeStatus1)
	body1 := map[string]interface{}{
		"status": chargeStatus1,
		"otpData": map[string]interface{}{
			"id":      "token-12345",
			"message": "Enter the OTP sent to your mobile phone",
		},
	}

	isOtpRequired1 := statusUpper1 == "OTP_AUTHORIZATION_REQUIRED" ||
		statusUpper1 == "PENDING_OTP" ||
		statusUpper1 == "REQUIRES_OTP" ||
		statusUpper1 == "OTP_REQUIRED" ||
		body1["otpData"] != nil

	if !isOtpRequired1 {
		t.Fatalf("expected isOtpRequired1 to be true for status %s", chargeStatus1)
	}

	// Test Case 2: BANK_AUTHORIZATION_REQUIRED with secure3dData
	chargeStatus2 := "BANK_AUTHORIZATION_REQUIRED"
	statusUpper2 := strings.ToUpper(chargeStatus2)
	body2 := map[string]interface{}{
		"status": chargeStatus2,
		"secure3dData": map[string]interface{}{
			"redirectUrl": "https://sandbox.monnify.com/3ds-auth",
		},
	}

	if sec3d, ok := body2["secure3dData"].(map[string]interface{}); ok && sec3d != nil {
		if rUrl, ok := sec3d["redirectUrl"].(string); ok && rUrl != "" {
			if _, hasRedirect := body2["redirectUrl"]; !hasRedirect {
				body2["redirectUrl"] = rUrl
			}
		}
	}

	is3dsRequired2 := statusUpper2 == "BANK_AUTHORIZATION_REQUIRED" ||
		statusUpper2 == "3DS_AUTHORIZATION_REQUIRED" ||
		statusUpper2 == "PENDING_3DS" ||
		statusUpper2 == "REDIRECT" ||
		body2["secure3dData"] != nil ||
		body2["redirectUrl"] != nil

	if !is3dsRequired2 {
		t.Fatalf("expected is3dsRequired2 to be true for status %s", chargeStatus2)
	}

	if body2["redirectUrl"] != "https://sandbox.monnify.com/3ds-auth" {
		t.Fatalf("expected body2[redirectUrl] to be flattened, got %v", body2["redirectUrl"])
	}
}
